---
id: arch-frontend-structure
type: architecture
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Frontend Repository Structure (Next.js App Router)

## Overview
Standard folder structure for Next.js 16+ applications using App Router.

## Structure
```
/src
├── /app                  # App Router pages & layouts
│   ├── /api             # API routes
│   ├── /(auth)          # Auth route group
│   ├── /(dashboard)     # Dashboard route group
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Home page
├── /components          # Reusable UI components
│   ├── /ui              # Primitive components
│   └── /features        # Feature-specific components
├── /lib                 # Utilities and configurations
│   ├── /hooks          # Custom React hooks
│   └── /utils          # Helper functions
├── /styles             # Global styles
└── /types              # TypeScript type definitions

/tests
├── /e2e                # Playwright E2E tests
│   ├── /pages         # Page Object Models
│   └── /fixtures      # Test fixtures
└── /unit              # Component unit tests
```

## App Router Conventions
| File | Purpose |
|------|---------|
| `page.tsx` | Page component (route) |
| `layout.tsx` | Shared layout wrapper |
| `loading.tsx` | Loading UI |
| `error.tsx` | Error boundary |
| `not-found.tsx` | 404 page |

## Component Organization
- **Server Components**: Default, use for data fetching
- **Client Components**: Add `'use client'` directive when needed
- **Shared Components**: Place in `/components/ui`
