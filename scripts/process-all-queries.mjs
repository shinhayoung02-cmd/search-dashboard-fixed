import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"

const CONFIG = {
  QUERY_BATCH_SIZE: 10,
  MAX_GOOGLE_SEARCHES_PER_QUERY: 2,
  MAX_RESULTS_PER_QUERY: 3,
  MAX_CRAWLER_CALLS_PER_QUERY: 1,
  DELAY_BETWEEN_QUERIES_MS: 1200,
  DELAY_BETWEEN_BATCHES_MS: 3000,
}

function loadEnvFile(fileName = ".env.local") {
  const filePath = path.resolve(process.cwd(), fileName)
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile(".env.local")

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID

const CRAWLER_API_URL = process.env.CRAWLER_API_URL
const CRAWLER_API_KEY = process.env.CRAWLER_API_KEY

if (!SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_URL이 없습니다.")
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY가 없습니다.")
}

if (!GOOGLE_API_KEY) {
  throw new Error("GOOGLE_API_KEY가 없습니다.")
}

if (!GOOGLE_SEARCH_ENGINE_ID) {
  throw new Error("GOOGLE_SEARCH_ENGINE_ID가 없습니다.")
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clean(v = "") {
  return String(v || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))]
}

function quoted(q = "") {
  return [...String(q).matchAll(/"([^"]+)"/g)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
}

function siteFromQuery(q = "") {
  return String(q).match(/site:([^\s]+)/)?.[1]?.trim() || ""
}

function siteFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function label(site = "") {
  if (site.includes("daangn")) return "당근"
  if (site.includes("bunjang")) return "번개장터"
  if (site.includes("joongna")) return "중고나라"
  if (site.includes("cafe.naver")) return "네이버 카페"
  if (site.includes("clien")) return "클리앙"
  if (site.includes("naver")) return "네이버"
  return "웹"
}

function googleUrl(q) {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

function thumb(item) {
  return item?.pagemap?.cse_image?.[0]?.src || item?.pagemap?.cse_thumbnail?.[0]?.src || ""
}

function searchQueries(original = "") {
  const site = siteFromQuery(original)
  const words = quoted(original).slice(0, 3)
  const base = words.join(" ") || clean(original.replace(/site:[^\s]+/g, "").replace(/"/g, ""))

  const list = [original]
  if (site && base) list.push(`site:${site} ${base}`)

  if (site.includes("daangn")) list.push("site:daangn.com 분실물")
  else if (site.includes("bunjang")) list.push("site:bunjang.co.kr 분실물")
  else if (site.includes("joongna")) list.push("site:joongna.com 분실물")
  else if (site.includes("clien")) list.push("site:clien.net 분실물")
  else if (site.includes("cafe.naver")) list.push("site:cafe.naver.com 분실물")

  return uniq(list.map(clean)).slice(0, CONFIG.MAX_GOOGLE_SEARCHES_PER_QUERY)
}

function terms(q = "", title = "", body = "") {
  const text = `${q} ${title} ${body}`
  const objects = [
    "지갑", "카드", "신분증", "에어팟", "아이폰", "휴대폰", "핸드폰", "폰",
    "갤럭시", "워치", "시계", "가방", "키", "우산", "노트북", "이어폰",
    "분실물", "물건"
  ]
  const situations = [
    "분실", "분실물", "잃어버림", "잃어버렸", "없어짐", "유실", "습득",
    "찾음", "보관", "연락", "확인", "신고", "문의"
  ]
  const locations =
    text.match(/[가-힣A-Za-z0-9]+(?:역|동|구|로|길|거리|공원|학교|대학교|터미널|정류장|카페|상가|시장|입구|근처|주변)/g) || []
  const attrs =
    text.match(/검정색|검은색|검정|흰색|하얀색|빨간색|파란색|노란색|초록색|회색|분홍색|핑크색|갈색|남색|주황색|사진|이미지|인증|케이스|줄|끈|브랜드|모델|색상|특징/g) || []

  return uniq([
    ...objects.filter((w) => text.includes(w)),
    ...situations.filter((w) => text.includes(w)),
    ...locations,
    ...attrs,
    ...quoted(q),
  ]).slice(0, 8)
}

function makeSummary({ q, title, body, site, location }) {
  const ts = terms(q, title, body)
  const obj =
    ts.find((t) =>
      /지갑|카드|신분증|에어팟|아이폰|휴대폰|핸드폰|폰|갤럭시|워치|시계|가방|키|우산|노트북|이어폰|분실물|물건/.test(t)
    ) || "분실물"

  const loc =
    location ||
    ts.find((t) =>
      /역|동|구|로|길|거리|공원|학교|대학교|터미널|정류장|카페|상가|시장|입구|근처|주변/.test(t)
    ) ||
    ""

  const text = `${title} ${body}`
  const sit = /습득|보관|찾음|주웠/.test(text)
    ? "습득·보관 정황"
    : /연락|문의|신고|확인/.test(text)
      ? "연락·확인 요청"
      : "분실 정황"

  return loc
    ? `${loc}에서 ${obj} 관련 ${sit}을 확인할 수 있는 ${label(site)} 게시글입니다.`
    : `${obj} 관련 ${sit}을 확인할 수 있는 ${label(site)} 게시글입니다.`
}

function makeDetail({ title, body, time, location }) {
  const text = clean(`${title} ${body}`)
  const t =
    time ||
    text.match(/(?:오늘|어제|방금|오전|오후|지난\s*\d+일|\d{1,2}월\s*\d{1,2}일|\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?|\d{1,2}시|\d{1,2}분)/)?.[0] ||
    "시간 단서 없음"

  const l =
    location ||
    text.match(/[가-힣A-Za-z0-9]+(?:역|동|구|로|길|거리|공원|학교|대학교|터미널|정류장|카페|상가|시장|입구|근처|주변)/)?.[0] ||
    "위치 단서 없음"

  const fs =
    uniq(
      text.match(/검정색|검은색|검정|흰색|하얀색|빨간색|파란색|노란색|초록색|회색|분홍색|핑크색|갈색|남색|주황색|사진|이미지|인증|케이스|줄|끈|브랜드|모델|신분증|카드|지갑|에어팟|휴대폰|핸드폰|워치|가방/g) || []
    )
      .slice(0, 5)
      .join(" / ") || "특징 단서 없음"

  return `${t} / ${l} / ${fs}`
}

function shouldCrawl(site = "") {
  return ["daangn.com", "bunjang.co.kr", "joongna.com", "cafe.naver.com", "clien.net"].some((s) =>
    site.includes(s)
  )
}

async function googleSearch(q) {
  const url = new URL("https://www.googleapis.com/customsearch/v1")
  url.searchParams.set("key", GOOGLE_API_KEY)
  url.searchParams.set("cx", GOOGLE_SEARCH_ENGINE_ID)
  url.searchParams.set("q", q)
  url.searchParams.set("num", String(CONFIG.MAX_RESULTS_PER_QUERY))

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Google API ${res.status}: ${await res.text()}`)
  }

  return (await res.json()).items || []
}

async function searchAll(original) {
  const qs = searchQueries(original)
  const items = []
  const seen = new Set()

  for (const q of qs) {
    try {
      const got = await googleSearch(q)
      for (const item of got) {
        if (!item?.link || seen.has(item.link)) continue
        seen.add(item.link)
        items.push(item)
        if (items.length >= CONFIG.MAX_RESULTS_PER_QUERY) break
      }
      if (items.length >= CONFIG.MAX_RESULTS_PER_QUERY) break
    } catch (err) {
      console.log(`  Google 실패: ${q}`)
      console.log(`  ${err.message.slice(0, 180)}`)
    }
  }

  return { items, tried: qs }
}

async function crawlPage(url) {
  if (!CRAWLER_API_URL || !url) return null

  try {
    const headers = { "Content-Type": "application/json" }
    if (CRAWLER_API_KEY) headers["x-crawler-key"] = CRAWLER_API_KEY

    const res = await fetch(`${CRAWLER_API_URL.replace(/\/$/, "")}/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    })

    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) return null
    return data
  } catch {
    return null
  }
}

function fallbackRow(query, msg = "") {
  const q = clean(query.keyword)
  const site = siteFromQuery(q)
  const qs = quoted(q)

  return {
    query_id: query.id,
    keyword: q,
    site: site || "google",
    title: qs.length ? `${qs.slice(0, 3).join(" ")} 관련 게시글 검색` : q,
    url: googleUrl(q),
    description: msg || "Google 검색 결과와 Playwright 추출 결과가 없어 원본 검색 쿼리를 카드로 저장했습니다.",
    thumbnail: "",
    summary: `${label(site)}에서 ${qs.slice(0, 3).join("·") || "관련"} 게시글을 찾기 위한 검색식입니다.`,
    keywords: qs.slice(0, 6),
  }
}

async function resultRows(query, items) {
  const rows = []
  let crawlerCalls = 0

  for (const item of items.slice(0, CONFIG.MAX_RESULTS_PER_QUERY)) {
    const q = clean(query.keyword)
    const site = siteFromUrl(item.link) || siteFromQuery(q) || "google"
    let c = null

    if (shouldCrawl(site) && crawlerCalls < CONFIG.MAX_CRAWLER_CALLS_PER_QUERY) {
      crawlerCalls += 1
      c = await crawlPage(item.link)
    }

    const title = clean(c?.title) || clean(item.title)
    const body = clean(c?.body) || clean(c?.detailSummary) || clean(item.snippet)
    const location = clean(c?.location)
    const time = clean(c?.time)
    const tags = Array.isArray(c?.tags) ? c.tags.map(clean) : []

    rows.push({
      query_id: query.id,
      keyword: q,
      site,
      title,
      url: item.link,
      description: clean(c?.detailSummary) || makeDetail({ title, body, time, location }),
      thumbnail: clean(c?.image) || thumb(item),
      summary: clean(c?.summary) || makeSummary({ q, title, body, site, location }),
      keywords: tags.length ? tags.slice(0, 8) : terms(q, title, body),
    })
  }

  return rows
}

async function processQuery(query) {
  const keyword = clean(query.keyword)

  await supabase.from("results").delete().eq("query_id", query.id)

  const search = await searchAll(keyword)
  let rows = await resultRows(query, search.items)

  if (!rows.length) {
    rows = [
      fallbackRow(
        query,
        `개별 Google 결과를 찾지 못했습니다. 시도한 검색식: ${search.tried.join(" / ")}`
      ),
    ]
  }

  const { error: insertErr } = await supabase.from("results").insert(rows)
  if (insertErr) throw new Error(insertErr.message)

  const { error: updateErr } = await supabase
    .from("queries")
    .update({ processed: true })
    .eq("id", query.id)

  if (updateErr) throw new Error(updateErr.message)

  return rows.length
}

async function getUnprocessedQueries() {
  const { data, error } = await supabase
    .from("queries")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(CONFIG.QUERY_BATCH_SIZE)

  if (error) throw new Error(error.message)
  return data || []
}

async function countRemaining() {
  const { count, error } = await supabase
    .from("queries")
    .select("*", { count: "exact", head: true })
    .eq("processed", false)

  if (error) return null
  return count
}

async function main() {
  console.log("전체 쿼리 처리 시작")
  console.log(`배치당 ${CONFIG.QUERY_BATCH_SIZE}개씩 처리합니다.`)

  let totalQueries = 0
  let totalResults = 0
  let totalFailed = 0
  let batchIndex = 0

  while (true) {
    const queries = await getUnprocessedQueries()
    if (!queries.length) break

    batchIndex += 1
    const remaining = await countRemaining()
    console.log(`\n[배치 ${batchIndex}] 남은 미처리 쿼리: ${remaining ?? "확인 불가"}개`)

    for (const query of queries) {
      const keyword = clean(query.keyword)
      try {
        const resultCount = await processQuery(query)
        totalQueries += 1
        totalResults += resultCount
        console.log(`  성공: ${keyword.slice(0, 80)} → 결과 ${resultCount}개`)
      } catch (err) {
        totalFailed += 1
        console.log(`  실패: ${keyword.slice(0, 80)}`)
        console.log(`  원인: ${err.message}`)
      }

      await sleep(CONFIG.DELAY_BETWEEN_QUERIES_MS)
    }

    await sleep(CONFIG.DELAY_BETWEEN_BATCHES_MS)
  }

  console.log("\n처리 종료")
  console.log(`성공 쿼리: ${totalQueries}개`)
  console.log(`생성 결과: ${totalResults}개`)
  console.log(`실패 쿼리: ${totalFailed}개`)
}

main().catch((err) => {
  console.error("전체 처리 중단:", err)
  process.exit(1)
})
