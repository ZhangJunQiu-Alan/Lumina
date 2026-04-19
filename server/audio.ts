import { supabaseAdmin } from './supabase.js';
import { generateWordAudio } from './tts.js';

const BUCKET = 'word-audio';

// --- In-memory cache for ultra-fast response ---
// Stores: word:locale -> publicUrl
const urlCache = new Map<string, string>();
// Stores: promise for pending requests to avoid duplicate work
const pendingRequests = new Map<string, Promise<string>>();

function buildAudioStoragePath(word: string, locale: 'uk' | 'us') {
  const normalizedWord = word.trim().toLowerCase();
  const asciiSlug = normalizedWord
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stableKey = Buffer.from(normalizedWord).toString('base64url');
  const fileName = `${asciiSlug || 'word'}-${stableKey}.mp3`;
  return `${locale}/${fileName}`;
}

async function uploadAndSave(
  word: string,
  vocabId: string | null,
  locale: 'uk' | 'us',
): Promise<string> {
  const cacheKey = `${word.toLowerCase()}:${locale}`;
  
  // Check pending requests (deduplication)
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  const work = (async () => {
    try {
      const buffer = await generateWordAudio(word, locale);
      const path = buildAudioStoragePath(word, locale);

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: 'audio/mpeg', upsert: true });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      const url = urlData.publicUrl;

      // Persist URL back to vocabulary_items if we have the row ID
      if (vocabId) {
        const col = locale === 'uk' ? 'audio_uk_url' : 'audio_us_url';
        await supabaseAdmin.from('vocabulary_items').update({ [col]: url }).eq('id', vocabId);
      }

      urlCache.set(cacheKey, url);
      return url;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, work);
  return work;
}

/** Get (or generate+cache) audio URL for a single word. */
export async function getOrCreateAudio(word: string, locale: 'uk' | 'us'): Promise<string> {
  const normalizedWord = word.toLowerCase();
  const cacheKey = `${normalizedWord}:${locale}`;

  // 1. Level 1 Cache: In-memory
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey)!;

  // 2. Level 2 Cache: Database
  const col = locale === 'uk' ? 'audio_uk_url' : 'audio_us_url';

  const { data } = await supabaseAdmin
    .from('vocabulary_items')
    .select(`id, ${col}`)
    .eq('word', normalizedWord)
    .maybeSingle();

  if (data?.[col]) {
    const url = data[col] as string;
    urlCache.set(cacheKey, url);
    return url;
  }

  // 3. Fallback: Generate & Upload
  return uploadAndSave(word, data?.id ?? null, locale);
}

/** Batch-generate UK + US audio for a list of words.
 *  Returns { [word]: { uk_url, us_url } } — errors per word are silently skipped. */
export async function batchGenerateAudio(
  words: string[],
): Promise<Record<string, { uk_url: string; us_url: string }>> {
  // Fetch existing URLs in one query
  const { data: existing } = await supabaseAdmin
    .from('vocabulary_items')
    .select('id, word, audio_uk_url, audio_us_url')
    .in('word', words.map(w => w.toLowerCase()));

  const existingMap = new Map(
    (existing ?? []).map(r => [r.word as string, r as {
      id: string; word: string; audio_uk_url: string | null; audio_us_url: string | null
    }]),
  );

  const result: Record<string, { uk_url: string; us_url: string }> = {};

  await Promise.allSettled(
    words.map(async (word) => {
      const row = existingMap.get(word.toLowerCase());

      const [ukUrl, usUrl] = await Promise.all([
        row?.audio_uk_url
          ? Promise.resolve(row.audio_uk_url)
          : getOrCreateAudio(word, 'uk'),
        row?.audio_us_url
          ? Promise.resolve(row.audio_us_url)
          : getOrCreateAudio(word, 'us'),
      ]);

      result[word.toLowerCase()] = { uk_url: ukUrl, us_url: usUrl };
    }),
  );

  return result;
}
