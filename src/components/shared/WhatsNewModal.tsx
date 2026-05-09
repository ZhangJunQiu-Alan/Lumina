import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { KeyRound, LineChart, Sparkles, X } from 'lucide-react';

const VERSION_KEY = 'lumina_whatsnew_2026_05_09_profile_and_password_reset'; // Bump this key to show the modal again in future updates

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
              账号页焕新，登录流程也补齐了找回密码：
            </p>

            <div className="space-y-4 mb-8">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-blue/10 text-apple-blue">
                  <LineChart className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">全新账号页</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    新增年度活跃热力图、每日学习趋势和正确率，能一眼看清自己的学习节奏。
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-orange/10 text-apple-orange">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">忘记密码可以重置了</h3>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    登录页支持邮件重置密码，注册时还能查看密码强度，重新接上账号更顺手。
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
