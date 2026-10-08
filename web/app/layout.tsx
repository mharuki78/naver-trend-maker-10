import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "네이버 트렌드 마법사",
  description: "네이버 쇼핑인사이트 월간 인기검색어를 수집하고 확인하는 배곧인터내셔널 업무 도구",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/apple-icon.svg", rel: "apple-touch-icon", type: "image/svg+xml" }
    ],
    apple: [{ url: "/apple-icon.svg", type: "image/svg+xml" }]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
