import { isStopWord } from './stopWords';

export type TokenKind = 'content' | 'stop' | 'whitespace' | 'punct' | 'cjk';

export interface TextToken {
  kind: TokenKind;
  text: string;
  normalized?: string;
}

const WORD_CHAR_RE = /[\p{Script=Latin}0-9'-]/u;
const LETTER_OR_NUMBER_RE = /[\p{Script=Latin}0-9]/u;
const WHITESPACE_RE = /\s/u;
const CJK_RE = /\p{Script=Han}/u;
const TOKEN_TRIM_RE = /^[^a-z0-9'-]+|[^a-z0-9'-]+$/gi;
const DIGIT_RE = /\d/u;
const LATIN_LETTER_RE = /\p{Script=Latin}/u;
const POSSESSIVE_RE = /^[a-z]+(?:'s|s')$/i;
const ALL_CAPS_ACRONYM_RE = /^[A-Z]{2,}$/u;
const ACRONYM_TRIM_RE = /^[^A-Za-z]+|[^A-Za-z]+$/g;
const MIN_LOOKUP_TOKEN_LENGTH = 3;

function normalizeToken(text: string) {
  return text.replace(TOKEN_TRIM_RE, '').toLowerCase();
}

function hasLetterOrNumber(text: string) {
  return LETTER_OR_NUMBER_RE.test(text);
}

function isLookupCandidate(tokenText: string, normalized: string) {
  if (normalized.length < MIN_LOOKUP_TOKEN_LENGTH) return false;
  if (normalized.startsWith('-') || normalized.endsWith('-')) return false;
  if (DIGIT_RE.test(normalized)) return false;
  if (!LATIN_LETTER_RE.test(normalized)) return false;
  if (POSSESSIVE_RE.test(normalized)) return false;

  const acronymCandidate = tokenText.replace(ACRONYM_TRIM_RE, '');
  if (ALL_CAPS_ACRONYM_RE.test(acronymCandidate)) return false;

  return true;
}

export function tokenizeClickableText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (WHITESPACE_RE.test(char)) {
      let end = index + 1;
      while (end < text.length && WHITESPACE_RE.test(text[end])) {
        end += 1;
      }
      tokens.push({ kind: 'whitespace', text: text.slice(index, end) });
      index = end;
      continue;
    }

    if (CJK_RE.test(char)) {
      tokens.push({ kind: 'cjk', text: char });
      index += 1;
      continue;
    }

    if (WORD_CHAR_RE.test(char)) {
      let end = index + 1;
      while (end < text.length && WORD_CHAR_RE.test(text[end])) {
        end += 1;
      }

      const tokenText = text.slice(index, end);
      const normalized = normalizeToken(tokenText);
      if (!normalized || !hasLetterOrNumber(normalized) || !isLookupCandidate(tokenText, normalized)) {
        tokens.push({ kind: 'punct', text: tokenText });
      } else if (isStopWord(normalized)) {
        tokens.push({ kind: 'stop', text: tokenText, normalized });
      } else {
        tokens.push({ kind: 'content', text: tokenText, normalized });
      }
      index = end;
      continue;
    }

    tokens.push({ kind: 'punct', text: char });
    index += 1;
  }

  return tokens;
}
