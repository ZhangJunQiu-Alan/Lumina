import { logger } from '../../../shared/server/logger.ts';
import {
  enrichWords,
  EnrichmentResponseValidationError,
  EnrichmentServiceUnavailableError,
  generateArticle,
} from '../../../shared/server/gemini.ts';
import {
  completeReviewSession,
  fetchDueReviewWords,
  markVocabularyMastered,
  markVocabularyUnknown,
  recordBatchReviewAttempts,
  recordReviewAttempt,
  startReviewSession,
} from '../../../shared/server/review.ts';
import { batchGenerateAudio, getOrCreateAudio } from '../../../shared/server/audio.ts';
import { ExampleAudioValidationError, getOrCreateExampleAudio } from '../../../shared/server/exampleAudio.ts';
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
} from '../../../shared/server/library.ts';
import { cleanupSavedLibrary } from '../../../shared/server/savedLibraryCleanup.ts';
import { getHomeOverview } from '../../../shared/server/home.ts';
import {
  getUserLearningPreferences,
  resolveLearningPreferencesPatch,
  saveUserLearningPreferences,
} from '../../../shared/server/settings.ts';
import {
  completeLearningRound,
  getLearningSession,
  saveLearningSession,
  startOfficialLearningSession,
  validateLearningRoundInput,
  validateOfficialLibraryId,
  validateOfficialStudyMode,
} from '../../../shared/server/learning.ts';
import { submitIeltsListeningAttempt, submitIeltsReadingAttempt } from '../../../shared/server/ieltsAttempts.ts';
import {
  getIeltsDashboard,
  getIeltsListeningTest,
  getIeltsReadingTest,
} from '../../../shared/server/ieltsDashboard.ts';
import { supabaseAdmin } from '../../../shared/server/supabase.ts';
import {
  ensureLiteVocabularyEntry,
  lemmatizeVocabularyWord,
  lemmatizeVocabularyWords,
  lookupWordForPopover,
  persistFullVocabularyEntries,
  queueFullEnrichmentForWord,
  reportVocabularyIssue,
  sanitizeLookupWord,
} from '../../../shared/server/vocab.ts';
import { isOfficialLibraryId } from '../../../shared/officialLibraryLite.ts';
import { isAiContentFeaturesEnabled, isIeltsListeningEnabled } from '../../../shared/runtime.ts';
import {
  consumeExpensiveRateLimit,
  countStringArray,
  type ExpensiveApiGroup,
  INTERNAL_ERROR_MESSAGE,
  isRateLimitExceeded,
} from '../../../shared/expensiveRateLimit.ts';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://lumina-1oi.pages.dev',
  'https://primoria-english.pages.dev',
  'https://lumina.college',
];

const configuredOrigins = (Deno.env.get('LUMINA_APP_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
const aiContentFeaturesEnabled = isAiContentFeaturesEnabled();
const ieltsListeningEnabled = isIeltsListeningEnabled();
const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '') ?? '';
const supabasePublicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const requestIdHeader = 'X-Request-Id';
const requestIds = new WeakMap<Request, string>();

type ApiGateResult =
  | { userId: string; response?: undefined; status?: undefined }
  | { response: Response; status: number; userId?: undefined };
type QuotaGateResult = { response?: undefined; status?: undefined } | { response: Response; status: number };

function resolveRequestId(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || crypto.randomUUID();
}

function getRequestId(request: Request) {
  const existing = requestIds.get(request);
  if (existing) return existing;

  const requestId = resolveRequestId(request.headers.get(requestIdHeader));
  requestIds.set(request, requestId);
  return requestId;
}

function requestLogContext(request: Request, context: Record<string, unknown> = {}) {
  return {
    request_id: getRequestId(request),
    ...context,
  };
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  headers.set(requestIdHeader, getRequestId(request));

  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(request: Request, status = 204) {
  return new Response(null, { status, headers: corsHeaders(request) });
}

function errorResponse(request: Request, error: string, status = 500) {
  if (status === 500) {
    return jsonResponse(request, { error: INTERNAL_ERROR_MESSAGE, request_id: getRequestId(request) }, status);
  }

  return jsonResponse(request, { error }, status);
}

function validateOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  return !origin || allowedOrigins.has(origin);
}

function normalizePath(url: URL) {
  const marker = '/functions/v1/api';
  const normalizeApiGatewayPath = (path: string) => (path.startsWith('/api/api/') ? path.slice('/api'.length) : path);

  if (url.pathname === marker) return '/';
  if (url.pathname.startsWith(`${marker}/`)) {
    return normalizeApiGatewayPath(url.pathname.slice(marker.length) || '/');
  }
  return normalizeApiGatewayPath(url.pathname);
}

async function readJsonBody(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function readBearerToken(headerValue: string | null) {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function resolveClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    request.headers.get('cf-connecting-ip')?.trim() ||
    forwardedFor ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

function rateLimitExceededResponse(request: Request, retryAfterSeconds: number) {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json');
  headers.set('Retry-After', String(retryAfterSeconds));
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      request_id: getRequestId(request),
      retry_after_seconds: retryAfterSeconds,
    }),
    { status: 429, headers },
  );
}

function enforceExpensiveQuota(
  request: Request,
  userId: string,
  group: ExpensiveApiGroup,
  weight: number,
): QuotaGateResult {
  const result = consumeExpensiveRateLimit({
    group,
    userId,
    ip: resolveClientIp(request),
    weight,
  });

  if (!isRateLimitExceeded(result)) return {};

  logger.warn(
    'Expensive API rate limit exceeded',
    requestLogContext(request, {
      user_id: userId,
      group,
      scope: result.scope,
      window: result.window,
      limit: result.limit,
      weight: result.weight,
    }),
  );
  return {
    response: rateLimitExceededResponse(request, result.retryAfterSeconds),
    status: 429,
  };
}

async function requireExpensiveUser(
  request: Request,
  group: ExpensiveApiGroup,
  weight: number,
): Promise<ApiGateResult> {
  const auth = await requireUser(request);
  if (auth.response) return auth;

  if (!aiContentFeaturesEnabled && (group === 'ai_vocab' || group === 'ai_article')) {
    return { response: errorResponse(request, 'AI 内容功能暂时关闭。', 503), status: 503 };
  }

  const quota = enforceExpensiveQuota(request, auth.userId, group, weight);
  if (quota.response) return quota;

  return { userId: auth.userId };
}

async function requireUser(request: Request): Promise<ApiGateResult> {
  const accessToken = readBearerToken(request.headers.get('Authorization'));
  if (!accessToken) {
    return { response: errorResponse(request, 'Missing bearer token', 401), status: 401 };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return { response: errorResponse(request, 'Invalid or expired token', 401), status: 401 };
  }

  return { userId: data.user.id };
}

function resolveSavedWordSource(value: unknown) {
  if (value === undefined || value === null) return 'reading_popup';
  if (value === 'reading_popup' || value === 'manual') return value;
  return null;
}

function resolveGeminiSource(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function resolveVocabularySourceType(value: unknown) {
  return value === 'system' ? 'system' : 'custom';
}

function statusFromEnrichmentError(error: unknown) {
  if (error instanceof EnrichmentResponseValidationError) return error.statusCode;
  if (error instanceof EnrichmentServiceUnavailableError) return error.statusCode;
  return 500;
}

async function supabaseAuthRequest(path: string, init: RequestInit) {
  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error('Supabase Auth is not configured.');
  }

  return fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: supabasePublicKey,
      Authorization: `Bearer ${supabasePublicKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function readSupabaseAuthResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const message =
    (typeof payload.error_description === 'string' && payload.error_description) ||
    (typeof payload.msg === 'string' && payload.msg) ||
    (typeof payload.message === 'string' && payload.message) ||
    'Authentication failed.';
  return { payload, message };
}

function sessionFromAccessToken(accessToken: string, user: Record<string, unknown>) {
  const payloadSegment = accessToken.split('.')[1] ?? '';
  const normalizedPayload = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
  const payload = JSON.parse(atob(paddedPayload)) as { exp?: number };
  const expiresAt = payload.exp ?? Math.floor(Date.now() / 1000) + 3600;

  return {
    access_token: accessToken,
    refresh_token: '',
    expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
    expires_at: expiresAt,
    token_type: 'bearer',
    user,
  };
}

Deno.serve(async (request) => {
  const start = Date.now();
  const requestId = getRequestId(request);
  const url = new URL(request.url);
  const path = normalizePath(url);
  const method = request.method.toUpperCase();
  let status = 404;

  try {
    if (method === 'OPTIONS') {
      if (!validateOrigin(request)) return errorResponse(request, 'Origin not allowed', 403);
      status = 204;
      return emptyResponse(request, status);
    }

    if (!validateOrigin(request)) {
      status = 403;
      return errorResponse(request, 'Origin not allowed', status);
    }

    if (method === 'GET' && path === '/api/health') {
      status = 200;
      return jsonResponse(request, { status: 'ok', timestamp: new Date().toISOString() }, status);
    }

    const body = await readJsonBody(request);

    if (method === 'POST' && path === '/api/auth/sign-in') {
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!email || !password) {
        status = 400;
        return errorResponse(request, '请输入邮箱和密码。', status);
      }

      const authResponse = await supabaseAuthRequest('/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const { payload } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok || typeof payload.access_token !== 'string' || typeof payload.user !== 'object') {
        status = 401;
        return errorResponse(request, '邮箱或密码不正确。', status);
      }

      status = 200;
      return jsonResponse(request, { session: payload }, status);
    }

    if (method === 'POST' && path === '/api/auth/sign-up') {
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
      if (!email || password.length < 8) {
        status = 400;
        return errorResponse(request, '请填写有效邮箱和至少 8 位密码。', status);
      }

      const authResponse = await supabaseAuthRequest('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, data: { full_name: fullName } }),
      });
      const { payload, message } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok) {
        status = 400;
        return errorResponse(request, message, status);
      }

      status = 200;
      return jsonResponse(
        request,
        {
          session: typeof payload.access_token === 'string' ? payload : null,
          user: payload.user ?? null,
        },
        status,
      );
    }

    if (method === 'GET' && path === '/api/auth/session') {
      const accessToken = readBearerToken(request.headers.get('Authorization'));
      if (!accessToken) {
        status = 401;
        return errorResponse(request, 'Missing bearer token', status);
      }

      const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
      if (error || !data.user) {
        status = 401;
        return errorResponse(request, 'Invalid or expired token', status);
      }

      status = 200;
      return jsonResponse(
        request,
        { session: sessionFromAccessToken(accessToken, data.user as unknown as Record<string, unknown>) },
        status,
      );
    }

    if (method === 'POST' && path === '/api/auth/update-password') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const password = typeof body?.password === 'string' ? body.password : '';
      if (password.length < 8) {
        status = 400;
        return errorResponse(request, '密码至少需要 8 位。', status);
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(auth.userId, { password });
      if (error) {
        status = 400;
        return errorResponse(request, error.message, status);
      }

      status = 200;
      return jsonResponse(request, { ok: true }, status);
    }

    if (method === 'POST' && path === '/api/auth/reset-password') {
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      if (!email) {
        status = 400;
        return errorResponse(request, '请输入邮箱。', status);
      }

      const authResponse = await supabaseAuthRequest('/recover', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const { message } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok) {
        status = 400;
        return errorResponse(request, message, status);
      }

      status = 200;
      return jsonResponse(request, { ok: true }, status);
    }

    if (method === 'POST' && path === '/api/auth/resend-confirmation') {
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      if (!email) {
        status = 400;
        return errorResponse(request, '请输入邮箱。', status);
      }

      const authResponse = await supabaseAuthRequest('/resend', {
        method: 'POST',
        body: JSON.stringify({ type: 'signup', email }),
      });
      const { message } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok) {
        status = 400;
        return errorResponse(request, message, status);
      }

      status = 200;
      return jsonResponse(request, { ok: true }, status);
    }

    if (method === 'POST' && path === '/api/auth/sign-out') {
      status = 200;
      return jsonResponse(request, { ok: true }, status);
    }

    if (method === 'POST' && path === '/api/vocab/enrich') {
      const auth = await requireExpensiveUser(request, 'ai_vocab', countStringArray(body?.words));
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const source = resolveGeminiSource(body?.source, 'manual_api');
      if (!Array.isArray(body?.words) || body.words.length === 0) {
        status = 400;
        return errorResponse(request, 'Missing words array', status);
      }
      try {
        const data = await enrichWords(body.words, { source, enrichmentType: 'batch' });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = statusFromEnrichmentError(error);
        logger.error(
          'API Error: /api/vocab/enrich',
          error,
          requestLogContext(request, { endpoint: '/api/vocab/enrich', source }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/lite-enrich') {
      const auth = await requireExpensiveUser(request, 'ai_vocab', 1);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const word = sanitizeLookupWord(body?.word);
      const source = resolveGeminiSource(body?.source, 'manual_api');
      if (!word) {
        status = 400;
        return errorResponse(request, 'Missing word', status);
      }
      try {
        const data = await ensureLiteVocabularyEntry(word, source);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = statusFromEnrichmentError(error);
        logger.error(
          'API Error: /api/vocab/lite-enrich',
          error,
          requestLogContext(request, { endpoint: '/api/vocab/lite-enrich', word, source }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/lemmatize') {
      const auth = await requireExpensiveUser(request, 'ai_vocab', 1);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const word = sanitizeLookupWord(body?.word);
      const source = resolveGeminiSource(body?.source, 'import_lemmatize');
      if (!word) {
        status = 400;
        return errorResponse(request, 'Missing word', status);
      }
      try {
        const data = await lemmatizeVocabularyWord(word, source);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = statusFromEnrichmentError(error);
        logger.error(
          'API Error: /api/vocab/lemmatize',
          error,
          requestLogContext(request, { endpoint: '/api/vocab/lemmatize', word, source }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/lookup') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const word = sanitizeLookupWord(body?.word);
      if (!word) {
        status = 400;
        return errorResponse(request, 'Missing word', status);
      }
      try {
        const data = await lookupWordForPopover(auth.userId, word);
        status = 200;
        return jsonResponse(request, data ? { data } : { data: null, missing: true }, status);
      } catch (error) {
        status = statusFromEnrichmentError(error);
        logger.error(
          'API Error: /api/vocab/lookup',
          error,
          requestLogContext(request, { endpoint: '/api/vocab/lookup', user_id: auth.userId, word }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/report') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (typeof body?.vocabularyItemId !== 'string' || body.vocabularyItemId.trim().length === 0) {
        status = 400;
        return errorResponse(request, 'Missing vocabulary item ID', status);
      }
      try {
        const data = await reportVocabularyIssue(auth.userId, {
          vocabularyItemId: body.vocabularyItemId,
          wordSnapshot: typeof body.wordSnapshot === 'string' ? body.wordSnapshot : null,
          learningGroupId: typeof body.learningGroupId === 'string' ? body.learningGroupId : null,
          sessionRound: typeof body.sessionRound === 'string' ? body.sessionRound : null,
          issueType: body.issueType,
          note: typeof body.note === 'string' ? body.note : null,
          routePath: typeof body.routePath === 'string' ? body.routePath : null,
          userAgent: typeof body.userAgent === 'string' ? body.userAgent : null,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/vocab/report',
          error,
          requestLogContext(request, {
            endpoint: '/api/vocab/report',
            user_id: auth.userId,
            vocabulary_item_id: body.vocabularyItemId,
            issue_type: body.issueType,
          }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/full-enrich') {
      const auth = await requireExpensiveUser(request, 'ai_vocab', 1);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const word = sanitizeLookupWord(body?.word);
      if (!word) {
        status = 400;
        return errorResponse(request, 'Missing word', status);
      }
      try {
        const result = await queueFullEnrichmentForWord(word, 'manual_api');
        if (result.reason === 'not_found') {
          status = 404;
          return errorResponse(request, 'Vocabulary item not found', status);
        }
        status = result.queued ? 202 : 200;
        return jsonResponse(request, result, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/vocab/full-enrich',
          error,
          requestLogContext(request, { endpoint: '/api/vocab/full-enrich', user_id: auth.userId, word }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/lemmatize-batch') {
      const auth = await requireExpensiveUser(request, 'ai_vocab', countStringArray(body?.words));
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const words = Array.isArray(body?.words) ? body.words.map(sanitizeLookupWord).filter(Boolean) : [];
      const source = resolveGeminiSource(body?.source, 'import_lemmatize');
      if (words.length === 0) {
        status = 400;
        return errorResponse(request, 'Missing words array', status);
      }
      try {
        const data = await lemmatizeVocabularyWords(words, source);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = statusFromEnrichmentError(error);
        logger.error(
          'API Error: /api/vocab/lemmatize-batch',
          error,
          requestLogContext(request, {
            endpoint: '/api/vocab/lemmatize-batch',
            word_count: words.length,
            source,
          }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/persist') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const sourceType = resolveVocabularySourceType(body?.sourceType);
      if (!Array.isArray(body?.entries)) {
        status = 400;
        return errorResponse(request, 'Missing entries array', status);
      }
      try {
        const data = await persistFullVocabularyEntries(body.entries, sourceType);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/vocab/persist',
          error,
          requestLogContext(request, {
            endpoint: '/api/vocab/persist',
            user_id: auth.userId,
            source_type: sourceType,
            entry_count: body.entries.length,
          }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/vocab/article') {
      const auth = await requireExpensiveUser(request, 'ai_article', 1);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (!Array.isArray(body?.words) || body.words.length === 0) {
        status = 400;
        return errorResponse(request, 'Missing words array', status);
      }
      const cleaned = body.words.map((word: unknown) => (typeof word === 'string' ? word.trim() : '')).filter(Boolean);
      try {
        const data = await generateArticle(cleaned);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/vocab/article',
          error,
          requestLogContext(request, { endpoint: '/api/vocab/article', word_count: cleaned.length }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/review/attempt') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (
        !body?.vocabularyItemId ||
        (body.source !== 'round2' && body.source !== 'round3' && body.source !== 'review') ||
        typeof body?.wasCorrect !== 'boolean'
      ) {
        status = 400;
        return errorResponse(request, 'Missing required attempt fields', status);
      }
      try {
        const data = await recordReviewAttempt({
          userId: auth.userId,
          vocabularyItemId: body.vocabularyItemId,
          learningGroupId: body.learningGroupId,
          source: body.source,
          wasCorrect: body.wasCorrect,
          elapsedMs: Number(body.elapsedMs) || 0,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/review/attempt',
          error,
          requestLogContext(request, { endpoint: '/api/review/attempt', user_id: auth.userId }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/review/batch-attempt') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (!Array.isArray(body?.attempts)) {
        status = 400;
        return errorResponse(request, 'Missing attempts array', status);
      }
      try {
        const data = await recordBatchReviewAttempts(auth.userId, body.attempts);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/review/batch-attempt',
          error,
          requestLogContext(request, { endpoint: '/api/review/batch-attempt', user_id: auth.userId }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/review/unknown') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (!body?.vocabularyItemId) {
        status = 400;
        return errorResponse(request, 'Missing vocabularyItemId', status);
      }
      try {
        const data = await markVocabularyUnknown({
          userId: auth.userId,
          vocabularyItemId: body.vocabularyItemId,
          learningGroupId: body.learningGroupId,
          timestamp: Number(body.timestamp) || undefined,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/review/unknown',
          error,
          requestLogContext(request, { endpoint: '/api/review/unknown', user_id: auth.userId }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/review/mastered') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (!body?.vocabularyItemId) {
        status = 400;
        return errorResponse(request, 'Missing vocabularyItemId', status);
      }
      try {
        const data = await markVocabularyMastered({
          userId: auth.userId,
          vocabularyItemId: body.vocabularyItemId,
          learningGroupId: body.learningGroupId,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/review/mastered',
          error,
          requestLogContext(request, {
            endpoint: '/api/review/mastered',
            user_id: auth.userId,
            vocabulary_item_id: body.vocabularyItemId,
            learning_group_id: body.learningGroupId,
          }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/ielts/reading/attempts') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const responseCount = Array.isArray(body?.responses) ? body.responses.length : 0;
      try {
        const data = await submitIeltsReadingAttempt(auth.userId, body);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/ielts/reading/attempts',
          error,
          requestLogContext(request, {
            endpoint: '/api/ielts/reading/attempts',
            user_id: auth.userId,
            test_id: body?.testId,
            response_count: responseCount,
          }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/ielts/listening/attempts') {
      if (!ieltsListeningEnabled) {
        status = 404;
        return errorResponse(request, 'IELTS listening is disabled.', status);
      }
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const responseCount = Array.isArray(body?.responses) ? body.responses.length : 0;
      try {
        const data = await submitIeltsListeningAttempt(auth.userId, body);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/ielts/listening/attempts',
          error,
          requestLogContext(request, {
            endpoint: '/api/ielts/listening/attempts',
            user_id: auth.userId,
            test_id: body?.testId,
            response_count: responseCount,
          }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'GET' && path === '/api/ielts/dashboard') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const data = await getIeltsDashboard(auth.userId);
        status = 200;
        return jsonResponse(
          request,
          {
            data: ieltsListeningEnabled ? data : { ...data, listeningBooks: [], listeningAttempts: [] },
          },
          status,
        );
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/ielts/dashboard', error, {
          endpoint: '/api/ielts/dashboard',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const ieltsReadingTestMatch = /^\/api\/ielts\/reading\/tests\/([^/]+)$/.exec(path);
    if (method === 'GET' && ieltsReadingTestMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const testId = decodeURIComponent(ieltsReadingTestMatch[1]);
      try {
        const data = await getIeltsReadingTest(testId);
        if (!data) {
          status = 404;
          return errorResponse(request, 'IELTS reading test not found', status);
        }
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/ielts/reading/tests/${testId}`, error, {
          endpoint: `/api/ielts/reading/tests/${testId}`,
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const ieltsListeningTestMatch = /^\/api\/ielts\/listening\/tests\/([^/]+)$/.exec(path);
    if (method === 'GET' && ieltsListeningTestMatch) {
      if (!ieltsListeningEnabled) {
        status = 404;
        return errorResponse(request, 'IELTS listening is disabled.', status);
      }
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const testId = decodeURIComponent(ieltsListeningTestMatch[1]);
      try {
        const data = await getIeltsListeningTest(testId);
        if (!data) {
          status = 404;
          return errorResponse(request, 'IELTS listening test not found', status);
        }
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/ielts/listening/tests/${testId}`, error, {
          endpoint: `/api/ielts/listening/tests/${testId}`,
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'GET' && path === '/api/review/due') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const timezone = url.searchParams.get('timezone');
      try {
        const data = await fetchDueReviewWords(auth.userId, { timeZone: timezone });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/review/due', error, {
          endpoint: '/api/review/due',
          user_id: auth.userId,
          timezone,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/review/session/start') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const words = await startReviewSession(auth.userId, {
          timeZone: typeof body?.timeZone === 'string' ? body.timeZone : null,
        });
        status = 200;
        return jsonResponse(request, { data: { words } }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/review/session/start',
          error,
          requestLogContext(request, { endpoint: '/api/review/session/start', user_id: auth.userId }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/review/session/complete') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const data = await completeReviewSession(auth.userId, {
          timeZone: typeof body?.timeZone === 'string' ? body.timeZone : null,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(
          'API Error: /api/review/session/complete',
          error,
          requestLogContext(request, { endpoint: '/api/review/session/complete', user_id: auth.userId }),
        );
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'GET' && path === '/api/home/overview') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const timezone = url.searchParams.get('timezone');
      try {
        const data = await getHomeOverview(auth.userId, timezone);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/home/overview', error, {
          endpoint: '/api/home/overview',
          user_id: auth.userId,
          timezone,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'GET' && path === '/api/settings/learning-preferences') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const data = await getUserLearningPreferences(auth.userId);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/settings/learning-preferences', error, {
          endpoint: '/api/settings/learning-preferences',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/settings/learning-preferences') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const data = await saveUserLearningPreferences(auth.userId, resolveLearningPreferencesPatch(body));
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/settings/learning-preferences', error, {
          endpoint: '/api/settings/learning-preferences',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'GET' && path === '/api/library/overview') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const data = await getLibraryOverview(auth.userId);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/library/overview', error, {
          endpoint: '/api/library/overview',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const groupDetailMatch = /^\/api\/library\/groups\/([^/]+)$/.exec(path);
    if (method === 'GET' && groupDetailMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const groupId = decodeURIComponent(groupDetailMatch[1]);
      if (!groupId) {
        status = 400;
        return errorResponse(request, 'Missing group ID', status);
      }
      try {
        const data = await getLibraryGroupDetail(auth.userId, groupId);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/library/groups/${groupId}`, error, {
          endpoint: `/api/library/groups/${groupId}`,
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const learningGroupMatch = /^\/api\/learning\/groups\/([^/]+)$/.exec(path);
    if (method === 'GET' && learningGroupMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const groupId = decodeURIComponent(learningGroupMatch[1]);
      try {
        const data = await getLearningSession(auth.userId, groupId);
        if (!data) {
          status = 404;
          return errorResponse(request, 'Learning group not found', status);
        }
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/learning/groups/${groupId}`, error, {
          endpoint: `/api/learning/groups/${groupId}`,
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const officialLearningStartMatch = /^\/api\/learning\/official\/([^/]+)\/start$/.exec(path);
    if (method === 'POST' && officialLearningStartMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const libraryId = decodeURIComponent(officialLearningStartMatch[1]);
      if (!validateOfficialLibraryId(libraryId)) {
        status = 400;
        return errorResponse(request, 'Unknown official library', status);
      }
      if (!validateOfficialStudyMode(body?.mode)) {
        status = 400;
        return errorResponse(request, 'Unknown study mode', status);
      }
      try {
        const data = await startOfficialLearningSession(auth.userId, {
          libraryId,
          mode: body.mode,
          timeZone: typeof body.timeZone === 'string' ? body.timeZone : null,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/learning/official/${libraryId}/start`, error, {
          endpoint: `/api/learning/official/${libraryId}/start`,
          user_id: auth.userId,
          mode: body.mode,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const learningSessionMatch = /^\/api\/learning\/groups\/([^/]+)\/session$/.exec(path);
    if (method === 'POST' && learningSessionMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const groupId = decodeURIComponent(learningSessionMatch[1]);
      if (!validateLearningRoundInput(body?.round) || !Array.isArray(body?.queueWordIds)) {
        status = 400;
        return errorResponse(request, 'Invalid learning session', status);
      }
      try {
        const data = await saveLearningSession(auth.userId, groupId, {
          round: body.round,
          currentIndex: Number(body.currentIndex) || 0,
          queueWordIds: body.queueWordIds,
          passedQueueIndices: Array.isArray(body.passedQueueIndices) ? body.passedQueueIndices : [],
          round1ConfirmedWordIds: Array.isArray(body.round1ConfirmedWordIds) ? body.round1ConfirmedWordIds : [],
          timeZone: typeof body.timeZone === 'string' ? body.timeZone : null,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/learning/groups/${groupId}/session`, error, {
          endpoint: `/api/learning/groups/${groupId}/session`,
          user_id: auth.userId,
          round: body.round,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const learningCompleteMatch = /^\/api\/learning\/groups\/([^/]+)\/complete-round$/.exec(path);
    if (method === 'POST' && learningCompleteMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const groupId = decodeURIComponent(learningCompleteMatch[1]);
      if (!validateLearningRoundInput(body?.round)) {
        status = 400;
        return errorResponse(request, 'Invalid learning round', status);
      }
      try {
        const data = await completeLearningRound(auth.userId, groupId, {
          round: body.round,
          confirmedWordIds: Array.isArray(body.confirmedWordIds) ? body.confirmedWordIds : [],
          timeZone: typeof body.timeZone === 'string' ? body.timeZone : null,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/learning/groups/${groupId}/complete-round`, error, {
          endpoint: `/api/learning/groups/${groupId}/complete-round`,
          user_id: auth.userId,
          round: body.round,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const officialDeleteMatch = /^\/api\/library\/official\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && officialDeleteMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const libraryId = decodeURIComponent(officialDeleteMatch[1]);
      const timeZone = url.searchParams.get('timezone') ?? (typeof body?.timeZone === 'string' ? body.timeZone : null);
      if (!isOfficialLibraryId(libraryId)) {
        status = 400;
        return errorResponse(request, 'Unknown official library', status);
      }
      try {
        const data = await deleteOfficialLearningLibrary(auth.userId, { libraryId, timeZone });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/library/official/${libraryId}`, error, {
          endpoint: `/api/library/official/${libraryId}`,
          user_id: auth.userId,
          timezone: timeZone,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const officialDiscardMatch = /^\/api\/library\/official\/([^/]+)\/discard-active$/.exec(path);
    if (method === 'POST' && officialDiscardMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const libraryId = decodeURIComponent(officialDiscardMatch[1]);
      if (!isOfficialLibraryId(libraryId)) {
        status = 400;
        return errorResponse(request, 'Unknown official library', status);
      }
      if (typeof body?.groupId !== 'string' || body.groupId.trim().length === 0) {
        status = 400;
        return errorResponse(request, 'Missing group ID', status);
      }
      try {
        const data = await discardActiveOfficialLearningGroup(auth.userId, {
          libraryId,
          groupId: body.groupId,
          timeZone: typeof body.timeZone === 'string' ? body.timeZone : null,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/library/official/${libraryId}/discard-active`, error, {
          endpoint: `/api/library/official/${libraryId}/discard-active`,
          user_id: auth.userId,
          group_id: body.groupId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const officialReorderMatch = /^\/api\/library\/official\/([^/]+)\/reorder-active$/.exec(path);
    if (method === 'POST' && officialReorderMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const libraryId = decodeURIComponent(officialReorderMatch[1]);
      if (!isOfficialLibraryId(libraryId)) {
        status = 400;
        return errorResponse(request, 'Unknown official library', status);
      }
      if (typeof body?.groupId !== 'string' || body.groupId.trim().length === 0) {
        status = 400;
        return errorResponse(request, 'Missing group ID', status);
      }
      if (body.mode !== 'sequential' && body.mode !== 'shuffle') {
        status = 400;
        return errorResponse(request, 'Unknown study mode', status);
      }
      try {
        const data = await reorderActiveOfficialLearningGroup(auth.userId, {
          libraryId,
          groupId: body.groupId,
          mode: body.mode,
        });
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/library/official/${libraryId}/reorder-active`, error, {
          endpoint: `/api/library/official/${libraryId}/reorder-active`,
          user_id: auth.userId,
          group_id: body.groupId,
          mode: body.mode,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'GET' && path === '/api/library/saved-words') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const data = await getSavedWords(auth.userId);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: GET /api/library/saved-words', error, {
          endpoint: '/api/library/saved-words',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/library/saved-words') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const source = resolveSavedWordSource(body?.source);
      if (typeof body?.vocabularyItemId !== 'string' || body.vocabularyItemId.trim().length === 0) {
        status = 400;
        return errorResponse(request, 'Missing vocabulary item ID', status);
      }
      if (!source) {
        status = 400;
        return errorResponse(request, 'Invalid saved word source', status);
      }
      try {
        const data = await saveWordToLibrary(auth.userId, body.vocabularyItemId.trim(), source);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/library/saved-words', error, {
          endpoint: '/api/library/saved-words',
          user_id: auth.userId,
          vocabulary_item_id: body.vocabularyItemId,
          source,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/library/saved-words/learning-group') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (
        !Array.isArray(body?.vocabularyItemIds) ||
        body.vocabularyItemIds.some((id: unknown) => typeof id !== 'string')
      ) {
        status = 400;
        return errorResponse(request, 'Invalid vocabulary item IDs', status);
      }
      try {
        const data = await createLearningGroupFromSavedWords(auth.userId, body.vocabularyItemIds);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/library/saved-words/learning-group', error, {
          endpoint: '/api/library/saved-words/learning-group',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/library/saved-words/cleanup') {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      try {
        const result = await cleanupSavedLibrary({ apply: true, userId: auth.userId, sampleLimit: 0 });
        status = 200;
        return jsonResponse(
          request,
          {
            data: {
              removedSavedWords: result.removedSavedWords,
              createdReviewStates: result.createdReviewStates,
              deletedCustomGroups: result.deletedCustomGroups,
            },
          },
          status,
        );
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/library/saved-words/cleanup', error, {
          endpoint: '/api/library/saved-words/cleanup',
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const savedWordDeleteMatch = /^\/api\/library\/saved-words\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && savedWordDeleteMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const vocabularyItemId = decodeURIComponent(savedWordDeleteMatch[1]);
      if (!vocabularyItemId) {
        status = 400;
        return errorResponse(request, 'Missing vocabulary item ID', status);
      }
      try {
        const data = await removeWordFromLibrary(auth.userId, vocabularyItemId);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/library/saved-words/${vocabularyItemId}`, error, {
          endpoint: `/api/library/saved-words/${vocabularyItemId}`,
          user_id: auth.userId,
          vocabulary_item_id: vocabularyItemId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const groupDeleteMatch = /^\/api\/library\/groups\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && groupDeleteMatch) {
      const auth = await requireUser(request);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const groupId = decodeURIComponent(groupDeleteMatch[1]);
      if (!groupId) {
        status = 400;
        return errorResponse(request, 'Missing group ID', status);
      }
      try {
        await deleteLearningGroup(auth.userId, groupId);
        status = 200;
        return jsonResponse(request, { data: { success: true } }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/library/groups/${groupId}`, error, {
          endpoint: `/api/library/groups/${groupId}`,
          user_id: auth.userId,
        });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    const audioMatch = /^\/api\/audio\/([^/]+)$/.exec(path);
    if (method === 'GET' && audioMatch) {
      const auth = await requireExpensiveUser(request, 'tts', 1);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      const word = decodeURIComponent(audioMatch[1]);
      const rawLocale = url.searchParams.get('locale');
      const locale = rawLocale === 'us' ? 'us' : 'uk';
      if (!word) {
        status = 400;
        return errorResponse(request, 'Missing word', status);
      }
      try {
        const data = await getOrCreateAudio(word, locale);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error(`API Error: /api/audio/${word}`, error, { endpoint: `/api/audio/${word}`, locale });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/audio/batch') {
      const auth = await requireExpensiveUser(request, 'tts', Math.min(countStringArray(body?.words), 30) * 2);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (!Array.isArray(body?.words)) {
        status = 400;
        return errorResponse(request, 'Missing words array', status);
      }
      const cleaned = body.words
        .map((word: unknown) => (typeof word === 'string' ? word.trim() : ''))
        .filter(Boolean)
        .slice(0, 30);
      try {
        const data = await batchGenerateAudio(cleaned);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = 500;
        logger.error('API Error: /api/audio/batch', error, { endpoint: '/api/audio/batch' });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    if (method === 'POST' && path === '/api/example-audio') {
      const auth = await requireExpensiveUser(request, 'tts', 1);
      if (auth.response) {
        status = auth.status ?? 401;
        return auth.response;
      }
      if (typeof body?.text !== 'string') {
        status = 400;
        return errorResponse(request, 'Missing example text', status);
      }
      if (body.locale !== 'uk' && body.locale !== 'us') {
        status = 400;
        return errorResponse(request, 'Invalid locale', status);
      }
      try {
        const data = await getOrCreateExampleAudio(body.text, body.locale);
        status = 200;
        return jsonResponse(request, { data }, status);
      } catch (error) {
        status = error instanceof ExampleAudioValidationError ? error.statusCode : 500;
        logger.error('API Error: /api/example-audio', error, { endpoint: '/api/example-audio', locale: body.locale });
        return errorResponse(request, error instanceof Error ? error.message : String(error), status);
      }
    }

    return errorResponse(request, 'Not found', status);
  } catch (error) {
    status = 500;
    logger.error('Unhandled API Error', error, requestLogContext(request, { endpoint: path, method }));
    return errorResponse(request, error instanceof Error ? error.message : String(error), status);
  } finally {
    logger.info(`${method} ${path} ${status} - ${Date.now() - start}ms`, {
      request_id: requestId,
      method,
      url: path,
      status,
      duration: Date.now() - start,
    });
  }
});
