export default function ResultCard({ item }) {
  const formatDate = (value) => {
    if (!value) return '날짜 없음'
    try {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return String(value)
      return d.toISOString().slice(0, 10)
    } catch {
      return String(value)
    }
  }

  const cleanText = (value = '') => {
    return String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
  }

  const makeOneLineSummary = (text = '') => {
    const cleaned = cleanText(text)
    if (!cleaned) return '내용 없음'

    const firstSentence =
      cleaned.split(/[.!?。！？]\s+/).find(Boolean) || cleaned

    return firstSentence.length > 120
      ? firstSentence.slice(0, 120) + '…'
      : firstSentence
  }

  const extractKeywordsLocal = (text = '') => {
    const stopwords = new Set([
      '그리고', '하지만', '그런데', '정말', '너무', '제가', '저는', '있어요',
      '입니다', '합니다', '했어요', '있는', '없는', '위해', '관련', '경우',
      '사용', '확인', '처리', '문의', '직접', '원본', '링크', '게시글', '내용',
      '본문', '검색', '결과', '기반', '카페', '네이버', '당근', '중고나라'
    ])

    const tokens = cleanText(text)
      .match(/[가-힣A-Za-z0-9]{2,}/g) || []

    const counts = {}

    for (const token of tokens) {
      if (stopwords.has(token)) continue
      if (token.length < 2) continue
      counts[token] = (counts[token] || 0) + 1
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)
  }

  const sourceText =
    item.detail_body ||
    item.snippet ||
    item.description ||
    item.title ||
    ''

  const displayDate =
    formatDate(item.published_at || item.created_at || item.updated_at)

  const displayUrl = item.url || '-'

  const displaySummary =
    item.summary || makeOneLineSummary(sourceText)

  const keywordList = Array.isArray(item.keywords)
    ? item.keywords.slice(0, 5)
    : extractKeywordsLocal(sourceText)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <div className="space-y-5">
        {/* 날짜 */}
        <div>
          <div className="text-sm font-semibold text-orange-500 mb-1">📅 날짜</div>
          <div className="text-gray-700 text-base">{displayDate}</div>
        </div>

        {/* 링크 */}
        <div>
          <div className="text-sm font-semibold text-orange-500 mb-1">🔗 링크</div>
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 break-all hover:underline"
          >
            {displayUrl}
          </a>
        </div>

        {/* 내용 */}
        <div>
          <div className="text-[28px] font-extrabold text-orange-500 mb-2">
            📄 Contents
          </div>
          <p className="text-gray-900 text-[20px] leading-8 font-semibold">
            {displaySummary}
          </p>
        </div>

        {/* 키워드 */}
        <div>
          <div className="text-sm font-semibold text-orange-500 mb-2">🏷 키워드</div>
          <div className="flex flex-wrap gap-2">
            {keywordList.length > 0 ? (
              keywordList.map((kw, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 rounded-full bg-orange-50 text-orange-700 text-sm font-medium"
                >
                  #{kw}
                </span>
              ))
            ) : (
              <span className="text-gray-400 text-sm">키워드 없음</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}