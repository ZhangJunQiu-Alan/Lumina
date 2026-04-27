import { AnimatePresence, motion } from 'motion/react';
import { Settings, X } from 'lucide-react';
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
            className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[84vh] flex-col overflow-hidden rounded-t-[32px] border border-white/80 bg-white/92 shadow-[0_-28px_90px_rgba(14,26,56,0.18)] backdrop-blur-2xl lg:hidden"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <DrawerHeader onClose={onClose} />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4">
              <LearningSettingsContent className="max-w-none space-y-4" />
            </div>
          </motion.aside>

          <motion.aside
            key="session-settings-desktop"
            data-session-settings-panel
            role="dialog"
            aria-modal="true"
            aria-label="学习节奏设置"
            initial={{ x: 430, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 430, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed bottom-6 right-6 top-6 z-[60] hidden w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[34px] border border-white/80 bg-white/88 shadow-[0_32px_110px_rgba(14,26,56,0.18)] backdrop-blur-2xl lg:flex"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <DrawerHeader onClose={onClose} />
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
              <LearningSettingsContent className="max-w-none space-y-4" />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="shrink-0 border-b border-black/6 bg-white/72 px-5 py-4 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-apple-blue/10 text-apple-blue shadow-[0_10px_24px_rgba(0,122,255,0.10)] transition-colors hover:bg-apple-blue/15"
            aria-label="关闭学习节奏设置"
          >
            <Settings className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xl font-black text-text-primary">学习节奏</h2>
            <p className="mt-1 text-sm leading-6 text-text-secondary">个性化调整你的学习体验</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] text-text-primary transition-colors hover:bg-black/5"
          aria-label="关闭学习节奏设置"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
