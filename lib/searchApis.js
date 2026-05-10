import axios from 'axios'

function stripHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, '').trim()
}

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

export async function searchGoogle(keyword) {
  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
    console.warn('[searchGoogle] GOOGLE 키 없음, 건너뜁니다.')
    return []
  }

  // ✅ 공식 Custom Search API 사용 (google.com 직접 긁기 X)
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', process.env.GOOGLE_API_KEY)
  url.searchParams.set('cx', process.env.GOOGLE_SEARCH_ENGINE_ID)
  url.searchParams.set('q', keyword)
  url.searchParams.set('num', '5')
  url.searchParams.set('hl', 'ko')
  url.searchParams.set('gl', 'kr')

  try {
    const res = await fetch(url.toString())
    if (!res.ok) {
      console.warn('[searchGoogle] API 오류:', res.status)
      return []
    }
    const data = await res.json()
    return (data.items || []).map((item) => ({
      site: new URL(item.link).hostname.replace(/^www\./, ''),
      title: item.title || '',
      description: item.snippet || '',
      url: item.link || '',
      thumbnail: item.pagemap?.cse_image?.[0]?.src || '',
    }))
  } catch (e) {
    console.warn('[searchGoogle] fetch 실패:', e.message)
    return []
  }
}
