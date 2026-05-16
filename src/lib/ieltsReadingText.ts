const LATIN_SOFT_HYPHEN_BREAK_RE = /([A-Za-z]{2,})-(?:[ \t]*\n)+[ \t]*([a-z]{2,})/g;
const SECTION_START_RE = /^[A-H]\s+[A-Z][\w'’(-]/;
const SENTENCE_END_RE = /[.!?]["')\]]?$/;
const PARAGRAPH_START_RE = /^[A-Z0-9"'‘“(]/;
const KNOWN_STANDALONE_HEADINGS = new Set([
  'Introduction',
  'Background',
  'Conclusion',
  'Lessons Learned',
  'Street Business Partnerships',
]);
const OCR_SPACING_REPAIRS: [RegExp, string][] = [
  [/~econd\b/g, 'second'],
  [/\bofa\b/g, 'of a'],
  [/\boft\s*he\b/g, 'of the'],
  [/\bofr\s*ain\s*forests\b/g, 'of rainforests'],
  [/\bofr\s*ainforest\b/g, 'of rainforest'],
  [/\br8%/g, '18%'],
  [/\bro%/g, '10%'],
  [/\bendan\s+gers\b/g, 'endangers'],
  [/\bcur\s+riculum\b/g, 'curriculum'],
  [/\bincorpo\s+rated\b/g, 'incorporated'],
  [/\bedu\s+cational\b/g, 'educational'],
  [/\bdescrip\s+tions\b/g, 'descriptions'],
  [/\bdomi\s+nant\b/g, 'dominant'],
  [/\bhabi\s+tats\b/g, 'habitats'],
  [/\bprevi\s+ous\b/g, 'previous'],
  [/\bstu\s+dents\b/g, 'students'],
  [/\bappreci\s+ation\b/g, 'appreciation'],
  [/\bappre\s+ciate\b/g, 'appreciate'],
  [/\bdeci\s+sion-makers\b/g, 'decision-makers'],
  [/\brainforests-what\b/g, 'rainforests- what'],
  [/\bthem-independent\b/g, 'them- independent'],
  [/\bforests ofWestern\b/g, 'forests of Western'],
];

function repairOcrSpacingArtifacts(value: string): string {
  return OCR_SPACING_REPAIRS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

function cleanInlineText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function joinWrappedLine(current: string, line: string): string {
  if (!current) return line;
  if (/^[,.;:!?)]/.test(line)) return `${current}${line}`;
  return `${current} ${line}`;
}

function isLikelyHardWrappedBody(text: string, lines: string[]): boolean {
  if (lines.length < 6) return lines.some(isStandaloneHeadingLine);

  const shortLineCount = lines.filter((line) => line.length <= 95).length;
  const mediumLineCount = lines.filter((line) => line.length <= 145).length;
  const shortLineRatio = shortLineCount / lines.length;
  const mediumLineRatio = mediumLineCount / lines.length;
  const averageLineLength = lines.reduce((total, line) => total + line.length, 0) / lines.length;
  const longLineCount = lines.filter((line) => line.length > 160).length;
  const separatorCount = text.match(/\n{2,}/g)?.length ?? 0;
  const separatorRatio = separatorCount / Math.max(1, lines.length - 1);

  if (separatorRatio >= 0.72) {
    return shortLineRatio >= 0.6 || averageLineLength <= 115;
  }

  return separatorRatio < 0.25
    && (shortLineRatio >= 0.65 || mediumLineRatio >= 0.72)
    && longLineCount / lines.length <= 0.12
    && averageLineLength <= 150;
}

function getTypicalLineLength(lines: string[]): number {
  const candidates = lines
    .map((line) => line.length)
    .filter((length) => length >= 35)
    .sort((left, right) => left - right);
  if (candidates.length === 0) return 80;
  return candidates[Math.floor(candidates.length / 2)];
}

function startsParagraphLine(line: string): boolean {
  return PARAGRAPH_START_RE.test(line) && !/^[a-z,.;:!?)]/.test(line);
}

function isStandaloneHeadingLine(line: string): boolean {
  return KNOWN_STANDALONE_HEADINGS.has(line) || /^Section\s+[A-H]$/i.test(line);
}

function shouldStartNewInferredParagraph(current: string, lastLine: string, nextLine: string, typicalLineLength: number): boolean {
  if (current && (isStandaloneHeadingLine(lastLine) || isStandaloneHeadingLine(nextLine))) return true;
  if (!current || !SENTENCE_END_RE.test(lastLine) || !startsParagraphLine(nextLine)) return false;

  const shortFinalLine = lastLine.length <= Math.max(48, typicalLineLength * 0.9);
  const longEnoughParagraph = current.length >= 220;
  const forcedLongParagraphBreak = current.length >= 620;

  return (longEnoughParagraph && shortFinalLine) || forcedLongParagraphBreak;
}

function rebuildHardWrappedParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current = '';
  let lastLine = '';
  const typicalLineLength = getTypicalLineLength(lines);

  for (const line of lines) {
    const startsSection = SECTION_START_RE.test(line);
    const shouldStartNewParagraph = Boolean(
      current
      && (
        startsSection
        || shouldStartNewInferredParagraph(current, lastLine, line, typicalLineLength)
      ),
    );

    if (shouldStartNewParagraph) {
      paragraphs.push(current);
      current = line;
    } else {
      current = joinWrappedLine(current, line);
    }

    lastLine = line;
  }

  if (current) paragraphs.push(current);
  return paragraphs;
}

function normalizeExistingParagraphs(text: string): string {
  return repairOcrSpacingArtifacts(text
    .split(/\n{2,}/)
    .map((paragraph) => cleanInlineText(paragraph.replace(/\n+/g, ' ')))
    .filter(Boolean)
    .join('\n\n'));
}

export function normalizeIeltsPassageBody(value: string): string {
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/\u00ad/g, '')
    .replace(LATIN_SOFT_HYPHEN_BREAK_RE, '$1$2')
    .trim();

  if (!text) return '';

  const lines = text
    .split(/\n+/)
    .map(cleanInlineText)
    .filter(Boolean);

  if (lines.length === 0) return '';

  if (!isLikelyHardWrappedBody(text, lines)) {
    return normalizeExistingParagraphs(text);
  }

  return repairOcrSpacingArtifacts(rebuildHardWrappedParagraphs(lines).join('\n\n'));
}

export function splitIeltsPassageParagraphs(value: string): string[] {
  return normalizeIeltsPassageBody(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
