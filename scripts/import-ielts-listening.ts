import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { supabaseAdmin } from '../server/supabase.ts';
import type {
  IeltsListeningOption,
  IeltsListeningPaperHotspot,
  IeltsListeningPaperPage,
  IeltsListeningQuestionType,
} from '../src/types.ts';

const execFileAsync = promisify(execFile);
const AUDIO_BUCKET = 'ielts-listening-audio';
const PAPER_BUCKET = 'ielts-listening-paper-pages';
const DEFAULT_RAW_DIR = 'content/ielts-reading/raw';
const DEFAULT_OUTPUT_DIR = 'output/ielts-listening';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac']);

interface CliArgs {
  book?: number;
  pdf?: string;
  text?: string;
  out?: string;
  dryRun: boolean;
  apply: boolean;
}

interface ImportedListeningQuestion {
  questionNumber: number;
  prompt: string;
  options: IeltsListeningOption[];
  answers: string[];
  answerNote: string;
  paperHotspot?: IeltsListeningPaperHotspot;
}

interface ImportedListeningGroup {
  type: IeltsListeningQuestionType;
  prompt: string;
  instructions: string;
  options: IeltsListeningOption[];
  rangeStart: number;
  rangeEnd: number;
  questions: ImportedListeningQuestion[];
}

interface ImportedListeningSection {
  sectionNumber: number;
  title: string;
  instructions: string;
  sourceAudioFilename: string;
  audioStoragePath: string;
  audioUrl?: string;
  paperPages: IeltsListeningPaperPage[];
  groups: ImportedListeningGroup[];
}

interface ImportedListeningTest {
  testNumber: number;
  title: string;
  sections: ImportedListeningSection[];
}

interface ImportedListeningBook {
  bookNumber: number;
  title: string;
  sourceLabel: string;
  tests: ImportedListeningTest[];
}

interface AudioSource {
  testNumber: number;
  sectionNumber: number;
  filePath: string;
  sourceAudioFilename: string;
  storagePath: string;
}

interface ImportReport {
  summary: {
    bookNumber: number;
    testCount: number;
    sectionCount: number;
    questionCount: number;
    answerCount: number;
    audioCount: number;
    paperPageCount: number;
    uniquePaperPageCount: number;
    hotspotCount: number;
    fallbackHotspotCount: number;
  };
  errors: string[];
  warnings: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === '--book' && next) {
      args.book = Number.parseInt(next, 10);
      index += 1;
    } else if (item === '--pdf' && next) {
      args.pdf = next;
      index += 1;
    } else if (item === '--text' && next) {
      args.text = next;
      index += 1;
    } else if (item === '--out' && next) {
      args.out = next;
      index += 1;
    } else if (item === '--dry-run') {
      args.dryRun = true;
    } else if (item === '--apply') {
      args.apply = true;
    } else if (item === '--help' || item === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!args.book || !Number.isFinite(args.book)) {
    throw new Error('请传 --book <number>。v1 当前支持 --book 4。');
  }
  if (args.book !== 4) {
    throw new Error('IELTS listening v1 先只支持 Cambridge 4。');
  }
  if (!args.dryRun && !args.apply) args.dryRun = true;
  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  npm run import:ielts-listening -- --book 4 --dry-run',
    '  npm run import:ielts-listening -- --book 4 --apply',
    '  npm run import:ielts-listening -- --book 4 --text output/ielts-reading/cambridge-4-extracted.txt --dry-run',
  ].join('\n'));
}

function lineClean(value: string): string {
  return value.replace(/[ \t]+/g, ' ').replace(/\s+$/g, '').trim();
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/Question\s*\.\s*~\s*/gi, 'Questions ')
    .replace(/Questions(\d)/gi, 'Questions $1')
    .replace(/Question(\d)/gi, 'Question $1')
    .replace(/Questions\s+17-30/gi, 'Questions 27-30')
    .replace(/([0-9])\s*:-\s*([0-9])/g, '$1-$2')
    .replace(/Secton/gi, 'Section');
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findBookPdf(bookNumber: number): Promise<string> {
  const entries = await readdir(DEFAULT_RAW_DIR);
  const match = entries.find((entry) => (
    entry.includes(`【${bookNumber}】`) && entry.toLowerCase().endsWith('.pdf')
  ));
  if (!match) throw new Error(`找不到 Cambridge ${bookNumber} PDF。`);
  return path.join(DEFAULT_RAW_DIR, match);
}

async function readSourceText(args: CliArgs): Promise<{ text: string; sourceLabel: string; pdfPath: string }> {
  const pdfPath = args.pdf ?? await findBookPdf(args.book!);
  const textPath = args.text ?? `output/ielts-reading/cambridge-${args.book}-extracted.txt`;
  if (await pathExists(textPath)) {
    return {
      text: normalizeExtractedText(await readFile(textPath, 'utf8')),
      sourceLabel: path.basename(textPath),
      pdfPath,
    };
  }

  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'extract-pdf-text.py');
  const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath], {
    maxBuffer: 80 * 1024 * 1024,
  });
  return {
    text: normalizeExtractedText(stdout),
    sourceLabel: path.basename(pdfPath),
    pdfPath,
  };
}

function extractMainListeningTestChunks(text: string): Map<number, string> {
  const anchors: { testNumber: number; index: number }[] = [];
  const re = /(?:^|\n)\s*Test\s*([1-4])\s+LISTE/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const testNumber = Number.parseInt(match[1], 10);
    if (!anchors.some((anchor) => anchor.testNumber === testNumber)) {
      anchors.push({ testNumber, index: match.index });
    }
  }

  if (anchors.length < 4) {
    throw new Error(`只找到 ${anchors.length} 个 Listening test anchor，无法导入。`);
  }

  const chunks = new Map<number, string>();
  anchors
    .slice(0, 4)
    .sort((left, right) => left.index - right.index)
    .forEach((anchor) => {
      const testText = text.slice(anchor.index);
      const readingOffset = testText.search(/\n\s*R\s*E?\s*~?\s*A\s*DING\b|\n\s*READING\b|\n\s*READING PASSAGE\b/i);
      const chunk = readingOffset > 0 ? testText.slice(0, readingOffset) : testText;
      chunks.set(anchor.testNumber, chunk);
    });

  return chunks;
}

function splitSections(testChunk: string): Map<number, string> {
  const anchors: { sectionNumber: number; index: number }[] = [];
  const re = /\bSECTION\s+([1-4])\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(testChunk))) {
    const sectionNumber = Number.parseInt(match[1], 10);
    if (!anchors.some((anchor) => anchor.sectionNumber === sectionNumber)) {
      anchors.push({ sectionNumber, index: match.index });
    }
  }

  const sections = new Map<number, string>();
  anchors
    .sort((left, right) => left.index - right.index)
    .forEach((anchor, index, ordered) => {
      const next = ordered[index + 1]?.index ?? testChunk.length;
      sections.set(anchor.sectionNumber, testChunk.slice(anchor.index, next));
    });

  return sections;
}

function parseQuestionRange(value: string): { start: number; end: number } | null {
  const match = /Questions?\s+([0-9]\s*[0-9]?)(?:\s*(?:-|to|and|&)\s*([0-9]\s*[0-9]?))?/i.exec(value);
  if (!match) return null;
  const start = Number.parseInt(match[1].replace(/\s+/g, ''), 10);
  const end = match[2] ? Number.parseInt(match[2].replace(/\s+/g, ''), 10) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end: Math.max(start, end) };
}

function inferQuestionType(chunk: string): IeltsListeningQuestionType {
  const lower = chunk.toLowerCase();
  if (lower.includes('choose the correct letter')) return 'multiple_choice_single';
  if (
    lower.includes('choose two letters')
    || lower.includes('choose your answers from the box')
    || lower.includes('what recommendations')
    || lower.includes('what problems')
  ) return 'matching';
  if (lower.includes('complete the table')) return 'table_completion';
  if (lower.includes('complete the form')) return 'form_completion';
  if (lower.includes('complete the sentences')) return 'sentence_completion';
  if (lower.includes('label the plan') || lower.includes('label the chart')) return 'diagram_label';
  if (lower.includes('complete the notes')) return 'note_completion';
  return 'other';
}

function parseOptions(chunk: string, type: IeltsListeningQuestionType): IeltsListeningOption[] {
  if (type === 'multiple_choice_single' && !/[A-H]\s+.+\n\s*B\s+/i.test(chunk)) {
    return [
      { key: 'A', text: 'A' },
      { key: 'B', text: 'B' },
      { key: 'C', text: 'C' },
    ];
  }

  const options: IeltsListeningOption[] = [];
  const seen = new Set<string>();
  for (const rawLine of chunk.split('\n')) {
    const line = lineClean(rawLine);
    const match = /^([A-Ha-h])\s+(.{1,90})$/.exec(line);
    if (!match) continue;
    const key = match[1].toUpperCase();
    const text = lineClean(match[2]);
    if (!text || seen.has(key)) continue;
    if (/^\d/.test(text) && type !== 'multiple_choice_single') continue;
    options.push({ key, text });
    seen.add(key);
  }

  if (type === 'multiple_choice_single' && options.length === 0) {
    return [
      { key: 'A', text: 'A' },
      { key: 'B', text: 'B' },
      { key: 'C', text: 'C' },
    ];
  }
  return options;
}

function extractQuestionPrompt(chunk: string, questionNumber: number): string {
  const lines = chunk.split('\n').map(lineClean).filter(Boolean);
  const startRe = new RegExp(`^${questionNumber}\\s+(.+)`);
  const inlineRe = new RegExp(`\\b${questionNumber}\\s+([._·•-]{2,}|[A-Za-z][^\\n]{0,90})`);
  for (const line of lines) {
    const start = startRe.exec(line);
    if (start) return lineClean(start[1]).slice(0, 180);
    if (inlineRe.test(line) && !/^Questions?/i.test(line)) return line.slice(0, 180);
  }
  return `Question ${questionNumber}`;
}

function buildGroups(sectionChunk: string, sectionNumber: number, answerMap: Map<number, string[]>): ImportedListeningGroup[] {
  const headingMatches: { index: number; heading: string; start: number; end: number }[] = [];
  const headingRe = /Questions?\s+[0-9]\s*[0-9]?(?:\s*(?:-|to|and|&)\s*[0-9]\s*[0-9]?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(sectionChunk))) {
    const heading = match[0];
    const range = parseQuestionRange(heading);
    if (!range) continue;
    if (range.start < ((sectionNumber - 1) * 10) + 1 || range.end > sectionNumber * 10) continue;
    headingMatches.push({ index: match.index, heading, ...range });
  }

  const sectionStart = ((sectionNumber - 1) * 10) + 1;
  const sectionEnd = sectionNumber * 10;
  const filteredMatches = headingMatches
    .filter((heading) => {
      if (headingMatches.length <= 1) return true;
      return !(heading.start === sectionStart && heading.end === sectionEnd);
    })
    .filter((heading, index, matches) => (
      matches.findIndex((item) => item.start === heading.start && item.end === heading.end) === index
    ));

  const usableMatches = filteredMatches.length > 0
    ? filteredMatches
    : [{ index: 0, heading: `Questions ${sectionStart}-${sectionEnd}`, start: sectionStart, end: sectionEnd }];

  return usableMatches.map((heading, index, ordered) => {
    const nextIndex = ordered[index + 1]?.index ?? sectionChunk.length;
    const chunk = sectionChunk.slice(heading.index, nextIndex).trim();
    const type = inferQuestionType(chunk);
    const options = parseOptions(chunk, type);
    const questions = Array.from(
      { length: heading.end - heading.start + 1 },
      (_item, questionIndex): ImportedListeningQuestion => {
        const questionNumber = heading.start + questionIndex;
        return {
          questionNumber,
          prompt: extractQuestionPrompt(chunk, questionNumber),
          options,
          answers: answerMap.get(questionNumber) ?? [],
          answerNote: '',
        };
      },
    );

    return {
      type,
      prompt: heading.heading,
      instructions: chunk,
      options,
      rangeStart: heading.start,
      rangeEnd: heading.end,
      questions,
    };
  });
}

const CAMBRIDGE_4_LISTENING_ANSWERS: Record<number, Record<number, string[]>> = {
  1: {
    1: ['shopping', 'variety of shopping'],
    2: ['guided tours'],
    3: ['more than 12', 'over 12'],
    4: ['notice board'],
    5: ['13th February'],
    6: ['Tower of London'],
    7: ['Bristol'],
    8: ['American Museum'],
    9: ['student newspaper'],
    10: ['Yentob'],
    11: ['coal firewood', 'firewood coal', 'coal and firewood', 'firewood and coal'],
    12: ['local craftsmen'],
    13: ['160'],
    14: ['Woodside'],
    15: ['Ticket Office'],
    16: ['Gift Shop'],
    17: ['Workshop', 'main Workshop'],
    18: ['Showroom'],
    19: ['Cafe'],
    20: ['cottages'],
    21: ['A'],
    22: ['C'],
    23: ['E'],
    24: ['B'],
    25: ['G'],
    26: ['F'],
    27: ['C'],
    28: ['D'],
    29: ['A'],
    30: ['B'],
    31: ['cities', 'environment'],
    32: ['windy'],
    33: ['humid'],
    34: ['shady', 'shaded'],
    35: ['dangerous'],
    36: ['leaves'],
    37: ['ground'],
    38: ['considerably reduce', 'decrease', 'filter'],
    39: ['low'],
    40: ['space', 'room'],
  },
  2: {
    1: ['C'],
    2: ['C'],
    3: ['B'],
    4: ['B'],
    5: ['A'],
    6: ['Cathedral'],
    7: ['Markets'],
    8: ['Gardens'],
    9: ['Art Gallery'],
    10: ['climb the tower', 'see the view'],
    11: ['C'],
    12: ['B'],
    13: ['A'],
    14: ['C'],
    15: ['B'],
    16: ['C'],
    17: ['A'],
    18: ['B'],
    19: ['B'],
    20: ['A'],
    21: ['collecting data', 'gathering data', 'data collection'],
    22: ['1,500', '1500'],
    23: ['5'],
    24: ['3,000-4,000', '3000-4000', '3,000 to 4,000'],
    25: ['B', 'C'],
    26: ['B', 'C'],
    27: ['Mehta'],
    28: ['Survey Research'],
    29: ['London University', 'London University Press'],
    30: ['1988'],
    31: ['C'],
    32: ['A'],
    33: ['mass media', 'media'],
    34: ['academic circles', 'academics', 'researchers'],
    35: ['specialist knowledge', 'specialised knowledge'],
    36: ['unaware'],
    37: ['individual customers', 'individual consumers', 'individuals'],
    38: ['illegal profit', 'illegal profits'],
    39: ['D', 'E'],
    40: ['D', 'E'],
  },
  3: {
    1: ['1 1/2 years', 'one and a half years', '18 months', '1.5 years'],
    2: ['Forest', 'Forrest'],
    3: ['Academic'],
    4: ['Thursday'],
    5: ['B'],
    6: ['B'],
    7: ['A'],
    8: ['deposit'],
    9: ['monthly'],
    10: ['telephone', 'phone'],
    11: ['C'],
    12: ['A'],
    13: ['C'],
    14: ['B'],
    15: ['lighting', 'lights', 'light'],
    16: ['adult', 'adults'],
    17: ['Studio Theatre', 'the Studio Theatre', 'Studio Theater', 'the Studio Theater'],
    18: ['the whole family', 'all the family', 'families'],
    19: ['City Gardens', 'the City Gardens', 'in City Gardens', 'outdoors'],
    20: ['young children', 'younger children', 'children'],
    21: ['A'],
    22: ['B'],
    23: ['C'],
    24: ['A'],
    25: ['B'],
    26: ['A'],
    27: ['C'],
    28: ['B'],
    29: ['B'],
    30: ['B'],
    31: ['questionnaire'],
    32: ['approximately 2,000', 'about 2,000', 'approximately 2000', 'about 2000'],
    33: ['Education'],
    34: ['halls of residence', 'living quarters'],
    35: ['traffic', 'parking'],
    36: ['most lecture rooms', 'lecture rooms', 'lecture halls', 'lecture theatres', 'lecture theaters'],
    37: ['choice of facilities', 'facilities', 'room for facilities'],
    38: ['D', 'F'],
    39: ['B'],
    40: ['A', 'C'],
  },
  4: {
    1: ['College Dining Room'],
    2: ['office staff', 'students'],
    3: ['office staff', 'students'],
    4: ['10th December'],
    5: ['coffee break', 'coffee breaks'],
    6: ['6'],
    7: ['set of dictionaries', 'dictionaries', 'a good dictionary'],
    8: ['music', 'music tapes', 'tapes', 'some music', 'some music tapes', 'some tapes', 'photos', 'photographs'],
    9: ['music', 'music tapes', 'tapes', 'some music', 'some music tapes', 'some tapes', 'photos', 'photographs'],
    10: ['speech'],
    11: ['B'],
    12: ['A'],
    13: ['A'],
    14: ['A'],
    15: ['B'],
    16: ['180'],
    17: ['nearest station'],
    18: ['local history'],
    19: ['690'],
    20: ['walking club', 'local walking club'],
    21: ['20 balloons'],
    22: ['units of measurement', 'measurements', 'measurement units'],
    23: ['rock salt', 'salt'],
    24: ['crystals'],
    25: ['string', 'piece of string'],
    26: ['ordinary white light', 'white light'],
    27: ['H'],
    28: ['B'],
    29: ['E'],
    30: ['C'],
    31: ['795'],
    32: ['tail'],
    33: ['floor', 'bed', 'bottom'],
    34: ['sense of smell'],
    35: ['A'],
    36: ['A'],
    37: ['B'],
    38: ['B'],
    39: ['B', 'E'],
    40: ['B', 'E'],
  },
};

function answerMapForTest(testNumber: number): Map<number, string[]> {
  return new Map(Object.entries(CAMBRIDGE_4_LISTENING_ANSWERS[testNumber] ?? {})
    .map(([key, value]) => [Number.parseInt(key, 10), value]));
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(entryPath);
    if (entry.isFile()) return [entryPath];
    return [];
  }));
  return files.flat();
}

function parseAudioFile(bookNumber: number, filePath: string): AudioSource | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const testMatch = /test\s*([1-4])/i.exec(normalized);
  const sectionMatch = /(?:section|part|audio)\s*([1-4])/i.exec(normalized);
  if (!testMatch || !sectionMatch) return null;
  const testNumber = Number.parseInt(testMatch[1], 10);
  const sectionNumber = Number.parseInt(sectionMatch[1], 10);
  return {
    testNumber,
    sectionNumber,
    filePath,
    sourceAudioFilename: path.basename(filePath),
    storagePath: `cambridge-${bookNumber}/test-${testNumber}/section-${sectionNumber}${ext}`,
  };
}

async function findAudioSources(bookNumber: number): Promise<Map<string, AudioSource>> {
  const entries = await readdir(DEFAULT_RAW_DIR);
  const audioDirName = entries.find((entry) => entry.includes(`【${bookNumber}】`) && entry.includes('听力音频'));
  if (!audioDirName) throw new Error(`找不到 Cambridge ${bookNumber} 听力音频目录。`);
  const audioDir = path.join(DEFAULT_RAW_DIR, audioDirName);
  const files = await listFilesRecursive(audioDir);
  const sources = new Map<string, AudioSource>();
  for (const file of files) {
    const source = parseAudioFile(bookNumber, file);
    if (!source) continue;
    sources.set(`${source.testNumber}:${source.sectionNumber}`, source);
  }
  return sources;
}

function buildBook(text: string, sourceLabel: string, bookNumber: number, audioSources: Map<string, AudioSource>): ImportedListeningBook {
  const chunks = extractMainListeningTestChunks(text);
  const tests: ImportedListeningTest[] = [];

  for (const [testNumber, testChunk] of [...chunks.entries()].sort((left, right) => left[0] - right[0])) {
    const answerMap = answerMapForTest(testNumber);
    const sectionChunks = splitSections(testChunk);
    const sections: ImportedListeningSection[] = [];

    for (const [sectionNumber, sectionChunk] of [...sectionChunks.entries()].sort((left, right) => left[0] - right[0])) {
      const audioSource = audioSources.get(`${testNumber}:${sectionNumber}`);
      sections.push({
        sectionNumber,
        title: `Section ${sectionNumber}`,
        instructions: sectionChunk.trim(),
        sourceAudioFilename: audioSource?.sourceAudioFilename ?? '',
        audioStoragePath: audioSource?.storagePath ?? `cambridge-${bookNumber}/test-${testNumber}/section-${sectionNumber}.mp3`,
        paperPages: [],
        groups: buildGroups(sectionChunk, sectionNumber, answerMap),
      });
    }

    tests.push({
      testNumber,
      title: `Cambridge IELTS ${bookNumber} Listening Test ${testNumber}`,
      sections,
    });
  }

  return {
    bookNumber,
    title: `Cambridge IELTS ${bookNumber} Listening`,
    sourceLabel,
    tests,
  };
}

interface PaperOverlayResult {
  paperPagesBySection: Record<string, IeltsListeningPaperPage[]>;
  hotspots: Record<string, IeltsListeningPaperHotspot>;
  missingSections: string[];
  summary: {
    paperPageCount: number;
    uniquePdfPageCount: number;
    hotspotCount: number;
    fallbackHotspotCount: number;
  };
}

async function attachPaperOverlay(book: ImportedListeningBook, pdfPath: string) {
  const overlayInputPath = path.join(DEFAULT_OUTPUT_DIR, `cambridge-${book.bookNumber}-listening.paper-input.json`);
  await mkdir(path.dirname(overlayInputPath), { recursive: true });
  await writeFile(overlayInputPath, `${JSON.stringify(book, null, 2)}\n`);

  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'extract-ielts-listening-paper.py');
  const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath, overlayInputPath], {
    maxBuffer: 80 * 1024 * 1024,
  });
  const overlay = JSON.parse(stdout) as PaperOverlayResult;

  for (const test of book.tests) {
    for (const section of test.sections) {
      section.paperPages = overlay.paperPagesBySection[`${test.testNumber}:${section.sectionNumber}`] ?? [];
      for (const group of section.groups) {
        for (const question of group.questions) {
          question.paperHotspot = overlay.hotspots[`${test.testNumber}:${question.questionNumber}`];
        }
      }
    }
  }
}

function validateBook(book: ImportedListeningBook, audioSources: Map<string, AudioSource>): ImportReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sectionCount = book.tests.reduce((sum, test) => sum + test.sections.length, 0);
  const questions = book.tests.flatMap((test) => test.sections.flatMap((section) => section.groups.flatMap((group) => group.questions)));
  const answerCount = questions.filter((question) => question.answers.length > 0).length;
  const paperPageCount = book.tests.reduce(
    (sum, test) => sum + test.sections.reduce((sectionSum, section) => sectionSum + section.paperPages.length, 0),
    0,
  );
  const uniquePaperPageCount = new Set(book.tests.flatMap((test) => (
    test.sections.flatMap((section) => section.paperPages.map((page) => page.pdfPage))
  ))).size;
  const hotspotCount = questions.filter((question) => question.paperHotspot).length;
  const fallbackHotspotCount = questions.filter((question) => question.paperHotspot?.source === 'fallback-grid').length;

  if (book.tests.length !== 4) errors.push(`Expected 4 tests, found ${book.tests.length}`);
  if (sectionCount !== 16) errors.push(`Expected 16 sections, found ${sectionCount}`);
  if (questions.length !== 160) errors.push(`Expected 160 questions, found ${questions.length}`);
  if (answerCount !== 160) errors.push(`Expected 160 answers, found ${answerCount}`);
  if (audioSources.size !== 16) errors.push(`Expected 16 audio files, found ${audioSources.size}`);
  if (paperPageCount < 16) errors.push(`Expected paper pages for 16 sections, found ${paperPageCount}`);
  if (hotspotCount !== 160) errors.push(`Expected 160 paper hotspots, found ${hotspotCount}`);

  for (const test of book.tests) {
    if (test.sections.length !== 4) errors.push(`Test ${test.testNumber}: expected 4 sections, found ${test.sections.length}`);
    const testQuestions = test.sections.flatMap((section) => section.groups.flatMap((group) => group.questions));
    if (testQuestions.length !== 40) errors.push(`Test ${test.testNumber}: expected 40 questions, found ${testQuestions.length}`);
    for (let questionNumber = 1; questionNumber <= 40; questionNumber += 1) {
      if (!testQuestions.some((question) => question.questionNumber === questionNumber)) {
        errors.push(`Test ${test.testNumber}: missing question ${questionNumber}`);
      }
    }
    for (const section of test.sections) {
      if (!section.sourceAudioFilename) warnings.push(`Test ${test.testNumber} Section ${section.sectionNumber}: missing audio source`);
      if (section.paperPages.length === 0) errors.push(`Test ${test.testNumber} Section ${section.sectionNumber}: missing paper page`);
      const sectionHotspots = section.groups.flatMap((group) => group.questions).filter((question) => question.paperHotspot).length;
      if (sectionHotspots !== 10) errors.push(`Test ${test.testNumber} Section ${section.sectionNumber}: expected 10 paper hotspots, found ${sectionHotspots}`);
    }
  }

  return {
    summary: {
      bookNumber: book.bookNumber,
      testCount: book.tests.length,
      sectionCount,
      questionCount: questions.length,
      answerCount,
      audioCount: audioSources.size,
      paperPageCount,
      uniquePaperPageCount,
      hotspotCount,
      fallbackHotspotCount,
    },
    errors,
    warnings,
  };
}

async function writeDryRunOutput(book: ImportedListeningBook, report: ImportReport, outPath?: string) {
  const candidatePath = outPath ?? path.join(DEFAULT_OUTPUT_DIR, `cambridge-${book.bookNumber}-listening.json`);
  const reportPath = candidatePath.replace(/\.json$/i, '.report.json');
  await mkdir(path.dirname(candidatePath), { recursive: true });
  await writeFile(candidatePath, `${JSON.stringify(book, null, 2)}\n`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { candidatePath, reportPath };
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.aac') return 'audio/aac';
  return 'audio/mpeg';
}

async function ensureAudioBucket() {
  const bucketOptions = {
    public: true,
    allowedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/aac'],
  };

  const { data: existingBucket, error: getBucketError } = await supabaseAdmin.storage.getBucket(AUDIO_BUCKET);
  if (existingBucket) {
    const { error } = await supabaseAdmin.storage.updateBucket(AUDIO_BUCKET, bucketOptions);
    if (error) throw new Error(`Audio bucket update failed: ${error.message}`);
    return;
  }
  if (getBucketError && !getBucketError.message.toLowerCase().includes('not found')) {
    throw new Error(`Audio bucket lookup failed: ${getBucketError.message}`);
  }

  const { error } = await supabaseAdmin.storage.createBucket(AUDIO_BUCKET, bucketOptions);
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`Audio bucket setup failed: ${error.message}`);
  }
}

async function uploadAudioSources(audioSources: Map<string, AudioSource>): Promise<Map<string, string>> {
  await ensureAudioBucket();
  const urls = new Map<string, string>();
  for (const [key, source] of audioSources.entries()) {
    const buffer = await readFile(source.filePath);
    const { error } = await supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .upload(source.storagePath, buffer, {
        contentType: contentTypeFor(source.filePath),
        upsert: true,
      });
    if (error) throw new Error(`Audio upload failed [${source.storagePath}]: ${error.message}`);
    const { data } = supabaseAdmin.storage.from(AUDIO_BUCKET).getPublicUrl(source.storagePath);
    urls.set(key, data.publicUrl);
  }
  return urls;
}

async function ensurePaperBucket() {
  const bucketOptions = {
    public: true,
    allowedMimeTypes: ['image/jpeg'],
  };

  const { data: existingBucket, error: getBucketError } = await supabaseAdmin.storage.getBucket(PAPER_BUCKET);
  if (existingBucket) {
    const { error } = await supabaseAdmin.storage.updateBucket(PAPER_BUCKET, bucketOptions);
    if (error) throw new Error(`Paper bucket update failed: ${error.message}`);
    return;
  }
  if (getBucketError && !getBucketError.message.toLowerCase().includes('not found')) {
    throw new Error(`Paper bucket lookup failed: ${getBucketError.message}`);
  }

  const { error } = await supabaseAdmin.storage.createBucket(PAPER_BUCKET, bucketOptions);
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`Paper bucket setup failed: ${error.message}`);
  }
}

function getPaperPages(book: ImportedListeningBook): IeltsListeningPaperPage[] {
  const pages = new Map<string, IeltsListeningPaperPage>();
  for (const test of book.tests) {
    for (const section of test.sections) {
      for (const page of section.paperPages) {
        pages.set(page.storagePath, page);
      }
    }
  }
  return [...pages.values()].sort((left, right) => left.pdfPage - right.pdfPage);
}

async function renderPdfPage(pdfPath: string, pdfPage: number): Promise<string> {
  const outputDir = path.join(DEFAULT_OUTPUT_DIR, 'paper-pages');
  await mkdir(outputDir, { recursive: true });
  const prefix = path.join(outputDir, `page-${String(pdfPage).padStart(3, '0')}`);
  await execFileAsync('pdftoppm', [
    '-jpeg',
    '-r',
    '150',
    '-f',
    String(pdfPage),
    '-l',
    String(pdfPage),
    pdfPath,
    prefix,
  ], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const renderedPath = `${prefix}-${String(pdfPage).padStart(3, '0')}.jpg`;
  if (!(await pathExists(renderedPath))) {
    throw new Error(`PDF page render failed for page ${pdfPage}`);
  }
  return renderedPath;
}

async function uploadPaperPages(book: ImportedListeningBook, pdfPath: string): Promise<Map<string, string>> {
  await ensurePaperBucket();
  const urls = new Map<string, string>();
  for (const page of getPaperPages(book)) {
    const renderedPath = await renderPdfPage(pdfPath, page.pdfPage);
    const buffer = await readFile(renderedPath);
    const { error } = await supabaseAdmin.storage
      .from(PAPER_BUCKET)
      .upload(page.storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (error) throw new Error(`Paper page upload failed [${page.storagePath}]: ${error.message}`);
    const { data } = supabaseAdmin.storage.from(PAPER_BUCKET).getPublicUrl(page.storagePath);
    urls.set(page.storagePath, data.publicUrl);
  }

  for (const test of book.tests) {
    for (const section of test.sections) {
      section.paperPages = section.paperPages.map((page) => ({
        ...page,
        imageUrl: urls.get(page.storagePath) ?? page.imageUrl,
      }));
    }
  }

  return urls;
}

function sourceHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

async function applyBook(book: ImportedListeningBook, audioSources: Map<string, AudioSource>, pdfPath: string) {
  const audioUrls = await uploadAudioSources(audioSources);
  await uploadPaperPages(book, pdfPath);
  const { data: bookRow, error: bookError } = await supabaseAdmin
    .from('ielts_listening_books')
    .upsert({
      book_number: book.bookNumber,
      title: book.title,
      source_label: book.sourceLabel,
    }, { onConflict: 'book_number' })
    .select('id')
    .single();
  if (bookError || !bookRow) throw new Error(`ielts_listening_books upsert failed: ${bookError?.message ?? 'missing row'}`);

  for (const test of book.tests) {
    const { data: testRow, error: testError } = await supabaseAdmin
      .from('ielts_listening_tests')
      .upsert({
        book_id: bookRow.id,
        test_number: test.testNumber,
        title: test.title,
      }, { onConflict: 'book_id,test_number' })
      .select('id')
      .single();
    if (testError || !testRow) throw new Error(`ielts_listening_tests upsert failed [Test ${test.testNumber}]: ${testError?.message ?? 'missing row'}`);

    for (const section of test.sections) {
      const audioKey = `${test.testNumber}:${section.sectionNumber}`;
      const audioUrl = audioUrls.get(audioKey) ?? section.audioUrl ?? '';
      const { data: sectionRow, error: sectionError } = await supabaseAdmin
        .from('ielts_listening_sections')
        .upsert({
          test_id: testRow.id,
          section_number: section.sectionNumber,
          title: section.title,
          instructions: section.instructions,
          audio_url: audioUrl,
          audio_storage_path: section.audioStoragePath,
          source_audio_filename: section.sourceAudioFilename,
          paper_pages_json: section.paperPages,
          sort_order: section.sectionNumber,
        }, { onConflict: 'test_id,section_number' })
        .select('id')
        .single();
      if (sectionError || !sectionRow) {
        throw new Error(`ielts_listening_sections upsert failed [Test ${test.testNumber} Section ${section.sectionNumber}]: ${sectionError?.message ?? 'missing row'}`);
      }

      const { error: deleteGroupsError } = await supabaseAdmin
        .from('ielts_listening_question_groups')
        .delete()
        .eq('section_id', sectionRow.id);
      if (deleteGroupsError) throw new Error(`ielts_listening_question_groups cleanup failed: ${deleteGroupsError.message}`);

      for (const [groupIndex, group] of section.groups.entries()) {
        const { data: groupRow, error: groupError } = await supabaseAdmin
          .from('ielts_listening_question_groups')
          .insert({
            section_id: sectionRow.id,
            question_type: group.type,
            prompt: group.prompt,
            instructions: group.instructions,
            options_json: group.options,
            question_range_start: group.rangeStart,
            question_range_end: group.rangeEnd,
            sort_order: groupIndex,
          })
          .select('id')
          .single();
        if (groupError || !groupRow) throw new Error(`ielts_listening_question_groups insert failed: ${groupError?.message ?? 'missing row'}`);

        const questionRows = group.questions.map((question, questionIndex) => ({
          test_id: testRow.id,
          section_id: sectionRow.id,
          group_id: groupRow.id,
          question_number: question.questionNumber,
          prompt: question.prompt,
          options_json: question.options.length > 0 ? question.options : group.options,
          answer_json: question.answers,
          answer_note: question.answerNote || (question.answers.length > 1 ? `Cambridge 4 answer variants ${sourceHash(question.answers.join('|'))}` : ''),
          paper_hotspot_json: question.paperHotspot ?? null,
          sort_order: questionIndex,
        }));

        if (questionRows.length > 0) {
          const { error: questionsError } = await supabaseAdmin
            .from('ielts_listening_questions')
            .insert(questionRows);
          if (questionsError) throw new Error(`ielts_listening_questions insert failed: ${questionsError.message}`);
        }
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { text, sourceLabel, pdfPath } = await readSourceText(args);
  const audioSources = await findAudioSources(args.book!);
  const book = buildBook(text, sourceLabel, args.book!, audioSources);
  await attachPaperOverlay(book, pdfPath);
  const report = validateBook(book, audioSources);
  const output = await writeDryRunOutput(book, report, args.out);

  console.log(`IELTS listening import candidate: Cambridge ${report.summary.bookNumber}`);
  console.log(`Tests: ${report.summary.testCount}, sections: ${report.summary.sectionCount}, questions: ${report.summary.questionCount}, answers: ${report.summary.answerCount}, audio: ${report.summary.audioCount}`);
  console.log(`Paper pages: ${report.summary.paperPageCount} (${report.summary.uniquePaperPageCount} unique), hotspots: ${report.summary.hotspotCount}, fallback hotspots: ${report.summary.fallbackHotspotCount}`);
  console.log(`Candidate JSON: ${output.candidatePath}`);
  console.log(`Report JSON: ${output.reportPath}`);

  for (const warning of report.warnings) console.warn(`WARN: ${warning}`);
  for (const error of report.errors) console.error(`ERROR: ${error}`);

  if (args.apply) {
    if (report.errors.length > 0) {
      throw new Error('校验未通过，已拒绝写入数据库。先修正 candidate JSON/report 后再 --apply。');
    }
    await applyBook(book, audioSources, pdfPath);
    console.log('IELTS listening import applied successfully.');
  } else {
    console.log('Dry-run complete. Review the JSON/report before applying.');
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
