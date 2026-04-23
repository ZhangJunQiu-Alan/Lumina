import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
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
  EnrichedWordRelation,
  LibraryGroupSummary,
  LibraryGroupWord,
  MemoryState,
  OfficialLibraryId,
  OfficialResumeTargets,
  OfficialLibrarySummary,
  ReviewResultType,
} from '../../types';
import { toConfusingPairs, toWordMorphology, toWordRelations } from '../../types';
import { ExampleSentenceList } from '../shared/ExampleSentenceList';
import {
  cancelBrowserSpeech,
  isBrowserSpeechSupported,
  speakTextViaBrowser,
} from '../../lib/browserSpeech';
import {
  getCachedLibraryGroupDetail,
  getCachedLibraryGroups,
  getCachedOfficialLibraryDetail,
  getCachedOfficialResumeCandidates,
  isLibraryCacheFresh,
  removeLibraryGroupFromCache,
  refreshLibraryGroupDetail,
  refreshLibraryGroups,
  refreshOfficialLibraryDetail,
  refreshOfficialResumeCandidates,
  type LibraryGroupDetailCacheData,
} from '../../lib/libraryCache';
import { deleteLibraryGroup } from '../../lib/libraryApi';
import { OfficialLibraryPanel } from './OfficialLibraryPanel';
import {
  OFFICIAL_LIBRARY_DEFINITIONS,
  buildOfficialLibrarySummary,
  getOfficialLibraryDefinition,
  getOfficialWordPosition,
  isOfficialLibraryId,
  resolveLibraryGroupSourceType,
  resolveOfficialLibraryId,
  sortWordsByOfficialOrder,
} from '../../lib/officialLibrary';
import { fetchOfficialResumeCandidates, fetchOfficialResumeTargets } from '../../lib/learningSessionApi';
import { isCoreLearningComplete, isCoreLearningRound, isReinforcementRound } from '../../lib/learningSession';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';

interface LearningGroupRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  library_id: string | null;
  status: 'active' | 'completed' | null;
  created_at: string;
  completed_at: string | null;
  session_round: 'round1' | 'round2' | 'round3' | 'article' | null;
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
  morphology_summary_zh: string | null;
  memory_tip: string | null;
  created_at: string;
  vocabulary_senses: {
    pos: string | null;
    example_sentence: string | null;
    example_translation_zh: string | null;
  }[];
  vocabulary_morphology_parts?: {
    part_text: string | null;
    part_kind: 'prefix' | 'root' | 'suffix' | null;
    meaning_zh: string | null;
    note_zh: string | null;
    sort_order: number | null;
  }[] | null;
  vocabulary_relations?: {
    relation_type: 'derived' | 'synonym' | 'antonym' | null;
    related_word: string | null;
    meaning_zh: string | null;
    note_zh: string | null;
    sort_order: number | null;
  }[] | null;
  confused_words?: {
    confused_word: string | null;
    difference_note_zh: string | null;
    sort_order: number | null;
  }[] | null;
  review_states: DetailReviewStateRow[] | DetailReviewStateRow | null;
}

interface GroupWordRow {
  sequence_no: number | null;
  vocabulary_items: DetailVocabularyItemRow | DetailVocabularyItemRow[];
}

interface OfficialLibraryDetailData {
  libraryId: OfficialLibraryId;
  summary: OfficialLibrarySummary;
  existingGroupCount: number;
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

function resolveGroupActionLabel(group: LibraryGroupSummary) {
  if (isReinforcementRound(group.sessionRound) && isCoreLearningComplete({
    status: group.status,
    completedAt: group.completedAt,
    sessionRound: group.sessionRound,
  })) {
    return '继续加固';
  }

  if (isCoreLearningRound(group.sessionRound)) {
    return '接上这一组';
  }

  return '回看这组';
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isMissingRichVocabularySchemaError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  return [
    'morphology_summary_zh',
    'vocabulary_morphology_parts',
    'vocabulary_relations',
    'sort_order',
  ].some((part) => message.includes(part));
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
  return `${year}.${month}.${day} 接入词组`;
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
  const libraryId = resolveOfficialLibraryId(row.library_id, row.group_name, row.source_type);
  const sourceType = resolveLibraryGroupSourceType(row.source_type, row.library_id, row.group_name);
  const completed = isCoreLearningComplete({
    status: row.status,
    completedAt: row.completed_at,
    sessionRound: row.session_round,
  });

  return {
    id: row.id,
    title: sourceType === 'system' ? row.group_name ?? formatGroupTitle(row.created_at) : formatGroupTitle(row.created_at),
    createdAt: row.created_at,
    wordCount: row.learning_group_words?.length ?? 0,
    sourceType,
    libraryId,
    status: completed ? 'completed' : 'active',
    sessionRound: row.session_round,
    completedAt: row.completed_at,
  };
}

function mapGroupWord(row: GroupWordRow): LibraryGroupWord | null {
  const vocabularyItem = asArray(row.vocabulary_items)[0];
  if (!vocabularyItem) return null;

  const reviewState = asArray(vocabularyItem.review_states)[0];
  const relations = [...(vocabularyItem.vocabulary_relations ?? [])]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
  const confusingPairs = toConfusingPairs(
    [...(vocabularyItem.confused_words ?? [])]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((item) => ({
        word: item.confused_word ?? '',
        difference_zh: item.difference_note_zh ?? '',
      })),
  ).filter((pair) => pair.word);
  const confusingWord = confusingPairs[0];

  const mapRelations = (type: 'derived' | 'synonym' | 'antonym'): EnrichedWordRelation[] => (
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
    posTags: vocabularyItem.vocabulary_senses.map((sense) => sense.pos ?? '').filter(Boolean),
    examples: vocabularyItem.vocabulary_senses
      .map((sense) => ({
        sentence: sense.example_sentence ?? '',
        translation: sense.example_translation_zh ?? '',
      }))
      .filter((example) => example.sentence),
    morphology: toWordMorphology({
      summary_zh: vocabularyItem.morphology_summary_zh ?? '',
      parts: [...(vocabularyItem.vocabulary_morphology_parts ?? [])]
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((part) => ({
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
      library_id,
      status,
      created_at,
      completed_at,
      session_round,
      learning_group_words ( id )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as LearningGroupRow[]).map(mapGroupSummary);
}

async function fetchOfficialLibraryDetail(
  userId: string,
  libraryId: OfficialLibraryId,
): Promise<OfficialLibraryDetailData> {
  const [groups, officialResumeTargets] = await Promise.all([
    fetchLibraryGroupSummaries(userId),
    fetchOfficialResumeTargets(userId, libraryId),
  ]);

  const definition = getOfficialLibraryDefinition(libraryId);
  const systemGroups = groups.filter((group) => group.sourceType === 'system' && group.libraryId === libraryId);
  const summary = buildOfficialLibrarySummary(libraryId, groups, officialResumeTargets);

  if (systemGroups.length === 0) {
    return {
      libraryId,
      summary,
      existingGroupCount: 0,
      words: [],
    };
  }

  const richWordSelect = `
      sequence_no,
      vocabulary_items!inner (
        id,
        word,
        ipa_uk,
        primary_meaning_zh,
        morphology_summary_zh,
        memory_tip,
        created_at,
        vocabulary_senses (
          pos,
          example_sentence,
          example_translation_zh
        ),
        vocabulary_morphology_parts (
          part_text,
          part_kind,
          meaning_zh,
          note_zh,
          sort_order
        ),
        vocabulary_relations (
          relation_type,
          related_word,
          meaning_zh,
          note_zh,
          sort_order
        ),
        confused_words (
          confused_word,
          difference_note_zh,
          sort_order
        ),
        review_states (
          memory_state,
          next_review_at,
          last_result
        )
      )
    `;
  const legacyWordSelect = `
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
    `;

  const initialResult = await supabase
    .from('learning_group_words')
    .select(richWordSelect)
    .in('learning_group_id', systemGroups.map((group) => group.id));

  let data = (initialResult.data ?? []) as unknown as GroupWordRow[];
  let error = initialResult.error;

  if (error && isMissingRichVocabularySchemaError(error)) {
    const fallbackResult = await supabase
      .from('learning_group_words')
      .select(legacyWordSelect)
      .in('learning_group_id', systemGroups.map((group) => group.id));

    data = (fallbackResult.data ?? []) as unknown as GroupWordRow[];
    error = fallbackResult.error;
  }

  if (error) throw error;

  const wordsById = new Map<string, LibraryGroupWord>();
  for (const row of data) {
    const mappedWord = mapGroupWord(row);
    if (!mappedWord || wordsById.has(mappedWord.id)) continue;
    wordsById.set(mappedWord.id, mappedWord);
  }

  return {
    libraryId,
    summary,
    existingGroupCount: systemGroups.length,
    words: sortWordsByOfficialOrder(definition.id, [...wordsById.values()]),
  };
}

async function fetchLibraryGroupDetail(
  userId: string,
  groupId: string,
): Promise<LibraryGroupDetailCacheData> {
  const richWordSelect = `
      sequence_no,
      vocabulary_items!inner (
        id,
        word,
        ipa_uk,
        primary_meaning_zh,
        morphology_summary_zh,
        memory_tip,
        created_at,
        vocabulary_senses (
          pos,
          example_sentence,
          example_translation_zh
        ),
        vocabulary_morphology_parts (
          part_text,
          part_kind,
          meaning_zh,
          note_zh,
          sort_order
        ),
        vocabulary_relations (
          relation_type,
          related_word,
          meaning_zh,
          note_zh,
          sort_order
        ),
        confused_words (
          confused_word,
          difference_note_zh,
          sort_order
        ),
        review_states (
          memory_state,
          next_review_at,
          last_result
        )
      )
    `;
  const legacyWordSelect = `
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
    `;
  const { data: groupData, error: groupError } = await supabase
    .from('learning_groups')
    .select(`
      id,
      group_name,
      source_type,
      library_id,
      status,
      created_at,
      completed_at,
      session_round,
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

  const initialWordResult = await supabase
    .from('learning_group_words')
    .select(richWordSelect)
    .eq('learning_group_id', groupId)
    .order('sequence_no', { ascending: true });

  let wordData = (initialWordResult.data ?? []) as unknown as GroupWordRow[];
  let wordError = initialWordResult.error;

  if (wordError && isMissingRichVocabularySchemaError(wordError)) {
    const fallbackResult = await supabase
      .from('learning_group_words')
      .select(legacyWordSelect)
      .eq('learning_group_id', groupId)
      .order('sequence_no', { ascending: true });

    wordData = (fallbackResult.data ?? []) as unknown as GroupWordRow[];
    wordError = fallbackResult.error;
  }

  if (wordError) throw wordError;

  return {
    group: mapGroupSummary(groupData as LearningGroupRow),
    words: wordData.map(mapGroupWord).filter(Boolean) as LibraryGroupWord[],
  };
}

function WordDetailDrawer({
  word,
  onClose,
}: {
  word: LibraryGroupWord;
  onClose: () => void;
}) {
  const { preferences } = useLearningPreferences();
  const [activeExampleKey, setActiveExampleKey] = useState<string | null>(null);
  const playbackRunIdRef = useRef(0);
  const canPlayExampleAudio = useMemo(() => isBrowserSpeechSupported(), []);

  const stopPlayback = useCallback(() => {
    playbackRunIdRef.current += 1;
    cancelBrowserSpeech();
    setActiveExampleKey(null);
  }, []);

  const handleClose = useCallback(() => {
    stopPlayback();
    onClose();
  }, [onClose, stopPlayback]);

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

  useEffect(() => {
    stopPlayback();
  }, [stopPlayback, word.id]);

  return (
    <>
      <motion.button
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
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
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">这个词现在</p>
            <h3 className="mt-2 text-3xl font-black text-text-primary">{word.word}</h3>
            <p className="mt-2 text-sm font-mono text-apple-blue">{word.phonetic || '暂无音标'}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
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
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">当前意思</p>
            <p className="mt-3 text-lg font-bold text-text-primary">{word.meaning || '暂无释义'}</p>
          </section>

          <section className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2 text-text-secondary">
              <Clock3 className="h-4 w-4" />
              <p className="text-xs font-bold uppercase tracking-widest">下次可能再见</p>
            </div>
            <p className="mt-3 text-sm text-text-primary">{formatDateTime(word.nextReviewAt)}</p>
            {word.lastResult && (
              <p className="mt-2 text-sm text-text-secondary">{lastResultLabel[word.lastResult]}</p>
            )}
          </section>

          <section className="glass rounded-2xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">例句</p>
            <ExampleSentenceList
              items={word.examples.slice(0, 3).map((example, index) => ({
                key: `${word.id}-detail-example-${index}`,
                sentence: example.sentence,
                translation: example.translation,
              }))}
              locale={preferences.defaultPronunciationLocale}
              activeExampleKey={activeExampleKey}
              canPlayAudio={canPlayExampleAudio}
              onPlayExample={({ sentence, key }) => { void playExampleSentence(sentence, key); }}
              emptyMessage="这个词目前还没有例句。"
              variant="drawer"
            />
          </section>

          <section className="glass rounded-2xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">构词拆解</p>
            <p className="mt-3 text-sm leading-6 text-text-primary">
              {word.morphology.summaryZh || '这个词目前还没有构词拆解。'}
            </p>

            <div className="mt-4 space-y-3">
              {word.morphology.parts.length > 0 ? word.morphology.parts.map((part, index) => (
                <div key={`${word.id}-morphology-${index}`} className="rounded-2xl bg-black/5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-text-primary">{part.text}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                      {part.kind}
                    </span>
                  </div>
                  {(part.meaningZh || part.noteZh) && (
                    <p className="mt-2 text-xs leading-5 text-text-secondary">
                      {[part.meaningZh, part.noteZh].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              )) : (
                <p className="text-sm leading-6 text-text-secondary">这个词目前还没有可展示的构词拆解。</p>
              )}
            </div>

            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">派生词</p>
              {word.derivedWords.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {word.derivedWords.map((item) => (
                    <div key={`${word.id}-derived-${item.word}`} className="rounded-2xl bg-black/5 px-4 py-3">
                      <p className="text-sm font-black text-text-primary">{item.word}</p>
                      {(item.meaningZh || item.noteZh) && (
                        <p className="mt-1 text-xs leading-5 text-text-secondary">
                          {[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-text-secondary">这个词目前还没有派生词线索。</p>
              )}
            </div>
          </section>

          <section className="glass rounded-2xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">近义词 / 反义词</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">近义词</p>
                {word.synonyms.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {word.synonyms.map((item) => (
                      <div key={`${word.id}-synonym-${item.word}`} className="rounded-2xl bg-black/5 px-4 py-3">
                        <p className="text-sm font-black text-text-primary">{item.word}</p>
                        {(item.meaningZh || item.noteZh) && (
                          <p className="mt-1 text-xs leading-5 text-text-secondary">
                            {[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-text-secondary">这个词目前还没有近义词线索。</p>
                )}
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">反义词</p>
                {word.antonyms.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {word.antonyms.map((item) => (
                      <div key={`${word.id}-antonym-${item.word}`} className="rounded-2xl bg-black/5 px-4 py-3">
                        <p className="text-sm font-black text-text-primary">{item.word}</p>
                        {(item.meaningZh || item.noteZh) && (
                          <p className="mt-1 text-xs leading-5 text-text-secondary">
                            {[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-text-secondary">这个词目前还没有反义词线索。</p>
                )}
              </div>
            </div>
          </section>

          <section className="glass rounded-2xl p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">易混词义对比</p>
            {word.confusingPairs.length > 0 ? (
              <div className="mt-3 space-y-3">
                {word.confusingPairs.map((pair, index) => (
                  <div key={`${word.id}-confusion-${pair.word}-${index}`} className="rounded-2xl bg-black/5 px-4 py-3">
                    <p className="text-sm font-black text-text-primary">{pair.word}</p>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">{pair.difference}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-text-secondary">这个词目前没有需要特别提醒的易混点。</p>
            )}
          </section>

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
        <p className="font-bold">记忆地图暂时没展开</p>
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
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">移出个人材料</p>
            <h3 className="mt-3 text-2xl font-black text-text-primary">确认把这组材料移出系统？</h3>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              删除后，这组词会从你的个人材料里移除；如果这些词没有出现在其他词组里，对应的复习状态也会一起清掉。
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
            确认移出
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
  const kindLabel = kind === 'system' ? '系统路径' : '外部接入';
  const kindTone = kind === 'system' ? 'bg-[#12192b]/8 text-[#12192b]' : 'bg-apple-blue/10 text-apple-blue';
  const helperText = kind === 'system' ? '系统会沿着这条路径继续往下发词。' : '这组词已经接进同一套状态判断里。';

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
            <h4 className="mt-2 text-2xl font-black leading-tight text-text-primary">{group.title}</h4>
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

        <p className="mt-5 text-sm leading-6 text-text-secondary">
          {helperText}
        </p>

        <div className="mt-8 flex items-center justify-end gap-4 text-sm">
          <div className="inline-flex items-center gap-1 font-bold text-text-primary">
            打开看看
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
  const [officialResumeCandidates, setOfficialResumeCandidates] = useState<
    Record<OfficialLibraryId, OfficialResumeTargets> | undefined
  >(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [groupPendingDelete, setGroupPendingDelete] = useState<LibraryGroupSummary | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState('');

  useEffect(() => {
    let active = true;

    if (!user) {
      setGroups([]);
      setOfficialResumeCandidates(
        Object.fromEntries(
          OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [
            definition.id,
            { active: null, reinforcement: null },
          ]),
        ) as Record<OfficialLibraryId, OfficialResumeTargets>,
      );
      setIsLoading(false);
      setErrorMsg('');
      return () => { active = false; };
    }

    const cachedGroups = getCachedLibraryGroups(user.id);
    const cachedResume = getCachedOfficialResumeCandidates(user.id);

    if (cachedGroups) {
      setGroups(cachedGroups.data);
      setErrorMsg('');
    }
    if (cachedResume) {
      setOfficialResumeCandidates(cachedResume.data);
    }

    const groupsFresh = cachedGroups && isLibraryCacheFresh(cachedGroups);
    const resumeFresh = cachedResume && isLibraryCacheFresh(cachedResume);

    if (groupsFresh && resumeFresh) {
      setIsLoading(false);
      return () => { active = false; };
    }

    if (!cachedGroups || !cachedResume) {
      setIsLoading(true);
    }

    const run = async () => {
      const [groupsResult, resumeResult] = await Promise.allSettled([
        groupsFresh
          ? Promise.resolve(cachedGroups!.data)
          : refreshLibraryGroups(user.id, () => fetchLibraryGroupSummaries(user.id)),
        resumeFresh
          ? Promise.resolve(cachedResume!.data)
          : refreshOfficialResumeCandidates(user.id, () => fetchOfficialResumeCandidates(user.id)),
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

      if (resumeResult.status === 'fulfilled') {
        setOfficialResumeCandidates(resumeResult.value);
      } else {
        const msg =
          resumeResult.reason instanceof Error
            ? resumeResult.reason.message
            : (resumeResult.reason as { message?: string })?.message ?? JSON.stringify(resumeResult.reason);
        console.error('official resume lookup failed:', msg);
        if (!cachedResume) {
          setErrorMsg((current) => current || msg);
          setOfficialResumeCandidates(
            Object.fromEntries(
              OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [
                definition.id,
                { active: null, reinforcement: null },
              ]),
            ) as Record<OfficialLibraryId, OfficialResumeTargets>,
          );
        }
      }

      setIsLoading(false);
    };

    void run();

    return () => { active = false; };
  }, [user]);

  if (isLoading || officialResumeCandidates === undefined) {
    return <LibraryLoading message="正在把你的记忆地图展开" />;
  }

  if (errorMsg) {
    return <LibraryError message={errorMsg} />;
  }

  const customGroups = groups.filter((group) => group.sourceType === 'custom');
  const officialLibraries = OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => ({
    definition,
    summary: buildOfficialLibrarySummary(
      definition.id,
      groups,
      officialResumeCandidates[definition.id] ?? null,
    ),
    existingGroupCount: groups.filter(
      (group) => group.sourceType === 'system' && group.libraryId === definition.id,
    ).length,
  }));

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
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#12192b] text-white">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-text-primary">系统路径</h3>
                <p className="mt-2 text-sm leading-7 text-text-secondary">
                  官方词库不是一堆散词，而是系统替你推进的学习路径。
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {officialLibraries.map(({ definition, summary, existingGroupCount }) => (
              <Fragment key={definition.id}>
                <OfficialLibraryPanel
                  definition={definition}
                  summary={summary}
                  existingGroupCount={existingGroupCount}
                  onStartLearning={onStartLearningGroup}
                  onOpenDetail={() => navigate(`/app/library/official/${definition.id}`)}
                  onLibraryMutated={onLibraryMutated}
                />
              </Fragment>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-text-primary">你带进系统的材料</h3>
                <p className="mt-2 text-sm leading-7 text-text-secondary">
                  自己带进来的词，也会走同一套状态判断和接续机制。
                </p>
              </div>
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
              <p className="mt-4 text-2xl font-black text-text-primary">你还没把自己的词接进来</p>
              <p className="mt-3 text-sm leading-7 text-text-secondary">
                去接入一组词，回来这里就能按组看状态、进度和下次安排。
              </p>
              <button
                type="button"
                onClick={() => navigate('/app/import')}
                className="mt-8 rounded-[24px] bg-apple-blue px-6 py-4 text-base font-black text-white shadow-[0_18px_34px_rgba(0,122,255,0.24)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                去接一组
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
  const { libraryId: rawLibraryId } = useParams();
  const { user } = useAuth();
  
  if (!rawLibraryId || !isOfficialLibraryId(rawLibraryId)) {
    return <Navigate to="/app/library/official/ielts-vocab" replace />;
  }

  const libraryId = rawLibraryId;
  const definition = getOfficialLibraryDefinition(libraryId);
  const [summary, setSummary] = useState<OfficialLibrarySummary>(() => buildOfficialLibrarySummary(libraryId, [], null));
  const [words, setWords] = useState<LibraryGroupWord[]>([]);
  const [existingGroupCount, setExistingGroupCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;

    if (!user) {
      setSummary(buildOfficialLibrarySummary(libraryId, [], null));
      setWords([]);
      setExistingGroupCount(0);
      setIsLoading(false);
      setErrorMsg('');
      return () => { active = false; };
    }

    const cached = getCachedOfficialLibraryDetail(user.id, libraryId);
    if (cached) {
      setSummary(cached.data.summary);
      setWords(cached.data.words);
      setExistingGroupCount(cached.data.existingGroupCount);
      setErrorMsg('');
      setIsLoading(false);
    } else {
      setIsLoading(true);
      setErrorMsg('');
    }

    if (cached && isLibraryCacheFresh(cached)) {
      return () => { active = false; };
    }

    const loadOfficialDetail = async () => {
      try {
        const detail = await refreshOfficialLibraryDetail(
          user.id,
          libraryId,
          () => fetchOfficialLibraryDetail(user.id, libraryId),
        );
        if (!active) return;
        setSummary(detail.summary);
        setWords(detail.words);
        setExistingGroupCount(detail.existingGroupCount);
        setErrorMsg('');
      } catch (error) {
        if (!active) return;
        const msg =
          error instanceof Error
            ? error.message
            : (error as { message?: string })?.message ?? JSON.stringify(error);
        if (!cached) {
          setErrorMsg(msg);
        } else {
          console.error(`official library detail refresh failed for ${libraryId}:`, msg);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadOfficialDetail();

    return () => { active = false; };
  }, [libraryId, user]);

  const selectedWord = useMemo(
    () => words.find((word) => word.id === selectedId) ?? null,
    [selectedId, words],
  );

  if (isLoading) {
    return <LibraryLoading message="正在展开这条系统路径" />;
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
            记忆地图 / 系统路径 / {definition.title}
          </button>
        </div>

        <OfficialLibraryPanel
          definition={definition}
          summary={summary}
          existingGroupCount={existingGroupCount}
          onStartLearning={onStartLearningGroup ?? (() => undefined)}
          onLibraryMutated={onLibraryMutated}
          showOpenDetailAction={false}
        />

        {words.length === 0 ? (
          <div className="glass rounded-[32px] p-12 text-center jelly-shadow">
            <BookOpen className="mx-auto h-10 w-10 text-text-secondary/50" />
            <p className="mt-4 text-2xl font-black text-text-primary">{definition.title} 这条路径还没开始</p>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              点上面的开始下一批，系统会从第一批开始把官方词汇发到这里。
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
                        {String(((getOfficialWordPosition(libraryId, word.word) === Number.MAX_SAFE_INTEGER)
                          ? index
                          : getOfficialWordPosition(libraryId, word.word)) + 1).padStart(4, '0')}
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
    return <LibraryLoading message="正在展开这组状态" />;
  }

  if (errorMsg) {
    return <LibraryError message={errorMsg} />;
  }

  if (!group) {
    return (
      <div className="glass mx-auto max-w-3xl rounded-apple-lg p-14 text-center jelly-shadow">
        <BookOpen className="mx-auto h-10 w-10 text-text-secondary/50" />
        <p className="mt-4 text-2xl font-black text-text-primary">这组材料暂时打不开</p>
        <p className="mt-3 text-sm leading-7 text-text-secondary">
          可能是这组材料已经不在了，也可能它不属于你。
        </p>
        <button
          type="button"
          onClick={() => navigate('/app/library')}
          className="mt-8 rounded-[24px] bg-apple-blue px-6 py-4 text-base font-black text-white"
        >
          回到记忆地图
        </button>
      </div>
    );
  }

  const isSystemGroup = group.sourceType === 'system';
  if (isSystemGroup) {
    return <Navigate to={`/app/library/official/${group.libraryId || 'ielts-vocab'}`} replace />;
  }

  const groupSectionLabel = isSystemGroup ? '系统路径' : '你带进系统的材料';
  const groupHelperLabel = isSystemGroup ? '官方词库' : '你带进来的';

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
              记忆地图 / {groupSectionLabel}
            </button>

            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">
              记忆地图 / {groupSectionLabel} / {formatMonthDay(group.createdAt)}
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
                  正在准备这组
                </>
              ) : (
                <>
                  {resolveGroupActionLabel(group)}
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
                移出这组材料
              </button>
            )}
          </div>
        </div>

        {words.length === 0 ? (
          <div className="glass rounded-[32px] p-12 text-center jelly-shadow">
            <p className="text-2xl font-black text-text-primary">这组材料还没展开出来</p>
            <p className="mt-3 text-sm leading-7 text-text-secondary">
              {isSystemGroup
                ? '稍后再回来看看，正常情况下这里会出现系统路径里的那些词。'
                : '稍后再回来看看，正常情况下这里会出现你接进来的那些词。'}
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
