export default function ResultCard({ item }) {
  const getSiteLabel = (site) => {
    if (!site) return '웹'
    if (site === 'google') return '구글'
    if (site.includes('daangn')) return '당근'
    if (site.includes('cafe.naver')) return '네이버 카페'
    if (site.includes('naver')) return '네이버'
    if (site.includes('clien')) return '클리앙'
    if (site.includes('joongna')) return '중고나라'
    if (site.includes('bunjang')) return '번개장터'
    return site
  }

  const getBadgeClass = (site) => {
    if (!site || site === 'google') return 'bg-rose-100 text-rose-700'
    if (site.includes('daangn')) return 'bg-orange-100 text-orange-700'
    if (site.includes('naver')) return 'bg-green-100 text-green-700'
    if (site.includes('clien')) return 'bg-blue-100 text-blue-700'
    return 'bg-gray-100 text-gray-700'
  }

  const getVisualText = () => {
    if (item.keywords?.[0]) return item.keywords[0]
    if (item.site?.includes('daangn')) return '당근 검색'
    return '검색 결과'
  }

  const shortKeyword = String(item.keyword || '')
    .replace(/\s+/g, ' ')
    .slice(0, 42)

  // ✅ 표시 우선순위: 실제 크롤링 본문 > 검색 snippet > 없음 메시지
  const displayBody = item.detail_body
    ? item.detail_body.slice(0, 300) + (item.detail_body.length > 300 ? '…' : '')
    : item.snippet || item.description || '본문을 불러오는 중입니다.'

  // ✅ 상태 뱃지
  const getCrawlBadge = () => {
    if (item.crawl_status === 'success') return { label: '본문 수집 완료', cls: 'bg-emerald-100 text-emerald-700' }
    if (item.crawl_status === 'failed') return { label: '수집 실패', cls: 'bg-red-100 text-red-700' }
    if (item.crawl_status === 'blocked') return { label: '접근 차단', cls: 'bg-yellow-100 text-yellow-700' }
    if (item.crawl_status === 'empty') return { label: '본문 없음', cls: 'bg-gray-100 text-gray-500' }
    return null
  }

  const crawlBadge = getCrawlBadge()

  return (
    <div className="bg-white rounded-[28px] overflow-hidden shadow-sm border border-gray-100 hover:shadow-lg transition flex flex-col">

      {/* 이미지 영역 */}
      <div className="h-52 bg-gradient-to-br from-pink-100 via-rose-100 to-pink-200 border-b border-gray-200 overflow-hidden">
        {item.image_url || item.thumbnail ? (
          <img
            src={item.image_url || item.thumbnail}
            alt={item.title || 'result'}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
            <div className="text-5xl mb-3">🔎</div>
            <div className="text-3xl font-black text-white/80 tracking-tight">
              {getVisualText()}
            </div>
            <div className="text-sm text-white/70 mt-2">
              물건 / 상황 시각 정보
            </div>
          </div>
        )}
      </div>

      <div className="p-6 flex flex-col gap-4">

        {/* 출처 뱃지 + 키워드 */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 text-sm font-bold px-4 py-2 rounded-full ${getBadgeClass(item.source || item.site || '')}`}
          >
            🌐 {getSiteLabel(item.source || item.site || '')}
          </span>
          {crawlBadge && (
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${crawlBadge.cls}`}>
              {crawlBadge.label}
            </span>
          )}
          {shortKeyword && (
            <span className="text-sm text-gray-400 truncate max-w-[200px]">
              🔎 {shortKeyword}
            </span>
          )}
        </div>

        {/* 제목 */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[20px] leading-snug font-extrabold text-gray-900 hover:text-indigo-600 line-clamp-2"
        >
          {item.title || '제목 없음'}
        </a>

        {/* ✅ 본문: 실제 크롤링 본문 우선 표시 */}
        <p className="text-gray-700 text-[15px] leading-7 font-medium whitespace-pre-wrap line-clamp-5">
          {displayBody}
        </p>

        {/* 위치 / 작성자 */}
        {(item.location || item.author) && (
          <div className="flex gap-3 text-sm text-gray-400">
            {item.location && <span>📍 {item.location}</span>}
            {item.author && <span>👤 {item.author}</span>}
          </div>
        )}

        {/* 키워드 태그 */}
        {item.keywords?.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {item.keywords.slice(0, 6).map((kw, idx) => (
              <span
                key={idx}
                className="bg-gray-100 text-gray-600 text-sm px-4 py-2 rounded-full"
              >
                #{kw}
              </span>
            ))}
          </div>
        )}

        {/* 원본 링크 */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-400 truncate hover:underline pt-1"
        >
          {item.url}
        </a>

      </div>
    </div>
  )
}
