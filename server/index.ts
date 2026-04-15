import 'dotenv/config';
import express from 'express';
import { enrichWords, generateArticle } from './gemini.js';
import { fetchDueReviewWords, recordReviewAttempt } from './review.js';
import { getOrCreateAudio, batchGenerateAudio } from './audio.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';

const app = express();
app.use(express.json());

// CORS for Vite dev server
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// POST /api/vocab/enrich
// Body: { words: string[] }
// Returns: enriched word array
app.post('/api/vocab/enrich', requireAuth, async (req, res) => {
  const { words } = req.body as { words?: unknown };

  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ error: 'words must be a non-empty array of strings' });
    return;
  }

  const cleaned = (words as unknown[])
    .filter((w): w is string => typeof w === 'string')
    .map(w => w.trim())
    .filter(Boolean)
    .slice(0, 30); // cap at 30 per request

  if (cleaned.length === 0) {
    res.status(400).json({ error: 'No valid words provided' });
    return;
  }

  try {
    const enriched = await enrichWords(cleaned);
    res.json({ data: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/vocab/enrich]', message);
    res.status(500).json({ error: message });
  }
});

// POST /api/vocab/article
// Body: { words: string[] }
// Returns: { data: string } — IELTS reading passage
app.post('/api/vocab/article', requireAuth, async (req, res) => {
  const { words } = req.body as { words?: unknown };

  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ error: 'words must be a non-empty array' });
    return;
  }

  const cleaned = (words as unknown[])
    .filter((w): w is string => typeof w === 'string')
    .map(w => w.trim())
    .filter(Boolean);

  try {
    const article = await generateArticle(cleaned);
    res.json({ data: article });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/vocab/article]', message);
    res.status(500).json({ error: message });
  }
});

// POST /api/review/attempt
// Body: { vocabularyItemId, learningGroupId?, source, wasCorrect, elapsedMs }
// Returns: review transition and next due time
app.post('/api/review/attempt', requireAuth, async (req: AuthenticatedRequest, res) => {
  const {
    vocabularyItemId,
    learningGroupId,
    source,
    wasCorrect,
    elapsedMs,
  } = req.body as {
    vocabularyItemId?: unknown;
    learningGroupId?: unknown;
    source?: unknown;
    wasCorrect?: unknown;
    elapsedMs?: unknown;
  };

  if (typeof vocabularyItemId !== 'string' || !vocabularyItemId.trim()) {
    res.status(400).json({ error: 'vocabularyItemId is required' });
    return;
  }

  if (source !== 'round2' && source !== 'review') {
    res.status(400).json({ error: 'source must be round2 or review' });
    return;
  }

  if (typeof wasCorrect !== 'boolean') {
    res.status(400).json({ error: 'wasCorrect must be a boolean' });
    return;
  }

  if (typeof elapsedMs !== 'number' || Number.isNaN(elapsedMs)) {
    res.status(400).json({ error: 'elapsedMs must be a number' });
    return;
  }

  try {
    const attempt = await recordReviewAttempt({
      userId: req.authUserId!,
      vocabularyItemId,
      learningGroupId: typeof learningGroupId === 'string' ? learningGroupId : null,
      source,
      wasCorrect,
      elapsedMs,
    });
    res.json({ data: attempt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/review/attempt]', message);
    res.status(500).json({ error: message });
  }
});

// GET /api/review/due
// Returns hydrated due review words ordered by urgency
app.get('/api/review/due', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const words = await fetchDueReviewWords(req.authUserId!);
    res.json({ data: words });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/review/due]', message);
    res.status(500).json({ error: message });
  }
});

// GET /api/audio/:word?locale=uk|us
// Returns { data: url } — generates + caches on first call
app.get('/api/audio/:word', async (req, res) => {
  const word = (req.params.word ?? '').trim();
  const locale = req.query.locale === 'us' ? 'us' : 'uk';

  if (!word) {
    res.status(400).json({ error: 'word is required' });
    return;
  }

  try {
    const url = await getOrCreateAudio(word, locale);
    res.json({ data: url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[/api/audio/${word}]`, message);
    res.status(500).json({ error: message });
  }
});

// POST /api/audio/batch
// Body: { words: string[] }
// Returns: { data: Record<word, { uk_url, us_url }> }
app.post('/api/audio/batch', async (req, res) => {
  const { words } = req.body as { words?: unknown };

  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ error: 'words must be a non-empty array' });
    return;
  }

  const cleaned = (words as unknown[])
    .filter((w): w is string => typeof w === 'string')
    .map(w => w.trim())
    .filter(Boolean)
    .slice(0, 30);

  try {
    const urls = await batchGenerateAudio(cleaned);
    res.json({ data: urls });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/audio/batch]', message);
    res.status(500).json({ error: message });
  }
});

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = 4000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
