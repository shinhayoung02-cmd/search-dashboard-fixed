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
      .replace(/&nbsp;/g, ' ')
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

  const formatPostDate = () => {
    const raw =
      item.published_at ||
      item.post_date ||
      item.article_date ||
      item.date ||
      item.published_at_raw ||
      ''

    if (!raw) return '게시일 미수집'

    const value = String(raw).trim()

    const relativeMatch = value.match(/(\d+)\s*(분|시간|일|주|개월|달|년)\s*전/)
    if (relativeMatch) return value

    if (value.includes('방금 전') || value.includes('어제')) return value

    const dateMatch = value.match(/\d{4}[-.]\d{1,2}[-.]\d{1,2}/)
    if (dateMatch) return dateMatch[0].replace(/\./g, '-')

    try {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10)
      }
    } catch {}

    return value.slice(0, 20)
  }

  const displayUrl = item.url || ''

  const shortUrl = (() => {
    if (!displayUrl) return '링크 없음'

    try {
      const decoded = decodeURIComponent(displayUrl)
      return decoded.length > 72 ? decoded.slice(0, 72) + '…' : decoded
    } catch {
      return displayUrl.length > 72 ? displayUrl.slice(0, 72) + '…' : displayUrl
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
      .replace(/\s*\|\s*당근 동네생활\s*$/g, '')
      .trim()

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
      .replace(title.replace(/\s*\|\s*.*$/g, ''), ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const detectLocation = (text = '') => {
    const t = cleanText(text)
    return (
      t.match(/[가-힣A-Za-z0-9]+역/)?.[0] ||
      t.match(/[가-힣A-Za-z0-9]+터미널/)?.[0] ||
      t.match(/[가-힣A-Za-z0-9]+공항/)?.[0] ||
      t.match(/[가-힣A-Za-z0-9]+동/)?.[0] ||
      ''
    )
  }

  const detectObject = (text = '') => {
    const t = cleanText(text)

    const objects = [
      '캐리어',
      '지갑',
      '휴대폰',
      '핸드폰',
      '아이폰',
      '에어팟',
      '카드',
      '가방',
      '쇼핑백',
      '노트북',
      '키링',
      '열쇠',
      '신분증',
      '우산',
      '반지',
      '시계',
    ]

    return objects.find((obj) => t.includes(obj)) || '물건'
  }

  const detectPlaceType = (text = '') => {
    const t = cleanText(text)

    if (t.includes('택시')) return '택시'
    if (t.includes('버스')) return '버스'
    if (t.includes('지하철')) return '지하철'
    if (t.includes('기차')) return '기차'
    if (t.includes('카페')) return '카페'
    if (t.includes('식당')) return '식당'
    if (t.includes('편의점')) return '편의점'
    if (t.includes('공항')) return '공항'
    if (t.includes('역')) return '역 주변'
    return ''
  }

  const detectClue = (text = '') => {
    const t = cleanText(text)

    if (t.includes('위치추적')) return '위치추적'
    if (t.includes('CCTV') || t.includes('cctv')) return 'CCTV'
    if (t.includes('차량번호')) return '차량번호'
    if (t.includes('스티커')) return '스티커'
    if (t.includes('사진')) return '사진'
    if (t.includes('영수증')) return '영수증'
    if (t.includes('기사')) return '기사님'
    if (t.includes('경찰')) return '경찰 신고'
    if (t.includes('지구대')) return '지구대'
    return ''
  }

  const detectAction = (text = '') => {
    const t = cleanText(text)

    if (t.includes('신고')) return '신고'
    if (t.includes('찾아') || t.includes('찾을')) return '회수 방법 문의'
    if (t.includes('연락')) return '연락 요청'
    if (t.includes('보관')) return '보관 여부 확인'
    if (t.includes('도와')) return '도움 요청'
    return '확인 요청'
  }

  const splitSentences = (text = '') => {
    return cleanText(text)
      .split(/[\n\r]+|[.!?。！？]+|다\s+|요\s+/)
      .map((s) => cleanText(s))
      .filter((s) => s.length >= 8)
  }

  const makeSpecificSummary = (body = '', title = '') => {
    const cleanedBody = cleanText(removeTitleFromBody(body, title))

    if (!cleanedBody) {
      if (item.crawl_status === 'blocked') {
        return '본문 접근이 제한된 게시글로, 원본 링크에서 직접 확인이 필요함.'
      }

      if (item.crawl_status === 'search_only') {
        return '본문 접근이 제한되어 검색 결과 제목과 요약을 기준으로 확인이 필요함.'
      }

      return '본문 수집 결과가 없어 원본 링크에서 직접 확인이 필요함.'
    }

    const fullText = `${title} ${cleanedBody}`

    const location = detectLocation(fullText)
    const object = detectObject(fullText)
    const placeType = detectPlaceType(fullText)
    const clue = detectClue(fullText)
    const action = detectAction(fullText)

    // 상황형 템플릿: 분실/습득 맥락을 한 줄로 정리
    if (
      fullText.includes('분실') ||
      fullText.includes('잃어') ||
      fullText.includes('놓고') ||
      fullText.includes('두고') ||
      fullText.includes('하차')
    ) {
      const wherePart = location
        ? `${location}${placeType ? `에서 ${placeType}` : '에서'}`
        : placeType
          ? `${placeType} 이용 중`
          : '이동 중'

      const cluePart = clue
        ? `${clue}를 단서로 `
        : ''

      return `${wherePart} ${object}를 두고 내렸거나 분실한 상황이며, ${cluePart}${action}을 위해 글을 작성함.`
    }

    // 습득 맥락
    if (fullText.includes('주웠') || fullText.includes('습득') || fullText.includes('보관')) {
      const wherePart = location ? `${location}에서` : placeType ? `${placeType}에서` : '현장에서'
      return `${wherePart} ${object}를 습득하거나 보관 중이며, 주인 확인 또는 연락을 요청함.`
    }

    // 기본 문장 압축
    const sentences = splitSentences(cleanedBody)
    const importantWords = [
      '분실',
      '잃어',
      '놓고',
      '두고',
      '습득',
      '찾아',
      '신고',
      '경찰',
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
      '개인정보',
      '연락',
      '보관',
    ]

    const picked =
      sentences.find((s) => importantWords.some((word) => s.includes(word))) ||
      sentences[0] ||
      cleanedBody

    const normalized = picked.endsWith('다') || picked.endsWith('함')
      ? picked
      : `${picked}함`

    return normalized.length > 95
      ? normalized.slice(0, 95) + '…'
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
      'CCTV',
      '차량번호',
      '스티커',
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
      '지난주',
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
      '아시는',
      '계실까요',
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

  const displayDate = formatPostDate()
  const displaySummary = makeSpecificSummary(bodyText, displayTitle)
  const keywordSource = `${displayTitle} ${bodyText}`
  const keywordList = extractKeywords(keywordSource)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm max-w-[520px]">
      <div className="space-y-4">
        <div>
          <div className="text-[13px] font-semibold text-orange-500 mb-1">
            🗓 날짜
          </div>
          <div className="text-gray-800 text-[15px]">
            {displayDate}
          </div>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-orange-500 mb-1">
            🔗 링크
          </div>

          {displayUrl ? (
            <a
              href={displayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 text-[14px] leading-6 break-all hover:underline"
              title={displayUrl}
            >
              {shortUrl}
            </a>
          ) : (
            <div className="text-gray-400 text-[14px]">
              링크 없음
            </div>
          )}
        </div>

        <div>
          <div className="text-[13px] font-semibold text-orange-500 mb-1">
            📝 제목
          </div>
          <h3 className="text-gray-950 text-[18px] leading-7 font-extrabold">
            {displayTitle}
          </h3>
        </div>

        <div className="pt-1">
          <div className="text-[22px] font-extrabold text-orange-500 mb-2">
            📄 Contents
          </div>

          <p className="text-gray-950 text-[16px] leading-7 font-semibold">
            {displaySummary}
          </p>
        </div>

        <div>
          <div className="text-[13px] font-semibold text-orange-500 mb-2">
            🏷 키워드
          </div>

          <div className="flex flex-wrap gap-2">
            {keywordList.length > 0 ? (
              keywordList.map((kw, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 rounded-full bg-orange-50 text-orange-700 text-[13px] font-medium"
                >
                  #{kw}
                </span>
              ))
            ) : (
              <span className="text-gray-400 text-[13px]">
                키워드 없음
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}