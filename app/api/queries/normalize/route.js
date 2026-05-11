import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizeRow } from '@/lib/queryNormalize'

export const runtime = 'nodejs'
export const maxDuration = 60

function chunkArray(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

function pickQueryText(row) {
  return row.query_text || row.keyword || row.text || row.query || ''
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    // 너무 크게 잡으면 Cloudflare/Supabase에서 다시 터질 수 있음
    const limit = Math.max(1, Math.min(Number(body.limit || 500), 1000))
    const onlyEmpty = body.onlyEmpty !== false

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('queries')
      .select('id, query_text, keyword, text, query, source, processed, normalized_query, created_at')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (onlyEmpty) {
      q = q.is('normalized_query', null)
    }

    const { data: rows, error } = await q

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'select_queries',
          error: error.message,
        },
        { status: 500 }
      )
    }

    const normalized = []
    const failed = []
    const updates = []

    for (const row of rows || []) {
      try {
        const baseText = pickQueryText(row)

        if (!baseText) {
          failed.push({ id: row.id, reason: 'EMPTY_QUERY' })
          continue
        }

        const item = normalizeRow({
          ...row,
          query_text: row.query_text || baseText,
          keyword: row.keyword || baseText,
          text: row.text || baseText,
          query: row.query || baseText,
        })

        if (!item.original_query || !item.normalized_query) {
          failed.push({ id: row.id, reason: 'NORMALIZE_EMPTY_RESULT' })
          continue
        }

        // 중요:
        // upsert 시 기존 not null 컬럼이 있으면 터질 수 있으므로
        // keyword/query_text/text/query/source 같은 기존 필드도 같이 넣음
        updates.push({
          id: row.id,

          keyword: row.keyword || baseText,
          query_text: row.query_text || baseText,
          text: row.text || baseText,
          query: row.query || baseText,
          source: row.source || 'unknown',
          processed: row.processed ?? false,

          normalized_query: item.normalized_query,
          query_group: item.query_group,
          representative_key: item.representative_key,
          priority: item.priority,
          candidate_status: 'pending',
          candidate_error: null,
        })

        normalized.push(item)
      } catch (e) {
        failed.push({
          id: row.id,
          reason: e.message || 'NORMALIZE_EXCEPTION',
        })
      }
    }

    const chunks = chunkArray(updates, 200)
    const dbErrors = []

    for (const chunk of chunks) {
      const { error: upsertError } = await supabase
        .from('queries')
        .upsert(chunk, { onConflict: 'id' })

      if (upsertError) {
        dbErrors.push(upsertError.message)
      }
    }

    if (dbErrors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'upsert_queries',
          requested_limit: limit,
          fetched_count: rows?.length || 0,
          update_count: updates.length,
          normalized_count: normalized.length,
          failed_count: failed.length,
          db_errors: dbErrors,
          normalized: normalized.slice(0, 20),
          failed: failed.slice(0, 20),
          error: dbErrors.join('\n'),
          message: '정제 결과 저장 중 DB 오류가 발생했습니다.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      requested_limit: limit,
      fetched_count: rows?.length || 0,
      update_count: updates.length,
      normalized_count: normalized.length,
      failed_count: failed.length,
      saved_chunks: chunks.length,
      normalized: normalized.slice(0, 20),
      failed: failed.slice(0, 20),
      message: `쿼리 정제 완료: ${normalized.length}개`,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'exception',
        error: error.message,
      },
      { status: 500 }
    )
  }
}