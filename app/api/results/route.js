import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const keyword = searchParams.get('keyword') || ''
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const pageSize = 12
    const from = (page - 1) * pageSize
    const to = page * pageSize - 1

    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('results')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (keyword) {
      q = q.ilike('keyword', `%${keyword}%`)
    }

    const { data, error, count } = await q

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // ✅ results 없어도 queries fallback 없이 빈 배열만 반환
    return NextResponse.json({
      results: data || [],
      total: count || 0,
      page,
      pageSize,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
