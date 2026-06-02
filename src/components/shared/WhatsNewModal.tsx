import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpenCheck, Headphones, Settings2, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IslandButton, IslandIconButton, IslandModalShell } from './AnimalPrimitives';

const VERSION_KEY = 'lumina_whatsnew_2026_06_02_dictation_review_v1'; // Bump this key to show the modal again in future updates

export function WhatsNewModal() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem(VERSION_KEY);
    if (!hasSeen) {
      // Slight delay so it doesn't pop up instantly, making the entrance smoother
      const timer = setTimeout(() => setIsOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(VERSION_KEY, 'true');
    setIsOpen(false);
  };

  const handleOpenHome = () => {
    localStorage.setItem(VERSION_KEY, 'true');
    setIsOpen(false);
    navigate('/app/home');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[#3d3028]/28"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-sm"
          >
            <IslandModalShell className="p-8">
              <IslandIconButton
                onClick={handleClose}
                aria-label="关闭更新弹窗"
                className="absolute right-6 top-6 h-10 w-10 rounded-full"
              >
                <X className="h-5 w-5" />
              </IslandIconButton>

              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
                <Sparkles className="h-6 w-6" />
              </div>

              <h2 className="mb-2 text-2xl font-black text-text-primary">上次以来的更新</h2>
              <p className="mb-6 text-sm font-medium text-text-secondary">复习和听写体验继续优化：</p>

              <div className="space-y-4 mb-8">
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[#4f46e5]">
                    <BookOpenCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">优化学习步骤</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      第二轮复习巩固，第三轮听写纠错，学习更贴近真实记忆。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0f2fe] text-[#0284c7]">
                    <Headphones className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">默写模式</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      听写和复习支持听写模式，关闭自动朗读，显示单词意思。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ecfdf5] text-[#16a34a]">
                    <Settings2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">音标</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">听写和复习显示音标。</p>
                  </div>
                </div>
              </div>

              <IslandButton onClick={handleOpenHome} tone="mint" block size="large">
                去首页看看
              </IslandButton>
            </IslandModalShell>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
