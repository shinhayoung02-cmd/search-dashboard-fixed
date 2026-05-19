import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const keyword = searchParams.get('keyword') || ''
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const requestedPageSize = parseInt(searchParams.get('pageSize') || '12', 10)
    const pageSize = Math.max(1, Math.min(Number.isNaN(requestedPageSize) ? 12 : requestedPageSize, 1000))
    const sort = searchParams.get('sort') || 'latest'
    const from = (page - 1) * pageSize
    const to = page * pageSize - 1

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('results')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (keyword) {
      q = q.or(
        `keyword.ilike.%${keyword}%,title.ilike.%${keyword}%,detail_body.ilike.%${keyword}%,description.ilike.%${keyword}%`
      )
    }

    const { data, error, count } = await q

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const normalized = (data || []).map((item) => ({
      ...item,

      source: item.source || item.site || '',
      site: item.site || item.source || '',

      snippet: item.snippet || item.description || '',
      description: item.description || item.snippet || '',

      image_url: item.image_url || item.thumbnail || '',
      thumbnail: item.thumbnail || item.image_url || '',

      detail_body: item.detail_body || '',
      crawl_status: item.crawl_status || 'unknown',

      // 원본 게시물 날짜 필드 유지
      published_at: item.published_at || null,
      post_date: item.post_date || null,
      article_date: item.article_date || null,
      published_at_raw: item.published_at_raw || null,
    }))

    return NextResponse.json({
      results: normalized,
      total: count || 0,
      page,
      pageSize,
      sort,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
