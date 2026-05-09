import { PronunciationLocale } from '../types';

export function isBrowserSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

export function cancelBrowserSpeech(): void {
  if (!isBrowserSpeechSupported()) return;
  window.speechSynthesis.cancel();
}

export function normalizeSpeechText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speakTextViaBrowser(
  text: string,
  locale: PronunciationLocale,
  rate = 0.85,
): Promise<boolean> {
  if (!isBrowserSpeechSupported()) {
    return Promise.resolve(false);
  }

  const normalizedText = normalizeSpeechText(text);
  if (!normalizedText) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(normalizedText);
    let settled = false;

    const finish = (didFinish: boolean) => {
      if (settled) return;
      settled = true;
      resolve(didFinish);
    };

    utterance.lang = locale === 'uk' ? 'en-GB' : 'en-US';
    utterance.rate = rate;
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}
