import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { crawlPage } from '@/lib/crawl'

export const runtime = 'nodejs'
export const maxDuration = 60

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export async function POST(request) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))
    const url = String(body.url || '').trim()
    const queryId = body.query_id || null
    const keywordFromBody = String(body.keyword || '').trim()

    if (!url) {
      return json({ error: 'url은 필수입니다.' }, { status: 400 })
    }

    let query = null
    let keyword = keywordFromBody

    if (queryId) {
      const { data, error } = await supabase
        .from('queries')
        .select('*')
        .eq('id', queryId)
        .maybeSingle()

      if (error) {
        return json({ error: 'query_id 조회 실패: ' + error.message }, { status: 500 })
      }

      query = data
      keyword = keyword || query?.query_text || query?.keyword || query?.text || ''
    }

    const crawled = await crawlPage(url)
    const source = crawled.domain || domainFromUrl(url)
    const imageUrl = crawled.image_url || ''

    const payload = {
      query_id: queryId,
      keyword: keyword || url,
      site: source,
      source,
      title: crawled.title || url,
      url,
      description: crawled.snippet || '',
      snippet: crawled.snippet || '',
      detail_body: crawled.body || '',
      thumbnail: imageUrl,
      image_url: imageUrl,
      location: crawled.location || null,
      author: crawled.author || null,
      crawl_status: crawled.crawl_status || 'failed',
    }

    const { data, error } = await supabase
      .from('results')
      .upsert(payload, { onConflict: 'url' })
      .select()
      .single()

    if (error) {
      return json({
        error: 'results 저장 실패: ' + error.message,
        payload,
      }, { status: 500 })
    }

    if (query?.id) {
      await supabase.from('queries').update({ processed: true }).eq('id', query.id)
    }

    return json({ ok: true, result: data, crawled })
  } catch (e) {
    return json({ error: 'crawl-url 실패: ' + e.message }, { status: 500 })
  }
}
