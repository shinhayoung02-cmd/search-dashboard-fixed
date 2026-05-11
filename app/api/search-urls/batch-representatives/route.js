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

function sanitizeForDb(value = '', maxLength = 2000) {
  return String(value || '')
    // HTML 제거
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

    // HTML entity 일부 정리
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

    // Postgres가 싫어하는 null/제어문자 제거
    .replace(/\u0000/g, ' ')
    .replace(/\\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')

    // 깨진 surrogate 제거
    .replace(/[\uD800-\uDFFF]/g, ' ')

    // 과한 공백 정리
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function cleanQuery(value = '') {
  return sanitizeForDb(value, 500)
    .replace(/\bconfusing\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clampLimit(value, fallback = 5, max = 10) {
  const n = Number(value || fallback)
  if (Number.isNaN(n)) return fallback
  return Math.max(1, Math.min(n, max))
}

function clampUrlLimit(value, fallback = 20, max = 20) {
  const n = Number(value || fallback)
  if (Number.isNaN(n)) return fallback
  return Math.max(1, Math.min(n, max))
}

function pickRepresentativeQuery(row = {}) {
  return cleanQuery(
    row.representative_query ||
      row.normalized_query ||
      row.query_text ||
      row.keyword ||
      row.text ||
      row.query ||
      ''
  )
}

async function searchBrave(query, limit = 20) {
  const apiKey = getBraveApiKey()

  if (!apiKey) {
    throw new Error('BRAVE_API_KEY가 설정되어 있지 않습니다.')
  }

  const finalLimit = clampUrlLimit(limit, 20, 20)

  const params = new URLSearchParams({
    q: query,
    count: String(finalLimit),
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

  const seen = new Set()

  return results
    .map((item) => {
      const url = normalizeUrl(item.url)
      const source = domainFromUrl(url)

      return {
        title: sanitizeForDb(item.title || '', 500),
        url,
        snippet: sanitizeForDb(item.description || '', 1500),
        source: sanitizeForDb(source, 200),
      }
    })
    .filter((item) => {
      if (!item.url || !item.url.startsWith('http')) return false
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, finalLimit)
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

  try {
    await supabase
      .from(tableName)
      .update({
        candidate_status: status,
        candidate_error: errorMessage ? sanitizeForDb(errorMessage, 500) : null,
        candidate_attempted_at: new Date().toISOString(),
      })
      .eq('id', row.id)
  } catch {
    // 상태 업데이트 실패는 전체 수집 실패로 보지 않음
  }
}

async function saveCandidates(supabase, rows) {
  if (!rows.length) {
    return {
      saved_count: 0,
      save_error: null,
    }
  }

  // Worker subrequest를 줄이기 위해 최소 컬럼만 저장
  const payload = rows.map((row) => ({
    url: sanitizeForDb(row.url, 1000),
    title: sanitizeForDb(row.title, 500),
    snippet: sanitizeForDb(row.snippet, 1500),
    source: sanitizeForDb(row.source, 200),
    status: 'pending',
    updated_at: row.updated_at || new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('search_url_candidates')
    .upsert(payload, { onConflict: 'url' })

  if (error) {
    return {
      saved_count: 0,
      save_error: error.message,
    }
  }

  return {
    saved_count: payload.length,
    save_error: null,
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    // 대표 쿼리 배치는 한 번에 너무 많이 돌리면 Cloudflare에서 막힘
    const queryLimit = clampLimit(body.queryLimit || body.limit || 5, 5, 10)

    // Brave는 한 번 요청에서 최대 20개가 적정
    const urlLimit = clampUrlLimit(body.urlLimit || 20, 20, 20)

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
          provider: 'brave',
          reason: 'EMPTY_REPRESENTATIVE_QUERY',
          result_count: 0,
        })
        continue
      }

      try {
        const urls = await searchBrave(representativeQuery, urlLimit)
        const now = new Date().toISOString()

        const candidateRows = urls.map((item) => ({
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
          reason: sanitizeForDb(error.message, 500),
          result_count: 0,
        })

        await updateRepresentativeStatus(
          supabase,
          row,
          'failed',
          error.message
        )
      }

      // Brave / Supabase 연속 요청 완화
      await delay(300)
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
        error: sanitizeForDb(error.message, 500),
        message: sanitizeForDb(error.message, 500),
      },
      { status: 500 }
    )
  }
}