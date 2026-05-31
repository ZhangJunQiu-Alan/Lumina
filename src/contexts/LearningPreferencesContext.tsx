import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useAuth } from './AuthContext';
import type { LearningPreferences } from '../types';
import {
  getLearningPreferences,
  LEARNING_PREFERENCES_DEFAULTS,
  mergeLearningPreferences,
  saveLearningPreferences,
} from '../lib/learningPreferences';

interface LearningPreferencesContextValue {
  preferences: LearningPreferences;
  isLoading: boolean;
  loadError: string;
  savePreferences: (patch: Partial<LearningPreferences>) => Promise<LearningPreferences>;
  reloadPreferences: () => Promise<void>;
}

const LearningPreferencesContext = createContext<LearningPreferencesContextValue | null>(null);

export function LearningPreferencesProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [preferences, setPreferences] = useState<LearningPreferences>(LEARNING_PREFERENCES_DEFAULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadedUserIdRef = useRef<string | null>(null);
  const loadRunIdRef = useRef(0);

  const loadPreferences = useCallback(
    async (force = false) => {
      const loadRunId = ++loadRunIdRef.current;

      if (!userId) {
        loadedUserIdRef.current = null;
        setPreferences(LEARNING_PREFERENCES_DEFAULTS);
        setLoadError('');
        setIsLoading(false);
        return;
      }

      if (!force && loadedUserIdRef.current === userId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const nextPreferences = await getLearningPreferences(userId);
        if (loadRunId !== loadRunIdRef.current) return;
        setPreferences(nextPreferences);
        setLoadError('');
        loadedUserIdRef.current = userId;
      } catch (error) {
        if (loadRunId !== loadRunIdRef.current) return;
        setPreferences(LEARNING_PREFERENCES_DEFAULTS);
        setLoadError(error instanceof Error ? error.message : '学习设置读取失败');
      } finally {
        if (loadRunId === loadRunIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [userId],
  );

  const reloadPreferences = useCallback(() => loadPreferences(true), [loadPreferences]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const handleSavePreferences = useCallback(
    async (patch: Partial<LearningPreferences>) => {
      const previousPreferences = preferences;
      const optimisticPreferences = mergeLearningPreferences(previousPreferences, patch);
      setPreferences(optimisticPreferences);

      if (!userId) {
        return optimisticPreferences;
      }

      try {
        const persisted = await saveLearningPreferences(userId, optimisticPreferences);
        setPreferences(persisted);
        setLoadError('');
        loadedUserIdRef.current = userId;
        return persisted;
      } catch (error) {
        const message = error instanceof Error ? error.message : '学习设置保存失败';
        setPreferences(previousPreferences);
        setLoadError(message);
        throw error;
      }
    },
    [preferences, userId],
  );

  const value = useMemo<LearningPreferencesContextValue>(
    () => ({
      preferences,
      isLoading,
      loadError,
      savePreferences: handleSavePreferences,
      reloadPreferences,
    }),
    [handleSavePreferences, isLoading, loadError, preferences, reloadPreferences],
  );

  return <LearningPreferencesContext.Provider value={value}>{children}</LearningPreferencesContext.Provider>;
}

export function useLearningPreferences() {
  const context = useContext(LearningPreferencesContext);
  if (!context) {
    throw new Error('useLearningPreferences must be used inside LearningPreferencesProvider');
  }
  return context;
}
