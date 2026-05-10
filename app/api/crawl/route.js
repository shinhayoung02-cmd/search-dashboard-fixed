import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { searchGoogle } from '@/lib/searchApis'

export const runtime = 'nodejs'
export const maxDuration = 60

// ✅ Render에 배포한 crawler-server 주소
const CRAWLER_URL = process.env.CRAWLER_SERVER_URL || 'https://daangn-crawler-server.onrender.com'
const CRAWLER_KEY = process.env.CRAWLER_API_KEY || ''

// crawler-server에 URL 전달 → 실제 본문 받아오기
async function crawlWithPlaywright(url) {
  try {
    const res = await fetch(`${CRAWLER_URL}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-crawler-key': CRAWLER_KEY,
      },
      body: JSON.stringify({ url }),
    })

    if (!res.ok) return null
    const data = await res.json()
    if (!data.ok) return null
    return data
  } catch (e) {
    console.error('[crawlWithPlaywright] 실패:', e.message)
    return null
  }
}

export async function POST() {
  const supabase = getSupabaseAdmin()

  // 1. queries 테이블에서 쿼리 목록 가져오기
  const { data: queries, error: qErr } = await supabase
    .from('queries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  if (qErr) {
    return NextResponse.json({ error: '쿼리 목록 오류: ' + qErr.message }, { status: 500 })
  }
  if (!queries || queries.length === 0) {
    return NextResponse.json({ message: '처리할 쿼리 없음', processed: [], failed: [] })
  }

  const processed = []
  const failed = []

  for (const query of queries) {
    const queryText = query.query_text || query.keyword || query.text || ''
    if (!queryText) continue

    try {
      // 2. Google 검색 API로 URL 목록 수집
      const searchResults = await searchGoogle(queryText)

      if (!searchResults || searchResults.length === 0) {
        failed.push({ query_id: query.id, reason: '검색 결과 없음' })
        continue
      }

      // 3. 각 URL → crawler-server로 본문 수집 → DB 저장
      for (const sr of searchResults) {
        if (!sr.url) continue

        try {
          // ✅ Playwright로 실제 페이지 본문 수집
          const crawled = await crawlWithPlaywright(sr.url)

          await supabase.from('results').upsert(
            {
              query_id: query.id,
              keyword: queryText,
              // 제목: 크롤링 성공이면 실제 제목, 아니면 검색결과 제목
              title: crawled?.title || sr.title || '',
              // snippet: Google 검색 요약
              snippet: sr.description || '',
              // detail_body: 실제 페이지 본문 ← 핵심!
              detail_body: crawled?.body || '',
              url: sr.url,
              source: new URL(sr.url).hostname.replace(/^www\./, ''),
              location: crawled?.location || null,
              author: null,
              image_url: crawled?.image || sr.thumbnail || '',
              crawl_status: crawled ? 'success' : 'failed',
            },
            { onConflict: 'url' }
          )
        } catch (e) {
          console.error('[crawl] URL 실패:', sr.url, e.message)
        }

        await sleep(500)
      }

      processed.push({ query_id: query.id, query_text: queryText })
    } catch (e) {
      failed.push({ query_id: query.id, reason: e.message })
    }
  }

  return NextResponse.json({ processed, failed })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
