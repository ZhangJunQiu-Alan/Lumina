import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { PDFParse } from 'pdf-parse';
import type { IeltsReadingOption, IeltsReadingQuestionType } from '../src/types.ts';
import { normalizeIeltsPassageBody } from '../src/lib/ieltsReadingText.ts';

interface ImportedQuestion {
  questionNumber: number;
  prompt: string;
  options: IeltsReadingOption[];
  answer: string[];
  answerNote?: string;
}

interface ImportedQuestionGroup {
  type: IeltsReadingQuestionType;
  prompt: string;
  instructions: string;
  options: IeltsReadingOption[];
  questionRangeStart: number;
  questionRangeEnd: number;
  questions: ImportedQuestion[];
}

interface ImportedPassage {
  passageNumber: number;
  title: string;
  body: string;
  groups: ImportedQuestionGroup[];
}

interface ImportedTest {
  testNumber: number;
  title: string;
  passages: ImportedPassage[];
}

interface ImportedBook {
  bookNumber: number;
  title: string;
  sourceLabel: string;
  tests: ImportedTest[];
}

interface ImportReport {
  errors: string[];
  warnings: string[];
  summary: {
    bookNumber: number;
    testCount: number;
    passageCount: number;
    questionCount: number;
    answerCount: number;
  };
}

interface CliArgs {
  pdf?: string;
  json?: string;
  book?: number;
  out?: string;
  apply: boolean;
  dryRun: boolean;
}

const execFileAsync = promisify(execFile);

// Allow optional page-number prefix (e.g. "20Questions") and optional space between
// "Questions" and the first digit (pdfplumber sometimes fuses them as "Questions5").
const QUESTION_HEADING_RE = /(?:^|\n)\s*(?:\d{1,3})?\s*Questions?\s*(\d{1,2})(?:\s*(?:[-–—~]|and)\s*(\d{1,2}))?/gi;
// Matches "READING PASSAGE 1/2/3" and also the Roman-numeral variant "READING PASSAGE I/II/III" (books 5-8)
const READING_PASSAGE_RE = /(?:^|\n)\s*READING\s+PASSAGE\s+(I{1,3}|[123])\s*(?:\n|$)/gi;
const WORD_RE = /[\p{Script=Latin}]+(?:[-'][\p{Script=Latin}]+)?/gu;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, dryRun: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--pdf' && next) {
      args.pdf = next;
      index += 1;
    } else if (arg === '--json' && next) {
      args.json = next;
      index += 1;
    } else if (arg === '--book' && next) {
      args.book = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--out' && next) {
      args.out = next;
      index += 1;
    } else if (arg === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.apply = false;
      args.dryRun = true;
    }
  }

  return args;
}

function usage(): never {
  console.error([
    'Usage:',
    '  npm run import:ielts-reading -- --pdf content/ielts-reading/raw/cambridge-18.pdf --book 18 --dry-run',
    '  npm run import:ielts-reading -- --json output/ielts-reading/cambridge-18-reading.json --apply',
    '',
    'Notes:',
    '  --dry-run writes a candidate JSON and validation report under output/ielts-reading.',
    '  --apply refuses to write when validation has errors.',
  ].join('\n'));
  process.exit(1);
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfTextWithPdfplumber(pdfPath: string): Promise<string | null> {
  try {
    const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'extract-pdf-text.py');
    const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath], {
      maxBuffer: 50 * 1024 * 1024,
    });
    const text = normalizePdfText(stdout);
    // Reject if too little English content (watermark-only PDFs)
    const englishChars = (text.match(/[A-Za-z]/g) ?? []).length;
    return englishChars >= 500 ? text : null;
  } catch {
    return null;
  }
}

async function extractPdfTextWithPdftotext(pdfPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('pdftotext', [
      '-layout',
      '-enc',
      'UTF-8',
      pdfPath,
      '-',
    ], {
      maxBuffer: 50 * 1024 * 1024,
    });
    const text = normalizePdfText(stdout);
    const englishChars = (text.match(/[A-Za-z]/g) ?? []).length;
    return englishChars >= 500 ? text : null;
  } catch {
    return null;
  }
}

async function extractPdfText(pdfPath: string): Promise<string> {
  const pdfplumberText = await extractPdfTextWithPdfplumber(pdfPath);
  if (pdfplumberText) {
    return pdfplumberText;
  }

  const layoutText = await extractPdfTextWithPdftotext(pdfPath);
  if (layoutText) {
    return layoutText;
  }

  const buffer = await readFile(pdfPath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = normalizePdfText(result.text ?? '');
    if (text.length < 1000) {
      throw new Error('PDF 提取出的文字太少，可能是扫描版。请先 OCR 或换成可复制文字的 PDF。');
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

function inferBookNumber(sourcePath: string, text: string, explicit?: number): number {
  if (explicit && Number.isFinite(explicit)) return explicit;
  const filename = path.basename(sourcePath);
  const match = /(?:cambridge|ielts|剑桥)[^\d]{0,12}(\d{1,2})/i.exec(filename)
    ?? /(?:cambridge|ielts|剑桥)[^\d]{0,12}(\d{1,2})/i.exec(text.slice(0, 5000));
  if (!match) throw new Error('无法从文件名或 PDF 文本推断 Cambridge IELTS 册号，请传 --book <number>。');
  return Number.parseInt(match[1], 10);
}

function lineClean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitTests(text: string): Map<number, string> {
  const anchoredMatches: { testNumber: number; index: number }[] = [];
  // Accept LISTENING, SECTION N, or READING after the test header (varies by book/edition)
  const anchorRe = /(?:^|\n)\s*Test\s*([1-4])\s*\n\s*(?:LIS|SEC|REA)[^\n]{0,40}/gi;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = anchorRe.exec(text))) {
    anchoredMatches.push({
      testNumber: Number.parseInt(anchorMatch[1], 10),
      index: anchorMatch.index,
    });
  }

  if (anchoredMatches.length >= 4) {
    const firstByTest = new Map<number, number>();
    for (const candidate of anchoredMatches) {
      if (!firstByTest.has(candidate.testNumber)) {
        firstByTest.set(candidate.testNumber, candidate.index);
      }
    }
    const chunks = new Map<number, string>();
    [...firstByTest.entries()]
      .map(([testNumber, index]) => ({ testNumber, index }))
      .sort((left, right) => left.index - right.index)
      .forEach((candidate, index, ordered) => {
        const nextAnchor = ordered[index + 1]?.index;
        const generalTrainingOffset = text.slice(candidate.index).search(/\bGeneral Training\b/i);
        const next = nextAnchor ?? (generalTrainingOffset >= 0 ? candidate.index + generalTrainingOffset : text.length);
        const end = next > candidate.index ? next : text.length;
        chunks.set(candidate.testNumber, text.slice(candidate.index, end));
      });
    return chunks;
  }

  const candidates: { testNumber: number; index: number }[] = [];
  const testRe = /\bTest\s+([1-4])\b/gi;
  let match: RegExpExecArray | null;

  while ((match = testRe.exec(text))) {
    const testNumber = Number.parseInt(match[1], 10);
    const sample = text.slice(match.index, match.index + 60000);
    if (READING_PASSAGE_RE.test(sample)) {
      candidates.push({ testNumber, index: match.index });
    }
    READING_PASSAGE_RE.lastIndex = 0;
  }

  const firstByTest = new Map<number, number>();
  for (const candidate of candidates) {
    if (!firstByTest.has(candidate.testNumber)) {
      firstByTest.set(candidate.testNumber, candidate.index);
    }
  }

  const ordered = [...firstByTest.entries()]
    .map(([testNumber, index]) => ({ testNumber, index }))
    .sort((left, right) => left.index - right.index);
  const chunks = new Map<number, string>();

  ordered.forEach((candidate, index) => {
    const next = ordered[index + 1]?.index ?? text.length;
    chunks.set(candidate.testNumber, text.slice(candidate.index, next));
  });

  if (chunks.size === 0) {
    chunks.set(1, text);
  }

  return chunks;
}

function extractAcademicReadingAnswerSections(text: string): string[] {
  const matches: number[] = [];
  // Support both "Answer Key" (singular) and "Answer Keys" (plural), with optional page-number prefix.
  const answerKeyMatches = [...text.matchAll(/(?:^|\n)\s*(?:\d{1,3})?\s*Answer\s+Keys?\b/gi)];
  // Use the first match followed (within 600 chars) by LISTENING, TEST N, or ACADEMIC READING.
  // 600 chars is needed for books where the first "Answer Keys" page header is ~500 chars before
  // the first "ACADEMIC" section header (e.g. Cambridge 10).
  const realAnswerKey = answerKeyMatches.find((m) => {
    const after = text.slice(m.index ?? 0, (m.index ?? 0) + 600);
    return /\bLISTENING\b|TEST\s+[1-4]\b|\bACADEMIC\s+READING\b/i.test(after);
  });
  const answerKeyIndex = realAnswerKey?.index ?? answerKeyMatches.at(-1)?.index ?? 0;
  // Match "ACADEMIC READING" (same or different line via \s+) or the garbled variant
  // "ACADEMIC\nRea <junk>" (pdfplumber OCR artefact where "Reading" is garbled as "Rea <noise>").
  // Capture group 1 is set only for the garbled Rea\s variant.
  const re = /\bACADEMIC\s+(?:READING\b|(Rea)\s)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > answerKeyIndex) {
      if (match[1]) {
        // Garbled "Rea <noise>" variant: already past answerKeyIndex so no further verification needed.
        matches.push(match.index);
      } else {
        // Normal "READING" variant: verify this is an answer section, not the intro paragraph.
        // Real sections are immediately followed by "Reading Passage N, Questions ..." within 100 chars.
        const after = text.slice(match.index, match.index + 100);
        if (/Reading\s+Passage/i.test(after)) {
          matches.push(match.index);
        }
      }
    }
  }

  return matches.slice(0, 4).map((start, index) => {
    const next = matches[index + 1] ?? text.length;
    const chunk = text.slice(start, next);
    // Trim at "TEST N" (the next test's Listening section) or "GENERAL TRAINING" boundary.
    // We do NOT trim at "If you score" because pdfplumber's two-column extraction places that
    // score-chart footer inline between the two answer columns (e.g. between Q19 and Q20).
    const nextTestIndex = chunk.search(/(?:^|\n)\s*(?:TEST\s+[1-4]\b|GENERAL\s+TRAINING\b)/i);
    const end = nextTestIndex > 0 ? nextTestIndex : chunk.length;
    return chunk.slice(0, end);
  });
}

function cleanAnswerText(value: string): string {
  return value
    .replace(/\bIN\s*(?:EITHER|ANY)\s*ORDER\b/gi, '')
    .replace(/\bBOTH\s+REQUIRED\b/gi, '')
    .replace(/\bFOR\s+ONE\s+MARK\b/gi, '')
    .replace(/\bINANYORDER\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '')
    .trim();
}

function isAnswerContinuationNoise(value: string): boolean {
  const cleaned = cleanAnswerText(value);
  if (!cleaned) return true;
  if (/^Reading Passage\b/i.test(cleaned)) return true;
  if (/^Each question\b/i.test(cleaned)) return true;
  if (/^ANSWERS?\.?$/i.test(cleaned)) return true;
  if (/^\d+\s*-\s*\d+/.test(cleaned)) return true;
  if (/^you\s+/i.test(cleaned)) return true;
  if (/^score\s+/i.test(cleaned)) return true;
  if (/^conditions\b/i.test(cleaned)) return true;
  if (/^recommend\b/i.test(cleaned)) return true;
  if (/^remember\b/i.test(cleaned)) return true;
  if (/^institutions\b/i.test(cleaned)) return true;
  if (/^English\b/i.test(cleaned)) return true;
  if (/^lot of time\b/i.test(cleaned)) return true;
  if (/^more practice\b/i.test(cleaned)) return true;
  return false;
}

function splitAnswerAlternatives(value: string): string[] {
  const cleaned = cleanAnswerText(value)
    .replace(/\s+\/\s+/g, ' | ')
    .replace(/\s+\bI\b\s+/g, ' | ');

  return cleaned
    .split(/\s*\|\s*|\s*;\s*|\s+\bor\b\s+/i)
    .map((answer) => normalizeParsedAnswer(answer))
    .filter(Boolean);
}

function normalizeParsedAnswer(value: string): string {
  const answer = cleanAnswerText(value);
  if (/^0$/.test(answer)) return 'D';
  if (/^[A-H]$/i.test(answer)) return answer.toUpperCase();
  return answer;
}

function buildRequiredAnswerVariants(parts: string[]): string[] {
  const cleaned = parts.map(cleanAnswerText).filter(Boolean);
  if (cleaned.length === 0) return [];
  if (cleaned.length === 1) return splitAnswerAlternatives(cleaned[0]);
  return [
    cleaned.join(' '),
    [...cleaned].reverse().join(' '),
  ];
}

interface PendingAnswerEntry {
  numbers: number[];
  parts: string[];
  eitherOrder: boolean;
  bothRequired: boolean;
}

function parseAnswerNumber(value: string): number | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'IZ' || normalized === 'I2') return 12;
  if (normalized === 'IO' || normalized === 'I0') return 10;
  if (normalized === 'I') return 1;  // digit 1 OCR'd as capital I by pdfplumber
  const number = Number.parseInt(normalized, 10);
  return Number.isFinite(number) ? number : null;
}

function buildAnswerNumbers(startValue: string, endValue?: string): number[] {
  const start = parseAnswerNumber(startValue);
  const end = endValue ? parseAnswerNumber(endValue) : start;
  if (!start || !end) return [];

  return Array.from(
    { length: Math.max(1, end - start + 1) },
    (_value, index) => start + index,
  ).filter((number) => number >= 1 && number <= 40);
}

function parseAnswerColumn(lines: string[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  let current: PendingAnswerEntry | null = null;

  const flush = () => {
    if (!current) return;

    const joined = cleanAnswerText(current.parts.join(' '));
    let answers = current.eitherOrder && current.parts.length > 1 && !current.bothRequired
      ? current.parts.flatMap(splitAnswerAlternatives)
      : current.bothRequired
      ? buildRequiredAnswerVariants(current.parts)
      : splitAnswerAlternatives(joined);
    answers = answers.map(normalizeParsedAnswer).filter(Boolean);

    if (current.numbers.length > 1 && current.eitherOrder && answers.length > 0) {
      current.numbers.forEach((number) => map.set(number, answers));
    } else if (current.numbers.length > 1 && answers.length === current.numbers.length) {
      current.numbers.forEach((number, index) => map.set(number, [answers[index]]));
    } else if (current.numbers.length > 1 && answers.length > 0) {
      current.numbers.forEach((number) => map.set(number, answers));
    } else if (current.numbers.length === 1 && answers.length > 0) {
      map.set(current.numbers[0], answers);
    }

    current = null;
  };

  const startEntry = (startValue: string, endValue: string | undefined, content: string) => {
    flush();
    const numbers = buildAnswerNumbers(startValue, endValue);
    current = {
      numbers,
      parts: cleanAnswerText(content) ? [content] : [],
      eitherOrder: /\b(?:EITHER|ANY)\s*ORDER\b|INANYORDER/i.test(content),
      bothRequired: /\bBOTH\s+REQUIRED\b/i.test(content),
    };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isAnswerContinuationNoise(line) && !/^\d{1,2}/.test(line)) continue;

    // The leading number group includes lone "I" (digit 1 OCR'd as capital I by pdfplumber).
    const entryMatch = /^([1-9]\d?|I[Zz20]|I)(?:\s*(?:&|and|[-~])\s*([1-9]\d?|I[Zz20]))?\s+(.+)$/.exec(line);
    if (entryMatch) {
      startEntry(entryMatch[1], entryMatch[2], entryMatch[3].trim());
      continue;
    }

    const emptyEntryMatch = /^([1-9]\d?|I[Zz20])$/.exec(line);
    if (emptyEntryMatch) {
      startEntry(emptyEntryMatch[1], undefined, '');
      continue;
    }

    const embeddedEntryMatch = /\s([1-9]\d?|I[Zz20])(?:\s*(?:&|and|[-~])\s*([1-9]\d?|I[Zz20]))?\s+(.+)$/.exec(line);
    if (embeddedEntryMatch) {
      startEntry(embeddedEntryMatch[1], embeddedEntryMatch[2], embeddedEntryMatch[3].trim());
      continue;
    }

    const embeddedEmptyEntryMatch = /\s([1-9]\d?|I[Zz20])$/.exec(line);
    if (embeddedEmptyEntryMatch) {
      startEntry(embeddedEmptyEntryMatch[1], undefined, '');
      continue;
    }

    if (!current || isAnswerContinuationNoise(line)) continue;
    current.parts.push(line);
  }

  flush();
  return map;
}

function mergeAnswerMaps(target: Map<number, string[]>, source: Map<number, string[]>) {
  for (const [number, answers] of source) {
    if (!target.has(number) && answers.length > 0) {
      target.set(number, answers);
    }
  }
}

function parseAcademicReadingAnswerSection(section: string): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const left: string[] = [];
  const right: string[] = [];

  for (const line of section.split('\n')) {
    left.push(line.slice(0, 50));
    right.push(line.slice(50));
  }

  mergeAnswerMaps(map, parseAnswerColumn(left));
  mergeAnswerMaps(map, parseAnswerColumn(right));
  return map;
}

function parsePassageNumber(token: string): number {
  const upper = token.trim().toUpperCase();
  if (upper === 'I') return 1;
  if (upper === 'II') return 2;
  if (upper === 'III') return 3;
  return Number.parseInt(token, 10);
}

function splitPassages(testChunk: string): Map<number, string> {
  const matches: { passageNumber: number; index: number }[] = [];
  let match: RegExpExecArray | null;
  READING_PASSAGE_RE.lastIndex = 0;
  while ((match = READING_PASSAGE_RE.exec(testChunk))) {
    matches.push({
      passageNumber: parsePassageNumber(match[1]),
      index: match.index,
    });
  }

  const chunks = new Map<number, string>();
  matches.forEach((candidate, index) => {
    const next = matches[index + 1]?.index ?? testChunk.search(/\bWRITING\s+TASK\b/i);
    const end = next > candidate.index ? next : testChunk.length;
    chunks.set(candidate.passageNumber, testChunk.slice(candidate.index, end));
  });

  return chunks;
}

function inferQuestionType(chunk: string): IeltsReadingQuestionType {
  const lower = chunk.toLowerCase();
  if (lower.includes('true') && lower.includes('false') && lower.includes('not given')) return 'true_false_not_given';
  if (lower.includes('yes') && lower.includes('no') && lower.includes('not given')) return 'yes_no_not_given';
  if (/choose\s+(two|three)/i.test(chunk)) return 'multiple_choice_multi';
  if (/choose\s+the\s+correct\s+letter|choose\s+the\s+correct\s+answer|multiple\s+choice/i.test(chunk)) return 'multiple_choice_single';
  if (/list\s+of\s+headings|match\s+.*headings/i.test(chunk)) return 'matching_headings';
  if (/match\s+.*information|which\s+paragraph\s+contains/i.test(chunk)) return 'matching_information';
  if (/match\s+.*features|list\s+of\s+(people|researchers|scientists|statements)/i.test(chunk)) return 'matching_features';
  if (/sentence\s+endings/i.test(chunk)) return 'matching_sentence_endings';
  if (/summary/i.test(chunk)) return 'summary_completion';
  if (/notes?/i.test(chunk)) return 'note_completion';
  if (/table/i.test(chunk)) return 'table_completion';
  if (/flow-?chart/i.test(chunk)) return 'flow_chart_completion';
  if (/diagram|label/i.test(chunk)) return 'diagram_label';
  if (/complete\s+the\s+sentences?/i.test(chunk)) return 'sentence_completion';
  if (/answer\s+the\s+questions?|no\s+more\s+than/i.test(chunk)) return 'short_answer';
  return 'other';
}

function parseOptions(chunk: string): IeltsReadingOption[] {
  const options: IeltsReadingOption[] = [];
  const lines = chunk.split('\n').map(lineClean).filter(Boolean);
  const seen = new Set<string>();

  for (const line of lines) {
    const letterMatch = /^([A-H])[\s.)-]+(.{2,})$/.exec(line);
    const romanMatch = /^(i{1,3}|iv|v|vi{0,3}|ix|x)[\s.)-]+(.{2,})$/i.exec(line);
    const match = letterMatch ?? romanMatch;
    if (!match) continue;

    const key = match[1].trim();
    const text = match[2].trim();
    if (seen.has(key.toLowerCase()) || /^\d{1,2}\b/.test(text)) continue;
    seen.add(key.toLowerCase());
    options.push({ key, text });
  }

  return options;
}

function parseQuestionPrompts(chunk: string, start: number, end: number): Map<number, string> {
  const prompts = new Map<number, string>();
  const lines = chunk.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lineClean(lines[index]);
    const match = /^(\d{1,2})[\s.)-]+(.+)$/.exec(line);
    if (!match) continue;

    const questionNumber = Number.parseInt(match[1], 10);
    if (questionNumber < start || questionNumber > end) continue;

    const extraLines: string[] = [];
    for (let next = index + 1; next < Math.min(index + 4, lines.length); next += 1) {
      const nextLine = lineClean(lines[next]);
      if (!nextLine || /^\d{1,2}[\s.)-]+/.test(nextLine) || /^Questions?\s+\d/i.test(nextLine)) break;
      if (/^[A-H][\s.)-]+/.test(nextLine)) break;
      extraLines.push(nextLine);
    }

    prompts.set(questionNumber, [match[2], ...extraLines].join(' ').trim());
  }

  return prompts;
}

function parseQuestionGroups(questionChunk: string, answerMap: Map<number, string[]>): ImportedQuestionGroup[] {
  const matches: { start: number; end: number; index: number; truncated?: boolean }[] = [];
  let match: RegExpExecArray | null;
  QUESTION_HEADING_RE.lastIndex = 0;

  while ((match = QUESTION_HEADING_RE.exec(questionChunk))) {
    let start = Number.parseInt(match[1], 10);
    let end = match[2] ? Number.parseInt(match[2], 10) : start;
    const matchEnd = (match.index ?? 0) + match[0].length;
    const afterMatch = questionChunk.slice(matchEnd, matchEnd + 15);
    const charsAfterMatch = afterMatch.trimStart();
    const truncated = !match[2] && /^[~\-–—]/.test(charsAfterMatch);

    // Fix pdfplumber fused "Questions1 4-26" → Q14-26 / "Questions2 7-40" → Q27-40:
    // when the single-digit start has a space then more digits forming the real number.
    if (!match[2] && start < 10 && !truncated) {
      const fuseMatch = /^\s+(\d)(?:\s*[-–—~]\s*(\d{1,2}))?/.exec(afterMatch);
      if (fuseMatch) {
        const combined = Number.parseInt(`${start}${fuseMatch[1]}`, 10);
        if (combined >= 10 && combined <= 40) {
          start = combined;
          end = fuseMatch[2] ? Number.parseInt(fuseMatch[2], 10) : combined;
        }
      }
    }

    // Fix OCR "1 O" → 10, "2 O" → 20, etc. (capital O misread as digit 0 in end number)
    if (match[2] && end < start) {
      const afterEnd = questionChunk.slice(matchEnd, matchEnd + 4);
      if (/^\s*O\b/.test(afterEnd)) {
        end = Number.parseInt(`${match[2]}0`, 10);
      }
    }

    matches.push({ start, end, index: match.index, truncated });
  }

  return matches.map((heading, index) => {
    const next = matches[index + 1]?.index ?? questionChunk.length;
    const chunk = questionChunk.slice(heading.index, next).trim();
    const type = inferQuestionType(chunk);
    const options = parseOptions(chunk);
    // When the heading had a trailing separator but no end number (e.g. "Questions 1~"),
    // infer the end from the next heading's start minus 1.
    const inferredEnd = (heading as any).truncated && heading.end === heading.start
      ? (matches[index + 1]?.start ?? heading.start + 1) - 1
      : heading.end;
    const prompts = parseQuestionPrompts(chunk, heading.start, inferredEnd);
    const questions: ImportedQuestion[] = [];

    for (let questionNumber = heading.start; questionNumber <= inferredEnd; questionNumber += 1) {
      questions.push({
        questionNumber,
        prompt: prompts.get(questionNumber) ?? '',
        options: [],
        answer: answerMap.get(questionNumber) ?? [],
      });
    }

    const firstLines = chunk.split('\n').map(lineClean).filter(Boolean).slice(0, 5);
    return {
      type,
      prompt: firstLines[0] ?? `Questions ${heading.start}-${inferredEnd}`,
      instructions: firstLines.slice(1).join(' '),
      options,
      questionRangeStart: heading.start,
      questionRangeEnd: inferredEnd,
      questions,
    };
  });
}

function cleanPassageLine(line: string): boolean {
  if (!line) return false;
  if (/^READING\s+PASSAGE\s+[123]/i.test(line)) return false;
  if (/^You should spend about/i.test(line)) return false;
  if (/^which are based on Reading Passage/i.test(line)) return false;
  if (/^on the following pages\.?$/i.test(line)) return false;
  if (/^below\b[\W_]*$/i.test(line)) return false;
  if (/^[~.·\s]+$/.test(line)) return false;
  if (/^Questions?\s+\d/i.test(line)) return false;
  if (/^Write your answers/i.test(line)) return false;
  if (/^READING$/i.test(line)) return false;
  if (/^\d+$/.test(line)) return false;
  return true;
}

function findPostQuestionArticleStart(chunk: string, questionStart: number): number {
  const lines = chunk.split('\n');
  let offset = 0;
  let seenQuestionBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const cleaned = lineClean(line);
    if (offset >= questionStart && /^(?:\d{1,3})?\s*Questions?\s*\d{1,2}/i.test(cleaned)) {
      seenQuestionBlock = true;
    }

    if (seenQuestionBlock && /^\d{1,3}$/.test(cleaned)) {
      for (let next = index + 1; next < lines.length; next += 1) {
        const nextCleaned = lineClean(lines[next]);
        if (!nextCleaned) continue;
        if (!/^(?:\d{1,3})?\s*Questions?\s*\d{1,2}/i.test(nextCleaned) && /[A-Za-z]/.test(nextCleaned)) {
          return offset + line.length + 1 + lines.slice(index + 1, next).join('\n').length + (next > index + 1 ? 1 : 0);
        }
        break;
      }
    }

    offset += line.length + 1;
  }

  return -1;
}

function titleLineWordCount(value: string): number {
  return [...value.matchAll(WORD_RE)].length;
}

// Lines ending with these function words are mid-sentence and cannot be titles.
const MID_SENTENCE_END_RE = /\b(?:with|of|the|a|an|and|or|but|in|on|at|to|for|from|by|as|that|which|whose|whose|where|when|if|though|since|because|while|after|before|until|unless|whether|so|nor|than|its|our|your|my|his|her)\s*$/i;

function buildPassageText(passageNumber: number, passagePart: string) {
  const lines = passagePart.split('\n').map(lineClean).filter(cleanPassageLine);
  if (lines.length === 0) {
    return {
      title: `Reading Passage ${passageNumber}`,
      body: '',
    };
  }

  if (
    MID_SENTENCE_END_RE.test(lines[0])
    && (lines.length < 2 || titleLineWordCount(lines[1]) > 5)
  ) {
    return {
      title: `Reading Passage ${passageNumber}`,
      body: normalizeIeltsPassageBody(lines.join('\n').trim()),
    };
  }

  const titleLines = [lines[0]];
  let bodyStart = 1;
  while (
    bodyStart < lines.length
    && titleLines.length < 3
    && titleLineWordCount(lines[bodyStart]) <= 5
    && !/^Section\b/i.test(lines[bodyStart])
    && !/[.!?]$/.test(titleLines[titleLines.length - 1])
  ) {
    titleLines.push(lines[bodyStart]);
    bodyStart += 1;
  }

  return {
    title: titleLines.join(' ').replace(/\s+/g, ' ').trim(),
    body: normalizeIeltsPassageBody(lines.slice(bodyStart).join('\n').trim()),
  };
}

function parsePassage(passageNumber: number, chunk: string, answerMap: Map<number, string[]>): ImportedPassage {
  const questionStart = chunk.search(/(?:^|\n)\s*(?:\d{1,3})?\s*Questions?\s*\d{1,2}/i);
  let passagePart = questionStart >= 0 ? chunk.slice(0, questionStart) : chunk;
  let questionPart = questionStart >= 0 ? chunk.slice(questionStart) : '';
  let passageText = buildPassageText(passageNumber, passagePart);

  if (questionStart >= 0 && countWords(passageText.body) < 150) {
    const articleStart = findPostQuestionArticleStart(chunk, questionStart);
    if (articleStart > questionStart) {
      passagePart = chunk.slice(articleStart);
      passageText = buildPassageText(passageNumber, passagePart);
    }
  }

  const groups = parseQuestionGroups(questionPart, answerMap);

  return {
    passageNumber,
    title: passageText.title,
    body: passageText.body,
    groups,
  };
}

function countWords(body: string): number {
  return [...body.matchAll(WORD_RE)].length;
}

async function parsePdfBook(pdfPath: string, explicitBookNumber?: number): Promise<ImportedBook> {
  const text = await extractPdfText(pdfPath);
  const bookNumber = inferBookNumber(pdfPath, text, explicitBookNumber);
  const answerMaps = extractAcademicReadingAnswerSections(text).map(parseAcademicReadingAnswerSection);
  const tests = [...splitTests(text).entries()]
    .map(([testNumber, chunk]) => {
      const answerMap = answerMaps[testNumber - 1] ?? new Map<number, string[]>();
      const passages = [...splitPassages(chunk).entries()]
        .map(([passageNumber, passageChunk]) => parsePassage(passageNumber, passageChunk, answerMap))
        .sort((left, right) => left.passageNumber - right.passageNumber);

      return {
        testNumber,
        title: `Cambridge IELTS ${bookNumber} Academic Reading Test ${testNumber}`,
        passages,
      };
    })
    .sort((left, right) => left.testNumber - right.testNumber);

  const book = {
    bookNumber,
    title: `Cambridge IELTS ${bookNumber} Academic Reading`,
    sourceLabel: path.basename(pdfPath),
    tests,
  };
  applyKnownTitleRepairs(book);
  applyKnownQuestionRepairs(book);
  applyKnownAnswerRepairs(book);
  normalizeBookPassageBodies(book);
  return book;
}

function normalizeBookPassageBodies(book: ImportedBook) {
  for (const test of book.tests) {
    for (const passage of test.passages) {
      passage.body = normalizeIeltsPassageBody(passage.body);
    }
  }
}

function applyKnownTitleRepairs(book: ImportedBook) {
  if (book.bookNumber !== 4) return;

  const repairs = new Map<string, string>([
    ['1:1', 'Children and Rainforests'],
    ['1:2', 'What Do Whales Feel?'],
    ['1:3', 'Visual Symbols and the Blind'],
    ['2:1', 'Lost for Words'],
    ['2:2', 'Alternative Medicine in Australia'],
    ['2:3', 'Play is a Serious Business'],
    ['3:1', 'Micro-Enterprise Credit for Street Youth'],
    ['3:2', 'Volcanoes - Earth-Shattering News'],
    ['3:3', 'Obtaining Linguistic Data'],
    ['4:1', 'How Much Higher? How Much Faster?'],
    ['4:2', 'The Nature and Aims of Archaeology'],
    ['4:3', 'The Problem of Scarce Resources'],
  ]);

  for (const test of book.tests) {
    for (const passage of test.passages) {
      passage.title = repairs.get(`${test.testNumber}:${passage.passageNumber}`) ?? passage.title;
    }
  }
}

function findQuestionGroup(book: ImportedBook, testNumber: number, passageNumber: number, questionNumber: number) {
  const test = book.tests.find((candidate) => candidate.testNumber === testNumber);
  const passage = test?.passages.find((candidate) => candidate.passageNumber === passageNumber);
  return passage?.groups.find((candidate) =>
    candidate.questionRangeStart <= questionNumber && candidate.questionRangeEnd >= questionNumber,
  );
}

function applyKnownQuestionRepairs(book: ImportedBook) {
  if (book.bookNumber !== 4) return;

  const question14Options: IeltsReadingOption[] = [
    {
      key: 'A',
      text: 'The development of a programme in environmental studies within a science curriculum',
    },
    {
      key: 'B',
      text: "Children's ideas about the rainforests and the implications for course design",
    },
    {
      key: 'C',
      text: 'The extent to which children have been misled by the media concerning the rainforests',
    },
    {
      key: 'D',
      text: 'How to collect, collate and describe the ideas of secondary school children',
    },
    {
      key: 'E',
      text: 'The importance of the rainforests and the reasons for their destruction',
    },
  ];
  const question14Group = findQuestionGroup(book, 1, 1, 14);
  const question14 = question14Group?.questions.find((question) => question.questionNumber === 14);

  if (question14Group && question14) {
    question14Group.type = 'multiple_choice_single';
    question14Group.prompt = 'Question 14';
    question14Group.instructions = 'Choose the correct letter, A, B, C, D or E. Write your answer in box 14 on your answer sheet.';
    question14Group.options = question14Options;
    question14.prompt = 'Which of the following is the most suitable title for Reading Passage 1?';
    question14.options = question14Options;
    question14.answer = ['B'];
    question14.answerNote = 'Recovered from Cambridge 4 answer key OCR mismatch.';
  }

  const whaleSenseGroup = findQuestionGroup(book, 1, 2, 15);
  if (whaleSenseGroup) {
    whaleSenseGroup.type = 'table_completion';
    whaleSenseGroup.prompt = 'Questions 15-21';
    whaleSenseGroup.instructions = [
      'Complete the table below.',
      'Choose NO MORE THAN THREE WORDS from Reading Passage 2 for each answer.',
      'Write your answers in boxes 15-21 on your answer sheet.',
      '',
      'SENSE | SPECIES | ABILITY | COMMENTS',
      'Smell | toothed | no | evidence from brain structure',
      'Smell | baleen | not certain | related brain structures are present',
      'Taste | some types | poor | nerves linked to their [15] ______ are underdeveloped',
      'Touch | all | yes | region around the blowhole very sensitive',
      'Vision | [16] ______ | yes | probably do not have stereoscopic vision',
      'Vision | dolphins, porpoises | yes | probably have stereoscopic vision [17] ______ and ______',
      'Vision | [18] ______ | yes | probably have stereoscopic vision forward and upward',
      'Vision | bottlenose dolphins | yes | exceptional in [19] ______ and good in air-water interface',
      'Vision | boutu and beiji | poor | have limited vision',
      'Vision | Indian susus | no | probably only sense direction and intensity of light',
      'Hearing | most large baleen | yes | usually use [20] ______; repertoire limited',
      'Hearing | [21] ______ whales and ______ whales | yes | song-like',
      'Hearing | toothed | yes | use more of frequency spectrum; have wider repertoire',
    ].join('\n');
    whaleSenseGroup.options = [];

    const repairedPrompts = new Map<number, string>([
      [15, 'Taste | some types | poor | nerves linked to their ______ are underdeveloped'],
      [16, 'Vision | ______ | yes | probably do not have stereoscopic vision'],
      [17, 'Vision | dolphins, porpoises | yes | probably have stereoscopic vision ______ and ______'],
      [18, 'Vision | ______ | yes | probably have stereoscopic vision forward and upward'],
      [19, 'Vision | bottlenose dolphins | yes | exceptional in ______ and good in air-water interface'],
      [20, 'Hearing | most large baleen | yes | usually use ______; repertoire limited'],
      [21, 'Hearing | ______ whales and ______ whales | yes | song-like'],
    ]);
    const repairedAnswers = new Map<number, string[]>([
      [15, ['taste buds']],
      [16, ['baleen', 'the baleen whales']],
      [17, ['forward downward', 'downward forward']],
      [18, ['freshwater dolphin(s)', 'the freshwater dolphin(s)']],
      [19, ['water', 'the water']],
      [20, ['lower frequencies', 'the lower frequencies']],
      [21, ['bowhead humpback', 'humpback bowhead']],
    ]);

    for (const question of whaleSenseGroup.questions) {
      const repairedPrompt = repairedPrompts.get(question.questionNumber);
      if (repairedPrompt) {
        question.prompt = repairedPrompt;
        question.options = [];
      }
      const repairedAnswer = repairedAnswers.get(question.questionNumber);
      if (repairedAnswer) {
        question.answer = repairedAnswer;
        question.answerNote = 'Recovered from Cambridge 4 table OCR and answer-key alignment mismatch.';
      }
    }
  }
}

function applyKnownAnswerRepairs(book: ImportedBook) {
  const repairsByBook: Record<number, [string, string[]][]> = {
    4: [
      ['1:15', ['taste buds']],
      ['1:16', ['baleen', 'the baleen whales']],
      ['1:17', ['forward downward', 'downward forward']],
      ['1:18', ['freshwater dolphin(s)', 'the freshwater dolphin(s)']],
      ['1:19', ['water', 'the water']],
      ['1:20', ['lower frequencies', 'the lower frequencies']],
      ['1:21', ['bowhead humpback', 'humpback bowhead']],
      // The pdftotext output drops the roman-numeral "i" on these two answer-key rows.
      ['3:15', ['i']],
      ['4:29', ['i']],
    ],
    5: [
      // Answer character "I" is physically absent from this PDF page.
      ['3:15', ['I']],
    ],
    6: [
      // Answer "i" is physically absent from this PDF page (Test 1 Passage 3).
      ['1:27', ['i']],
    ],
  };

  const repairEntries = repairsByBook[book.bookNumber];
  if (!repairEntries) return;

  const repairs = new Map<string, string[]>(repairEntries);

  for (const test of book.tests) {
    for (const passage of test.passages) {
      for (const group of passage.groups) {
        for (const question of group.questions) {
          const repairedAnswer = repairs.get(`${test.testNumber}:${question.questionNumber}`);
          if (repairedAnswer && question.answer.length === 0) {
            question.answer = repairedAnswer;
            question.answerNote = 'Recovered from Cambridge 4 answer key OCR omission.';
          }
        }
      }
    }
  }
}

function validateBook(book: ImportedBook): ImportReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allQuestions = book.tests.flatMap((test) =>
    test.passages.flatMap((passage) => passage.groups.flatMap((group) => group.questions)),
  );
  const answerCount = allQuestions.filter((question) => question.answer.length > 0).length;

  if (!Number.isInteger(book.bookNumber) || book.bookNumber <= 0) {
    errors.push('册号无效。');
  }
  if (book.tests.length !== 4) {
    errors.push(`应有 4 套 Test，当前解析到 ${book.tests.length} 套。`);
  }

  for (const test of book.tests) {
    if (test.passages.length !== 3) {
      errors.push(`Test ${test.testNumber} 应有 3 篇 Passage，当前解析到 ${test.passages.length} 篇。`);
    }

    const questions = test.passages.flatMap((passage) => passage.groups.flatMap((group) => group.questions));
    const numbers = questions.map((question) => question.questionNumber).sort((left, right) => left - right);
    const expected = Array.from({ length: 40 }, (_value, index) => index + 1);
    if (numbers.length !== 40 || numbers.some((number, index) => number !== expected[index])) {
      errors.push(`Test ${test.testNumber} 题号必须连续 1-40，当前为 ${numbers.join(', ') || '空'}。`);
    }
    const missingAnswers = questions.filter((question) => question.answer.length === 0).map((question) => question.questionNumber);
    if (missingAnswers.length > 0) {
      errors.push(`Test ${test.testNumber} 缺少答案：${missingAnswers.join(', ')}。`);
    }

    for (const passage of test.passages) {
      if (!passage.title || /^Reading Passage/i.test(passage.title)) {
        warnings.push(`Test ${test.testNumber} Passage ${passage.passageNumber} 未识别到可靠标题。`);
      }
      if (countWords(passage.body) < 150) {
        errors.push(`Test ${test.testNumber} Passage ${passage.passageNumber} 正文过短，可能解析失败。`);
      }
    }
  }

  return {
    errors,
    warnings,
    summary: {
      bookNumber: book.bookNumber,
      testCount: book.tests.length,
      passageCount: book.tests.reduce((count, test) => count + test.passages.length, 0),
      questionCount: allQuestions.length,
      answerCount,
    },
  };
}

async function writeDryRunOutput(book: ImportedBook, report: ImportReport, outPath?: string) {
  const outputDir = path.dirname(outPath ?? `output/ielts-reading/cambridge-${book.bookNumber}-reading.json`);
  await mkdir(outputDir, { recursive: true });
  const candidatePath = outPath ?? path.join(outputDir, `cambridge-${book.bookNumber}-reading.json`);
  const reportPath = candidatePath.replace(/\.json$/i, '.report.json');
  await writeFile(candidatePath, `${JSON.stringify(book, null, 2)}\n`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { candidatePath, reportPath };
}

async function applyBook(book: ImportedBook) {
  const { supabaseAdmin } = await import('../server/supabase.ts');

  const { data: bookRow, error: bookError } = await supabaseAdmin
    .from('ielts_reading_books')
    .upsert({
      book_number: book.bookNumber,
      title: book.title,
      source_label: book.sourceLabel,
    }, { onConflict: 'book_number' })
    .select('id')
    .single();
  if (bookError || !bookRow) throw new Error(`ielts_reading_books upsert failed: ${bookError?.message ?? 'missing row'}`);

  for (const test of book.tests) {
    const { data: testRow, error: testError } = await supabaseAdmin
      .from('ielts_reading_tests')
      .upsert({
        book_id: bookRow.id,
        test_number: test.testNumber,
        title: test.title,
      }, { onConflict: 'book_id,test_number' })
      .select('id')
      .single();
    if (testError || !testRow) throw new Error(`ielts_reading_tests upsert failed [Test ${test.testNumber}]: ${testError?.message ?? 'missing row'}`);

    for (const passage of test.passages) {
      const { data: passageRow, error: passageError } = await supabaseAdmin
        .from('ielts_reading_passages')
        .upsert({
          test_id: testRow.id,
          passage_number: passage.passageNumber,
          title: passage.title,
          body: passage.body,
          word_count: countWords(passage.body),
          sort_order: passage.passageNumber,
        }, { onConflict: 'test_id,passage_number' })
        .select('id')
        .single();
      if (passageError || !passageRow) throw new Error(`ielts_reading_passages upsert failed [Test ${test.testNumber} Passage ${passage.passageNumber}]: ${passageError?.message ?? 'missing row'}`);

      const { error: deleteGroupsError } = await supabaseAdmin
        .from('ielts_reading_question_groups')
        .delete()
        .eq('passage_id', passageRow.id);
      if (deleteGroupsError) throw new Error(`ielts_reading_question_groups cleanup failed: ${deleteGroupsError.message}`);

      for (let groupIndex = 0; groupIndex < passage.groups.length; groupIndex += 1) {
        const group = passage.groups[groupIndex];
        const { data: groupRow, error: groupError } = await supabaseAdmin
          .from('ielts_reading_question_groups')
          .insert({
            passage_id: passageRow.id,
            question_type: group.type,
            prompt: group.prompt,
            instructions: group.instructions,
            options_json: group.options,
            question_range_start: group.questionRangeStart,
            question_range_end: group.questionRangeEnd,
            sort_order: groupIndex + 1,
          })
          .select('id')
          .single();
        if (groupError || !groupRow) throw new Error(`ielts_reading_question_groups insert failed: ${groupError?.message ?? 'missing row'}`);

        const questionRows = group.questions.map((question, questionIndex) => ({
          test_id: testRow.id,
          group_id: groupRow.id,
          question_number: question.questionNumber,
          prompt: question.prompt,
          options_json: question.options,
          answer_json: question.answer,
          answer_note: question.answerNote ?? null,
          sort_order: questionIndex + 1,
        }));
        if (questionRows.length > 0) {
          const { error: questionsError } = await supabaseAdmin
            .from('ielts_reading_questions')
            .insert(questionRows);
          if (questionsError) throw new Error(`ielts_reading_questions insert failed: ${questionsError.message}`);
        }
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pdf && !args.json) usage();

  const book = args.json
    ? JSON.parse(await readFile(args.json, 'utf8')) as ImportedBook
    : await parsePdfBook(args.pdf!, args.book);
  normalizeBookPassageBodies(book);
  const report = validateBook(book);
  const output = await writeDryRunOutput(book, report, args.out);

  console.log(`IELTS reading import candidate: Cambridge ${report.summary.bookNumber}`);
  console.log(`Tests: ${report.summary.testCount}, passages: ${report.summary.passageCount}, questions: ${report.summary.questionCount}, answers: ${report.summary.answerCount}`);
  console.log(`Candidate JSON: ${output.candidatePath}`);
  console.log(`Report JSON: ${output.reportPath}`);

  for (const warning of report.warnings) {
    console.warn(`WARN: ${warning}`);
  }
  for (const error of report.errors) {
    console.error(`ERROR: ${error}`);
  }

  if (args.apply) {
    if (report.errors.length > 0) {
      throw new Error('校验未通过，已拒绝写入数据库。先修正 candidate JSON 后再 --apply。');
    }
    await applyBook(book);
    console.log('IELTS reading import applied successfully.');
  } else {
    console.log('Dry-run complete. Review the JSON/report before applying.');
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
