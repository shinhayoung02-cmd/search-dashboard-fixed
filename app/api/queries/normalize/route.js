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

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    // 너무 크게 잡으면 응답 payload와 DB 저장량이 커집니다.
    // 지금 구조에서는 500 기본, 최대 1000이 적정선입니다.
    const rawLimit = Number(body.limit || 500)
    const limit = Math.max(1, Math.min(rawLimit, 1000))
    const onlyEmpty = body.onlyEmpty !== false

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('queries')
      .select('id, query_text, keyword, text, query, source, normalized_query')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (onlyEmpty) {
      q = q.is('normalized_query', null)
    }

    const { data: rows, error } = await q

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    const normalized = []
    const failed = []
    const updates = []

    for (const row of rows || []) {
      const item = normalizeRow(row)

      if (!item.original_query || !item.normalized_query) {
        failed.push({ id: row.id, reason: 'EMPTY_QUERY' })
        continue
      }

      updates.push({
        id: row.id,
        normalized_query: item.normalized_query,
        query_group: item.query_group,
        representative_key: item.representative_key,
        priority: item.priority,
        candidate_status: 'pending',
        candidate_error: null,
      })

      normalized.push(item)
    }

    // 핵심 수정:
    // 기존 방식은 row마다 update 요청을 보내서 Cloudflare subrequest 제한에 걸렸습니다.
    // 이제는 300개씩 묶어서 upsert하므로 요청 수가 크게 줄어듭니다.
    const chunks = chunkArray(updates, 300)
    const dbErrors = []

    for (const chunk of chunks) {
      if (chunk.length === 0) continue

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
          requested_limit: limit,
          fetched_count: rows?.length || 0,
          normalized_count: normalized.length,
          failed_count: failed.length,
          saved_chunks: chunks.length,
          db_errors: dbErrors,
          normalized: normalized.slice(0, 20),
          failed: failed.slice(0, 20),
          message: '일부 또는 전체 정제 결과 저장에 실패했습니다.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      requested_limit: limit,
      fetched_count: rows?.length || 0,
      normalized_count: normalized.length,
      failed_count: failed.length,
      saved_chunks: chunks.length,
      normalized: normalized.slice(0, 20),
      failed: failed.slice(0, 20),
      message: `쿼리 정제 완료: ${normalized.length}개`,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}
