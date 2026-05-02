# `@ignislink/web`

Dispatcher console + public awareness map + admin, in one Next.js app.

## Getting started

```bash
# from the repo root
pnpm install
pnpm --filter @ignislink/web dev
```

The dev server runs on `http://localhost:3000` with Turbopack. Routes:

- `/` — Public Awareness Map (read-only civilian view)
- `/console` — Dispatcher Console (auth-gated when Stage 5 lands)
- `/admin` — Admin (auth-gated)

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS 3 + shadcn/ui (`new-york` style, base color `zinc`)
- Lucide icons, Framer Motion
- TanStack Query, Zustand, Socket.IO client
- Mapbox GL JS + deck.gl (Stage 1+)

## Conventions

- Every new screen / component starts with **Magic MCP** (`@21st-dev/magic`)
  scaffolding; refined with shadcn primitives. No MUI / Chakra / hand-rolled
  buttons or dialogs.
- Dark mode is the default — the html element ships with `class="dark"`. The
  `midnight` class is the further-dimmed dispatch palette.
- WCAG AA minimum. Keyboard-first nav: `Cmd-K` palette, single-letter shortcuts
  in the console (D V M / J K Esc ?).
- All user-visible strings live in `src/strings/` for future i18n.

## Code layout

```
src/
├── app/                  # Next.js App Router routes
│   ├── layout.tsx
│   ├── page.tsx          # Public Awareness Map
│   ├── console/page.tsx  # Dispatcher Console
│   ├── admin/page.tsx    # Admin
│   └── not-found.tsx
├── components/
│   └── ui/               # shadcn primitives, added via `pnpm dlx shadcn@latest add <name>`
├── lib/
│   ├── utils.ts          # cn() helper, time formatters
│   └── hooks/            # custom React hooks
├── strings/              # user-visible strings (i18n-ready)
└── styles/
    └── globals.css       # Tailwind base + shadcn CSS variables
```

## Testing

- **Vitest** for unit tests (`pnpm --filter @ignislink/web test`).
- **Playwright** for the console critical path — receive detection → verify →
  dispatch → audit. Lives in `e2e/` (added in Stage 5).
