const LATIN_SOFT_HYPHEN_BREAK_RE = /([A-Za-z]{2,})-(?:[ \t]*\n)+[ \t]*([a-z]{2,})/g;
const SECTION_START_RE = /^[A-H]\s+[A-Z][\w'’(-]/;
const SENTENCE_END_RE = /[.!?]["')\]]?$/;

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
  if (lines.length < 6) return false;

  const shortLineCount = lines.filter((line) => line.length <= 95).length;
  const shortLineRatio = shortLineCount / lines.length;
  const averageLineLength = lines.reduce((total, line) => total + line.length, 0) / lines.length;
  const separatorCount = text.match(/\n{2,}/g)?.length ?? 0;
  const separatorRatio = separatorCount / Math.max(1, lines.length - 1);

  return separatorRatio >= 0.72 && (shortLineRatio >= 0.6 || averageLineLength <= 115);
}

function rebuildHardWrappedParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current = '';
  let lastLine = '';

  for (const line of lines) {
    const startsSection = SECTION_START_RE.test(line);
    const shouldStartNewParagraph = Boolean(
      current
      && (
        startsSection
        || (current.length >= 560 && SENTENCE_END_RE.test(lastLine))
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
  return text
    .split(/\n{2,}/)
    .map((paragraph) => cleanInlineText(paragraph.replace(/\n+/g, ' ')))
    .filter(Boolean)
    .join('\n\n');
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

  return rebuildHardWrappedParagraphs(lines).join('\n\n');
}

export function splitIeltsPassageParagraphs(value: string): string[] {
  return normalizeIeltsPassageBody(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
