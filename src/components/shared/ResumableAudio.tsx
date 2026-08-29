import { useCallback, useEffect, useRef } from 'react';
import { readLocal, writeLocal } from '../../lib/durableStorage';

export function ResumableAudio({
  src,
  storageKey,
  className,
}: {
  src: string;
  storageKey: string;
  className?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const lastSaved = useRef(0);
  const save = useCallback(
    (audio = ref.current) => {
      if (!audio || !Number.isFinite(audio.currentTime)) return;
      try {
        writeLocal(storageKey, { seconds: audio.ended ? 0 : audio.currentTime });
      } catch {
        /* surfaced by SyncStatus */
      }
    },
    [storageKey],
  );
  useEffect(() => {
    const audio = ref.current;
    const pause = () => {
      save(audio);
      audio?.pause();
    };
    const hidden = () => {
      if (document.hidden) pause();
    };
    window.addEventListener('lumina:pause', pause);
    window.addEventListener('pagehide', pause);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      pause();
      window.removeEventListener('lumina:pause', pause);
      window.removeEventListener('pagehide', pause);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [save, src]);
  return (
    <audio
      ref={ref}
      src={src}
      controls
      preload="metadata"
      className={className}
      onLoadedMetadata={() => {
        const audio = ref.current;
        const position = readLocal<{ seconds: number }>(storageKey)?.seconds;
        if (
          audio &&
          typeof position === 'number' &&
          Number.isFinite(position) &&
          position > 0 &&
          Number.isFinite(audio.duration)
        ) {
          audio.currentTime = Math.min(position, Math.max(0, audio.duration - 0.1));
        }
      }}
      onTimeUpdate={() => {
        if (Date.now() - lastSaved.current >= 1000) {
          lastSaved.current = Date.now();
          save();
        }
      }}
      onPause={() => save()}
      onSeeked={() => save()}
      onEnded={() => save()}
    >
      <track kind="captions" />
    </audio>
  );
}
