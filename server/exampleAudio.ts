import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase.js';
import { generateSpeechAudio, getSpeechVoiceName } from './tts.js';

const BUCKET = 'word-audio';
const MAX_EXAMPLE_AUDIO_CHARS = 300;
const EXAMPLE_SPEAKING_RATE = 0.9;

const urlCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

export class ExampleAudioValidationError extends Error {
  statusCode = 400;
}

export function normalizeExampleAudioText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSentenceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function buildCacheKey(sentenceHash: string, locale: 'uk' | 'us', voiceName: string): string {
  return `${sentenceHash}:${locale}:${voiceName}`;
}

function buildExampleAudioStoragePath(sentenceHash: string, locale: 'uk' | 'us'): string {
  return `examples/${locale}/${sentenceHash}.mp3`;
}

async function fetchCachedExampleAudio(
  sentenceHash: string,
  locale: 'uk' | 'us',
  voiceName: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('example_audio_cache')
    .select('audio_url')
    .eq('sentence_hash', sentenceHash)
    .eq('locale', locale)
    .eq('voice_name', voiceName)
    .maybeSingle();

  if (error) {
    throw new Error(`Example audio lookup failed: ${error.message}`);
  }

  return typeof data?.audio_url === 'string' ? data.audio_url : null;
}

async function generateUploadAndSave(
  sentenceText: string,
  sentenceHash: string,
  locale: 'uk' | 'us',
  voiceName: string,
): Promise<string> {
  const buffer = await generateSpeechAudio(sentenceText, locale, {
    speakingRate: EXAMPLE_SPEAKING_RATE,
    pitch: 0,
  });
  const path = buildExampleAudioStoragePath(sentenceHash, locale);

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'audio/mpeg', upsert: true });

  if (uploadErr) {
    throw new Error(`Example audio upload failed: ${uploadErr.message}`);
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  const url = urlData.publicUrl;

  const { error: saveErr } = await supabaseAdmin
    .from('example_audio_cache')
    .upsert({
      sentence_hash: sentenceHash,
      sentence_text: sentenceText,
      locale,
      voice_name: voiceName,
      audio_url: url,
    }, {
      onConflict: 'sentence_hash,locale,voice_name',
    });

  if (saveErr) {
    throw new Error(`Example audio cache save failed: ${saveErr.message}`);
  }

  return url;
}

export async function getOrCreateExampleAudio(text: string, locale: 'uk' | 'us'): Promise<string> {
  const sentenceText = normalizeExampleAudioText(text);

  if (!sentenceText) {
    throw new ExampleAudioValidationError('Missing example text');
  }

  if (sentenceText.length > MAX_EXAMPLE_AUDIO_CHARS) {
    throw new ExampleAudioValidationError(`Example text must be ${MAX_EXAMPLE_AUDIO_CHARS} characters or fewer`);
  }

  const voiceName = getSpeechVoiceName(locale);
  const sentenceHash = buildSentenceHash(sentenceText);
  const cacheKey = buildCacheKey(sentenceHash, locale, voiceName);

  if (urlCache.has(cacheKey)) {
    return urlCache.get(cacheKey)!;
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  const work = (async () => {
    try {
      const cachedUrl = await fetchCachedExampleAudio(sentenceHash, locale, voiceName);
      if (cachedUrl) {
        urlCache.set(cacheKey, cachedUrl);
        return cachedUrl;
      }

      const url = await generateUploadAndSave(sentenceText, sentenceHash, locale, voiceName);
      urlCache.set(cacheKey, url);
      return url;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, work);
  return work;
}
