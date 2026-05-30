// Seeds the official_vocab table from the ordered word arrays in src/data/*.
// This script is the single bridge keeping DB `position` == client array index.
// Re-run it whenever any src/data official list changes.
//
//   npm run seed:official-vocab-list   (see package.json)
import { createClient } from '@supabase/supabase-js';
import { OFFICIAL_LIBRARY_DEFINITIONS } from '../src/lib/officialLibrary';

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, key, { auth: { persistSession: false } });

const CHUNK = 1000;

interface Row {
  library_id: string;
  position: number;
  word: string;
  word_key: string;
}

async function main() {
  for (const def of OFFICIAL_LIBRARY_DEFINITIONS) {
    const rows: Row[] = def.words.map((word, index) => ({
      library_id: def.id,
      position: index,
      word,
      word_key: word.trim().toLowerCase(),
    }));

    // Guard: no normalized-duplicate words (the unique (library_id, word_key) index
    // would reject them, and it would mean DB/client could diverge on selection).
    const seen = new Set<string>();
    const dups = rows.filter((r) => (seen.has(r.word_key) ? true : (seen.add(r.word_key), false)));
    if (dups.length > 0) {
      throw new Error(`[${def.id}] normalized-duplicate words: ${dups.map((d) => d.word_key).join(', ')}`);
    }

    // Replace this library's rows wholesale so re-runs stay idempotent and prune deletions.
    const { error: delError } = await db.from('official_vocab').delete().eq('library_id', def.id);
    if (delError) throw new Error(`[${def.id}] delete failed: ${delError.message}`);

    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db.from('official_vocab').insert(rows.slice(i, i + CHUNK));
      if (error) throw new Error(`[${def.id}] insert failed at ${i}: ${error.message}`);
    }

    const { count } = await db
      .from('official_vocab')
      .select('*', { count: 'exact', head: true })
      .eq('library_id', def.id);
    if (count !== rows.length) {
      throw new Error(`[${def.id}] post-seed count ${count} != expected ${rows.length}`);
    }
    console.log(`[${def.id}] seeded ${rows.length} words`);
  }
  console.log('official_vocab seed complete');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
