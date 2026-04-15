import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, BookOpen, Clock3, Loader2, Sparkles, X } from 'lucide-react';
import { MemoryState, ReviewResultType } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface LibraryWordRow {
  memory_state: MemoryState;
  next_review_at: string | null;
  last_result: ReviewResultType | null;
  last_assessed_at: string | null;
  vocabulary_items: {
    id: string;
    word: string;
    ipa_uk: string | null;
    primary_meaning_zh: string | null;
    memory_tip: string | null;
    created_at: string;
    vocabulary_senses: {
      pos: string | null;
      example_sentence: string | null;
      example_translation_zh: string | null;
    }[];
    confused_words: {
      confused_word: string | null;
      difference_note_zh: string | null;
    }[];
  } | {
    id: string;
    word: string;
    ipa_uk: string | null;
    primary_meaning_zh: string | null;
    memory_tip: string | null;
    created_at: string;
    vocabulary_senses: {
      pos: string | null;
      example_sentence: string | null;
      example_translation_zh: string | null;
    }[];
    confused_words: {
      confused_word: string | null;
      difference_note_zh: string | null;
    }[];
  }[];
}

interface LibraryWord {
  id: string;
  word: string;
  phonetic: string;
  meaning: string;
  memoryTip: string;
  posTags: string[];
  examples: { sentence: string; translation: string }[];
  confusingWord: string | null;
  confusingDiff: string | null;
  memoryState: MemoryState;
  nextReviewAt: string | null;
  lastResult: ReviewResultType | null;
}

const memoryStateLabel: Record<MemoryState, string> = {
  new: '新词',
  fuzzy: '模糊',
  slow_recall: '慢回忆',
  stable_recall: '稳回忆',
  mastered: '掌握',
};

const memoryStateStyle: Record<MemoryState, string> = {
  new: 'bg-black/5 text-text-secondary',
  fuzzy: 'bg-apple-red/10 text-apple-red',
  slow_recall: 'bg-apple-orange/10 text-apple-orange',
  stable_recall: 'bg-apple-blue/10 text-apple-blue',
  mastered: 'bg-apple-green/10 text-apple-green',
};

const lastResultLabel: Record<ReviewResultType, string> = {
  wrong: '最近一次答错',
  slow_correct: '最近一次慢正确',
  fast_correct: '最近一次快正确',
};

function formatDateTime(value: string | null): string {
  if (!value) return '未安排';
  return new Date(value).toLocaleString();
}

export const LibraryView = () => {
  const { user } = useAuth();
  const [words, setWords] = useState<LibraryWord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;

    const loadLibrary = async () => {
      if (!user) {
        setWords([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setErrorMsg('');

        const { data, error } = await supabase
          .from('review_states')
          .select(`
            memory_state,
            next_review_at,
            last_result,
            last_assessed_at,
            vocabulary_items!inner (
              id,
              word,
              ipa_uk,
              primary_meaning_zh,
              memory_tip,
              created_at,
              vocabulary_senses (
                pos,
                example_sentence,
                example_translation_zh
              ),
              confused_words (
                confused_word,
                difference_note_zh
              )
            )
          `)
          .eq('user_id', user.id)
          .order('last_assessed_at', { ascending: false });

        if (error) throw error;
        if (!active) return;

        const mapped = ((data ?? []) as LibraryWordRow[]).map((row) => {
          const vocabularyItem = Array.isArray(row.vocabulary_items)
            ? row.vocabulary_items[0]
            : row.vocabulary_items;
          const confused = vocabularyItem?.confused_words[0];

          return {
            id: vocabularyItem?.id ?? '',
            word: vocabularyItem?.word ?? '',
            phonetic: vocabularyItem?.ipa_uk ?? '',
            meaning: vocabularyItem?.primary_meaning_zh ?? '',
            memoryTip: vocabularyItem?.memory_tip ?? '',
            posTags: (vocabularyItem?.vocabulary_senses ?? []).map((sense) => sense.pos ?? '').filter(Boolean),
            examples: (vocabularyItem?.vocabulary_senses ?? [])
              .map((sense) => ({
                sentence: sense.example_sentence ?? '',
                translation: sense.example_translation_zh ?? '',
              }))
              .filter((example) => example.sentence),
            confusingWord: confused?.confused_word ?? null,
            confusingDiff: confused?.difference_note_zh ?? null,
            memoryState: row.memory_state,
            nextReviewAt: row.next_review_at,
            lastResult: row.last_result,
          };
        });

        setWords(mapped);
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : (error as { message?: string })?.message ?? JSON.stringify(error);
        setErrorMsg(msg);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadLibrary();
    return () => { active = false; };
  }, [user]);

  const selectedWord = useMemo(
    () => words.find((word) => word.id === selectedId) ?? null,
    [selectedId, words],
  );

  if (isLoading) {
    return (
      <div className="glass rounded-apple-lg p-16 flex flex-col items-center gap-6">
        <Loader2 className="w-10 h-10 text-apple-blue animate-spin" />
        <p className="font-black text-xl">正在读取你的词库</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="glass rounded-apple-lg p-12 flex items-start gap-3 text-apple-red">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">词库读取失败</p>
          <p className="text-sm mt-1">{errorMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">词库明细</p>
            <h2 className="text-3xl font-black mt-2">你的追踪词库</h2>
          </div>
          <div className="glass rounded-2xl px-4 py-2 text-sm font-bold text-text-secondary">
            {words.length} 个词
          </div>
        </div>

        {words.length === 0 ? (
          <div className="glass rounded-apple-lg p-12 text-center">
            <BookOpen className="w-10 h-10 mx-auto text-text-secondary/50" />
            <p className="mt-4 text-xl font-black">你还没有自己的词库</p>
            <p className="mt-2 text-sm text-text-secondary">先导入一组词，系统才会开始记录你的长期复习状态。</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            {words.map((word, index) => (
              <motion.button
                key={word.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                type="button"
                onClick={() => setSelectedId(word.id)}
                className="glass rounded-apple-lg p-6 text-left jelly-shadow hover:scale-[1.01] active:scale-[0.99] transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-baseline gap-3">
                      <h3 className="text-2xl font-black">{word.word}</h3>
                      <span className="text-xs font-mono text-apple-blue">{word.phonetic}</span>
                    </div>
                    <p className="mt-2 text-sm text-text-secondary">{word.meaning || '暂无释义'}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${memoryStateStyle[word.memoryState]}`}>
                    {memoryStateLabel[word.memoryState]}
                  </span>
                </div>

                <div className="mt-5 flex items-center justify-between text-xs text-text-secondary">
                  <span>{word.posTags.slice(0, 2).join(' · ') || '暂无词性'}</span>
                  <span>{formatDateTime(word.nextReviewAt)}</span>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedWord && (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedId(null)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            />
            <motion.aside
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              className="fixed right-6 top-6 bottom-6 w-[420px] z-50 glass rounded-apple-lg p-8 overflow-y-auto jelly-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">单词状态</p>
                  <h3 className="mt-2 text-3xl font-black">{selectedWord.word}</h3>
                  <p className="mt-2 text-sm font-mono text-apple-blue">{selectedWord.phonetic}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${memoryStateStyle[selectedWord.memoryState]}`}>
                  {memoryStateLabel[selectedWord.memoryState]}
                </span>
                {selectedWord.posTags.map((tag) => (
                  <span key={tag} className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold uppercase tracking-widest text-text-secondary">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-8 space-y-6">
                <section className="glass rounded-2xl p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">释义</p>
                  <p className="mt-3 text-lg font-bold text-text-primary">{selectedWord.meaning || '暂无释义'}</p>
                </section>

                <section className="glass rounded-2xl p-5">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Clock3 className="w-4 h-4" />
                    <p className="text-xs font-bold uppercase tracking-widest">复习时间</p>
                  </div>
                  <p className="mt-3 text-sm text-text-primary">下次复习：{formatDateTime(selectedWord.nextReviewAt)}</p>
                  {selectedWord.lastResult && (
                    <p className="mt-2 text-sm text-text-secondary">{lastResultLabel[selectedWord.lastResult]}</p>
                  )}
                </section>

                {selectedWord.examples.length > 0 && (
                  <section className="glass rounded-2xl p-5">
                    <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">例句</p>
                    <div className="mt-3 space-y-4">
                      {selectedWord.examples.slice(0, 3).map((example, index) => (
                        <div key={`${selectedWord.id}-detail-example-${index}`}>
                          <p className="text-sm leading-6 text-text-primary">{example.sentence}</p>
                          {example.translation && (
                            <p className="mt-1 text-xs leading-5 text-text-secondary">{example.translation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {selectedWord.confusingWord && (
                  <section className="glass rounded-2xl p-5">
                    <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">易混词</p>
                    <p className="mt-3 text-lg font-bold text-text-primary">{selectedWord.confusingWord}</p>
                    {selectedWord.confusingDiff && (
                      <p className="mt-2 text-sm leading-6 text-text-secondary">{selectedWord.confusingDiff}</p>
                    )}
                  </section>
                )}

                {selectedWord.memoryTip && (
                  <section className="glass rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-text-secondary">
                      <Sparkles className="w-4 h-4" />
                      <p className="text-xs font-bold uppercase tracking-widest">记忆提示</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-text-primary">{selectedWord.memoryTip}</p>
                  </section>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
