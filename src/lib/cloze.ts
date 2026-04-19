export type ClozePrompt = {
  blankedSentence: string;
  translation: string;
  expectedForm: string;
  baseForm: string;
  formLabel: string;
  senseIndex: number;
};

export type ClozeSenseInput = {
  example_sentence: string;
  example_translation_zh: string;
};

export type ClozeInput = {
  word: string;
  senses: ClozeSenseInput[];
};

type InflectedForm = { form: string; label: string };

export const CLOZE_BLANK = '_____';

const LABEL = {
  base: '原型',
  ing: '-ing 形式',
  past: '过去式 / 过去分词',
  pastOnly: '过去式',
  pastParticiple: '过去分词',
  thirdPerson: '-s / -es 形式',
  comparative: '比较级 / 最高级',
} as const;

const IRREGULARS: Record<string, InflectedForm[]> = {
  run: [{ form: 'ran', label: LABEL.pastOnly }],
  go: [{ form: 'went', label: LABEL.pastOnly }, { form: 'gone', label: LABEL.pastParticiple }],
  see: [{ form: 'saw', label: LABEL.pastOnly }, { form: 'seen', label: LABEL.pastParticiple }],
  take: [{ form: 'took', label: LABEL.pastOnly }, { form: 'taken', label: LABEL.pastParticiple }],
  give: [{ form: 'gave', label: LABEL.pastOnly }, { form: 'given', label: LABEL.pastParticiple }],
  come: [{ form: 'came', label: LABEL.pastOnly }],
  become: [{ form: 'became', label: LABEL.pastOnly }],
  know: [{ form: 'knew', label: LABEL.pastOnly }, { form: 'known', label: LABEL.pastParticiple }],
  grow: [{ form: 'grew', label: LABEL.pastOnly }, { form: 'grown', label: LABEL.pastParticiple }],
  throw: [{ form: 'threw', label: LABEL.pastOnly }, { form: 'thrown', label: LABEL.pastParticiple }],
  draw: [{ form: 'drew', label: LABEL.pastOnly }, { form: 'drawn', label: LABEL.pastParticiple }],
  write: [{ form: 'wrote', label: LABEL.pastOnly }, { form: 'written', label: LABEL.pastParticiple }],
  drive: [{ form: 'drove', label: LABEL.pastOnly }, { form: 'driven', label: LABEL.pastParticiple }],
  rise: [{ form: 'rose', label: LABEL.pastOnly }, { form: 'risen', label: LABEL.pastParticiple }],
  ride: [{ form: 'rode', label: LABEL.pastOnly }, { form: 'ridden', label: LABEL.pastParticiple }],
  break: [{ form: 'broke', label: LABEL.pastOnly }, { form: 'broken', label: LABEL.pastParticiple }],
  choose: [{ form: 'chose', label: LABEL.pastOnly }, { form: 'chosen', label: LABEL.pastParticiple }],
  speak: [{ form: 'spoke', label: LABEL.pastOnly }, { form: 'spoken', label: LABEL.pastParticiple }],
  wake: [{ form: 'woke', label: LABEL.pastOnly }, { form: 'woken', label: LABEL.pastParticiple }],
  steal: [{ form: 'stole', label: LABEL.pastOnly }, { form: 'stolen', label: LABEL.pastParticiple }],
  eat: [{ form: 'ate', label: LABEL.pastOnly }, { form: 'eaten', label: LABEL.pastParticiple }],
  fall: [{ form: 'fell', label: LABEL.pastOnly }, { form: 'fallen', label: LABEL.pastParticiple }],
  forget: [{ form: 'forgot', label: LABEL.pastOnly }, { form: 'forgotten', label: LABEL.pastParticiple }],
  get: [{ form: 'got', label: LABEL.pastOnly }, { form: 'gotten', label: LABEL.pastParticiple }],
  begin: [{ form: 'began', label: LABEL.pastOnly }, { form: 'begun', label: LABEL.pastParticiple }],
  swim: [{ form: 'swam', label: LABEL.pastOnly }, { form: 'swum', label: LABEL.pastParticiple }],
  sing: [{ form: 'sang', label: LABEL.pastOnly }, { form: 'sung', label: LABEL.pastParticiple }],
  ring: [{ form: 'rang', label: LABEL.pastOnly }, { form: 'rung', label: LABEL.pastParticiple }],
  drink: [{ form: 'drank', label: LABEL.pastOnly }, { form: 'drunk', label: LABEL.pastParticiple }],
  bring: [{ form: 'brought', label: LABEL.past }],
  think: [{ form: 'thought', label: LABEL.past }],
  buy: [{ form: 'bought', label: LABEL.past }],
  catch: [{ form: 'caught', label: LABEL.past }],
  teach: [{ form: 'taught', label: LABEL.past }],
  fight: [{ form: 'fought', label: LABEL.past }],
  seek: [{ form: 'sought', label: LABEL.past }],
  feel: [{ form: 'felt', label: LABEL.past }],
  keep: [{ form: 'kept', label: LABEL.past }],
  leave: [{ form: 'left', label: LABEL.past }],
  mean: [{ form: 'meant', label: LABEL.past }],
  meet: [{ form: 'met', label: LABEL.past }],
  send: [{ form: 'sent', label: LABEL.past }],
  build: [{ form: 'built', label: LABEL.past }],
  find: [{ form: 'found', label: LABEL.past }],
  hold: [{ form: 'held', label: LABEL.past }],
  lose: [{ form: 'lost', label: LABEL.past }],
  say: [{ form: 'said', label: LABEL.past }],
  tell: [{ form: 'told', label: LABEL.past }],
  sell: [{ form: 'sold', label: LABEL.past }],
  stand: [{ form: 'stood', label: LABEL.past }],
  understand: [{ form: 'understood', label: LABEL.past }],
  hear: [{ form: 'heard', label: LABEL.past }],
  lead: [{ form: 'led', label: LABEL.past }],
  read: [{ form: 'read', label: LABEL.past }],
  make: [{ form: 'made', label: LABEL.past }],
  have: [{ form: 'had', label: LABEL.past }, { form: 'has', label: LABEL.thirdPerson }],
  do: [
    { form: 'did', label: LABEL.pastOnly },
    { form: 'done', label: LABEL.pastParticiple },
    { form: 'does', label: LABEL.thirdPerson },
  ],
  be: [
    { form: 'was', label: LABEL.pastOnly },
    { form: 'were', label: LABEL.pastOnly },
    { form: 'been', label: LABEL.pastParticiple },
    { form: 'is', label: LABEL.thirdPerson },
    { form: 'are', label: LABEL.base },
    { form: 'am', label: LABEL.base },
  ],
  man: [{ form: 'men', label: LABEL.thirdPerson }],
  woman: [{ form: 'women', label: LABEL.thirdPerson }],
  child: [{ form: 'children', label: LABEL.thirdPerson }],
  foot: [{ form: 'feet', label: LABEL.thirdPerson }],
  tooth: [{ form: 'teeth', label: LABEL.thirdPerson }],
  mouse: [{ form: 'mice', label: LABEL.thirdPerson }],
  person: [{ form: 'people', label: LABEL.thirdPerson }],
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function isVowel(ch: string | undefined): boolean {
  return !!ch && VOWELS.has(ch.toLowerCase());
}

function isConsonantDoubleable(base: string): boolean {
  if (base.length < 3) return false;
  const last = base[base.length - 1];
  const mid = base[base.length - 2];
  const first = base[base.length - 3];
  return !isVowel(last)
    && isVowel(mid)
    && !isVowel(first)
    && last !== 'w' && last !== 'x' && last !== 'y';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateCandidates(base: string): InflectedForm[] {
  const seen = new Set<string>();
  const out: InflectedForm[] = [];
  const push = (form: string, label: string) => {
    const key = form.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ form: key, label });
  };

  push(base, LABEL.base);
  push(base + 's', LABEL.thirdPerson);
  push(base + 'es', LABEL.thirdPerson);
  push(base + 'ing', LABEL.ing);
  push(base + 'ed', LABEL.past);
  push(base + 'er', LABEL.comparative);
  push(base + 'est', LABEL.comparative);

  if (base.length > 1 && base.endsWith('e')) {
    const stem = base.slice(0, -1);
    push(stem + 'ing', LABEL.ing);
    push(stem + 'ed', LABEL.past);
    push(stem + 'er', LABEL.comparative);
    push(stem + 'est', LABEL.comparative);
  }

  if (base.length > 1 && base.endsWith('y') && !isVowel(base[base.length - 2])) {
    const stem = base.slice(0, -1);
    push(stem + 'ies', LABEL.thirdPerson);
    push(stem + 'ied', LABEL.past);
    push(stem + 'ier', LABEL.comparative);
    push(stem + 'iest', LABEL.comparative);
  }

  if (isConsonantDoubleable(base)) {
    const doubled = base + base[base.length - 1];
    push(doubled + 'ing', LABEL.ing);
    push(doubled + 'ed', LABEL.past);
    push(doubled + 'er', LABEL.comparative);
    push(doubled + 'est', LABEL.comparative);
  }

  for (const irregular of IRREGULARS[base] ?? []) {
    push(irregular.form, irregular.label);
  }

  return out;
}

function findFirstMatch(
  sentence: string,
  candidates: InflectedForm[],
): { form: InflectedForm; index: number; matchedText: string } | null {
  let best: { form: InflectedForm; index: number; matchedText: string } | null = null;
  for (const candidate of candidates) {
    const regex = new RegExp(`\\b${escapeRegex(candidate.form)}\\b`, 'i');
    const match = regex.exec(sentence);
    if (!match) continue;
    const hit = { form: candidate, index: match.index, matchedText: match[0] };
    if (!best || hit.index < best.index
      || (hit.index === best.index && hit.matchedText.length > best.matchedText.length)) {
      best = hit;
    }
  }
  return best;
}

function blankify(sentence: string, matchedForm: string): string {
  const regex = new RegExp(`\\b${escapeRegex(matchedForm)}\\b`, 'gi');
  return sentence.replace(regex, CLOZE_BLANK);
}

export function buildClozePrompt(input: ClozeInput): ClozePrompt | null {
  const base = input.word.trim().toLowerCase();
  if (!base) return null;

  const candidates = generateCandidates(base);

  for (let i = 0; i < input.senses.length; i += 1) {
    const sense = input.senses[i];
    const sentenceRaw = sense.example_sentence?.trim();
    if (!sentenceRaw) continue;
    const sentence = sentenceRaw.replace(/\*\*(.+?)\*\*/g, '$1');

    const hit = findFirstMatch(sentence, candidates);
    if (!hit) continue;

    return {
      blankedSentence: blankify(sentence, hit.matchedText),
      translation: (sense.example_translation_zh ?? '').trim(),
      expectedForm: hit.matchedText.toLowerCase(),
      baseForm: base,
      formLabel: hit.form.label,
      senseIndex: i,
    };
  }

  return null;
}
