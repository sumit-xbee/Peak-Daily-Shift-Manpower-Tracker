import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import NavProgress from "@/components/NavProgress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Peak Shift Tracker",
  description: "Shift-level manpower tracking for hubs",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
