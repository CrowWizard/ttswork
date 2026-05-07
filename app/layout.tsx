import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "UP创作台 - B站UP主语音克隆与视频分析工具",
  description: "UP创作台：B站UP主专属创作工具，支持语音克隆、文本转语音、视频分析、评论洞察与文案生成。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}