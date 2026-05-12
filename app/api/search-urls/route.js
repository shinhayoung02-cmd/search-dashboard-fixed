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
  const withoutQuotes = stripQuotes(original)

  const variants = []

  // 1차: 원본 쿼리
  // 예: site:clien.net "분실물" "확인" "찾기"
  if (original) variants.push(original)

  // 2차: 따옴표 제거
  // 예: site:clien.net 분실물 확인 찾기
  if (withoutQuotes && withoutQuotes !== original) {
    variants.push(withoutQuotes)
  }

  // 여기서 site:clien.net 분실물 같은 과도한 핵심어 fallback은 일부러 만들지 않음.
  // 너무 넓어져서 분실물과 상관없는 결과가 섞이는 원인이 됨.

  return Array.from(new Set(variants.map(normalizeSpace).filter(Boolean))).slice(0, 2)
}

function getQueryTerms(query = '') {
  const quoted = extractQuotedTerms(query)

  const stripped = stripQuotes(stripSiteOperator(query))
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  return Array.from(new Set([...quoted, ...stripped]))
}

function hasLostItemIntent(text = '') {
  const value = String(text || '').toLowerCase()

  const lostItemTerms = [
    '분실물',
    '유실물',
    '분실',
    '습득',
    '잃어버',
    '잃어 버',
    '두고 내',
    '두고내',
    '주웠',
    '찾아가',
    '찾아주세요',
    '보관중',
    '분실신고',
    '유실물 신고',
    '유실물센터',
    '분실물센터',
    'lost112',
  ]

  return lostItemTerms.some((term) => value.includes(term.toLowerCase()))
}

function isWeakSearchTerm(term = '') {
  const value = String(term || '').toLowerCase().trim()

  const weakTerms = new Set([
    '',
    'site',
    'clien.net',
    'daangn.com',
    'cafe.naver.com',
    'www.clien.net',
    '확인',
    '찾기',
    '검색',
    '조회',
    '정보',
    '상태',
    '방법',
    '게시글',
    '관련',
    '글',
    '내용',
  ])

  return weakTerms.has(value)
}

function isGenericLostTerm(term = '') {
  const value = String(term || '').toLowerCase().trim()

  const genericLostTerms = new Set([
    '분실물',
    '유실물',
    '분실',
    '습득',
  ])

  return genericLostTerms.has(value)
}

function isRelevantCandidate(item = {}, originalQuery = '') {
  const title = item.title || ''
  const snippet = item.snippet || item.description || ''

  // URL은 관련성 판단에서 제외.
  // 도메인이나 URL 경로 때문에 관련 있어 보이는 문제를 막기 위함.
  const text = `${title} ${snippet}`.toLowerCase()

  // 1. 제목/스니펫에 분실물 관련 의도가 있으면 통과
  // 예: 분실물, 유실물, 분실, 습득, 잃어버림, 두고 내림 등
  if (hasLostItemIntent(text)) {
    return true
  }

  // 2. Brave 스니펫이 너무 짧게 들어오는 경우를 대비한 보조 판정
  // 쿼리 자체가 분실물 계열이고, 결과 제목/스니펫에 찾기/확인/신고/보관 같은 행동어가 있으면 통과
  const queryHasLostIntent = hasLostItemIntent(originalQuery)

  if (!queryHasLostIntent) {
    return false
  }

  const supportTerms = [
    '찾기',
    '찾는',
    '찾아',
    '확인',
    '신고',
    '접수',
    '보관',
    '주웠',
    '주운',
    '찾아가',
    '연락',
    '분실센터',
    '유실물센터',
    'lost112',
  ]

  return supportTerms.some((term) => text.includes(term.toLowerCase()))
}

function normalizeBraveResults(results = [], siteDomain = '', limit = 20, originalQuery = '') {
  const seen = new Set()
  const output = []
  let irrelevantCount = 0

  for (const item of results || []) {
    const url = item.url || item.link || ''

    if (!url) continue
    if (seen.has(url)) continue
    if (!isTargetDomain(url, siteDomain)) continue

    const normalizedItem = {
      title: item.title || url,
      url,
      source_url: url,
      snippet: item.description || item.snippet || '',
      description: item.description || item.snippet || '',
      display_link: item.profile?.long_name || domainFromUrl(url),
      source: domainFromUrl(url),
      provider: 'brave',
    }

    if (!isRelevantCandidate(normalizedItem, originalQuery)) {
      irrelevantCount += 1
      continue
    }

    seen.add(url)
    output.push(normalizedItem)

    if (output.length >= limit) break
  }

  return {
    results: output,
    irrelevant_count: irrelevantCount,
  }
}

async function braveSearch(query, { limit = 10, siteDomain = '', offset = 0, originalQuery = '' } = {}) {
  const apiKey = getBraveApiKey()

  if (!apiKey) {
    return {
      ok: false,
      query,
      offset,
      count: limit,
      status: 500,
      error: 'BRAVE_SEARCH_API_KEY가 설정되어 있지 않습니다.',
      results: [],
      raw_count: 0,
      irrelevant_count: 0,
    }
  }

  // count를 20/10/5로 흔들지 않고 10으로 고정.
  // Brave 결과가 흔들리는 걸 줄이고, 무관 결과가 섞이는 것을 방지한다.
  const safeCount = 10

  // Brave API offset은 최대 9까지만 허용.
  const safeOffset = Math.min(Math.max(Number(offset || 0), 0), 9)

  const params = new URLSearchParams({
    q: query,
    count: String(safeCount),
    offset: String(safeOffset),
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
      offset: safeOffset,
      count: safeCount,
      status: res.status,
      error:
        data?.error?.message ||
        data?.message ||
        text ||
        `Brave API 오류: ${res.status}`,
      results: [],
      raw_count: 0,
      irrelevant_count: 0,
      raw: data,
    }
  }

  const webResults = data?.web?.results || []
  const normalized = normalizeBraveResults(
    webResults,
    siteDomain,
    safeCount,
    originalQuery || query
  )

  return {
    ok: true,
    query,
    offset: safeOffset,
    count: safeCount,
    status: res.status,
    error: null,
    results: normalized.results,
    raw_count: webResults.length,
    irrelevant_count: normalized.irrelevant_count,
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

    // 최종 화면에 표시할 후보 수.
    // Brave 요청 count는 braveSearch() 내부에서 10으로 고정한다.
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

    const searchPlans = [
      {
        query: originalQuery,
        offset: 0,
        mode: 'original_count_10',
      },
      {
        query: relaxedQuery,
        offset: 0,
        mode: 'relaxed_count_10',
      },
      {
        // 같은 완화 쿼리의 뒤쪽 결과를 한 번 더 본다.
        // offset은 Brave 제한 때문에 9까지만 사용.
        query: relaxedQuery,
        offset: 9,
        mode: 'relaxed_offset_9_count_10',
      },
    ]

    const seenPlanKeys = new Set()

    for (const plan of searchPlans) {
      if (requestCount >= maxRequests) break
      if (collected.length >= limit) break
      if (!plan.query) continue

      const planKey = `${plan.query}|${plan.offset}`
      if (seenPlanKeys.has(planKey)) continue
      seenPlanKeys.add(planKey)

      const result = await braveSearch(plan.query, {
        limit: 10,
        siteDomain,
        offset: plan.offset,
        originalQuery: query,
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
        request_count_value: result.count,
        ok: result.ok,
        status: result.status,
        error: result.error,
        raw_count: result.raw_count || 0,
        result_count: result.results.length,
        added_count: addedCount,
        skipped_crawled_count: skippedCrawledCount,
        skipped_duplicate_count: skippedDuplicateCount,
        skipped_irrelevant_count: result.irrelevant_count || 0,
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
          candidate_error: urls.length > 0 ? null : 'NO_NEW_RELEVANT_BRAVE_RESULTS',
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
          : '새로운 관련 Brave URL 후보가 없습니다. 이미 수집된 URL이거나 분실물 관련성이 낮은 결과는 제외했습니다.',
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