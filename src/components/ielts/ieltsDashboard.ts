import type {
  IeltsListeningAttemptSummary,
  IeltsListeningBookSummary,
  IeltsListeningTestSummary,
  IeltsReadingAttemptSummary,
  IeltsReadingBookSummary,
  IeltsReadingTestSummary,
} from '../../types';

export type IeltsDashboardModuleKey = 'reading' | 'listening';

export interface IeltsDashboardTest {
  id: string;
  moduleKey: IeltsDashboardModuleKey;
  bookNumber: number;
  testNumber: number;
  title: string;
  questionCount: number;
}

export interface IeltsDashboardAttempt {
  id: string;
  moduleKey: IeltsDashboardModuleKey;
  moduleLabel: string;
  testId: string;
  bookNumber: number;
  testNumber: number;
  score: number;
  totalQuestions: number;
  elapsedSeconds: number;
  submittedAt: string;
  accuracyPercent: number;
}

export interface IeltsDashboardModuleProgress {
  key: IeltsDashboardModuleKey;
  totalTests: number;
  completedTests: number;
  questionCount: number;
  attemptCount: number;
  progressPercent: number;
  averageAccuracyPercent: number | null;
  nextTest: IeltsDashboardTest | null;
}

export interface IeltsDashboardRecommendation {
  kind: 'start' | 'retry' | 'none';
  moduleKey: IeltsDashboardModuleKey | null;
  title: string;
  description: string;
  ctaLabel: string;
  route: string | null;
  estimatedMinutes: number | null;
}

export interface IeltsDashboardModel {
  reading: IeltsDashboardModuleProgress;
  listening: IeltsDashboardModuleProgress;
  recentAttempts: IeltsDashboardAttempt[];
  completedPracticeCount: number;
  availablePracticeCount: number;
  overallProgressPercent: number;
  currentBand: number | null;
  targetScore: number;
  recommendation: IeltsDashboardRecommendation;
}

const MODULE_LABELS: Record<IeltsDashboardModuleKey, string> = {
  reading: '阅读',
  listening: '听力',
};

function compareTests(left: IeltsDashboardTest, right: IeltsDashboardTest) {
  return left.bookNumber - right.bookNumber || left.testNumber - right.testNumber;
}

function compareAttemptsByDate(left: IeltsDashboardAttempt, right: IeltsDashboardAttempt) {
  const leftTime = Date.parse(left.submittedAt) || 0;
  const rightTime = Date.parse(right.submittedAt) || 0;
  return rightTime - leftTime;
}

function mapReadingTest(test: IeltsReadingTestSummary): IeltsDashboardTest {
  return {
    id: test.id,
    moduleKey: 'reading',
    bookNumber: test.bookNumber,
    testNumber: test.testNumber,
    title: test.title,
    questionCount: test.questionCount,
  };
}

function mapListeningTest(test: IeltsListeningTestSummary): IeltsDashboardTest {
  return {
    id: test.id,
    moduleKey: 'listening',
    bookNumber: test.bookNumber,
    testNumber: test.testNumber,
    title: test.title,
    questionCount: test.questionCount,
  };
}

function flattenReadingTests(books: IeltsReadingBookSummary[]): IeltsDashboardTest[] {
  return books.flatMap((book) => book.tests.map(mapReadingTest)).sort(compareTests);
}

function flattenListeningTests(books: IeltsListeningBookSummary[]): IeltsDashboardTest[] {
  return books.flatMap((book) => book.tests.map(mapListeningTest)).sort(compareTests);
}

function mapReadingAttempt(attempt: IeltsReadingAttemptSummary): IeltsDashboardAttempt {
  return mapAttempt('reading', attempt);
}

function mapListeningAttempt(attempt: IeltsListeningAttemptSummary): IeltsDashboardAttempt {
  return mapAttempt('listening', attempt);
}

function mapAttempt(
  moduleKey: IeltsDashboardModuleKey,
  attempt: IeltsReadingAttemptSummary | IeltsListeningAttemptSummary,
): IeltsDashboardAttempt {
  const safeTotal = Math.max(0, attempt.totalQuestions);
  const accuracyPercent = safeTotal > 0 ? Math.round((attempt.score / safeTotal) * 100) : 0;

  return {
    id: attempt.id,
    moduleKey,
    moduleLabel: MODULE_LABELS[moduleKey],
    testId: attempt.testId,
    bookNumber: attempt.bookNumber,
    testNumber: attempt.testNumber,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    elapsedSeconds: attempt.elapsedSeconds,
    submittedAt: attempt.submittedAt,
    accuracyPercent,
  };
}

function averageAccuracyPercent(attempts: IeltsDashboardAttempt[]) {
  const scoredAttempts = attempts.filter((attempt) => attempt.totalQuestions > 0);
  if (scoredAttempts.length === 0) return null;

  const totalAccuracy = scoredAttempts.reduce(
    (sum, attempt) => sum + attempt.score / Math.max(1, attempt.totalQuestions),
    0,
  );
  return Math.round((totalAccuracy / scoredAttempts.length) * 100);
}

function summarizeModule(
  key: IeltsDashboardModuleKey,
  tests: IeltsDashboardTest[],
  attempts: IeltsDashboardAttempt[],
): IeltsDashboardModuleProgress {
  const testIds = new Set(tests.map((test) => test.id));
  const completedIds = new Set(attempts.map((attempt) => attempt.testId).filter((testId) => testIds.has(testId)));
  const nextTest = tests.find((test) => !completedIds.has(test.id)) ?? null;
  const totalTests = tests.length;
  const completedTests = completedIds.size;

  return {
    key,
    totalTests,
    completedTests,
    questionCount: tests.reduce((count, test) => count + test.questionCount, 0),
    attemptCount: attempts.length,
    progressPercent: totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0,
    averageAccuracyPercent: averageAccuracyPercent(attempts),
    nextTest,
  };
}

function roundToHalfBand(value: number) {
  return Math.min(9, Math.max(0, Math.round(value * 2) / 2));
}

function deriveCurrentBand(attempts: IeltsDashboardAttempt[]) {
  const scoredAttempts = attempts.filter((attempt) => attempt.totalQuestions > 0);
  if (scoredAttempts.length === 0) return null;

  const averageAccuracy =
    scoredAttempts.reduce((sum, attempt) => sum + attempt.score / Math.max(1, attempt.totalQuestions), 0) /
    scoredAttempts.length;
  return roundToHalfBand(averageAccuracy * 9);
}

function routeForTest(moduleKey: IeltsDashboardModuleKey, testId: string) {
  return moduleKey === 'reading' ? `/app/ielts-reading/test/${testId}` : `/app/ielts-listening/test/${testId}`;
}

function chooseNextModule(
  reading: IeltsDashboardModuleProgress,
  listening: IeltsDashboardModuleProgress,
): IeltsDashboardModuleProgress | null {
  const candidates = [reading, listening].filter((module) => module.nextTest);
  if (candidates.length === 0) return null;

  const untouched = candidates.find((module) => module.attemptCount === 0);
  if (untouched) return untouched;

  return candidates.slice().sort((left, right) => {
    const leftAccuracy = left.averageAccuracyPercent ?? 101;
    const rightAccuracy = right.averageAccuracyPercent ?? 101;
    return (
      leftAccuracy - rightAccuracy || left.progressPercent - right.progressPercent || (left.key === 'reading' ? -1 : 1)
    );
  })[0];
}

function buildRecommendation(
  reading: IeltsDashboardModuleProgress,
  listening: IeltsDashboardModuleProgress,
  allAttempts: IeltsDashboardAttempt[],
): IeltsDashboardRecommendation {
  const nextModule = chooseNextModule(reading, listening);
  if (nextModule?.nextTest) {
    const moduleLabel = MODULE_LABELS[nextModule.key];
    return {
      kind: 'start',
      moduleKey: nextModule.key,
      title: `继续练习 ${moduleLabel} Cambridge ${nextModule.nextTest.bookNumber} · Test ${nextModule.nextTest.testNumber}`,
      description:
        nextModule.attemptCount === 0
          ? `先完成一套${moduleLabel}，系统会用真实练习记录建立你的 IELTS 基线。`
          : `根据最近练习情况，建议先补齐${moduleLabel}套题，保持四项训练节奏。`,
      ctaLabel: '开始练习',
      route: routeForTest(nextModule.key, nextModule.nextTest.id),
      estimatedMinutes: nextModule.key === 'reading' ? 60 : 30,
    };
  }

  const retryAttempt = allAttempts
    .filter((attempt) => attempt.totalQuestions > 0)
    .slice()
    .sort((left, right) => left.accuracyPercent - right.accuracyPercent || compareAttemptsByDate(left, right))[0];

  if (retryAttempt) {
    return {
      kind: 'retry',
      moduleKey: retryAttempt.moduleKey,
      title: `重练 ${retryAttempt.moduleLabel} Cambridge ${retryAttempt.bookNumber} · Test ${retryAttempt.testNumber}`,
      description: `这套正确率 ${retryAttempt.accuracyPercent}%，适合作为下一次复盘和重练目标。`,
      ctaLabel: '重新练习',
      route: routeForTest(retryAttempt.moduleKey, retryAttempt.testId),
      estimatedMinutes: retryAttempt.moduleKey === 'reading' ? 60 : 30,
    };
  }

  return {
    kind: 'none',
    moduleKey: null,
    title: '题库导入后会生成推荐',
    description: '当前还没有可练习的阅读或听力套题。导入题库后，这里会自动显示下一步。',
    ctaLabel: '暂无可练习内容',
    route: null,
    estimatedMinutes: null,
  };
}

export function buildIeltsDashboardModel({
  readingBooks,
  listeningBooks,
  readingAttempts,
  listeningAttempts,
  targetScore,
}: {
  readingBooks: IeltsReadingBookSummary[];
  listeningBooks: IeltsListeningBookSummary[];
  readingAttempts: IeltsReadingAttemptSummary[];
  listeningAttempts: IeltsListeningAttemptSummary[];
  targetScore: number;
}): IeltsDashboardModel {
  const readingTests = flattenReadingTests(readingBooks);
  const listeningTests = flattenListeningTests(listeningBooks);
  const dashboardReadingAttempts = readingAttempts.map(mapReadingAttempt);
  const dashboardListeningAttempts = listeningAttempts.map(mapListeningAttempt);
  const allAttempts = [...dashboardReadingAttempts, ...dashboardListeningAttempts].sort(compareAttemptsByDate);
  const reading = summarizeModule('reading', readingTests, dashboardReadingAttempts);
  const listening = summarizeModule('listening', listeningTests, dashboardListeningAttempts);
  const availablePracticeCount = reading.totalTests + listening.totalTests;
  const completedPracticeCount = reading.completedTests + listening.completedTests;

  return {
    reading,
    listening,
    recentAttempts: allAttempts,
    completedPracticeCount,
    availablePracticeCount,
    overallProgressPercent:
      availablePracticeCount > 0 ? Math.round((completedPracticeCount / availablePracticeCount) * 100) : 0,
    currentBand: deriveCurrentBand(allAttempts),
    targetScore,
    recommendation: buildRecommendation(reading, listening, allAttempts),
  };
}
