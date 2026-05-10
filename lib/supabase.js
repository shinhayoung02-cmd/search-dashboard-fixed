import { createClient } from '@supabase/supabase-js'

function readRequiredEnv(names) {
  const values = {}
  const missing = []

  for (const name of names) {
    const value = process.env[name]
    if (!value) missing.push(name)
    values[name] = value
  }

  if (missing.length > 0) {
    throw new Error(
      `[환경변수 누락] ${missing.join(', ')} 값이 없습니다. 프로젝트 루트에 .env.local을 만들고 npm run dev를 재시작하세요.`
    )
  }

  return values
}

export function getSupabaseAdmin() {
  const env = readRequiredEnv([
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])

  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

export function getSupabaseClient() {
  const env = readRequiredEnv([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ])

  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
