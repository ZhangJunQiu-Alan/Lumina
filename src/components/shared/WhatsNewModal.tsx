import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart3, BookOpenCheck, Settings2, Shuffle, Sparkles, Target, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IslandButton, IslandIconButton, IslandModalShell } from './AnimalPrimitives';

const VERSION_KEY = 'lumina_whatsnew_2026_05_31_release_summary_v2'; // Bump this key to show the modal again in future updates

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

  const handleStartLearning = () => {
    localStorage.setItem(VERSION_KEY, 'true');
    setIsOpen(false);
    navigate('/app/ielts');
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
              <p className="mb-6 text-sm font-medium text-text-secondary">
                IELTS 练习、官方词库和加载体验一起整理好了：
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[#4f46e5]">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">IELTS 总览页更完整</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      阅读、听力练习、最近成绩、当前预估分和下一步推荐，现在都集中在雅思首页。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0f2fe] text-[#0284c7]">
                    <Target className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">目标分跟随账号同步</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      设置里新增雅思目标分，IELTS 总览会用它显示当前差距和练习进度。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ecfdf5] text-[#16a34a]">
                    <Settings2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">学习轮次可按需调整</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      如果想先只完成第一轮新词，可以在设置里关闭 Round 2，系统会自动收口本组。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff8df] text-[#d78918]">
                    <Shuffle className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">官方词库会记住选择</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      顺序 / 乱序会跟随你的选择保留，已开始的官方词组切换模式时也会保留已学进度。
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                    <BookOpenCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text-primary">首页加载更轻快</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      学习主界面改为按需加载，同时清理了代码 warning 和构建体积提醒。
                    </p>
                  </div>
                </div>
              </div>

              <IslandButton onClick={handleStartLearning} tone="mint" block size="large">
                去看 IELTS 总览
              </IslandButton>
            </IslandModalShell>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
