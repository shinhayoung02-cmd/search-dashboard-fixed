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

    const limit = Math.max(
      1,
      Math.min(Number(searchParams.get('limit') || 500), 1000)
    )

    const supabase = getSupabaseAdmin()

    const { data, error, count } = await supabase
      .from('representative_queries')
      .select('*', { count: 'exact' })
      .limit(limit)

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    const rows = (data || [])
      .map((row) => ({
        ...row,
        source_table: 'representative_queries',
        display_query: pickQueryText(row),
      }))
      .filter((row) => row.display_query)

    rows.sort((a, b) => {
      const ac = Number(a.original_count || a.count || 0)
      const bc = Number(b.original_count || b.count || 0)
      return bc - ac
    })

    return NextResponse.json({
      ok: true,
      source_table: 'representative_queries',
      count: rows.length,
      total: count || rows.length,
      queries: rows,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}