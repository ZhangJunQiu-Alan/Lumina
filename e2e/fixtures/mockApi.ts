import type { Page } from '@playwright/test';
import { MOCK_SESSION, MOCK_USER, MOCK_WORDS, createMockHomeStats } from './mockData';
import type { Word, UserStats, ReviewWord } from '../../src/types';

export interface SetupApiMockOptions {
  authenticated?: boolean;
  homeStats?: UserStats;
  words?: Word[];
  reviewWords?: ReviewWord[];
}

export async function setupApiMocks(page: Page, options: SetupApiMockOptions = {}) {
  const {
    authenticated = true,
    homeStats = createMockHomeStats(),
    words = MOCK_WORDS,
    reviewWords = [
      {
        ...MOCK_WORDS[0],
        memory_state: 'fuzzy' as const,
        due_at: new Date().toISOString(),
      },
    ],
  } = options;

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[BROWSER CONSOLE ERROR]:', msg.text());
  });
  page.on('pageerror', (err) => {
    console.log('[BROWSER UNCAUGHT ERROR]:', err.message);
  });

  await page.addInitScript(
    ({ isAuth, session, user, wordsList }) => {
      // 1. Suppress What's New modal during E2E tests
      window.localStorage.setItem('lumina_whatsnew_2026_06_02_known_fixes_v1', 'true');

      // 2. Set or clear auth session
      if (isAuth) {
        window.localStorage.setItem('lumina.localAuth.session', JSON.stringify(session));

        // 3. Preload active learning recovery cache for immediate, zero-lag session launch
        const recoveryData = {
          groupTitle: '第 1 组 · 雅思核心词汇',
          words: wordsList,
          session: {
            groupId: 'group-e2e-1',
            round: 'round1',
            currentIndex: 0,
            queueWordIds: wordsList.map((w: any) => w.id),
            passedQueueIndices: [],
            round1ConfirmedWordIds: [],
            libraryId: 'ielts',
            officialMode: 'sequential',
            lastActiveAt: new Date().toISOString(),
          },
        };
        window.localStorage.setItem(
          `lumina.learning-cache.v1.${user.id}.group-e2e-1`,
          JSON.stringify(recoveryData),
        );
      } else {
        window.localStorage.removeItem('lumina.localAuth.session');
      }
    },
    { isAuth: authenticated, session: MOCK_SESSION, user: MOCK_USER, wordsList: words },
  );

  // Intercept all API endpoints
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    // 1. Auth routes
    if (path.includes('/api/auth/session')) {
      if (!authenticated) {
        return route.fulfill({ status: 401, json: { error: 'Unauthorized', session: null } });
      }
      return route.fulfill({ status: 200, json: { session: MOCK_SESSION } });
    }

    if (path.includes('/api/auth/sign-in') || path.includes('/api/auth/sign-up')) {
      return route.fulfill({
        status: 200,
        json: {
          session: MOCK_SESSION,
          user: MOCK_USER,
        },
      });
    }

    if (path.includes('/api/auth/sign-out')) {
      return route.fulfill({ status: 200, json: { success: true } });
    }

    // 2. Home overview & Activity heatmap
    if (path.includes('/api/home/overview')) {
      return route.fulfill({
        status: 200,
        json: {
          data: homeStats,
        },
      });
    }

    if (path.includes('/api/user/activity-heatmap') || path.includes('/api/home/activity-heatmap')) {
      return route.fulfill({
        status: 200,
        json: { data: [] },
      });
    }

    // 3. Review routes
    if (path.includes('/api/review/due')) {
      return route.fulfill({
        status: 200,
        json: {
          data: reviewWords,
        },
      });
    }

    if (path.includes('/api/review/batch-attempt')) {
      let attemptsCount = 1;
      try {
        const postData = route.request().postDataJSON() as { attempts?: unknown[] } | null;
        if (Array.isArray(postData?.attempts)) {
          attemptsCount = postData.attempts.length;
        }
      } catch {
        attemptsCount = 1;
      }
      return route.fulfill({
        status: 200,
        json: {
          data: Array.from({ length: attemptsCount }, () => ({
            success: true,
            transition: {
              from: 'fuzzy',
              to: 'slow_recall',
              graduated: false,
            },
          })),
        },
      });
    }

    if (path.includes('/api/review/attempt') || path.includes('/api/review/atomic-attempt')) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            success: true,
            transition: {
              from: 'fuzzy',
              to: 'slow_recall',
              graduated: false,
            },
          },
        },
      });
    }

    if (path.includes('/api/review/events')) {
      return route.fulfill({
        status: 200,
        json: { data: { success: true } },
      });
    }

    // 4. Learning & Official Batch routes
    if (path.includes('/api/learning/official/start-batch')) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            groupId: 'group-e2e-1',
            libraryId: 'ielts',
            mode: 'sequential',
            words,
          },
        },
      });
    }

    if (path.includes('/api/learning/groups/')) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            id: 'group-e2e-1',
            title: '第 1 组 · 雅思核心词汇',
            words,
          },
        },
      });
    }

    if (path.includes('/api/learning/session/')) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            session: null,
          },
        },
      });
    }

    if (path.includes('/api/learning/atomic-complete') || path.includes('/api/learning/complete-group')) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            success: true,
            completedWordsCount: words.length,
          },
        },
      });
    }

    // 5. Vocab & Article routes
    if (path.includes('/api/vocab/article')) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            sentences: [
              {
                english: 'A resilient economy acts as a catalyst for sustainable growth.',
                chinese: '具有韧性的经济体是可持续增长的催化剂。',
              },
            ],
          },
        },
      });
    }

    // 6. Audio fallback
    if (path.includes('/api/audio/')) {
      return route.fulfill({
        status: 200,
        json: { data: { audioUrl: null } },
      });
    }

    if (path.includes('/api/vocab/lookup')) {
      return route.fulfill({
        status: 200,
        json: { data: null, missing: true },
      });
    }

    // Default API fallback
    return route.fulfill({
      status: 200,
      json: { data: {} },
    });
  });

  // Intercept all Supabase PostgREST or RPC fallback calls
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.includes('rpc/official_next_batch')) {
      return route.fulfill({
        status: 200,
        json: words.map((w, index) => ({ word: w.word, word_position: index + 1 })),
      });
    }

    if (path.includes('learning_groups')) {
      return route.fulfill({
        status: 200,
        json: [
          {
            id: 'group-e2e-1',
            group_name: '第 1 组 · 雅思核心词汇',
            source_type: 'system',
            library_id: 'ielts',
            created_at: new Date().toISOString(),
            status: 'active',
            session_round: 'round1',
            session_current_index: 0,
            session_queue_word_ids: words.map((w) => w.id),
            session_passed_queue_indices: [],
            session_round1_confirmed_word_ids: [],
            session_last_active_at: new Date().toISOString(),
          },
        ],
      });
    }

    if (path.includes('learning_group_words')) {
      return route.fulfill({
        status: 200,
        json: words.map((w, index) => ({
          sequence_no: index + 1,
          vocabulary_item_id: w.id,
          round1_confirmed_at: null,
          round2_completed_at: null,
          round3_completed_at: null,
          learned_at: null,
          round2_required: true,
          round3_required: true,
          vocabulary_items: {
            id: w.id,
            word: w.word,
            ipa_uk: w.ipa_uk ?? w.phonetic,
            ipa_us: w.ipa_us ?? w.phonetic,
            primary_meaning_zh: w.chinese_definition,
            ner_label: null,
            morphology_summary_zh: null,
            memory_tip: w.memory_tip,
            audio_uk_url: null,
            audio_us_url: null,
            round2_choice_distractors: w.round2ChoiceDistractors,
            vocabulary_senses: [
              {
                pos: w.pos_tags[0] ?? 'n.',
                meaning_zh: w.chinese_definition,
                example_sentence: w.senses[0]?.example_sentence ?? w.example_sentences[0] ?? '',
                example_translation_zh: w.senses[0]?.example_translation_zh ?? '',
              },
            ],
            vocabulary_morphology_parts: [],
            vocabulary_relations: [],
            confused_words: [],
          },
        })),
      });
    }

    if (path.includes('vocabulary_items')) {
      return route.fulfill({
        status: 200,
        json: words.map((w) => ({
          id: w.id,
          word: w.word,
          ipa_us: w.ipa_us ?? w.phonetic,
          ipa_uk: w.ipa_uk ?? w.phonetic,
          primary_meaning_zh: w.chinese_definition,
          pos_tags: w.pos_tags,
          collocations: [],
          example_sentences: w.example_sentences,
          round2_choice_distractors: w.round2ChoiceDistractors,
        })),
      });
    }

    return route.fulfill({
      status: 200,
      json: [],
    });
  });
}
