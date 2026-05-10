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

function getQueryText(row) {
  return String(row?.query_text || row?.keyword || row?.text || row?.query || '').trim()
}

function startOfTodayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

async function getCachedCandidates(supabase, queryId, limit) {
  const { data, error } = await supabase
    .from('search_url_candidates')
    .select('*')
    .eq('query_id', queryId)
    .gte('created_at', startOfTodayIso())
    .order('created_at', { ascending: false })
    .limit(limit)

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

async function saveCandidates(supabase, { queryId, queryText, searchResult, limit }) {
  const uniqueItems = []
  const seen = new Set()

  for (const item of searchResult.items || []) {
    if (!item.url || seen.has(item.url)) continue
    if (item.url.includes('???')) continue

    seen.add(item.url)
    uniqueItems.push({
      query_id: queryId,
      query_text: queryText,
      matched_query: searchResult.matched_query || queryText,
      title: item.title || '',
      snippet: item.description || '',
      url: item.url,
      source: item.site || getDomain(item.url),
      status: 'collected',
      updated_at: new Date().toISOString(),
    })

    if (uniqueItems.length >= limit) break
  }

  if (uniqueItems.length === 0) return []

  const { data, error } = await supabase
    .from('search_url_candidates')
    .upsert(uniqueItems, { onConflict: 'url' })
    .select('*')

  if (error) throw error
  return data || []
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const queryLimit = Math.min(Math.max(Number(body.query_limit || body.queryLimit || 3), 1), 5)
    const urlLimit = Math.min(Math.max(Number(body.url_limit || body.urlLimit || 5), 1), 10)

    const supabase = getSupabaseAdmin()

    const { data: queries, error: queryError } = await supabase
      .from('queries')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true })
      .limit(queryLimit)

    if (queryError) {
      return NextResponse.json(
        { ok: false, error: `queries 조회 오류: ${queryError.message}` },
        { status: 500 }
      )
    }

    const processed = []
    const failed = []

    for (const queryRow of queries || []) {
      const queryText = getQueryText(queryRow)

      if (!queryText) {
        failed.push({ query_id: queryRow.id, reason: 'QUERY_TEXT_EMPTY' })
        continue
      }

      const cached = await getCachedCandidates(supabase, queryRow.id, urlLimit)

      if (cached.length > 0) {
        processed.push({
          query_id: queryRow.id,
          query_text: queryText,
          from_cache: true,
          google_status: 'cached',
          result_count: cached.length,
          urls: cached.map(mapCandidate),
        })
        continue
      }

      const searchResult = await searchGoogle(queryText)

      if (!searchResult.ok || !searchResult.items?.length) {
        failed.push({
          query_id: queryRow.id,
          query_text: queryText,
          tried_queries: searchResult.tried_queries || [queryText],
          google_status: searchResult.google_status || 'SEARCH_EMPTY_RESULT',
          google_error_message: searchResult.google_error_detail || '',
          result_count: 0,
          final_reason: searchResult.google_status || 'SEARCH_EMPTY_RESULT',
        })

        if (searchResult.google_status === 'GOOGLE_API_429') {
          return NextResponse.json({
            ok: false,
            processed,
            failed,
            stopped: true,
            stop_reason: 'GOOGLE_API_429',
            message: 'Google Search API 할당량이 초과되어 DB 쿼리 URL 후보 수집을 중단했습니다.',
          })
        }

        continue
      }

      const saved = await saveCandidates(supabase, {
        queryId: queryRow.id,
        queryText,
        searchResult,
        limit: urlLimit,
      })

      processed.push({
        query_id: queryRow.id,
        query_text: queryText,
        from_cache: false,
        tried_queries: searchResult.tried_queries || [queryText],
        matched_query: searchResult.matched_query || queryText,
        google_status: 'success',
        result_count: saved.length,
        urls: saved.map(mapCandidate),
      })

      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    return NextResponse.json({
      ok: processed.length > 0,
      processed,
      failed,
      processed_count: processed.length,
      failed_count: failed.length,
      stopped: false,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'DB 쿼리 URL 후보 자동 수집 실패',
        detail: error.message,
      },
      { status: 500 }
    )
  }
}
