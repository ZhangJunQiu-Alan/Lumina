import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

const TABLES = [
  'vocabulary_items',
  'vocabulary_senses',
  'vocabulary_morphology_parts',
  'vocabulary_relations',
  'confused_words',
  'learning_groups',
  'learning_group_words',
  'review_states',
  'review_events',
  'generated_articles',
];

console.log('\n🔷 Checking Supabase tables...\n');

let missing = [];
for (const table of TABLES) {
  const { error } = await supabase.from(table).select('id').limit(1);
  if (error) {
    console.log(`  ❌ ${table} — ${error.message}`);
    missing.push(table);
  } else {
    console.log(`  ✅ ${table}`);
  }
}

if (missing.length > 0) {
  console.log(`\n⚠️  ${missing.length} table(s) missing.\n`);
  console.log('Run the SQL schema in Supabase Dashboard:');
  console.log('  → https://supabase.com/dashboard/project/zhjdsvcgccdvtnicyasi/sql/new');
  console.log('  → Paste contents of: supabase/schema.sql\n');
} else {
  console.log('\n✅ All tables exist. Database is ready.\n');

  // Quick smoke test: insert + delete a vocabulary_item
  const { data, error } = await supabase
    .from('vocabulary_items')
    .insert({ word: '__smoke_test__', source_type: 'test' })
    .select('id')
    .single();

  if (error) {
    console.log('⚠️  Write test failed:', error.message);
    console.log('   Check RLS policies in supabase/schema.sql\n');
  } else {
    await supabase.from('vocabulary_items').delete().eq('id', data.id);
    console.log('✅ Read/write smoke test passed.\n');
  }
}
