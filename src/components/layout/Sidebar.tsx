import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, ChevronRight, LayoutDashboard, LogOut, PlusCircle, Settings, User } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/app/home', icon: LayoutDashboard, label: '路线' },
  { to: '/app/library', icon: BookOpen, label: '地图' },
  { to: '/app/import', icon: PlusCircle, label: '接入' },
  { to: '/app/profile', icon: User, label: '账号' },
] as const;

interface SidebarProps {
  activePath: string;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  userEmail: string | null;
  userName: string | null;
}

export const Sidebar = ({
  activePath,
  onNavigate,
  onSignOut,
  userEmail,
  userName,
}: SidebarProps) => {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const userInitial = useMemo(
    () => (userName?.[0] ?? userEmail?.[0] ?? 'L').toUpperCase(),
    [userEmail, userName],
  );

  useEffect(() => {
    if (!isAccountMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isAccountMenuOpen]);

  return (
    <motion.aside
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="fixed bottom-0 left-0 right-0 z-50 flex h-20 w-full flex-row items-center justify-around rounded-t-[32px] border-t border-white/20 glass px-6 pb-safe jelly-shadow lg:bottom-6 lg:left-6 lg:top-6 lg:h-auto lg:w-20 lg:flex-col lg:justify-start lg:gap-8 lg:rounded-apple-lg lg:border-t-0 lg:px-0 lg:py-8 lg:pb-8"
    >
      {NAV_ITEMS.map((item) => (
        <button
          key={item.to}
          onClick={() => onNavigate(item.to)}
          className={`group relative flex h-12 w-12 items-center justify-center rounded-[16px] transition-all duration-300 lg:h-11 lg:w-11 lg:rounded-[14px] ${
            activePath === item.to
              ? 'bg-white text-apple-blue shadow-lg shadow-black/5'
              : 'text-gray-400 hover:bg-white/50 hover:text-gray-600'
          }`}
        >
          <item.icon className="h-6 w-6 lg:h-6 lg:w-6" />
          <span className="pointer-events-none absolute left-full ml-4 hidden whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 lg:block">
            {item.label}
          </span>
        </button>
      ))}

      <div ref={menuRef} className="relative lg:mt-auto">
        <button
          type="button"
          onClick={() => setIsAccountMenuOpen((prev) => !prev)}
          className={`flex h-12 w-12 items-center justify-center rounded-[16px] transition-colors lg:h-11 lg:w-11 lg:rounded-[14px] ${
            activePath === '/app/settings'
              ? 'bg-white text-apple-blue shadow-lg shadow-black/5'
              : 'text-gray-400 hover:bg-white/50 hover:text-gray-700'
          }`}
        >
          <Settings className="h-6 w-6 lg:h-6 lg:w-6" />
        </button>

        <AnimatePresence>
          {isAccountMenuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute bottom-full right-0 mb-4 w-[calc(100vw-48px)] max-w-[320px] origin-bottom-right rounded-[28px] border border-white/70 bg-white/88 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.12)] backdrop-blur-2xl lg:bottom-0 lg:left-full lg:right-auto lg:mb-0 lg:ml-4 lg:w-72 lg:origin-bottom-left"
            >
              <div className="flex items-center gap-3 rounded-[22px] bg-apple-gray px-3 py-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-apple-blue text-base font-black text-white">
                  {userInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-text-primary">
                    {userName ?? '当前在用账号'}
                  </p>
                  <p className="truncate text-xs font-medium text-text-secondary">
                    {userEmail ?? '邮箱稍后显示'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsAccountMenuOpen(false);
                  onNavigate('/app/settings');
                }}
                className="mt-3 flex w-full items-center justify-between rounded-[22px] px-4 py-4 text-left text-sm font-black text-text-primary transition-colors hover:bg-black/5"
              >
                <span className="inline-flex items-center gap-2">
                  <Settings className="h-4 w-4 text-apple-blue" />
                  学习节奏
                </span>
                <ChevronRight className="h-4 w-4 text-text-secondary" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsAccountMenuOpen(false);
                  onSignOut();
                }}
                className="mt-2 flex w-full items-center justify-between rounded-[22px] px-4 py-4 text-left text-sm font-black text-apple-red transition-colors hover:bg-apple-red/8"
              >
                退出登录
                <LogOut className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
};
