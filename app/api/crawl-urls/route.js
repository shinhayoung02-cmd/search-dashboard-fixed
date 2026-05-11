import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { crawlPage } from '@/lib/crawl'

export const runtime = 'nodejs'
export const maxDuration = 120

function uniqueUrls(urls = []) {
  return Array.from(
    new Set(
      urls
        .map((url) => String(url || '').trim())
        .filter((url) => url.startsWith('http'))
    )
  )
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const keyword = String(body.keyword || '직접 URL 수집').trim()
    const urls = uniqueUrls(body.urls || [])

    if (urls.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'urls 배열이 필요합니다.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    const processed = []
    const failed = []

    for (const url of urls) {
      if (url.includes('???')) {
        failed.push({ url, reason: 'BROKEN_URL' })
        continue
      }

      try {
        const crawled = await crawlPage(url)

        const source = crawled.domain || ''
        const imageUrl = crawled.image_url || ''

        const payload = {
          keyword,

          site: source,
          source,

          title: crawled.title || '',
          url,

          description: crawled.snippet || '',
          snippet: crawled.snippet || '',
          detail_body: crawled.body || '',

          thumbnail: imageUrl,
          image_url: imageUrl,

          location: crawled.location || null,
          author: crawled.author || null,

          crawl_status: crawled.crawl_status || 'failed',

          // 원본 게시물 날짜 저장
          published_at: crawled.published_at || null,
          post_date: crawled.post_date || null,
          article_date: crawled.article_date || null,
          published_at_raw: crawled.published_at_raw || null,
        }

        const { data, error } = await supabase
          .from('results')
          .upsert(payload, { onConflict: 'url' })
          .select('id, title, url, crawl_status, published_at, post_date, article_date, published_at_raw')
          .single()

        if (error) {
          failed.push({ url, reason: error.message })
        } else {
          processed.push(data)

          await supabase
            .from('search_url_candidates')
            .update({
              status: 'crawled',
              updated_at: new Date().toISOString(),
            })
            .eq('url', url)
        }
      } catch (e) {
        failed.push({ url, reason: e.message })
      }

      await new Promise((r) => setTimeout(r, 250))
    }

    return NextResponse.json({
      ok: true,
      processed,
      failed,
      processed_count: processed.length,
      failed_count: failed.length,
      message: `본문 수집 완료: 성공 ${processed.length}개 / 실패 ${failed.length}개`,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}