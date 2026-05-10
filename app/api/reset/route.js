import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const mode = body.mode || 'broken'
    const token = request.headers.get('x-reset-token') || ''

    // Cloudflare 환경변수에 RESET_TOKEN을 넣어두면 보호됨
    if (process.env.RESET_TOKEN && token !== process.env.RESET_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'RESET_TOKEN이 올바르지 않습니다.' },
        { status: 401 }
      )
    }

    let query = supabase.from('results').delete()

    if (mode === 'all') {
      // 전체 결과 삭제
      query = query.not('id', 'is', null)
    } else {
      // 깨진 URL / 잘못 들어간 당근 기본 페이지 카드만 삭제
      query = query.or(
        [
          'url.ilike.%???%',
          'title.ilike.%서초4동 이야기%',
          'detail_body.ilike.%서초4동 이웃%',
          'detail_body.ilike.%이웃과 이야기를 해보세요%'
        ].join(',')
      )
    }

    const { data, error } = await query.select('id, title, url')

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      mode,
      deleted_count: data?.length || 0,
      deleted: data || [],
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