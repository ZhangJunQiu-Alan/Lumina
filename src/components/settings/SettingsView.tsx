import { SlidersHorizontal } from 'lucide-react';
import { LearningSettingsContent } from './LearningSettingsContent';

export { LearningSettingsContent } from './LearningSettingsContent';

export const SettingsView = () => (
  <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-[36px] border-2 border-[#ded2bf] bg-[#fffaf0] shadow-[0_6px_0_0_rgba(197,181,159,0.55),0_30px_90px_rgba(64,51,35,0.13)]">
    <header className="px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#eadfcd] bg-[#fffdf8] text-[#6a5848] shadow-[0_8px_22px_rgba(79,62,38,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">
          <SlidersHorizontal className="h-6 w-6" strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-black tracking-tight text-[#5a4a3d]">学习节奏</h1>
          <p className="mt-1 text-base font-bold text-[#8a7a69]">学习设置</p>
        </div>
      </div>
    </header>

    <div className="px-7 pb-7 sm:px-8 sm:pb-8">
      <LearningSettingsContent />
    </div>
  </div>
);
