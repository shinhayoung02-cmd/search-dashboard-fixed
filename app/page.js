'use client'

import { useEffect, useState, useCallback } from 'react'
import ResultCard from '@/components/ResultCard'
import SearchBar from '@/components/SearchBar'

async function readJsonResponse(res) {
  const text = await res.text()

  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (err) {
    console.error('[readJsonResponse] JSON이 아닌 응답:', text)
    throw new Error('API가 JSON이 아닌 응답을 반환했습니다. 터미널의 npm run dev 에러를 확인하세요.')
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || `API 요청 실패: ${res.status}`)
  }

  return data
}

function getQueryText(row) {
  return String(row?.query_text || row?.keyword || row?.text || row?.query || '').trim()
}

export default function Home() {
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const [dbQueries, setDbQueries] = useState([])
  const [dbQueriesLoading, setDbQueriesLoading] = useState(false)
  const [selectedDbQueryId, setSelectedDbQueryId] = useState('')
  const [dbQueryInfo, setDbQueryInfo] = useState('')

  const [candidateQuery, setCandidateQuery] = useState('site:daangn.com 분실물')
  const [candidateLimit, setCandidateLimit] = useState(5)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidateUrls, setCandidateUrls] = useState([])
  const [selectedUrls, setSelectedUrls] = useState([])
  const [candidateInfo, setCandidateInfo] = useState('')
  const [manualUrls, setManualUrls] = useState('')

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
      console.error('[fetchResults] error:', err)
      setResults([])
      setTotal(0)
      setErrorMessage(err.message || '결과를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [keyword, page])

  const loadDbQueries = useCallback(async () => {
    setDbQueriesLoading(true)
    setDbQueryInfo('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/queries')
      const data = await readJsonResponse(res)
      const rows = data.queries || []

      setDbQueries(rows)

      if (rows.length > 0) {
        const first = rows[0]
        const firstText = getQueryText(first)
        setSelectedDbQueryId(first.id)
        setCandidateQuery(firstText)
        setDbQueryInfo(`DB에서 미처리 쿼리 ${rows.length}개를 불러왔습니다. 첫 번째 쿼리를 입력창에 자동 적용했습니다.`)
      } else {
        setSelectedDbQueryId('')
        setDbQueryInfo('DB에 미처리 쿼리가 없습니다. 정보찾아줌에서 쿼리를 먼저 저장하세요.')
      }
    } catch (err) {
      console.error('[loadDbQueries] error:', err)
      setErrorMessage(err.message || 'DB 쿼리 목록을 불러오지 못했습니다.')
    } finally {
      setDbQueriesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchResults(keyword, page)
  }, [page, fetchResults])

  useEffect(() => {
    loadDbQueries()
  }, [loadDbQueries])

  const handleSearch = (kw) => {
    setKeyword(kw)
    setPage(1)
    fetchResults(kw, 1)
  }

  const handleUseDbQuery = (row) => {
    const text = getQueryText(row)
    setSelectedDbQueryId(row.id)
    setCandidateQuery(text)
    setCandidateUrls([])
    setSelectedUrls([])
    setCandidateInfo(`선택한 DB 쿼리를 입력창에 적용했습니다: ${text}`)
  }

  const handleCrawl = async () => {
    setCrawling(true)
    setMessage('')
    setErrorMessage('')

    try {
      const res = await fetch('/api/crawl', { method: 'POST' })
      const data = await readJsonResponse(res)

      const processedCount = data.processed?.length || 0
      const failedCount = data.failed?.length || 0

      if (data.stopped && data.stop_reason === 'GOOGLE_API_429') {
        setMessage(data.message || 'Google Search API 할당량이 초과되었습니다.')
        return
      }

      if (processedCount > 0) {
        setMessage(`처리 완료: ${processedCount}개 키워드 / 실패: ${failedCount}개`)
        fetchResults(keyword, 1)
      } else {
        setMessage(data.message || `처리된 키워드가 없습니다. 실패: ${failedCount}개`)
      }
    } catch (err) {
      console.error('[handleCrawl] error:', err)
      setErrorMessage(err.message || '새 키워드 수집 중 오류가 발생했습니다.')
    } finally {
      setCrawling(false)
    }
  }

  const handleCollectCandidates = async (override = {}) => {
    const query = String(override.query || candidateQuery).trim()
    const queryId = (override.query_id ?? selectedDbQueryId) || null
    if (!query && !queryId) {
      setErrorMessage('URL 후보를 수집할 쿼리 또는 DB 쿼리를 선택하세요.')
      return
    }

    setCandidateLoading(true)
    setMessage('')
    setErrorMessage('')
    setCandidateInfo('')

    try {
      const res = await fetch('/api/search-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          query_id: queryId,
          limit: Number(candidateLimit) || 5,
        }),
      })

      const data = await readJsonResponse(res)

      if (!data.ok) {
        setCandidateUrls([])
        setSelectedUrls([])
        setCandidateInfo(data.message || `URL 후보 수집 실패: ${data.google_status || 'unknown'}`)
        return
      }

      const urls = data.urls || []
      setCandidateUrls(urls)
      setSelectedUrls(urls.map((item) => item.url))
      setCandidateQuery(data.query || query)
      if (data.query_id) setSelectedDbQueryId(data.query_id)

      setCandidateInfo(
        data.from_cache
          ? `오늘 이미 수집한 URL 후보 ${urls.length}개를 불러왔습니다.`
          : `URL 후보 ${urls.length}개를 수집했습니다.`
      )
    } catch (err) {
      console.error('[handleCollectCandidates] error:', err)
      setErrorMessage(err.message || 'URL 후보 수집 중 오류가 발생했습니다.')
    } finally {
      setCandidateLoading(false)
    }
  }

  const handleCollectOneDbQuery = async (row) => {
    const text = getQueryText(row)
    setSelectedDbQueryId(row.id)
    setCandidateQuery(text)
    await handleCollectCandidates({ query: text, query_id: row.id })
  }

  const handleCollectFromDbQueries = async () => {
    setCandidateLoading(true)
    setMessage('')
    setErrorMessage('')
    setCandidateInfo('')

    try {
      const res = await fetch('/api/search-urls/from-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_limit: 3,
          url_limit: Number(candidateLimit) || 5,
        }),
      })

      const data = await readJsonResponse(res)

      if (data.stopped && data.stop_reason === 'GOOGLE_API_429') {
        setCandidateInfo(data.message || 'Google Search API 할당량이 초과되어 DB 쿼리 후보 수집을 중단했습니다.')
        return
      }

      const firstProcessed = data.processed?.[0]
      const urls = firstProcessed?.urls || []

      if (firstProcessed) {
        setSelectedDbQueryId(firstProcessed.query_id)
        setCandidateQuery(firstProcessed.query_text)
        setCandidateUrls(urls)
        setSelectedUrls(urls.map((item) => item.url))
      }

      setCandidateInfo(
        `DB 쿼리 자동 후보 수집: 성공 ${data.processed_count || 0}개 / 실패 ${data.failed_count || 0}개. 화면에는 첫 번째 성공 쿼리의 URL 후보를 표시합니다.`
      )
    } catch (err) {
      console.error('[handleCollectFromDbQueries] error:', err)
      setErrorMessage(err.message || 'DB 쿼리 자동 후보 수집 중 오류가 발생했습니다.')
    } finally {
      setCandidateLoading(false)
    }
  }

  const toggleSelectedUrl = (url) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((item) => item !== url) : [...prev, url]
    )
  }

  const handleCrawlUrls = async (urls) => {
    const cleanUrls = urls.map((url) => String(url || '').trim()).filter(Boolean)

    if (cleanUrls.length === 0) {
      setErrorMessage('본문을 수집할 URL을 선택하거나 입력하세요.')
      return
    }

    setCrawling(true)
    setMessage('')
    setErrorMessage('')

    try {
      const selectedCandidate = candidateUrls.find((item) => cleanUrls.includes(item.url))
      const queryId = selectedCandidate?.query_id || selectedDbQueryId || null
      const queryText = selectedCandidate?.query_text || candidateQuery || keyword || 'URL 후보 수집'

      const res = await fetch('/api/crawl-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_id: queryId,
          keyword: queryText,
          urls: cleanUrls,
        }),
      })

      const data = await readJsonResponse(res)

      setMessage(`본문 수집 완료: ${data.processed_count || 0}개 / 실패: ${data.failed_count || 0}개`)
      fetchResults(keyword, 1)
      loadDbQueries()
    } catch (err) {
      console.error('[handleCrawlUrls] error:', err)
      setErrorMessage(err.message || 'URL 본문 수집 중 오류가 발생했습니다.')
    } finally {
      setCrawling(false)
    }
  }

  const handleCrawlOneCandidate = async (item) => {
    await handleCrawlUrls([item.url])
  }

  const handleManualCrawl = async () => {
    const urls = manualUrls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)

    await handleCrawlUrls(urls)
  }

  const selectedDbQuery = dbQueries.find((row) => row.id === selectedDbQueryId)
  const totalPages = Math.ceil(total / 12)

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">검색 대시보드</h1>
            <p className="text-sm text-gray-500 mt-1">키워드별 검색 결과 자동 요약</p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            <SearchBar onSearch={handleSearch} />
            <button
              onClick={handleCrawl}
              disabled={crawling}
              className="bg-emerald-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50 transition whitespace-nowrap"
            >
              {crawling ? '처리 중...' : '새 키워드 수집'}
            </button>
          </div>
        </div>

        <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">정보찾아줌 DB 쿼리 연동</p>
              <p className="text-xs text-gray-500 mt-1">queries 테이블의 미처리 쿼리를 자동으로 불러와 URL 후보 수집 입력값으로 사용합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={loadDbQueries}
                disabled={dbQueriesLoading}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {dbQueriesLoading ? '불러오는 중...' : 'DB 쿼리 불러오기'}
              </button>
              <button
                onClick={handleCollectFromDbQueries}
                disabled={candidateLoading || dbQueries.length === 0}
                className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-600 disabled:opacity-50"
              >
                DB 쿼리 3개 후보 자동 수집
              </button>
            </div>
          </div>

          {dbQueryInfo && (
            <div className="mb-4 px-4 py-2 bg-slate-50 text-slate-700 rounded-xl text-sm">
              {dbQueryInfo}
            </div>
          )}

          {dbQueries.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-h-80 overflow-auto pr-1">
              {dbQueries.map((row) => {
                const text = getQueryText(row)
                const selected = row.id === selectedDbQueryId

                return (
                  <div
                    key={row.id}
                    className={`rounded-xl border p-3 ${selected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2 mb-2">
                          <span className="px-2 py-1 rounded-full bg-white text-xs font-semibold text-gray-600 border border-gray-200">
                            {row.source || 'query'}
                          </span>
                          <span className="px-2 py-1 rounded-full bg-white text-xs font-semibold text-gray-600 border border-gray-200">
                            {row.processed ? 'processed' : 'pending'}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 break-words">{text || '쿼리 없음'}</p>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => handleUseDbQuery(row)}
                          className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                          입력 적용
                        </button>
                        <button
                          onClick={() => handleCollectOneDbQuery(row)}
                          disabled={candidateLoading || !text}
                          className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 disabled:opacity-50"
                        >
                          후보 수집
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">불러온 DB 쿼리가 없습니다.</p>
          )}
        </section>

        <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-800 mb-2">쿼리로 URL 후보 수집</p>
              <input
                value={candidateQuery}
                onChange={(event) => {
                  setCandidateQuery(event.target.value)
                  setSelectedDbQueryId('')
                }}
                placeholder='예: site:daangn.com "분실물" "신고"'
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              {selectedDbQuery && (
                <p className="text-xs text-indigo-600 mt-2">현재 DB 쿼리와 연결됨: {getQueryText(selectedDbQuery)}</p>
              )}
            </div>

            <div className="w-full lg:w-28">
              <p className="text-sm font-semibold text-gray-800 mb-2">개수</p>
              <input
                type="number"
                min="1"
                max="10"
                value={candidateLimit}
                onChange={(event) => setCandidateLimit(event.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <button
              onClick={() => handleCollectCandidates()}
              disabled={candidateLoading}
              className="px-5 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-600 disabled:opacity-50 whitespace-nowrap"
            >
              {candidateLoading ? '수집 중...' : 'URL 후보 수집'}
            </button>

            <button
              onClick={() => handleCrawlUrls(selectedUrls)}
              disabled={crawling || selectedUrls.length === 0}
              className="px-5 py-3 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-50 whitespace-nowrap"
            >
              선택 URL 본문 수집
            </button>
          </div>

          {candidateInfo && (
            <div className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm">
              {candidateInfo}
            </div>
          )}

          {candidateUrls.length > 0 && (
            <div className="mt-4 space-y-3">
              {candidateUrls.map((item) => (
                <div key={item.url} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedUrls.includes(item.url)}
                      onChange={() => toggleSelectedUrl(item.url)}
                      className="mt-1"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="px-2 py-1 rounded-full bg-white text-xs font-semibold text-gray-600 border border-gray-200">
                          {item.source || 'source'}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700">
                          {item.status || 'collected'}
                        </span>
                      </div>

                      <p className="font-semibold text-gray-900 break-words">{item.title || '제목 없음'}</p>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{item.snippet || '설명 없음'}</p>
                      <p className="text-sm text-blue-500 mt-2 break-all">{item.url}</p>
                    </div>

                    <button
                      onClick={() => handleCrawlOneCandidate(item)}
                      disabled={crawling}
                      className="px-3 py-2 rounded-lg bg-white text-gray-700 border border-gray-200 text-xs font-semibold hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
                    >
                      본문 수집
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm font-semibold text-gray-800 mb-2">직접 URL 여러 개 붙여넣기</p>
          <textarea
            value={manualUrls}
            onChange={(event) => setManualUrls(event.target.value)}
            placeholder={'https://www.daangn.com/kr/community/...\nhttps://www.daangn.com/kr/community/...'}
            rows={4}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={handleManualCrawl}
              disabled={crawling || !manualUrls.trim()}
              className="px-5 py-3 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
            >
              URL 전체 본문 수집
            </button>
          </div>
        </section>

        {message && (
          <div className="mb-4 px-4 py-2 bg-white rounded-xl shadow text-sm text-gray-700 border-l-4 border-indigo-400">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 px-4 py-3 bg-red-50 rounded-xl text-sm text-red-700 border border-red-200 whitespace-pre-wrap">
            {errorMessage}
          </div>
        )}

        <p className="text-sm text-gray-500 mb-4">총 {total}개 결과</p>

        {loading ? (
          <div className="text-center py-20 text-gray-400 text-lg">불러오는 중...</div>
        ) : results.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p>결과가 없습니다. 키워드를 수집해보세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {results.map((item) => (
              <ResultCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex flex-wrap justify-center gap-2 mt-10">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-9 h-9 rounded-full text-sm font-semibold transition ${
                  p === page
                    ? 'bg-indigo-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-indigo-50 border border-gray-200'
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
