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

    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.max(
      1,
      Math.min(Number(searchParams.get('limit') || 1000), 1000)
    )

    const source = searchParams.get('source') || 'jeongbochajajum_supabase_save'
    const status = searchParams.get('status') || ''

    const from = (page - 1) * limit
    const to = from + limit - 1

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('queries')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (source !== 'all') {
      q = q.eq('source', source)
    }

    if (status) {
      q = q.eq('candidate_status', status)
    }

    const { data, error, count } = await q

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

    const total = count || 0
    const totalPages = Math.max(1, Math.ceil(total / limit))

    return NextResponse.json({
      ok: true,
      source_table: 'queries',
      page,
      limit,
      from,
      to,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
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