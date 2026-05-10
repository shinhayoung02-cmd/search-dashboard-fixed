import './globals.css'

export const metadata = {
  title: '검색 대시보드',
  description: '키워드 검색 결과 자동 요약',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
