export default function ResultCard({ item }) {
  const cleanText = (value = '') => {
    return String(value)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
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

  const formatPostDate = (value) => {
    if (!value) return '게시일 확인 불가'

    try {
      const raw = String(value).trim()

      const relativeMatch = raw.match(/(\d+)\s*(분|시간|일|주|개월|년)\s*전/)
      if (relativeMatch) return raw

      const dateMatch = raw.match(/\d{4}[-.]\d{1,2}[-.]\d{1,2}/)
      if (dateMatch) {
        return dateMatch[0].replace(/\./g, '-')
      }

      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) {
        return raw.slice(0, 20)
      }

      return d.toISOString().slice(0, 10)
    } catch {
      return String(value).slice(0, 20)
    }
  }

  const displayUrl = item.url || ''

  const shortUrl = (() => {
    if (!displayUrl) return '링크 없음'

    try {
      const decoded = decodeURIComponent(displayUrl)
      return decoded.length > 90 ? decoded.slice(0, 90) + '…' : decoded
    } catch {
      return displayUrl.length > 90 ? displayUrl.slice(0, 90) + '…' : displayUrl
    }
  })()

  const titleCandidates = [
    item.detail_title,
    item.title,
    item.result_title,
    item.og_title,
  ]

  const displayTitle =
    cleanText(titleCandidates.find((text) => text && !isBrokenText(text)) || '제목 없음')

  const bodyCandidates = [
    item.summary,
    item.detail_body,
    item.body,
    item.contents,
    item.content,
    item.snippet,
    item.result_snippet,
    item.description,
  ]

  const rawBody =
    bodyCandidates.find((text) => text && !isBrokenText(text)) || ''

  const bodyText = cleanText(rawBody)

  const removeTitleFromBody = (body, title) => {
    if (!body || !title) return body

    return body
      .replace(title, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const isJunkSentence = (sentence = '') => {
    const s = sentence.trim()

    if (!s) return true
    if (s.length < 8) return true

    const junkPatterns = [
      /^안녕하세요/,
      /^안녕/,
      /^혹시/,
      /^제가/,
      /^저는/,
      /^사진/,
      /^문의/,
      /^댓글/,
      /^당근/,
      /^네이버/,
      /^카페/,
      /^생활 꿀 정보/,
      /^본문 접근/,
      /^원본 링크/,
      /^로그인/,
      /^멤버 공개/,
      /^프레임 구조/,
      /^검색 결과/,
      /^물건 \/ 상황/,
    ]

    return junkPatterns.some((pattern) => pattern.test(s))
  }

  const importantWords = [
    '분실',
    '분실물',
    '유실물',
    '잃어버',
    '놓고',
    '두고',
    '습득',
    '찾았',
    '찾아',
    '신고',
    '경찰',
    '지구대',
    '파출소',
    '택시',
    '버스',
    '지하철',
    '역',
    '카드',
    '지갑',
    '휴대폰',
    '핸드폰',
    '아이폰',
    '에어팟',
    '가방',
    '캐리어',
    '위치추적',
    '기기정지',
    '개인정보',
    '유출',
    '연락',
    '보관',
    '주인',
  ]

  const makeOneLineSummary = (body = '', title = '') => {
    const cleanedBody = cleanText(removeTitleFromBody(body, title))

    if (!cleanedBody) {
      if (item.crawl_status === 'blocked') {
        return '본문 접근이 제한된 게시글입니다. 원본 링크에서 직접 확인이 필요합니다.'
      }

      if (item.crawl_status === 'search_only') {
        return '본문 접근이 제한되어 검색 결과 제목과 요약을 기준으로 표시합니다.'
      }

      return '본문 수집 결과가 없어 원본 링크에서 직접 확인이 필요합니다.'
    }

    const sentences = cleanedBody
      .split(/[\n\r]+|[.!?。！？]+|다\s+/)
      .map((s) => cleanText(s))
      .filter((s) => !isJunkSentence(s))

    const importantSentences = sentences
      .filter((s) => importantWords.some((word) => s.includes(word)))
      .slice(0, 2)

    const summarySource =
      importantSentences.length > 0
        ? importantSentences.join(', ')
        : sentences.slice(0, 2).join(', ') || cleanedBody

    const normalized = summarySource.endsWith('다')
      ? summarySource
      : `${summarySource}다`

    return normalized.length > 130
      ? normalized.slice(0, 130) + '…'
      : normalized
  }

  const extractKeywords = (text = '') => {
    const cleaned = cleanText(text)

    const domainKeywords = [
      '분실물',
      '분실',
      '유실물',
      '습득',
      '신고',
      '경찰',
      '지구대',
      '파출소',
      '택시',
      '버스',
      '지하철',
      '카드',
      '지갑',
      '휴대폰',
      '핸드폰',
      '아이폰',
      '에어팟',
      '가방',
      '캐리어',
      '위치추적',
      '기기정지',
      '개인정보',
      '유출',
      '연락',
      '보관',
      '주인',
      '당근',
      '네이버카페',
    ]

    const picked = []

    for (const kw of domainKeywords) {
      if (cleaned.includes(kw) && !picked.includes(kw)) {
        picked.push(kw)
      }
    }

    const stopwords = new Set([
      '안녕하세요',
      '안녕',
      '혹시',
      '사진들에',
      '나와있는',
      '제가',
      '저는',
      '오늘',
      '어제',
      '그리고',
      '그런데',
      '하지만',
      '입니다',
      '합니다',
      '했어요',
      '있어요',
      '없는',
      '있는',
      '본문',
      '내용',
      '검색',
      '결과',
      '기반',
      '원본',
      '링크',
      '카페',
      '네이버',
      '게시글',
      '확인',
      '직접',
      '필요합니다',
      '생활',
      '정보',
      '무엇을',
      '의미하나요',
      '스티커',
    ])

    const tokens = cleaned.match(/[가-힣A-Za-z0-9]{2,}/g) || []
    const counts = {}

    for (const token of tokens) {
      if (stopwords.has(token)) continue
      if (picked.includes(token)) continue
      if (token.length < 2) continue

      counts[token] = (counts[token] || 0) + 1
    }

    const extra = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)

    return [...picked, ...extra].slice(0, 5)
  }

  // created_at / updated_at은 DB 저장일이라 사용하지 않습니다.
  // published_at, post_date, article_date, date만 원본 게시물 날짜로 봅니다.
  const displayDate = formatPostDate(
    item.published_at ||
    item.post_date ||
    item.article_date ||
    item.date
  )

  const displaySummary = makeOneLineSummary(bodyText, displayTitle)

  const keywordSource = `${displayTitle} ${bodyText}`
  const keywordList = extractKeywords(keywordSource)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <div className="space-y-5">
        <div>
          <div className="text-sm font-semibold text-orange-500 mb-1">
            🗓 날짜
          </div>
          <div className="text-gray-800 text-base">
            {displayDate}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-orange-500 mb-1">
            🔗 링크
          </div>

          {displayUrl ? (
            <a
              href={displayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 break-all hover:underline"
              title={displayUrl}
            >
              {shortUrl}
            </a>
          ) : (
            <div className="text-gray-400">
              링크 없음
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-semibold text-orange-500 mb-1">
            📝 제목
          </div>
          <h3 className="text-gray-900 text-[22px] leading-8 font-extrabold">
            {displayTitle}
          </h3>
        </div>

        <div>
          <div className="text-[28px] font-extrabold text-orange-500 mb-2">
            📄 Contents
          </div>

          <p className="text-gray-900 text-[20px] leading-8 font-semibold">
            {displaySummary}
          </p>
        </div>

        <div>
          <div className="text-sm font-semibold text-orange-500 mb-2">
            🏷 키워드
          </div>

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
              <span className="text-gray-400 text-sm">
                키워드 없음
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}