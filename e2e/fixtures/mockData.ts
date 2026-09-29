import type { Word, UserStats } from '../../src/types';

export const MOCK_USER = {
  id: 'e2e-user-42',
  email: 'tester@lumina.io',
  user_metadata: {
    full_name: 'Lumina Explorer',
  },
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

export const MOCK_SESSION = {
  access_token: 'mock-jwt-token-lumina-e2e',
  refresh_token: 'mock-refresh-token-lumina-e2e',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: MOCK_USER,
};

export const MOCK_WORDS: Word[] = [
  {
    id: 'word-resilient',
    word: 'resilient',
    phonetic: 'rɪˈzɪliənt',
    ipa_us: 'rɪˈzɪliənt',
    ipa_uk: 'rɪˈzɪliənt',
    pos_tags: ['adj.'],
    chinese_definition: '有弹性的；能迅速恢复的',
    senses: [
      {
        pos: 'adj.',
        meaning_zh: '有弹性的；能迅速恢复的',
        example_sentence: 'The local economy proved remarkably resilient during the crisis.',
        example_translation_zh: '在危机期间，当地经济展现出了惊人的韧性。',
      },
    ],
    example_sentences: ['The local economy proved remarkably resilient during the crisis.'],
    ner_entities: [],
    synonyms: [],
    antonyms: [],
    confusingPairs: [],
    memory_tip: 're(反复) + sili(跳跃) + ent -> 弹跳力强 -> 有韧性的',
    derivedWords: [],
    morphology: {
      summaryZh: '由 re- 与 -silient 构成',
      parts: [
        { text: 're-', kind: 'prefix', meaningZh: '重新', noteZh: '反复' },
        { text: '-silient', kind: 'root', meaningZh: '跳跃', noteZh: '弹起' },
      ],
    },
    round2ChoiceDistractors: [
      { word: 'fragile', pos: 'adj.', meaning_zh: '易碎的；脆弱的' },
      { word: 'sluggish', pos: 'adj.', meaning_zh: '迟钝的；萧条的' },
      { word: 'rigid', pos: 'adj.', meaning_zh: '僵硬的；死板的' },
    ],
  },
  {
    id: 'word-catalyst',
    word: 'catalyst',
    phonetic: 'ˈkætəlɪst',
    ipa_us: 'ˈkætəlɪst',
    ipa_uk: 'ˈkætəlɪst',
    pos_tags: ['n.'],
    chinese_definition: '催化剂；促成变化的人或事',
    senses: [
      {
        pos: 'n.',
        meaning_zh: '催化剂；促成变化的人或事',
        example_sentence: 'The breakthrough acted as a catalyst for sustainable growth.',
        example_translation_zh: '这项突破成为了可持续增长的催化剂。',
      },
    ],
    example_sentences: ['The breakthrough acted as a catalyst for sustainable growth.'],
    ner_entities: [],
    synonyms: [],
    antonyms: [],
    confusingPairs: [],
    memory_tip: 'cata(向下) + lyst(溶解) -> 促进溶解 -> 催化剂',
    derivedWords: [],
    morphology: {
      summaryZh: '由 cata- 与 -lyst 构成',
      parts: [
        { text: 'cata-', kind: 'prefix', meaningZh: '向下', noteZh: '彻底' },
        { text: '-lyst', kind: 'root', meaningZh: '溶解', noteZh: '分解' },
      ],
    },
    round2ChoiceDistractors: [
      { word: 'obstacle', pos: 'n.', meaning_zh: '障碍；妨碍物' },
      { word: 'deterrent', pos: 'n.', meaning_zh: '威慑物；遏制因素' },
      { word: 'byproduct', pos: 'n.', meaning_zh: '副产品' },
    ],
  },
];

export function createMockHomeStats(mode: 'start_learning' | 'start_review' = 'start_learning'): UserStats {
  const isReview = mode === 'start_review';

  return {
    streak: 5,
    todayReviewCount: 5,
    stableRecallCount: 110,
    perfectCheckinDays: 12,
    selectedDate: '2026-09-25',
    selectedDayReviewWordCount: 5,
    selectedDayLearnedWordCount: 10,
    resumeCandidate: null,
    orbitDays: [
      {
        date: '2026-09-19',
        weekdayLabel: '周六',
        shortDateLabel: '09.19',
        status: 'perfect',
        reviewWordCount: 10,
        learnedWordCount: 20,
      },
      {
        date: '2026-09-20',
        weekdayLabel: '周日',
        shortDateLabel: '09.20',
        status: 'ordinary',
        reviewWordCount: 5,
        learnedWordCount: 15,
      },
      {
        date: '2026-09-21',
        weekdayLabel: '周一',
        shortDateLabel: '09.21',
        status: 'perfect',
        reviewWordCount: 12,
        learnedWordCount: 25,
      },
      {
        date: '2026-09-22',
        weekdayLabel: '周二',
        shortDateLabel: '09.22',
        status: 'shielded',
        reviewWordCount: 0,
        learnedWordCount: 0,
      },
      {
        date: '2026-09-23',
        weekdayLabel: '周三',
        shortDateLabel: '09.23',
        status: 'perfect',
        reviewWordCount: 8,
        learnedWordCount: 30,
      },
      {
        date: '2026-09-24',
        weekdayLabel: '周四',
        shortDateLabel: '09.24',
        status: 'ordinary',
        reviewWordCount: 6,
        learnedWordCount: 10,
      },
      {
        date: '2026-09-25',
        weekdayLabel: '周五',
        shortDateLabel: '09.25',
        status: 'perfect',
        reviewWordCount: 5,
        learnedWordCount: 10,
      },
    ],
    routineCard: {
      state: isReview ? 'not_started' : 'in_progress',
      ctaMode: isReview ? 'start_review' : 'continue_learning',
      ctaLabel: isReview ? '开始复习' : '开始学习',
      title: isReview ? '今日复习准备就绪' : '开启今日新词学习',
      subtitle: isReview ? '巩固 1 个即将淡化的单词' : '第 1 组 · 雅思核心词汇',
      boundLearningGroupId: isReview ? null : 'group-e2e-1',
      lastUsedOfficialLibraryId: 'ielts-vocab',
      lastUsedOfficialMode: 'sequential',
      lastUsedOfficialGroupCount: 1,
      selectedOfficialLibraryId: 'ielts-vocab',
      officialLibraryOptions: [
        {
          libraryId: 'ielts-vocab',
          title: '雅思核心词汇',
          mode: 'sequential',
          existingGroupCount: 1,
          activeGroupId: isReview ? null : 'group-e2e-1',
          activeRound: 'round1',
          confirmedWordCount: 0,
          loadedWordCount: 2,
          completedMemoryWordCount: 0,
          totalWordCount: 200,
        },
      ],
      visibleSteps: [
        { key: 'round1', label: '初识认知', status: 'current' },
        { key: 'round2', label: '语境复现', status: 'upcoming' },
        { key: 'round3', label: '快速确认', status: 'upcoming' },
        { key: 'review', label: '打卡复习', status: 'upcoming' },
      ],
    },
  };
}
