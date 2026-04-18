import { Fragment, useEffect, useMemo, useState, type JSX } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  Loader2,
  PlusCircle,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  LibraryGroupSummary,
  LibraryGroupWord,
  MemoryState,
  OfficialLibrarySummary,
  ReviewResultType,
  ResumeCandidate,
} from '../../types';
import {
  getCachedLibraryGroupDetail,
  getCachedLibraryGroups,
  isLibraryCacheFresh,
  removeLibraryGroupFromCache,
  refreshLibraryGroupDetail,
  refreshLibraryGroups,
  type LibraryGroupDetailCacheData,
} from '../../lib/libraryCache';
import { deleteLibraryGroup } from '../../lib/libraryApi';
import { OfficialLibraryPanel } from './OfficialLibraryPanel';
import {
  OFFICIAL_LIBRARY_TITLE,
  buildOfficialLibrarySummary,
  getOfficialWordPosition,
  resolveLibraryGroupSourceType,
  sortWordsByOfficialOrder,
} from '../../lib/officialLibrary';
import { fetchOfficialResumeCandidate } from '../../lib/learningSessionApi';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface LearningGroupRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  status: 'active' | 'completed' | null;
  created_at: string;
  learning_group_words: { id: string }[] | null;
}

interface DetailReviewStateRow {
  memory_state: MemoryState;
  next_review_at: string | null;
  last_result: ReviewResultType | null;
}

interface DetailVocabularyItemRow {
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
  review_states: DetailReviewStateRow[] | DetailReviewStateRow | null;
}

interface GroupWordRow {
  sequence_no: number | null;
  vocabulary_items: DetailVocabularyItemRow | DetailVocabularyItemRow[];
}

interface OfficialLibraryDetailData {
  summary: OfficialLibrarySummary;
  words: LibraryGroupWord[];
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

const groupStatusLabel: Record<'active' | 'completed', string> = {
  active: '进行中',
  completed: '已完成',
};

const groupStatusStyle: Record<'active' | 'completed', string> = {
  active: 'bg-apple-orange/10 text-apple-orange',
  completed: 'bg-apple-green/10 text-apple-green',
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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

function formatGroupTitle(createdAt: string): string {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}.${month}.${day} 导入词组`;
}

function formatGroupDateLong(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatMonthDay(createdAt: string): string {
  const date = new Date(createdAt);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}.${day}`;
}

function mapGroupSummary(row: LearningGroupRow): LibraryGroupSummary {
  const sourceType = resolveLibraryGroupSourceType(row.source_type, row.group_name);

  return {
    id: row.id,
    title: sourceType === 'system' ? row.group_name ?? formatGroupTitle(row.created_at) : formatGroupTitle(row.created_at),
    createdAt: row.created_at,
    wordCount: row.learning_group_words?.length ?? 0,
    sourceType,
    status: row.status === 'completed' ? 'completed' : 'active',
  };
}

function mapGroupWord(row: GroupWordRow): LibraryGroupWord | null {
  const vocabularyItem = asArray(row.vocabulary_items)[0];
  if (!vocabularyItem) return null;

  const reviewState = asArray(vocabularyItem.review_states)[0];
  const confused = vocabularyItem.confused_words[0];

  return {
    id: vocabularyItem.id,
    word: vocabularyItem.word,
    phonetic: vocabularyItem.ipa_uk ?? '',
    meaning: vocabularyItem.primary_meaning_zh ?? '',
    memoryTip: vocabularyItem.memory_tip ?? '',
    posTags: vocabularyItem.vocabulary_senses.map((sense) => sense.pos ?? '').filter(Boolean),
    examples: vocabularyItem.vocabulary_senses
      .map((sense) => ({
        sentence: sense.example_sentence ?? '',
        translation: sense.example_translation_zh ?? '',
      }))
      .filter((example) => example.sentence),
    confusingWord: confused?.confused_word ?? null,
    confusingDiff: confused?.difference_note_zh ?? null,
    memoryState: reviewState?.memory_state ?? 'new',
    nextReviewAt: reviewState?.next_review_at ?? null,
    lastResult: reviewState?.last_result ?? null,
    sequenceNo: row.sequence_no ?? 0,
  };
}

async function fetchLibraryGroupSummaries(userId: string): Promise<LibraryGroupSummary[]> {
  const { data, error } = await supabase
    .from('learning_groups')
    .select(`
      id,
      group_name,
      source_type,
      status,
      created_at,
      learning_group_words ( id )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as LearningGroupRow[]).map(mapGroupSummary);
}

async function fetchOfficialLibraryDetail(userId: string): Promise<OfficialLibraryDetailData> {
  const [groups, officialResumeCandidate] = await Promise.all([
    fetchLibraryGroupSummaries(userId),
    fetchOfficialResumeCandidate(userId),
  ]);

  const systemGroups = groups.filter((group) => group.sourceType === 'system');
  const summary = buildOfficialLibrarySummary(systemGroups, officialResumeCandidate);

  if (systemGroups.length === 0) {
    return {
      summary,
      words: [],
    };
  }

  const { data, error } = await supabase
    .from('learning_group_words')
    .select(`
      sequence_no,
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
        ),
        review_states (
          memory_state,
          next_review_at,
          last_result
        )
      )
    `)
    .in('learning_group_id', systemGroups.map((group) => group.id));

  if (error) throw error;

  const wordsById = new Map<string, LibraryGroupWord>();
  for (const row of (data ?? []) as GroupWordRow[]) {
    const mappedWord = mapGroupWord(row);
    if (!mappedWord || wordsById.has(mappedWord.id)) continue;
    wordsById.set(mappedWord.id, mappedWord);
  }

  return {
    summary,
    words: sortWordsByOfficialOrder([...wordsById.values()]),
  };
}

async function fetchLibraryGroupDetail(
  userId: string,
  groupId: string,
): Promise<LibraryGroupDetailCacheData> {
  const { data: groupData, error: groupError } = await supabase
    .from('learning_groups')
    .select(`
      id,
      group_name,
      source_type,
      status,
      created_at,
      learning_group_words ( id )
    `)
    .eq('id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (groupError) throw groupError;
  if (!groupData) {
    return {
      group: null,
      words: [],
    };
  }

  const { data: wordData, error: wordError } = await supabase
    .from('learning_group_words')
    .select(`
      sequence_no,
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
        ),
        review_states (
          memory_state,
          next_review_at,
          last_result
        )
      )
    `)
    .eq('learning_group_id', groupId)
    .order('sequence_no', { ascending: true });

  if (wordError) throw wordError;

  return {
    group: mapGroupSummary(groupData as LearningGroupRow),
    words: ((wordData ?? []) as GroupWordRow[]).map(mapGroupWord).filter(Boolean) as LibraryGroupWord[],
  };
}

function WordDetailDrawer({
  word,
  onClose,
}: {
  word: LibraryGroupWord;
  onClose: () => void;
}) {
  return (
    <>
      <motion.button
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
      />
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        className="fixed inset-4 z-50 overflow-y-auto glass rounded-apple-lg p-6 jelly-shadow md:inset-y-6 md:right-6 md:left-auto md:w-[420px] md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">这个词</p>
            <h3 className="mt-2 text-3xl font-black text-text-primary">{word.word}</h3>
            <p className="mt-2 text-sm font-mono text-apple-blue">{word.phonetic || '暂无音标'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 text-text-secondary transition-colors hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${memoryStateStyle[word.memoryState]}`}>
            {memoryStateLabel[word.memoryState]}
          </span>
          {word.posTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold uppercase tracking-widest text-text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-8 space-y-6">
          <section className="glass rounded-2xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">释义</p>
            <p className="mt-3 text-lg font-bold text-text-primary">{word.meaning || '暂无释义'}</p>
          </section>

          <section className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 text-text-secondary">
              <Clock3 className="h-4 w-4" />
              <p className="text-xs font-bold uppercase tracking-widest">下次复习</p>
            </div>
            <p className="mt-3 text-sm text-text-primary">{formatDateTime(word.nextReviewAt)}</p>
            {word.lastResult && (
              <p className="mt-2 text-sm text-text-secondary">{lastResultLabel[word.lastResult]}</p>
            )}
          </section>

          {word.examples.length > 0 && (
            <section className="glass rounded-2xl p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">例句</p>
              <div className="mt-3 space-y-4">
                {word.examples.slice(0, 3).map((example, index) => (
                  <div key={`${word.id}-detail-example-${index}`}>
                    <p className="text-sm leading-6 text-text-primary">{example.sentence}</p>
                    {example.translation && (
                      <p className="mt-1 text-xs leading-5 text-text-secondary">{example.translation}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {word.confusingWord && (
            <section className="glass rounded-2xl p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">易混词</p>
              <p className="mt-3 text-lg font-bold text-text-primary">{word.confusingWord}</p>
              {word.confusingDiff && (
                <p className="mt-2 text-sm leading-6 text-text-secondary">{word.confusingDiff}</p>
              )}
            </section>
          )}

          {word.memoryTip && (
            <section className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 text-text-secondary">
                <Sparkles className="h-4 w-4" />
                <p className="text-xs font-bold uppercase tracking-widest">记忆提示</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-text-primary">{word.memoryTip}</p>
            </section>
          )}
        </div>
      </motion.aside>
    </>
  );
}

function LibraryLoading({ message }: { message: string }) {
  return (
    <div className="glass rounded-apple-lg p-16 flex flex-col items-center gap-6">
      <Loader2 className="h-10 w-10 animate-spin text-apple-blue" />
      <p className="text-xl font-black">{message}</p>
    </div>
  );
}

function LibraryError({ message }: { message: string }) {
  return (
    <div className="glass rounded-apple-lg p-12 flex items-start gap-3 text-apple-red">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div>
        <p className="font-bold">词库读取失败</p>
        <p className="mt-1 text-sm">{message}</p>
      </div>
    </div>
  );
}

function DeleteGroupDialog({
  groupTitle,
  isDeleting,
  errorMsg,
  onCancel,
  onConfirm,
}: {
  groupTitle: string;
  isDeleting: boolean;
  errorMsg: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <motion.button
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={isDeleting ? undefined : onCancel}
        className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="fixed inset-x-6 top-1/2 z-[70] mx-auto w-full max-w-lg -translate-y-1/2 rounded-[32px] border border-white/70 bg-white/90 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.16)] backdrop-blur-2xl"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-apple-red/10 text-apple-red">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">删除个人词库</p>
            <h3 className="mt-3 text-2xl font-black text-text-primary">确认删除这组词？</h3>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              删除后，这组词会从你的个人词库里移除；如果这些词没有出现在你其他词组里，对应的复习状态也会一起清掉。
            </p>
            <p className="mt-4 rounded-2xl bg-black/5 px-4 py-3 text-sm font-bold text-text-primary">
              {groupTitle}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-5 rounded-2xl bg-apple-red/10 px-4 py-3 text-sm font-medium text-apple-red">
            {errorMsg}
          </div>
        )}

        <div className="mt-7 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-[22px] bg-black/5 px-5 py-3 text-sm font-bold text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            先不删
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 rounded-[22px] bg-apple-red px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(255,59,48,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            确认删除
          </button>
        </div>
      </motion.div>
    </>
  );
}

function LibraryGroupCard({
  group,
  kind,
  index,
  onOpen,
  onDelete,
}: {
  group: LibraryGroupSummary;
  kind: 'system' | 'custom';
  index: number;
  onOpen: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}): JSX.Element {
  const kindLabel = kind === 'system' ? '官方词库' : '自己导入';
  const kindTone = kind === 'system' ? 'bg-[#12192b]/8 text-[#12192b]' : 'bg-apple-blue/10 text-apple-blue';
  const helperText = kind === 'system' ? '这一批会保留在系统词库里。' : '这一组的状态和安排都在里面。';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group relative overflow-hidden rounded-[32px] border border-white/70 bg-white/78 p-7 text-left shadow-[0_18px_50px_rgba(0,0,0,0.06)] transition-all hover:-translate-y-1 hover:shadow-[0_28px_60px_rgba(0,0,0,0.08)] focus:outline-none focus:ring-2 focus:ring-apple-blue/30"
    >
      <div className="pointer-events-none absolute -right-10 top-0 h-36 w-36 rounded-full bg-apple-blue/10 blur-3xl transition-transform duration-500 group-hover:scale-110" />
      <div className="relative">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">{kindLabel}</p>
            <h4 className="mt-5 text-2xl font-black leading-tight text-text-primary">{group.title}</h4>
            <p className="mt-3 text-sm text-text-secondary">{formatGroupDateLong(group.createdAt)}</p>
          </div>

          <div className="flex flex-col items-end gap-3">
            {onDelete ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/88 text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.08)] transition-colors hover:text-apple-red"
                aria-label={`删除 ${group.title}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : (
              <div className="inline-flex h-10 items-center rounded-full bg-white/82 px-4 text-xs font-bold uppercase tracking-[0.24em] text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.08)]">
                只读
              </div>
            )}

            <div className="rounded-[28px] bg-[#12192b] px-4 py-3 text-white shadow-[0_18px_40px_rgba(18,25,43,0.22)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/60">日期</p>
              <p className="mt-1 text-2xl font-black">{formatMonthDay(group.createdAt)}</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold uppercase tracking-widest text-text-secondary">
            {group.wordCount} 个词
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${kindTone}`}>
            {kindLabel}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${groupStatusStyle[group.status]}`}>
            {groupStatusLabel[group.status]}
          </span>
        </div>

        <div className="mt-8 flex items-center justify-between gap-4 text-sm">
          <p className="text-text-secondary">{helperText}</p>
          <div className="inline-flex items-center gap-1 font-bold text-text-primary">
            进去看看
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export const LibraryView = ({
  onStartLearningGroup,
  onLibraryMutated,
}: {
  onStartLearningGroup: (groupId: string) => Promise<void> | void;
  onLibraryMutated?: () => void | Promise<void>;
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [groups, setGroups] = useState<LibraryGroupSummary[]>([]);
  const [officialResumeCandidate, setOfficialResumeCandidate] = useState<ResumeCandidate | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [groupPendingDelete, setGroupPendingDelete] = useState<LibraryGroupSummary | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState('');

  useEffect(() => {
    let active = true;
    const cachedGroups = user ? getCachedLibraryGroups(user.id) : null;

    if (!user) {
      setGroups([]);
      setOfficialResumeCandidate(null);
      setIsLoading(false);
      setErrorMsg('');
      return () => { active = false; };
    }

    if (cachedGroups) {
      setGroups(cachedGroups.data);
      setErrorMsg('');
    }

    const loadGroups = async () => {
      setIsLoading(true);
      setErrorMsg('');

      const shouldRefreshGroups = !cachedGroups || !isLibraryCacheFresh(cachedGroups);
      const [groupsResult, officialResumeResult] = await Promise.allSettled([
        shouldRefreshGroups
          ? refreshLibraryGroups(user.id, () => fetchLibraryGroupSummaries(user.id))
          : Promise.resolve(cachedGroups.data),
        fetchOfficialResumeCandidate(user.id),
      ]);

      if (!active) return;

      if (groupsResult.status === 'fulfilled') {
        setGroups(groupsResult.value);
      } else {
        const msg =
          groupsResult.reason instanceof Error
            ? groupsResult.reason.message
            : (groupsResult.reason as { message?: string })?.message ?? JSON.stringify(groupsResult.reason);
        if (!cachedGroups) {
          setErrorMsg(msg);
        } else {
          console.error('library groups refresh failed:', msg);
        }
      }

      if (officialResumeResult.status === 'fulfilled') {
        setOfficialResumeCandidate(officialResumeResult.value);
      } else {
        const msg =
          officialResumeResult.reason instanceof Error
            ? officialResumeResult.reason.message
            : (officialResumeResult.reason as { message?: string })?.message ?? JSON.stringify(officialResumeResult.reason);
        console.error('official resume lookup failed:', msg);
        setErrorMsg((current) => current || msg);
        setOfficialResumeCandidate(null);
      }

      setIsLoading(false);
    };

    void loadGroups();

    return () => { active = false; };
  }, [user]);

  if (isLoading || officialResumeCandidate === undefined) {
    return <LibraryLoading message="正在把你的词库整理好" />;
  }

  if (errorMsg) {
    return <LibraryError message={errorMsg} />;
  }

  const systemGroups = groups.filter((group) => group.sourceType === 'system');
  const customGroups = groups.filter((group) => group.sourceType === 'custom');
  const officialSummary = buildOfficialLibrarySummary(systemGroups, officialResumeCandidate ?? null);

  const handleDeleteGroup = async () => {
    if (!user || !groupPendingDelete) return;

    try {
      setIsDeletingGroup(true);
      setDeleteErrorMsg('');
      await deleteLibraryGroup(user.id, groupPendingDelete.id);
      removeLibraryGroupFromCache(user.id, groupPendingDelete.id);
      setGroups((prev) => prev.filter((group) => group.id !== groupPendingDelete.id));
      setGroupPendingDelete(null);
      void onLibraryMutated?.();
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : (error as { message?: string })?.message ?? JSON.stringify(error);
      setDeleteErrorMsg(msg);
    } finally {
      setIsDeletingGroup(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-6xl mx-auto space-y-10">
        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#12192b] text-white">
                <BookOpen className="h-5 w-5" />
              </div>
              <h3 className="text-2xl font-black text-text-primary">系统词库</h3>
            </div>
          </div>

          <OfficialLibraryPanel
            summary={officialSummary}
            onStartLearning={onStartLearningGroup}
            onOpenDetail={() => navigate('/app/library/official')}
            onLibraryMutated={onLibraryMutated}
          />
        </section>

        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
                <CalendarDays className="h-5 w-5" />
              </div>
              <h3 className="text-2xl font-black text-text-primary">个人词库</h3>
            </div>
            {customGroups.length > 0 && (
              <div className="glass rounded-2xl px-4 py-2 text-sm font-bold text-text-secondary">
                {customGroups.length} 组
              </div>
            )}
          </div>

          {customGroups.length === 0 ? (
            <div className="glass rounded-[32px] p-12 text-center jelly-shadow">
              <PlusCircle className="mx-auto h-10 w-10 text-text-secondary/50" />
              <p className="mt-4 text-2xl font-black text-text-primary">你还没导入自己的词</p>
              <p className="mt-3 text-sm leading-7 text-text-secondary">
                去导入一组词，回来这里就能按词组看了。
              </p>
              <button
                type="button"
                onClick={() => navigate('/app/import')}
                className="mt-8 rounded-[24px] bg-apple-blue px-6 py-4 text-base font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.24)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                去导入
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {customGroups.map((group, index) => (
                <Fragment key={group.id}>
                  {LibraryGroupCard({
                    group,
                    kind: 'custom',
                    index,
                    onOpen: () => navigate(`/app/library/group/${group.id}`),
                    onDelete: () => {
                      setDeleteErrorMsg('');
                      setGroupPendingDelete(group);
                    },
                  })}
                </Fragment>
              ))}
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {groupPendingDelete && (
          <DeleteGroupDialog
            groupTitle={groupPendingDelete.title}
            isDeleting={isDeletingGroup}
            errorMsg={deleteErrorMsg}
            onCancel={() => {
              if (isDeletingGroup) return;
              setDeleteErrorMsg('');
              setGroupPendingDelete(null);
            }}
            onConfirm={() => { void handleDeleteGroup(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export const OfficialLibraryDetailView = ({
  onLibraryMutated,
  onStartLearningGroup,
}: {
  onLibraryMutated?: () => void | Promise<void>;
  onStartLearningGroup?: (groupId: string) => Promise<void> | void;
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [summary, setSummary] = useState<OfficialLibrarySummary>(() => buildOfficialLibrarySummary([], null));
  const [words, setWords] = useState<LibraryGroupWord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;

    if (!user) {
      setSummary(buildOfficialLibrarySummary([], null));
      setWords([]);
      setIsLoading(false);
      setErrorMsg('');
      return () => { active = false; };
    }

    const loadOfficialDetail = async () => {
      try {
        setIsLoading(true);
        setErrorMsg('');
        const detail = await fetchOfficialLibraryDetail(user.id);
        if (!active) return;
        setSummary(detail.summary);
        setWords(detail.words);
      } catch (error) {
        if (!active) return;
        const msg =
          error instanceof Error
            ? error.message
            : (error as { message?: string })?.message ?? JSON.stringify(error);
        setErrorMsg(msg);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadOfficialDetail();

    return () => { active = false; };
  }, [user]);

  const selectedWord = useMemo(
    () => words.find((word) => word.id === selectedId) ?? null,
    [selectedId, words],
  );

  if (isLoading) {
    return <LibraryLoading message="正在整理官方词库" />;
  }

  if (errorMsg) {
    return <LibraryError message={errorMsg} />;
  }

  return (
    <>
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div>
          <button
            type="button"
            onClick={() => navigate('/app/library')}
            className="inline-flex items-center gap-2 rounded-full bg-white/78 px-4 py-2 text-sm font-bold text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            词库 / 系统词库
          </button>
        </div>

        <OfficialLibraryPanel
          summary={summary}
          onStartLearning={onStartLearningGroup ?? (() => undefined)}
          onLibraryMutated={onLibraryMutated}
          showOpenDetailAction={false}
        />

        {words.length === 0 ? (
          <div className="glass rounded-[32px] p-12 text-center jelly-shadow">
            <BookOpen className="mx-auto h-10 w-10 text-text-secondary/50" />
            <p className="mt-4 text-2xl font-black text-text-primary">{OFFICIAL_LIBRARY_TITLE} 还没开始</p>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              点上面的继续学习，系统会从第一批开始把官方词汇发到这里。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {words.map((word, index) => (
              <motion.button
                key={word.id}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => setSelectedId(word.id)}
                className="group rounded-[30px] border border-white/70 bg-white/78 p-5 text-left shadow-[0_14px_38px_rgba(0,0,0,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_46px_rgba(0,0,0,0.08)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                      <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                        {String(((getOfficialWordPosition(word.word) === Number.MAX_SAFE_INTEGER)
                          ? index
                          : getOfficialWordPosition(word.word)) + 1).padStart(4, '0')}
                      </span>
                      <h3 className="text-3xl font-black tracking-tight text-text-primary">{word.word}</h3>
                      <span className="text-sm font-mono text-apple-blue">{word.phonetic || '暂无音标'}</span>
                    </div>
                    <p className="mt-3 text-lg text-text-primary/92">{word.meaning || '暂无释义'}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${memoryStateStyle[word.memoryState]}`}>
                    {memoryStateLabel[word.memoryState]}
                  </span>
                </div>

                <div className="mt-6 flex items-center justify-between gap-4 text-sm text-text-secondary">
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
          <WordDetailDrawer
            word={selectedWord}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export const LibraryGroupDetailView = ({
  isStartingLearningGroup = false,
  onLibraryMutated,
  onStartLearningGroup,
}: {
  isStartingLearningGroup?: boolean;
  onLibraryMutated?: () => void | Promise<void>;
  onStartLearningGroup?: (groupId: string) => Promise<void> | void;
}) => {
  const navigate = useNavigate();
  const { groupId } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState<LibraryGroupSummary | null>(null);
  const [words, setWords] = useState<LibraryGroupWord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState('');

  useEffect(() => {
    let active = true;
    const cachedDetail = user && groupId ? getCachedLibraryGroupDetail(user.id, groupId) : null;

    if (!user || !groupId) {
      setGroup(null);
      setWords([]);
      setIsLoading(false);
      setErrorMsg('');
      return () => { active = false; };
    }

    if (cachedDetail) {
      setGroup(cachedDetail.data.group);
      setWords(cachedDetail.data.words);
      setIsLoading(false);
      setErrorMsg('');
    }

    const loadGroupDetail = async () => {
      try {
        if (!cachedDetail) {
          setIsLoading(true);
          setErrorMsg('');
        }

        const detail = await refreshLibraryGroupDetail(
          user.id,
          groupId,
          () => fetchLibraryGroupDetail(user.id, groupId),
        );
        if (!active) return;
        setGroup(detail.group);
        setWords(detail.words);
        setErrorMsg('');
      } catch (error) {
        if (!active) return;
        const msg =
          error instanceof Error
            ? error.message
            : (error as { message?: string })?.message ?? JSON.stringify(error);
        if (!cachedDetail) {
          setErrorMsg(msg);
        } else {
          console.error(`library group detail refresh failed for ${groupId}:`, msg);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    if (!cachedDetail || !isLibraryCacheFresh(cachedDetail)) {
      void loadGroupDetail();
    }

    return () => { active = false; };
  }, [groupId, user]);

  const selectedWord = useMemo(
    () => words.find((word) => word.id === selectedId) ?? null,
    [selectedId, words],
  );

  if (isLoading) {
    return <LibraryLoading message="正在打开这一组词" />;
  }

  if (errorMsg) {
    return <LibraryError message={errorMsg} />;
  }

  if (!group) {
    return (
      <div className="glass mx-auto max-w-3xl rounded-apple-lg p-14 text-center jelly-shadow">
        <BookOpen className="mx-auto h-10 w-10 text-text-secondary/50" />
        <p className="mt-4 text-2xl font-black text-text-primary">这组词现在打不开</p>
        <p className="mt-3 text-sm leading-7 text-text-secondary">
          可能是这组词已经不在了，也可能它不属于你。
        </p>
        <button
          type="button"
          onClick={() => navigate('/app/library')}
          className="mt-8 rounded-[24px] bg-apple-blue px-6 py-4 text-base font-black text-white"
        >
          回到词库首页
        </button>
      </div>
    );
  }

  const isSystemGroup = group.sourceType === 'system';
  if (isSystemGroup) {
    return <Navigate to="/app/library/official" replace />;
  }

  const groupSectionLabel = isSystemGroup ? '系统词库' : '个人词库';
  const groupHelperLabel = isSystemGroup ? '官方词库' : '自己导入';

  const handleDeleteGroup = async () => {
    if (!user || !group || isSystemGroup) return;

    try {
      setIsDeletingGroup(true);
      setDeleteErrorMsg('');
      await deleteLibraryGroup(user.id, group.id);
      removeLibraryGroupFromCache(user.id, group.id);
      setSelectedId(null);
      setIsDeleteDialogOpen(false);
      void onLibraryMutated?.();
      navigate('/app/library');
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : (error as { message?: string })?.message ?? JSON.stringify(error);
      setDeleteErrorMsg(msg);
    } finally {
      setIsDeletingGroup(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate('/app/library')}
              className="inline-flex items-center gap-2 rounded-full bg-white/78 px-4 py-2 text-sm font-bold text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-colors hover:text-text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              词库 / {groupSectionLabel}
            </button>

            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
              词库 / {groupSectionLabel} / {formatMonthDay(group.createdAt)}
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-tight text-text-primary">{group.title}</h2>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold uppercase tracking-widest text-text-secondary">
                {formatGroupDateLong(group.createdAt)}
              </span>
              <span className="rounded-full bg-apple-blue/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-apple-blue">
                {group.wordCount} 个词
              </span>
              <span className="rounded-full bg-[#12192b]/8 px-3 py-1 text-xs font-bold uppercase tracking-widest text-[#12192b]">
                {groupHelperLabel}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${groupStatusStyle[group.status]}`}>
                {groupStatusLabel[group.status]}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { void onStartLearningGroup?.(group.id); }}
              disabled={words.length === 0 || isStartingLearningGroup}
              className="inline-flex items-center gap-2 rounded-full bg-apple-blue px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >
              {isStartingLearningGroup ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在打开学习流程
                </>
              ) : (
                <>
                  继续学习
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>

            {!isSystemGroup && (
              <button
                type="button"
                onClick={() => {
                  setDeleteErrorMsg('');
                  setIsDeleteDialogOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white/82 px-4 py-3 text-sm font-bold text-text-secondary shadow-[0_10px_24px_rgba(0,0,0,0.05)] transition-colors hover:text-apple-red"
              >
                <Trash2 className="h-4 w-4" />
                删除这组词
              </button>
            )}
          </div>
        </div>

        {words.length === 0 ? (
          <div className="glass rounded-[32px] p-12 text-center jelly-shadow">
            <p className="text-2xl font-black text-text-primary">这组词还没显示出来</p>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              {isSystemGroup
                ? '稍后再回来看看，正常情况下这里会有系统词包里的那些词。'
                : '稍后再回来看看，正常情况下这里会有你导入的那些词。'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {words.map((word, index) => (
              <motion.button
                key={word.id}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => setSelectedId(word.id)}
                className="group rounded-[30px] border border-white/70 bg-white/78 p-5 text-left shadow-[0_14px_38px_rgba(0,0,0,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_46px_rgba(0,0,0,0.08)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                      <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                        {String(word.sequenceNo + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-3xl font-black tracking-tight text-text-primary">{word.word}</h3>
                      <span className="text-sm font-mono text-apple-blue">{word.phonetic || '暂无音标'}</span>
                    </div>
                    <p className="mt-3 text-lg text-text-primary/92">{word.meaning || '暂无释义'}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${memoryStateStyle[word.memoryState]}`}>
                    {memoryStateLabel[word.memoryState]}
                  </span>
                </div>

                <div className="mt-6 flex items-center justify-between gap-4 text-sm text-text-secondary">
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
          <WordDetailDrawer
            word={selectedWord}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isSystemGroup && isDeleteDialogOpen && (
          <DeleteGroupDialog
            groupTitle={group.title}
            isDeleting={isDeletingGroup}
            errorMsg={deleteErrorMsg}
            onCancel={() => {
              if (isDeletingGroup) return;
              setDeleteErrorMsg('');
              setIsDeleteDialogOpen(false);
            }}
            onConfirm={() => { void handleDeleteGroup(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
};
