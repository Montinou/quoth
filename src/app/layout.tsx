import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cinzel, Cormorant_Garamond } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { OrganizationSchema, SoftwareApplicationSchema } from "@/components/SchemaMarkup";
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

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://quoth.ai-innovation.site'),
  title: {
    default: 'Quoth | The Living Source of Truth',
    template: '%s | Quoth',
  },
  description: 'Quoth is an AI-driven MCP server that enforces consistency between your codebase and documentation. Stop hallucinations. Enforce your architecture. Wisdom over Guesswork.',
  keywords: ['MCP', 'Model Context Protocol', 'AI Documentation', 'RAG', 'Code Auditor', 'Single Source of Truth', 'Vitest', 'Playwright', 'Claude Code', 'GEO'],
  authors: [{ name: 'Quoth Labs', url: 'https://quoth.ai-innovation.site' }],
  creator: 'Quoth Labs',
  publisher: 'Quoth Labs',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://quoth.ai-innovation.site',
    siteName: 'Quoth',
    title: 'Quoth | The Living Source of Truth',
    description: 'The arbiter of truth between your code and its documentation. Stoic. Precise. Unyielding.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Quoth - Wisdom over Guesswork' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Quoth | The Living Source of Truth',
    description: 'Stop AI hallucinations. Enforce your architecture. MCP server for documentation-driven development.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://quoth.ai-innovation.site',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} ${cormorantGaramond.variable} antialiased`}
      >
        <OrganizationSchema />
        <SoftwareApplicationSchema />
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
