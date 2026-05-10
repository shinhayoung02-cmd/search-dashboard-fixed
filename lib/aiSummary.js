import OpenAI from 'openai'

function fallbackSummary(keyword, items) {
  const keywords = [
    keyword,
    ...items
      .flatMap((item) => `${item.title || ''} ${item.description || ''}`.split(/\s+/))
      .map((word) => word.replace(/[\W_]+/g, '').trim())
      .filter((word) => word.length >= 2),
  ]

  const uniqueKeywords = Array.from(new Set(keywords)).slice(0, 5)

  return {
    summary: items[0]?.description || `${keyword} 관련 검색 결과입니다.`,
    keywords: uniqueKeywords,
  }
}

/**
 * 검색 결과 텍스트를 AI로 요약 + 키워드 추출
 * @param {string} keyword 원래 검색어
 * @param {Array} items 검색 결과 배열 [{title, description, url}]
 * @returns {Promise<{ summary: string, keywords: string[] }>}
 */
export async function summarizeResults(keyword, items) {
  if (!items || items.length === 0) {
    return { summary: '요약할 검색 결과가 없습니다.', keywords: [keyword].filter(Boolean) }
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[aiSummary] OPENAI_API_KEY가 없어 기본 요약으로 대체합니다.')
    return fallbackSummary(keyword, items)
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const text = items
      .map((i, idx) => `[${idx + 1}] ${i.title || ''}\n${i.description || ''}`)
      .join('\n\n')
      .slice(0, 12000)

    const prompt = `
다음은 "${keyword}" 키워드로 검색한 결과들입니다.

${text}

위 내용을 바탕으로 아래 형식의 JSON만 반환하세요. 다른 텍스트는 절대 쓰지 마세요.
{
  "summary": "핵심 내용을 1문장으로 요약",
  "keywords": ["키워드1", "키워드2", "키워드3"]
}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    })

    const content = response.choices[0]?.message?.content || '{}'
    const result = JSON.parse(content)

    return {
      summary: result.summary || '요약 없음',
      keywords: Array.isArray(result.keywords) ? result.keywords : [],
    }
  } catch (err) {
    console.error('[aiSummary] OpenAI summary failed:', err)
    return fallbackSummary(keyword, items)
  }
}
