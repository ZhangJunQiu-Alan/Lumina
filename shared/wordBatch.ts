export interface AnalyzeWordBatchOptions {
  limit?: number;
}

export interface AnalyzeWordBatchResult {
  words: string[];
  normalizedWords: string[];
  duplicateWords: string[];
}

export interface WordBatchMismatch {
  missingWords: string[];
  unexpectedWords: string[];
}

export function sanitizeWordInput(word: string): string {
  return word.trim().replace(/\s+/g, ' ');
}

export function normalizeWordKey(word: string): string {
  return sanitizeWordInput(word).toLowerCase();
}

export function analyzeWordBatch(
  words: string[],
  options: AnalyzeWordBatchOptions = {},
): AnalyzeWordBatchResult {
  const preparedWords = words
    .map(sanitizeWordInput)
    .filter(Boolean)
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);

  const duplicateWords: string[] = [];
  const firstWordByKey = new Map<string, string>();
  const recordedDuplicateKeys = new Set<string>();

  for (const word of preparedWords) {
    const key = normalizeWordKey(word);
    const firstWord = firstWordByKey.get(key);

    if (!firstWord) {
      firstWordByKey.set(key, word);
      continue;
    }

    if (!recordedDuplicateKeys.has(key)) {
      duplicateWords.push(firstWord);
      recordedDuplicateKeys.add(key);
    }
  }

  return {
    words: preparedWords,
    normalizedWords: preparedWords.map(normalizeWordKey),
    duplicateWords,
  };
}

export function compareWordBatches(expectedWords: string[], actualWords: string[]): WordBatchMismatch {
  const expectedWordByKey = new Map(
    expectedWords.map((word) => [normalizeWordKey(word), sanitizeWordInput(word)]),
  );
  const actualWordByKey = new Map(
    actualWords.map((word) => [normalizeWordKey(word), sanitizeWordInput(word)]),
  );

  return {
    missingWords: [...expectedWordByKey.entries()]
      .filter(([key]) => !actualWordByKey.has(key))
      .map(([, word]) => word),
    unexpectedWords: [...actualWordByKey.entries()]
      .filter(([key]) => !expectedWordByKey.has(key))
      .map(([, word]) => word),
  };
}

export function formatDuplicateWordsMessage(duplicateWords: string[]): string {
  return `检测到重复词：${duplicateWords.join('、')}。同一批里不能重复，系统会忽略大小写和多余空格，请改一下再继续。`;
}

export function formatWordBatchMismatchMessage({
  missingWords,
  unexpectedWords,
}: WordBatchMismatch): string {
  const parts: string[] = [];

  if (missingWords.length > 0) {
    parts.push(`缺少：${missingWords.join('、')}`);
  }

  if (unexpectedWords.length > 0) {
    parts.push(`多出：${unexpectedWords.join('、')}`);
  }

  const suffix = parts.length > 0 ? ` ${parts.join('；')}。` : '。';
  return `整理结果无效：模型返回的词和请求不一致（按忽略大小写和多余空格比对）${suffix}请重试。`;
}
