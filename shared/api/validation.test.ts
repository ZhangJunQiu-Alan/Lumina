import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { validateJson } from './middleware/validator.ts';
import {
  AudioBatchSchema,
  BatchReviewAttemptSchema,
  CompleteLearningRoundSchema,
  CreateGroupFromSavedWordsSchema,
  DiscardActiveOfficialGroupSchema,
  ExampleAudioSchema,
  IeltsListeningAttemptSchema,
  IeltsReadingAttemptSchema,
  LearningPreferencesPatchSchema,
  MarkMasteredSchema,
  MarkUnknownSchema,
  OfficialStartSchema,
  ReorderActiveOfficialGroupSchema,
  ResetPasswordSchema,
  ReviewAttemptSchema,
  SaveLearningSessionSchema,
  SaveWordSchema,
  SignInSchema,
  SignUpSchema,
  UpdatePasswordSchema,
  VocabArticleSchema,
  VocabEnrichSchema,
  VocabFullEnrichSchema,
  VocabLemmatizeBatchSchema,
  VocabLemmatizeSchema,
  VocabLiteEnrichSchema,
  VocabLookupSchema,
  VocabPersistSchema,
  VocabReportSchema,
} from './schemas/index.ts';

describe('Task 3.2: Zod Runtime Schema Validation & Error Contracts', () => {
  describe('Validator Middleware Contract', () => {
    it('returns standardized 400 error payload on invalid body', async () => {
      const app = new Hono<{ Variables: { requestId: string } }>();
      app.use('*', async (c, next) => {
        c.set('requestId', 'req-test-123');
        await next();
      });

      app.post(
        '/api/test/attempt',
        validateJson(ReviewAttemptSchema, 'Missing required attempt fields'),
        (c) => c.json({ ok: true, data: c.req.valid('json') }),
      );

      // 1. Missing required fields
      const res1 = await app.request('/api/test/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res1.status).toBe(400);
      const body1 = (await res1.json()) as any;
      expect(body1).toMatchObject({
        error: 'Missing required attempt fields',
        code: 'VALIDATION_ERROR',
        request_id: 'req-test-123',
      });
      expect(Array.isArray(body1.details)).toBe(true);
      expect(body1.details.length).toBeGreaterThan(0);
      expect(body1.details.some((d: any) => d.path === 'vocabularyItemId')).toBe(true);

      // 2. Invalid source enum value
      const res2 = await app.request('/api/test/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabularyItemId: 'word-1',
          source: 'invalid_source',
          wasCorrect: true,
        }),
      });

      expect(res2.status).toBe(400);
      const body2 = (await res2.json()) as any;
      expect(body2.code).toBe('VALIDATION_ERROR');
      expect(body2.details.some((d: any) => d.path === 'source')).toBe(true);

      // 3. Valid payload passes cleanly
      const res3 = await app.request('/api/test/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabularyItemId: 'word-1',
          source: 'round2',
          wasCorrect: true,
          elapsedMs: 1200,
        }),
      });

      expect(res3.status).toBe(200);
      const body3 = (await res3.json()) as any;
      expect(body3.ok).toBe(true);
      expect(body3.data).toMatchObject({
        vocabularyItemId: 'word-1',
        source: 'round2',
        wasCorrect: true,
        elapsedMs: 1200,
      });
    });
  });

  describe('Review Schemas', () => {
    it('validates ReviewAttemptSchema', () => {
      expect(
        ReviewAttemptSchema.safeParse({
          vocabularyItemId: 'v-1',
          source: 'review',
          wasCorrect: false,
          elapsedMs: 500,
        }).success,
      ).toBe(true);

      expect(
        ReviewAttemptSchema.safeParse({
          vocabularyItemId: '',
          source: 'review',
          wasCorrect: false,
        }).success,
      ).toBe(false);
    });

    it('validates BatchReviewAttemptSchema', () => {
      expect(
        BatchReviewAttemptSchema.safeParse({
          attempts: [
            { vocabularyItemId: 'v-1', source: 'round2', wasCorrect: true },
            { vocabularyItemId: 'v-2', source: 'round3', wasCorrect: false },
          ],
        }).success,
      ).toBe(true);

      expect(BatchReviewAttemptSchema.safeParse({ attempts: 'not-an-array' }).success).toBe(false);
    });

    it('validates MarkUnknownSchema and MarkMasteredSchema', () => {
      expect(MarkUnknownSchema.safeParse({ vocabularyItemId: 'v-1' }).success).toBe(true);
      expect(MarkUnknownSchema.safeParse({}).success).toBe(false);

      expect(MarkMasteredSchema.safeParse({ vocabularyItemId: 'v-1' }).success).toBe(true);
      expect(MarkMasteredSchema.safeParse({ vocabularyItemId: '   ' }).success).toBe(false);
    });
  });

  describe('Learning Schemas', () => {
    it('validates OfficialStartSchema', () => {
      expect(OfficialStartSchema.safeParse({ mode: 'sequential' }).success).toBe(true);
      expect(OfficialStartSchema.safeParse({ mode: 'shuffle', timeZone: 'Asia/Shanghai' }).success).toBe(true);
      expect(OfficialStartSchema.safeParse({ mode: 'unknown_mode' }).success).toBe(false);
    });

    it('validates SaveLearningSessionSchema', () => {
      expect(
        SaveLearningSessionSchema.safeParse({
          round: 'round1',
          currentIndex: 0,
          queueWordIds: ['w1', 'w2'],
        }).success,
      ).toBe(true);

      expect(
        SaveLearningSessionSchema.safeParse({
          round: 'invalid_round',
          queueWordIds: [],
        }).success,
      ).toBe(false);
    });

    it('validates CompleteLearningRoundSchema', () => {
      expect(
        CompleteLearningRoundSchema.safeParse({
          round: 'round2',
          confirmedWordIds: ['w1'],
        }).success,
      ).toBe(true);

      expect(CompleteLearningRoundSchema.safeParse({ round: 'article' }).success).toBe(false);
    });
  });

  describe('Library Schemas', () => {
    it('validates SaveWordSchema and sources', () => {
      expect(SaveWordSchema.safeParse({ vocabularyItemId: 'v-1' }).success).toBe(true);
      expect(SaveWordSchema.safeParse({ vocabularyItemId: 'v-1', source: 'manual' }).success).toBe(true);
      expect(SaveWordSchema.safeParse({ vocabularyItemId: 'v-1', source: 'invalid' }).success).toBe(false);
    });

    it('validates CreateGroupFromSavedWordsSchema', () => {
      expect(CreateGroupFromSavedWordsSchema.safeParse({ vocabularyItemIds: ['v-1', 'v-2'] }).success).toBe(true);
      expect(CreateGroupFromSavedWordsSchema.safeParse({ vocabularyItemIds: [] }).success).toBe(false);
    });

    it('validates DiscardActiveOfficialGroupSchema and ReorderActiveOfficialGroupSchema', () => {
      expect(DiscardActiveOfficialGroupSchema.safeParse({ groupId: 'g-1' }).success).toBe(true);
      expect(DiscardActiveOfficialGroupSchema.safeParse({}).success).toBe(false);

      expect(ReorderActiveOfficialGroupSchema.safeParse({ groupId: 'g-1', mode: 'shuffle' }).success).toBe(true);
      expect(ReorderActiveOfficialGroupSchema.safeParse({ groupId: 'g-1', mode: 'random' }).success).toBe(false);
    });
  });

  describe('Settings Schemas', () => {
    it('validates LearningPreferencesPatchSchema', () => {
      expect(
        LearningPreferencesPatchSchema.safeParse({
          dailyNewWordTarget: 20,
          pronunciationSpeed: 'normal',
          soundEffectsEnabled: true,
        }).success,
      ).toBe(true);

      expect(
        LearningPreferencesPatchSchema.safeParse({
          pronunciationSpeed: 'super-sonic',
        }).success,
      ).toBe(false);
    });
  });

  describe('Vocab Schemas', () => {
    it('validates VocabEnrichSchema and VocabArticleSchema', () => {
      expect(VocabEnrichSchema.safeParse({ words: ['apple', 'banana'] }).success).toBe(true);
      expect(VocabEnrichSchema.safeParse({ words: [] }).success).toBe(false);

      expect(VocabArticleSchema.safeParse({ words: ['ephemeral'] }).success).toBe(true);
      expect(VocabArticleSchema.safeParse({ words: [] }).success).toBe(false);
    });

    it('validates VocabLiteEnrichSchema, VocabLemmatizeSchema, and VocabLookupSchema', () => {
      expect(VocabLiteEnrichSchema.safeParse({ word: 'serendipity' }).success).toBe(true);
      expect(VocabLiteEnrichSchema.safeParse({ word: '' }).success).toBe(false);

      expect(VocabLemmatizeSchema.safeParse({ word: 'running' }).success).toBe(true);
      expect(VocabLookupSchema.safeParse({ word: 'halcyon' }).success).toBe(true);
      expect(VocabFullEnrichSchema.safeParse({ word: 'luminous' }).success).toBe(true);
    });

    it('validates VocabLemmatizeBatchSchema', () => {
      expect(VocabLemmatizeBatchSchema.safeParse({ words: ['running', 'faster'] }).success).toBe(true);
      expect(VocabLemmatizeBatchSchema.safeParse({ words: [] }).success).toBe(false);
    });

    it('validates VocabReportSchema and issue types', () => {
      expect(
        VocabReportSchema.safeParse({
          vocabularyItemId: 'v-1',
          issueType: 'pronunciation',
          note: 'Audio is missing syllable',
        }).success,
      ).toBe(true);

      expect(
        VocabReportSchema.safeParse({
          vocabularyItemId: 'v-1',
          issueType: 'unsupported_type',
        }).success,
      ).toBe(false);
    });

    it('validates VocabPersistSchema', () => {
      expect(
        VocabPersistSchema.safeParse({
          entries: [{ word: 'eloquent', definition: 'fluent' }],
          sourceType: 'custom',
        }).success,
      ).toBe(true);

      expect(VocabPersistSchema.safeParse({ entries: [] }).success).toBe(false);
    });
  });

  describe('Audio Schemas', () => {
    it('validates AudioBatchSchema and ExampleAudioSchema', () => {
      expect(AudioBatchSchema.safeParse({ words: ['hello'] }).success).toBe(true);
      expect(AudioBatchSchema.safeParse({ words: [] }).success).toBe(false);

      expect(ExampleAudioSchema.safeParse({ text: 'Hello world', locale: 'uk' }).success).toBe(true);
      expect(ExampleAudioSchema.safeParse({ text: 'Hello world', locale: 'fr' }).success).toBe(false);
      expect(ExampleAudioSchema.safeParse({ text: '', locale: 'us' }).success).toBe(false);
    });
  });

  describe('IELTS Schemas', () => {
    it('validates IeltsReadingAttemptSchema and IeltsListeningAttemptSchema', () => {
      expect(
        IeltsReadingAttemptSchema.safeParse({
          testId: 'test-reading-1',
          passageIndex: 0,
          elapsedMs: 3400,
          responses: [{ questionId: 'q1', answer: 'TRUE' }],
        }).success,
      ).toBe(true);

      expect(IeltsReadingAttemptSchema.safeParse({ testId: '' }).success).toBe(false);

      expect(
        IeltsListeningAttemptSchema.safeParse({
          testId: 'test-listening-1',
          sectionIndex: 1,
          elapsedMs: 2000,
        }).success,
      ).toBe(true);

      expect(IeltsListeningAttemptSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('Auth Schemas', () => {
    it('validates SignInSchema', () => {
      expect(SignInSchema.safeParse({ email: 'user@example.com', password: 'password123' }).success).toBe(true);
      expect(SignInSchema.safeParse({ email: '', password: '123' }).success).toBe(false);
      expect(SignInSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(false);
    });

    it('validates SignUpSchema', () => {
      expect(
        SignUpSchema.safeParse({
          email: 'user@example.com',
          password: 'password123',
          fullName: 'Alan Turing',
        }).success,
      ).toBe(true);

      // Password less than 8 chars
      expect(
        SignUpSchema.safeParse({
          email: 'user@example.com',
          password: 'short',
        }).success,
      ).toBe(false);

      // Invalid email
      expect(
        SignUpSchema.safeParse({
          email: 'not-an-email',
          password: 'password123',
        }).success,
      ).toBe(false);
    });

    it('validates UpdatePasswordSchema and ResetPasswordSchema', () => {
      expect(UpdatePasswordSchema.safeParse({ password: 'new-secure-pass' }).success).toBe(true);
      expect(UpdatePasswordSchema.safeParse({ password: '123' }).success).toBe(false);

      expect(ResetPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
      expect(ResetPasswordSchema.safeParse({ email: '' }).success).toBe(false);
    });
  });
});
