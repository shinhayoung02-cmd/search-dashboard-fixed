import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function normalizeSpace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function getBraveApiKey() {
  return (
    process.env.BRAVE_SEARCH_API_KEY ||
    process.env.BRAVE_API_KEY ||
    process.env.NEXT_PUBLIC_BRAVE_SEARCH_API_KEY ||
    ''
  )
}

function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeBraveResults(results = [], limit = 20) {
  const seen = new Set()
  const output = []

  for (const item of results || []) {
    const url = item.url || item.link || ''

    if (!url) continue
    if (seen.has(url)) continue

    seen.add(url)

    output.push({
      title: item.title || url,
      url,
      source_url: url,
      snippet: item.description || item.snippet || '',
      description: item.description || item.snippet || '',
      display_link: item.profile?.long_name || domainFromUrl(url),
      source: domainFromUrl(url),
      provider: 'brave',
    })

    if (output.length >= limit) break
  }

  return output
}

async function braveSearch(query, limit = 20) {
  const apiKey = getBraveApiKey()

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      error: 'BRAVE_SEARCH_API_KEY가 설정되어 있지 않습니다.',
      results: [],
      raw_count: 0,
    }
  }

  const safeLimit = Math.min(Math.max(Number(limit || 20), 1), 20)

  const params = new URLSearchParams({
    q: query,
    count: String(safeLimit),
    country: 'KR',
    search_lang: 'ko',
    safesearch: 'off',
    spellcheck: '1',
    text_decorations: '0',
  })

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    cache: 'no-store',
  })

  const text = await res.text()

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        data?.error?.message ||
        data?.message ||
        text ||
        `Brave API 오류: ${res.status}`,
      results: [],
      raw_count: 0,
      raw: data,
    }
  }

  const webResults = data?.web?.results || []

  return {
    ok: true,
    status: res.status,
    error: null,
    results: normalizeBraveResults(webResults, safeLimit),
    raw_count: webResults.length,
    raw: data,
  }
}

async function saveCandidatesToSupabase({ supabase, candidates, query, queryId }) {
  if (!candidates.length) {
    return { saved_count: 0, error: null }
  }

  const now = new Date().toISOString()

  const sourceUrlRows = candidates.map((item, index) => ({
    query_id: queryId ? String(queryId) : null,
    query_text: query,
    engine: 'Brave',
    source_url: item.url,
    title: item.title || '',
    snippet: item.snippet || '',
    display_link: item.display_link || '',
    rank: index + 1,
    status: 'candidate',
    payload: item,
    created_at: now,
  }))

  const attempt1 = await supabase
    .from('search_url_candidates')
    .insert(sourceUrlRows)
    .select('id, source_url, title')

  if (!attempt1.error) {
    return {
      saved_count: attempt1.data?.length || sourceUrlRows.length,
      error: null,
    }
  }

  // 예전 스키마 대응: url 컬럼 사용
  const urlRows = candidates.map((item, index) => ({
    query_id: queryId || null,
    query_text: query,
    keyword: query,
    url: item.url,
    title: item.title || '',
    snippet: item.snippet || '',
    display_link: item.display_link || '',
    source: item.source || domainFromUrl(item.url),
    rank: index + 1,
    status: 'candidate',
    payload: item,
  }))

  const attempt2 = await supabase
    .from('search_url_candidates')
    .insert(urlRows)
    .select('id, url, title')

  if (!attempt2.error) {
    return {
      saved_count: attempt2.data?.length || urlRows.length,
      error: null,
    }
  }

  return {
    saved_count: 0,
    error: attempt2.error?.message || attempt1.error?.message || '후보 URL 저장 실패',
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const query = normalizeSpace(body.query || body.q || body.keyword || '')
    const queryId = body.query_id || body.queryId || null
    const limit = Math.min(Math.max(Number(body.limit || 20), 1), 20)

    if (!query) {
      return json(
        {
          ok: false,
          error: 'query는 필수입니다.',
          urls: [],
          candidates: [],
          results: [],
        },
        { status: 400 }
      )
    }

    const searchResult = await braveSearch(query, limit)
    const urls = searchResult.results || []

    const supabase = getSupabaseAdmin()

    const saveResult = await saveCandidatesToSupabase({
      supabase,
      candidates: urls,
      query,
      queryId,
    })

    if (queryId) {
      await supabase
        .from('queries')
        .update({
          candidate_status: urls.length > 0 ? 'candidate_collected' : 'no_results',
          candidate_error: urls.length > 0 ? null : 'NO_BRAVE_RESULTS',
        })
        .eq('id', queryId)
    }

    return json({
      ok: true,
      provider: 'brave',
      request_count: 1,
      query,
      urls,
      candidates: urls,
      results: urls,
      count: urls.length,
      raw_count: searchResult.raw_count || 0,
      saved_count: saveResult.saved_count,
      save_error: saveResult.error,
      search_status: searchResult.status,
      search_error: searchResult.error,
      message:
        urls.length > 0
          ? `Brave URL 후보 ${urls.length}개를 불러왔습니다.`
          : 'Brave URL 후보 0개를 불러왔습니다.',
    })
  } catch (error) {
    return json(
      {
        ok: false,
        error: error.message,
        urls: [],
        candidates: [],
        results: [],
      },
      { status: 500 }
    )
  }
}