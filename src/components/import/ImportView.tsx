import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PlusCircle, Loader2, CheckCircle2, AlertCircle, ArrowRight, BookOpen } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { EnrichedWord, toWord, Word } from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface ImportViewProps {
  onStartLearning: (words: Word[], groupId: string) => void;
}

type Stage = 'input' | 'loading' | 'preview' | 'saving' | 'audio' | 'error';

function parseWords(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map(w => w.trim())
    .filter(Boolean)
    .slice(0, 30);
}

async function saveToSupabase(
  enriched: EnrichedWord[],
  userId: string,
): Promise<{ groupId: string; words: Word[] }> {
  // 1. Upsert vocabulary_items
  const items = enriched.map(e => ({
    word: e.word.toLowerCase(),
    ipa_uk: e.ipa_uk,
    ipa_us: e.ipa_us,
    primary_meaning_zh: e.primary_meaning_zh,
    ner_label: e.ner_label,
    memory_tip: e.memory_tip,
    source_type: 'custom',
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from('vocabulary_items')
    .upsert(items, { onConflict: 'word' })
    .select('id, word');

  if (itemsError) throw new Error(`vocabulary_items: ${itemsError.message}`);

  const wordIdMap = new Map(insertedItems!.map((r: { id: string; word: string }) => [r.word, r.id]));

  // 2. Insert senses + confused_words in parallel (one Promise per word)
  await Promise.all(enriched.map(async (e) => {
    const vocabId = wordIdMap.get(e.word.toLowerCase());
    if (!vocabId) return;

    await supabase.from('vocabulary_senses').delete().eq('vocabulary_item_id', vocabId);
    if (e.senses.length > 0) {
      const { error } = await supabase.from('vocabulary_senses').insert(
        e.senses.map(s => ({ vocabulary_item_id: vocabId, ...s }))
      );
      if (error) throw new Error(`senses [${e.word}]: ${error.message}`);
    }

    if (e.confused_word) {
      await supabase.from('confused_words').delete().eq('vocabulary_item_id', vocabId);
      const { error } = await supabase.from('confused_words').insert({
        vocabulary_item_id: vocabId,
        confused_word: e.confused_word,
        difference_note_zh: e.confused_diff_zh,
      });
      if (error) throw new Error(`confused_words [${e.word}]: ${error.message}`);
    }
  }));

  // 3. Create learning group
  const { data: group, error: groupError } = await supabase
    .from('learning_groups')
    .insert({
      user_id: userId,
      group_name: `Custom · ${new Date().toLocaleDateString()}`,
      source_type: 'custom',
    })
    .select('id')
    .single();

  if (groupError) throw new Error(`learning_groups: ${groupError.message}`);

  // 4. Link words to group
  const groupWords = enriched.map((e, i) => ({
    learning_group_id: group.id,
    vocabulary_item_id: wordIdMap.get(e.word.toLowerCase()),
    sequence_no: i,
  })).filter(r => r.vocabulary_item_id);

  const { error: linkError } = await supabase.from('learning_group_words').insert(groupWords);
  if (linkError) throw new Error(`learning_group_words: ${linkError.message}`);

  // 5. Seed review_states for each word as unassessed new words
  const reviewRows = enriched.map(e => ({
    user_id: userId,
    vocabulary_item_id: wordIdMap.get(e.word.toLowerCase()),
    memory_state: 'new',
    interval_days: null,
    next_review_at: null,
    graduated_at: null,
  })).filter(r => r.vocabulary_item_id);

  const { error: reviewError } = await supabase
    .from('review_states')
    .upsert(reviewRows, { onConflict: 'user_id,vocabulary_item_id' });

  if (reviewError) throw new Error(`review_states: ${reviewError.message}`);

  const persistedWords = enriched
    .map((word) => ({ ...word, id: wordIdMap.get(word.word.toLowerCase()) }))
    .filter((word): word is EnrichedWord & { id: string } => Boolean(word.id))
    .map(toWord);

  return { groupId: group.id as string, words: persistedWords };
}

export const ImportView = ({ onStartLearning }: ImportViewProps) => {
  const { user } = useAuth();
  const [raw, setRaw] = useState('');
  const [stage, setStage] = useState<Stage>('input');
  const [enriched, setEnriched] = useState<EnrichedWord[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const wordCount = parseWords(raw).length;

  const handleGenerate = async () => {
    const words = parseWords(raw);
    if (words.length === 0) return;

    setStage('loading');
    setErrorMsg('');

    try {
      const res = await apiFetch('/api/vocab/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const { data } = await res.json();
      setEnriched(data);
      setStage('preview');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  const handleStartLearning = async () => {
    if (!user) {
      setErrorMsg('请先登录，再创建新的学习组。');
      setStage('error');
      return;
    }

    setStage('saving');
    try {
      const result = await saveToSupabase(enriched, user.id);

      // Generate UK + US audio for all words (errors silently ignored — audio is non-blocking)
      setStage('audio');
      let audioMap: Record<string, { uk_url: string; us_url: string }> = {};
      try {
        const res = await apiFetch('/api/audio/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: result.words.map(w => w.word) }),
          requiresAuth: false,
        });
        if (res.ok) {
          const { data } = await res.json();
          audioMap = data ?? {};
        }
      } catch {
        // Audio failure must never block learning
      }

      const wordsWithAudio = result.words.map(w => ({
        ...w,
        audio_uk_url: audioMap[w.word.toLowerCase()]?.uk_url ?? null,
        audio_us_url: audioMap[w.word.toLowerCase()]?.us_url ?? null,
      }));

      onStartLearning(wordsWithAudio, result.groupId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto"
    >
      <AnimatePresence mode="wait">

        {/* ── Input stage ── */}
        {(stage === 'input' || stage === 'error') && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass p-12 rounded-apple-lg jelly-shadow text-center"
          >
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center mx-auto mb-6">
              <PlusCircle className="w-7 h-7 text-gray-400" />
            </div>
            <h2 className="text-2xl font-black mb-2">导入一组新词</h2>
            <p className="text-text-secondary text-sm mb-6">
              把单词按逗号或换行贴进来，单次最多 30 个
            </p>

            <textarea
              value={raw}
              onChange={e => { setRaw(e.target.value); setStage('input'); }}
              className="w-full h-40 bg-apple-gray rounded-2xl p-5 mb-2 outline-none focus:ring-2 ring-apple-blue/30 text-sm resize-none"
              placeholder="allocate, biodiversity, infrastructure, sustainable…"
            />

            <div className="flex justify-between items-center mb-6 px-1">
              <span className="text-xs text-text-secondary">识别到 {wordCount} 个词</span>
              {wordCount > 30 && (
                <span className="text-xs text-apple-red font-bold">只会使用前 30 个</span>
              )}
            </div>

            {stage === 'error' && (
              <div className="flex items-start gap-2 bg-apple-red/10 text-apple-red text-sm font-medium rounded-xl p-3 mb-4 text-left">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={wordCount === 0}
              className="w-full py-4 bg-apple-blue text-white font-bold rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99] transition-all"
            >
              生成这一组学习词
            </button>
          </motion.div>
        )}

        {/* ── Loading stage ── */}
        {stage === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass p-16 rounded-apple-lg jelly-shadow flex flex-col items-center gap-6"
          >
            <Loader2 className="w-10 h-10 text-apple-blue animate-spin" />
            <div className="text-center">
              <p className="font-black text-xl">正在用 AI 整理这一组词…</p>
              <p className="text-text-secondary text-sm mt-1">
                正在补充 {parseWords(raw).length} 个词的音标、释义、例句和记忆提示
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Preview stage ── */}
        {stage === 'preview' && (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-2xl font-black">
                这 {enriched.length} 个词已经准备好了
              </h2>
              <button
                onClick={() => setStage('input')}
                className="text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                ← 返回修改
              </button>
            </div>

            <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
              {enriched.map((w, i) => (
                <motion.div
                  key={w.word}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="glass px-6 py-4 rounded-2xl jelly-shadow flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="font-black text-lg">{w.word}</span>
                      <span className="text-xs text-apple-blue font-mono">{w.ipa_uk}</span>
                      {w.senses[0] && (
                        <span className="text-xs bg-apple-gray px-2 py-0.5 rounded-full text-text-secondary font-bold uppercase">
                          {w.senses[0].pos}
                        </span>
                      )}
                    </div>
                    <p className="text-text-secondary text-sm mt-1 truncate">{w.primary_meaning_zh}</p>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-apple-green flex-shrink-0 mt-0.5" />
                </motion.div>
              ))}
            </div>

            <button
              onClick={handleStartLearning}
              className="w-full py-5 bg-apple-blue text-white font-black text-lg rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.01] active:scale-[0.99] transition-all jelly-shadow"
            >
              <BookOpen className="w-5 h-5" />
              开始这一轮学习
              <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* ── Saving stage ── */}
        {stage === 'saving' && (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass p-16 rounded-apple-lg jelly-shadow flex flex-col items-center gap-6"
          >
            <Loader2 className="w-10 h-10 text-apple-green animate-spin" />
            <p className="font-black text-xl">正在写入你的词库…</p>
          </motion.div>
        )}

        {/* ── Audio generation stage ── */}
        {stage === 'audio' && (
          <motion.div
            key="audio"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass p-16 rounded-apple-lg jelly-shadow flex flex-col items-center gap-6"
          >
            <Loader2 className="w-10 h-10 text-apple-blue animate-spin" />
            <div className="text-center">
              <p className="font-black text-xl">正在补齐发音音频…</p>
              <p className="text-text-secondary text-sm mt-1">为每个词生成英音和美音，失败也不会阻塞学习</p>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </motion.div>
  );
};
