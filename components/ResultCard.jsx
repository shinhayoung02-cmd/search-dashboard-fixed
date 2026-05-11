export default function ResultCard({ item }) {
  const sourceValue = item.source || item.site || item.source_domain || item.url || ''

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
    if (site.includes('cafe.naver')) return 'bg-green-100 text-green-700'
    if (site.includes('naver')) return 'bg-green-100 text-green-700'
    if (site.includes('clien')) return 'bg-blue-100 text-blue-700'
    if (site.includes('joongna')) return 'bg-yellow-100 text-yellow-700'
    if (site.includes('bunjang')) return 'bg-purple-100 text-purple-700'
    return 'bg-gray-100 text-gray-700'
  }

  const getVisualText = () => {
    if (item.keywords?.[0]) return item.keywords[0]
    if (sourceValue.includes('daangn')) return '당근 검색'
    if (sourceValue.includes('cafe.naver')) return '네이버 카페'
    if (sourceValue.includes('joongna')) return '중고나라'
    if (sourceValue.includes('bunjang')) return '번개장터'
    return '검색 결과'
  }

  const shortKeyword = String(item.keyword || item.query_text || '')
    .replace(/\s+/g, ' ')
    .slice(0, 42)

  const normalizeText = (value = '') => {
    return String(value)
      .replace(/\s+/g, ' ')
      .replace(/본문을 불러오는 중입니다\.?/g, '')
      .trim()
  }

  const isBrokenText = (value = '') => {
    const text = String(value)
    return (
      !text ||
      text.includes('����') ||
      text.includes('본문을 불러오는 중입니다') ||
      text.includes('Loading') ||
      text.includes('undefined')
    )
  }

  const titleCandidates = [
    item.detail_title,
    item.title,
    item.result_title,
    item.og_title,
  ]

  const displayTitle =
    titleCandidates.find((text) => text && !isBrokenText(text)) || '제목 없음'

  const bodyCandidates = [
    item.detail_body,
    item.snippet,
    item.result_snippet,
    item.description,
  ]

  const rawBody = bodyCandidates.find((text) => text && !isBrokenText(text))
  const cleanBody = normalizeText(rawBody || '')

  const getFallbackBody = () => {
    if (item.crawl_status === 'manual_success') {
      return '브라우저에서 확인한 본문을 수동 저장한 카드입니다.'
    }

    if (item.crawl_status === 'search_only') {
      return '네이버 카페 본문 접근이 제한되어 검색 결과 제목과 요약을 기준으로 표시합니다.'
    }

    if (item.crawl_status === 'blocked') {
      return '본문 접근이 제한된 게시글입니다. 원본 링크에서 직접 확인이 필요합니다.'
    }

    if (item.crawl_status === 'failed') {
      return '본문 수집에 실패했습니다. 원본 링크에서 직접 확인이 필요합니다.'
    }

    if (item.crawl_status === 'empty') {
      return '본문이 비어 있거나 공개 본문을 확인할 수 없습니다.'
    }

    return '본문 정보를 확인할 수 없습니다.'
  }

  const displayBody = cleanBody
    ? cleanBody.slice(0, 300) + (cleanBody.length > 300 ? '…' : '')
    : getFallbackBody()

  const getCrawlBadge = () => {
    if (item.crawl_status === 'success') {
      return { label: '본문 수집 완료', cls: 'bg-emerald-100 text-emerald-700' }
    }

    if (item.crawl_status === 'manual_success') {
      return { label: '수동 본문 저장', cls: 'bg-indigo-100 text-indigo-700' }
    }

    if (item.crawl_status === 'search_only') {
      return { label: '검색 결과 기반', cls: 'bg-sky-100 text-sky-700' }
    }

    if (item.crawl_status === 'blocked') {
      return { label: '접근 제한', cls: 'bg-yellow-100 text-yellow-700' }
    }

    if (item.crawl_status === 'failed') {
      return { label: '수집 실패', cls: 'bg-red-100 text-red-700' }
    }

    if (item.crawl_status === 'empty') {
      return { label: '본문 없음', cls: 'bg-gray-100 text-gray-500' }
    }

    return { label: '상태 확인 필요', cls: 'bg-gray-100 text-gray-600' }
  }

  const crawlBadge = getCrawlBadge()
  const imageSrc = item.image_url || item.thumbnail || item.og_image || ''

  return (
    <div className="bg-white rounded-[28px] overflow-hidden shadow-sm border border-gray-100 hover:shadow-lg transition flex flex-col">
      <div className="h-52 bg-gradient-to-br from-pink-100 via-rose-100 to-pink-200 border-b border-gray-200 overflow-hidden">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={displayTitle}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 text-sm font-bold px-4 py-2 rounded-full ${getBadgeClass(sourceValue)}`}
          >
            🌐 {getSiteLabel(sourceValue)}
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

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[20px] leading-snug font-extrabold text-gray-900 hover:text-indigo-600 line-clamp-2"
        >
          {displayTitle}
        </a>

        <p className="text-gray-700 text-[15px] leading-7 font-medium whitespace-pre-wrap line-clamp-5">
          {displayBody}
        </p>

        {(sourceValue.includes('cafe.naver') &&
          (item.crawl_status === 'search_only' || item.crawl_status === 'blocked')) && (
          <div className="text-xs leading-5 text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
            네이버 카페는 로그인, 멤버 공개, 프레임 구조 때문에 본문 전체 수집이 제한될 수 있습니다.
          </div>
        )}

        {item.crawl_status === 'manual_success' && (
          <div className="text-xs leading-5 text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
            이 카드는 브라우저에서 실제로 보이는 본문을 저장한 데이터입니다.
          </div>
        )}

        {(item.location || item.author) && (
          <div className="flex gap-3 text-sm text-gray-400">
            {item.location && <span>📍 {item.location}</span>}
            {item.author && <span>👤 {item.author}</span>}
          </div>
        )}

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

        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 truncate hover:underline pt-1"
          >
            {item.url}
          </a>
        )}
      </div>
    </div>
  )
}
