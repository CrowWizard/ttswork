import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "语音复刻工作台",
  description: "支持手机号登录、建声管理与文本转语音的语音工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
