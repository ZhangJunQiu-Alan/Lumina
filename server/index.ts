import 'dotenv/config';
import express from 'express';
import { logger } from './logger.js';
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

// POST /api/vocab/enrich
app.post('/api/vocab/enrich', async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'Missing words array' });
  }

  try {
    const data = await enrichWords(words);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/enrich', e, { endpoint: '/api/vocab/enrich' });
    
    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
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

  try {
    const result = await recordReviewAttempt(req.user.id, {
      vocabularyItemId,
      learningGroupId,
      source,
      wasCorrect,
      elapsedMs: Number(elapsedMs) || 0,
    });
    res.json({ data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/review/attempt', e, { endpoint: '/api/review/attempt', user_id: req.user.id });
    res.status(500).json({ error: message });
  }
});

// GET /api/review/due
app.get('/api/review/due', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const words = await fetchDueReviewWords(req.user.id);
    res.json({ data: words });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/review/due', e, { endpoint: '/api/review/due', user_id: req.user.id });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/library/groups/:groupId
app.delete('/api/library/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ error: 'Missing group ID' });

  try {
    await deleteLearningGroup(req.user.id, groupId);
    res.json({ data: { success: true } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`API Error: /api/library/groups/${groupId}`, e, { endpoint: `/api/library/groups/${groupId}`, user_id: req.user.id });
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
