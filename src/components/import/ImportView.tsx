import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { duration, ease, staggerDelay } from '../../lib/motion';
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, Check, Loader2, PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { invalidateLibraryCache } from '../../lib/libraryCache';
import {
  fetchVocabularyEntriesByWords,
  persistEnrichedVocabularyEntries,
  saveToUserSavedWords,
} from '../../lib/importFlow';
import { useAuth } from '../../contexts/AuthContext';
import { EnrichedWord } from '../../types';
import {
  analyzeWordBatch,
  collapseCanonicalWordBatch,
  formatDuplicateWordsMessage,
  normalizeWordKey,
} from '../../../shared/wordBatch';

type Stage = 'input' | 'loading' | 'preview' | 'saving' | 'error';
type LoadingStep = 'lemmatizing' | 'fetching' | 'enriching' | 'merging';

const MANUAL_BATCH_SIZE = 30;
const MANUAL_DRAFT_KEY = 'manual_vocab_import_draft';

const LOADING_STEP_COPY: Record<LoadingStep, { title: string; detail: string }> = {
  lemmatizing: {
    title: '正在还原词形',
    detail: '将复数和不同时态归并为基础词形。',
  },
  fetching: {
    title: '正在检索已有词库',
    detail: '正在匹配已有词条。',
  },
  enriching: {
    title: '正在补充词条',
    detail: '正在生成缺失的释义、例句和构词信息。',
  },
  merging: {
    title: '正在整理预览',
    detail: '即将进入预览。',
  },
};

function splitWords(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

interface LiteVocabularyResult {
  word: string;
}

async function lemmatizeImportWords(words: string[], signal: AbortSignal): Promise<string[]> {
  const res = await apiFetch('/api/vocab/lemmatize-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words, source: 'import_lemmatize' }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const { data } = (await res.json()) as { data?: LiteVocabularyResult[] };
  const entries = words.map((word, index) => ({
    word,
    canonicalWord: normalizeWordKey(data?.[index]?.word ?? word) || normalizeWordKey(word),
  }));

  return collapseCanonicalWordBatch(entries).words;
}

function readManualDraft() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(MANUAL_DRAFT_KEY) ?? '';
}

function writeManualDraft(value: string) {
  if (typeof window === 'undefined') return;

  if (value.trim()) {
    window.localStorage.setItem(MANUAL_DRAFT_KEY, value);
    return;
  }

  window.localStorage.removeItem(MANUAL_DRAFT_KEY);
}

function formatRelationPreview(items: EnrichedWord['derived_words']) {
  if (items.length === 0) return '暂无';
  return items
    .slice(0, 2)
    .map((item) => item.word)
    .join('、');
}

function formatSynonymAntonymPreview(entry: EnrichedWord) {
  const synonyms = entry.synonyms.slice(0, 2).map((item) => item.word);
  const antonyms = entry.antonyms.slice(0, 2).map((item) => item.word);
  const parts = [
    synonyms.length > 0 ? `近义：${synonyms.join('、')}` : '',
    antonyms.length > 0 ? `反义：${antonyms.join('、')}` : '',
  ].filter(Boolean);

  return parts.join(' / ') || '暂无';
}

function formatConfusionPreview(entry: EnrichedWord) {
  if (entry.confusions.length === 0) return '暂无';
  return entry.confusions
    .slice(0, 2)
    .map((item) => item.word)
    .join('、');
}

export const ImportView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [raw, setRaw] = useState(readManualDraft);
  const [stage, setStage] = useState<Stage>('input');
  const [enriched, setEnriched] = useState<EnrichedWord[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('fetching');
  const [loadingMissingCount, setLoadingMissingCount] = useState(0);
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    writeManualDraft(raw);
  }, [raw]);

  useEffect(() => {
    if (stage !== 'loading') return;
    setLoadingElapsedSec(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setLoadingElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const parsedWords = splitWords(raw);
  const wordCount = parsedWords.length;

  const startEnrichment = async (words: string[]) => {
    if (words.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStage('loading');
    setLoadingStep('lemmatizing');
    setLoadingMissingCount(0);
    setErrorMsg('');
    setEnriched([]);

    try {
      const canonicalWords = await lemmatizeImportWords(words, controller.signal);
      if (controller.signal.aborted) return;

      // 1. 先从本地词库查找已经整理好的词条
      setLoadingStep('fetching');
      const { existing, missing } = await fetchVocabularyEntriesByWords(canonicalWords);
      if (controller.signal.aborted) return;
      let newlyEnriched: EnrichedWord[] = [];

      // 2. 只有缺失或者数据不完整的词才发给 AI 整理
      if (missing.length > 0) {
        setLoadingStep('enriching');
        setLoadingMissingCount(missing.length);
        const res = await apiFetch('/api/vocab/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: missing, source: 'import' }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const { data } = await res.json();
        newlyEnriched = data;
      }

      if (controller.signal.aborted) return;
      setLoadingStep('merging');

      // 3. 合并两部分结果，并尽量保持用户的输入顺序
      const wordMap = new Map<string, EnrichedWord>();
      for (const item of existing) {
        wordMap.set(normalizeWordKey(item.word), item);
      }
      for (const item of newlyEnriched) {
        wordMap.set(normalizeWordKey(item.word), item);
      }

      const combined: EnrichedWord[] = [];
      for (const word of canonicalWords) {
        const item = wordMap.get(normalizeWordKey(word));
        if (item) {
          combined.push(item);
        }
      }

      if (controller.signal.aborted) return;
      setEnriched(combined);
      setStage('preview');
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const handleCancelLoading = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage('input');
    setErrorMsg('');
  };

  const handleGenerate = async () => {
    if (wordCount > MANUAL_BATCH_SIZE) {
      setErrorMsg('单次最多导入 30 词，请分批导入。');
      setStage('error');
      return;
    }
    const batch = analyzeWordBatch(parsedWords);

    if (batch.words.length === 0) return;

    if (batch.duplicateWords.length > 0) {
      setErrorMsg(formatDuplicateWordsMessage(batch.duplicateWords));
      setStage('error');
      return;
    }

    await startEnrichment(batch.words);
  };

  const handleBackToInput = () => {
    setStage('input');
    setErrorMsg('');
  };

  const handleSaveToLibrary = async () => {
    if (!user) {
      setErrorMsg('请登录后保存单词。');
      setStage('error');
      return;
    }

    setStage('saving');
    try {
      const persistedEntries = await persistEnrichedVocabularyEntries(enriched, {
        sourceType: 'custom',
      });
      await saveToUserSavedWords(persistedEntries, user.id, 'import');
      invalidateLibraryCache(user.id);
      writeManualDraft('');
      setRaw('');
      navigate('/app/library');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setStage('error');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-2xl">
      <AnimatePresence mode="wait">
        {(stage === 'input' || stage === 'error') && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass rounded-apple-lg p-12 text-center jelly-shadow"
          >
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-gray-300">
              <PlusCircle className="h-7 w-7 text-gray-400" />
            </div>
            <h2 className="mb-2 text-2xl font-black">导入单词</h2>
            <p className="mb-6 text-sm text-text-secondary">
              使用英文逗号或换行分隔单词，每次最多导入 30 词。保存后可在个人词库中自选任意数量学习。
            </p>

            <textarea
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                setStage('input');
              }}
              className="mb-2 h-40 w-full resize-none rounded-2xl bg-apple-gray p-5 text-sm outline-none ring-apple-blue/30 focus:ring-2"
              aria-label="待导入的单词"
              placeholder="allocate, biodiversity, infrastructure, sustainable…"
            />

            <div className="mb-6 flex items-center justify-between px-1">
              <span className="text-xs text-text-secondary">当前识别到 {wordCount} 个词</span>
              {wordCount > MANUAL_BATCH_SIZE && (
                <span className="text-xs font-bold text-apple-red">单次最多导入 30 词，请分批导入</span>
              )}
            </div>

            {stage === 'error' && (
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-apple-red/10 p-3 text-left text-sm font-medium text-apple-red">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                void handleGenerate();
              }}
              disabled={wordCount === 0 || wordCount > MANUAL_BATCH_SIZE}
              className="w-full rounded-2xl bg-apple-blue py-4 font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              整理并预览
            </button>
          </motion.div>
        )}

        {stage === 'loading' &&
          (() => {
            const stepOrder: LoadingStep[] = ['lemmatizing', 'fetching', 'enriching', 'merging'];
            const currentStepIndex = stepOrder.indexOf(loadingStep);
            const activeCopy = LOADING_STEP_COPY[loadingStep];
            const activeTitle =
              loadingStep === 'enriching' && loadingMissingCount > 0
                ? `正在补齐 ${loadingMissingCount} 个新词`
                : activeCopy.title;

            return (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass flex flex-col items-center gap-6 rounded-apple-lg p-12 jelly-shadow"
              >
                <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
                <div className="text-center">
                  <p className="text-xl font-black">{activeTitle}</p>
                  <p className="mt-1 text-sm text-text-secondary">{activeCopy.detail}</p>
                  <p className="mt-2 text-xs text-text-secondary/70">已等待 {loadingElapsedSec} 秒</p>
                </div>

                <ol className="w-full max-w-sm space-y-2 text-left">
                  {stepOrder.map((step, index) => {
                    const copy = LOADING_STEP_COPY[step];
                    const isDone = index < currentStepIndex;
                    const isActive = index === currentStepIndex;
                    return (
                      <li
                        key={step}
                        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                          isActive
                            ? 'border-apple-blue/40 bg-apple-blue/5'
                            : isDone
                              ? 'border-transparent bg-apple-gray/60 text-text-secondary'
                              : 'border-transparent bg-apple-gray/30 text-text-secondary/60'
                        }`}
                      >
                        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
                          {isDone ? (
                            <Check className="h-4 w-4 text-apple-blue" />
                          ) : isActive ? (
                            <Loader2 className="h-4 w-4 animate-spin text-apple-blue" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-current opacity-60" />
                          )}
                        </span>
                        <span className="text-sm font-bold">
                          {step === 'enriching' && loadingMissingCount > 0 && (isActive || isDone)
                            ? `正在补齐 ${loadingMissingCount} 个新词`
                            : copy.title}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <button
                  type="button"
                  onClick={handleCancelLoading}
                  className="text-sm text-text-secondary underline-offset-4 transition-colors hover:text-text-primary hover:underline"
                >
                  取消并返回
                </button>
              </motion.div>
            );
          })()}

        {stage === 'preview' && (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-2xl font-black">词条预览</h2>
              <button
                type="button"
                onClick={handleBackToInput}
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                返回修改
              </button>
            </div>

            <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
              {enriched.map((entry, index) => (
                <motion.div
                  key={`${entry.word}-${index}`}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: duration.base, ease: ease.out, delay: staggerDelay(index, 0.04) }}
                  className="glass flex items-start justify-between gap-4 rounded-2xl px-6 py-4 jelly-shadow"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="text-lg font-black">{entry.word}</span>
                      <span className="text-xs font-mono text-apple-blue">{entry.ipa_uk}</span>
                      {entry.senses[0] && (
                        <span className="rounded-full bg-apple-gray px-2 py-0.5 text-xs font-bold uppercase text-text-secondary">
                          {entry.senses[0].pos}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-text-secondary">{entry.primary_meaning_zh}</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                          构词拆解
                        </p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">
                          {entry.morphology.summary_zh || '暂无'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">派生词</p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">
                          {formatRelationPreview(entry.derived_words)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                          近义 / 反义
                        </p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">{formatSynonymAntonymPreview(entry)}</p>
                      </div>
                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                          易混提示
                        </p>
                        <p className="mt-1 text-xs leading-5 text-text-primary">{formatConfusionPreview(entry)}</p>
                      </div>
                    </div>
                  </div>
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-apple-green" />
                </motion.div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                void handleSaveToLibrary();
              }}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-apple-blue py-5 text-lg font-black text-white transition-all hover:scale-[1.01] active:scale-[0.99] jelly-shadow"
            >
              <BookOpen className="h-5 w-5" />
              保存到个人词库
              <ArrowRight className="h-5 w-5" />
            </button>
          </motion.div>
        )}

        {stage === 'saving' && (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass flex flex-col items-center gap-6 rounded-apple-lg p-16 jelly-shadow"
          >
            <Loader2 className="h-10 w-10 animate-spin text-apple-green" />
            <p className="text-xl font-black">正在保存到个人词库…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
