import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookmarkPlus, BookOpenCheck, Palette, Sparkles, X } from 'lucide-react';

const VERSION_KEY = 'lumina_whatsnew_2026_05_02_word_lookup_saved_words'; // Bump this key to show the modal again in future updates

export function WhatsNewModal() {
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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-sm rounded-[32px] glass-elevated p-8 shadow-2xl"
          >
            <button
              onClick={handleClose}
              aria-label="关闭更新弹窗"
              className="absolute right-6 top-6 rounded-full bg-black/5 p-2 text-text-secondary transition-colors hover:bg-black/10 hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
              <Sparkles className="h-6 w-6" />
            </div>

            <h2 className="mb-2 text-2xl font-black text-text-primary">近 6 小时更新</h2>
            <p className="mb-6 text-sm font-medium text-text-secondary">
              Lumina 刚刚完成了一轮阅读与词库体验更新：
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                  <BookmarkPlus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">阅读页支持点击查词</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    阅读短文时点击英文实词即可查看释义，并可直接收藏到个人词库。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-green/10 text-apple-green">
                  <BookOpenCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">个人词库思路升级</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    导入词与阅读收藏词统一进入个人词库，再按节奏组织成学习任务。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-orange/10 text-apple-orange">
                  <Palette className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">部分界面细节优化</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    调整了学习、导入与词库里的部分交互和视觉细节。
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full rounded-2xl bg-apple-blue py-3.5 text-sm font-bold text-white transition-transform active:scale-95 shadow-md shadow-apple-blue/20"
            >
              知道啦，去体验
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
