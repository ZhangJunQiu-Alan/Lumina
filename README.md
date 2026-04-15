# Lumina IELTS

AI-powered vocabulary learning app for IELTS preparation. Paste any English words, get instant AI enrichment (IPA, definitions, examples, memory tips), then learn through a 3-round memorization system with spaced repetition review.

---

## Features

- **AI Word Enrichment** — Gemini 2.0 Flash generates IPA (UK/US), Chinese definitions, usage examples, confused-word comparisons, and memory tips for any word list
- **3-Round Learning Engine**
  - Round 1: Guided spelling (input stays active while all word details are shown in plain text)
  - Round 2: Recall (see Chinese → type English, then validate with Enter or Next Word, with immediate state writeback)
  - Round 3: Flip-card (Reveal Meaning / Next Word, with Enter shortcut)
- **State-Driven Review** — words move through `new / fuzzy / slow_recall / stable_recall / mastered`, with review scheduling handled by the server
- **Import Flow** — paste up to 30 words, preview AI output, save to personal library
- **Word Detail & Review Summary** — inspect each word's current memory state in the library and review transitions after each daily session

---

## Prerequisites

- Node.js 18+
- A Supabase project
- A Google Gemini API key

---

## Setup

### 1. Install dependencies

```bash
npm install
npm run test:review
```

### 2. Configure environment variables

Create `.env` in the project root:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-jwt>
SUPABASE_DB_PASSWORD=<your-db-password>
GEMINI_API_KEY=<your-gemini-api-key>
```

### 3. Deploy the database schema

Open your [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor, paste the contents of `supabase/schema.sql`, and click **Run**.

This creates 8 tables: `vocabulary_items`, `vocabulary_senses`, `confused_words`, `learning_groups`, `learning_group_words`, `review_states`, `review_events`, `generated_articles`.

### 4. Run the app

Two processes must run simultaneously:

```bash
# Terminal 1 — Express API server (port 4000)
npm run server

# Terminal 2 — Vite dev server (port 3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Architecture

```
Browser (React 19 + Vite)
    │
    ├── /api/*  ──proxy──►  Express :4000
    │                           ├── POST /api/vocab/enrich → Gemini 2.0 Flash
    │                           ├── POST /api/review/attempt → state transition + persistence
    │                           └── GET /api/review/due → ordered review queue
    │
    ├── Supabase JS client  ──►  Supabase (UI reads, import writes)
    │
    └── Supabase service client ──► Supabase (review domain writes)
```

### Key files

| Path | Purpose |
|---|---|
| `src/App.tsx` | Routing shell, LearningEngine, ArticleView, real review flow |
| `src/components/home/HomeView.tsx` | Homepage — stats, today's plan, CTA |
| `src/components/import/ImportView.tsx` | 4-stage word import flow |
| `src/components/library/LibraryView.tsx` | Word detail drawer with memory state visibility |
| `src/components/review/ReviewResultsView.tsx` | Post-review transition summary |
| `src/components/layout/Sidebar.tsx` | Fixed navigation sidebar |
| `src/lib/supabase.ts` | Supabase client (frontend) |
| `src/lib/reviewApi.ts` | Frontend review API calls |
| `src/types.ts` | Shared types: Word, MemoryState, ReviewTransition, etc. |
| `server/index.ts` | Express server — vocab/article/review endpoints |
| `server/review-domain.ts` | Pure review rules: state transitions, timing thresholds, due queue sorting |
| `server/gemini.ts` | Gemini enrichment logic |
| `server/review.ts` | Review state machine, due queue hydration, event persistence |
| `server/supabase.ts` | Supabase service-role client |
| `supabase/schema.sql` | Full database schema |
| `scripts/test-review-rules.ts` | Pure rule checks for state transitions and due ordering |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript ~5.8, Vite ^6.2 |
| Styling | TailwindCSS v4 (Vite plugin), glass morphism design system |
| Animation | motion/react ^12 |
| Backend | Express ^4.21 |
| AI | Google Gemini 2.0 Flash (`@google/genai`) |
| Database | Supabase (PostgreSQL) |

---

## Development Notes

See `ai-learnings.md` for full architecture decisions, CSS design tokens, round behavior rules, remaining tech debt, and session logs.

Available local verification:

```bash
npm run lint
npm run build
npm run test:review
```
