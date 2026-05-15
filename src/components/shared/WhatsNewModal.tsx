import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpenCheck, CheckCircle2, Clock3, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const VERSION_KEY = 'lumina_whatsnew_2026_05_16_ielts_reading'; // Bump this key to show the modal again in future updates

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

  const handleExploreIeltsReading = () => {
    localStorage.setItem(VERSION_KEY, 'true');
    setIsOpen(false);
    navigate('/app/ielts-reading');
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
              雅思阅读真题训练上线了：
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                  <BookOpenCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">雅思阅读真题训练上线</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    新增 Cambridge IELTS Academic Reading 入口，可以直接进入套题训练。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-orange/10 text-apple-orange">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">按考试节奏练习</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    60 分钟计时、左右 1/2 阅读与答题布局，答题卡进度也会实时同步。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#34c759]/10 text-[#34c759]">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">题目内直接作答</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    表格填空可直接在表格内填写，提交后显示得分和错题回看。
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleExploreIeltsReading}
              className="w-full rounded-2xl bg-apple-blue py-3.5 text-sm font-bold text-white transition-transform active:scale-95 shadow-md shadow-apple-blue/20"
            >
              去练雅思阅读
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
