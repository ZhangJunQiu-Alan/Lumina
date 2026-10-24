import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { duration, ease, staggerDelay } from '../../lib/motion';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { MemoryState, Word } from '../../types';
import { createLearningGroupFromVocabularyEntries, fetchPersistedVocabularyEntriesByIds } from '../../lib/importFlow';
import {
  deleteSavedWord,
  fetchActiveLearningGroupWordIds,
  fetchSavedWords,
  type SavedWordEntry,
} from '../../lib/libraryApi';
import {
  getCachedSavedWords,
  invalidateLibraryCache,
  isLibraryCacheFresh,
  refreshSavedWords,
  removeSavedWordFromCache,
} from '../../lib/libraryCache';
import { AI_CONTENT_FEATURES_ENABLED } from '../../lib/aiFeatures';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { cancelBrowserSpeech, speakTextViaBrowser } from '../../lib/browserSpeech';
import { fetchWordAudioUrl } from '../../lib/wordAudio';

interface SavedWordsPanelProps {
  userId: string;
  nextGroupNumber: number;
  onStartLearningGroup: (groupId: string, words?: Word[]) => Promise<void> | void;
  onLibraryMutated?: () => void | Promise<void>;
  showHeader?: boolean;
}

const PAGE_SIZE = 12;

const memoryStateLabel: Record<MemoryState, string> = {
  new: '新词',
  fuzzy: '待巩固',
  slow_recall: '回忆较慢',
  stable_recall: '回忆稳定',
  mastered: '已掌握',
};

const memoryStateStyle: Record<MemoryState, string> = {
  new: 'bg-black/5 text-text-secondary',
  fuzzy: 'bg-apple-red/10 text-apple-red',
  slow_recall: 'bg-apple-orange/10 text-apple-orange',
  stable_recall: 'bg-apple-blue/10 text-apple-blue',
  mastered: 'bg-apple-green/10 text-apple-green',
};

const sourceLabel: Record<SavedWordEntry['source'], string> = {
  import: '导入',
  reading_popup: '阅读',
  manual: '手动',
  migration: '历史',
};

function formatSavedDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

function getSavedWordBadge(entry: SavedWordEntry) {
  return {
    label: memoryStateLabel[entry.memoryState],
    className: memoryStateStyle[entry.memoryState],
  };
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

export function SavedWordsPanel({
  userId,
  nextGroupNumber,
  onStartLearningGroup,
  onLibraryMutated,
  showHeader = true,
}: SavedWordsPanelProps) {
  const [savedWords, setSavedWords] = useState<SavedWordEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [deletingWordId, setDeletingWordId] = useState<string | null>(null);
  const [isClearingMastered, setIsClearingMastered] = useState(false);
  const [confirmingClearMastered, setConfirmingClearMastered] = useState(false);
  const { preferences } = useLearningPreferences();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRunRef = useRef(0);
  const [playingWordId, setPlayingWordId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState('');

  const stopAudio = useCallback(() => {
    playbackRunRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    cancelBrowserSpeech();
  }, []);

  useEffect(() => {
    setPlayingWordId(null);
    setAudioError('');
    return stopAudio;
  }, [stopAudio, userId, preferences.defaultPronunciationLocale]);

  const handlePlayWord = async (entry: SavedWordEntry) => {
    stopAudio();
    setAudioError('');
    if (playingWordId === entry.vocabularyItemId) {
      setPlayingWordId(null);
      return;
    }

    const runId = playbackRunRef.current;
    const isCurrent = () => playbackRunRef.current === runId;
    setPlayingWordId(entry.vocabularyItemId);
    const fallback = async () => {
      if (!isCurrent()) return;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      const played = await speakTextViaBrowser(entry.word, preferences.defaultPronunciationLocale).catch(() => false);
      if (!isCurrent()) return;
      setPlayingWordId(null);
      if (!played) setAudioError(`无法播放 ${entry.word} 的发音，请稍后重试。`);
    };

    try {
      const url = await fetchWordAudioUrl(entry.word, preferences.defaultPronunciationLocale);
      if (!isCurrent()) return;
      if (!url) {
        await fallback();
        return;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      let settled = false;
      const fail = () => {
        if (settled || !isCurrent()) return;
        settled = true;
        void fallback();
      };
      audio.onended = () => {
        if (settled || !isCurrent()) return;
        settled = true;
        audioRef.current = null;
        setPlayingWordId(null);
      };
      audio.onerror = fail;
      await audio.play().catch(fail);
    } catch {
      await fallback();
    }
  };

  useEffect(() => {
    let active = true;
    const cached = getCachedSavedWords(userId);

    if (cached) {
      setSavedWords(cached.data);
      setIsLoading(false);
      setErrorMsg('');
    } else {
      setIsLoading(true);
      setErrorMsg('');
    }

    const loadSavedWords = async () => {
      if (cached && isLibraryCacheFresh(cached)) return;

      try {
        const data = await refreshSavedWords(userId, () => fetchSavedWords(userId));
        if (!active) return;
        setSavedWords(data);
        setErrorMsg('');
      } catch (error) {
        if (!active) return;
        const msg = error instanceof Error ? error.message : String(error);
        if (!cached) {
          setErrorMsg(msg);
        } else {
          console.error('saved words refresh failed:', msg);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadSavedWords();

    return () => {
      active = false;
    };
  }, [userId]);

  const availableWords = useMemo(() => savedWords.filter((entry) => !entry.isInActiveLearningGroup), [savedWords]);
  const availableWordIds = useMemo(
    () => new Set(availableWords.map((entry) => entry.vocabularyItemId)),
    [availableWords],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => availableWordIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [availableWordIds]);

  const masteredWords = useMemo(() => savedWords.filter((entry) => entry.memoryState === 'mastered'), [savedWords]);
  const masteredCount = masteredWords.length;

  const filteredWords = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    if (!query) return savedWords;

    return savedWords.filter(
      (entry) => entry.word.toLowerCase().includes(query) || entry.meaning.toLowerCase().includes(query),
    );
  }, [savedWords, searchTerm]);

  const totalPages = Math.max(Math.ceil(filteredWords.length / PAGE_SIZE), 1);
  const clampedPage = Math.min(page, totalPages);
  const pageWords = useMemo(
    () => filteredWords.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [clampedPage, filteredWords],
  );
  const selectablePageIds = useMemo(
    () => pageWords.filter((entry) => !entry.isInActiveLearningGroup).map((entry) => entry.vocabularyItemId),
    [pageWords],
  );

  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const selectedCount = selectedIds.size;
  const manualCanStart = selectedCount > 0;
  const allSelectablePageWordsSelected =
    selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIds.has(id));
  const canTogglePageSelection = selectablePageIds.length > 0 && !isCreatingGroup;
  const pageSelectionLabel = allSelectablePageWordsSelected ? '取消本页' : '全选本页';

  const createGroupFromIds = useCallback(
    async (vocabularyItemIds: string[]) => {
      if (vocabularyItemIds.length === 0) {
        throw new Error('请选择至少 1 个单词。');
      }

      const activeWordIds = await fetchActiveLearningGroupWordIds(userId, { sourceType: 'custom' });
      const availableIds = vocabularyItemIds.filter((id) => !activeWordIds.has(id));
      if (availableIds.length !== vocabularyItemIds.length) {
        throw new Error('所选单词中有词已在学习，请刷新词库后重新选择。');
      }

      const entries = await fetchPersistedVocabularyEntriesByIds(availableIds);
      if (entries.length !== availableIds.length) {
        throw new Error('部分词条加载失败，请重试。');
      }

      const result = await createLearningGroupFromVocabularyEntries(userId, entries, {
        groupName: `个人词库 · 第 ${nextGroupNumber} 组 · ${entries.length} 词`,
        groupSourceType: 'custom',
      });

      invalidateLibraryCache(userId);

      try {
        await onLibraryMutated?.();
      } catch {
        // Stats refresh should not block starting the learning session.
      }

      await onStartLearningGroup(result.groupId, result.words);
    },
    [nextGroupNumber, onLibraryMutated, onStartLearningGroup, userId],
  );

  const handleStartManual = async () => {
    if (isCreatingGroup) return;
    if (!manualCanStart) {
      setErrorMsg('请选择至少 1 个单词。');
      return;
    }

    setIsCreatingGroup(true);
    stopAudio();
    setPlayingWordId(null);
    setErrorMsg('');
    try {
      await createGroupFromIds([...selectedIds]);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleToggleWord = (entry: SavedWordEntry) => {
    if (entry.isInActiveLearningGroup || isCreatingGroup) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entry.vocabularyItemId)) {
        next.delete(entry.vocabularyItemId);
      } else {
        next.add(entry.vocabularyItemId);
      }
      return next;
    });
  };

  const handleToggleCurrentPage = () => {
    if (isCreatingGroup || selectablePageIds.length === 0) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      const pageFullySelected = selectablePageIds.every((id) => next.has(id));

      if (pageFullySelected) {
        selectablePageIds.forEach((id) => next.delete(id));
        return next;
      }

      for (const id of selectablePageIds) {
        next.add(id);
      }

      return next;
    });
  };

  const handleClearMastered = async () => {
    if (masteredCount === 0) {
      setConfirmingClearMastered(false);
      return;
    }

    setIsClearingMastered(true);
    setErrorMsg('');

    const targets = masteredWords.map((entry) => entry.vocabularyItemId);
    const results = await Promise.allSettled(targets.map((id) => deleteSavedWord(id)));

    const removedIds: string[] = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        removedIds.push(targets[index]);
      } else {
        const reason = result.reason;
        failures.push(reason instanceof Error ? reason.message : String(reason));
      }
    });

    if (removedIds.length > 0) {
      const removedSet = new Set(removedIds);
      removedIds.forEach((id) => removeSavedWordFromCache(userId, id));
      setSavedWords((current) => current.filter((item) => !removedSet.has(item.vocabularyItemId)));
      setSelectedIds((current) => {
        if (![...current].some((id) => removedSet.has(id))) return current;
        return new Set([...current].filter((id) => !removedSet.has(id)));
      });
    }

    if (failures.length > 0) {
      setErrorMsg(`${failures.length} 个单词移除失败：${failures[0]}`);
    }

    setConfirmingClearMastered(false);
    setIsClearingMastered(false);
  };

  const handleDeleteWord = async (entry: SavedWordEntry) => {
    setDeletingWordId(entry.vocabularyItemId);
    setErrorMsg('');

    try {
      await deleteSavedWord(entry.vocabularyItemId);
      removeSavedWordFromCache(userId, entry.vocabularyItemId);
      setSavedWords((current) => current.filter((item) => item.vocabularyItemId !== entry.vocabularyItemId));
      setSelectedIds((current) => {
        if (!current.has(entry.vocabularyItemId)) return current;
        const next = new Set(current);
        next.delete(entry.vocabularyItemId);
        return next;
      });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingWordId(null);
    }
  };

  if (isLoading) {
    return (
      <section className="glass rounded-[32px] p-10 text-center jelly-shadow">
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-apple-blue" />
        <p className="mt-4 text-lg font-black text-text-primary">正在加载个人词库</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {showHeader && (
        <div className="fluid-toolbar items-start">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-apple-green/10 text-apple-green">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-text-primary">个人词库</h3>
              <p className="mt-2 text-sm leading-7 text-text-secondary">
                勾选要学习的单词，数量不限。点击词名播放发音。
              </p>
            </div>
          </div>

          <div className="text-center sm:min-w-32">
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-2xl font-black text-text-primary">{savedWords.length}</p>
              <p className="mt-1 text-[11px] font-bold text-text-secondary">总词数</p>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl bg-apple-red/10 px-4 py-3 text-sm font-medium text-apple-red"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {savedWords.length === 0 ? (
        <div className="glass fluid-empty rounded-[32px] text-center jelly-shadow">
          <BookOpen className="mx-auto h-10 w-10 text-text-secondary/50" />
          <p className="mt-4 text-2xl font-black text-text-primary">暂无收藏单词</p>
          <p className="mt-3 text-sm leading-7 text-text-secondary">
            阅读时可将生词加入个人词库，也可通过“导入单词”添加。
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="fluid-toolbar">
            <div className="inline-flex h-12 w-fit shrink-0 items-center rounded-[18px] bg-white px-4 text-text-primary shadow-[0_12px_28px_rgba(0,0,0,0.06)]">
              <span className="text-2xl font-black tracking-tight">{savedWords.length}</span>
              <span className="ml-2 text-xs font-bold text-text-secondary">个词</span>
            </div>

            <div className="saved-words-controls">
              <label className="flex h-12 min-w-0 items-center gap-2 rounded-[18px] bg-white px-4 text-sm text-text-secondary shadow-[0_12px_28px_rgba(0,0,0,0.05)]">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent font-medium text-text-primary outline-none placeholder:text-text-secondary/70"
                  placeholder="搜索单词或释义"
                  aria-label="搜索个人词库"
                />
              </label>

              <button
                type="button"
                onClick={handleToggleCurrentPage}
                disabled={!canTogglePageSelection}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[18px] bg-white px-4 text-sm font-black text-text-primary shadow-[0_12px_28px_rgba(0,0,0,0.05)] transition-colors hover:text-apple-blue disabled:cursor-not-allowed disabled:opacity-55 sm:min-w-[112px]"
                aria-label={allSelectablePageWordsSelected ? '取消选择本页单词' : '全选本页单词'}
              >
                <CheckCircle2 className="h-4 w-4" />
                {pageSelectionLabel}
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleStartManual();
                }}
                disabled={!manualCanStart || isCreatingGroup}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[18px] bg-apple-blue px-5 text-sm font-black text-white shadow-[0_18px_34px_rgba(25,200,185,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100 sm:min-w-[176px]"
              >
                {isCreatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {isCreatingGroup
                  ? '正在创建学习组…'
                  : manualCanStart
                    ? `开始学习（${selectedCount} 词）`
                    : '请选择单词'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            <p aria-live="polite">已选 {selectedCount} 词，可跨页选择。点击词名播放发音。</p>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={isCreatingGroup}
                className="min-h-11 px-2 font-bold text-apple-blue disabled:opacity-55"
              >
                清空选择
              </button>
            )}
          </div>
          {audioError && (
            <p role="alert" className="text-sm text-apple-red">
              {audioError}
            </p>
          )}

          {masteredCount > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-[24px] bg-apple-green/8 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 font-bold text-apple-green">
                <Sparkles className="h-4 w-4" />
                已掌握 {masteredCount} 个词，可以从词库移除
              </div>
              {confirmingClearMastered ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text-secondary">确认删除？</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingClearMastered(false)}
                    disabled={isClearingMastered}
                    className="inline-flex items-center justify-center rounded-full bg-white/82 px-3 py-1.5 text-xs font-black text-text-secondary shadow-sm transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleClearMastered();
                    }}
                    disabled={isClearingMastered}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-apple-red px-3 py-1.5 text-xs font-black text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isClearingMastered ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    确认删除 {masteredCount} 个
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClearMastered(true)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-white/82 px-3 py-1.5 text-xs font-black text-apple-green shadow-sm transition-colors hover:text-apple-green/80"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清理已掌握
                </button>
              )}
            </div>
          )}

          <div className="fluid-grid detail-card-grid">
            {pageWords.map((entry, index) => {
              const badge = getSavedWordBadge(entry);
              const selected = selectedIds.has(entry.vocabularyItemId);
              const disabledForSelection = entry.isInActiveLearningGroup;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: duration.base, ease: ease.out, delay: staggerDelay(index) }}
                  className={`rounded-[24px] border bg-white px-5 py-4 shadow-[0_14px_34px_rgba(0,0,0,0.05)] transition-[color,background-color,border-color,box-shadow,translate] ${
                    selected
                      ? 'border-apple-blue/45 ring-2 ring-apple-blue/15'
                      : 'border-white/80 hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(0,0,0,0.07)]'
                  }`}
                >
                  <div className="flex min-h-[126px] items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabledForSelection || isCreatingGroup}
                      onChange={() => handleToggleWord(entry)}
                      className="mt-1 h-6 w-6 shrink-0 accent-apple-blue disabled:cursor-not-allowed"
                      aria-label={`选择 ${entry.word}`}
                    />

                    <div className="min-w-0 flex-1 self-stretch">
                      <div className="flex min-h-full flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <h4 className="min-w-0 text-[1.35rem] font-black leading-tight tracking-tight text-text-primary">
                                <button
                                  type="button"
                                  onClick={() => void handlePlayWord(entry)}
                                  aria-label={`${playingWordId === entry.vocabularyItemId ? '停止' : '播放'} ${entry.word} 的${preferences.defaultPronunciationLocale === 'uk' ? '英式' : '美式'}发音`}
                                  aria-pressed={playingWordId === entry.vocabularyItemId}
                                  className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg text-left hover:text-apple-blue focus-visible:outline-2 focus-visible:outline-apple-blue"
                                >
                                  <span className="break-all">{entry.word}</span>
                                  <Volume2
                                    aria-hidden="true"
                                    className={`h-4 w-4 shrink-0 ${playingWordId === entry.vocabularyItemId ? 'text-apple-blue' : 'text-text-secondary'}`}
                                  />
                                </button>
                              </h4>
                              <span className="text-xs font-mono font-bold text-apple-blue">
                                {entry.phonetic || '暂无音标'}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-black leading-6 text-text-primary">
                              {entry.meaning || '暂无释义'}
                            </p>
                          </div>

                          <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${badge.className}`}>
                            {badge.label}
                          </span>

                          <button
                            type="button"
                            onClick={() => {
                              void handleDeleteWord(entry);
                            }}
                            disabled={Boolean(deletingWordId) || isCreatingGroup || isClearingMastered}
                            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[12px] border border-black/5 bg-white text-text-secondary shadow-[0_8px_18px_rgba(0,0,0,0.04)] transition-colors hover:text-apple-red disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`从词库移除 ${entry.word}`}
                          >
                            {deletingWordId === entry.vocabularyItemId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>

                        <div className="mt-4 flex flex-1 gap-3">
                          <div className="w-0.5 shrink-0 rounded-full bg-text-secondary/45" />
                          <p className="line-clamp-2 text-sm leading-6 text-text-secondary">
                            {entry.exampleSentence || '暂无例句。'}
                          </p>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-text-secondary">
                          <span>{sourceLabel[entry.source]}</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatSavedDate(entry.savedAt)}
                          </span>
                          {AI_CONTENT_FEATURES_ENABLED && entry.enrichmentLevel === 'lite' && (
                            <span className="rounded-full bg-apple-orange/10 px-2.5 py-0.5 text-[11px] font-bold text-apple-orange">
                              补全中
                            </span>
                          )}
                          {entry.isInActiveLearningGroup && (
                            <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-bold text-text-secondary">
                              学习中，暂不可选
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {pageWords.length === 0 && (
              <div className="rounded-[24px] bg-white px-6 py-10 text-center text-sm font-bold text-text-secondary shadow-[0_14px_34px_rgba(0,0,0,0.04)] xl:col-span-2">
                未找到匹配的单词，请尝试其他单词或释义。
              </div>
            )}
          </div>

          {filteredWords.length > PAGE_SIZE && (
            <div className="mt-5 flex items-center justify-between text-sm font-bold text-text-secondary">
              <span>
                {clampedPage} / {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  disabled={clampedPage === 1}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="上一页"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
                  disabled={clampedPage === totalPages}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="下一页"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
