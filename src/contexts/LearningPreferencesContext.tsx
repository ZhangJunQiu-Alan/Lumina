import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
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
  const [preferences, setPreferences] = useState<LearningPreferences>(LEARNING_PREFERENCES_DEFAULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const reloadPreferences = useCallback(async () => {
    if (!user) {
      setPreferences(LEARNING_PREFERENCES_DEFAULTS);
      setLoadError('');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextPreferences = await getLearningPreferences(user.id);
      setPreferences(nextPreferences);
      setLoadError('');
    } catch (error) {
      setPreferences(LEARNING_PREFERENCES_DEFAULTS);
      setLoadError(error instanceof Error ? error.message : '学习设置读取失败');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reloadPreferences();
  }, [reloadPreferences]);

  const handleSavePreferences = useCallback(
    async (patch: Partial<LearningPreferences>) => {
      const previousPreferences = preferences;
      const optimisticPreferences = mergeLearningPreferences(previousPreferences, patch);
      setPreferences(optimisticPreferences);

      if (!user) {
        return optimisticPreferences;
      }

      try {
        const persisted = await saveLearningPreferences(user.id, optimisticPreferences);
        setPreferences(persisted);
        setLoadError('');
        return persisted;
      } catch (error) {
        const message = error instanceof Error ? error.message : '学习设置保存失败';
        setPreferences(previousPreferences);
        setLoadError(message);
        throw error;
      }
    },
    [preferences, user],
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
