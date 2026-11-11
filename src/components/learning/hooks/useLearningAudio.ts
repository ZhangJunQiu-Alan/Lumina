import { useCallback, useEffect, useRef, useState } from 'react';
import type { PronunciationLocale, Word } from '../../../types';
import { useLearningPreferences } from '../../../contexts/LearningPreferencesContext';
import { fetchExampleAudioUrl } from '../../../lib/exampleAudio';
import { fetchWordAudioUrl, primeWordAudioUrl } from '../../../lib/wordAudio';
import type { PlaybackTarget } from '../learningEngineUtils';

export interface UseLearningAudioOptions {
  currentWord?: Word | null;
  canPlayExampleAudio?: boolean;
}

export function useLearningAudio({ currentWord, canPlayExampleAudio = true }: UseLearningAudioOptions = {}) {
  const { preferences } = useLearningPreferences();
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  const [audioLocale, setAudioLocale] = useState<PronunciationLocale>(preferences.defaultPronunciationLocale);
  const [audioError, setAudioError] = useState('');
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

  const resolveAudioUrl = useCallback(
    async (word: Pick<Word, 'word' | 'audio_uk_url' | 'audio_us_url'>, locale: PronunciationLocale) => {
      const cachedUrl = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;
      if (cachedUrl) {
        primeWordAudioUrl(word.word, locale, cachedUrl);
        return cachedUrl;
      }

      return fetchWordAudioUrl(word.word, locale);
    },
    [],
  );

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
    async (word: Pick<Word, 'word' | 'audio_uk_url' | 'audio_us_url'>, locale: PronunciationLocale, runId: number) => {
      if (runId !== playbackRunIdRef.current) return;

      const resolvedUrl = await resolveAudioUrl(word, locale);
      const pronunciationTarget: PlaybackTarget = { kind: 'pronunciation', locale };
      if (runId !== playbackRunIdRef.current) return;

      if (!resolvedUrl || typeof Audio === 'undefined') {
        setAudioError(`无法播放 ${word.word} 的发音，请稍后重试。`);
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

        const failPlayback = () => {
          if (settled || runId !== playbackRunIdRef.current) return;
          setAudioError(`无法播放 ${word.word} 的发音，请稍后重试。`);
          audio.pause();
          finish();
        };

        audioRef.current = audio;
        activePlaybackFinishRef.current = finish;
        audio.onended = finish;
        audio.onerror = failPlayback;
        audio.play().catch(failPlayback);
      });
    },
    [resolveAudioUrl],
  );

  const playAudioSequence = useCallback(
    async (
      word: Pick<Word, 'word' | 'audio_uk_url' | 'audio_us_url'>,
      locale: PronunciationLocale,
      repeatCount: number,
      gapMs: number,
    ) => {
      stopPlayback();
      setAudioError('');
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
      setAudioError('');
      const runId = playbackRunIdRef.current;
      const exampleTarget: PlaybackTarget = { kind: 'example', key };
      setPlaybackTarget(exampleTarget);

      const resolvedUrl = await resolveExampleAudioUrl(sentence, audioLocale);
      if (runId !== playbackRunIdRef.current) return;

      if (!resolvedUrl || typeof Audio === 'undefined') {
        setAudioError('暂时无法播放例句音频，请稍后重试。');
        setPlaybackTarget(null);
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

        const failPlayback = () => {
          if (settled || runId !== playbackRunIdRef.current) return;
          setAudioError('暂时无法播放例句音频，请稍后重试。');
          audio.pause();
          finish();
        };

        audioRef.current = audio;
        activePlaybackFinishRef.current = finish;
        audio.onended = finish;
        audio.onerror = failPlayback;
        audio.play().catch(failPlayback);
      });
    },
    [audioLocale, canPlayExampleAudio, playbackTarget, resolveExampleAudioUrl, stopPlayback],
  );

  useEffect(() => {
    const locale = preferences.defaultPronunciationLocale;
    setAudioLocale(locale);
    stopPlayback();
    setAudioError('');
    if (!currentWord) return;

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
    audioError,
  };
}
