import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { crawlPage } from '@/lib/crawl'

export const runtime = 'nodejs'
export const maxDuration = 60

function getDomain(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeUrls(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean)
  }

  return String(value || '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)
}

async function saveResult(supabase, { url, keyword, query_id, crawled }) {
  const payload = {
    query_id: query_id || null,
    keyword: keyword || '직접 URL 수집',
    title: crawled.title || '',
    snippet: crawled.snippet || crawled.body?.slice(0, 200) || '',
    detail_body: crawled.body || '',
    url,
    source: crawled.domain || getDomain(url),
    location: crawled.location || null,
    author: crawled.author || null,
    image_url: crawled.image_url || '',
    crawl_status: crawled.crawl_status || 'unknown',
  }

  const { data, error } = await supabase
    .from('results')
    .upsert(payload, { onConflict: 'url' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const urls = normalizeUrls(body.urls)
    const keyword = String(body.keyword || body.query || '직접 URL 수집').trim()
    const query_id = body.query_id || null

    if (urls.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'urls 배열 또는 줄바꿈 URL 문자열이 필요합니다.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    const processed = []
    const failed = []

    for (const url of urls) {
      if (url.includes('???')) {
        failed.push({
          url,
          reason: 'URL_BROKEN',
          message: 'URL에 ???가 포함되어 저장하지 않았습니다. PowerShell UTF-8 또는 브라우저 복사 URL을 사용하세요.',
        })
        continue
      }

      try {
        const crawled = await crawlPage(url)
        const saved = await saveResult(supabase, { url, keyword, query_id, crawled })

        // 후보 테이블 상태도 갱신합니다. 후보가 없으면 무시됩니다.
        await supabase
          .from('search_url_candidates')
          .update({ status: 'crawled', updated_at: new Date().toISOString() })
          .eq('url', url)

        processed.push({
          url,
          result_id: saved.id,
          title: saved.title,
          crawl_status: saved.crawl_status,
        })
      } catch (error) {
        failed.push({
          url,
          reason: 'CRAWL_OR_SAVE_FAILED',
          message: error.message,
        })
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    return NextResponse.json({
      ok: processed.length > 0,
      processed,
      failed,
      processed_count: processed.length,
      failed_count: failed.length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'crawl-urls 실패',
        detail: error.message,
      },
      { status: 500 }
    )
  }
}
