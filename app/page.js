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
    throw new Error(data.error || `API 요청 실패: ${res.status}`)
  }

  return data
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

  useEffect(() => {
    fetchResults(keyword, page)
  }, [page])

  const handleSearch = (kw) => {
    setKeyword(kw)
    setPage(1)
    fetchResults(kw, 1)
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
