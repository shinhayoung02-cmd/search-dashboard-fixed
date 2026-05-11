import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 120

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function getBraveApiKey() {
  return process.env.BRAVE_API_KEY || ''
}

function normalizeUrl(url = '') {
  return String(url || '').trim()
}

function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function cleanText(value = '') {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function clampLimit(value, fallback = 10) {
  const n = Number(value || fallback)
  if (Number.isNaN(n)) return fallback

  // 단일 쿼리 URL 후보 최대 100개까지 허용
  return Math.max(1, Math.min(n, 100))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function searchBravePage(query, count = 20, offset = 0) {
  const apiKey = getBraveApiKey()

  if (!apiKey) {
    throw new Error('BRAVE_API_KEY가 설정되어 있지 않습니다.')
  }

  const params = new URLSearchParams({
    q: query,
    count: String(count),
    offset: String(offset),
    country: 'kr',
    search_lang: 'ko',
    ui_lang: 'ko-KR',
    safesearch: 'off',
    text_decorations: 'false',
  })

  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    }
  )

  const text = await res.text()

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    throw new Error(
      `BRAVE_API_${res.status}: ${
        data?.error?.detail ||
        data?.message ||
        text ||
        'Brave API 요청 실패'
      }`
    )
  }

  const results = data?.web?.results || []

  return results
    .map((item) => {
      const url = normalizeUrl(item.url)

      return {
        title: cleanText(item.title || ''),
        url,
        snippet: cleanText(item.description || ''),
        source: domainFromUrl(url),
      }
    })
    .filter((item) => item.url && item.url.startsWith('http'))
}

async function searchBrave(query, limit = 10) {
  const finalLimit = clampLimit(limit, 10)
  const pageSize = 20
  const collected = []
  const seen = new Set()

  let offset = 0

  while (collected.length < finalLimit) {
    const remaining = finalLimit - collected.length
    const count = Math.min(pageSize, remaining)

    const pageResults = await searchBravePage(query, count, offset)

    if (!pageResults.length) {
      break
    }

    for (const item of pageResults) {
      if (!item.url || seen.has(item.url)) continue

      seen.add(item.url)
      collected.push(item)

      if (collected.length >= finalLimit) break
    }

    // Brave 페이지네이션: 다음 20개
    offset += pageSize

    // 너무 빠른 연속 호출 방지
    await sleep(150)

    // 같은 페이지만 반복되는 상황 방지
    if (pageResults.length < count) {
      break
    }
  }

  return collected.slice(0, finalLimit)
}

async function saveCandidates(supabase, rows) {
  if (!rows.length) {
    return {
      saved_count: 0,
      save_error: null,
    }
  }

  const attempts = [
    rows,

    rows.map((row) => {
      const {
        representative_query_id,
        query_id,
        query_text,
        ...rest
      } = row

      return rest
    }),

    rows.map((row) => ({
      url: row.url,
      title: row.title,
      snippet: row.snippet,
      source: row.source,
      status: row.status,
    })),
  ]

  let lastError = null

  for (const payload of attempts) {
    const { error } = await supabase
      .from('search_url_candidates')
      .upsert(payload, { onConflict: 'url' })

    if (!error) {
      return {
        saved_count: payload.length,
        save_error: null,
      }
    }

    lastError = error
  }

  return {
    saved_count: 0,
    save_error: lastError?.message || 'search_url_candidates 저장 실패',
  }
}

export async function POST(request) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const query = String(body.query || '').trim()
    const queryId = body.query_id || null
    const limit = clampLimit(body.limit || 10, 10)

    if (!query && !queryId) {
      return json(
        {
          ok: false,
          error: 'query 또는 query_id가 필요합니다.',
        },
        { status: 400 }
      )
    }

    let finalQuery = query

    if (queryId && !finalQuery) {
      const { data, error } = await supabase
        .from('queries')
        .select('*')
        .eq('id', queryId)
        .maybeSingle()

      if (error) {
        return json(
          {
            ok: false,
            error: 'query_id 조회 실패: ' + error.message,
          },
          { status: 500 }
        )
      }

      finalQuery =
        data?.query_text ||
        data?.keyword ||
        data?.text ||
        data?.query ||
        data?.normalized_query ||
        ''
    }

    if (!finalQuery) {
      return json(
        {
          ok: false,
          error: '검색할 쿼리 텍스트를 찾지 못했습니다.',
        },
        { status: 400 }
      )
    }

    const urls = await searchBrave(finalQuery, limit)

    const now = new Date().toISOString()

    const candidateRows = urls.map((item) => ({
      query_id: queryId,
      query_text: finalQuery,
      url: item.url,
      title: item.title,
      snippet: item.snippet,
      source: item.source,
      status: 'pending',
      updated_at: now,
    }))

    const saveResult = await saveCandidates(supabase, candidateRows)

    return json({
      ok: true,
      provider: 'brave',
      query: finalQuery,
      requested_limit: limit,
      result_count: urls.length,
      estimated_api_requests: Math.ceil(limit / 20),
      urls,
      saved_count: saveResult.saved_count,
      save_error: saveResult.save_error,
      cached: false,
      message: `Brave URL 후보 ${urls.length}개 수집 완료`,
    })
  } catch (error) {
    return json(
      {
        ok: false,
        provider: 'brave',
        error: error.message,
        message: error.message,
      },
      { status: 500 }
    )
  }
}