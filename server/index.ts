import 'dotenv/config';
import express from 'express';
import { logger } from './logger.js';
import {
  enrichWords,
  EnrichmentResponseValidationError,
  EnrichmentServiceUnavailableError,
  generateArticle,
} from './gemini.js';
import { fetchDueReviewWords, recordReviewAttempt, recordBatchReviewAttempts } from './review.js';
import { getOrCreateAudio, batchGenerateAudio } from './audio.js';
import { ExampleAudioValidationError, getOrCreateExampleAudio } from './exampleAudio.js';
import {
  deleteLearningGroup,
  discardActiveOfficialLearningGroup,
  removeWordFromLibrary,
  saveWordToLibrary,
  type SavedWordSource,
} from './library.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { getHomeOverview } from './home.js';
import {
  ensureLiteVocabularyEntry,
  lookupWordForPopover,
  queueFullEnrichmentForWord,
  sanitizeLookupWord,
} from './vocab.js';
import { isOfficialLibraryId } from '../src/lib/officialLibrary.js';
import { analyzeWordBatch, formatDuplicateWordsMessage } from '../shared/wordBatch.js';

const app = express();
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip,
    });
  });
  next();
});

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

function resolveSavedWordSource(value: unknown): SavedWordSource | null {
  if (value === undefined || value === null) return 'reading_popup';
  if (value === 'reading_popup' || value === 'manual') return value;
  return null;
}

function resolveGeminiSource(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim();
  return normalized || fallback;
}

// POST /api/vocab/enrich
app.post('/api/vocab/enrich', async (req, res) => {
  const { words } = req.body;
  const source = resolveGeminiSource(req.body?.source, 'manual_api');
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'Missing words array' });
  }

  try {
    const data = await enrichWords(words, {
      source,
      enrichmentType: 'batch',
    });
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/enrich', e, { endpoint: '/api/vocab/enrich', source });
    
    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

// POST /api/vocab/lite-enrich
app.post('/api/vocab/lite-enrich', async (req, res) => {
  const word = sanitizeLookupWord(req.body?.word);
  const source = resolveGeminiSource(req.body?.source, 'manual_api');
  if (!word) {
    return res.status(400).json({ error: 'Missing word' });
  }

  try {
    const data = await ensureLiteVocabularyEntry(word, source);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/lite-enrich', e, { endpoint: '/api/vocab/lite-enrich', word, source });

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

// POST /api/vocab/lookup
app.post('/api/vocab/lookup', requireAuth, async (req: AuthenticatedRequest, res) => {
  const word = sanitizeLookupWord(req.body?.word);
  if (!word) {
    return res.status(400).json({ error: 'Missing word' });
  }

  const userId = req.authUserId!;
  try {
    const data = await lookupWordForPopover(userId, word);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/lookup', e, { endpoint: '/api/vocab/lookup', user_id: userId, word });

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

// POST /api/vocab/full-enrich
app.post('/api/vocab/full-enrich', requireAuth, async (req: AuthenticatedRequest, res) => {
  const word = sanitizeLookupWord(req.body?.word);
  if (!word) {
    return res.status(400).json({ error: 'Missing word' });
  }

  const userId = req.authUserId!;
  try {
    const result = await queueFullEnrichmentForWord(word, 'manual_api');
    if (result.reason === 'not_found') {
      return res.status(404).json({ error: 'Vocabulary item not found' });
    }

    res.status(result.queued ? 202 : 200).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/full-enrich', e, { endpoint: '/api/vocab/full-enrich', user_id: userId, word });
    res.status(500).json({ error: message });
  }
});

// POST /api/vocab/article
app.post('/api/vocab/article', async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'Missing words array' });
  }

  const cleaned = words
    .map((w) => (typeof w === 'string' ? w.trim() : ''))
    .filter(Boolean);

  try {
    const article = await generateArticle(cleaned);
    res.json({ data: article });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/article', e, { endpoint: '/api/vocab/article' });
    res.status(500).json({ error: message });
  }
});

// POST /api/review/attempt
app.post('/api/review/attempt', requireAuth, async (req: AuthenticatedRequest, res) => {
  const {
    vocabularyItemId,
    learningGroupId,
    source,
    wasCorrect,
    elapsedMs,
  } = req.body;

  if (!vocabularyItemId || !source || typeof wasCorrect !== 'boolean') {
    return res.status(400).json({ error: 'Missing required attempt fields' });
  }

  const userId = req.authUserId!;
  try {
    const result = await recordReviewAttempt({
      userId,
      vocabularyItemId,
      learningGroupId,
      source,
      wasCorrect,
      elapsedMs: Number(elapsedMs) || 0,
    });
    res.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/review/attempt', e, { endpoint: '/api/review/attempt', user_id: userId });
    res.status(500).json({ error: message });
  }
});

// POST /api/review/batch-attempt
app.post('/api/review/batch-attempt', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { attempts } = req.body;
  if (!Array.isArray(attempts)) {
    return res.status(400).json({ error: 'Missing attempts array' });
  }

  const userId = req.authUserId!;
  try {
    const results = await recordBatchReviewAttempts(userId, attempts);
    res.json({ data: results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/review/batch-attempt', e, { endpoint: '/api/review/batch-attempt', user_id: userId });
    res.status(500).json({ error: message });
  }
});

// GET /api/review/due
app.get('/api/review/due', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  try {
    const words = await fetchDueReviewWords(userId);
    res.json({ data: words });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/review/due', e, { endpoint: '/api/review/due', user_id: userId });
    res.status(500).json({ error: message });
  }
});

// GET /api/home/overview
app.get('/api/home/overview', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const timeZone = typeof req.query.timezone === 'string' ? req.query.timezone : null;

  try {
    const overview = await getHomeOverview(userId, timeZone);
    res.json({ data: overview });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/home/overview', e, {
      endpoint: '/api/home/overview',
      user_id: userId,
      timezone: timeZone,
    });
    res.status(500).json({ error: message });
  }
});

// POST /api/library/official/:libraryId/discard-active
app.post('/api/library/official/:libraryId/discard-active', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { libraryId } = req.params;
  const { groupId, timeZone } = req.body ?? {};

  if (!isOfficialLibraryId(libraryId)) {
    return res.status(400).json({ error: 'Unknown official library' });
  }

  if (typeof groupId !== 'string' || groupId.trim().length === 0) {
    return res.status(400).json({ error: 'Missing group ID' });
  }

  const userId = req.authUserId!;
  try {
    const result = await discardActiveOfficialLearningGroup(userId, {
      libraryId,
      groupId,
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    res.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`API Error: /api/library/official/${libraryId}/discard-active`, e, {
      endpoint: `/api/library/official/${libraryId}/discard-active`,
      user_id: userId,
      group_id: groupId,
    });
    res.status(500).json({ error: message });
  }
});

// POST /api/library/saved-words
app.post('/api/library/saved-words', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { vocabularyItemId } = req.body ?? {};
  const source = resolveSavedWordSource(req.body?.source);

  if (typeof vocabularyItemId !== 'string' || vocabularyItemId.trim().length === 0) {
    return res.status(400).json({ error: 'Missing vocabulary item ID' });
  }

  if (!source) {
    return res.status(400).json({ error: 'Invalid saved word source' });
  }

  const userId = req.authUserId!;
  try {
    const data = await saveWordToLibrary(userId, vocabularyItemId.trim(), source);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/library/saved-words', e, {
      endpoint: '/api/library/saved-words',
      user_id: userId,
      vocabulary_item_id: vocabularyItemId,
      source,
    });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/library/saved-words/:vocabularyItemId
app.delete('/api/library/saved-words/:vocabularyItemId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { vocabularyItemId } = req.params;
  if (!vocabularyItemId) {
    return res.status(400).json({ error: 'Missing vocabulary item ID' });
  }

  const userId = req.authUserId!;
  try {
    const data = await removeWordFromLibrary(userId, vocabularyItemId);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`API Error: /api/library/saved-words/${vocabularyItemId}`, e, {
      endpoint: `/api/library/saved-words/${vocabularyItemId}`,
      user_id: userId,
      vocabulary_item_id: vocabularyItemId,
    });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/library/groups/:groupId
app.delete('/api/library/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ error: 'Missing group ID' });

  const userId = req.authUserId!;
  try {
    await deleteLearningGroup(userId, groupId);
    res.json({ data: { success: true } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`API Error: /api/library/groups/${groupId}`, e, { endpoint: `/api/library/groups/${groupId}`, user_id: userId });
    res.status(500).json({ error: message });
  }
});

// GET /api/audio/:word
app.get('/api/audio/:word', async (req, res) => {
  const { word } = req.params;
  const locale = (req.query.locale as 'uk' | 'us') || 'uk';

  if (!word) return res.status(400).json({ error: 'Missing word' });

  try {
    const url = await getOrCreateAudio(word, locale);
    res.json({ data: url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`API Error: /api/audio/${word}`, e, { endpoint: `/api/audio/${word}`, locale });
    res.status(500).json({ error: message });
  }
});

// POST /api/audio/batch
app.post('/api/audio/batch', async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words)) return res.status(400).json({ error: 'Missing words array' });

  const cleaned = words
    .map((w) => (typeof w === 'string' ? w.trim() : ''))
    .filter(Boolean)
    .slice(0, 30);

  try {
    const urls = await batchGenerateAudio(cleaned);
    res.json({ data: urls });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/audio/batch', e, { endpoint: '/api/audio/batch' });
    res.status(500).json({ error: message });
  }
});

// POST /api/example-audio
app.post('/api/example-audio', async (req, res) => {
  const { text, locale } = req.body ?? {};

  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing example text' });
  }

  if (locale !== 'uk' && locale !== 'us') {
    return res.status(400).json({ error: 'Invalid locale' });
  }

  try {
    const url = await getOrCreateExampleAudio(text, locale);
    res.json({ data: url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ExampleAudioValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }

    logger.error('API Error: /api/example-audio', e, { endpoint: '/api/example-audio', locale });
    res.status(500).json({ error: message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
