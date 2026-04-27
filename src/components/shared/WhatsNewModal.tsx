import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X } from 'lucide-react';

const VERSION_KEY = 'lumina_whatsnew_2026_04_28'; // Bump this key to show the modal again in future updates

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
              className="absolute right-6 top-6 rounded-full bg-black/5 p-2 text-text-secondary transition-colors hover:bg-black/10 hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-apple-blue/10 text-apple-blue">
              <Sparkles className="h-6 w-6" />
            </div>

            <h2 className="mb-2 text-2xl font-black text-text-primary">发现新版本</h2>
            <p className="mb-6 text-sm font-medium text-text-secondary">
              Lumina 刚刚进行了更新，快来看看有什么新变化：
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-xl">
                  ✏️
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">答题字母槽实时输入</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    Round 2 与复习轮的空位现在直接显示字母槽，键盘输入实时填入，无需再看底部输入框。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-green/10 text-xl">
                  🎯
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">官方词库进度环</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    词库卡片新增动画完成度环，一眼看清掌握进度；复习结束自动刷新。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-orange/10 text-xl">
                  📓
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">生词本上线 + 导航精修</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    侧边栏新增「生词」入口，专门收纳重点词；同时精简首页与词库的视觉层级。
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
