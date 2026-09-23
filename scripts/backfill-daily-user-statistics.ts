import 'dotenv/config';
import { supabaseAdmin } from '../shared/server/supabase.ts';

interface CliOptions {
  apply: boolean;
  userId?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--dry-run') {
      options.apply = false;
    } else if (arg.startsWith('--user-id=')) {
      options.userId = arg.slice('--user-id='.length).trim();
    }
  }
  return options;
}

export async function backfillDailyUserStatistics(options: CliOptions) {
  console.log(`[Backfill] Starting daily_user_statistics backfill (Mode: ${options.apply ? 'APPLY' : 'DRY RUN'})...`);

  // 1. Backfill learning_groups.word_count first
  console.log('[Backfill] Step 1: Checking learning_groups.word_count...');
  const { data: groups, error: groupsError } = await supabaseAdmin
    .from('learning_groups')
    .select('id, group_name, word_count');

  if (groupsError) {
    console.error('[Backfill] Failed to fetch learning_groups:', groupsError.message);
  } else {
    let updatedGroupsCount = 0;
    for (const group of groups ?? []) {
      if (!group.word_count || group.word_count === 0) {
        const { count, error: countError } = await supabaseAdmin
          .from('learning_group_words')
          .select('id', { count: 'exact', head: true })
          .eq('learning_group_id', group.id);

        if (!countError && typeof count === 'number' && count > 0) {
          if (options.apply) {
            await supabaseAdmin.from('learning_groups').update({ word_count: count }).eq('id', group.id);
          }
          updatedGroupsCount++;
        }
      }
    }
    console.log(`[Backfill] Step 1 done: ${updatedGroupsCount} learning groups need word_count update.`);
  }

  // 2. Aggregate review_events into daily_user_statistics
  console.log('[Backfill] Step 2: Aggregating review_events...');
  let query = supabaseAdmin
    .from('review_events')
    .select('id, user_id, vocabulary_item_id, source, was_correct, created_at')
    .order('created_at', { ascending: true });

  if (options.userId) {
    query = query.eq('user_id', options.userId);
  }

  const PAGE_SIZE = 1000;
  const userDateBuckets = new Map<
    string,
    {
      userId: string;
      dateKey: string;
      reviewWords: Set<string>;
      learnedWords: Set<string>;
      attemptCount: number;
      correctCount: number;
    }
  >();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: events, error: eventsError } = await query.range(from, from + PAGE_SIZE - 1);
    if (eventsError) {
      console.error('[Backfill] Error reading review_events:', eventsError.message);
      break;
    }

    if (!events || events.length === 0) break;

    for (const event of events) {
      const dateKey = event.created_at.slice(0, 10);
      const bucketKey = `${event.user_id}:${dateKey}`;

      let bucket = userDateBuckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          userId: event.user_id,
          dateKey,
          reviewWords: new Set(),
          learnedWords: new Set(),
          attemptCount: 0,
          correctCount: 0,
        };
        userDateBuckets.set(bucketKey, bucket);
      }

      bucket.attemptCount += 1;
      if (event.was_correct) {
        bucket.correctCount += 1;
      }
      if (event.source === 'review') {
        bucket.reviewWords.add(event.vocabulary_item_id);
      } else if (event.source === 'round2' || event.source === 'round3') {
        bucket.learnedWords.add(event.vocabulary_item_id);
      }
    }

    if (events.length < PAGE_SIZE) break;
  }

  console.log(`[Backfill] Found ${userDateBuckets.size} unique (user, date) buckets to insert.`);

  if (options.apply && userDateBuckets.size > 0) {
    const rowsToUpsert = Array.from(userDateBuckets.values()).map((bucket) => ({
      user_id: bucket.userId,
      date_key: bucket.dateKey,
      review_word_count: bucket.reviewWords.size,
      learned_word_count: bucket.learnedWords.size,
      attempt_count: bucket.attemptCount,
      correct_count: bucket.correctCount,
      updated_at: new Date().toISOString(),
    }));

    const BATCH_UPSERT_SIZE = 100;
    for (let i = 0; i < rowsToUpsert.length; i += BATCH_UPSERT_SIZE) {
      const chunk = rowsToUpsert.slice(i, i + BATCH_UPSERT_SIZE);
      const { error: upsertError } = await supabaseAdmin
        .from('daily_user_statistics')
        .upsert(chunk, { onConflict: 'user_id,date_key' });

      if (upsertError) {
        console.error(`[Backfill] Batch upsert failed at index ${i}:`, upsertError.message);
      }
    }
    console.log('[Backfill] All daily_user_statistics records successfully upserted.');
  }

  console.log('[Backfill] Complete!');
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('backfill-daily-user-statistics.ts');
if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  backfillDailyUserStatistics(options).catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });
}
