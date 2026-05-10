# 검색 대시보드 — 수정본

키워드를 수집하여 네이버/구글 검색 결과를 저장하고, AI 요약 카드로 보여주는 Next.js 대시보드입니다.

## 수정된 핵심 문제

- `/api/results` 500 오류가 HTML 에러 페이지로 반환되어 `Unexpected token '<'`가 발생하던 문제를 방어했습니다.
- Supabase 환경변수 누락 시 서버가 import 단계에서 터지지 않도록 `getSupabaseAdmin()` 방식으로 변경했습니다.
- API Route 전체에 `try/catch`를 추가해 오류를 JSON으로 반환하도록 수정했습니다.
- 프론트 `page.js`에서 `res.json()`을 바로 호출하지 않고, 응답 텍스트를 먼저 확인한 뒤 JSON 파싱하도록 수정했습니다.
- OpenAI, Naver, Google API 키가 없을 때 앱 전체가 중단되지 않도록 fallback 처리를 추가했습니다.

## 폴더 구조

```txt
app/
  api/
    crawl/route.js
    queries/route.js
    results/route.js
  globals.css
  layout.js
  page.js
components/
  ResultCard.jsx
  SearchBar.jsx
lib/
  aiSummary.js
  searchApis.js
  supabase.js
.env.local.example
package.json
supabase_schema.sql
```

## 설치

```bash
npm install
```

## 환경변수 설정

`.env.local.example`을 복사해서 `.env.local`을 만드세요.

```bash
cp .env.local.example .env.local
```

`.env.local`에 실제 키를 넣어야 합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

OPENAI_API_KEY=sk-xxxx

NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

GOOGLE_API_KEY=your_google_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
```

수정 후 반드시 개발 서버를 다시 켜세요.

```bash
npm run dev
```

## Supabase 설정

Supabase SQL Editor에서 `supabase_schema.sql` 내용을 실행하세요.

필수 테이블:

- `queries`
- `results`

## 실행

```bash
npm run dev
```

브라우저에서 접속:

```txt
http://localhost:3000
```

## 테스트용 쿼리 등록

브라우저 콘솔 또는 다른 페이지에서 아래처럼 등록할 수 있습니다.

```js
fetch('http://localhost:3000/api/queries', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    keyword: '분실물 확인 루틴',
    source: 'manual-test'
  })
})
```

그 다음 대시보드에서 `새 키워드 수집` 버튼을 누르면 됩니다.
