import 'dotenv/config';
import express from 'express';
import {
  enrichWords,
  EnrichmentResponseValidationError,
  EnrichmentServiceUnavailableError,
  generateArticle,
} from './gemini.js';
import { fetchDueReviewWords, recordReviewAttempt } from './review.js';
import { getOrCreateAudio, batchGenerateAudio } from './audio.js';
import { deleteLearningGroup } from './library.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { analyzeWordBatch, formatDuplicateWordsMessage } from '../shared/wordBatch.js';

const app = express();
app.use(express.json());

const appOrigin = process.env.APP_ORIGIN?.trim();
const allowedOrigins = new Set(['http://localhost:3000', appOrigin].filter(Boolean));

app.use((req, res, next) => {
  const origin = req.header('Origin');

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (!origin) {
    next();
    return;
  }

  if (!allowedOrigins.has(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  next();
});

app.options('*', (req, res) => {
  const origin = req.header('Origin');

  if (origin && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  res.sendStatus(204);
});

// POST /api/vocab/enrich
// Body: { words: string[] }
// Returns: enriched word array
app.post('/api/vocab/enrich', requireAuth, async (req, res) => {
  const { words } = req.body as { words?: unknown };

  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ error: '请传入一组英文单词，格式为 words: string[]。' });
    return;
  }

  const cleaned = analyzeWordBatch(
    (words as unknown[]).filter((w): w is string => typeof w === 'string'),
    { limit: 30 },
  );

  if (cleaned.words.length === 0) {
    res.status(400).json({ error: '没有识别到可用单词，请贴一组英文单词后再试。' });
    return;
  }

  if (cleaned.duplicateWords.length > 0) {
    res.status(400).json({ error: formatDuplicateWordsMessage(cleaned.duplicateWords) });
    return;
  }

  try {
    const enriched = await enrichWords(cleaned.words);
    res.json({ data: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof EnrichmentResponseValidationError || err instanceof EnrichmentServiceUnavailableError
      ? err.statusCode
      : 500;
    console.error('[/api/vocab/enrich]', message);
    res.status(status).json({ error: message });
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

// DELETE /api/library/groups/:groupId
// Deletes one personal learning group and clears review state only for words no longer used elsewhere
app.delete('/api/library/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const groupId = (req.params.groupId ?? '').trim();

  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  try {
    const result = await deleteLearningGroup(req.authUserId!, groupId);
    res.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[/api/library/groups/${groupId}]`, message);
    const status =
      message.includes('不存在')
      || message.includes('不属于你')
      || message.includes('不支持删除')
        ? 400
        : 500;
    res.status(status).json({ error: message });
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

const parsedPort = Number.parseInt(process.env.PORT ?? '4000', 10);
const PORT = Number.isNaN(parsedPort) ? 4000 : parsedPort;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
