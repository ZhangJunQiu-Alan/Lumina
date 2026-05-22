import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
for (const script of [
  'test:official-library',
  'test:core',
  'test:ielts',
  'test:all',
  'check:edge',
  'check:audit',
]) {
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

const importFlow = read('src/lib/importFlow.ts');
const directVocabularyWrites = /\.(?:from)\('(?:vocabulary_(?:items|senses|item_forms|morphology_parts|relations)|confused_words)'\)\s*\n\s*\.(?:insert|upsert|delete|update)/g;
assert.equal(
  directVocabularyWrites.test(importFlow),
  false,
  'import flow must not directly write shared vocabulary tables',
);
assertIncludes(importFlow, "'/api/vocab/persist'", 'import flow');

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

console.log('enterprise hardening contract checks passed');
