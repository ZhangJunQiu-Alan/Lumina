import { useCallback, useEffect, useRef, useState } from 'react';
import type { PronunciationLocale, Word } from '../../../types';
import { useLearningPreferences } from '../../../contexts/LearningPreferencesContext';
import { cancelBrowserSpeech, speakTextViaBrowser } from '../../../lib/browserSpeech';
import { fetchExampleAudioUrl } from '../../../lib/exampleAudio';
import { fetchWordAudioUrl, primeWordAudioUrl } from '../../../lib/wordAudio';
import type { PlaybackTarget } from '../learningEngineUtils';

export interface UseLearningAudioOptions {
  currentWord?: Word | null;
  canPlayExampleAudio?: boolean;
}

export function useLearningAudio({
  currentWord,
  canPlayExampleAudio = true,
}: UseLearningAudioOptions = {}) {
  const { preferences } = useLearningPreferences();
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  const [audioLocale, setAudioLocale] = useState<PronunciationLocale>(preferences.defaultPronunciationLocale);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget | null>(null);

  const activePronunciationLocale = playbackTarget?.kind === 'pronunciation' ? playbackTarget.locale : null;
  const activeExampleKey = playbackTarget?.kind === 'example' ? playbackTarget.key : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioGapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRunIdRef = useRef(0);
  const activePlaybackFinishRef = useRef<(() => void) | null>(null);

  const stopPlayback = useCallback(() => {
    playbackRunIdRef.current += 1;
    const finishActivePlayback = activePlaybackFinishRef.current;
    activePlaybackFinishRef.current = null;
    const currentAudio = audioRef.current;
    audioRef.current = null;

    if (audioGapTimeoutRef.current) {
      clearTimeout(audioGapTimeoutRef.current);
      audioGapTimeoutRef.current = null;
    }

    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
    }

    finishActivePlayback?.();
    cancelBrowserSpeech();
    setPlaybackTarget(null);
  }, []);

  useEffect(() => {
    window.addEventListener('lumina:pause', stopPlayback);
    return () => window.removeEventListener('lumina:pause', stopPlayback);
  }, [stopPlayback]);

  useEffect(
    () => () => {
      stopPlayback();
    },
    [stopPlayback],
  );

  const speakViaBrowser = useCallback(
    (text: string, locale: PronunciationLocale, runId: number, target: PlaybackTarget) => {
      if (!canPlayExampleAudio || runId !== playbackRunIdRef.current) {
        return Promise.resolve(false);
      }

      setPlaybackTarget(target);

      return speakTextViaBrowser(text, locale, preferencesRef.current.speechPlaybackRate).finally(() => {
        if (runId === playbackRunIdRef.current) {
          setPlaybackTarget(null);
        }
      });
    },
    [canPlayExampleAudio],
  );

  const resolveAudioUrl = useCallback(async (word: Word, locale: PronunciationLocale) => {
    const cachedUrl = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;
    if (cachedUrl) {
      primeWordAudioUrl(word.word, locale, cachedUrl);
      return cachedUrl;
    }

    return fetchWordAudioUrl(word.word, locale);
  }, []);

  const resolveExampleAudioUrl = useCallback(
    (sentence: string, locale: PronunciationLocale) => fetchExampleAudioUrl(sentence, locale),
    [],
  );

  const waitForGap = useCallback(
    (gapMs: number, runId: number) =>
      new Promise<void>((resolve) => {
        if (gapMs <= 0 || runId !== playbackRunIdRef.current) {
          resolve();
          return;
        }

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          audioGapTimeoutRef.current = null;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          resolve();
        };

        activePlaybackFinishRef.current = finish;
        audioGapTimeoutRef.current = setTimeout(finish, gapMs);
      }),
    [],
  );

  const playAudioOnce = useCallback(
    async (word: Word, locale: PronunciationLocale, runId: number) => {
      if (runId !== playbackRunIdRef.current) return;

      const resolvedUrl = await resolveAudioUrl(word, locale);
      const pronunciationTarget: PlaybackTarget = { kind: 'pronunciation', locale };
      if (runId !== playbackRunIdRef.current) return;

      if (!resolvedUrl) {
        await speakViaBrowser(word.word, locale, runId, pronunciationTarget);
        return;
      }

      setPlaybackTarget(pronunciationTarget);

      await new Promise<void>((resolve) => {
        const audio = new Audio(resolvedUrl);
        let settled = false;
        const playbackRate = preferencesRef.current.speechPlaybackRate;
        audio.defaultPlaybackRate = playbackRate;
        audio.playbackRate = playbackRate;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          if (runId === playbackRunIdRef.current) {
            setPlaybackTarget(null);
          }
          resolve();
        };

        const fallbackToSpeech = () => {
          if (settled) return;
          settled = true;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          void speakViaBrowser(word.word, locale, runId, pronunciationTarget).then(() => resolve());
        };

        audioRef.current = audio;
        activePlaybackFinishRef.current = finish;
        audio.onended = finish;
        audio.onerror = fallbackToSpeech;
        audio.play().catch(fallbackToSpeech);
      });
    },
    [resolveAudioUrl, speakViaBrowser],
  );

  const playAudioSequence = useCallback(
    async (word: Word, locale: PronunciationLocale, repeatCount: number, gapMs: number) => {
      stopPlayback();
      const runId = playbackRunIdRef.current;

      for (let attempt = 0; attempt < repeatCount; attempt += 1) {
        await playAudioOnce(word, locale, runId);

        if (runId !== playbackRunIdRef.current) {
          return;
        }

        if (attempt < repeatCount - 1) {
          await waitForGap(gapMs, runId);
        }
      }
    },
    [playAudioOnce, stopPlayback, waitForGap],
  );

  const playExampleSentence = useCallback(
    async (sentence: string, key: string) => {
      if (!canPlayExampleAudio) return;

      if (playbackTarget?.kind === 'example' && playbackTarget.key === key) {
        stopPlayback();
        return;
      }

      stopPlayback();
      const runId = playbackRunIdRef.current;
      const exampleTarget: PlaybackTarget = { kind: 'example', key };
      setPlaybackTarget(exampleTarget);

      const resolvedUrl = await resolveExampleAudioUrl(sentence, audioLocale);
      if (runId !== playbackRunIdRef.current) return;

      if (!resolvedUrl || typeof Audio === 'undefined') {
        await speakViaBrowser(sentence, audioLocale, runId, exampleTarget);
        return;
      }

      await new Promise<void>((resolve) => {
        const audio = new Audio(resolvedUrl);
        let settled = false;
        const playbackRate = preferencesRef.current.speechPlaybackRate;
        audio.defaultPlaybackRate = playbackRate;
        audio.playbackRate = playbackRate;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          if (runId === playbackRunIdRef.current) {
            setPlaybackTarget(null);
          }
          resolve();
        };

        const fallbackToSpeech = () => {
          if (settled) return;
          settled = true;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          void speakViaBrowser(sentence, audioLocale, runId, exampleTarget).then(() => resolve());
        };

        audioRef.current = audio;
        activePlaybackFinishRef.current = finish;
        audio.onended = finish;
        audio.onerror = fallbackToSpeech;
        audio.play().catch(fallbackToSpeech);
      });
    },
    [audioLocale, canPlayExampleAudio, playbackTarget, resolveExampleAudioUrl, speakViaBrowser, stopPlayback],
  );

  useEffect(() => {
    if (!currentWord) return;

    const locale = preferences.defaultPronunciationLocale;
    setAudioLocale(locale);
    stopPlayback();

    if (!preferences.autoPlayEnabled) {
      return;
    }

    void playAudioSequence(currentWord, locale, preferences.autoPlayRepeatCount, preferences.autoPlayRepeatGapMs);
  }, [
    currentWord,
    playAudioSequence,
    preferences.autoPlayEnabled,
    preferences.autoPlayRepeatCount,
    preferences.autoPlayRepeatGapMs,
    preferences.defaultPronunciationLocale,
    preferences.speechPlaybackRate,
    stopPlayback,
  ]);

  return {
    audioLocale,
    setAudioLocale,
    activePronunciationLocale,
    activeExampleKey,
    playbackTarget,
    stopPlayback,
    playAudioSequence,
    playExampleSentence,
    speakViaBrowser,
  };
}
