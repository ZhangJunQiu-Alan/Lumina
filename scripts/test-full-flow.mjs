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

// ── Step 1: Gemini enrichment ──────────────────────────────
console.log('\n① Calling /api/vocab/enrich with 3 test words...');
const res = await fetch('http://localhost:4000/api/vocab/enrich', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ words: ['allocate', 'sustainable', 'infrastructure'] }),
});

if (!res.ok) {
  console.error('❌ Enrich failed:', await res.text());
  process.exit(1);
}
const { data: enriched } = await res.json();
console.log(`   ✅ Gemini returned ${enriched.length} words`);
enriched.forEach((w) => console.log(`      • ${w.word} [${w.ipa_uk}] — ${w.primary_meaning_zh}`));

// ── Step 2: Save vocabulary_items ─────────────────────────
console.log('\n② Saving vocabulary_items...');
const items = enriched.map((e) => ({
  word: e.word.toLowerCase(),
  ipa_uk: e.ipa_uk,
  ipa_us: e.ipa_us,
  primary_meaning_zh: e.primary_meaning_zh,
  ner_label: e.ner_label,
  memory_tip: e.memory_tip,
  source_type: 'test',
}));
const { data: insertedItems, error: itemsErr } = await supabase
  .from('vocabulary_items')
  .upsert(items, { onConflict: 'word' })
  .select('id, word');
if (itemsErr) {
  console.error('❌', itemsErr.message);
  process.exit(1);
}
console.log(`   ✅ Upserted ${insertedItems.length} vocab items`);
const wordIdMap = new Map(insertedItems.map((r) => [r.word, r.id]));

// ── Step 3: Save senses ────────────────────────────────────
console.log('\n③ Saving vocabulary_senses...');
let senseCount = 0;
for (const e of enriched) {
  const vocabId = wordIdMap.get(e.word.toLowerCase());
  if (!vocabId || !e.senses?.length) continue;
  await supabase.from('vocabulary_senses').delete().eq('vocabulary_item_id', vocabId);
  const { error } = await supabase
    .from('vocabulary_senses')
    .insert(e.senses.map((s) => ({ vocabulary_item_id: vocabId, ...s })));
  if (error) {
    console.error('❌', error.message);
    process.exit(1);
  }
  senseCount += e.senses.length;
}
console.log(`   ✅ Inserted ${senseCount} senses`);

// ── Step 4: Save confused_words ───────────────────────────
console.log('\n④ Saving confused_words...');
let confCount = 0;
for (const e of enriched) {
  if (!e.confused_word) continue;
  const vocabId = wordIdMap.get(e.word.toLowerCase());
  if (!vocabId) continue;
  await supabase.from('confused_words').delete().eq('vocabulary_item_id', vocabId);
  await supabase.from('confused_words').insert({
    vocabulary_item_id: vocabId,
    confused_word: e.confused_word,
    difference_note_zh: e.confused_diff_zh,
  });
  confCount++;
}
console.log(`   ✅ Inserted ${confCount} confused word pairs`);

// ── Step 5: Create learning group ─────────────────────────
console.log('\n⑤ Creating learning_group...');
const { data: group, error: groupErr } = await supabase
  .from('learning_groups')
  .insert({ group_name: 'Test Group · flow-check', source_type: 'test' })
  .select('id')
  .single();
if (groupErr) {
  console.error('❌', groupErr.message);
  process.exit(1);
}
console.log(`   ✅ Group id: ${group.id}`);

// ── Step 6: Link words to group ───────────────────────────
console.log('\n⑥ Linking words to group...');
const groupWords = enriched
  .map((e, i) => ({
    learning_group_id: group.id,
    vocabulary_item_id: wordIdMap.get(e.word.toLowerCase()),
    sequence_no: i,
  }))
  .filter((r) => r.vocabulary_item_id);
const { error: linkErr } = await supabase.from('learning_group_words').insert(groupWords);
if (linkErr) {
  console.error('❌', linkErr.message);
  process.exit(1);
}
console.log(`   ✅ Linked ${groupWords.length} words`);

// ── Step 7: Seed review_states ────────────────────────────
console.log('\n⑦ Seeding review_states...');
const reviewRows = enriched
  .map((e) => ({
    vocabulary_item_id: wordIdMap.get(e.word.toLowerCase()),
    memory_state: 'new',
    interval_days: null,
    next_review_at: null,
  }))
  .filter((r) => r.vocabulary_item_id);
const { error: reviewErr } = await supabase
  .from('review_states')
  .upsert(reviewRows, { onConflict: 'user_id,vocabulary_item_id' });
if (reviewErr) {
  console.error('❌', reviewErr.message);
  process.exit(1);
}
console.log(`   ✅ Seeded ${reviewRows.length} review states (state: new)`);

// ── Step 8: Round3 dictation assessment via server ──────────────────
console.log('\n⑧ Posting Round3 dictation attempts...');
const attemptScenarios = [
  { word: 'allocate', wasCorrect: false, elapsedMs: 1800 },
  { word: 'sustainable', wasCorrect: true, elapsedMs: 8200 },
  { word: 'infrastructure', wasCorrect: true, elapsedMs: 2400 },
];

for (const scenario of attemptScenarios) {
  const reviewRes = await fetch('http://localhost:4000/api/review/attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vocabularyItemId: wordIdMap.get(scenario.word.toLowerCase()),
      learningGroupId: group.id,
      source: 'round3',
      wasCorrect: scenario.wasCorrect,
      elapsedMs: scenario.elapsedMs,
    }),
  });

  if (!reviewRes.ok) {
    console.error('❌ Review attempt failed:', await reviewRes.text());
    process.exit(1);
  }

  const { data } = await reviewRes.json();
  console.log(`   ✅ ${scenario.word} → ${data.memoryState} (${data.transition.result})`);
}

// ── Step 9: Read back to verify ───────────────────────────
console.log('\n⑨ Reading back from Supabase to verify...');
const { data: readBack } = await supabase
  .from('learning_group_words')
  .select('sequence_no, vocabulary_items(word, primary_meaning_zh)')
  .eq('learning_group_id', group.id)
  .order('sequence_no');
readBack.forEach((r) =>
  console.log(`   ${r.sequence_no + 1}. ${r.vocabulary_items.word} — ${r.vocabulary_items.primary_meaning_zh}`),
);

const { data: stateBack } = await supabase
  .from('review_states')
  .select('memory_state, next_review_at, vocabulary_items(word)')
  .in('vocabulary_item_id', [...wordIdMap.values()]);
stateBack.forEach((r) =>
  console.log(`   • ${r.vocabulary_items.word}: ${r.memory_state} → ${r.next_review_at ?? 'graduated/new'}`),
);

console.log('\n✅ Full flow complete. All systems operational.\n');
