import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Hand, Palette, Sparkles, Volume2, X, Zap } from 'lucide-react';

const VERSION_KEY = 'lumina_whatsnew_2026_05_03_routine_library_swipe'; // Bump this key to show the modal again in future updates

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

            <h2 className="mb-2 text-2xl font-black text-text-primary">本次更新</h2>
            <p className="mb-6 text-sm font-medium text-text-secondary">
              一起快乐地刷刷刷吧：
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                  <Volume2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">划词即可朗读</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    选中任意单词后即可一键播放发音，听音查词更顺手。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-green/10 text-apple-green">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">首页 Routine 记住你的词库</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    系统会记录你最近在刷的那本词库，"继续学习"直接抽下一组 30 词，不用每次都跳到词库选一遍。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-teal/10 text-apple-teal">
                  <Hand className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">手机端 Round 1 支持滑动切卡</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    左右滑动词卡即可切到上一个 / 下一个，告别小箭头。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-orange/10 text-apple-orange">
                  <Palette className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">UI 优化与 Bug 修复</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    调整了部分界面细节，并修复了已知问题。
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
