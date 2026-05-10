const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
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
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' })
    if (res.status === 403 || res.status === 429) return fail(url, domain, '접근차단')
    if (!res.ok) return fail(url, domain, `HTTP ${res.status}`)
    html = await res.text()
  } catch (e) {
    return fail(url, domain, e.message)
  }

  if (!html || html.length < 100) return fail(url, domain, '빈 페이지')

  if (domain.includes('daangn')) return parseDaangn(url, domain, html)
  if (domain.includes('joongna')) return parseJoongna(url, domain, html)
  if (domain.includes('bunjang')) return parseBunjang(url, domain, html)
  return parseOpenGraph(url, domain, html)
}

function parseDaangn(url, domain, html) {
  const next = extractNextData(html)
  if (next) {
    const p = next?.props?.pageProps
    const post =
      p?.post || p?.article || p?.communityPost || p?.articleInfo?.article
    if (post) {
      const body = post.content || post.text || post.body || ''
      if (body.length > 10) {
        return {
          url, domain,
          title: post.title || post.subject || extractOgTitle(html),
          body,
          snippet: body.slice(0, 200),
          location: post.region?.name || post.regionName || null,
          author: post.user?.nickname || post.writer?.nickname || null,
          image_url: extractOgImage(html),
          crawl_status: 'success',
        }
      }
    }
    const item = p?.item || p?.product
    if (item) {
      const body = item.body || item.content || item.description || ''
      return {
        url, domain,
        title: item.title || extractOgTitle(html),
        body,
        snippet: body.slice(0, 200),
        location: item.region?.name || null,
        author: item.user?.nickname || null,
        image_url: item.images?.[0]?.url || extractOgImage(html),
        crawl_status: body.length > 10 ? 'success' : 'empty',
      }
    }
  }
  return parseOpenGraph(url, domain, html)
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
      return {
        ...og,
        title: item.title || og.title,
        body,
        snippet: body.slice(0, 200),
        location: item.location || null,
        author: item.userNickname || null,
        crawl_status: body.length > 10 ? 'success' : og.crawl_status,
      }
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
      return {
        ...og,
        title: item.name || og.title,
        body,
        snippet: body.slice(0, 200),
        crawl_status: body.length > 10 ? 'success' : og.crawl_status,
      }
    }
  }
  return og
}

function parseOpenGraph(url, domain, html) {
  const title = extractOgTitle(html)
  const description = extractOgDescription(html)
  const image_url = extractOgImage(html)
  return {
    url, domain, title,
    body: description,
    snippet: description.slice(0, 200),
    location: null, author: null, image_url,
    crawl_status: description.length > 20 ? 'success' : 'empty',
  }
}

function extractNextData(html) {
  const m = html.match(
    /<script\s+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

function extractOgTitle(html) {
  return (
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
    ''
  ).trim()
}

function extractOgDescription(html) {
  return (
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    ''
  ).trim()
}

function extractOgImage(html) {
  return (
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    ''
  ).trim()
}

function fail(url, domain, reason) {
  return {
    url, domain, title: '', body: '', snippet: '',
    location: null, author: null, image_url: '',
    crawl_status: 'failed', fail_reason: reason,
  }
}
