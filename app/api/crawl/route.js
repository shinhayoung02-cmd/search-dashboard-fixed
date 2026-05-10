import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { searchGoogle } from '@/lib/searchApis'
import { crawlPage } from '@/lib/crawl'

export const runtime = 'nodejs'
export const maxDuration = 60

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function getQueryText(query) {
  return query.query_text || query.keyword || query.text || ''
}

async function markProcessed(supabase, queryId, processed = true) {
  if (!queryId) return
  await supabase.from('queries').update({ processed }).eq('id', queryId)
}

async function saveResult(supabase, query, queryText, sr, crawled) {
  const title = crawled.crawl_status === 'success' && crawled.title ? crawled.title : sr.title
  const description = sr.description || crawled.snippet || ''
  const body = crawled.body || ''
  const imageUrl = crawled.image_url || sr.thumbnail || ''
  const source = crawled.domain || sr.site || ''

  const payload = {
    query_id: query.id,
    keyword: queryText,
    site: source,
    source,
    title,
    url: sr.url,
    description,
    snippet: description,
    detail_body: body,
    thumbnail: imageUrl,
    image_url: imageUrl,
    location: crawled.location || null,
    author: crawled.author || null,
    crawl_status: crawled.crawl_status || 'failed',
  }

  const { error } = await supabase.from('results').upsert(payload, { onConflict: 'url' })
  if (error) throw new Error(error.message)
}

export async function POST(request) {
  const supabase = getSupabaseAdmin()
  const body = await request.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body.limit || 3), 1), 5)

  const processed = []
  const failed = []

  const { data: queries, error: qErr } = await supabase
    .from('queries')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (qErr) {
    return json({
      processed,
      failed,
      stopped: true,
      stop_reason: 'SUPABASE_QUERY_ERROR',
      message: '쿼리 목록 오류: ' + qErr.message,
    }, { status: 500 })
  }

  if (!queries || queries.length === 0) {
    return json({
      message: '처리할 쿼리 없음',
      processed,
      failed,
      stopped: false,
    })
  }

  for (const query of queries) {
    const queryText = getQueryText(query)
    if (!queryText) {
      await markProcessed(supabase, query.id, true)
      failed.push({
        query_id: query.id,
        original_query: '',
        tried_queries: [],
        google_status: 'EMPTY_QUERY',
        google_error_message: 'query_text/keyword/text 값이 없습니다.',
        result_count: 0,
        final_reason: 'EMPTY_QUERY',
      })
      continue
    }

    console.log(`\n[crawl] 쿼리 처리 시작: "${queryText}"`)

    try {
      const searchResult = await searchGoogle(queryText)

      console.log('[crawl] 검색 결과:', {
        ok: searchResult.ok,
        tried: searchResult.tried_queries,
        matched: searchResult.matched_query,
        status: searchResult.google_status,
        count: searchResult.items?.length || 0,
        fatal: searchResult.fatal,
      })

      if (!searchResult.ok || searchResult.items.length === 0) {
        const failure = {
          query_id: query.id,
          original_query: queryText,
          tried_queries: searchResult.tried_queries || [queryText],
          google_status: searchResult.google_status,
          google_error_message: searchResult.google_error_detail || '',
          result_count: 0,
          final_reason: searchResult.google_status,
        }
        failed.push(failure)

        // 검색 결과가 정말 없는 쿼리는 다음에 반복되지 않도록 처리 완료로 둡니다.
        if (searchResult.google_status === 'SEARCH_EMPTY_RESULT') {
          await markProcessed(supabase, query.id, true)
          continue
        }

        // 429/403/키 누락은 전체 배치를 즉시 중단합니다.
        if (searchResult.fatal || searchResult.google_status === 'GOOGLE_API_429') {
          return json({
            processed,
            failed,
            stopped: true,
            stop_reason: searchResult.google_status,
            message:
              searchResult.google_status === 'GOOGLE_API_429'
                ? 'Google Search API 할당량이 초과되었습니다. 오늘은 더 이상 자동 검색 수집이 어렵습니다. 직접 URL 크롤링을 사용하거나 내일 다시 시도하세요.'
                : `Google Search API 오류로 중단되었습니다: ${searchResult.google_status}`,
          })
        }

        continue
      }

      let savedCount = 0

      for (const sr of searchResult.items) {
        if (!sr.url) continue
        console.log(`[crawl] URL 크롤링: ${sr.url}`)

        try {
          const crawled = await crawlPage(sr.url)
          console.log(`[crawl] 크롤링 결과: status=${crawled.crawl_status}, 본문길이=${crawled.body?.length || 0}`)
          await saveResult(supabase, query, queryText, sr, crawled)
          savedCount += 1
        } catch (e) {
          console.error('[crawl] URL 처리 실패:', sr.url, e.message)
        }

        await sleep(250)
      }

      await markProcessed(supabase, query.id, true)

      processed.push({
        query_id: query.id,
        original_query: queryText,
        tried_queries: searchResult.tried_queries,
        matched_query: searchResult.matched_query,
        google_status: 'success',
        result_count: searchResult.items.length,
        saved_count: savedCount,
      })
    } catch (e) {
      console.error('[crawl] 쿼리 처리 예외:', e.message)
      failed.push({
        query_id: query.id,
        original_query: queryText,
        tried_queries: [queryText],
        google_status: 'EXCEPTION',
        google_error_message: e.message,
        result_count: 0,
        final_reason: e.message,
      })
    }
  }

  return json({
    processed,
    failed,
    stopped: false,
    message:
      processed.length > 0
        ? `처리 완료: ${processed.length}개 / 실패: ${failed.length}개`
        : `처리된 키워드가 없습니다. 실패: ${failed.length}개`,
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
