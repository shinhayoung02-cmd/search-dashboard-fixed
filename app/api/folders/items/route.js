import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function normalizeResult(item = {}) {
  return {
    ...item,

    source: item.source || item.site || '',
    site: item.site || item.source || '',

    snippet: item.snippet || item.description || '',
    description: item.description || item.snippet || '',

    image_url: item.image_url || item.thumbnail || '',
    thumbnail: item.thumbnail || item.image_url || '',

    detail_body: item.detail_body || '',
    crawl_status: item.crawl_status || 'unknown',

    published_at: item.published_at || null,
    post_date: item.post_date || null,
    article_date: item.article_date || null,
    published_at_raw: item.published_at_raw || null,
  }
}

function uniqueIds(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  )
}

async function getFolderResultIds(supabase, folderId) {
  const { data, error } = await supabase
    .from('result_folder_items')
    .select('result_id')
    .eq('folder_id', folderId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return uniqueIds((data || []).map((row) => row.result_id))
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const folderId = String(searchParams.get('folder_id') || '').trim()
    const keyword = String(searchParams.get('keyword') || '').trim()
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const pageSize = 12
    const from = (page - 1) * pageSize
    const to = page * pageSize - 1

    if (!folderId) {
      return json({ ok: false, error: 'folder_id가 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const resultIds = await getFolderResultIds(supabase, folderId)

    if (resultIds.length === 0) {
      return json({
        ok: true,
        folder_id: folderId,
        results: [],
        total: 0,
        page,
        pageSize,
      })
    }

    let q = supabase
      .from('results')
      .select('*', { count: 'exact' })
      .in('id', resultIds)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (keyword) {
      q = q.or(
        `keyword.ilike.%${keyword}%,title.ilike.%${keyword}%,detail_body.ilike.%${keyword}%,description.ilike.%${keyword}%`
      )
    }

    const { data, error, count } = await q

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 })
    }

    return json({
      ok: true,
      folder_id: folderId,
      results: (data || []).map(normalizeResult),
      total: count || 0,
      page,
      pageSize,
    })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const folderId = String(body.folder_id || body.folderId || '').trim()
    const resultIds = uniqueIds(body.result_ids || body.resultIds || [])

    if (!folderId) {
      return json({ ok: false, error: 'folder_id가 필요합니다.' }, { status: 400 })
    }

    if (resultIds.length === 0) {
      return json({ ok: false, error: 'result_ids 배열이 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const rows = resultIds.map((resultId) => ({
      folder_id: folderId,
      result_id: resultId,
    }))

    const { data, error } = await supabase
      .from('result_folder_items')
      .upsert(rows, { onConflict: 'folder_id,result_id' })
      .select('*')

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 })
    }

    return json({
      ok: true,
      saved_count: data?.length || rows.length,
      items: data || [],
      message: `선택한 결과 ${resultIds.length}개를 폴더에 추가했습니다.`,
    })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const folderId = String(body.folder_id || body.folderId || '').trim()
    const resultIds = uniqueIds(body.result_ids || body.resultIds || [])

    if (!folderId) {
      return json({ ok: false, error: 'folder_id가 필요합니다.' }, { status: 400 })
    }

    if (resultIds.length === 0) {
      return json({ ok: false, error: 'result_ids 배열이 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('result_folder_items')
      .delete()
      .eq('folder_id', folderId)
      .in('result_id', resultIds)
      .select('*')

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 })
    }

    return json({
      ok: true,
      deleted_count: data?.length || 0,
      deleted: data || [],
      message: `선택한 결과 ${data?.length || 0}개를 폴더에서 제거했습니다.`,
    })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}
