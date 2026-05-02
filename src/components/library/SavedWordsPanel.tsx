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
  Trash2,
} from 'lucide-react';
import type { MemoryState, Word } from '../../types';
import {
  createLearningGroupFromVocabularyEntries,
  fetchPersistedVocabularyEntriesByIds,
} from '../../lib/importFlow';
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

type StudyMode = 'sequential' | 'manual';

interface SavedWordsPanelProps {
  userId: string;
  nextGroupNumber: number;
  onStartLearningGroup: (groupId: string, words?: Word[]) => Promise<void> | void;
  onLibraryMutated?: () => void | Promise<void>;
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
  if (!entry.memoryState) {
    return {
      label: '未学习',
      className: 'bg-sky-50 text-sky-700',
    };
  }

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

    if (cached && isLibraryCacheFresh(cached)) {
      return () => { active = false; };
    }

    const loadSavedWords = async () => {
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

  const completedCount = useMemo(
    () => savedWords.filter((entry) => entry.memoryState === 'stable_recall' || entry.memoryState === 'mastered').length,
    [savedWords],
  );
  const pendingCount = Math.max(savedWords.length - completedCount, 0);

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
  const pageWords = filteredWords.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

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

  const createGroupFromIds = useCallback(async (vocabularyItemIds: string[]) => {
    if (vocabularyItemIds.length !== GROUP_SIZE) {
      throw new Error(`需要刚好 ${GROUP_SIZE} 个可用词才能开始一组。`);
    }

    const activeWordIds = await fetchActiveLearningGroupWordIds(userId);
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-apple-green/10 text-apple-green">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-text-primary">我的词库</h3>
            <p className="mt-2 text-sm leading-7 text-text-secondary">
              导入和阅读收藏的词都会先放在这里，再按 30 个一组进入学习。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
          <div className="glass rounded-2xl px-4 py-3">
            <p className="text-2xl font-black text-text-primary">{savedWords.length}</p>
            <p className="mt-1 text-[11px] font-bold text-text-secondary">总词数</p>
          </div>
          <div className="glass rounded-2xl px-4 py-3">
            <p className="text-2xl font-black text-apple-green">{completedCount}</p>
            <p className="mt-1 text-[11px] font-bold text-text-secondary">已学完</p>
          </div>
          <div className="glass rounded-2xl px-4 py-3">
            <p className="text-2xl font-black text-apple-blue">{pendingCount}</p>
            <p className="mt-1 text-[11px] font-bold text-text-secondary">待完成</p>
          </div>
        </div>
      </div>

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
            从阅读浮窗加入，或从导入页保存一批词后，这里会变成你的统一词池。
          </p>
        </div>
      ) : (
        <div className="glass rounded-[32px] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.06)] sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="inline-flex rounded-[22px] bg-black/5 p-1">
              <button
                type="button"
                onClick={() => setStudyMode('sequential')}
                className={`rounded-[18px] px-4 py-2 text-sm font-black transition-colors ${
                  studyMode === 'sequential' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'
                }`}
              >
                顺序
              </button>
              <button
                type="button"
                onClick={() => setStudyMode('manual')}
                className={`rounded-[18px] px-4 py-2 text-sm font-black transition-colors ${
                  studyMode === 'manual' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'
                }`}
              >
                手动
              </button>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex min-w-0 items-center gap-2 rounded-[22px] bg-white/80 px-4 py-3 text-sm text-text-secondary shadow-sm sm:w-72">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent font-medium text-text-primary outline-none placeholder:text-text-secondary/70"
                  placeholder="搜索单词或释义"
                />
              </label>

              <button
                type="button"
                onClick={() => { void primaryAction.onClick(); }}
                disabled={primaryAction.disabled || isCreatingGroup}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[22px] bg-apple-blue px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100"
              >
                {isCreatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {primaryAction.label}
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
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
                  className="rounded-[24px] border border-white/70 bg-white/76 px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.04)]"
                >
                  <div className="flex items-start gap-3">
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

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h4 className="text-lg font-black text-text-primary">{entry.word}</h4>
                        <span className="text-xs font-mono text-apple-blue">{entry.phonetic || '暂无音标'}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badge.className}`}>
                          {badge.label}
                        </span>
                        {entry.enrichmentLevel === 'lite' && (
                          <span className="rounded-full bg-apple-orange/10 px-2.5 py-0.5 text-[11px] font-bold text-apple-orange">
                            生成中
                          </span>
                        )}
                        {entry.isInActiveLearningGroup && (
                          <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-bold text-text-secondary">
                            已在学习组
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-text-secondary">{entry.meaning || '暂无释义'}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold text-text-secondary">
                        <span>{sourceLabel[entry.source]}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatSavedDate(entry.savedAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => { void handleDeleteWord(entry); }}
                      disabled={deletingWordId === entry.vocabularyItemId}
                      className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-text-secondary transition-colors hover:text-apple-red disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`从词库移除 ${entry.word}`}
                    >
                      {deletingWordId === entry.vocabularyItemId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </motion.div>
              );
            })}

            {pageWords.length === 0 && (
              <div className="rounded-[24px] bg-white/70 px-6 py-10 text-center text-sm font-bold text-text-secondary">
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
