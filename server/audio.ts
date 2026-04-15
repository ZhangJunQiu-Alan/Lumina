import { supabaseAdmin } from './supabase.js';
import { generateWordAudio } from './tts.js';

const BUCKET = 'word-audio';

async function uploadAndSave(
  word: string,
  vocabId: string | null,
  locale: 'uk' | 'us',
): Promise<string> {
  const buffer = await generateWordAudio(word, locale);
  const path = `${locale}/${word.toLowerCase()}.wav`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'audio/wav', upsert: true });

  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  const url = urlData.publicUrl;

  // Persist URL back to vocabulary_items if we have the row ID
  if (vocabId) {
    const col = locale === 'uk' ? 'audio_uk_url' : 'audio_us_url';
    await supabaseAdmin.from('vocabulary_items').update({ [col]: url }).eq('id', vocabId);
  }

  return url;
}

/** Get (or generate+cache) audio URL for a single word. */
export async function getOrCreateAudio(word: string, locale: 'uk' | 'us'): Promise<string> {
  const col = locale === 'uk' ? 'audio_uk_url' : 'audio_us_url';

  const { data } = await supabaseAdmin
    .from('vocabulary_items')
    .select(`id, ${col}`)
    .eq('word', word.toLowerCase())
    .maybeSingle();

  if (data?.[col]) return data[col] as string;

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
          : uploadAndSave(word, row?.id ?? null, 'uk'),
        row?.audio_us_url
          ? Promise.resolve(row.audio_us_url)
          : uploadAndSave(word, row?.id ?? null, 'us'),
      ]);

      result[word.toLowerCase()] = { uk_url: ukUrl, us_url: usUrl };
    }),
  );

  return result;
}
