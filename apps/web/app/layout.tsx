import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "PM + Manufacturing Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
