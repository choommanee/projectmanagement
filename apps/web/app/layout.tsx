import "./globals.css";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { QueryProvider } from "@/lib/query";

export const metadata = { title: "PM + Manufacturing Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
