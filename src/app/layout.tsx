import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ETF Market — 中国场内 ETF 全市场监控终端",
  description: "沪深交易所场内 ETF 行情监控、分类筛选与自选观察",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-terminal-bg text-terminal-text">{children}</body>
    </html>
  );
}
