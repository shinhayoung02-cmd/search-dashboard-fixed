const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

const MOBILE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

export async function crawlPage(url) {
  let domain = ''
  try {
    domain = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return fail(url, '', '잘못된 URL')
  }

  let html = ''
  try {
    const fetched = await fetchHtml(url, HEADERS)
    if (fetched.status === 403 || fetched.status === 401 || fetched.status === 429) {
      return fail(url, domain, '접근차단', 'blocked')
    }
    if (!fetched.ok) return fail(url, domain, `HTTP ${fetched.status}`)
    html = fetched.html
  } catch (e) {
    return fail(url, domain, e.message)
  }

  if (!html || html.length < 100) return fail(url, domain, '빈 페이지', 'empty')

  if (domain.includes('cafe.naver.com')) return await parseNaverCafe(url, domain, html)
  if (domain.includes('daangn')) return parseDaangn(url, domain, html)
  if (domain.includes('joongna')) return parseJoongna(url, domain, html)
  if (domain.includes('bunjang')) return parseBunjang(url, domain, html)
  return parseOpenGraph(url, domain, html)
}

async function fetchHtml(url, headers = HEADERS) {
  const res = await fetch(url, { headers, redirect: 'follow' })
  const buffer = await res.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  let html = decodeBytes(bytes, 'utf-8')

  // 네이버 카페 일부 페이지에서 한글이 깨지는 경우가 있어 euc-kr도 시도합니다.
  if (hasBrokenKorean(html)) {
    const alt = decodeBytes(bytes, 'euc-kr')
    if (!hasBrokenKorean(alt) || alt.length > html.length) html = alt
  }

  return { ok: res.ok, status: res.status, html }
}

function decodeBytes(bytes, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

function hasBrokenKorean(text = '') {
  return /�{2,}|����|Ã|Â/.test(String(text))
}

/* =========================
   날짜 추출 유틸
   ========================= */

function toIsoDate(date) {
  if (!date || Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function normalizeAbsoluteDate(rawValue = '') {
  const raw = String(rawValue).trim()

  // 2026-01-15 / 2026.01.15 / 2026. 1. 15
  const dashOrDot = raw.match(/\d{4}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}/)?.[0]
  if (dashOrDot) {
    const parts = dashOrDot
      .replace(/\s/g, '')
      .replace(/\./g, '-')
      .split('-')
      .filter(Boolean)

    if (parts.length >= 3) {
      const y = parts[0]
      const m = parts[1].padStart(2, '0')
      const d = parts[2].padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  }

  // 2026년 1월 15일
  const korean = raw.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  if (korean) {
    const y = korean[1]
    const m = korean[2].padStart(2, '0')
    const d = korean[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return null
}

function resolveRelativeKoreanDate(rawText) {
  if (!rawText) return null

  const text = String(rawText).trim()
  const now = new Date()

  const match = text.match(/(\d+)\s*(분|시간|일|주|개월|달|년)\s*전/)
  if (!match) return null

  const amount = Number(match[1])
  const unit = match[2]

  const d = new Date(now)

  if (unit === '분') d.setMinutes(d.getMinutes() - amount)
  if (unit === '시간') d.setHours(d.getHours() - amount)
  if (unit === '일') d.setDate(d.getDate() - amount)
  if (unit === '주') d.setDate(d.getDate() - amount * 7)
  if (unit === '개월' || unit === '달') d.setMonth(d.getMonth() - amount)
  if (unit === '년') d.setFullYear(d.getFullYear() - amount)

  return toIsoDate(d)
}

function extractRawDateFromText(text = '') {
  const raw = String(text)

  return (
    raw.match(/\d{4}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}/)?.[0] ||
    raw.match(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/)?.[0] ||
    raw.match(/(\d+)\s*(분|시간|일|주|개월|달|년)\s*전/)?.[0] ||
    raw.match(/방금\s*전/)?.[0] ||
    raw.match(/어제/)?.[0] ||
    ''
  )
}

function extractDateFromText(text = '') {
  const raw = String(text)

  const absoluteRaw =
    raw.match(/\d{4}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}/)?.[0] ||
    raw.match(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/)?.[0] ||
    ''

  if (absoluteRaw) {
    return normalizeAbsoluteDate(absoluteRaw)
  }

  const relativeRaw =
    raw.match(/(\d+)\s*(분|시간|일|주|개월|달|년)\s*전/)?.[0] ||
    ''

  if (relativeRaw) {
    return resolveRelativeKoreanDate(relativeRaw)
  }

  if (raw.includes('방금 전')) {
    return toIsoDate(new Date())
  }

  if (raw.includes('어제')) {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return toIsoDate(d)
  }

  return null
}

function extractDateFromKnownFields(fields = []) {
  const joined = fields
    .filter(Boolean)
    .map((v) => String(v))
    .join(' ')

  const rawDate = extractRawDateFromText(joined)
  const date = extractDateFromText(joined)

  return {
    published_at: date,
    post_date: date,
    article_date: date,
    published_at_raw: rawDate || null,
  }
}

function extractPublishedDate(html = '', text = '', knownFields = []) {
  const known = extractDateFromKnownFields(knownFields)

  if (known.published_at) {
    return known
  }

  const target = `${html || ''} ${text || ''}`

  const rawDate = extractRawDateFromText(target)
  const date = extractDateFromText(target)

  return {
    published_at: date,
    post_date: date,
    article_date: date,
    published_at_raw: rawDate || null,
  }
}

function withDateFields(result, html = '', extraText = '', knownFields = []) {
  const dateInfo = extractPublishedDate(
    html,
    `${result?.title || ''} ${result?.body || ''} ${result?.snippet || ''} ${extraText || ''}`,
    knownFields
  )

  return {
    ...result,
    published_at: result.published_at || dateInfo.published_at || null,
    post_date: result.post_date || dateInfo.post_date || null,
    article_date: result.article_date || dateInfo.article_date || null,
    published_at_raw: result.published_at_raw || dateInfo.published_at_raw || null,
  }
}

/* =========================
   채널별 파서
   ========================= */

function parseDaangn(url, domain, html) {
  const next = extractNextData(html)

  if (next) {
    const p = next?.props?.pageProps
    const post =
      p?.post || p?.article || p?.communityPost || p?.articleInfo?.article

    if (post) {
      const body = post.content || post.text || post.body || ''
      const title = post.title || post.subject || extractOgTitle(html)

      const knownDateFields = [
        post.createdAt,
        post.created_at,
        post.updatedAt,
        post.updated_at,
        post.publishedAt,
        post.published_at,
        post.date,
        post.createdDate,
        post.created_date,
        post.timeAgo,
        post.time_ago,
      ]

      if (body.length > 10) {
        return withDateFields(
          {
            url,
            domain,
            title,
            body,
            snippet: body.slice(0, 200),
            location: post.region?.name || post.regionName || null,
            author: post.user?.nickname || post.writer?.nickname || null,
            image_url: extractOgImage(html),
            crawl_status: 'success',
          },
          html,
          `${title} ${body}`,
          knownDateFields
        )
      }
    }

    const item = p?.item || p?.product

    if (item) {
      const body = item.body || item.content || item.description || ''
      const title = item.title || extractOgTitle(html)

      const knownDateFields = [
        item.createdAt,
        item.created_at,
        item.updatedAt,
        item.updated_at,
        item.publishedAt,
        item.published_at,
        item.date,
        item.createdDate,
        item.created_date,
        item.timeAgo,
        item.time_ago,
      ]

      return withDateFields(
        {
          url,
          domain,
          title,
          body,
          snippet: body.slice(0, 200),
          location: item.region?.name || null,
          author: item.user?.nickname || null,
          image_url: item.images?.[0]?.url || extractOgImage(html),
          crawl_status: body.length > 10 ? 'success' : 'empty',
        },
        html,
        `${title} ${body}`,
        knownDateFields
      )
    }
  }

  return parseOpenGraph(url, domain, html)
}

async function parseNaverCafe(url, domain, html) {
  const og = parseOpenGraph(url, domain, html)
  const articleId = extractNaverArticleId(url, html)
  const clubId = extractNaverClubId(html)
  const clubName = extractNaverClubName(url, html)

  // PC HTML 안에 본문이 바로 있으면 먼저 사용합니다.
  const directBody = extractNaverCafeBody(html)
  if (directBody && directBody.length > 30 && !isNaverBlockedText(directBody)) {
    const title = cleanText(extractNaverTitle(html) || og.title)

    return withDateFields(
      {
        ...og,
        title,
        body: directBody,
        snippet: directBody.slice(0, 200),
        author: extractNaverCafeAuthor(html),
        crawl_status: 'success',
        fail_reason: null,
      },
      html,
      `${title} ${directBody}`
    )
  }

  // clubId/articleId를 얻으면 모바일/웹뷰 URL을 순차 시도합니다.
  const candidateUrls = buildNaverCafeCandidateUrls({ clubId, articleId, clubName })

  for (const candidateUrl of candidateUrls) {
    try {
      const fetched = await fetchHtml(candidateUrl, MOBILE_HEADERS)
      if (!fetched.ok) continue

      const candidateHtml = fetched.html
      const title = cleanText(extractNaverTitle(candidateHtml) || extractOgTitle(candidateHtml) || og.title)
      const body = extractNaverCafeBody(candidateHtml)
      const author = extractNaverCafeAuthor(candidateHtml)
      const image = extractOgImage(candidateHtml) || og.image_url

      if (body && body.length > 30 && !isNaverBlockedText(body)) {
        return withDateFields(
          {
            url,
            domain,
            title: title || og.title,
            body,
            snippet: body.slice(0, 200),
            location: null,
            author,
            image_url: image,
            crawl_status: 'success',
            source_url: candidateUrl,
            fail_reason: null,
          },
          candidateHtml,
          `${title} ${body}`
        )
      }
    } catch {
      // 다음 후보 URL을 계속 시도합니다.
    }
  }

  // 여기까지 실패하면 서버에서 본문 접근이 제한된 것으로 보고 검색결과/OG 기반으로 저장합니다.
  const fallbackBody = cleanText(og.body || extractOgDescription(html) || '')
  const blocked = isNaverBlockedPage(html) || !fallbackBody
  const title = cleanText(extractNaverTitle(html) || og.title || '네이버 카페')

  return withDateFields(
    {
      url,
      domain,
      title,
      body: fallbackBody,
      snippet: fallbackBody.slice(0, 200),
      location: null,
      author: extractNaverCafeAuthor(html),
      image_url: og.image_url,
      crawl_status: blocked ? 'blocked' : 'search_only',
      fail_reason: '네이버 카페 본문 자동 수집 제한. 검색 결과/메타 정보 기반으로 표시합니다.',
    },
    html,
    `${title} ${fallbackBody}`
  )
}

function buildNaverCafeCandidateUrls({ clubId, articleId, clubName }) {
  const urls = []

  if (clubId && articleId) {
    urls.push(`https://m.cafe.naver.com/ca-fe/web/cafes/${clubId}/articles/${articleId}`)
    urls.push(`https://m.cafe.naver.com/ArticleRead.nhn?clubid=${clubId}&articleid=${articleId}`)
    urls.push(`https://cafe.naver.com/ArticleRead.nhn?clubid=${clubId}&articleid=${articleId}`)
  }

  if (clubName && articleId) {
    urls.push(`https://m.cafe.naver.com/${clubName}/${articleId}`)
    urls.push(`https://cafe.naver.com/${clubName}/${articleId}`)
  }

  return [...new Set(urls)]
}

function extractNaverArticleId(url, html) {
  try {
    const u = new URL(url)
    const fromQuery =
      u.searchParams.get('articleid') ||
      u.searchParams.get('articleId') ||
      u.searchParams.get('articleIdNo')
    if (fromQuery) return fromQuery

    const pathMatch = u.pathname.match(/\/(\d+)(?:\/?|$)/)
    if (pathMatch) return pathMatch[1]
  } catch {}

  return (
    html.match(/articleid["'\s:=]+(\d+)/i)?.[1] ||
    html.match(/articleId["'\s:=]+(\d+)/i)?.[1] ||
    html.match(/"articleId"\s*:\s*"?(\d+)/i)?.[1] ||
    html.match(/articleIdNo["'\s:=]+(\d+)/i)?.[1] ||
    ''
  )
}

function extractNaverClubId(html) {
  return (
    html.match(/clubid["'\s:=]+(\d+)/i)?.[1] ||
    html.match(/clubId["'\s:=]+(\d+)/i)?.[1] ||
    html.match(/"clubId"\s*:\s*"?(\d+)/i)?.[1] ||
    html.match(/cafeId["'\s:=]+(\d+)/i)?.[1] ||
    html.match(/CafeId["'\s:=]+(\d+)/i)?.[1] ||
    ''
  )
}

function extractNaverClubName(url, html) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] && !['ArticleRead.nhn', 'ca-fe'].includes(parts[0]) && !/^\d+$/.test(parts[0])) {
      return parts[0]
    }
  } catch {}

  return (
    html.match(/cluburl["'\s:=]+["']?([a-zA-Z0-9_-]+)/i)?.[1] ||
    html.match(/clubUrl["'\s:=]+["']?([a-zA-Z0-9_-]+)/i)?.[1] ||
    ''
  )
}

function extractNaverTitle(html) {
  const candidates = [
    extractJsonString(html, 'subject'),
    extractJsonString(html, 'articleTitle'),
    extractJsonString(html, 'title'),
    extractOgTitle(html),
    html.match(/<h3[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1],
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  ]

  return cleanText(candidates.find(Boolean) || '')
}

function extractNaverCafeBody(html) {
  const jsonBody =
    extractJsonString(html, 'content') ||
    extractJsonString(html, 'contents') ||
    extractJsonString(html, 'articleBody') ||
    extractJsonString(html, 'articleContent')

  if (jsonBody && cleanText(jsonBody).length > 30) {
    return cleanText(jsonBody)
  }

  const candidates = [
    /<div[^>]+class=["'][^"']*se-main-container[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<div[^>]+id=["']postContent["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*article_viewer[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*ContentRenderer[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*ArticleContentBox[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*se_component_wrap[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]

  for (const pattern of candidates) {
    const match = html.match(pattern)
    if (match?.[1]) {
      const text = cleanText(match[1])
      if (text.length > 30 && !isNaverBlockedText(text)) return text
    }
  }

  const ogDesc = cleanText(extractOgDescription(html))
  if (ogDesc.length > 30 && !isNaverBlockedText(ogDesc)) return ogDesc

  return ''
}

function extractNaverCafeAuthor(html) {
  return (
    cleanText(extractJsonString(html, 'nickname') || '') ||
    cleanText(extractJsonString(html, 'writerNickname') || '') ||
    cleanText(html.match(/<span[^>]+class=["'][^"']*nickname[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') ||
    null
  )
}

function isNaverBlockedPage(html = '') {
  const text = cleanText(html)
  return isNaverBlockedText(text)
}

function isNaverBlockedText(text = '') {
  const value = cleanText(text)

  return (
    value.includes('로그인이 필요') ||
    value.includes('카페 회원만') ||
    value.includes('멤버에게만') ||
    value.includes('접근할 수 없습니다') ||
    value.includes('삭제되었거나') ||
    value.includes('등급 이상') ||
    value.includes('권한이 없습니다') ||
    value.includes('본문을 불러오는 중') ||
    value.length < 20
  )
}

function extractJsonString(html, key) {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, 'i'),
    new RegExp(`'${key}'\\s*:\\s*'((?:\\\\.|[^'])*)'`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      try {
        return JSON.parse(`"${match[1]}"`)
      } catch {
        return match[1]
      }
    }
  }

  return ''
}

function parseJoongna(url, domain, html) {
  const next = extractNextData(html)
  const og = parseOpenGraph(url, domain, html)

  if (next) {
    const item =
      next?.props?.pageProps?.article ||
      next?.props?.pageProps?.product ||
      next?.props?.pageProps?.post

    if (item) {
      const body = item.contents || item.content || item.body || ''
      const title = item.title || og.title

      const knownDateFields = [
        item.createdAt,
        item.created_at,
        item.updatedAt,
        item.updated_at,
        item.publishedAt,
        item.published_at,
        item.date,
        item.createdDate,
        item.created_date,
        item.timeAgo,
        item.time_ago,
      ]

      return withDateFields(
        {
          ...og,
          title,
          body,
          snippet: body.slice(0, 200),
          location: item.location || null,
          author: item.userNickname || null,
          crawl_status: body.length > 10 ? 'success' : og.crawl_status,
        },
        html,
        `${title} ${body}`,
        knownDateFields
      )
    }
  }

  return og
}

function parseBunjang(url, domain, html) {
  const next = extractNextData(html)
  const og = parseOpenGraph(url, domain, html)

  if (next) {
    const item =
      next?.props?.pageProps?.product || next?.props?.pageProps?.item

    if (item) {
      const body = item.description || ''
      const title = item.name || og.title

      const knownDateFields = [
        item.createdAt,
        item.created_at,
        item.updatedAt,
        item.updated_at,
        item.publishedAt,
        item.published_at,
        item.date,
        item.createdDate,
        item.created_date,
        item.timeAgo,
        item.time_ago,
      ]

      return withDateFields(
        {
          ...og,
          title,
          body,
          snippet: body.slice(0, 200),
          crawl_status: body.length > 10 ? 'success' : og.crawl_status,
        },
        html,
        `${title} ${body}`,
        knownDateFields
      )
    }
  }

  return og
}

function parseOpenGraph(url, domain, html) {
  const title = cleanText(extractOgTitle(html))
  const description = cleanText(extractOgDescription(html))
  const image_url = extractOgImage(html)

  return withDateFields(
    {
      url,
      domain,
      title,
      body: description,
      snippet: description.slice(0, 200),
      location: null,
      author: null,
      image_url,
      crawl_status: description.length > 20 ? 'success' : 'empty',
    },
    html,
    `${title} ${description}`
  )
}

/* =========================
   공통 추출 유틸
   ========================= */

function extractNextData(html) {
  const m = html.match(
    /<script\s+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  )

  if (!m) return null

  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

function extractOgTitle(html) {
  return (
    matchMeta(html, 'property', 'og:title') ||
    matchMeta(html, 'name', 'og:title') ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
    ''
  ).trim()
}

function extractOgDescription(html) {
  return (
    matchMeta(html, 'property', 'og:description') ||
    matchMeta(html, 'name', 'description') ||
    matchMeta(html, 'property', 'description') ||
    ''
  ).trim()
}

function extractOgImage(html) {
  return (
    matchMeta(html, 'property', 'og:image') ||
    matchMeta(html, 'name', 'og:image') ||
    ''
  ).trim()
}

function matchMeta(html, attr, value) {
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escapeRegExp(value)}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${escapeRegExp(value)}["'][^>]*>`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return decodeHtml(match[1])
  }

  return ''
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtml(text = '') {
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function cleanText(value = '') {
  return decodeHtml(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function fail(url, domain, reason, status = 'failed') {
  return {
    url,
    domain,
    title: '',
    body: '',
    snippet: '',
    location: null,
    author: null,
    image_url: '',
    crawl_status: status,
    fail_reason: reason,

    published_at: null,
    post_date: null,
    article_date: null,
    published_at_raw: null,
  }
}