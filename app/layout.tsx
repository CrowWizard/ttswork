import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice MVP",
  description: "匿名建声与 TTS MVP",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
