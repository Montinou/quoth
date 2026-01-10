import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cinzel } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Quoth | The Living Source of Truth",
  description: "The AI-driven auditor that enforces consistency between your codebase and documentation. Stop hallucinations. Enforce your architecture. Nevermore guess.",
  keywords: ["MCP", "Model Context Protocol", "AI", "Documentation", "Code Auditor", "Architecture", "Vitest", "Playwright"],
  authors: [{ name: "Quoth Labs" }],
  openGraph: {
    title: "Quoth | The Living Source of Truth",
    description: "The arbiter of truth between your code and its documentation. Stoic. Precise. Unyielding.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
