import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
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
} from 'lucide-react';
import type { MemoryState, Word } from '../../types';
import {
  createLearningGroupFromVocabularyEntries,
  fetchPersistedVocabularyEntriesByIds,
} from '../../lib/importFlow';
import {
  cleanupSavedWords,
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

type StudyMode = 'sequential' | 'manual';

interface SavedWordsPanelProps {
  userId: string;
  nextGroupNumber: number;
  onStartLearningGroup: (groupId: string, words?: Word[]) => Promise<void> | void;
  onLibraryMutated?: () => void | Promise<void>;
  showHeader?: boolean;
}

const GROUP_SIZE = 30;
const PAGE_SIZE = 12;

const memoryStateLabel: Record<MemoryState, string> = {
  new: '新词',
  fuzzy: '模糊',
  slow_recall: '记忆中',
  stable_recall: '已记忆',
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
  const [studyMode, setStudyMode] = useState<StudyMode>('sequential');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [deletingWordId, setDeletingWordId] = useState<string | null>(null);
  const [isClearingMastered, setIsClearingMastered] = useState(false);
  const [confirmingClearMastered, setConfirmingClearMastered] = useState(false);

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
      let cleanupChanged = false;
      let cleanupErrorMsg = '';

      try {
        const cleanupResult = await cleanupSavedWords();
        if (!active) return;

        cleanupChanged = cleanupResult.removedSavedWords > 0
          || cleanupResult.createdReviewStates > 0
          || cleanupResult.deletedCustomGroups > 0;

        if (cleanupChanged) {
          invalidateLibraryCache(userId);
          try {
            await onLibraryMutated?.();
          } catch {
            // Stats refresh should not block saved-word cleanup.
          }
        }
      } catch (error) {
        cleanupErrorMsg = error instanceof Error ? error.message : String(error);
        if (cached) {
          console.error('saved words cleanup failed:', cleanupErrorMsg);
        }
      }

      if (cached && isLibraryCacheFresh(cached) && !cleanupChanged) {
        if (!active) return;
        if (!cleanupErrorMsg) setErrorMsg('');
        return;
      }

      try {
        const data = await refreshSavedWords(userId, () => fetchSavedWords(userId));
        if (!active) return;
        setSavedWords(data);
        setErrorMsg('');
      } catch (error) {
        if (!active) return;
        const msg = error instanceof Error ? error.message : String(error);
        if (!cached) {
          setErrorMsg(cleanupErrorMsg || msg);
        } else {
          console.error('saved words refresh failed:', msg);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadSavedWords();

    return () => { active = false; };
  }, [userId]);

  const availableWords = useMemo(
    () => savedWords.filter((entry) => !entry.isInActiveLearningGroup),
    [savedWords],
  );
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

  const masteredWords = useMemo(
    () => savedWords.filter((entry) => entry.memoryState === 'mastered'),
    [savedWords],
  );
  const masteredCount = masteredWords.length;

  const filteredWords = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    if (!query) return savedWords;

    return savedWords.filter((entry) => (
      entry.word.toLowerCase().includes(query)
      || entry.meaning.toLowerCase().includes(query)
    ));
  }, [savedWords, searchTerm]);

  const totalPages = Math.max(Math.ceil(filteredWords.length / PAGE_SIZE), 1);
  const clampedPage = Math.min(page, totalPages);
  const pageWords = useMemo(
    () => filteredWords.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [clampedPage, filteredWords],
  );
  const selectablePageIds = useMemo(
    () => pageWords
      .filter((entry) => !entry.isInActiveLearningGroup)
      .map((entry) => entry.vocabularyItemId),
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
  const sequentialCanStart = availableWords.length >= GROUP_SIZE;
  const manualCanStart = selectedCount === GROUP_SIZE;
  const allSelectablePageWordsSelected = selectablePageIds.length > 0
    && selectablePageIds.every((id) => selectedIds.has(id));
  const canTogglePageSelection = studyMode === 'manual'
    && selectablePageIds.length > 0
    && (allSelectablePageWordsSelected || selectedCount < GROUP_SIZE);
  const pageSelectionLabel = allSelectablePageWordsSelected ? '取消本页' : '全选本页';

  const createGroupFromIds = useCallback(async (vocabularyItemIds: string[]) => {
    if (vocabularyItemIds.length !== GROUP_SIZE) {
      throw new Error(`需要刚好 ${GROUP_SIZE} 个可用词才能开始一组。`);
    }

    const activeWordIds = await fetchActiveLearningGroupWordIds(userId, { sourceType: 'custom' });
    const availableIds = vocabularyItemIds.filter((id) => !activeWordIds.has(id));
    if (availableIds.length !== GROUP_SIZE) {
      throw new Error('有些词刚刚已经进入学习组，请刷新后再试。');
    }

    const entries = await fetchPersistedVocabularyEntriesByIds(availableIds);
    if (entries.length !== GROUP_SIZE) {
      throw new Error('这组词暂时没有完整取回，请再试一次。');
    }

    const result = await createLearningGroupFromVocabularyEntries(userId, entries, {
      groupName: `我的词库 · 第 ${nextGroupNumber} 组 · ${GROUP_SIZE} 词`,
      groupSourceType: 'custom',
    });

    invalidateLibraryCache(userId);

    try {
      await onLibraryMutated?.();
    } catch {
      // Stats refresh should not block starting the learning session.
    }

    await onStartLearningGroup(result.groupId, result.words);
  }, [nextGroupNumber, onLibraryMutated, onStartLearningGroup, userId]);

  const handleStartSequential = async () => {
    if (!sequentialCanStart) {
      setErrorMsg(`还差 ${GROUP_SIZE - availableWords.length} 个可用词才能开始一组。`);
      return;
    }

    setIsCreatingGroup(true);
    setErrorMsg('');
    try {
      await createGroupFromIds(availableWords.slice(0, GROUP_SIZE).map((entry) => entry.vocabularyItemId));
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleStartManual = async () => {
    if (!manualCanStart) {
      setErrorMsg(`手动模式需要选满 ${GROUP_SIZE} 个词。`);
      return;
    }

    setIsCreatingGroup(true);
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
    if (entry.isInActiveLearningGroup || studyMode !== 'manual') return;

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entry.vocabularyItemId)) {
        next.delete(entry.vocabularyItemId);
      } else if (next.size < GROUP_SIZE) {
        next.add(entry.vocabularyItemId);
      }
      return next;
    });
  };

  const handleToggleCurrentPage = () => {
    if (studyMode !== 'manual' || selectablePageIds.length === 0) return;

    setSelectedIds((current) => {
      const next = new Set(current);
      const pageFullySelected = selectablePageIds.every((id) => next.has(id));

      if (pageFullySelected) {
        selectablePageIds.forEach((id) => next.delete(id));
        return next;
      }

      for (const id of selectablePageIds) {
        if (next.size >= GROUP_SIZE) break;
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
      setErrorMsg(`有 ${failures.length} 个词没能删掉：${failures[0]}`);
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

  const primaryAction = studyMode === 'sequential'
    ? {
        label: sequentialCanStart ? '按顺序开始一组' : `还差 ${GROUP_SIZE - availableWords.length} 个词`,
        disabled: !sequentialCanStart,
        onClick: handleStartSequential,
      }
    : {
        label: manualCanStart ? '用选中词开始一组' : `已选 ${selectedCount} / ${GROUP_SIZE}`,
        disabled: !manualCanStart,
        onClick: handleStartManual,
      };

  if (isLoading) {
    return (
      <section className="glass rounded-[32px] p-10 text-center jelly-shadow">
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-apple-blue" />
        <p className="mt-4 text-lg font-black text-text-primary">正在整理我的词库</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {showHeader && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-apple-green/10 text-apple-green">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-text-primary">我的词库</h3>
              <p className="mt-2 text-sm leading-7 text-text-secondary">
                自己保存的词会放在这里。凑够 30 个可用词，就能开始一组。
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
        <div className="flex items-start gap-2 rounded-2xl bg-apple-red/10 px-4 py-3 text-sm font-medium text-apple-red">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {savedWords.length === 0 ? (
        <div className="glass rounded-[32px] p-12 text-center jelly-shadow">
          <BookOpen className="mx-auto h-10 w-10 text-text-secondary/50" />
          <p className="mt-4 text-2xl font-black text-text-primary">我的词库还是空的</p>
          <p className="mt-3 text-sm leading-7 text-text-secondary">
            可以先从官方词库开始，也可以导入自己的单词。
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="inline-flex h-12 w-fit shrink-0 items-center rounded-[18px] bg-white px-4 text-text-primary shadow-[0_12px_28px_rgba(0,0,0,0.06)]">
              <span className="text-2xl font-black tracking-tight">{savedWords.length}</span>
              <span className="ml-2 text-xs font-bold text-text-secondary">个词</span>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <div className="inline-flex h-12 w-full rounded-[18px] bg-white p-1 shadow-[0_12px_28px_rgba(0,0,0,0.05)] sm:w-auto">
                <button
                  type="button"
                  onClick={() => setStudyMode('sequential')}
                  className={`flex-1 rounded-[14px] px-5 text-sm font-black transition-colors sm:flex-none ${
                    studyMode === 'sequential' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  顺序
                </button>
                <button
                  type="button"
                  onClick={() => setStudyMode('manual')}
                  className={`flex-1 rounded-[14px] px-5 text-sm font-black transition-colors sm:flex-none ${
                    studyMode === 'manual' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  手动
                </button>
              </div>

              <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[18px] bg-white px-4 text-sm text-text-secondary shadow-[0_12px_28px_rgba(0,0,0,0.05)]">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent font-medium text-text-primary outline-none placeholder:text-text-secondary/70"
                  placeholder="搜索单词或释义"
                />
              </label>

              {studyMode === 'manual' && (
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
              )}

              <button
                type="button"
                onClick={() => { void primaryAction.onClick(); }}
                disabled={primaryAction.disabled || isCreatingGroup}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[18px] bg-apple-blue px-5 text-sm font-black text-white shadow-[0_18px_34px_rgba(25,200,185,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100 sm:min-w-[176px]"
              >
                {isCreatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {primaryAction.label}
              </button>
            </div>
          </div>

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
                    onClick={() => { void handleClearMastered(); }}
                    disabled={isClearingMastered}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-apple-red px-3 py-1.5 text-xs font-black text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isClearingMastered ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {pageWords.map((entry, index) => {
              const badge = getSavedWordBadge(entry);
              const selected = selectedIds.has(entry.vocabularyItemId);
              const disabledForSelection = entry.isInActiveLearningGroup;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.015 }}
                  className={`rounded-[24px] border bg-white px-5 py-4 shadow-[0_14px_34px_rgba(0,0,0,0.05)] transition-all ${
                    selected ? 'border-apple-blue/45 ring-2 ring-apple-blue/15' : 'border-white/80 hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(0,0,0,0.07)]'
                  }`}
                >
                  <div className="flex min-h-[126px] items-start gap-3">
                    {studyMode === 'manual' && (
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={disabledForSelection || (!selected && selectedCount >= GROUP_SIZE)}
                        onChange={() => handleToggleWord(entry)}
                        className="mt-2 h-4 w-4 accent-apple-blue disabled:cursor-not-allowed"
                        aria-label={`选择 ${entry.word}`}
                      />
                    )}

                    <div className="min-w-0 flex-1 self-stretch">
                      <div className="flex min-h-full flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <h4 className="truncate text-[1.35rem] font-black leading-tight tracking-tight text-text-primary">
                                {entry.word}
                              </h4>
                              <span className="text-xs font-mono font-bold text-apple-blue">{entry.phonetic || '暂无音标'}</span>
                            </div>
                            <p className="mt-1 text-sm font-black leading-6 text-text-primary">{entry.meaning || '暂无释义'}</p>
                          </div>

                          <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${badge.className}`}>
                            {badge.label}
                          </span>

                          <button
                            type="button"
                            onClick={() => { void handleDeleteWord(entry); }}
                            disabled={deletingWordId === entry.vocabularyItemId}
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
                            {entry.exampleSentence || '这个词暂时还没有可展示的例句。'}
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
                              已在学习组
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
                没有匹配的词。
              </div>
            )}
          </div>

          {filteredWords.length > PAGE_SIZE && (
            <div className="mt-5 flex items-center justify-between text-sm font-bold text-text-secondary">
              <span>{clampedPage} / {totalPages}</span>
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
