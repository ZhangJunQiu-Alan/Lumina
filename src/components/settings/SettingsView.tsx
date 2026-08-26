import { SlidersHorizontal } from 'lucide-react';
import { LearningSettingsContent } from './LearningSettingsContent';

export { LearningSettingsContent } from './LearningSettingsContent';

export const SettingsView = () => (
  <div className="settings-panel mx-auto w-full max-w-[680px] overflow-hidden">
    <header className="px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
      <div className="flex items-start gap-4">
        <div className="settings-panel__icon flex h-12 w-12 shrink-0 items-center justify-center">
          <SlidersHorizontal className="h-6 w-6" strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <p className="settings-panel__kicker">Preferences</p>
          <h1 className="settings-panel__title">学习设置</h1>
        </div>
      </div>
    </header>

    <div className="px-7 pb-7 sm:px-8 sm:pb-8">
      <LearningSettingsContent />
    </div>
  </div>
);
