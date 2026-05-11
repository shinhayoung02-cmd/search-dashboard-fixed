import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const url = String(body.url || '').trim()
    const title = String(body.title || '').trim()
    const detailBody = String(body.body || body.detail_body || '').trim()
    const keyword = String(body.keyword || '네이버 카페 수동 저장').trim()
    const source = String(body.source || 'cafe.naver.com').trim()
    const imageUrl = String(body.image_url || '').trim()
    const location = body.location ? String(body.location).trim() : null
    const author = body.author ? String(body.author).trim() : null

    if (!url) {
      return json({ ok: false, error: 'url이 필요합니다.' }, { status: 400 })
    }

    if (!title && !detailBody) {
      return json({ ok: false, error: 'title 또는 body 중 하나는 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const payload = {
      keyword,
      title: title || '제목 없음',
      snippet: detailBody ? detailBody.slice(0, 240) : '',
      detail_body: detailBody,
      url,
      source,
      location,
      author,
      image_url: imageUrl,
      crawl_status: 'manual_success',
    }

    const { data, error } = await supabase
      .from('results')
      .upsert(payload, { onConflict: 'url' })
      .select()
      .single()

    if (error) {
      return json({ ok: false, error: error.message, payload }, { status: 500 })
    }

    return json({ ok: true, result: data })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}
