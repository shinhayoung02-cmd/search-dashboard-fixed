'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ResultCard from '@/components/ResultCard'
import SearchBar from '@/components/SearchBar'

async function readJsonResponse(res) {
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('API가 JSON이 아닌 응답을 반환했습니다. 배포 로그를 확인하세요.')
  }
  if (!res.ok) throw new Error(data.error || `API 요청 실패: ${res.status}`)
  return data
}

function splitUrls(text = '') {
  return Array.from(new Set(
    text
      .split(/\r?\n|\s+/)
      .map((v) => v.trim())
      .filter((v) => v.startsWith('http'))
  ))
}

export default function Home() {
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const [dbQueries, setDbQueries] = useState([])
  const [dbLoading, setDbLoading] = useState(false)

  const [candidateQuery, setCandidateQuery] = useState('site:daangn.com 분실물')
  const [candidateLimit, setCandidateLimit] = useState(10)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [selectedUrls, setSelectedUrls] = useState([])

  const [normalizing, setNormalizing] = useState(false)
  const [representing, setRepresenting] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchQueryLimit, setBatchQueryLimit] = useState(20)
  const [batchUrlLimit, setBatchUrlLimit] = useState(10)
  const [pipelineStats, setPipelineStats] = useState(null)

  const [manualKeyword, setManualKeyword] = useState('당근 분실물')
  const [manualUrls, setManualUrls] = useState('')
  const [crawlLoading, setCrawlLoading] = useState(false)

  const totalPages = Math.ceil(total / 12)

  const selectedCount = selectedUrls.length
  const manualUrlCount = useMemo(() => splitUrls(manualUrls).length, [manualUrls])

  const fetchResults = useCallback(async (kw = keyword, pg = page) => {
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
  }, [keyword, page])

  useEffect(() => {
    fetchResults(keyword, page)
  }, [page])

  const handleSearch = (kw) => {
    setKeyword(kw)
    setPage(1)
    fetchResults(kw, 1)
  }

  const fetchDbQueries = async () => {
    setDbLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/queries')
      const data = await readJsonResponse(res)
      setDbQueries(data.queries || [])
      setMessage(`DB 쿼리 ${data.queries?.length || 0}개를 불러왔습니다.`)
    } catch (err) {
      setErrorMessage(err.message || 'DB 쿼리를 불러오지 못했습니다.')
    } finally {
      setDbLoading(false)
    }
  }

  const handleNormalizeQueries = async () => {
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
      if (!data.ok) throw new Error(data.error || '쿼리 정제 실패')
      setPipelineStats(data)
      setMessage(data.message || `쿼리 정제 완료: ${data.normalized_count || 0}개`)
      fetchDbQueries()
    } catch (err) {
      setErrorMessage(err.message || '쿼리 정제 중 오류가 발생했습니다.')
    } finally {
      setNormalizing(false)
    }
  }

  const handleCreateRepresentatives = async () => {
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
      if (!data.ok) throw new Error(data.error || '대표 쿼리 생성 실패')
      setPipelineStats(data)
      setMessage(data.message || `대표 쿼리 생성 완료: ${data.representative_count || 0}개`)
    } catch (err) {
      setErrorMessage(err.message || '대표 쿼리 생성 중 오류가 발생했습니다.')
    } finally {
      setRepresenting(false)
    }
  }

  const handleBatchRepresentativeSearch = async () => {
    setBatchLoading(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/search-urls/batch-representatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryLimit: Number(batchQueryLimit || 20),
          urlLimit: Number(batchUrlLimit || 10),
          priorityMax: 4,
        }),
      })
      const data = await readJsonResponse(res)
      setPipelineStats(data)

      if (data.stop_reason === 'GOOGLE_API_429') {
        setErrorMessage(data.message || 'Google API 할당량이 초과되었습니다.')
      } else if (!data.ok && data.error) {
        setErrorMessage(data.error)
      } else {
        setMessage(data.message || `대표 쿼리 배치 수집 완료`)
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
          limit: Number(candidateLimit || 10),
        }),
      })
      const data = await readJsonResponse(res)

      if (!data.ok) {
        setCandidates([])
        setSelectedUrls([])
        setErrorMessage(data.message || data.error || data.google_status || 'URL 후보 수집 실패')
        return
      }

      setCandidates(data.urls || [])
      setSelectedUrls((data.urls || []).map((item) => item.url).filter(Boolean))
      setMessage(`${data.cached ? '캐시된' : '새'} URL 후보 ${data.urls?.length || 0}개를 불러왔습니다.`)
    } catch (err) {
      setErrorMessage(err.message || 'URL 후보 수집 중 오류가 발생했습니다.')
    } finally {
      setCandidateLoading(false)
    }
  }

  const toggleUrl = (url) => {
    setSelectedUrls((prev) => (
      prev.includes(url) ? prev.filter((item) => item !== url) : [...prev, url]
    ))
  }

  const handleCrawlUrls = async (urls, kw = manualKeyword) => {
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
        body: JSON.stringify({ keyword: kw || 'URL 본문 수집', urls: finalUrls }),
      })
      const data = await readJsonResponse(res)
      if (!data.ok) throw new Error(data.error || '본문 수집 실패')
      setMessage(data.message || `본문 수집 완료: ${data.processed_count || 0}개`)
      fetchResults(keyword, 1)
    } catch (err) {
      setErrorMessage(err.message || '본문 수집 중 오류가 발생했습니다.')
    } finally {
      setCrawlLoading(false)
    }
  }

  return (
    <main className="min-h-screen p-6 bg-slate-50">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">검색 대시보드</h1>
              <p className="text-sm text-gray-500 mt-1">정보찾아줌 DB 쿼리 → 대표 쿼리 → URL 후보 → 본문 수집</p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
              <SearchBar onSearch={handleSearch} />
            </div>
          </div>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-800">대량 처리 파이프라인</h2>
                <p className="text-sm text-gray-500 mt-1">1만 개 쿼리를 그대로 돌리지 않고 정제·대표화한 뒤 대표 쿼리만 URL 후보 수집합니다.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={fetchDbQueries} disabled={dbLoading} className="px-4 py-2 rounded-xl bg-slate-800 text-white text-sm font-semibold disabled:opacity-50">
                  {dbLoading ? '불러오는 중...' : 'DB 쿼리 불러오기'}
                </button>
                <button onClick={handleNormalizeQueries} disabled={normalizing} className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50">
                  {normalizing ? '정제 중...' : '쿼리 정제하기'}
                </button>
                <button onClick={handleCreateRepresentatives} disabled={representing} className="px-4 py-2 rounded-xl bg-purple-500 text-white text-sm font-semibold disabled:opacity-50">
                  {representing ? '생성 중...' : '대표 쿼리 만들기'}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col md:flex-row md:items-end gap-3">
              <label className="text-sm text-gray-600">
                대표 쿼리 처리 개수
                <input type="number" min="1" max="100" value={batchQueryLimit} onChange={(e) => setBatchQueryLimit(e.target.value)} className="block mt-1 w-32 px-3 py-2 border rounded-xl" />
              </label>
              <label className="text-sm text-gray-600">
                쿼리당 URL 후보
                <input type="number" min="1" max="30" value={batchUrlLimit} onChange={(e) => setBatchUrlLimit(e.target.value)} className="block mt-1 w-32 px-3 py-2 border rounded-xl" />
              </label>
              <button onClick={handleBatchRepresentativeSearch} disabled={batchLoading} className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                {batchLoading ? '배치 수집 중...' : '대표 쿼리 배치 URL 후보 수집'}
              </button>
              <p className="text-xs text-gray-500">예: 20개 × 후보 10개 = Google API 약 20회 사용</p>
            </div>

            {pipelineStats && (
              <pre className="mt-4 p-3 bg-slate-900 text-slate-100 rounded-xl text-xs overflow-auto max-h-56">
                {JSON.stringify(pipelineStats, null, 2)}
              </pre>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-lg font-bold text-gray-800">단일 쿼리 URL 후보 수집</h2>
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_120px_auto] gap-3">
              <input value={candidateQuery} onChange={(e) => setCandidateQuery(e.target.value)} placeholder='예: site:daangn.com "분실물" "잃어버림"' className="px-3 py-2 border rounded-xl" />
              <input type="number" min="1" max="30" value={candidateLimit} onChange={(e) => setCandidateLimit(e.target.value)} className="px-3 py-2 border rounded-xl" />
              <button onClick={() => handleCollectCandidates()} disabled={candidateLoading} className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                {candidateLoading ? '수집 중...' : 'URL 후보 수집'}
              </button>
            </div>

            {candidates.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">URL 후보 {candidates.length}개 / 선택 {selectedCount}개</p>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedUrls(candidates.map((item) => item.url))} className="px-3 py-1 rounded-lg border text-sm">전체 선택</button>
                    <button onClick={() => setSelectedUrls([])} className="px-3 py-1 rounded-lg border text-sm">전체 해제</button>
                    <button onClick={() => handleCrawlUrls(selectedUrls, candidateQuery)} disabled={crawlLoading || selectedCount === 0} className="px-3 py-1 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50">선택 URL 본문 수집</button>
                  </div>
                </div>
                <div className="max-h-72 overflow-auto border rounded-xl divide-y">
                  {candidates.map((item) => (
                    <label key={item.url} className="flex gap-3 p-3 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={selectedUrls.includes(item.url)} onChange={() => toggleUrl(item.url)} />
                      <div>
                        <p className="font-semibold text-gray-800">{item.title || item.url}</p>
                        <p className="text-gray-500 line-clamp-2">{item.snippet}</p>
                        <p className="text-xs text-emerald-700 break-all mt-1">{item.url}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-lg font-bold text-gray-800">URL 직접 붙여넣기 본문 수집</h2>
            <p className="text-sm text-gray-500 mt-1">Google API가 막혔을 때 URL 여러 개를 직접 붙여넣어 본문만 수집합니다.</p>
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_1fr_auto] gap-3">
              <input value={manualKeyword} onChange={(e) => setManualKeyword(e.target.value)} placeholder="키워드" className="px-3 py-2 border rounded-xl" />
              <textarea value={manualUrls} onChange={(e) => setManualUrls(e.target.value)} rows={4} placeholder="URL을 줄바꿈으로 붙여넣기" className="px-3 py-2 border rounded-xl" />
              <button onClick={() => handleCrawlUrls(splitUrls(manualUrls), manualKeyword)} disabled={crawlLoading || manualUrlCount === 0} className="px-4 py-2 rounded-xl bg-slate-800 text-white text-sm font-semibold disabled:opacity-50">
                {crawlLoading ? '수집 중...' : `URL ${manualUrlCount}개 본문 수집`}
              </button>
            </div>
          </section>

          {message && (
            <div className="px-4 py-3 bg-white rounded-xl shadow text-sm text-gray-700 border-l-4 border-indigo-400">
              {message}
            </div>
          )}
          {errorMessage && (
            <div className="px-4 py-3 bg-red-50 rounded-xl text-sm text-red-700 border border-red-200 whitespace-pre-wrap">
              {errorMessage}
            </div>
          )}
        </div>

        <p className="text-sm text-gray-500 mb-4">총 {total}개 결과</p>

        {loading ? (
          <div className="text-center py-20 text-gray-400 text-lg">불러오는 중...</div>
        ) : results.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p>결과가 없습니다. URL 후보를 수집하거나 직접 URL을 붙여넣어보세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {results.map((item) => <ResultCard key={item.id} item={item} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex flex-wrap justify-center gap-2 mt-10">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)} className={`w-9 h-9 rounded-full text-sm font-semibold transition ${p === page ? 'bg-indigo-500 text-white' : 'bg-white text-gray-600 hover:bg-indigo-50 border border-gray-200'}`}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
