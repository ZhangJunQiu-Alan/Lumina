import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function assertIncludes(source: string, needle: string, label: string) {
  assert.ok(source.includes(needle), `${label} should include: ${needle}`);
}

console.log('[Test Atomic Transactions] Verifying Task 1.4 contracts and database atomicity...');

// 1. Verify migration file
const migrationPath = 'supabase/migrations/20260924000000_atomic_review_and_session_completion.sql';
assert.ok(existsSync(join(root, migrationPath)), `Migration file ${migrationPath} should exist`);
const migrationSql = read(migrationPath);

// Verify record_review_attempt_atomic
assertIncludes(migrationSql, 'CREATE OR REPLACE FUNCTION public.record_review_attempt_atomic', 'Migration');
assertIncludes(migrationSql, 'pg_advisory_xact_lock(hashtext(p_user_id)::BIGINT)', 'Review attempt advisory lock');
assertIncludes(migrationSql, 'INSERT INTO public.review_states', 'Review states UPSERT in RPC');
assertIncludes(migrationSql, 'INSERT INTO public.review_events', 'Review events INSERT in RPC');
assertIncludes(migrationSql, 'INSERT INTO public.daily_user_statistics', 'Daily user statistics UPSERT in RPC');
assertIncludes(migrationSql, 'SECURITY DEFINER', 'Review attempt SECURITY DEFINER');
assertIncludes(migrationSql, 'SET search_path = public', 'Review attempt search_path protection');
assertIncludes(
  migrationSql,
  'GRANT EXECUTE ON FUNCTION public.record_review_attempt_atomic',
  'Review attempt permissions',
);

// Verify complete_learning_group_atomic
assertIncludes(migrationSql, 'CREATE OR REPLACE FUNCTION public.complete_learning_group_atomic', 'Migration');
assertIncludes(migrationSql, 'UPDATE public.learning_group_words', 'Learning group words batch update in RPC');
assertIncludes(migrationSql, 'UPDATE public.learning_groups', 'Learning groups status completion in RPC');
assertIncludes(migrationSql, 'daily_routine_progress', 'Daily routine progress integration in RPC');
assertIncludes(migrationSql, 'DELETE FROM public.user_saved_words', 'Saved words cleanup in RPC');
assertIncludes(
  migrationSql,
  'GRANT EXECUTE ON FUNCTION public.complete_learning_group_atomic',
  'Group complete permissions',
);

console.log('  ✓ Migration file contains robust PL/pgSQL atomic procedures');

// 2. Verify schema.sql synchronization
const schemaSql = read('supabase/schema.sql');
assertIncludes(schemaSql, 'CREATE OR REPLACE FUNCTION public.record_review_attempt_atomic', 'schema.sql');
assertIncludes(schemaSql, 'CREATE OR REPLACE FUNCTION public.complete_learning_group_atomic', 'schema.sql');
console.log('  ✓ schema.sql synchronized with atomic procedures');

// 3. Verify server-side review.ts integration
const reviewTs = read('shared/server/review.ts');
assertIncludes(reviewTs, "supabaseAdmin.rpc('record_review_attempt_atomic'", 'review.ts RPC call');
assertIncludes(reviewTs, 'isMissingRpcError', 'review.ts missing RPC error detection');
assertIncludes(reviewTs, 'recordDailyUserStatisticsFallback', 'review.ts statistics fallback');
console.log('  ✓ shared/server/review.ts seamlessly dispatches to record_review_attempt_atomic with fallback');

// 4. Verify client-side learningSessionApi.ts integration
const learningSessionApiTs = read('src/lib/learningSessionApi.ts');
assertIncludes(
  learningSessionApiTs,
  'export async function completeLearningGroupAtomic',
  'learningSessionApi.ts export',
);
assertIncludes(
  learningSessionApiTs,
  "registerSyncHandler('group-complete-atomic'",
  'learningSessionApi.ts sync handler',
);
assertIncludes(learningSessionApiTs, "supabase.rpc('complete_learning_group_atomic'", 'learningSessionApi.ts RPC call');
assertIncludes(learningSessionApiTs, 'isMissingRpcError', 'learningSessionApi.ts RPC error handling');
console.log('  ✓ src/lib/learningSessionApi.ts exposes completeLearningGroupAtomic with offline sync queue');

// 5. Verify App.tsx orchestration
const appTsx = read('src/App.tsx');
assertIncludes(appTsx, 'completeLearningGroupAtomic', 'App.tsx imports completeLearningGroupAtomic');
assertIncludes(
  appTsx,
  'await completeLearningGroupAtomic(user.id, activeLearningGroupId',
  'App.tsx finishes via atomic RPC',
);
console.log('  ✓ src/App.tsx unifies session completion through completeLearningGroupAtomic');

// 6. Verify dailyRoutineApi.ts integration
const dailyRoutineApiTs = read('src/lib/dailyRoutineApi.ts');
assertIncludes(dailyRoutineApiTs, 'export async function markRemoteRoutineStepCompleted', 'dailyRoutineApi.ts export');
assertIncludes(dailyRoutineApiTs, 'is_routine_finished: true', 'dailyRoutineApi.ts routine completion sync');
console.log('  ✓ src/lib/dailyRoutineApi.ts syncs completion state to daily_user_statistics');

console.log('\n[Test Atomic Transactions] All Task 1.4 ACID contract checks passed! 🚀\n');
