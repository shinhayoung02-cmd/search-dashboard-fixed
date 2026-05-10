import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

const allowedOrigins = new Set([
  'https://jeongbochajajum.pages.dev',
  'https://search-dashboard-fixed.shyoung0214.workers.dev',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:3001',
])

function corsHeaders(request) {
  const origin = request?.headers?.get('origin') || ''
  const allowOrigin = allowedOrigins.has(origin) ? origin : 'https://jeongbochajajum.pages.dev'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}

function json(request, body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(request),
      ...(init.headers || {}),
    },
  })
}

export async function OPTIONS(request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  })
}

// GET /api/queries — 처리 안 된 쿼리 목록 조회
export async function GET(request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    const { data, error } = await supabaseAdmin
      .from('queries')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[api/queries] Supabase error:', error)
      return json(request, { error: error.message }, { status: 500 })
    }

    return json(request, { queries: data || [] })
  } catch (err) {
    console.error('[api/queries] Server error:', err)
    return json(
      request,
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

// POST /api/queries — 다른 사이트에서 키워드 등록
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const keyword = String(body.keyword || '').trim()
    const source = String(body.source || 'jeongbochajajum').trim()

    if (!keyword) {
      return json(request, { error: 'keyword는 필수입니다' }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: existing, error: findError } = await supabaseAdmin
      .from('queries')
      .select('id, keyword, source, processed, created_at')
      .eq('keyword', keyword)
      .eq('source', source)
      .limit(1)
      .maybeSingle()

    if (findError) {
      console.error('[api/queries] duplicate check error:', findError)
      return json(request, { error: findError.message }, { status: 500 })
    }

    if (existing) {
      return json(request, { query: existing, duplicated: true }, { status: 200 })
    }

    const { data, error } = await supabaseAdmin
      .from('queries')
      .insert({
        keyword,
        source,
        processed: false,
      })
      .select()
      .single()

    if (error) {
      console.error('[api/queries] Supabase insert error:', error)
      return json(request, { error: error.message }, { status: 500 })
    }

    return json(request, { query: data, duplicated: false }, { status: 201 })
  } catch (err) {
    console.error('[api/queries] Server error:', err)
    return json(
      request,
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
