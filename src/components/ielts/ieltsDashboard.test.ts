import { describe, expect, it } from 'vitest';
import type {
  IeltsListeningAttemptSummary,
  IeltsListeningBookSummary,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
} from '../../types';
import { buildIeltsDashboardModel } from './ieltsDashboard';

function readingBook(testIds: string[]): IeltsReadingBookSummary {
  return {
    id: 'reading-book-4',
    bookNumber: 4,
    title: 'Cambridge IELTS 4',
    sourceLabel: '',
    tests: testIds.map((id, index) => ({
      id,
      bookId: 'reading-book-4',
      bookNumber: 4,
      bookTitle: 'Cambridge IELTS 4',
      testNumber: index + 1,
      title: `Test ${index + 1}`,
      passageCount: 3,
      questionCount: 40,
    })),
  };
}

function listeningBook(testIds: string[]): IeltsListeningBookSummary {
  return {
    id: 'listening-book-4',
    bookNumber: 4,
    title: 'Cambridge IELTS 4',
    sourceLabel: '',
    tests: testIds.map((id, index) => ({
      id,
      bookId: 'listening-book-4',
      bookNumber: 4,
      bookTitle: 'Cambridge IELTS 4',
      testNumber: index + 1,
      title: `Test ${index + 1}`,
      sectionCount: 4,
      questionCount: 40,
    })),
  };
}

function readingAttempt(id: string, testId: string, score: number, submittedAt: string): IeltsReadingAttemptSummary {
  return {
    id,
    testId,
    bookTitle: 'Cambridge IELTS 4',
    bookNumber: 4,
    testNumber: Number(testId.replace(/\D/g, '')) || 1,
    score,
    totalQuestions: 40,
    elapsedSeconds: 3600,
    submittedAt,
  };
}

function listeningAttempt(
  id: string,
  testId: string,
  score: number,
  submittedAt: string,
): IeltsListeningAttemptSummary {
  return {
    id,
    testId,
    bookTitle: 'Cambridge IELTS 4',
    bookNumber: 4,
    testNumber: Number(testId.replace(/\D/g, '')) || 1,
    score,
    totalQuestions: 40,
    elapsedSeconds: 1800,
    submittedAt,
  };
}

describe('buildIeltsDashboardModel', () => {
  it('handles a completely empty IELTS account without fake progress', () => {
    const model = buildIeltsDashboardModel({
      readingBooks: [],
      listeningBooks: [],
      readingAttempts: [],
      listeningAttempts: [],
      targetScore: 7,
    });

    expect(model.availablePracticeCount).toBe(0);
    expect(model.completedPracticeCount).toBe(0);
    expect(model.currentBand).toBeNull();
    expect(model.recommendation.kind).toBe('none');
  });

  it('recommends the first available reading test when there is content but no attempts', () => {
    const model = buildIeltsDashboardModel({
      readingBooks: [readingBook(['r1'])],
      listeningBooks: [listeningBook(['l1'])],
      readingAttempts: [],
      listeningAttempts: [],
      targetScore: 7,
    });

    expect(model.overallProgressPercent).toBe(0);
    expect(model.currentBand).toBeNull();
    expect(model.recommendation.kind).toBe('start');
    expect(model.recommendation.moduleKey).toBe('reading');
    expect(model.recommendation.route).toBe('/app/ielts-reading/test/r1');
  });

  it('uses one module of practice records to estimate the current band', () => {
    const model = buildIeltsDashboardModel({
      readingBooks: [readingBook(['r1', 'r2'])],
      listeningBooks: [],
      readingAttempts: [readingAttempt('a1', 'r1', 20, '2026-05-30T10:00:00.000Z')],
      listeningAttempts: [],
      targetScore: 7,
    });

    expect(model.reading.completedTests).toBe(1);
    expect(model.reading.progressPercent).toBe(50);
    expect(model.currentBand).toBe(4.5);
  });

  it('averages reading and listening records for the current band and sorts recent attempts', () => {
    const model = buildIeltsDashboardModel({
      readingBooks: [readingBook(['r1'])],
      listeningBooks: [listeningBook(['l1'])],
      readingAttempts: [readingAttempt('a1', 'r1', 24, '2026-05-30T10:00:00.000Z')],
      listeningAttempts: [listeningAttempt('a2', 'l1', 32, '2026-05-31T10:00:00.000Z')],
      targetScore: 7.5,
    });

    expect(model.currentBand).toBe(6.5);
    expect(model.completedPracticeCount).toBe(2);
    expect(model.overallProgressPercent).toBe(100);
    expect(model.recentAttempts.map((attempt) => attempt.id)).toEqual(['a2', 'a1']);
  });

  it('recommends retrying the lowest score when all available tests are completed', () => {
    const model = buildIeltsDashboardModel({
      readingBooks: [readingBook(['r1'])],
      listeningBooks: [listeningBook(['l1'])],
      readingAttempts: [readingAttempt('a1', 'r1', 35, '2026-05-30T10:00:00.000Z')],
      listeningAttempts: [listeningAttempt('a2', 'l1', 20, '2026-05-31T10:00:00.000Z')],
      targetScore: 7,
    });

    expect(model.recommendation.kind).toBe('retry');
    expect(model.recommendation.moduleKey).toBe('listening');
    expect(model.recommendation.route).toBe('/app/ielts-listening/test/l1');
  });
});
