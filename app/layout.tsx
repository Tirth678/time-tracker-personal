import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";

// Both fonts are served from this deployment: no request to a font CDN.
const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

const instrumentSerif = localFont({
  src: "./fonts/InstrumentSerif-Italic.woff2",
  variable: "--font-instrument",
  weight: "400",
  style: "italic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Study Tracker",
  description: "A calm timer for your study sessions: name a session, start the clock, and watch the hours add up.",
  applicationName: "Study Tracker",
  // Your study log is personal: keep it out of search results.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Study Tracker", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#060a14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
