import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Gemini TTS voices — Aoede (female) for UK RP, Puck (male) for US General American
const LOCALE_VOICE: Record<'uk' | 'us', string> = {
  uk: 'Aoede',
  us: 'Puck',
};

function getPrompt(word: string, locale: 'uk' | 'us'): string {
  return locale === 'uk'
    ? `Pronounce this single English word clearly in British RP accent: ${word}`
    : `Pronounce this single English word clearly in American English: ${word}`;
}

// Wrap raw PCM (24 kHz, 16-bit, mono) in a standard RIFF/WAV header
function pcmToWav(pcm: Buffer): Buffer {
  const sampleRate = 24000;
  const channels = 1;
  const bitDepth = 16;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                               // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28);
  header.writeUInt16LE(channels * (bitDepth / 8), 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function generateWordAudio(word: string, locale: 'uk' | 'us'): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (ai.models as any).generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: getPrompt(word, locale),
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: LOCALE_VOICE[locale] },
        },
      },
    },
  });

  const part = result?.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) {
    throw new Error(`Gemini TTS returned no audio for "${word}" (${locale})`);
  }

  const raw = Buffer.from(part.inlineData.data as string, 'base64');
  const mime: string = (part.inlineData.mimeType as string) ?? '';

  // Gemini typically returns raw PCM; wrap in WAV if needed
  return mime.startsWith('audio/wav') ? raw : pcmToWav(raw);
}
