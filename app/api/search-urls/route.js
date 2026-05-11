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

function extractSiteDomain(query = '') {
  const match = String(query || '').match(/site:([^\s"]+)/i)
  return match ? match[1].replace(/^www\./, '').trim() : ''
}

function extractSitePrefix(query = '') {
  const domain = extractSiteDomain(query)
  return domain ? `site:${domain}` : ''
}

function extractQuotedTerms(query = '') {
  return Array.from(String(query || '').matchAll(/"([^"]+)"/g))
    .map((match) => normalizeSpace(match[1]))
    .filter(Boolean)
}

function stripSiteOperator(query = '') {
  return normalizeSpace(String(query || '').replace(/site:[^\s"]+/gi, ''))
}

function stripQuotes(query = '') {
  return normalizeSpace(String(query || '').replace(/"/g, ''))
}

function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function loadCrawledResultUrls(supabase) {
  const { data, error } = await supabase
    .from('results')
    .select('url')
    .not('url', 'is', null)
    .limit(10000)

  if (error) {
    console.error('results URL 조회 실패:', error.message)
    return new Set()
  }

  return new Set(
    (data || [])
      .map((item) => String(item.url || '').trim())
      .filter(Boolean)
  )
}

function isTargetDomain(url = '', siteDomain = '') {
  if (!siteDomain) return true

  const host = domainFromUrl(url)
  const target = siteDomain.replace(/^www\./, '')

  return host === target || host.endsWith(`.${target}`)
}

function buildBraveQueryVariants(originalQuery = '') {
  const original = normalizeSpace(originalQuery)
  const siteDomain = extractSiteDomain(original)
  const sitePrefix = extractSitePrefix(original)
  const quotedTerms = extractQuotedTerms(original)
  const withoutQuotes = stripQuotes(original)

  const variants = []

  // 1차: 원본 쿼리 그대로 검색
  // 예: site:clien.net "분실물" "확인" "찾기"
  if (original) {
    variants.push(original)
  }

  // 2차: 따옴표만 제거해서 검색 조건 완화
  // 예: site:clien.net 분실물 확인 찾기
  if (withoutQuotes && withoutQuotes !== original) {
    variants.push(withoutQuotes)
  }

  // 3차: site + 핵심 키워드 1개만 사용
  // 예: site:clien.net 분실물
  if (sitePrefix && quotedTerms.length >= 1) {
    variants.push(`${sitePrefix} ${quotedTerms[0]}`)
  }

  // 따옴표 키워드가 없을 때 대비
  if (siteDomain && variants.length < 3) {
    const noSite = stripQuotes(stripSiteOperator(original))
    const firstWord = noSite.split(/\s+/).filter(Boolean)[0]

    if (firstWord) {
      variants.push(`site:${siteDomain} ${firstWord}`)
    }
  }

  // 최대 3개까지만 반환해서 Brave API 비용 제한
  return Array.from(new Set(variants.map(normalizeSpace).filter(Boolean))).slice(0, 3)
}

function normalizeBraveResults(results = [], siteDomain = '', limit = 20) {
  const seen = new Set()
  const output = []

  for (const item of results || []) {
    const url = item.url || item.link || ''

    if (!url) continue
    if (seen.has(url)) continue
    if (!isTargetDomain(url, siteDomain)) continue

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

async function braveSearch(query, { limit = 20, siteDomain = '', offset = 0 } = {}) {
  const apiKey = getBraveApiKey()

  if (!apiKey) {
    return {
      ok: false,
      query,
      status: 500,
      error: 'BRAVE_SEARCH_API_KEY가 설정되어 있지 않습니다.',
      results: [],
      raw_count: 0,
    }
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(Math.max(Number(limit || 20), 1), 20)),
    offset: String(Math.max(Number(offset || 0), 0)),
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
      query,
      offset,
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
  const normalized = normalizeBraveResults(webResults, siteDomain, limit)

  return {
    ok: true,
    query,
    offset,
    status: res.status,
    error: null,
    results: normalized,
    raw_count: webResults.length,
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

  // 현재 DB 스키마 기준: source_url 컬럼 사용
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

  // 저장 실패해도 화면에는 URL 후보를 보여줘야 하므로 에러만 반환
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

    const siteDomain = extractSiteDomain(query)
    const queryVariants = buildBraveQueryVariants(query)

    const supabase = getSupabaseAdmin()

    // 본문 수집까지 완료되어 results 테이블에 저장된 URL만 제외한다.
    // URL 후보로만 뜬 링크는 다시 나올 수 있다.
    const excludeUrls = await loadCrawledResultUrls(supabase)

    const collected = []
    const search_logs = []

    let requestCount = 0
const maxRequests = 3

const originalQuery = queryVariants[0]
const relaxedQuery = queryVariants[1] || queryVariants[0]
const coreQuery = queryVariants[2] || queryVariants[1] || queryVariants[0]

const searchPlans = [
  // 1회차: 원본 쿼리
  { query: originalQuery, offset: 0, mode: 'original' },

  // 2회차: 따옴표 제거 완화 쿼리
  { query: relaxedQuery, offset: 0, mode: 'relaxed' },

  // 3회차: Brave API는 offset 최대값이 9라서 20을 넣으면 422 오류가 난다.
  // 따라서 가능한 최대 offset인 9로 뒤쪽 후보를 한 번 더 확인한다.
  { query: relaxedQuery || coreQuery, offset: 9, mode: 'relaxed_offset_9' },
]

for (const plan of searchPlans) {
  if (requestCount >= maxRequests) break
  if (collected.length >= limit) break
  if (!plan.query) continue

  const result = await braveSearch(plan.query, {
    limit,
    siteDomain,
    offset: plan.offset,
  })

  requestCount += 1

  let addedCount = 0
  let skippedCrawledCount = 0
  let skippedDuplicateCount = 0

  for (const item of result.results) {
    const itemUrl = item.url || item.source_url || ''

    if (!itemUrl) continue

    if (excludeUrls.has(itemUrl)) {
      skippedCrawledCount += 1
      continue
    }

    if (collected.some((existing) => existing.url === itemUrl)) {
      skippedDuplicateCount += 1
      continue
    }

    collected.push({
      ...item,
      url: itemUrl,
      source_url: itemUrl,
      matched_query: plan.query,
      matched_offset: plan.offset,
      matched_mode: plan.mode,
    })

    addedCount += 1

    if (collected.length >= limit) break
  }

  search_logs.push({
    query: plan.query,
    offset: plan.offset,
    mode: plan.mode,
    ok: result.ok,
    status: result.status,
    error: result.error,
    raw_count: result.raw_count || 0,
    result_count: result.results.length,
    added_count: addedCount,
    skipped_crawled_count: skippedCrawledCount,
    skipped_duplicate_count: skippedDuplicateCount,
    excluded_count: excludeUrls.size,
  })

  if (collected.length >= limit) break
}

    const urls = collected.slice(0, limit)

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
      request_count: requestCount,
      excluded_url_count: excludeUrls.size,
      query,
      site_domain: siteDomain,
      tried_queries: queryVariants,
      search_logs,
      urls,
      candidates: urls,
      results: urls,
      count: urls.length,
      saved_count: saveResult.saved_count,
      save_error: saveResult.error,
      message:
        urls.length > 0
          ? `Brave URL 후보 ${urls.length}개를 불러왔습니다.`
          : 'Brave URL 후보 0개입니다. 원본 쿼리와 비용 절약형 완화 쿼리까지 시도했지만 새 후보가 없습니다.',
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