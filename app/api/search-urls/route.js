import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { searchGoogle } from '@/lib/searchApis'

export const runtime = 'nodejs'
export const maxDuration = 60

function getDomain(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function startOfTodayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function getQueryText(row) {
  return String(row?.query_text || row?.keyword || row?.text || row?.query || '').trim()
}

async function findQueryById(supabase, queryId) {
  if (!queryId) return null

  const { data, error } = await supabase
    .from('queries')
    .select('*')
    .eq('id', queryId)
    .maybeSingle()

  if (error) throw new Error(`queries 조회 오류: ${error.message}`)
  return data || null
}

async function getCachedCandidates(supabase, { query, queryId, limit }) {
  let q = supabase
    .from('search_url_candidates')
    .select('*')
    .gte('created_at', startOfTodayIso())
    .order('created_at', { ascending: false })
    .limit(limit)

  if (queryId) {
    q = q.eq('query_id', queryId)
  } else {
    q = q.eq('query_text', query)
  }

  const { data, error } = await q
  if (error) return []
  return data || []
}

function mapCandidate(item) {
  return {
    id: item.id,
    query_id: item.query_id || null,
    query_text: item.query_text || '',
    matched_query: item.matched_query || item.query_text || '',
    title: item.title || '',
    snippet: item.snippet || '',
    url: item.url || '',
    source: item.source || getDomain(item.url),
    status: item.status || 'collected',
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const limit = Math.min(Math.max(Number(body.limit || 5), 1), 10)
    const queryId = body.query_id || body.queryId || null

    const supabase = getSupabaseAdmin()

    let query = String(body.query || '').trim()
    let queryRow = null

    if (queryId) {
      queryRow = await findQueryById(supabase, queryId)
      query = query || getQueryText(queryRow)
    }

    if (!query) {
      return json(
        { ok: false, google_status: 'QUERY_MISSING', message: 'query 또는 query_id가 필요합니다.' },
        { status: 400 }
      )
    }

    // 같은 쿼리/쿼리ID로 오늘 이미 뽑은 URL 후보가 있으면 Google API를 다시 쓰지 않습니다.
    const cached = await getCachedCandidates(supabase, { query, queryId, limit })

    if (cached.length > 0) {
      return json({
        ok: true,
        from_cache: true,
        query_id: queryId,
        query,
        matched_query: cached[0]?.matched_query || query,
        google_status: 'cached',
        result_count: cached.length,
        urls: cached.map(mapCandidate),
      })
    }

    // 캐시가 없을 때만 Google Custom Search API를 호출합니다.
    const searchResult = await searchGoogle(query)

    if (!searchResult.ok || !searchResult.items?.length) {
      return json({
        ok: false,
        from_cache: false,
        query_id: queryId,
        query,
        urls: [],
        tried_queries: searchResult.tried_queries || [query],
        matched_query: searchResult.matched_query || null,
        google_status: searchResult.google_status || 'SEARCH_EMPTY_RESULT',
        google_error_message: searchResult.google_error_detail || '',
        result_count: 0,
        message:
          searchResult.google_status === 'GOOGLE_API_429'
            ? 'Google Search API 할당량이 초과되었습니다. 오늘은 URL 자동 수집이 어렵습니다.'
            : '검색 결과 URL 후보가 없습니다.',
      })
    }

    const uniqueItems = []
    const seen = new Set()

    for (const item of searchResult.items) {
      if (!item.url || seen.has(item.url)) continue
      if (item.url.includes('???')) continue

      seen.add(item.url)
      uniqueItems.push({
        query_id: queryId,
        query_text: query,
        matched_query: searchResult.matched_query || query,
        title: item.title || '',
        snippet: item.description || '',
        url: item.url,
        source: item.site || getDomain(item.url),
        status: 'collected',
        updated_at: new Date().toISOString(),
      })

      if (uniqueItems.length >= limit) break
    }

    if (uniqueItems.length === 0) {
      return json({
        ok: false,
        from_cache: false,
        query_id: queryId,
        query,
        urls: [],
        tried_queries: searchResult.tried_queries || [query],
        matched_query: searchResult.matched_query || null,
        google_status: 'SEARCH_EMPTY_RESULT',
        result_count: 0,
        message: '저장 가능한 URL 후보가 없습니다.',
      })
    }

    const { data: saved, error: saveError } = await supabase
      .from('search_url_candidates')
      .upsert(uniqueItems, { onConflict: 'url' })
      .select('*')

    if (saveError) {
      return json(
        {
          ok: false,
          query_id: queryId,
          query,
          google_status: 'SUPABASE_SAVE_ERROR',
          message: saveError.message,
        },
        { status: 500 }
      )
    }

    return json({
      ok: true,
      from_cache: false,
      query_id: queryId,
      query,
      tried_queries: searchResult.tried_queries || [query],
      matched_query: searchResult.matched_query || query,
      google_status: 'success',
      result_count: saved?.length || 0,
      urls: (saved || []).map(mapCandidate),
    })
  } catch (error) {
    return json(
      {
        ok: false,
        google_status: 'EXCEPTION',
        message: error.message || 'URL 후보 수집 중 오류가 발생했습니다.',
      },
      { status: 500 }
    )
  }
}
