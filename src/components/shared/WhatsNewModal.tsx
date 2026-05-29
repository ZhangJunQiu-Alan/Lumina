import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CheckCircle2, Gauge, Keyboard, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IslandButton, IslandIconButton, IslandModalShell } from './AnimalPrimitives';

const VERSION_KEY = 'lumina_whatsnew_2026_05_29_learning_flow'; // Bump this key to show the modal again in future updates

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

            <h2 className="mb-2 text-2xl font-black text-text-primary">本次更新</h2>
            <p className="mb-6 text-sm font-medium text-text-secondary">
              学习界面和听写体验做了一轮整理：
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[#4f46e5]">
                  <ArrowLeft className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">手机学习页更顺手</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    学习时底部导航会自动收起，顶部新增返回按钮，设置入口也更轻，不再挤占词卡空间。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0f2fe] text-[#0284c7]">
                  <Gauge className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">每一轮进度更清楚</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    记忆、听写、回忆改成更清晰的轮次标签和进度条，当前进度一眼可见。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ecfdf5] text-[#16a34a]">
                  <Keyboard className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">听写反馈更直接</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    第二轮填对会即时变绿，填空、音频按钮和输入区的状态也统一了。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff8df] text-[#d78918]">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">词卡信息更紧凑</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    单词拆解、易混词对比和例句区域重新排版，长词和长说明更不容易撑乱界面。
                  </p>
                </div>
              </div>
            </div>

            <IslandButton
              onClick={handleStartLearning}
              tone="mint"
              block
              size="large"
            >
              知道了，开始学习
            </IslandButton>
            </IslandModalShell>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
