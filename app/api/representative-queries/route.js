import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function pickQueryText(row = {}) {
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

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.max(1, Math.min(Number(searchParams.get('limit') || 100), 300))

    const supabase = getSupabaseAdmin()

    const tableCandidates = [
      'representative_queries',
      'query_representatives',
      'queries',
    ]

    let lastError = null

    for (const tableName of tableCandidates) {
      let q = supabase
        .from(tableName)
        .select('*')
        .limit(limit)

      if (tableName === 'queries') {
        q = q.not('normalized_query', 'is', null)
      }

      const { data, error } = await q

      if (error) {
        lastError = error
        continue
      }

      const rows = (data || [])
        .map((row) => ({
          ...row,
          source_table: tableName,
          display_query: pickQueryText(row),
        }))
        .filter((row) => row.display_query)

      rows.sort((a, b) => {
        const ap = Number(a.priority || 999)
        const bp = Number(b.priority || 999)
        if (ap !== bp) return ap - bp

        const ac = Number(a.original_count || a.count || 0)
        const bc = Number(b.original_count || b.count || 0)
        return bc - ac
      })

      return NextResponse.json({
        ok: true,
        source_table: tableName,
        count: rows.length,
        queries: rows,
      })
    }

    return NextResponse.json(
      {
        ok: false,
        error: lastError?.message || '대표 쿼리 테이블을 찾지 못했습니다.',
      },
      { status: 500 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 }
    )
  }
}