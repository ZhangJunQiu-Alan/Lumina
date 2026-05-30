import { getEnv } from '../runtime.ts';

const GOOGLE_TTS_KEY = getEnv('GOOGLE_TTS_API_KEY')!;

// Neural2 voices — natural, dictionary-quality pronunciation
const LOCALE_VOICE: Record<'uk' | 'us', { languageCode: string; name: string }> = {
  uk: { languageCode: 'en-GB', name: 'en-GB-Neural2-B' }, // Male British RP
  us: { languageCode: 'en-US', name: 'en-US-Neural2-D' }, // Male American
};

interface SpeechAudioOptions {
  speakingRate?: number;
  pitch?: number;
}

export function getSpeechVoiceName(locale: 'uk' | 'us'): string {
  return LOCALE_VOICE[locale].name;
}

export async function generateSpeechAudio(
  text: string,
  locale: 'uk' | 'us',
  options: SpeechAudioOptions = {},
): Promise<Uint8Array> {
  const voice = LOCALE_VOICE[locale];

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice,
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: options.speakingRate ?? 0.85,
          pitch: options.pitch ?? 0,
        },
      }),
    },
  );

  const json = await res.json() as { audioContent?: string; error?: { message: string } };
  if (!res.ok || !json.audioContent) {
    throw new Error(`Google TTS error: ${json.error?.message ?? res.statusText}`);
  }

  return Uint8Array.from(atob(json.audioContent), (char) => char.charCodeAt(0));
}

export async function generateWordAudio(word: string, locale: 'uk' | 'us'): Promise<Uint8Array> {
  return generateSpeechAudio(word, locale, { speakingRate: 0.85, pitch: 0 });
}
