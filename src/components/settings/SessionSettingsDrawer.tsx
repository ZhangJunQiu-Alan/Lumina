import { AnimatePresence, motion } from 'motion/react';
import { SlidersHorizontal, X } from 'lucide-react';
import { LearningSettingsContent } from './LearningSettingsContent';

interface SessionSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SessionSettingsDrawer({ isOpen, onClose }: SessionSettingsDrawerProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.aside
            key="session-settings-mobile"
            data-session-settings-panel
            role="dialog"
            aria-modal="true"
            aria-label="学习节奏设置"
            initial={{ y: '100%', opacity: 0.96 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.96 }}
            transition={{ type: 'spring', stiffness: 330, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[88vh] flex-col overflow-hidden rounded-t-[36px] border-2 border-[#ded2bf] bg-[#fffaf0] shadow-[0_-5px_0_0_rgba(197,181,159,0.70),0_-28px_90px_rgba(61,52,40,0.18)] lg:hidden"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <DrawerHeader onClose={onClose} />
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              <LearningSettingsContent />
            </div>
          </motion.aside>

          <motion.aside
            key="session-settings-desktop"
            data-session-settings-panel
            role="dialog"
            aria-modal="true"
            aria-label="学习节奏设置"
            initial={{ x: 560, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 560, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed bottom-6 right-6 top-6 z-[60] hidden w-[min(540px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[36px] border-2 border-[#ded2bf] bg-[#fffaf0] shadow-[0_6px_0_0_rgba(197,181,159,0.70),0_32px_110px_rgba(61,52,40,0.18)] lg:flex"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <DrawerHeader onClose={onClose} />
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-8">
              <LearningSettingsContent />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="shrink-0 px-6 pb-5 pt-7 sm:px-8 sm:pt-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#eadfcd] bg-[#fffdf8] text-[#6a5848] shadow-[0_8px_22px_rgba(79,62,38,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]">
            <SlidersHorizontal className="h-6 w-6" strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <h2 className="text-3xl font-black tracking-tight text-[#5a4a3d]">学习节奏</h2>
            <p className="mt-1 text-base font-bold text-[#8a7a69]">学习设置</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-[#ded2bf] bg-[#fffdf8] text-[#6a5848] shadow-[0_8px_22px_rgba(79,62,38,0.09)] transition-colors hover:bg-white"
          aria-label="关闭学习节奏设置"
        >
          <X className="h-6 w-6" strokeWidth={2.2} />
        </button>
      </div>
    </header>
  );
}
