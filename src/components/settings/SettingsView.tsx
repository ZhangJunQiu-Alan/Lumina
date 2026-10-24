import { SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { LearningSettingsContent } from './LearningSettingsContent';
import { fadeUp, stagger } from '../../lib/motion';

export { LearningSettingsContent } from './LearningSettingsContent';

export const SettingsView = () => (
  <motion.div
    variants={stagger(0.08)}
    initial="hidden"
    animate="visible"
    className="settings-panel mx-auto w-full max-w-[680px] overflow-hidden"
  >
    <motion.header variants={fadeUp} className="fluid-panel pb-5">
      <div className="flex items-start gap-4">
        <div className="settings-panel__icon flex h-12 w-12 shrink-0 items-center justify-center">
          <SlidersHorizontal className="h-6 w-6" strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <p className="settings-panel__kicker">Preferences</p>
          <h1 className="settings-panel__title">学习设置</h1>
        </div>
      </div>
    </motion.header>

    <motion.div variants={fadeUp} className="fluid-panel pt-0">
      <LearningSettingsContent />
    </motion.div>
  </motion.div>
);
