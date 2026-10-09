import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkillHub",
  referrer: "no-referrer",
  description: "Find what you need. Or just look around. 发现、收藏与发布 Agent 技能，支持标准 ZIP 包与 API 调用。",
  icons: {
    icon: "/skillhub-icon.svg",
    shortcut: "/skillhub-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
