import 'dotenv/config';
import './env.js';
import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type NextFunction, type Response } from 'express';
import { logger } from '../shared/server/logger.ts';
import {
  enrichWords,
  EnrichmentResponseValidationError,
  EnrichmentServiceUnavailableError,
  generateArticle,
} from '../shared/server/gemini.ts';
import {
  completeReviewSession,
  fetchDueReviewWords,
  markVocabularyMastered,
  markVocabularyUnknown,
  recordReviewAttempt,
  recordBatchReviewAttempts,
  startReviewSession,
} from '../shared/server/review.ts';
import { getOrCreateAudio, batchGenerateAudio } from '../shared/server/audio.ts';
import { ExampleAudioValidationError, getOrCreateExampleAudio } from '../shared/server/exampleAudio.ts';
import {
  createLearningGroupFromSavedWords,
  deleteLearningGroup,
  deleteOfficialLearningLibrary,
  discardActiveOfficialLearningGroup,
  getLibraryGroupDetail,
  getLibraryOverview,
  getSavedWords,
  removeWordFromLibrary,
  reorderActiveOfficialLearningGroup,
  saveWordToLibrary,
  type SavedWordSource,
} from '../shared/server/library.ts';
import { cleanupSavedLibrary } from '../shared/server/savedLibraryCleanup.ts';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import {
  authenticateLocalUser,
  createLocalUser,
  isLocalAuthEnabled,
  readBearerToken,
  updateLocalPassword,
  verifyLocalAccessToken,
} from '../shared/server/localAuth.ts';
import { getHomeOverview, getUserActivityHeatmap } from '../shared/server/home.ts';
import {
  getUserLearningPreferences,
  resolveLearningPreferencesPatch,
  saveUserLearningPreferences,
} from '../shared/server/settings.ts';
import {
  completeLearningRound,
  getLearningSession,
  saveLearningSession,
  startOfficialLearningSession,
  validateLearningRoundInput,
  validateOfficialLibraryId,
  validateOfficialStudyMode,
} from '../shared/server/learning.ts';
import { submitIeltsListeningAttempt, submitIeltsReadingAttempt } from '../shared/server/ieltsAttempts.ts';
import { getIeltsDashboard, getIeltsListeningTest, getIeltsReadingTest } from '../shared/server/ieltsDashboard.ts';
import {
  ensureLiteVocabularyEntry,
  lemmatizeVocabularyWord,
  lemmatizeVocabularyWords,
  lookupWordForPopover,
  persistFullVocabularyEntries,
  queueFullEnrichmentForWord,
  reportVocabularyIssue,
  sanitizeLookupWord,
  type VocabularySourceType,
} from '../shared/server/vocab.ts';
import { isOfficialLibraryId } from '../shared/officialLibraryLite.ts';
import { isAiContentFeaturesEnabled, isIeltsListeningEnabled } from '../shared/runtime.ts';
import {
  consumeExpensiveRateLimit,
  countStringArray,
  INTERNAL_ERROR_MESSAGE,
  isRateLimitExceeded,
  type ExpensiveApiGroup,
} from '../shared/expensiveRateLimit.ts';
import { localStoragePublicRoot } from '../shared/server/supabase.ts';

const app = express();

const requestIdHeader = 'X-Request-Id';

function resolveRequestId(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || randomUUID();
}

function requestLogContext(res: Response, context: Record<string, unknown> = {}) {
  return {
    request_id: res.locals.requestId,
    ...context,
  };
}

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = resolveRequestId(req.header(requestIdHeader));
  res.locals.requestId = requestId;
  res.setHeader(requestIdHeader, requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`, {
      request_id: requestId,
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
const defaultAllowedOrigins = [
  'https://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const configuredOrigins = (process.env.LUMINA_APP_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins, appOrigin].filter(Boolean));
const aiContentFeaturesEnabled = isAiContentFeaturesEnabled();
const ieltsListeningEnabled = isIeltsListeningEnabled();

function resolveClientIp(req: AuthenticatedRequest) {
  const forwardedFor = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
}

function sendInternalError(res: Response) {
  return res.status(500).json({
    error: INTERNAL_ERROR_MESSAGE,
    request_id: res.locals.requestId,
  });
}

function sendRateLimitExceeded(res: Response, retryAfterSeconds: number) {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    error: 'Rate limit exceeded',
    request_id: res.locals.requestId,
    retry_after_seconds: retryAfterSeconds,
  });
}

function requireAiContentFeatures(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!aiContentFeaturesEnabled) {
    res.status(503).json({ error: 'AI 内容功能暂时关闭。' });
    return;
  }

  next();
}

function requireExpensiveQuota(
  group: ExpensiveApiGroup,
  resolveWeight: (req: AuthenticatedRequest) => number = () => 1,
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.authUserId;
    if (!userId) {
      return sendInternalError(res);
    }

    const result = consumeExpensiveRateLimit({
      group,
      userId,
      ip: resolveClientIp(req),
      weight: resolveWeight(req),
    });

    if (!isRateLimitExceeded(result)) {
      next();
      return;
    }

    logger.warn(
      'Expensive API rate limit exceeded',
      requestLogContext(res, {
        endpoint: req.path,
        user_id: userId,
        group,
        scope: result.scope,
        window: result.window,
        limit: result.limit,
        weight: result.weight,
      }),
    );
    return sendRateLimitExceeded(res, result.retryAfterSeconds);
  };
}

const aiVocabQuota = requireExpensiveQuota('ai_vocab', (req) => countStringArray(req.body?.words));
const aiVocabSingleQuota = requireExpensiveQuota('ai_vocab');
const aiArticleQuota = requireExpensiveQuota('ai_article');
const ttsSingleQuota = requireExpensiveQuota('tts');
const ttsBatchQuota = requireExpensiveQuota('tts', (req) => Math.min(countStringArray(req.body?.words), 30) * 2);

app.use((req, res, next) => {
  const origin = req.header('Origin');

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
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

app.use(
  '/storage/v1/object/public',
  express.static(localStoragePublicRoot, {
    immutable: true,
    maxAge: '1h',
  }),
);

app.use(express.json());

function sendLocalAuthDisabled(res: Response) {
  return res.status(503).json({ error: 'Local auth is not enabled.' });
}

app.get('/api/auth/session', async (req, res) => {
  if (!isLocalAuthEnabled()) {
    return sendLocalAuthDisabled(res);
  }

  const accessToken = readBearerToken(req.header('Authorization'));
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const { session } = await verifyLocalAccessToken(accessToken);
    return res.json({ session });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

app.post('/api/auth/sign-in', async (req, res) => {
  if (!isLocalAuthEnabled()) {
    return sendLocalAuthDisabled(res);
  }

  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  try {
    const session = await authenticateLocalUser(email, password);
    return res.json({ session });
  } catch {
    return res.status(401).json({ error: '邮箱或密码不正确。' });
  }
});

app.post('/api/auth/sign-up', async (req, res) => {
  if (!isLocalAuthEnabled()) {
    return sendLocalAuthDisabled(res);
  }

  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName : '';
  try {
    const session = await createLocalUser({ email, password, fullName });
    return res.status(201).json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign up failed.';
    return res.status(400).json({ error: message });
  }
});

app.post('/api/auth/update-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!isLocalAuthEnabled()) {
    return sendLocalAuthDisabled(res);
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  try {
    await updateLocalPassword(req.authUserId!, password);
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Password update failed.';
    return res.status(400).json({ error: message });
  }
});

app.post('/api/auth/reset-password', async (_req, res) => {
  if (!isLocalAuthEnabled()) {
    return sendLocalAuthDisabled(res);
  }

  return res.json({
    ok: true,
    message: 'Password reset email is not configured yet. Please sign up again or contact support.',
  });
});

app.post('/api/auth/resend-confirmation', async (_req, res) => {
  if (!isLocalAuthEnabled()) {
    return sendLocalAuthDisabled(res);
  }

  return res.json({ ok: true });
});

app.post('/api/auth/sign-out', async (_req, res) => {
  return res.json({ ok: true });
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

function resolveVocabularySourceType(value: unknown): VocabularySourceType {
  return value === 'system' ? 'system' : 'custom';
}

// POST /api/vocab/enrich
app.post('/api/vocab/enrich', requireAuth, requireAiContentFeatures, aiVocabQuota, async (req, res) => {
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
    logger.error('API Error: /api/vocab/enrich', e, requestLogContext(res, { endpoint: '/api/vocab/enrich', source }));

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    return sendInternalError(res);
  }
});

// POST /api/vocab/lite-enrich
app.post('/api/vocab/lite-enrich', requireAuth, requireAiContentFeatures, aiVocabSingleQuota, async (req, res) => {
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
    logger.error(
      'API Error: /api/vocab/lite-enrich',
      e,
      requestLogContext(res, { endpoint: '/api/vocab/lite-enrich', word, source }),
    );

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    return sendInternalError(res);
  }
});

// POST /api/vocab/lemmatize
app.post('/api/vocab/lemmatize', requireAuth, requireAiContentFeatures, aiVocabSingleQuota, async (req, res) => {
  const word = sanitizeLookupWord(req.body?.word);
  const source = resolveGeminiSource(req.body?.source, 'import_lemmatize');
  if (!word) {
    return res.status(400).json({ error: 'Missing word' });
  }

  try {
    const data = await lemmatizeVocabularyWord(word, source);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(
      'API Error: /api/vocab/lemmatize',
      e,
      requestLogContext(res, { endpoint: '/api/vocab/lemmatize', word, source }),
    );

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    return sendInternalError(res);
  }
});

// POST /api/vocab/lemmatize-batch
app.post('/api/vocab/lemmatize-batch', requireAuth, requireAiContentFeatures, aiVocabQuota, async (req, res) => {
  const words = Array.isArray(req.body?.words) ? req.body.words.map(sanitizeLookupWord).filter(Boolean) : [];
  const source = resolveGeminiSource(req.body?.source, 'import_lemmatize');
  if (words.length === 0) {
    return res.status(400).json({ error: 'Missing words array' });
  }

  try {
    const data = await lemmatizeVocabularyWords(words, source);
    res.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(
      'API Error: /api/vocab/lemmatize-batch',
      e,
      requestLogContext(res, {
        endpoint: '/api/vocab/lemmatize-batch',
        word_count: words.length,
        source,
      }),
    );

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    return sendInternalError(res);
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
    res.json(data ? { data } : { data: null, missing: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(
      'API Error: /api/vocab/lookup',
      e,
      requestLogContext(res, { endpoint: '/api/vocab/lookup', user_id: userId, word }),
    );

    if (e instanceof EnrichmentResponseValidationError) {
      return res.status(e.statusCode).json({ error: message });
    }
    if (e instanceof EnrichmentServiceUnavailableError) {
      return res.status(e.statusCode).json({ error: message });
    }
    return sendInternalError(res);
  }
});

// POST /api/vocab/report
app.post('/api/vocab/report', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { vocabularyItemId, wordSnapshot, learningGroupId, sessionRound, issueType, note, routePath, userAgent } =
    req.body ?? {};

  if (typeof vocabularyItemId !== 'string' || vocabularyItemId.trim().length === 0) {
    return res.status(400).json({ error: 'Missing vocabulary item ID' });
  }

  try {
    const data = await reportVocabularyIssue(userId, {
      vocabularyItemId,
      wordSnapshot: typeof wordSnapshot === 'string' ? wordSnapshot : null,
      learningGroupId: typeof learningGroupId === 'string' ? learningGroupId : null,
      sessionRound: typeof sessionRound === 'string' ? sessionRound : null,
      issueType,
      note: typeof note === 'string' ? note : null,
      routePath: typeof routePath === 'string' ? routePath : null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
    res.json({ data });
  } catch (e) {
    logger.error(
      'API Error: /api/vocab/report',
      e,
      requestLogContext(res, {
        endpoint: '/api/vocab/report',
        user_id: userId,
        vocabulary_item_id: vocabularyItemId,
        issue_type: issueType,
      }),
    );
    return sendInternalError(res);
  }
});

// POST /api/vocab/full-enrich
app.post(
  '/api/vocab/full-enrich',
  requireAuth,
  requireAiContentFeatures,
  aiVocabSingleQuota,
  async (req: AuthenticatedRequest, res) => {
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
      logger.error(
        'API Error: /api/vocab/full-enrich',
        e,
        requestLogContext(res, { endpoint: '/api/vocab/full-enrich', user_id: userId, word }),
      );
      return sendInternalError(res);
    }
  },
);

// POST /api/vocab/persist
app.post('/api/vocab/persist', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { entries } = req.body ?? {};
  const sourceType = resolveVocabularySourceType(req.body?.sourceType);

  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'Missing entries array' });
  }

  const userId = req.authUserId!;
  try {
    const data = await persistFullVocabularyEntries(entries, sourceType);
    res.json({ data });
  } catch (e) {
    logger.error(
      'API Error: /api/vocab/persist',
      e,
      requestLogContext(res, {
        endpoint: '/api/vocab/persist',
        user_id: userId,
        source_type: sourceType,
        entry_count: entries.length,
      }),
    );
    return sendInternalError(res);
  }
});

// POST /api/vocab/article
app.post('/api/vocab/article', requireAuth, requireAiContentFeatures, aiArticleQuota, async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'Missing words array' });
  }

  const cleaned = words.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean);

  try {
    const article = await generateArticle(cleaned);
    res.json({ data: article });
  } catch (e) {
    logger.error(
      'API Error: /api/vocab/article',
      e,
      requestLogContext(res, {
        endpoint: '/api/vocab/article',
        word_count: cleaned.length,
      }),
    );
    return sendInternalError(res);
  }
});

// POST /api/review/attempt
app.post('/api/review/attempt', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { vocabularyItemId, learningGroupId, source, wasCorrect, elapsedMs } = req.body;

  if (
    !vocabularyItemId ||
    (source !== 'round2' && source !== 'round3' && source !== 'review') ||
    typeof wasCorrect !== 'boolean'
  ) {
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
    logger.error(
      'API Error: /api/review/attempt',
      e,
      requestLogContext(res, { endpoint: '/api/review/attempt', user_id: userId }),
    );
    return sendInternalError(res);
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
    logger.error(
      'API Error: /api/review/batch-attempt',
      e,
      requestLogContext(res, { endpoint: '/api/review/batch-attempt', user_id: userId }),
    );
    return sendInternalError(res);
  }
});

// POST /api/review/unknown
app.post('/api/review/unknown', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { vocabularyItemId, learningGroupId, timestamp } = req.body;
  if (!vocabularyItemId) {
    return res.status(400).json({ error: 'Missing vocabularyItemId' });
  }

  const userId = req.authUserId!;
  try {
    const result = await markVocabularyUnknown({
      userId,
      vocabularyItemId,
      learningGroupId,
      timestamp: Number(timestamp) || undefined,
    });
    res.json({ data: result });
  } catch (e) {
    logger.error(
      'API Error: /api/review/unknown',
      e,
      requestLogContext(res, { endpoint: '/api/review/unknown', user_id: userId }),
    );
    return sendInternalError(res);
  }
});

// POST /api/review/mastered
app.post('/api/review/mastered', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { vocabularyItemId, learningGroupId } = req.body;
  if (!vocabularyItemId) {
    return res.status(400).json({ error: 'Missing vocabularyItemId' });
  }

  const userId = req.authUserId!;
  try {
    const result = await markVocabularyMastered({
      userId,
      vocabularyItemId,
      learningGroupId,
    });
    res.json({ data: result });
  } catch (e) {
    logger.error(
      'API Error: /api/review/mastered',
      e,
      requestLogContext(res, {
        endpoint: '/api/review/mastered',
        user_id: userId,
        vocabulary_item_id: vocabularyItemId,
        learning_group_id: learningGroupId,
      }),
    );
    return sendInternalError(res);
  }
});

// POST /api/ielts/reading/attempts
app.post('/api/ielts/reading/attempts', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const responseCount = Array.isArray(req.body?.responses) ? req.body.responses.length : 0;

  try {
    const data = await submitIeltsReadingAttempt(userId, req.body);
    res.json({ data });
  } catch (e) {
    logger.error(
      'API Error: /api/ielts/reading/attempts',
      e,
      requestLogContext(res, {
        endpoint: '/api/ielts/reading/attempts',
        user_id: userId,
        test_id: req.body?.testId,
        response_count: responseCount,
      }),
    );
    return sendInternalError(res);
  }
});

// POST /api/ielts/listening/attempts
app.post('/api/ielts/listening/attempts', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!ieltsListeningEnabled) return res.status(404).json({ error: 'IELTS listening is disabled.' });
  const userId = req.authUserId!;
  const responseCount = Array.isArray(req.body?.responses) ? req.body.responses.length : 0;

  try {
    const data = await submitIeltsListeningAttempt(userId, req.body);
    res.json({ data });
  } catch (e) {
    logger.error(
      'API Error: /api/ielts/listening/attempts',
      e,
      requestLogContext(res, {
        endpoint: '/api/ielts/listening/attempts',
        user_id: userId,
        test_id: req.body?.testId,
        response_count: responseCount,
      }),
    );
    return sendInternalError(res);
  }
});

app.get('/api/ielts/dashboard', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  try {
    const data = await getIeltsDashboard(userId);
    res.json({
      data: ieltsListeningEnabled ? data : { ...data, listeningBooks: [], listeningAttempts: [] },
    });
  } catch (e) {
    logger.error('API Error: /api/ielts/dashboard', e, {
      endpoint: '/api/ielts/dashboard',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

app.get('/api/ielts/reading/tests/:testId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { testId } = req.params;
  try {
    const data = await getIeltsReadingTest(testId);
    if (!data) return res.status(404).json({ error: 'IELTS reading test not found' });
    res.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/ielts/reading/tests/${testId}`, e, {
      endpoint: `/api/ielts/reading/tests/${testId}`,
      user_id: req.authUserId,
    });
    return sendInternalError(res);
  }
});

app.get('/api/ielts/listening/tests/:testId', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!ieltsListeningEnabled) return res.status(404).json({ error: 'IELTS listening is disabled.' });
  const { testId } = req.params;
  try {
    const data = await getIeltsListeningTest(testId);
    if (!data) return res.status(404).json({ error: 'IELTS listening test not found' });
    res.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/ielts/listening/tests/${testId}`, e, {
      endpoint: `/api/ielts/listening/tests/${testId}`,
      user_id: req.authUserId,
    });
    return sendInternalError(res);
  }
});

// GET /api/review/due
app.get('/api/review/due', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const timeZone = typeof req.query.timezone === 'string' ? req.query.timezone : null;

  try {
    const words = await fetchDueReviewWords(userId, { timeZone });
    res.json({ data: words });
  } catch (e) {
    logger.error('API Error: /api/review/due', e, { endpoint: '/api/review/due', user_id: userId, timezone: timeZone });
    return sendInternalError(res);
  }
});

// POST /api/review/session/start
app.post('/api/review/session/start', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { timeZone } = req.body ?? {};

  try {
    const words = await startReviewSession(userId, {
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    res.json({ data: { words } });
  } catch (e) {
    logger.error('API Error: /api/review/session/start', e, {
      endpoint: '/api/review/session/start',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// POST /api/review/session/complete
app.post('/api/review/session/complete', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { timeZone } = req.body ?? {};

  try {
    const data = await completeReviewSession(userId, {
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    res.json({ data });
  } catch (e) {
    logger.error('API Error: /api/review/session/complete', e, {
      endpoint: '/api/review/session/complete',
      user_id: userId,
    });
    return sendInternalError(res);
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
    logger.error('API Error: /api/home/overview', e, {
      endpoint: '/api/home/overview',
      user_id: userId,
      timezone: timeZone,
    });
    return sendInternalError(res);
  }
});

// GET /api/user/activity-heatmap
app.get('/api/user/activity-heatmap', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const timeZone = typeof req.query.timezone === 'string' ? req.query.timezone : null;

  try {
    const activityDays = await getUserActivityHeatmap(userId, timeZone);
    res.json({ data: activityDays });
  } catch (e) {
    logger.error('API Error: /api/user/activity-heatmap', e, {
      endpoint: '/api/user/activity-heatmap',
      user_id: userId,
      timezone: timeZone,
    });
    return sendInternalError(res);
  }
});

// GET /api/settings/learning-preferences
app.get('/api/settings/learning-preferences', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;

  try {
    const preferences = await getUserLearningPreferences(userId);
    res.json({ data: preferences });
  } catch (e) {
    logger.error('API Error: /api/settings/learning-preferences', e, {
      endpoint: '/api/settings/learning-preferences',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// POST /api/settings/learning-preferences
app.post('/api/settings/learning-preferences', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const patch = resolveLearningPreferencesPatch(req.body);

  try {
    const preferences = await saveUserLearningPreferences(userId, patch);
    res.json({ data: preferences });
  } catch (e) {
    logger.error('API Error: /api/settings/learning-preferences', e, {
      endpoint: '/api/settings/learning-preferences',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// GET /api/library/overview
app.get('/api/library/overview', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;

  try {
    const overview = await getLibraryOverview(userId);
    res.json({ data: overview });
  } catch (e) {
    logger.error('API Error: /api/library/overview', e, {
      endpoint: '/api/library/overview',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// GET /api/library/groups/:groupId
app.get('/api/library/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ error: 'Missing group ID' });

  const userId = req.authUserId!;
  try {
    const detail = await getLibraryGroupDetail(userId, groupId);
    res.json({ data: detail });
  } catch (e) {
    logger.error(`API Error: /api/library/groups/${groupId}`, e, {
      endpoint: `/api/library/groups/${groupId}`,
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// GET /api/learning/groups/:groupId
app.get('/api/learning/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { groupId } = req.params;
  if (!groupId) return res.status(400).json({ error: 'Missing group ID' });

  const userId = req.authUserId!;
  try {
    const data = await getLearningSession(userId, groupId);
    if (!data) return res.status(404).json({ error: 'Learning group not found' });
    res.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/learning/groups/${groupId}`, e, {
      endpoint: `/api/learning/groups/${groupId}`,
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// POST /api/learning/official/:libraryId/start
app.post('/api/learning/official/:libraryId/start', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { libraryId } = req.params;
  const { mode, timeZone } = req.body ?? {};
  if (!validateOfficialLibraryId(libraryId)) return res.status(400).json({ error: 'Unknown official library' });
  if (!validateOfficialStudyMode(mode)) return res.status(400).json({ error: 'Unknown study mode' });

  const userId = req.authUserId!;
  try {
    const data = await startOfficialLearningSession(userId, {
      libraryId,
      mode,
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    res.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/learning/official/${libraryId}/start`, e, {
      endpoint: `/api/learning/official/${libraryId}/start`,
      user_id: userId,
      mode,
    });
    return sendInternalError(res);
  }
});

// POST /api/learning/groups/:groupId/session
app.post('/api/learning/groups/:groupId/session', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { groupId } = req.params;
  const { round, currentIndex, queueWordIds, passedQueueIndices, round1ConfirmedWordIds, timeZone } = req.body ?? {};
  if (!groupId) return res.status(400).json({ error: 'Missing group ID' });
  if (!validateLearningRoundInput(round) || !Array.isArray(queueWordIds)) {
    return res.status(400).json({ error: 'Invalid learning session' });
  }

  const userId = req.authUserId!;
  try {
    const data = await saveLearningSession(userId, groupId, {
      round,
      currentIndex: Number(currentIndex) || 0,
      queueWordIds,
      passedQueueIndices: Array.isArray(passedQueueIndices) ? passedQueueIndices : [],
      round1ConfirmedWordIds: Array.isArray(round1ConfirmedWordIds) ? round1ConfirmedWordIds : [],
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    res.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/learning/groups/${groupId}/session`, e, {
      endpoint: `/api/learning/groups/${groupId}/session`,
      user_id: userId,
      round,
    });
    return sendInternalError(res);
  }
});

// POST /api/learning/groups/:groupId/complete-round
app.post('/api/learning/groups/:groupId/complete-round', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { groupId } = req.params;
  const { round, confirmedWordIds, timeZone } = req.body ?? {};
  if (!groupId) return res.status(400).json({ error: 'Missing group ID' });
  if (!validateLearningRoundInput(round)) return res.status(400).json({ error: 'Invalid learning round' });

  const userId = req.authUserId!;
  try {
    const data = await completeLearningRound(userId, groupId, {
      round,
      confirmedWordIds: Array.isArray(confirmedWordIds) ? confirmedWordIds : [],
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    res.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/learning/groups/${groupId}/complete-round`, e, {
      endpoint: `/api/learning/groups/${groupId}/complete-round`,
      user_id: userId,
      round,
    });
    return sendInternalError(res);
  }
});

// DELETE /api/library/official/:libraryId
app.delete('/api/library/official/:libraryId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { libraryId } = req.params;
  const timeZone =
    typeof req.query.timezone === 'string'
      ? req.query.timezone
      : typeof req.body?.timeZone === 'string'
        ? req.body.timeZone
        : null;

  if (!isOfficialLibraryId(libraryId)) {
    return res.status(400).json({ error: 'Unknown official library' });
  }

  const userId = req.authUserId!;
  try {
    const result = await deleteOfficialLearningLibrary(userId, { libraryId, timeZone });
    res.json({ data: result });
  } catch (e) {
    logger.error(`API Error: /api/library/official/${libraryId}`, e, {
      endpoint: `/api/library/official/${libraryId}`,
      user_id: userId,
      timezone: timeZone,
    });
    return sendInternalError(res);
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
    logger.error(`API Error: /api/library/official/${libraryId}/discard-active`, e, {
      endpoint: `/api/library/official/${libraryId}/discard-active`,
      user_id: userId,
      group_id: groupId,
    });
    return sendInternalError(res);
  }
});

// POST /api/library/official/:libraryId/reorder-active
app.post('/api/library/official/:libraryId/reorder-active', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { libraryId } = req.params;
  const { groupId, mode } = req.body ?? {};

  if (!isOfficialLibraryId(libraryId)) {
    return res.status(400).json({ error: 'Unknown official library' });
  }

  if (typeof groupId !== 'string' || groupId.trim().length === 0) {
    return res.status(400).json({ error: 'Missing group ID' });
  }

  if (mode !== 'sequential' && mode !== 'shuffle') {
    return res.status(400).json({ error: 'Unknown study mode' });
  }

  const userId = req.authUserId!;
  try {
    const result = await reorderActiveOfficialLearningGroup(userId, {
      libraryId,
      groupId,
      mode,
    });
    res.json({ data: result });
  } catch (e) {
    logger.error(`API Error: /api/library/official/${libraryId}/reorder-active`, e, {
      endpoint: `/api/library/official/${libraryId}/reorder-active`,
      user_id: userId,
      group_id: groupId,
      mode,
    });
    return sendInternalError(res);
  }
});

// POST /api/library/saved-words
app.get('/api/library/saved-words', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  try {
    const data = await getSavedWords(userId);
    res.json({ data });
  } catch (e) {
    logger.error('API Error: GET /api/library/saved-words', e, {
      endpoint: '/api/library/saved-words',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

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
    logger.error('API Error: /api/library/saved-words', e, {
      endpoint: '/api/library/saved-words',
      user_id: userId,
      vocabulary_item_id: vocabularyItemId,
      source,
    });
    return sendInternalError(res);
  }
});

app.post('/api/library/saved-words/learning-group', requireAuth, async (req: AuthenticatedRequest, res) => {
  const vocabularyItemIds = req.body?.vocabularyItemIds;
  if (!Array.isArray(vocabularyItemIds) || vocabularyItemIds.some((id) => typeof id !== 'string')) {
    return res.status(400).json({ error: 'Invalid vocabulary item IDs' });
  }

  const userId = req.authUserId!;
  try {
    const data = await createLearningGroupFromSavedWords(userId, vocabularyItemIds);
    res.json({ data });
  } catch (e) {
    logger.error('API Error: /api/library/saved-words/learning-group', e, {
      endpoint: '/api/library/saved-words/learning-group',
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// POST /api/library/saved-words/cleanup
app.post('/api/library/saved-words/cleanup', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  try {
    const result = await cleanupSavedLibrary({ apply: true, userId, sampleLimit: 0 });
    res.json({
      data: {
        removedSavedWords: result.removedSavedWords,
        createdReviewStates: result.createdReviewStates,
        deletedCustomGroups: result.deletedCustomGroups,
      },
    });
  } catch (e) {
    logger.error('API Error: /api/library/saved-words/cleanup', e, {
      endpoint: '/api/library/saved-words/cleanup',
      user_id: userId,
    });
    return sendInternalError(res);
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
    logger.error(`API Error: /api/library/saved-words/${vocabularyItemId}`, e, {
      endpoint: `/api/library/saved-words/${vocabularyItemId}`,
      user_id: userId,
      vocabulary_item_id: vocabularyItemId,
    });
    return sendInternalError(res);
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
    logger.error(`API Error: /api/library/groups/${groupId}`, e, {
      endpoint: `/api/library/groups/${groupId}`,
      user_id: userId,
    });
    return sendInternalError(res);
  }
});

// GET /api/audio/:word
app.get('/api/audio/:word', requireAuth, ttsSingleQuota, async (req, res) => {
  const { word } = req.params;
  const locale = (req.query.locale as 'uk' | 'us') || 'uk';

  if (!word) return res.status(400).json({ error: 'Missing word' });

  try {
    const url = await getOrCreateAudio(word, locale);
    res.json({ data: url });
  } catch (e) {
    logger.error(`API Error: /api/audio/${word}`, e, { endpoint: `/api/audio/${word}`, locale });
    return sendInternalError(res);
  }
});

// POST /api/audio/batch
app.post('/api/audio/batch', requireAuth, ttsBatchQuota, async (req, res) => {
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
    logger.error('API Error: /api/audio/batch', e, { endpoint: '/api/audio/batch' });
    return sendInternalError(res);
  }
});

// POST /api/example-audio
app.post('/api/example-audio', requireAuth, ttsSingleQuota, async (req, res) => {
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
    return sendInternalError(res);
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function resolveExpressErrorStatus(error: unknown) {
  const status =
    (error as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (error as { status?: unknown; statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
}

const expressErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = resolveExpressErrorStatus(error);
  logger.error(
    'Unhandled Express Error',
    error,
    requestLogContext(res, {
      endpoint: req.originalUrl,
      method: req.method,
      status,
    }),
  );

  if (status >= 500) {
    sendInternalError(res);
    return;
  }

  res.status(status).json({
    error: status === 400 ? 'Bad request' : 'Request failed',
    request_id: res.locals.requestId,
  });
};

app.use(expressErrorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
