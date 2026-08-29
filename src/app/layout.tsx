import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TagMind — 用一句话找到文件里的那一秒",
  description: "专为自媒体与音视频创作者打造的素材智能索引工具。视频/音频/图片秒级检索、台词AI校对、四维标签提炼，绝不修改原文件名，让剪辑师准点下班！",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-[#f5f1e8] text-[#16231f] selection:bg-[#ddf36a] selection:text-[#16231f]">
        {children}
      </body>
    </html>
  );
}
