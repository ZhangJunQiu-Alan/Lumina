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
    throw new Error('请传 --book <number>。当前支持 --book 4, 5, 6, 7, 8, 9 或 10。');
  }
  if (![4, 5, 6, 7, 8, 9, 10].includes(args.book)) {
    throw new Error('IELTS listening 当前支持 Cambridge 4-10。');
  }
  if (!args.dryRun && !args.apply) args.dryRun = true;
  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  npm run import:ielts-listening -- --book 4 --dry-run',
    '  npm run import:ielts-listening -- --book 4 --apply',
    '  npm run import:ielts-listening -- --book 5 --dry-run',
    '  npm run import:ielts-listening -- --book 5 --apply',
    '  npm run import:ielts-listening -- --book 6 --dry-run',
    '  npm run import:ielts-listening -- --book 6 --apply',
    '  npm run import:ielts-listening -- --book 7 --dry-run',
    '  npm run import:ielts-listening -- --book 7 --apply',
    '  npm run import:ielts-listening -- --book 8 --dry-run',
    '  npm run import:ielts-listening -- --book 8 --apply',
    '  npm run import:ielts-listening -- --book 9 --dry-run',
    '  npm run import:ielts-listening -- --book 9 --apply',
    '  npm run import:ielts-listening -- --book 10 --dry-run',
    '  npm run import:ielts-listening -- --book 10 --apply',
    '  npm run import:ielts-listening -- --book 4 --text output/ielts-reading/cambridge-4-extracted.txt --dry-run',
  ].join('\n'));
}

function lineClean(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+$/g, '')
    .trim();
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/L\s*I\s*S\s*T\s*E\s*N\s*I\s*N\s*G/gi, 'LISTENING')
    .replace(/S\s*e\s*c\s*t\s*i\s*o\s*n/gi, 'Section')
    .replace(/Q\s*u\s*e\s*s\s*t\s*i\s*o\s*n\s*s/gi, 'Questions')
    .replace(/[＋+^~〜～]/g, '-')
    .replace(/[一—–]/g, '-')
    .replace(/[，]/g, ',')
    .replace(/Questions?\s*[~:]\s*/gi, 'Questions ')
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

async function extractTextWithVisionOcr(pdfPath: string, bookNumber: number): Promise<{ text: string; sourceLabel: string; ocrJsonPath: string } | null> {
  const ocrJsonPath = path.join(DEFAULT_OUTPUT_DIR, '..', 'ielts-ocr', `cambridge-${bookNumber}.json`);
  try {
    if (!(await pathExists(ocrJsonPath))) {
      const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'extract-pdf-vision-ocr.swift');
      await execFileAsync('swift', [scriptPath, '--pdf', pdfPath, '--out', ocrJsonPath], {
        maxBuffer: 120 * 1024 * 1024,
      });
    }
    const payload = JSON.parse(await readFile(ocrJsonPath, 'utf8')) as { text?: string };
    const text = normalizeExtractedText(payload.text ?? '');
    const englishChars = (text.match(/[A-Za-z]/g) ?? []).length;
    return englishChars >= 500 ? { text, sourceLabel: path.basename(ocrJsonPath), ocrJsonPath } : null;
  } catch {
    return null;
  }
}

async function readSourceText(args: CliArgs): Promise<{ text: string; sourceLabel: string; pdfPath: string; ocrJsonPath?: string }> {
  const pdfPath = args.pdf ?? await findBookPdf(args.book!);
  const textPath = args.text ?? `output/ielts-reading/cambridge-${args.book}-extracted.txt`;
  if (await pathExists(textPath)) {
    const text = normalizeExtractedText(await readFile(textPath, 'utf8'));
    const englishChars = (text.match(/[A-Za-z]/g) ?? []).length;
    if (englishChars >= 500) {
      return {
        text,
        sourceLabel: path.basename(textPath),
        pdfPath,
      };
    }
  }

  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'extract-pdf-text.py');
  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath], {
      maxBuffer: 80 * 1024 * 1024,
    });
    const text = normalizeExtractedText(stdout);
    const englishChars = (text.match(/[A-Za-z]/g) ?? []).length;
    if (englishChars >= 500) {
      return {
        text,
        sourceLabel: path.basename(pdfPath),
        pdfPath,
      };
    }
  } catch {
    // Fall through to Vision OCR for scanned PDFs.
  }

  const ocr = await extractTextWithVisionOcr(pdfPath, args.book!);
  if (ocr) {
    return {
      ...ocr,
      pdfPath,
    };
  }

  throw new Error(`无法从 Cambridge ${args.book} PDF 提取足够文字。`);
}

function extractMainListeningTestChunks(text: string): Map<number, string> {
  const anchors: { testNumber: number; index: number }[] = [];
  const re = /(?:^|[\n\f])\s*Test\s*([1-4])\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const testNumber = Number.parseInt(match[1], 10);
    const sample = text.slice(match.index, match.index + 3000);
    const listeningIndex = sample.search(/LISTE/i);
    const sectionOneIndex = sample.search(/\bSECTION\s+(?:1|I)\b/i);
    const beforeSection = sectionOneIndex >= 0 ? sample.slice(0, sectionOneIndex) : '';
    if (
      sectionOneIndex < 0
      || listeningIndex < 0
      || Math.abs(listeningIndex - sectionOneIndex) > 1400
      || /\b(?:READING|WRITING|SPEAKING)\b/i.test(beforeSection)
    ) continue;
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
    .forEach((anchor, index, ordered) => {
      const nextTestIndex = ordered[index + 1]?.index ?? text.length;
      const testText = text.slice(anchor.index, nextTestIndex);
      const readingOffset = testText.search(/\n\s*R\s*E?\s*~?\s*A\s*DING\b|\n\s*READING\b|\n\s*READING PASSAGE\b/i);
      const chunk = readingOffset > 0 ? testText.slice(0, readingOffset) : testText;
      chunks.set(anchor.testNumber, chunk);
    });

  return chunks;
}

function splitSections(testChunk: string): Map<number, string> {
  const anchors: { sectionNumber: number; index: number }[] = [];
  const re = /\bSECTION\s+([1-4]|I{1,3}|IV)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(testChunk))) {
    const sectionNumber = parseSectionNumber(match[1]);
    if (!sectionNumber) continue;
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

function parseSectionNumber(value: string): number | null {
  const normalized = value.trim().toUpperCase();
  const romanSections: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
  };
  if (romanSections[normalized]) return romanSections[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return parsed >= 1 && parsed <= 4 ? parsed : null;
}

function parseQuestionRange(value: string): { start: number; end: number } | null {
  const questionNumberToken = '([0-9](?:\\s*[0-9Oo])?)';
  const match = new RegExp(`Questions?[\\s~:.-]+${questionNumberToken}(?:\\s*(?:-|to|and|&)\\s*${questionNumberToken})?`, 'i').exec(value);
  if (!match) return null;
  const normalizeToken = (token: string) => Number.parseInt(token.replace(/[Oo]/g, '0').replace(/\s+/g, ''), 10);
  const start = normalizeToken(match[1]);
  const end = match[2] ? normalizeToken(match[2]) : start;
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
  const headingRe = /Questions?[\s~:.-]+[0-9](?:\s*[0-9Oo])?(?:\s*(?:-|to|and|&)\s*[0-9](?:\s*[0-9Oo])?)?/gi;
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

  const adjustedMatches = usableMatches.map((heading, index, ordered) => {
    let end = heading.end;
    const nextHeading = ordered[index + 1];
    if (nextHeading && nextHeading.start <= end) {
      end = Math.max(heading.start, nextHeading.start - 1);
    }
    return { ...heading, end };
  }).filter((heading) => heading.start <= heading.end);

  return adjustedMatches.map((heading, index, ordered) => {
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

const LISTENING_ANSWERS_BY_BOOK: Record<number, Record<number, Record<number, string[]>>> = {
  4: {
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
  },
  5: {
    1: {
      1: ['by minibus', 'a minibus'],
      2: ['15', '15 people'],
      3: ['April (the) 18th', '18th April'],
      4: ['Pallisades'],
      5: ['B', 'D'],
      6: ['B', 'D'],
      7: ['280'],
      8: ['14'],
      9: ['20%'],
      10: ['39745T'],
      11: ['move around', 'move about'],
      12: ['brakes'],
      13: ['fingers'],
      14: ['satisfactory'],
      15: ['put (it) together'],
      16: ['too wide'],
      17: ['dangerous'],
      18: ['wheels'],
      19: ['(the) best', '(the) best buy', 'safe'],
      20: ['sharp'],
      21: ['B'],
      22: ['A'],
      23: ['C'],
      24: ['B', 'D'],
      25: ['B', 'D'],
      26: ['full-time'],
      27: ['a term', 'one term'],
      28: ['intensive'],
      29: ['two modules', '(for) two terms'],
      30: ['a topic', 'one topic'],
      31: ['politics'],
      32: ['learn'],
      33: ["children's education", "their children's education"],
      34: ['a car'],
      35: ['nursing care'],
      36: ['crisis'],
      37: ['early twenties'],
      38: ['confidence'],
      39: ['money management'],
      40: ['low-risk investments'],
    },
    2: {
      1: ['(passport) photos', '(passport) photographs'],
      2: ['(a) bank statement'],
      3: ['125', '125 per year'],
      4: ['8'],
      5: ['1.50'],
      6: ['48'],
      7: ['local papers', 'local newspapers'],
      8: ['(a) card', 'cards'],
      9: ['Grantingham'],
      10: ['Friday'],
      11: ['C'],
      12: ['C'],
      13: ['A'],
      14: ['C'],
      15: ['A'],
      16: ['£75,000', '75,000'],
      17: ['computers'],
      18: ['C', 'E', 'F'],
      19: ['C', 'E', 'F'],
      20: ['C', 'E', 'F'],
      21: ['home', "student's home"],
      22: ['(have) dinner', 'come to dinner', 'go to dinner'],
      23: ['technical'],
      24: ['slang'],
      25: ['cooperating', 'cooperation'],
      26: ['persuading'],
      27: ['editing'],
      28: ['complete'],
      29: ['experiment'],
      30: ['long'],
      31: ['58'],
      32: ['desert'],
      33: ['science'],
      34: ['hospital', 'small hospital'],
      35: ['ship'],
      36: ['platforms'],
      37: ['3,500', '3500'],
      38: ['currents', 'ocean currents'],
      39: ['(the) pollution'],
      40: ['young'],
    },
    3: {
      1: ['1.4 litres', '1.4 liters'],
      2: ['automatic'],
      3: ['light', 'sky'],
      4: ['credit'],
      5: ['Harries'],
      6: ['Dr', 'Doctor'],
      7: ['Alton'],
      8: ['messages'],
      9: ['Lion'],
      10: ['reasonable'],
      11: ['C', 'E'],
      12: ['C', 'E'],
      13: ['references'],
      14: ['country'],
      15: ['weather'],
      16: ['C'],
      17: ['C'],
      18: ['A'],
      19: ['B'],
      20: ['C'],
      21: ['5th May'],
      22: ['16th July', 'Friday 16th July'],
      23: ['clear', 'was clear'],
      24: ['(an/the) outline', '(a/the) course outline'],
      25: ['(the) 2nd half'],
      26: ['(standard of) teaching', '(standard of) teachers'],
      27: ['discussion', 'group discussion'],
      28: ['handouts'],
      29: ['written work'],
      30: ['student support', 'support for students'],
      31: ['12.5%'],
      32: ['incineration plants'],
      33: ['drop-off'],
      34: ['cooking'],
      35: ['500,000', '500000'],
      36: ['roads'],
      37: ['soil conditioner'],
      38: ['containers'],
      39: ['pencils'],
      40: ['business cards'],
    },
    4: {
      1: ['14 Hill Road'],
      2: ['between 9 and 9.30', '9-9.30'],
      3: ['1 year', 'one year'],
      4: ['intermediate'],
      5: ['North-West', 'North West'],
      6: ['vegetarian'],
      7: ['(a) (real) garden', '(a) garden', 'real garden'],
      8: ['(the) only guest', 'only guest'],
      9: ['100'],
      10: ['23rd March', 'Monday 23rd March'],
      11: ['clubhouse'],
      12: ['picnic'],
      13: ['prizes'],
      14: ['10'],
      15: ['Wednesday afternoon(s)', 'Wednesday afternoon', 'Wednesday afternoons'],
      16: ['4'],
      17: ['Sunday afternoon(s)', 'Sunday afternoon', 'Sunday afternoons'],
      18: ['collect (the) fees', 'collect (the) money'],
      19: ['send (out/the) newsletter(s)', 'send out newsletters', 'send the newsletters'],
      20: ['supervise (the) teams'],
      21: ['sales'],
      22: ['competition'],
      23: ['interest rates', 'rates of interest'],
      24: ['training'],
      25: ['A'],
      26: ['B'],
      27: ['A'],
      28: ['C'],
      29: ['B'],
      30: ['D'],
      31: ['B'],
      32: ['A'],
      33: ['A'],
      34: ['C'],
      35: ['A'],
      36: ['B'],
      37: ['B'],
      38: ['A'],
      39: ['B'],
      40: ['C'],
    },
  },
  6: {
    1: {
      1: ['keep-fit studio', 'keep fit studio', 'a keep-fit studio', 'a keep fit studio'],
      2: ['swimming'],
      3: ['yoga', 'yoga classes'],
      4: ['salad bar', 'a salad bar'],
      5: ['500'],
      6: ['1'],
      7: ['10 4.30', '10 am 4.30 pm', '10.00 4.30', '10.00 am 4.30 pm'],
      8: ['180'],
      9: ['assessment'],
      10: ['Kynchley'],
      11: ['B'],
      12: ['G'],
      13: ['C'],
      14: ['A'],
      15: ['E'],
      16: ['D'],
      17: ['19th October', 'October 19th', 'October the 19th'],
      18: ['7'],
      19: ['Monday Thursday', 'Thursday Monday', 'Monday and Thursday', 'Thursday and Monday'],
      20: ['18'],
      21: ['A'],
      22: ['in advance'],
      23: ['nursery'],
      24: ['annual fee'],
      25: ['tutor'],
      26: ['laptops', 'lap tops', 'printers'],
      27: ['laptops', 'lap tops', 'printers'],
      28: ['report writing'],
      29: ['marketing'],
      30: ['individual'],
      31: ['feed'],
      32: ['metal leather', 'leather metal'],
      33: ['restrictions'],
      34: ['ships'],
      35: ['England'],
      36: ['built'],
      37: ['poverty'],
      38: ['C', 'E', 'F'],
      39: ['C', 'E', 'F'],
      40: ['C', 'E', 'F'],
    },
    2: {
      1: ['8'],
      2: ['Tamer', 'in Tamer', 'on Tamer'],
      3: ['green button'],
      4: ['library'],
      5: ['education department'],
      6: ['castles'],
      7: ['old clothes'],
      8: ['bottle tops'],
      9: ['Undersea Worlds'],
      10: ['silver paper'],
      11: ['King Street'],
      12: ['central'],
      13: ['half hour', '30 minutes'],
      14: ['refreshments'],
      15: ['10.15'],
      16: ['Advance'],
      17: ['seat reservations', 'reservations'],
      18: ['C', 'D', 'G'],
      19: ['C', 'D', 'G'],
      20: ['C', 'D', 'G'],
      21: ['catalogs', 'catalogues'],
      22: ['computer centre', 'computer center'],
      23: ['checklist'],
      24: ['teaching experience'],
      25: ['classroom'],
      26: ['review'],
      27: ['schools'],
      28: ['2000', 'the year 2000'],
      29: ['end of term'],
      30: ['research'],
      31: ['A'],
      32: ['B'],
      33: ['C'],
      34: ['A'],
      35: ['A'],
      36: ['C'],
      37: ['A'],
      38: ['Great Train Robbery'],
      39: ['Sound effects'],
      40: ['poor sound quality'],
    },
    3: {
      1: ['Select'],
      2: ['27.01.1973', '27/01/1973'],
      3: ['15 Riverside'],
      4: ['2 weeks', 'two weeks'],
      5: ['616295'],
      6: ['engineer'],
      7: ['mother'],
      8: ['2,000', '2000'],
      9: ['month'],
      10: ['internet'],
      11: ['C'],
      12: ['A'],
      13: ['C'],
      14: ['H'],
      15: ['F'],
      16: ['B'],
      17: ['D'],
      18: ['field'],
      19: ['footbridge'],
      20: ['viewpoint'],
      21: ['entertainment industry'],
      22: ['telephone interviews'],
      23: ['30', 'thirty'],
      24: ['male and female'],
      25: ['Jazz'],
      26: ['classical'],
      27: ['concerts'],
      28: ['department stores'],
      29: ['club'],
      30: ['opera house'],
      31: ['C'],
      32: ['A'],
      33: ['A'],
      34: ['B'],
      35: ['people'],
      36: ['water sand', 'sand water'],
      37: ['Scotland'],
      38: ['outside'],
      39: ['local'],
      40: ['tops'],
    },
    4: {
      1: ['75'],
      2: ['cheque', 'check'],
      3: ['15'],
      4: ['25'],
      5: ['10 minutes', '10 minute', '10 mins', '10 min'],
      6: ['conference pack'],
      7: ['South'],
      8: ['library'],
      9: ['5'],
      10: ['21A'],
      11: ['D'],
      12: ['A'],
      13: ['C'],
      14: ['tax'],
      15: ['security'],
      16: ['ground floor'],
      17: ['lecture room 311'],
      18: ['Safety at Work'],
      19: ['Main Hall'],
      20: ['team leaders'],
      21: ['reference'],
      22: ['textbooks'],
      23: ['secondary'],
      24: ['primary'],
      25: ['back'],
      26: ['overdue books', 'overdue ones'],
      27: ['7 working days', 'seven working days'],
      28: ['C', 'E', 'F'],
      29: ['C', 'E', 'F'],
      30: ['C', 'E', 'F'],
      31: ['B'],
      32: ['A'],
      33: ['B'],
      34: ['C'],
      35: ['1,450', '1450'],
      36: ['disease'],
      37: ['wealthy prince', 'prince'],
      38: ['diet'],
      39: ['attack humans'],
      40: ['leadership'],
    },
  },
  7: {
    1: {
      1: ['taxi', 'cab', 'a taxi', 'a cab'],
      2: ['city centre', 'city center'],
      3: ['wait'],
      4: ['door-to-door', 'door to door'],
      5: ['reserve', 'reserve a seat', 'reserve seat'],
      6: ['17th October', '17th of October', 'the 17th of October', '17 October', 'October 17th'],
      7: ['12.30'],
      8: ['Thomson'],
      9: ['AC936'],
      10: ['3303 8450 2045 6837', '3303845020456837'],
      11: ['B'],
      12: ['A'],
      13: ['B'],
      14: ['C'],
      15: ['C'],
      16: ['A'],
      17: ['C'],
      18: ['A'],
      19: ['C'],
      20: ['B'],
      21: ['attitude', 'attitudes'],
      22: ['gender', 'sex'],
      23: ['creativity', 'creativeness'],
      24: ['A'],
      25: ['B'],
      26: ['A'],
      27: ['B'],
      28: ['culture'],
      29: ['profit', 'profits'],
      30: ['stress', 'strain'],
      31: ['April'],
      32: ['children'],
      33: ['repeated'],
      34: ['human'],
      35: ['magic'],
      36: ['distance'],
      37: ['culture'],
      38: ['fire', 'fires'],
      39: ['touching'],
      40: ['intact'],
    },
    2: {
      1: ['27 Bank Road'],
      2: ['dentist', 'a dentist'],
      3: ['Sable'],
      4: ['Northern Star'],
      5: ['stolen'],
      6: ['Paynter'],
      7: ['brother-in-law', 'brother in law'],
      8: ['travelling to work', 'traveling to work', 'travel to work', 'travelling work', 'traveling work'],
      9: ['Red Flag'],
      10: ['450'],
      11: ['City Bridge'],
      12: ['Newtown'],
      13: ['6.30'],
      14: ['formal garden', 'garden'],
      15: ['Tower Restaurant', 'Restaurant'],
      16: ['view', 'views'],
      17: ['history'],
      18: ['7 screen'],
      19: ['every 20 minutes'],
      20: ['Central Station', 'from Central Station', 'the Central Station'],
      21: ['B'],
      22: ['A'],
      23: ['C'],
      24: ['B'],
      25: ['A'],
      26: ['B'],
      27: ['1882 to 1883', '1882-1883', '1882 1883', '1882 to 83', '1882-83'],
      28: ['signed'],
      29: ['A', 'D'],
      30: ['A', 'D'],
      31: ['C'],
      32: ['B'],
      33: ['C'],
      34: ['A'],
      35: ['A'],
      36: ['2 directions', 'two directions'],
      37: ['confident'],
      38: ['vision'],
      39: ['corrections'],
      40: ['balance'],
    },
    3: {
      1: ['business'],
      2: ['third'],
      3: ['Sports Centre', 'Sport Centre', 'Sports Center', 'Sport Center'],
      4: ['cleaner', 'a cleaner'],
      5: ['Library'],
      6: ['International House'],
      7: ['8659'],
      8: ['office assistant', 'an office assistant'],
      9: ['answer the phone', 'answer phone'],
      10: ['11.30'],
      11: ['B'],
      12: ['C'],
      13: ['A'],
      14: ['C'],
      15: ['B'],
      16: ['A'],
      17: ['forest'],
      18: ['temple'],
      19: ['waterfall'],
      20: ['village'],
      21: ['cigar'],
      22: ['13 countries', '13 different countries', 'thirteen countries'],
      23: ['activated'],
      24: ['50 km', '50 kms', '50 kilometres', '50 kilometers'],
      25: ['temperature'],
      26: ['A'],
      27: ['C'],
      28: ['A'],
      29: ['B'],
      30: ['C'],
      31: ['B'],
      32: ['B'],
      33: ['A'],
      34: ['C'],
      35: ['business'],
      36: ['kitchen'],
      37: ['world'],
      38: ['escape'],
      39: ['baby'],
      40: ['chocolate'],
    },
    4: {
      1: ['Keiko'],
      2: ['106337'],
      3: ['4 months', 'four months'],
      4: ['Advanced English Studies', 'English Studies', 'Advanced English'],
      5: ['young children', 'children'],
      6: ['pets'],
      7: ['seafood'],
      8: ['tennis'],
      9: ['trains', 'train', 'the train'],
      10: ['this afternoon', 'that afternoon', 'afternoon'],
      11: ['C'],
      12: ['B'],
      13: ['A'],
      14: ['B'],
      15: ['car park', 'carpark', 'parking lot'],
      16: ['rose garden'],
      17: ['cafe', 'café'],
      18: ['cycling'],
      19: ['biology lesson'],
      20: ['viewing shelter'],
      21: ['5'],
      22: ['assessed'],
      23: ['A'],
      24: ['B'],
      25: ['A'],
      26: ['C'],
      27: ['media room'],
      28: ['resources room'],
      29: ['embassy'],
      30: ['statistics', 'stats'],
      31: ['B'],
      32: ['C'],
      33: ['A'],
      34: ['water'],
      35: ['meat', 'cheese'],
      36: ['meat', 'cheese'],
      37: ['5th taste', 'new taste', 'fifth taste'],
      38: ['common'],
      39: ['bitterness'],
      40: ['minerals'],
    },
  },
  8: {
    1: {
      1: ['C'],
      2: ['B'],
      3: ['48 North Avenue'],
      4: ['WS6 2YH', 'WS62YH'],
      5: ['01674 553242', '01674553242'],
      6: ['drink', 'drinks', 'refreshment', 'refreshments', 'free drink', 'free drinks', 'free refreshment', 'free refreshments'],
      7: ['pianist', 'piano player', 'the pianist', 'a pianist'],
      8: ['10.50'],
      9: ['4'],
      10: ['50%'],
      11: ['1.30'],
      12: ['25 December', 'Christmas Day', 'Christmas'],
      13: ['car-park', 'car park', 'parking lot'],
      14: ['45'],
      15: ['tables', 'some tables'],
      16: ['C', 'F', 'G'],
      17: ['C', 'F', 'G'],
      18: ['C', 'F', 'G'],
      19: ['B', 'E'],
      20: ['B', 'E'],
      21: ['A'],
      22: ['C'],
      23: ['A'],
      24: ['B'],
      25: ['B', 'C', 'F'],
      26: ['B', 'C', 'F'],
      27: ['B', 'C', 'F'],
      28: ['12,000', '12000'],
      29: ['horses'],
      30: ['caves'],
      31: ['surface'],
      32: ['environment'],
      33: ['impact', 'impacts', 'effect', 'effects'],
      34: ['urban'],
      35: ['problems'],
      36: ['images'],
      37: ['patterns'],
      38: ['distortion', 'distortions'],
      39: ['traffic'],
      40: ['weather'],
    },
    2: {
      1: ['Milperra'],
      2: ['First Class Movers'],
      3: ['28 November'],
      4: ['screen'],
      5: ['bathroom'],
      6: ['door'],
      7: ['140'],
      8: ['leg'],
      9: ['plates'],
      10: ['60'],
      11: ['B'],
      12: ['Forest', 'the Forest'],
      13: ['Fish Farm', 'Fish Farms'],
      14: ['Market Garden', 'MarketGarden'],
      15: ['C'],
      16: ['A'],
      17: ['C'],
      18: ['B'],
      19: ['C'],
      20: ['A'],
      21: ['A'],
      22: ['B'],
      23: ['C'],
      24: ['A'],
      25: ['insects'],
      26: ['feeding', 'eating'],
      27: ['laboratory'],
      28: ['water'],
      29: ['wings'],
      30: ['reliable', 'accurate'],
      31: ['B'],
      32: ['B'],
      33: ['A'],
      34: ['A'],
      35: ['C'],
      36: ['C'],
      37: ['B'],
      38: ['F'],
      39: ['D'],
      40: ['C'],
    },
    3: {
      1: ['central'],
      2: ['600'],
      3: ['2 years', '2 year', 'two years'],
      4: ['garage'],
      5: ['garden'],
      6: ['study'],
      7: ['noisy'],
      8: ['595'],
      9: ['B', 'E'],
      10: ['B', 'E'],
      11: ['classical music concerts', 'classical music concert', 'classical concerts', 'music concerts'],
      12: ['bookshop', 'bookstore'],
      13: ['planned'],
      14: ['1983', '1980s', 'the 1980s'],
      15: ['City Council'],
      16: ['363'],
      17: ['Garden Hall', 'the Garden Hall'],
      18: ['Three Lives'],
      19: ['4.50'],
      20: ['Faces of China'],
      21: ['C'],
      22: ['C'],
      23: ['A'],
      24: ['B'],
      25: ['C'],
      26: ['A'],
      27: ['C'],
      28: ['A'],
      29: ['B'],
      30: ['C'],
      31: ['B'],
      32: ['B'],
      33: ['B'],
      34: ['A'],
      35: ['combination', 'system'],
      36: ['safety'],
      37: ['attitude', 'attitudes'],
      38: ['control', 'controls'],
      39: ['factory', 'factories'],
      40: ['skills'],
    },
    4: {
      1: ['waiter', 'waiters'],
      2: ['day off'],
      3: ['break'],
      4: ['meal', 'free meal'],
      5: ['dark coloured', 'dark colored', 'dark'],
      6: ['jacket'],
      7: ['28 June'],
      8: ['Urwin'],
      9: ['12.00pm', '12.00 pm', '12.00', 'noon', 'mid-day', 'midday'],
      10: ['reference'],
      11: ['A'],
      12: ['B'],
      13: ['B'],
      14: ['C'],
      15: ['D'],
      16: ['G'],
      17: ['B'],
      18: ['F'],
      19: ['A'],
      20: ['E'],
      21: ['B', 'E'],
      22: ['B', 'E'],
      23: ['A', 'C'],
      24: ['A', 'C'],
      25: ['B'],
      26: ['C'],
      27: ['priorities'],
      28: ['timetable'],
      29: ['small tasks', 'tasks'],
      30: ['single paragraph', 'paragraph'],
      31: ['C'],
      32: ['B'],
      33: ['C'],
      34: ['A'],
      35: ['B'],
      36: ['B'],
      37: ['animal', 'creature'],
      38: ['sea level', 'sea levels', 'water level', 'water levels'],
      39: ['hunting'],
      40: ['creation'],
    },
  },
  9: {
    1: {
      1: ['answering the phone', 'answer the phone', 'the phone', 'phone'],
      2: ['Hillsdunne Road'],
      3: ['library'],
      4: ['4.45'],
      5: ['national holidays'],
      6: ["after 11 o'clock", 'after 11'],
      7: ['clear voice'],
      8: ['think quickly'],
      9: ['22 October', '22nd October', 'October 22', 'October 22nd'],
      10: ['Manuja'],
      11: ['branch'],
      12: ['west'],
      13: ['clothing'],
      14: ['10'],
      15: ['running'],
      16: ['bags'],
      17: ['A'],
      18: ['A'],
      19: ['A', 'E'],
      20: ['A', 'E'],
      21: ['B'],
      22: ['C'],
      23: ['B'],
      24: ['A'],
      25: ['C'],
      26: ['B'],
      27: ['A'],
      28: ['B'],
      29: ['C'],
      30: ['B'],
      31: ['tide', 'tides'],
      32: ['hearing', 'ear', 'ears'],
      33: ['plants animals', 'animals plants', 'plants fish', 'fish plants', 'plants fishes', 'fishes plants'],
      34: ['feeding'],
      35: ['noise', 'noises'],
      36: ['healthy'],
      37: ['group'],
      38: ['social'],
      39: ['leader'],
      40: ['network', 'networks'],
    },
    2: {
      1: ['Bhatt'],
      2: ['31 March', '31st March', 'March 31', 'March 31st'],
      3: ['nursing'],
      4: ['2'],
      5: ['meat'],
      6: ['bedsit'],
      7: ['theatre', 'theater'],
      8: ['mature', 'older'],
      9: ['town'],
      10: ['shared'],
      11: ['trees'],
      12: ['Friday', 'Sunday'],
      13: ['farm'],
      14: ['C'],
      15: ['B'],
      16: ['A'],
      17: ['A'],
      18: ['I'],
      19: ['F'],
      20: ['E'],
      21: ['C'],
      22: ['B'],
      23: ['B'],
      24: ['C'],
      25: ['reading'],
      26: ['CD', 'C D'],
      27: ['workbooks'],
      28: ['timetable', 'schedule'],
      29: ['alarm'],
      30: ['email', 'emails'],
      31: ['central'],
      32: ['conversation', 'conversations'],
      33: ['effectively'],
      34: ['risk', 'risks'],
      35: ['levels'],
      36: ['description', 'descriptions'],
      37: ['technical'],
      38: ['change'],
      39: ['responsibility'],
      40: ['flexible'],
    },
    3: {
      1: ['300'],
      2: ['Sunshade'],
      3: ['balcony'],
      4: ['forest', 'forests'],
      5: ['319'],
      6: ['10,000', '10000'],
      7: ['relative'],
      8: ['missed'],
      9: ['item'],
      10: ['Ludlow'],
      11: ['C'],
      12: ['A'],
      13: ['C'],
      14: ['E'],
      15: ['H'],
      16: ['F'],
      17: ['C'],
      18: ['G'],
      19: ['120'],
      20: ['5 to 12', '5-12'],
      21: ['fishing industry'],
      22: ['statistics'],
      23: ['note-taking', 'note taking'],
      24: ['confidence'],
      25: ['ideas'],
      26: ['student support'],
      27: ['places'],
      28: ['general'],
      29: ['3 times', 'three times'],
      30: ['25'],
      31: ['B'],
      32: ['A'],
      33: ['glass'],
      34: ['insulation'],
      35: ['windows'],
      36: ['electricity'],
      37: ['floor', 'floors'],
      38: ['waste'],
      39: ['concrete'],
      40: ['15 years'],
    },
    4: {
      1: ['babies'],
      2: ['Eshcol'],
      3: ['evening'],
      4: ['Gormley'],
      5: ['B', 'E'],
      6: ['B', 'E'],
      7: ['heart'],
      8: ['primary school'],
      9: ['4.30'],
      10: ['ages'],
      11: ['B'],
      12: ['C'],
      13: ['E'],
      14: ['B'],
      15: ['E'],
      16: ['D'],
      17: ['A'],
      18: ['C'],
      19: ['732281'],
      20: ['Thursday', 'Thursdays'],
      21: ['A'],
      22: ['C'],
      23: ['approach'],
      24: ['mature'],
      25: ['interest'],
      26: ['groups'],
      27: ['every 2 days', 'every two days'],
      28: ['2 weeks', 'two weeks'],
      29: ['confident'],
      30: ['education system'],
      31: ['C'],
      32: ['A'],
      33: ['B'],
      34: ['B'],
      35: ['A'],
      36: ['C'],
      37: ['frog', 'frogs'],
      38: ['predators'],
      39: ['count'],
      40: ['seed', 'seeds'],
    },
  },
  10: {
    1: {
      1: ['Ardleigh'],
      2: ['newspaper'],
      3: ['theme'],
      4: ['tent'],
      5: ['castle'],
      6: ['beach', 'beaches'],
      7: ['2020'],
      8: ['flight'],
      9: ['429'],
      10: ['dinner'],
      11: ['A', 'C'],
      12: ['A', 'C'],
      13: ['health problems'],
      14: ['safety rules'],
      15: ['plan'],
      16: ['joining'],
      17: ['free entry'],
      18: ['peak'],
      19: ['guests'],
      20: ['photo card', 'photo cards'],
      21: ['C'],
      22: ['A'],
      23: ['B'],
      24: ['A'],
      25: ['C'],
      26: ['presentation'],
      27: ['model'],
      28: ['material', 'materials'],
      29: ['grant'],
      30: ['technical'],
      31: ['gene'],
      32: ['power', 'powers'],
      33: ['strangers'],
      34: ['erosion'],
      35: ['islands'],
      36: ['roads'],
      37: ['fishing'],
      38: ['reproduction'],
      39: ['method', 'methods'],
      40: ['expansion'],
    },
    2: {
      1: ['Hardie'],
      2: ['19'],
      3: ['GT8 2LC', 'GT82LC'],
      4: ['hairdresser'],
      5: ['dentist', "dentist's"],
      6: ['lighting'],
      7: ['trains'],
      8: ['safe'],
      9: ['shower'],
      10: ['training'],
      11: ['A'],
      12: ['C'],
      13: ['C'],
      14: ['A'],
      15: ['E'],
      16: ['F'],
      17: ['D'],
      18: ['H'],
      19: ['A'],
      20: ['B'],
      21: ['B', 'C'],
      22: ['B', 'C'],
      23: ['B', 'E'],
      24: ['B', 'E'],
      25: ['A'],
      26: ['C'],
      27: ['C'],
      28: ['A'],
      29: ['B'],
      30: ['A'],
      31: ['competition'],
      32: ['global'],
      33: ['demand'],
      34: ['customers'],
      35: ['regulation'],
      36: ['project'],
      37: ['flexible'],
      38: ['leadership'],
      39: ['women'],
      40: ['self-employed', 'self employed'],
    },
    3: {
      1: ['4'],
      2: ['46 Wombat'],
      3: ['Thursday'],
      4: ['8.30'],
      5: ['red'],
      6: ['lunch'],
      7: ['glasses'],
      8: ['BALL', 'ball'],
      9: ['aunt'],
      10: ['month'],
      11: ['C', 'E'],
      12: ['C', 'E'],
      13: ['B'],
      14: ['A'],
      15: ['C'],
      16: ['B'],
      17: ['C'],
      18: ['D'],
      19: ['D'],
      20: ['A'],
      21: ['C'],
      22: ['A'],
      23: ['A'],
      24: ['B'],
      25: ['B'],
      26: ['E'],
      27: ['D'],
      28: ['A'],
      29: ['G'],
      30: ['C'],
      31: ['achievement', 'achievements'],
      32: ['personality', 'character'],
      33: ['Situational', 'situational'],
      34: ['friend'],
      35: ['aspirations', 'ambitions'],
      36: ['style'],
      37: ['development'],
      38: ['vision'],
      39: ['structures'],
      40: ['innovation', 'innovations'],
    },
    4: {
      1: ['Pargetter'],
      2: ['East'],
      3: ['library'],
      4: ['morning', 'mornings'],
      5: ['postbox'],
      6: ['prices'],
      7: ['glass'],
      8: ['cooker'],
      9: ['week'],
      10: ['fence'],
      11: ['B'],
      12: ['B'],
      13: ['A'],
      14: ['A'],
      15: ['C'],
      16: ['trains'],
      17: ['dark'],
      18: ['games'],
      19: ['guided tour'],
      20: ['ladder', 'ladders'],
      21: ['A', 'E'],
      22: ['A', 'E'],
      23: ['B', 'C'],
      24: ['B', 'C'],
      25: ['D'],
      26: ['F'],
      27: ['G'],
      28: ['B'],
      29: ['E'],
      30: ['C'],
      31: ['C'],
      32: ['B'],
      33: ['C'],
      34: ['metal', 'metals'],
      35: ['space'],
      36: ['memory'],
      37: ['solar'],
      38: ['oil'],
      39: ['waste'],
      40: ['tests'],
    },
  },
};

function answerMapForTest(bookNumber: number, testNumber: number): Map<number, string[]> {
  return new Map(Object.entries(LISTENING_ANSWERS_BY_BOOK[bookNumber]?.[testNumber] ?? {})
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
  const sectionMatch = /(?:section|secton|part|audio)\s*([1-4])/i.exec(normalized);
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
    const answerMap = answerMapForTest(bookNumber, testNumber);
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

async function attachPaperOverlay(book: ImportedListeningBook, pdfPath: string, ocrJsonPath?: string) {
  const overlayInputPath = path.join(DEFAULT_OUTPUT_DIR, `cambridge-${book.bookNumber}-listening.paper-input.json`);
  await mkdir(path.dirname(overlayInputPath), { recursive: true });
  await writeFile(overlayInputPath, `${JSON.stringify(book, null, 2)}\n`);

  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'extract-ielts-listening-paper.py');
  const args = ocrJsonPath
    ? [scriptPath, pdfPath, overlayInputPath, ocrJsonPath]
    : [scriptPath, pdfPath, overlayInputPath];
  const { stdout } = await execFileAsync('python3', args, {
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
          answer_note: question.answerNote || (question.answers.length > 1 ? `Cambridge ${book.bookNumber} answer variants ${sourceHash(question.answers.join('|'))}` : ''),
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
  const { text, sourceLabel, pdfPath, ocrJsonPath } = await readSourceText(args);
  const audioSources = await findAudioSources(args.book!);
  const book = buildBook(text, sourceLabel, args.book!, audioSources);
  await attachPaperOverlay(book, pdfPath, ocrJsonPath);
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
