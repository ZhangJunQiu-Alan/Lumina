# AI Learnings — Lumina IELTS

> This file is the project knowledge base. Update it after each development session.
> Always read this file before starting new work.

---

## Tech Stack

| Layer | Technology | Version | Status |
|---|---|---|---|
| Frontend | React | 19 | ✅ |
| Language | TypeScript | ~5.8 | ✅ |
| Build | Vite | ^6.2 | ✅ |
| Styling | TailwindCSS | ^4.1 (Vite plugin, NOT PostCSS) | ✅ |
| Animation | motion/react | ^12 | ✅ |
| Icons | lucide-react | ^0.546 | ✅ |
| AI | @google/genai | ^1.29 (Gemini 2.0 Flash) | ✅ server-side only |
| Backend | Express | ^4.21 (port 4000) | ✅ |
| DB/Storage | Supabase JS | ^2 | ✅ |
| DB client (scripts) | pg | ^8 | ✅ scripts only |

### Dev commands
```bash
npm run dev      # Vite frontend on :3000
npm run server   # Express backend on :4000 (tsx --env-file=.env server/index.ts)
npm run test:review  # pure review-domain checks
```
Both must run simultaneously. Vite proxies `/api/*` → `http://localhost:4000`.

---

## Environment Variables (.env)

```
VITE_SUPABASE_URL=          # used by frontend (src/lib/supabase.ts)
VITE_SUPABASE_PUBLISHABLE_KEY=  # used by frontend
SUPABASE_SERVICE_ROLE_KEY=  # used by server review routes (server/supabase.ts)
SUPABASE_DB_PASSWORD=       # used by scripts/run-migration.mjs
GEMINI_API_KEY=             # server-side only (server/gemini.ts), NOT in Vite define
```

**Critical**: `GEMINI_API_KEY` must NOT be in `vite.config.ts` `define` block — it would be bundled into the frontend.

---

## CSS Design System

### Utility classes (defined in `src/index.css` via `@layer utilities`)
- `.glass` — frosted glass card: `rgba(255,255,255,0.7)` + `backdrop-filter: blur(30px)` + white border
- `.glass-dark` — dark variant for overlays
- `.jelly-shadow` — `box-shadow: 0 20px 60px rgba(0,0,0,0.08)`

### Color tokens (use as Tailwind classes: `text-apple-blue`, `bg-apple-red/10`, etc.)
```
apple-blue:   #007AFF
apple-gray:   #F5F5F7  (also bg-apple-gray for input backgrounds)
apple-red:    #FF3B30
apple-orange: #FF9500
apple-green:  #34C759
apple-indigo: #5856D6
apple-teal:   #30B0C7
text-primary:    #1D1D1F
text-secondary:  #86868B
```

### Border radius tokens
- `rounded-apple` → 24px
- `rounded-apple-lg` → 32px

### Background
`body` has a subtle radial gradient: blue at top-left, indigo at bottom-right, on `#F5F5F7` base.

---

## Component Conventions

### Animation patterns
- **Page entry**: `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}`
- **Card stagger**: `transition={{ delay: 0.1 + index * 0.07, duration: 0.4 }}`
- **Sidebar mount**: `initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }}`
- Use `AnimatePresence mode="wait"` for view transitions in App.tsx

### Prop shape conventions
- Views receive their data as explicit props, not from context (keep components portable)
- Use `LucideIcon` type from `lucide-react` for icon props

---

## Project Structure

```
lumina-ielts/
  server/
    index.ts        ← Express entry (port 4000), CORS wildcard (dev only)
    gemini.ts       ← enrichWords() — Gemini 2.0 Flash enrichment
    review-domain.ts ← pure state transition + scheduling rules
    review.ts       ← review state machine + due queue hydration
    supabase.ts     ← service-role Supabase client for review writes
  src/
    components/
      layout/
        Sidebar.tsx         ← nav sidebar (fixed, left side)
      home/
        HomeView.tsx        ← homepage (stats, today's plan, CTA)
        StatCard.tsx        ← reusable stat card
      import/
        ImportView.tsx      ← 4-stage import flow (input → loading → preview → saving)
      library/
        LibraryView.tsx     ← word detail drawer + memory state visibility
      review/
        ReviewResultsView.tsx ← post-review upgrade/downgrade summary
    lib/
      supabase.ts           ← createClient() using VITE_ env vars
      reviewApi.ts          ← fetchDueReviewWords() + submitReviewAttempt()
    App.tsx                 ← routing shell + LearningEngine + article/review orchestration
    types.ts                ← shared domain types + toWord()
    mockData.ts             ← legacy demo data only
    index.css               ← TailwindCSS v4 + design tokens
  supabase/
    schema.sql              ← 8-table schema (run in Supabase Dashboard SQL Editor)
  scripts/
    run-migration.mjs       ← pg-based schema runner (requires direct DB access)
    test-full-flow.mjs      ← end-to-end test: enrich → save → assess → verify
    test-review-rules.ts    ← pure rule checks for review transitions + queue order
    ai-learnings.md           ← this file
```

---

## Views (ViewState)
- `home` → HomeView
- `library` → LibraryView (real tracked vocabulary + detail drawer)
- `import` → ImportView (full implementation)
- `profile` → stub (user card)
- `learning` → LearningEngine or ArticleView depending on `round` state
- `reviewResults` → ReviewResultsView

---

## Data Structures (types.ts)

```ts
// Used by the learning engine
Word {
  id, word, phonetic, pos_tags[], ner_entities[],
  chinese_definition, example_sentences[], confusing_pair?
}

// Returned by Gemini / stored in Supabase
WordSense {
  pos, meaning_zh, example_sentence, example_translation_zh
}

EnrichedWord {
  id?, word, ipa_uk, ipa_us, primary_meaning_zh,
  ner_label, senses: WordSense[], confused_word,
  confused_diff_zh, memory_tip
}

// toWord(e: EnrichedWord): Word — converts for learning engine

UserStats {
  todayReviewCount, todayNewGroups, streak, totalLearned
}

MemoryState {
  'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered'
}

ReviewTransition {
  from, to, source, result, graduated, nextReviewAt
}

ReviewWord extends Word {
  memoryState, nextReviewAt, lastResult
}
```

---

## Database Schema (Supabase — 8 tables)

**Deploy method**: paste `supabase/schema.sql` into Supabase Dashboard → SQL Editor → Run.
Direct pg connection fails on machines without IPv6 (Supabase only has AAAA records).

| Table | Key columns | Notes |
|---|---|---|
| vocabulary_items | id, word (UNIQUE), ipa_uk, ipa_us, primary_meaning_zh, ner_label, memory_tip, source_type | Core word data |
| vocabulary_senses | id, vocabulary_item_id, pos, meaning_zh, example_sentence, example_translation_zh | 1–N per word |
| confused_words | id, vocabulary_item_id, confused_word, difference_note_zh | 0–1 per word |
| learning_groups | id, group_name, source_type, created_at | Groups of 30 words |
| learning_group_words | learning_group_id, vocabulary_item_id, sequence_no | Join table |
| review_states | user_id, vocabulary_item_id, memory_state, next_review_at, last_result, last_elapsed_ms | Review snapshot / due scheduling |
| review_events | vocabulary_item_id, learning_group_id, source, was_correct, elapsed_ms, previous_state, next_state | Full review history |
| generated_articles | id, learning_group_id, content, created_at | Post-round3 reading |

All tables have RLS enabled with open `public_all` policies (dev only — tighten before prod).

---

## API Endpoints

### `POST /api/vocab/enrich`
- **Body**: `{ words: string[] }` (max 30)
- **Response**: `{ data: EnrichedWord[] }`
- Calls Gemini 2.0 Flash with structured JSON prompt
- Strips markdown code fences from response before JSON.parse

### `POST /api/vocab/article`
- **Body**: `{ words: string[] }`
- **Response**: `{ data: string }`
- Generates the round3 reading passage

### `POST /api/review/attempt`
- **Body**: `{ vocabularyItemId, learningGroupId?, source, wasCorrect, elapsedMs }`
- **Response**: `{ data: { memoryState, nextReviewAt, graduated, transition } }`
- Server computes the state transition and writes both `review_states` and `review_events`

### `GET /api/review/due`
- **Response**: `{ data: ReviewWord[] }`
- Returns due review words hydrated into the frontend `Word` shape, sorted by urgency

### `GET /api/health`
- Returns `{ ok: true }`

---

## Round Behavior Rules

```
home → review (if due) → reviewResults → home
home/import → round1 → round2 → round3 → article → home
```

If `todayReviewCount > 0`: CTA starts a real due queue from `GET /api/review/due`.

| Round | Input method | Advance method | Wrong answer |
|---|---|---|---|
| round1 | Input box stays visible, and the word/phonetic/POS/meaning/examples/confusion notes are all shown in plain text | Enter or click "Next Word" runs validation; correct answer advances | Stay on current word, input turns red |
| round2 | See Chinese → type English | Enter or click "Next Word" runs validation; correct answer advances after `/api/review/attempt` succeeds | Show answer immediately, clear input, `nextWord()` after 1500ms |
| review | Same prompt as round2 | Enter validates | Same as round2 |
| round3 | Flip-card (phonetic → reveal meaning/example) | Primary buttons are "Reveal Meaning" / "Next Word"; Enter triggers the current primary action | N/A |

**Round 1 / Round 2 validation rule**: Enter key and the `Next Word` button both go through the same validation path.

**Round 2 / Review persistence rule**: each submitted word attempt writes immediately through the server before the UI advances.

**Round 2 wrong-answer UX detail**: `setInputValue('')` and `setIsWrong(false)` fire at the same time as `setShowAnswer(true)` — input is cleared immediately, not after the 1500ms delay.

### Stale closure fix (nextWord in App.tsx)
`nextWord` is called inside `setTimeout` — must use refs to avoid stale closure:
```tsx
const queueRef = useRef<Word[]>([]);
const currentIndexRef = useRef(0);
useEffect(() => { queueRef.current = queue; }, [queue]);
useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
const nextWord = useCallback(() => {
  if (currentIndexRef.current < queueRef.current.length - 1) {
    setCurrentIndex(prev => prev + 1);
    setInputValue(''); setIsWrong(false); setShowAnswer(false);
  } else { onComplete(); }
}, [onComplete]);
```

### ProgressBar must NOT be a React component
`renderProgressBar(currentIndex, queueLength)` is a plain function outside `LearningEngine`.
If defined as `const ProgressBar = () => ...` inside the component body, React unmounts/remounts it on every render (breaks animations).

---

## ImportView Flow

4 stages: `input` → `loading` → `preview` → `saving`

1. User pastes words (comma/newline separated, max 30)
2. `POST /api/vocab/enrich` → Gemini enriches
3. Preview shown: word + IPA + POS + Chinese meaning
4. "Start Learning" → `saveToSupabase()` → `onStartLearning(words, groupId)`

### saveToSupabase write order
1. Upsert `vocabulary_items` (onConflict: word)
2. `Promise.all` per word: delete+insert `vocabulary_senses`, delete+insert `confused_words`
3. Insert `learning_groups`
4. Insert `learning_group_words`
5. Upsert `review_states` with `memory_state = 'new'`, `next_review_at = null`

Uses `Promise.all` (not serial loop) — 30 words × 4 DB ops = would be 120 sequential round-trips otherwise.
Every insert checks `error` and throws if non-null.

---

## Remaining Technical Debt

| # | Issue | File | Priority |
|---|---|---|---|
| 5 | No global state management — props drilled from App.tsx | App.tsx | Medium |
| 6 | Frontend still owns import writes directly to Supabase; only review rules are fully server-owned | ImportView.tsx | Medium |
| 7 | No automated tests yet cover `/api/review/attempt` transition matrix | server/review.ts | High |
| 8 | `profile` view still shows placeholder mastery/accuracy cards | App.tsx | Low |
| 10 | CORS wildcard (`*`) in Express | server/index.ts | Medium (before prod) |
| 11 | `SUPABASE_DB_PASSWORD` is used directly in a local migration script | scripts/ | Low (dev scripts only) |

---

## Sessions

### Session 1 (2026-04-14)
- Extracted `Sidebar` and `HomeView` + `StatCard` from monolithic App.tsx
- Added "Today's Plan" section to HomeView showing review → new-words pipeline with lock/unlock state
- Removed time-based greeting; header now shows app name + user name
- Established folder structure and this knowledge base

### Session 2 (2026-04-14)
- Identified 11 technical debt items via audit
- Fixed bugs #1–3 (stale closure nextWord, round2 UX, ProgressBar remount)
- Integrated Supabase: added `src/lib/supabase.ts`, `supabase/schema.sql` (7 tables), deployed schema via Dashboard SQL Editor (direct pg connect failed — IPv6 only)
- Integrated Gemini: `server/gemini.ts` + `server/index.ts` Express backend with `/api/vocab/enrich`
- Implemented full `ImportView` with 4-stage flow

### Session 3 (2026-04-14)
- Fixed TS errors: `key` prop on fragments, `ImportMeta.env` (added `vite/client` to tsconfig types)
- Fixed round1 badge always-visible bug (`type === 'round1'` condition was always true)
- Fixed round3 showing input field instead of flip-card UX
- Removed `GEMINI_API_KEY` from `vite.config.ts` `define` (was leaking to frontend bundle)
- Fixed remaining ProgressBar reference after bulk replace
- Added `scripts/test-full-flow.mjs` for end-to-end Supabase verification

### Session 4 (2026-04-14)
- Fixed bug #4: `saveToSupabase` serial loop → `Promise.all` with error checking
- Changed Round 1 advancement: timer (500ms setTimeout) → explicit "Next Word" button + Enter key
- Synced knowledge base (this file) and README

### Session 5 (2026-04-15)
- Updated Round 1 UI: input remains, while all current-word information is shown in plain text for guided spelling
- Changed Round 1 / Round 2 `Next Word` to share the same validation path as Enter
- Added Enter-key handling to Round 3 so it triggers the current primary action (`Reveal Meaning` / `Next Word`)

### Session 6 (2026-04-15)
- Implemented the state-driven review system v1
- Added `memory_state`, review metadata fields, and `review_events`
- Added server-owned review routes: `POST /api/review/attempt` and `GET /api/review/due`
- Switched Round2 / review attempts to immediate server persistence with elapsed-time based classification
- Changed home review entry to load a real due queue instead of slicing local mock words
- Added tracked library detail drawer and post-review transition summary page
