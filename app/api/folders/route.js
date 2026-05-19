import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function json(body, init = {}) {
  return NextResponse.json(body, init)
}

function cleanText(value = '', max = 500) {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function normalizeColor(value = '') {
  const color = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  return '#6366f1'
}

async function attachItemCounts(supabase, folders = []) {
  if (!folders.length) return []

  const ids = folders.map((folder) => folder.id).filter(Boolean)

  const { data, error } = await supabase
    .from('result_folder_items')
    .select('folder_id')
    .in('folder_id', ids)

  if (error) {
    return folders.map((folder) => ({ ...folder, item_count: 0 }))
  }

  const countMap = new Map()
  for (const row of data || []) {
    countMap.set(row.folder_id, (countMap.get(row.folder_id) || 0) + 1)
  }

  return folders.map((folder) => ({
    ...folder,
    item_count: countMap.get(folder.id) || 0,
  }))
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('result_folders')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 })
    }

    const folders = await attachItemCounts(supabase, data || [])

    return json({
      ok: true,
      folders,
      count: folders.length,
    })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const name = cleanText(body.name, 120)
    const description = cleanText(body.description, 500)
    const color = normalizeColor(body.color)

    if (!name) {
      return json({ ok: false, error: '폴더명이 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('result_folders')
      .insert({ name, description, color })
      .select('*')
      .single()

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 })
    }

    return json({
      ok: true,
      folder: { ...data, item_count: 0 },
      message: `폴더를 만들었습니다: ${data.name}`,
    })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id') || ''

    if (!id) {
      return json({ ok: false, error: '삭제할 folder id가 필요합니다.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('result_folders')
      .delete()
      .eq('id', id)
      .select('id, name')
      .maybeSingle()

    if (error) {
      return json({ ok: false, error: error.message }, { status: 500 })
    }

    return json({
      ok: true,
      deleted: data,
      message: data?.name ? `폴더를 삭제했습니다: ${data.name}` : '폴더를 삭제했습니다.',
    })
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 })
  }
}
