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

function isUuid(value = '') {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  )
}

function safeInt(value, fallback, min, max) {
  const n = parseInt(String(value || ''), 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(n, max))
}

function getDateValue(item = {}) {
  const candidates = [
    item.created_at,
    item.published_at,
    item.post_date,
    item.article_date,
    item.published_at_raw,
  ]

  for (const value of candidates) {
    if (!value) continue
    const time = new Date(value).getTime()
    if (!Number.isNaN(time)) return time
  }

  return 0
}

function matchesKeyword(item = {}, keyword = '') {
  const q = String(keyword || '').trim().toLowerCase()
  if (!q) return true

  const haystack = [
    item.keyword,
    item.title,
    item.detail_body,
    item.description,
    item.snippet,
    item.source,
    item.site,
    item.url,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')

  return haystack.includes(q)
}

function chunkArray(items = [], size = 200) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function getFolderResultIds(supabase, folderId) {
  const { data, error } = await supabase
    .from('result_folder_items')
    .select('result_id, created_at')
    .eq('folder_id', folderId)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    throw new Error(`result_folder_items 조회 오류: ${error.message}`)
  }

  const ids = uniqueIds((data || []).map((row) => row.result_id))
  const validIds = ids.filter(isUuid)
  const skippedInvalidIds = ids.filter((id) => !isUuid(id))

  return {
    ids: validIds,
    skippedInvalidIds,
  }
}

async function fetchResultsByIds(supabase, resultIds) {
  const rows = []
  const chunks = chunkArray(resultIds, 200)

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('results')
      .select('*')
      .in('id', chunk)

    if (error) {
      throw new Error(`results 조회 오류: ${error.message}`)
    }

    rows.push(...(data || []))
  }

  return rows
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const folderId = String(searchParams.get('folder_id') || '').trim()
    const keyword = String(searchParams.get('keyword') || '').trim()
    const page = safeInt(searchParams.get('page'), 1, 1, 999999)
    const pageSize = safeInt(searchParams.get('pageSize'), 12, 1, 1000)
    const sort = searchParams.get('sort') || 'latest'

    if (!folderId) {
      return json({ ok: false, error: 'folder_id가 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { ids: resultIds, skippedInvalidIds } = await getFolderResultIds(
      supabase,
      folderId
    )

    if (resultIds.length === 0) {
      return json({
        ok: true,
        folder_id: folderId,
        results: [],
        total: 0,
        page,
        pageSize,
        sort,
        skipped_invalid_id_count: skippedInvalidIds.length,
      })
    }

    const allResults = await fetchResultsByIds(supabase, resultIds)

    const filtered = allResults
      .map(normalizeResult)
      .filter((item) => matchesKeyword(item, keyword))
      .sort((a, b) => getDateValue(b) - getDateValue(a))

    const total = filtered.length
    const from = (page - 1) * pageSize
    const to = from + pageSize

    return json({
      ok: true,
      folder_id: folderId,
      results: filtered.slice(from, to),
      total,
      page,
      pageSize,
      sort,
      skipped_invalid_id_count: skippedInvalidIds.length,
    })
  } catch (error) {
    return json(
      {
        ok: false,
        stage: 'folders_items_get',
        error: error.message,
      },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const folderId = String(body.folder_id || body.folderId || '').trim()
    const rawResultIds = uniqueIds(body.result_ids || body.resultIds || [])
    const resultIds = rawResultIds.filter(isUuid)
    const skippedInvalidIds = rawResultIds.filter((id) => !isUuid(id))

    if (!folderId) {
      return json({ ok: false, error: 'folder_id가 필요합니다.' }, { status: 400 })
    }

    if (resultIds.length === 0) {
      return json(
        {
          ok: false,
          error: '저장 가능한 result_ids가 없습니다. results.id 값이 UUID인지 확인하세요.',
          skipped_invalid_ids: skippedInvalidIds,
        },
        { status: 400 }
      )
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
      skipped_invalid_id_count: skippedInvalidIds.length,
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
    const rawResultIds = uniqueIds(body.result_ids || body.resultIds || [])
    const resultIds = rawResultIds.filter(isUuid)

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
