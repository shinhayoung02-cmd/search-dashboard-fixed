'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ResultCard from '@/components/ResultCard'
import SearchBar from '@/components/SearchBar'

const DB_QUERY_PAGE_SIZE = 1000

async function readJsonResponse(res) {
  const text = await res.text()
  let data

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('API가 JSON이 아닌 응답을 반환했습니다. 배포 로그를 확인하세요.')
  }

  if (!res.ok) {
    throw new Error(data.error || `API 요청 실패: ${res.status}`)
  }

  return data
}

function splitUrls(text = '') {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|\s+/)
        .map((v) => v.trim())
        .filter((v) => v.startsWith('http'))
    )
  )
}

function getSiteKey(item = {}) {
  const source = String(item.source || item.site || item.url || '').toLowerCase()

  if (source.includes('daangn')) return 'daangn'
  if (source.includes('cafe.naver')) return 'naverCafe'
  if (source.includes('clien')) return 'clien'
  if (source.includes('joongna')) return 'joongna'
  if (source.includes('bunjang')) return 'bunjang'

  return 'etc'
}

function pickDbQueryText(row = {}) {
  return String(
    row.display_query ||
      row.representative_query ||
      row.normalized_query ||
      row.query_text ||
      row.keyword ||
      row.text ||
      row.query ||
      ''
  ).trim()
}

function openGoogleSearch(query = '') {
  const q = String(query || '').trim()
  if (!q) return

  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

const SITE_META = {
  daangn: {
    label: '당근',
    sub: '당근 동네생활',
    headerClass: 'border-orange-200',
  },
  naverCafe: {
    label: '네이버 카페',
    sub: '네이버 카페 게시글',
    headerClass: 'border-green-200',
  },
  clien: {
    label: '클리앙',
    sub: '커뮤니티 게시글',
    headerClass: 'border-blue-200',
  },
  joongna: {
    label: '중고나라',
    sub: '중고거래 게시글',
    headerClass: 'border-yellow-200',
  },
  bunjang: {
    label: '번개장터',
    sub: '거래 게시글',
    headerClass: 'border-purple-200',
  },
  etc: {
    label: '기타',
    sub: '기타 웹 결과',
    headerClass: 'border-gray-200',
  },
}

function groupResultsBySite(items = []) {
  const order = ['daangn', 'naverCafe', 'clien', 'joongna', 'bunjang', 'etc']

  const grouped = items.reduce((acc, item) => {
    const key = getSiteKey(item)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  return order
    .filter((key) => grouped[key]?.length > 0)
    .map((key) => ({
      key,
      meta: SITE_META[key],
      items: grouped[key],
    }))
}

export default function Home() {
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const [queryMode, setQueryMode] = useState('raw')
  const [dbQueries, setDbQueries] = useState([])
  const [dbLoading, setDbLoading] = useState(false)

  const [dbQueryPage, setDbQueryPage] = useState(1)
  const [dbQueryTotal, setDbQueryTotal] = useState(0)
  const [dbQueryTotalPages, setDbQueryTotalPages] = useState(1)

  const [candidateQuery, setCandidateQuery] = useState('')
  const [candidateLimit, setCandidateLimit] = useState(20)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [selectedUrls, setSelectedUrls] = useState([])

  const [normalizing, setNormalizing] = useState(false)
  const [representing, setRepresenting] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchQueryLimit, setBatchQueryLimit] = useState(5)
  const [batchUrlLimit, setBatchUrlLimit] = useState(20)
  const [pipelineStats, setPipelineStats] = useState(null)

  const [manualUrls, setManualUrls] = useState('')
  const [crawlLoading, setCrawlLoading] = useState(false)

  const totalPages = Math.ceil(total / 12)

  const selectedCount = selectedUrls.length
  const manualUrlCount = useMemo(() => splitUrls(manualUrls).length, [manualUrls])
  const groupedResults = useMemo(() => groupResultsBySite(results), [results])

  const currentQueryListTitle =
    queryMode === 'raw'
      ? '정보찾아줌 원본 쿼리 목록'
      : '정제 대표 쿼리 목록'

  const currentQueryListDescription =
    queryMode === 'raw'
      ? '정보찾아줌에서 Supabase 저장한 원본 쿼리입니다. 클릭하면 단일 쿼리 입력창에 적용됩니다.'
      : '정제 후 대표 쿼리 만들기를 통해 생성된 대표 쿼리입니다. 클릭하면 단일 쿼리 입력창에 적용됩니다.'

  const fetchResults = useCallback(
    async (kw = keyword, pg = page) => {
      setLoading(true)
      setErrorMessage('')

      try {
        const params = new URLSearchParams({ page: String(pg) })
        if (kw) params.append('keyword', kw)

        const res = await fetch(`/api/results?${params.toString()}`)
        const data = await readJsonResponse(res)

        setResults(data.results || [])
        setTotal(data.total || 0)
      } catch (err) {
        setResults([])
        setTotal(0)
        setErrorMessage(err.message || '결과를 불러오지 못했습니다.')
      } finally {
        setLoading(false)
      }
    },
    [keyword, page]
  )

  useEffect(() => {
    fetchResults(keyword, page)
  }, [page])

  const handleSearch = (kw) => {
    setKeyword(kw)
    setPage(1)
    fetchResults(kw, 1)
  }

  const applyFirstQueryToInput = (rows = []) => {
    const firstQuery = rows.map(pickDbQueryText).find(Boolean)
    if (firstQuery) setCandidateQuery(firstQuery)
  }

  const fetchRawQueries = async (pageToLoad = 1) => {
    setQueryMode('raw')
    setDbLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const safePage = Math.max(1, Number(pageToLoad || 1))

      const params = new URLSearchParams({
        limit: String(DB_QUERY_PAGE_SIZE),
        page: String(safePage),
      })

      const res = await fetch(`/api/db-queries?${params.toString()}`)
      const data = await readJsonResponse(res)

      if (!data.ok) {
        throw new Error(data.error || '정보찾아줌 원본 쿼리를 불러오지 못했습니다.')
      }

      const rows = data.queries || []
      setDbQueries(rows)

      setDbQueryPage(data.page || safePage)
      setDbQueryTotal(data.total || 0)
      setDbQueryTotalPages(data.totalPages || 1)

      applyFirstQueryToInput(rows)

      setMessage(
        `정보찾아줌 원본 쿼리 ${rows.length}개를 불러왔습니다. ` +
          `현재 ${data.page || safePage}/${data.totalPages || 1}페이지, 전체 ${data.total || 0}개입니다.`
      )
    } catch (err) {
      setErrorMessage(err.message || '정보찾아줌 원본 쿼리를 불러오지 못했습니다.')
    } finally {
      setDbLoading(false)
    }
  }

  const fetchRepresentativeQueries = async () => {
    setQueryMode('representative')
    setDbLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/representative-queries?limit=1000')
      const data = await readJsonResponse(res)

      if (!data.ok) {
        throw new Error(data.error || '대표 쿼리를 불러오지 못했습니다.')
      }

      const rows = data.queries || []
      setDbQueries(rows)

      setDbQueryPage(1)
      setDbQueryTotal(data.total || rows.length)
      setDbQueryTotalPages(1)

      applyFirstQueryToInput(rows)

      setMessage(
        `정제 대표 쿼리 ${rows.length}개를 불러왔습니다. 첫 번째 쿼리를 단일 입력창에 적용했습니다.`
      )
    } catch (err) {
      setErrorMessage(err.message || '대표 쿼리를 불러오지 못했습니다.')
    } finally {
      setDbLoading(false)
    }
  }

  const handleNormalizeQueries = async () => {
    setQueryMode('representative')
    setNormalizing(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/queries/normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 500, onlyEmpty: true }),
      })

      const data = await readJsonResponse(res)

      if (!data.ok) {
        throw new Error(data.error || '쿼리 정제 실패')
      }

      setPipelineStats(data)
      setMessage(data.message || `정보찾아줌 쿼리 정제 완료: ${data.normalized_count || 0}개`)
    } catch (err) {
      setErrorMessage(err.message || '쿼리 정제 중 오류가 발생했습니다.')
    } finally {
      setNormalizing(false)
    }
  }

  const handleCreateRepresentatives = async () => {
    setQueryMode('representative')
    setRepresenting(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/queries/representatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20000 }),
      })

      const data = await readJsonResponse(res)

      if (!data.ok) {
        throw new Error(data.error || '대표 쿼리 생성 실패')
      }

      setPipelineStats(data)
      setMessage(data.message || `대표 쿼리 생성 완료: ${data.representative_count || 0}개`)

      await fetchRepresentativeQueries()
    } catch (err) {
      setErrorMessage(err.message || '대표 쿼리 생성 중 오류가 발생했습니다.')
    } finally {
      setRepresenting(false)
    }
  }

  const handleBatchRepresentativeSearch = async () => {
    setQueryMode('representative')
    setBatchLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/search-urls/batch-representatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryLimit: Number(batchQueryLimit || 5),
          urlLimit: Number(batchUrlLimit || 20),
          priorityMax: 4,
        }),
      })

      const data = await readJsonResponse(res)
      setPipelineStats(data)

      if (!data.ok && data.error) {
        setErrorMessage(data.error)
      } else {
        setMessage(data.message || '대표 쿼리 배치 수집 완료')
      }
    } catch (err) {
      setErrorMessage(err.message || '대표 쿼리 배치 수집 중 오류가 발생했습니다.')
    } finally {
      setBatchLoading(false)
    }
  }

  const handleCollectCandidates = async (override = {}) => {
    const query = String(override.query || candidateQuery).trim()
    const queryId = (override.query_id ?? null) || null

    if (!query && !queryId) {
      setErrorMessage('URL 후보를 수집할 쿼리 또는 DB 쿼리를 선택하세요.')
      return
    }

    setCandidateLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/search-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          query_id: queryId,
          limit: Number(candidateLimit || 20),
        }),
      })

      const data = await readJsonResponse(res)

      if (!data.ok) {
        setCandidates([])
        setSelectedUrls([])
        setErrorMessage(data.message || data.error || 'URL 후보 수집 실패')
        return
      }

      setCandidates(data.urls || [])
      setSelectedUrls((data.urls || []).map((item) => item.url).filter(Boolean))

      setMessage(
        `${data.provider === 'brave' ? 'Brave' : '검색 API'} URL 후보 ${data.urls?.length || 0}개를 불러왔습니다.`
      )
    } catch (err) {
      setErrorMessage(err.message || 'URL 후보 수집 중 오류가 발생했습니다.')
    } finally {
      setCandidateLoading(false)
    }
  }

  const toggleUrl = (url) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((item) => item !== url) : [...prev, url]
    )
  }

  const handleCrawlUrls = async (urls, kw = '직접 URL 수집') => {
    const finalUrls = Array.from(new Set(urls.filter(Boolean)))

    if (finalUrls.length === 0) {
      setErrorMessage('본문 수집할 URL이 없습니다.')
      return
    }

    setCrawlLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/crawl-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: kw || 'URL 본문 수집',
          urls: finalUrls,
        }),
      })

      const data = await readJsonResponse(res)

      if (!data.ok) {
        throw new Error(data.error || '본문 수집 실패')
      }

      setMessage(data.message || `본문 수집 완료: ${data.processed_count || 0}개`)
      fetchResults(keyword, 1)
    } catch (err) {
      setErrorMessage(err.message || '본문 수집 중 오류가 발생했습니다.')
    } finally {
      setCrawlLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-8 flex flex-col gap-4">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">검색 대시보드</h1>
              <p className="mt-1 text-sm text-gray-500">
                정보찾아줌 DB 쿼리 → URL 후보 → 본문 수집 / 정제 → 대표 쿼리 → 배치 수집 / 오류 있으면 카톡남겨주세요.
              </p>
            </div>

            <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:items-center">
              <SearchBar onSearch={handleSearch} />
            </div>
          </div>

          <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">사용법</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    정보찾아줌에서 쿼리를 생성한 뒤, 이 검색 대시보드에서 URL 후보 수집과 본문 수집을 진행합니다.
                  </p>
                </div>

                <a
                  href="https://jeongbochajajum.pages.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700"
                >
                  정보찾아줌 바로가기
                </a>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold text-indigo-500">STEP 1</p>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">쿼리 불러오기</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    정보찾아줌 원본 쿼리 또는 정제 대표 쿼리 버튼을 눌러 검색 쿼리 목록을 불러옵니다.
                  </p>
                </div>

                <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold text-indigo-500">STEP 2</p>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">쿼리 선택</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    쿼리 카드를 클릭하면 단일 쿼리 입력창에 적용되고, Google 검색 결과가 새 탭으로 열립니다.
                  </p>
                </div>

                <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold text-indigo-500">STEP 3</p>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">URL 후보 수집</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    검색 결과가 괜찮은 쿼리는 Brave URL 후보 수집 버튼을 눌러 관련 게시글 링크를 가져옵니다.
                  </p>
                </div>

                <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold text-indigo-500">STEP 4</p>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">본문 수집</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    필요한 URL을 선택하거나 직접 붙여넣어 게시글 제목, 본문, 날짜, 키워드를 수집합니다.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-xs leading-5 text-amber-800">
                  권장 방식: 쿼리를 무작정 많이 돌리기보다, Google에서 먼저 검색 결과가 나오는지 확인한 뒤
                  의미 있는 쿼리만 URL 후보 수집으로 넘기는 것이 좋습니다.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
              <div>
                <h2 className="text-lg font-bold text-gray-800">쿼리 소스 선택</h2>
                <p className="mt-1 text-sm text-gray-500">
                  원본 쿼리는 정보찾아줌에서 저장된 쿼리를 그대로 사용하고, 대표 쿼리는 정제 후 압축된 쿼리를 사용합니다.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fetchRawQueries(1)}
                  disabled={dbLoading}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                    queryMode === 'raw'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {dbLoading && queryMode === 'raw'
                    ? '불러오는 중...'
                    : '정보찾아줌 원본 쿼리'}
                </button>

                <button
                  type="button"
                  onClick={fetchRepresentativeQueries}
                  disabled={dbLoading}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                    queryMode === 'representative'
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 text-purple-700'
                  }`}
                >
                  {dbLoading && queryMode === 'representative'
                    ? '불러오는 중...'
                    : '정제 대표 쿼리'}
                </button>
              </div>
            </div>

            {queryMode === 'representative' && (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={handleNormalizeQueries}
                    disabled={normalizing}
                    className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {normalizing ? '정제 중...' : '쿼리 정제하기'}
                  </button>

                  <button
                    onClick={handleCreateRepresentatives}
                    disabled={representing}
                    className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {representing ? '생성 중...' : '대표 쿼리 만들기'}
                  </button>
                </div>

                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
                  <label className="text-sm text-gray-600">
                    대표 쿼리 처리 개수
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={batchQueryLimit}
                      onChange={(e) => setBatchQueryLimit(e.target.value)}
                      className="mt-1 block w-32 rounded-xl border px-3 py-2"
                    />
                  </label>

                  <label className="text-sm text-gray-600">
                    쿼리당 URL 후보
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={batchUrlLimit}
                      onChange={(e) => setBatchUrlLimit(e.target.value)}
                      className="mt-1 block w-32 rounded-xl border px-3 py-2"
                    />
                  </label>

                  <button
                    onClick={handleBatchRepresentativeSearch}
                    disabled={batchLoading}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {batchLoading ? '배치 수집 중...' : '대표 쿼리 배치 URL 후보 수집'}
                  </button>

                  <p className="text-xs text-gray-500">
                    권장값: 5개 × 후보 20개
                  </p>
                </div>
              </>
            )}

            {pipelineStats && (
              <details className="mt-4 rounded-xl bg-slate-900 text-slate-100">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
                  처리 로그 보기
                </summary>
                <pre className="max-h-56 overflow-auto p-3 text-xs">
                  {JSON.stringify(pipelineStats, null, 2)}
                </pre>
              </details>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-gray-800">단일 쿼리 URL 후보 수집</h2>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_120px_auto]">
              <input
                value={candidateQuery}
                onChange={(e) => setCandidateQuery(e.target.value)}
                placeholder='예: site:daangn.com "분실물" "잃어버림"'
                className="rounded-xl border px-3 py-2"
              />

              <input
                type="number"
                min="1"
                max="20"
                value={candidateLimit}
                onChange={(e) => setCandidateLimit(e.target.value)}
                className="rounded-xl border px-3 py-2"
              />

              <button
                onClick={() => handleCollectCandidates()}
                disabled={candidateLoading}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {candidateLoading ? '수집 중...' : 'Brave URL 후보 수집'}
              </button>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-500">
              클릭 시 Brave Search API가 1회 호출됩니다. 입력한 쿼리 그대로 검색하며, 결과 품질은 쿼리 조건에 따라 달라질 수 있습니다.
            </p>

            {dbQueries.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-800">
                      {currentQueryListTitle}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {currentQueryListDescription}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {queryMode === 'raw' && (
                      <>
                        <span className="rounded-full border bg-white px-3 py-1 text-xs font-semibold text-gray-600">
                          {dbQueryPage} / {dbQueryTotalPages} 페이지
                        </span>

                        <span className="rounded-full border bg-white px-3 py-1 text-xs font-semibold text-gray-600">
                          전체 {dbQueryTotal.toLocaleString()}개
                        </span>

                        <button
                          type="button"
                          onClick={() => fetchRawQueries(1)}
                          disabled={dbLoading || dbQueryPage === 1}
                          className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
                        >
                          처음
                        </button>

                        <button
                          type="button"
                          onClick={() => fetchRawQueries(dbQueryPage - 1)}
                          disabled={dbLoading || dbQueryPage <= 1}
                          className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
                        >
                          이전 1000개
                        </button>

                        <button
                          type="button"
                          onClick={() => fetchRawQueries(dbQueryPage)}
                          disabled={dbLoading}
                          className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
                        >
                          새로고침
                        </button>

                        <button
                          type="button"
                          onClick={() => fetchRawQueries(dbQueryPage + 1)}
                          disabled={dbLoading || dbQueryPage >= dbQueryTotalPages}
                          className="rounded-lg border bg-slate-800 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          다음 1000개
                        </button>
                      </>
                    )}

                    {queryMode === 'representative' && (
                      <>
                        <span className="rounded-full border bg-white px-3 py-1 text-xs font-semibold text-gray-600">
                          대표 쿼리 {dbQueries.length.toLocaleString()}개
                        </span>

                        <button
                          type="button"
                          onClick={fetchRepresentativeQueries}
                          disabled={dbLoading}
                          className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
                        >
                          새로고침
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid max-h-80 grid-cols-1 gap-2 overflow-auto lg:grid-cols-2 xl:grid-cols-3">
                  {dbQueries.map((row, index) => {
                    const q = pickDbQueryText(row)

                    return (
                      <button
                        key={row.id || `${q}-${index}`}
                        type="button"
                        onClick={() => {
                          setCandidateQuery(q)
                          openGoogleSearch(q)
                        }}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          candidateQuery === q
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-gray-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="mb-1 text-[11px] text-gray-400">
                          {row.source_table || 'query'} · {row.candidate_status || 'pending'}
                        </div>
                        <div className="line-clamp-2 font-semibold leading-5">{q}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {candidates.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    URL 후보 {candidates.length}개 / 선택 {selectedCount}개
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedUrls(candidates.map((item) => item.url))}
                      className="rounded-lg border px-3 py-1 text-sm"
                    >
                      전체 선택
                    </button>

                    <button
                      onClick={() => setSelectedUrls([])}
                      className="rounded-lg border px-3 py-1 text-sm"
                    >
                      전체 해제
                    </button>

                    <button
                      onClick={() => handleCrawlUrls(selectedUrls, candidateQuery)}
                      disabled={crawlLoading || selectedCount === 0}
                      className="rounded-lg bg-slate-800 px-3 py-1 text-sm text-white disabled:opacity-50"
                    >
                      선택 URL 본문 수집
                    </button>
                  </div>
                </div>

                <div className="max-h-72 overflow-auto rounded-xl border divide-y">
                  {candidates.map((item) => (
                    <label key={item.url} className="flex gap-3 p-3 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedUrls.includes(item.url)}
                        onChange={() => toggleUrl(item.url)}
                      />

                      <div>
                        <p className="font-semibold text-gray-800">{item.title || item.url}</p>
                        <p className="line-clamp-2 text-gray-500">{item.snippet}</p>
                        <p className="mt-1 break-all text-xs text-emerald-700">{item.url}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-gray-800">URL 직접 붙여넣기 본문 수집</h2>
            <p className="mt-1 text-sm text-gray-500">
              검색 API가 막혔을 때 URL 여러 개를 직접 붙여넣어 본문만 수집합니다.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
              <textarea
                value={manualUrls}
                onChange={(e) => setManualUrls(e.target.value)}
                rows={4}
                placeholder="URL을 줄바꿈으로 붙여넣기"
                className="rounded-xl border px-3 py-2"
              />

              <button
                onClick={() =>
                  handleCrawlUrls(
                    splitUrls(manualUrls),
                    candidateQuery || '직접 URL 수집'
                  )
                }
                disabled={crawlLoading || manualUrlCount === 0}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {crawlLoading ? '수집 중...' : `URL ${manualUrlCount}개 본문 수집`}
              </button>
            </div>
          </section>

          {message && (
            <div className="rounded-xl border-l-4 border-indigo-400 bg-white px-4 py-3 text-sm text-gray-700 shadow">
              {message}
            </div>
          )}

          {errorMessage && (
            <div className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        <p className="mb-4 text-sm text-gray-500">총 {total}개 결과</p>

        {loading ? (
          <div className="py-20 text-center text-lg text-gray-400">불러오는 중...</div>
        ) : results.length === 0 ? (
          <div className="py-20 text-center text-gray-400">
            <p className="mb-3 text-4xl">📭</p>
            <p>결과가 없습니다. URL 후보를 수집하거나 직접 URL을 붙여넣어보세요.</p>
          </div>
        ) : (
          <div className="space-y-12">
            {groupedResults.map((group) => (
              <section key={group.key} className="space-y-4">
                <div className={`flex items-end justify-between border-b pb-2 ${group.meta.headerClass}`}>
                  <div>
                    <h2 className="text-xl font-extrabold tracking-tight text-gray-900">
                      {group.meta.label}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">{group.meta.sub}</p>
                  </div>

                  <div className="text-sm font-semibold text-gray-400">
                    {group.items.length}개
                  </div>
                </div>

                <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((item) => (
                    <div key={item.id || item.url} className="min-w-0 w-full">
                      <ResultCard item={item} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`h-9 w-9 rounded-full text-sm font-semibold transition ${
                  p === page
                    ? 'bg-indigo-500 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-indigo-50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}