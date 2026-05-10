-- =============================================
-- 1. queries 테이블: 다른 사이트에서 키워드 등록
-- =============================================
create table if not exists queries (
  id          uuid default gen_random_uuid() primary key,
  keyword     text not null,
  source      text default 'unknown',
  processed   boolean default false,
  created_at  timestamp with time zone default now()
);

-- =============================================
-- 2. results 테이블: 검색 + AI 요약 결과 저장
-- =============================================
create table if not exists results (
  id          uuid default gen_random_uuid() primary key,
  query_id    uuid references queries(id) on delete cascade,
  keyword     text not null,
  site        text,
  title       text,
  url         text,
  description text,
  thumbnail   text,
  summary     text,
  keywords    text[],
  created_at  timestamp with time zone default now()
);

-- =============================================
-- 3. RLS(Row Level Security) 설정
--    다른 사이트에서 POST /api/queries 호출 가능하도록
-- =============================================
alter table queries enable row level security;
alter table results enable row level security;

-- 서비스 롤은 모두 접근 가능 (API Route에서 사용)
create policy "service role full access on queries"
  on queries for all using (true);

create policy "service role full access on results"
  on results for all using (true);
