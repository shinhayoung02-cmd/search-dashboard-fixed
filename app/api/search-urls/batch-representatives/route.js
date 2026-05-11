import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 120

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function clampLimit(value, fallback = 5, max = 20) {
  const n = Number(value || fallback)
  if (Number.isNaN(n)) return fallback
  return Math.max(1, Math.min(n, max))
}

function pickRepresentativeQuery(row = {}) {
  return String(
    row.representative_query ||
    row.normalized_query ||
    row.query_text ||
    row.keyword ||
    row.text ||
    row.query ||
    ''
  ).trim()
}

async function searchBrave(query, limit = 5) {
  const apiKey = getBraveApiKey()

  if (!apiKey) {
    throw new Error('BRAVE_API_KEY가 설정되어 있지 않습니다.')
  }

  const params = new URLSearchParams({
    q: query,
    count: String(clampLimit(limit, 5, 20)),
    country: 'kr',
    search_lang: 'ko',
    ui_lang: 'ko-KR',
    safesearch: 'off',
    text_decorations: 'false',
  })

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })

  const text = await res.text()

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    throw new Error(
      `BRAVE_API_${res.status}: ${data?.error?.detail || data?.message || text || 'Brave API 요청 실패'}`
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

async function loadRepresentativeRows(supabase, limit) {
  const tableCandidates = [
    'representative_queries',
    'query_representatives',
    'queries',
  ]

  let lastError = null

  for (const tableName of tableCandidates) {
    let query = supabase
      .from(tableName)
      .select('*')
      .limit(limit)

    if (tableName === 'queries') {
      query = query
        .not('normalized_query', 'is', null)
        .or('candidate_status.is.null,candidate_status.eq.pending')
        .order('priority', { ascending: true })
    } else {
      query = query
        .or('candidate_status.is.null,candidate_status.eq.pending')
        .order('priority', { ascending: true })
    }

    const { data, error } = await query

    if (!error) {
      const rows = (data || [])
        .map((row) => ({
          ...row,
          _source_table: tableName,
        }))
        .filter((row) => pickRepresentativeQuery(row))

      return {
        tableName,
        rows,
      }
    }

    lastError = error
  }

  throw new Error(lastError?.message || '대표 쿼리 테이블을 찾지 못했습니다.')
}

async function updateRepresentativeStatus(supabase, row, status, errorMessage = null) {
  const tableName = row._source_table
  if (!tableName || !row.id) return

  const payload = {
    candidate_status: status,
    candidate_error: errorMessage,
    candidate_attempted_at: new Date().toISOString(),
  }

  await supabase
    .from(tableName)
    .update(payload)
    .eq('id', row.id)
}

async function saveCandidates(supabase, rows) {
  if (!rows.length) return { saved_count: 0, save_error: null }

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
      return { saved_count: payload.length, save_error: null }
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
    const body = await request.json().catch(() => ({}))

    const queryLimit = clampLimit(body.queryLimit || body.limit || 5, 5, 20)
    const urlLimit = clampLimit(body.urlLimit || 5, 5, 20)

    const supabase = getSupabaseAdmin()

    const { tableName, rows } = await loadRepresentativeRows(supabase, queryLimit)

    const processed = []
    const failed = []

    for (const row of rows) {
      const representativeQuery = pickRepresentativeQuery(row)

      if (!representativeQuery) {
        failed.push({
          representative_query_id: row.id,
          representative_query: '',
          reason: 'EMPTY_REPRESENTATIVE_QUERY',
        })
        continue
      }

      try {
        const urls = await searchBrave(representativeQuery, urlLimit)
        const now = new Date().toISOString()

        const candidateRows = urls.map((item) => ({
          representative_query_id: row.id,
          query_id: tableName === 'queries' ? row.id : null,
          query_text: representativeQuery,
          url: item.url,
          title: item.title,
          snippet: item.snippet,
          source: item.source,
          status: 'pending',
          updated_at: now,
        }))

        const saveResult = await saveCandidates(supabase, candidateRows)

        if (saveResult.save_error) {
          failed.push({
            representative_query_id: row.id,
            representative_query: representativeQuery,
            provider: 'brave',
            reason: saveResult.save_error,
            result_count: urls.length,
          })

          await updateRepresentativeStatus(
            supabase,
            row,
            'failed',
            saveResult.save_error
          )
        } else {
          processed.push({
            representative_query_id: row.id,
            representative_query: representativeQuery,
            provider: 'brave',
            result_count: urls.length,
            saved_count: saveResult.saved_count,
          })

          await updateRepresentativeStatus(
            supabase,
            row,
            urls.length > 0 ? 'candidate_collected' : 'no_results',
            null
          )
        }
      } catch (error) {
        failed.push({
          representative_query_id: row.id,
          representative_query: representativeQuery,
          provider: 'brave',
          reason: error.message,
          result_count: 0,
        })

        await updateRepresentativeStatus(
          supabase,
          row,
          'failed',
          error.message
        )
      }

      await delay(250)
    }

    return json({
      ok: true,
      provider: 'brave',
      source_table: tableName,
      processed,
      failed,
      processed_count: processed.length,
      failed_count: failed.length,
      stopped: false,
      message: `대표 쿼리 배치 수집 완료: 성공 ${processed.length}개 / 실패 ${failed.length}개`,
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