import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  consumeExpensiveRateLimit,
  countStringArray,
  __resetExpensiveRateLimitForTests,
} from '../shared/expensiveRateLimit.ts';
import { OFFICIAL_LIBRARY_DEFINITIONS } from '../src/lib/officialLibrary.ts';
import { existsSync } from 'node:fs';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function extractFunction(source: string, functionName: string) {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} export should exist`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function assertIncludes(source: string, needle: string, label: string) {
  assert.ok(source.includes(needle), `${label} should include ${needle}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
for (const script of ['test:official-library', 'test:core', 'test:ielts', 'test:all', 'check:edge', 'check:audit']) {
  assert.equal(typeof packageJson.scripts[script], 'string', `${script} should be declared`);
}

const ci = read('.github/workflows/ci.yml');
for (const command of [
  'npm ci',
  'npm run lint',
  'npm run build',
  'npm run test:core',
  'npm run test:ielts',
  'npm run check:edge',
  'npm run check:audit',
]) {
  assertIncludes(ci, command, 'CI workflow');
}

const edgeApi = read('supabase/functions/api/index.ts');
assert.equal(edgeApi.includes('@ts-nocheck'), false, 'Edge API must stay type-checked');
assertIncludes(edgeApi, "path === '/api/vocab/persist'", 'Edge vocabulary persistence route');
assertIncludes(edgeApi, "path === '/api/ielts/reading/attempts'", 'Edge reading attempt route');
assertIncludes(edgeApi, "path === '/api/ielts/listening/attempts'", 'Edge listening attempt route');

const migration = read('supabase/migrations/20260522010000_enterprise_hardening_data_boundaries.sql');
for (const sql of [
  'CREATE OR REPLACE FUNCTION public.persist_vocabulary_entries',
  'CREATE OR REPLACE FUNCTION public.submit_ielts_reading_attempt',
  'CREATE OR REPLACE FUNCTION public.submit_ielts_listening_attempt',
  'GRANT EXECUTE ON FUNCTION public.persist_vocabulary_entries',
  'GRANT EXECUTE ON FUNCTION public.submit_ielts_reading_attempt',
  'GRANT EXECUTE ON FUNCTION public.submit_ielts_listening_attempt',
  'CREATE POLICY "vocabulary_items_authenticated_select"',
  'ON CONFLICT (form) DO NOTHING',
]) {
  assertIncludes(migration, sql, 'hardening migration');
}
assert.equal(
  /CREATE POLICY "public_all" ON public\.vocabulary_items/.test(migration),
  false,
  'hardening migration must not recreate public vocabulary writes',
);

for (const table of [
  'public.vocabulary_items',
  'public.vocabulary_senses',
  'public.vocabulary_item_forms',
  'public.vocabulary_morphology_parts',
  'public.vocabulary_relations',
  'public.confused_words',
]) {
  assertIncludes(migration, `DROP POLICY IF EXISTS "public_all" ON ${table};`, `RLS tightening for ${table}`);
}

const readingFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.submit_ielts_reading_attempt'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.submit_ielts_listening_attempt'),
);
assertIncludes(readingFunction, 'INSERT INTO public.ielts_reading_attempts', 'reading transactional RPC');
assertIncludes(readingFunction, 'INSERT INTO public.ielts_reading_responses', 'reading transactional RPC');

const listeningFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.submit_ielts_listening_attempt'),
);
assertIncludes(listeningFunction, 'INSERT INTO public.ielts_listening_attempts', 'listening transactional RPC');
assertIncludes(listeningFunction, 'INSERT INTO public.ielts_listening_responses', 'listening transactional RPC');

const exclusiveLearningMigration = read('supabase/migrations/20260522020000_exclusive_learning_library.sql');
for (const sql of [
  'CREATE OR REPLACE FUNCTION public.create_learning_group_exclusive',
  'PERFORM pg_advisory_xact_lock',
  'DELETE FROM public.review_events',
  'DELETE FROM public.review_states',
  'DELETE FROM public.learning_groups',
  'INSERT INTO public.learning_groups',
  'INSERT INTO public.learning_group_words',
  'INSERT INTO public.review_states',
  'GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive',
]) {
  assertIncludes(exclusiveLearningMigration, sql, 'exclusive learning library migration');
}
assertIncludes(
  exclusiveLearningMigration,
  "WHEN source_type = 'system' THEN 'official:'",
  'exclusive learning library keying',
);
assertIncludes(exclusiveLearningMigration, "ELSE 'custom'", 'exclusive learning library keying');

const exclusiveLearningTriggerMigration = read(
  'supabase/migrations/20260522030000_enforce_exclusive_learning_group_trigger.sql',
);
for (const sql of [
  'CREATE OR REPLACE FUNCTION public.learning_group_library_key',
  'CREATE OR REPLACE FUNCTION public.discard_conflicting_active_learning_groups',
  'CREATE OR REPLACE FUNCTION public.enforce_exclusive_active_learning_library',
  'CREATE TRIGGER enforce_exclusive_active_learning_library_insert',
  'BEFORE INSERT ON public.learning_groups',
  'DELETE FROM public.review_events',
  'DELETE FROM public.review_states',
  'DELETE FROM public.learning_groups',
  'latest_active_group',
]) {
  assertIncludes(exclusiveLearningTriggerMigration, sql, 'exclusive learning trigger migration');
}
assertIncludes(
  exclusiveLearningTriggerMigration,
  'public.learning_group_library_key(source_type, library_id) <> v_target_library_key',
  'exclusive learning trigger keying',
);

const parallelOfficialLearningMigration = read(
  'supabase/migrations/20260529020000_parallel_official_learning_stream.sql',
);
for (const sql of [
  'ADD COLUMN IF NOT EXISTS session_round1_confirmed_word_ids',
  'DROP TRIGGER IF EXISTS enforce_exclusive_active_learning_library_insert',
  'DROP FUNCTION IF EXISTS public.enforce_exclusive_active_learning_library',
  'DROP FUNCTION IF EXISTS public.discard_conflicting_active_learning_groups',
  'CREATE OR REPLACE FUNCTION public.create_learning_group_exclusive',
  'INSERT INTO public.learning_groups',
  'INSERT INTO public.learning_group_words',
  'INSERT INTO public.review_states',
]) {
  assertIncludes(parallelOfficialLearningMigration, sql, 'parallel official learning migration');
}
assert.equal(
  /DELETE FROM public\.learning_groups/.test(parallelOfficialLearningMigration),
  false,
  'parallel official learning migration must not delete other active official groups',
);

const sharedLibrarySource = read('shared/server/library.ts');
const deleteOfficialLibraryFunction = extractFunction(sharedLibrarySource, 'deleteOfficialLearningLibrary');
assert.equal(
  deleteOfficialLibraryFunction.includes('deleteReviewDataForWords'),
  false,
  'official library deletion must preserve review state and event history',
);
assert.equal(
  deleteOfficialLibraryFunction.includes('clearTodayRoutineBinding'),
  false,
  'official library deletion must not clear or recompute today routine progress',
);
assertIncludes(
  deleteOfficialLibraryFunction,
  'fetchTodayRoutineBoundGroupIds',
  'official library deletion should preserve groups bound to today routine',
);

const schema = read('supabase/schema.sql');
assertIncludes(schema, 'session_round1_confirmed_word_ids JSONB', 'schema learning session persistence');
assert.equal(
  schema.includes('CREATE TRIGGER enforce_exclusive_active_learning_library_insert'),
  false,
  'schema must not keep exclusive active official trigger',
);

const importFlow = read('src/lib/importFlow.ts');
const directVocabularyWrites =
  /\.(?:from)\('(?:vocabulary_(?:items|senses|item_forms|morphology_parts|relations)|confused_words)'\)\s*\n\s*\.(?:insert|upsert|delete|update)/g;
assert.equal(
  directVocabularyWrites.test(importFlow),
  false,
  'import flow must not directly write shared vocabulary tables',
);
assertIncludes(importFlow, "'/api/vocab/persist'", 'import flow');
assertIncludes(importFlow, "rpc('create_learning_group_exclusive'", 'learning group creation');
assert.equal(
  /\.from\('learning_groups'\)[\s\S]{0,300}\.insert\(/.test(importFlow),
  false,
  'learning group creation must use transactional RPC',
);
assert.equal(
  /\.from\('learning_group_words'\)[\s\S]{0,300}\.insert\(/.test(importFlow),
  false,
  'learning group words creation must use transactional RPC',
);

const savedWordsPanel = read('src/components/library/SavedWordsPanel.tsx');
assertIncludes(
  savedWordsPanel,
  "fetchActiveLearningGroupWordIds(userId, { sourceType: 'custom' })",
  'saved words active group guard',
);

const readingSubmit = extractFunction(read('src/lib/ieltsReadingApi.ts'), 'submitIeltsReadingAttempt');
assertIncludes(readingSubmit, "'/api/ielts/reading/attempts'", 'reading submit path');
assert.equal(
  /\.from\('ielts_reading_(?:attempts|responses)'\)/.test(readingSubmit),
  false,
  'reading submit must not directly insert attempts/responses',
);

const listeningSubmit = extractFunction(read('src/lib/ieltsListeningApi.ts'), 'submitIeltsListeningAttempt');
assertIncludes(listeningSubmit, "'/api/ielts/listening/attempts'", 'listening submit path');
assert.equal(
  /\.from\('ielts_listening_(?:attempts|responses)'\)/.test(listeningSubmit),
  false,
  'listening submit must not directly insert attempts/responses',
);

const server = read('server/index.ts');
assertIncludes(server, 'X-Request-Id', 'Express API');
assertIncludes(edgeApi, 'X-Request-Id', 'Edge API');
// Rate-limit policy is single-sourced in shared/expensiveRateLimit.ts; server and edge must import it, not redeclare it.
const rateLimitCore = read('shared/expensiveRateLimit.ts');
assertIncludes(rateLimitCore, 'const DEFAULT_RATE_LIMITS', 'shared rate-limit policy');
assertIncludes(rateLimitCore, 'IP_RATE_LIMIT_MULTIPLIER = 3', 'shared IP fallback rate limit');
for (const [label, source] of [
  ['Express', server],
  ['Edge', edgeApi],
] as const) {
  assertIncludes(source, "shared/expensiveRateLimit.ts'", `${label} imports shared rate-limit core`);
  assert.equal(
    source.includes('const DEFAULT_RATE_LIMITS'),
    false,
    `${label} must not redeclare rate-limit policy (single source in shared/expensiveRateLimit.ts)`,
  );
}
for (const [method, route, middleware] of [
  ['post', '/api/vocab/enrich', 'requireAuth, requireAiContentFeatures, aiVocabQuota'],
  ['post', '/api/vocab/lite-enrich', 'requireAuth, requireAiContentFeatures, aiVocabSingleQuota'],
  ['post', '/api/vocab/lemmatize', 'requireAuth, requireAiContentFeatures, aiVocabSingleQuota'],
  ['post', '/api/vocab/lemmatize-batch', 'requireAuth, requireAiContentFeatures, aiVocabQuota'],
  ['post', '/api/vocab/full-enrich', 'requireAuth, requireAiContentFeatures, aiVocabSingleQuota'],
  ['post', '/api/vocab/article', 'requireAuth, requireAiContentFeatures, aiArticleQuota'],
  ['get', '/api/audio/:word', 'requireAuth, ttsSingleQuota'],
  ['post', '/api/audio/batch', 'requireAuth, ttsBatchQuota'],
  ['post', '/api/example-audio', 'requireAuth, ttsSingleQuota'],
]) {
  const middlewarePattern = middleware.split(', ').map(escapeRegExp).join('\\s*,\\s*');
  assert.match(
    server,
    new RegExp(`app\\.${method}\\(\\s*'${escapeRegExp(route)}'\\s*,\\s*${middlewarePattern}`),
    `Express expensive route ${route}`,
  );
}
assertIncludes(server, 'function requireAiContentFeatures', 'Express AI feature gate');
assertIncludes(edgeApi, "group === 'ai_vocab' || group === 'ai_article'", 'Edge AI feature gate');
for (const [group, weight] of [
  ["'ai_vocab'", 'countStringArray(body?.words)'],
  ["'ai_vocab'", '1'],
  ["'ai_article'", '1'],
  ["'tts'", '1'],
  ["'tts'", 'Math.min(countStringArray(body?.words), 30) * 2'],
]) {
  assertIncludes(edgeApi, `requireExpensiveUser(request, ${group}, ${weight})`, `Edge expensive quota ${group}`);
}
assert.equal(
  server.includes('res.status(500).json({ error: message })'),
  false,
  'Express 500 responses must not expose raw exception messages',
);
for (const forbiddenPattern of [
  /status\(500\)\.json\(\{\s*error:\s*(?:message|e|err|error)/,
  /status\(500\)\.send\(/,
]) {
  assert.equal(forbiddenPattern.test(server), false, `Express 500 responses must not match ${forbiddenPattern}`);
}
assertIncludes(server, 'error: INTERNAL_ERROR_MESSAGE', 'Express internal error response');
assertIncludes(server, 'const expressErrorHandler: ErrorRequestHandler', 'Express fallback error handler');
assertIncludes(server, 'app.use(expressErrorHandler)', 'Express fallback error handler registration');
assertIncludes(edgeApi, 'error: INTERNAL_ERROR_MESSAGE', 'Edge internal error response');
assertIncludes(edgeApi, 'if (status === 500)', 'Edge 500 sanitizer');
for (const file of ['src/lib/wordAudio.ts', 'src/lib/exampleAudio.ts', 'src/components/import/ImportView.tsx']) {
  assert.equal(read(file).includes('requiresAuth: false'), false, `${file} must send auth for expensive API calls`);
}

// Behavioral checks for the shared rate limiter (not just source-string presence).
// Defaults: ai_article minute=3; IP fallback = 3x => 9 per minute.
__resetExpensiveRateLimitForTests();
for (let i = 0; i < 3; i += 1) {
  const r = consumeExpensiveRateLimit({ group: 'ai_article', userId: 'u1', ip: '10.0.0.1', weight: 1 });
  assert.equal(r.allowed, true, `ai_article request ${i + 1} within per-user limit should be allowed`);
}
const overUser = consumeExpensiveRateLimit({ group: 'ai_article', userId: 'u1', ip: '10.0.0.1', weight: 1 });
assert.equal(overUser.allowed, false, '4th ai_article request must exceed per-user minute limit');
if (!overUser.allowed) {
  assert.equal(overUser.scope, 'user', 'per-user limit should trip first');
  assert.equal(overUser.window, 'minute', 'minute window should be the binding window');
  assert.ok(
    overUser.retryAfterSeconds > 0 && overUser.retryAfterSeconds <= 60,
    'retryAfterSeconds within minute window',
  );
}

// A different user on the same IP is independent until the IP fallback (3x) is hit.
__resetExpensiveRateLimitForTests();
for (const user of ['a', 'b', 'c']) {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      consumeExpensiveRateLimit({ group: 'ai_article', userId: user, ip: '10.0.0.9', weight: 1 }).allowed,
      true,
      `${user} request ${i + 1} should be allowed under its own limit`,
    );
  }
}
const overIp = consumeExpensiveRateLimit({ group: 'ai_article', userId: 'd', ip: '10.0.0.9', weight: 1 });
assert.equal(overIp.allowed, false, 'IP fallback limit (3x) must trip after 9 requests share an IP');
if (!overIp.allowed) {
  assert.equal(overIp.scope, 'ip', 'IP fallback should be the tripped scope');
}

// Weight accounting: a single weighted call can exceed the limit in one shot.
__resetExpensiveRateLimitForTests();
const heavy = consumeExpensiveRateLimit({ group: 'ai_article', userId: 'w', ip: '10.0.0.2', weight: 4 });
assert.equal(heavy.allowed, false, 'weight 4 exceeds ai_article minute limit of 3 in one call');

assert.equal(countStringArray(['a', '', '  ', 'b']), 2, 'countStringArray ignores empty/whitespace entries');
assert.equal(countStringArray('not-an-array'), 1, 'countStringArray falls back to 1 for non-arrays');
__resetExpensiveRateLimitForTests();

// Single-source guard: the server/edge twin trees must stay collapsed.
assert.equal(
  existsSync(join(root, 'supabase/functions/_shared')),
  false,
  'supabase/functions/_shared must not return — shared server logic lives in shared/server/',
);
for (const orphan of ['gemini.ts', 'review.ts', 'vocab.ts', 'home.ts', 'library.ts', 'supabase.ts', 'logger.ts']) {
  assert.equal(
    existsSync(join(root, 'server', orphan)),
    false,
    `server/${orphan} must not be reintroduced — import from shared/server/ instead`,
  );
}
assertIncludes(
  read('supabase/functions/deno.json'),
  '@supabase/supabase-js',
  'Edge import map maps the supabase npm specifier',
);
assert.equal(
  read('package.json').includes('@google/genai'),
  false,
  '@google/genai dependency must stay removed (Gemini calls use REST fetch)',
);

// Latent-bug guard: home.ts hardcodes official totals (Edge cannot load vocab arrays);
// they must match the real word counts so the two never silently diverge.
const homeSource = read('shared/server/home.ts');
const totalsBlock = /OFFICIAL_LIBRARY_TOTALS[^{]*\{([^}]*)\}/.exec(homeSource);
assert.ok(totalsBlock, 'home.ts should declare OFFICIAL_LIBRARY_TOTALS');
const hardcodedTotals = new Map<string, number>();
for (const [, id, count] of totalsBlock![1].matchAll(/'([^']+)'\s*:\s*(\d+)/g)) {
  hardcodedTotals.set(id, Number(count));
}
const realCounts = new Map(OFFICIAL_LIBRARY_DEFINITIONS.map((d) => [d.id, d.words.length]));
assert.equal(hardcodedTotals.size, realCounts.size, 'home.ts totals must cover every official library');
for (const [id, real] of realCounts) {
  assert.equal(
    hardcodedTotals.get(id),
    real,
    `home.ts OFFICIAL_LIBRARY_TOTALS['${id}'] (${hardcodedTotals.get(id)}) must equal the real word count (${real})`,
  );
}

console.log('enterprise hardening contract checks passed');
