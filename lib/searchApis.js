import axios from 'axios'

function stripHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, '').trim()
}

function getGoogleApiKey() {
  return process.env.GOOGLE_API_KEY || process.env.GOOGLE_SEARCH_API_KEY || ''
}

function getGoogleCx() {
  return process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CX || ''
}

function compactText(value = '') {
  return String(value).replace(/"/g, '').replace(/\s+/g, ' ').trim()
}

function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ── 네이버 검색 ───────────────────────────────────────────────
export async function searchNaver(keyword) {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    console.warn('[searchNaver] NAVER 키 없음, 건너뜁니다.')
    return []
  }

  const headers = {
    'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
    'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
  }

  const [blogRes, webRes] = await Promise.allSettled([
    axios.get('https://openapi.naver.com/v1/search/blog.json', {
      headers,
      params: { query: keyword, display: 5, sort: 'sim' },
    }),
    axios.get('https://openapi.naver.com/v1/search/webkr.json', {
      headers,
      params: { query: keyword, display: 5, sort: 'sim' },
    }),
  ])

  const results = []

  if (blogRes.status === 'fulfilled') {
    ;(blogRes.value.data.items || []).forEach((item) => {
      results.push({
        site: 'naver_blog',
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        url: item.link,
        thumbnail: '',
      })
    })
  }

  if (webRes.status === 'fulfilled') {
    ;(webRes.value.data.items || []).forEach((item) => {
      results.push({
        site: 'naver_web',
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        url: item.link,
        thumbnail: '',
      })
    })
  }

  return results
}

// ── Google 검색: 단일 쿼리 ───────────────────────────────────
async function searchGoogleSingle(query) {
  const apiKey = getGoogleApiKey()
  const cx = getGoogleCx()

  if (!apiKey) {
    return {
      ok: false,
      error: 'GOOGLE_API_KEY_MISSING',
      detail: 'GOOGLE_API_KEY 또는 GOOGLE_SEARCH_API_KEY 환경변수가 없습니다.',
      items: [],
      fatal: true,
    }
  }

  if (!cx) {
    return {
      ok: false,
      error: 'GOOGLE_CX_MISSING',
      detail: 'GOOGLE_SEARCH_ENGINE_ID 환경변수가 없습니다.',
      items: [],
      fatal: true,
    }
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('cx', cx)
  url.searchParams.set('q', query)
  url.searchParams.set('num', '5')
  url.searchParams.set('hl', 'ko')
  url.searchParams.set('gl', 'kr')

  console.log('[searchGoogle] 요청:', {
    q: query,
    keyExists: !!apiKey,
    cxExists: !!cx,
  })

  try {
    const res = await fetch(url.toString())
    const text = await res.text()

    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text.slice(0, 500) }
    }

    console.log('[searchGoogle] 응답 status:', res.status)

    if (res.status === 429) {
      return {
        ok: false,
        error: 'GOOGLE_API_429',
        detail: data?.error?.message || '할당량 초과',
        items: [],
        fatal: true,
      }
    }

    if (res.status === 403) {
      return {
        ok: false,
        error: 'GOOGLE_API_403',
        detail: data?.error?.message || JSON.stringify(data).slice(0, 300),
        items: [],
        fatal: true,
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        error: 'GOOGLE_API_ERROR',
        detail: data?.error?.message || `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
        items: [],
        fatal: false,
      }
    }

    const rawItems = Array.isArray(data.items) ? data.items : []
    console.log('[searchGoogle] 응답 items 수:', rawItems.length)

    if (rawItems.length === 0) {
      return {
        ok: false,
        error: 'SEARCH_EMPTY_RESULT',
        detail: JSON.stringify(data).slice(0, 300),
        items: [],
        fatal: false,
      }
    }

    const items = rawItems
      .map((item) => ({
        site: domainFromUrl(item.link),
        title: item.title || '',
        description: item.snippet || '',
        url: item.link || '',
        thumbnail: item.pagemap?.cse_image?.[0]?.src || '',
      }))
      .filter((item) => item.url)

    console.log('[searchGoogle] 수집된 URL들:', items.map((i) => i.url))

    return { ok: true, error: null, detail: '', items, fatal: false }
  } catch (e) {
    console.error('[searchGoogle] fetch 예외:', e.message)
    return {
      ok: false,
      error: 'GOOGLE_API_ERROR',
      detail: e.message,
      items: [],
      fatal: false,
    }
  }
}

// ── Google 검색: fallback 포함 ───────────────────────────────
export async function searchGoogle(originalQuery) {
  const fallbackQueries = generateFallbackQueries(originalQuery)
  const allQueries = [originalQuery, ...fallbackQueries]

  const triedQueries = []
  let lastResult = null

  for (const query of allQueries) {
    triedQueries.push(query)
    console.log(`[searchGoogle] 시도: "${query}"`)

    const result = await searchGoogleSingle(query)
    lastResult = result

    if (result.ok && result.items.length > 0) {
      return {
        ok: true,
        items: result.items,
        tried_queries: triedQueries,
        matched_query: query,
        google_status: 'success',
        google_error_detail: '',
        fatal: false,
      }
    }

    console.warn(`[searchGoogle] 실패: "${query}" → ${result.error}`)

    // 429, 403, 키 누락은 fallback을 돌리면 할당량/오류만 더 낭비합니다.
    if (result.fatal) {
      break
    }

    await sleep(250)
  }

  return {
    ok: false,
    items: [],
    tried_queries: triedQueries,
    matched_query: null,
    google_status: lastResult?.error || 'SEARCH_EMPTY_RESULT',
    google_error_detail: lastResult?.detail || '',
    fatal: !!lastResult?.fatal,
  }
}

function generateFallbackQueries(originalQuery) {
  const fallbacks = []
  const siteMatch = originalQuery.match(/site:[^\s]+/)
  const site = siteMatch ? siteMatch[0] : ''

  const quotedWords = [...originalQuery.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  const plain = compactText(originalQuery.replace(/site:[^\s]+/g, ''))
  const keywords = [...quotedWords.join(' ').split(/\s+/), ...plain.split(/\s+/)]
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !w.startsWith('site:'))

  const unique = [...new Set(keywords)].slice(0, 5)
  const primary = unique[0] || '분실물'

  if (site) {
    if (unique.length > 0) fallbacks.push(`${site} ${unique.slice(0, 3).join(' ')}`)
    fallbacks.push(`${site} ${primary}`)

    const domainLabel = site.includes('daangn')
      ? '당근'
      : site.includes('joongna')
        ? '중고나라'
        : site.includes('bunjang')
          ? '번개장터'
          : site.includes('cafe.naver')
            ? '네이버 카페'
            : ''

    if (domainLabel) fallbacks.push(`${domainLabel} ${primary}`)
  } else {
    const noQuotes = compactText(originalQuery)
    if (noQuotes && noQuotes !== originalQuery) fallbacks.push(noQuotes)
    if (primary) fallbacks.push(primary)
  }

  return [...new Set(fallbacks)].filter(Boolean)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
