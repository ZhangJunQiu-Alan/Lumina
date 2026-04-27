import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  BookMarked,
  Clock3,
  Loader2,
  CalendarDays,
  X,
  Volume2,
} from 'lucide-react';
import {
  LibraryGroupWord,
  MemoryState,
  ReviewResultType,
} from '../../types';
import { toConfusingPairs, toWordMorphology, toWordRelations } from '../../types';
import { ExampleSentenceList } from '../shared/ExampleSentenceList';
import {
  cancelBrowserSpeech,
  isBrowserSpeechSupported,
  speakTextViaBrowser,
} from '../../lib/browserSpeech';
import { fetchDifficultWords } from '../../lib/libraryApi';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { LibrarySkeleton } from '../shared/Skeleton';


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

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function mapDifficultWord(row: any): LibraryGroupWord | null {
  const vocabularyItem = asArray(row.vocabulary_items)[0];
  if (!vocabularyItem) return null;

  const relations = [...(vocabularyItem.vocabulary_relations ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
  const confusingPairs = toConfusingPairs(
    [...(vocabularyItem.confused_words ?? [])]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((item: any) => ({
        word: item.confused_word ?? '',
        difference_zh: item.difference_note_zh ?? '',
      })),
  ).filter((pair) => pair.word);
  const confusingWord = confusingPairs[0];

  const mapRelations = (type: 'derived' | 'synonym' | 'antonym'): any[] => (
    relations
      .filter((relation) => relation.relation_type === type)
      .map((relation) => ({
        word: relation.related_word ?? '',
        meaning_zh: relation.meaning_zh ?? '',
        note_zh: relation.note_zh ?? '',
      }))
      .filter((relation) => relation.word)
  );

  return {
    id: vocabularyItem.id,
    word: vocabularyItem.word,
    phonetic: vocabularyItem.ipa_uk ?? '',
    meaning: vocabularyItem.primary_meaning_zh ?? '',
    memoryTip: vocabularyItem.memory_tip ?? '',
    posTags: vocabularyItem.vocabulary_senses.map((sense: any) => sense.pos ?? '').filter(Boolean),
    examples: vocabularyItem.vocabulary_senses
      .map((sense: any) => ({
        sentence: sense.example_sentence ?? '',
        translation: sense.example_translation_zh ?? '',
      }))
      .filter((example: any) => example.sentence),
    morphology: toWordMorphology({
      summary_zh: vocabularyItem.morphology_summary_zh ?? '',
      parts: [...(vocabularyItem.vocabulary_morphology_parts ?? [])]
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((part: any) => ({
          text: part.part_text ?? '',
          kind: part.part_kind ?? 'root',
          meaning_zh: part.meaning_zh ?? '',
          note_zh: part.note_zh ?? '',
        })),
    }),
    derivedWords: toWordRelations(mapRelations('derived')),
    synonyms: toWordRelations(mapRelations('synonym')),
    antonyms: toWordRelations(mapRelations('antonym')),
    confusingPairs,
    confusingWord: confusingWord?.word ?? null,
    confusingDiff: confusingWord?.difference ?? null,
    memoryState: row.memory_state ?? 'new',
    nextReviewAt: row.next_review_at ?? null,
    lastResult: row.last_result ?? null,
    sequenceNo: 0,
    audioUkUrl: vocabularyItem.audio_uk_url,
    audioUsUrl: vocabularyItem.audio_us_url,
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '未安排';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotebookView() {
  const { user } = useAuth();
  const { preferences } = useLearningPreferences();
  const [words, setWords] = useState<LibraryGroupWord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [expandedWordId, setExpandedWordId] = useState<string | null>(null);

  // Playback state for example sentences
  const [activeExampleKey, setActiveExampleKey] = useState<string | null>(null);
  const playbackRunIdRef = useRef(0);
  const canPlayExampleAudio = useMemo(() => isBrowserSpeechSupported(), []);

  const stopPlayback = useCallback(() => {
    playbackRunIdRef.current += 1;
    cancelBrowserSpeech();
    setActiveExampleKey(null);
  }, []);

  const playExampleSentence = useCallback(async (sentence: string, key: string) => {
    if (!canPlayExampleAudio) return;

    if (activeExampleKey === key) {
      stopPlayback();
      return;
    }

    stopPlayback();
    const runId = playbackRunIdRef.current;
    setActiveExampleKey(key);
    await speakTextViaBrowser(sentence, preferences.defaultPronunciationLocale);

    if (runId === playbackRunIdRef.current) {
      setActiveExampleKey(null);
    }
  }, [activeExampleKey, canPlayExampleAudio, preferences.defaultPronunciationLocale, stopPlayback]);

  useEffect(() => () => {
    stopPlayback();
  }, [stopPlayback]);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const data = await fetchDifficultWords(user.id);
      const mapped = (data ?? []).map(mapDifficultWord).filter((w): w is LibraryGroupWord => w !== null);
      setWords(mapped);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handlePlayAudio = (word: LibraryGroupWord) => {
    const locale = preferences.defaultPronunciationLocale;
    const url = locale === 'us'
      ? (word.audioUsUrl || word.audioUkUrl)
      : (word.audioUkUrl || word.audioUsUrl);

    if (url) {
      const audio = new Audio(url);
      void audio.play().catch((error) => {
        console.error('Failed to play database audio:', error);
        void speakTextViaBrowser(word.word, locale);
      });
    } else {
      void speakTextViaBrowser(word.word, locale);
    }
  };

  if (isLoading) {
    return <LibrarySkeleton />;
  }

  if (errorMsg) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-apple-red/10 text-apple-red">
          <AlertCircle className="h-8 w-8" />
        </div>
        <div className="space-y-1">
          <p className="text-xl font-black text-text-primary">加载生词本失败</p>
          <p className="text-sm text-text-secondary">{errorMsg}</p>
        </div>
        <button
          onClick={() => { void loadData(); }}
          className="mt-2 rounded-2xl bg-apple-blue px-6 py-3 text-sm font-bold text-white shadow-lg shadow-apple-blue/20 transition-transform active:scale-95"
        >
          重试一下
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-10">
      <header className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-apple-red/10 text-apple-red">
            <BookMarked className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-text-primary">生词本</h1>
            <p className="mt-2 text-sm leading-7 text-text-secondary max-w-2xl">
              这里记录了你学习过、但还没进入稳定记忆阶段的词。
              系统会自动按照复习时间排序，帮你集中攻克这些难点。
            </p>
          </div>
        </div>
        {words.length > 0 && (
          <div className="inline-flex items-center gap-2 rounded-2xl bg-black/5 px-4 py-2 text-sm font-bold text-text-secondary">
            共 {words.length} 个生词
          </div>
        )}
      </header>

      {words.length === 0 ? (
        <div className="glass rounded-[40px] p-20 text-center jelly-shadow">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-apple-green/10 text-apple-green">
            <BookMarked className="h-10 w-10" />
          </div>
          <h2 className="mt-8 text-2xl font-black text-text-primary">生词本是空的</h2>
          <p className="mt-4 text-sm leading-7 text-text-secondary max-w-md mx-auto">
            太棒了！你目前所有的词都已经达到稳定状态，或者你还没有开始学习新的词库。
          </p>
        </div>
      ) : (
        <div className="space-y-4 pb-20">
          {words.map((word) => {
            const isExpanded = expandedWordId === word.id;
            return (
              <motion.div
                key={word.id}
                layout
                className={`group relative overflow-hidden rounded-[28px] border transition-all duration-500 ${
                  isExpanded
                    ? 'border-apple-blue/20 bg-white shadow-[0_32px_64px_rgba(0,0,0,0.08)]'
                    : 'border-white/60 bg-white/60 hover:border-apple-blue/20 hover:bg-white hover:shadow-[0_20px_40px_rgba(0,0,0,0.04)]'
                }`}
              >
                <div
                  className="flex cursor-pointer items-center justify-between p-5 sm:p-6"
                  onClick={() => setExpandedWordId(isExpanded ? null : word.id)}
                >
                  <div className="flex flex-1 items-center gap-4 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-black text-text-primary group-hover:text-apple-blue transition-colors">
                          {word.word}
                        </h3>
                        <span className="text-sm font-medium text-text-secondary font-mono opacity-60">
                          {word.phonetic}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAudio(word);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-apple-blue/10 hover:text-apple-blue transition-all"
                        >
                          <Volume2 className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-1 truncate text-sm text-text-secondary font-medium">
                        {word.meaning}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider ${memoryStateStyle[word.memoryState]}`}>
                      {memoryStateLabel[word.memoryState]}
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold text-text-secondary">
                      <Clock3 className="h-3 w-3" />
                      {formatDateTime(word.nextReviewAt)}
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                    >
                      <div className="border-t border-black/5 p-6 sm:p-8 space-y-8">
                        {word.memoryTip && (
                          <div className="rounded-2xl bg-apple-blue/5 p-4">
                            <p className="text-xs font-bold uppercase tracking-widest text-apple-blue mb-2">记忆锦囊</p>
                            <p className="text-sm leading-relaxed text-text-primary font-medium">{word.memoryTip}</p>
                          </div>
                        )}

                        {word.examples.length > 0 && (
                          <div>
                            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-4">精选语境</p>
                            <ExampleSentenceList
                              items={word.examples.map((example, index) => ({
                                key: `${word.id}-example-${index}`,
                                sentence: example.sentence,
                                translation: example.translation,
                              }))}
                              locale={preferences.defaultPronunciationLocale}
                              activeExampleKey={activeExampleKey}
                              canPlayAudio={canPlayExampleAudio}
                              onPlayExample={({ sentence, key }) => { void playExampleSentence(sentence, key); }}
                              emptyMessage="目前还没有例句。"
                            />
                          </div>
                        )}

                        {(word.synonyms.length > 0 || word.antonyms.length > 0) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {word.synonyms.length > 0 && (
                              <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-3">近义关联</p>
                                <div className="flex flex-wrap gap-2">
                                  {word.synonyms.map((s, idx) => (
                                    <span key={idx} className="rounded-lg bg-black/5 px-2.5 py-1 text-xs font-bold text-text-primary">
                                      {s.word}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {word.antonyms.length > 0 && (
                              <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-3">反义对照</p>
                                <div className="flex flex-wrap gap-2">
                                  {word.antonyms.map((a, idx) => (
                                    <span key={idx} className="rounded-lg bg-black/5 px-2.5 py-1 text-xs font-bold text-text-primary">
                                      {a.word}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => setExpandedWordId(null)}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 text-text-secondary hover:bg-black/10 transition-colors"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
