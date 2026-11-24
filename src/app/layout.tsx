import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Course registration | 수강신청 플랫폼",
  description: "새로운 배움. 나의 선택으로.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
