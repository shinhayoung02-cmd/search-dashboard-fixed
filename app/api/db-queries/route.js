import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function pickQueryText(row = {}) {
  return String(
    row.query_text ||
      row.keyword ||
      row.text ||
      row.query ||
      row.normalized_query ||
      ''
  ).trim()
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    const limit = Math.max(
      1,
      Math.min(Number(searchParams.get('limit') || 500), 2000)
    )

    const source = searchParams.get('source') || 'jeongbochajajum_supabase_save'
    const status = searchParams.get('status') || ''

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('queries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (source !== 'all') {
      q = q.eq('source', source)
    }

    if (status) {
      q = q.eq('candidate_status', status)
    }

    const { data, error } = await q

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
        },
        { status: 500 }
      )
    }

    const rows = (data || [])
      .map((row) => ({
        ...row,
        source_table: 'queries',
        display_query: pickQueryText(row),
      }))
      .filter((row) => row.display_query)

    return NextResponse.json({
      ok: true,
      source_table: 'queries',
      count: rows.length,
      queries: rows,
    })
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