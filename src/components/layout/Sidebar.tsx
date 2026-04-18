import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, ChevronRight, LayoutDashboard, LogOut, PlusCircle, Settings, User } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/app/home', icon: LayoutDashboard, label: '首页' },
  { to: '/app/library', icon: BookOpen, label: '词库' },
  { to: '/app/import', icon: PlusCircle, label: '导入' },
  { to: '/app/profile', icon: User, label: '我的' },
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
      className="fixed left-6 top-6 bottom-6 z-50 flex w-20 flex-col items-center gap-8 rounded-apple-lg glass py-8 jelly-shadow"
    >
      {NAV_ITEMS.map((item) => (
        <button
          key={item.to}
          onClick={() => onNavigate(item.to)}
          className={`group relative flex h-11 w-11 items-center justify-center rounded-[14px] transition-all duration-300 ${
            activePath === item.to
              ? 'bg-white text-apple-blue shadow-lg shadow-black/5'
              : 'text-gray-400 hover:bg-white/50 hover:text-gray-600'
          }`}
        >
          <item.icon className="h-6 w-6" />
          <span className="pointer-events-none absolute left-full ml-4 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            {item.label}
          </span>
        </button>
      ))}

      <div ref={menuRef} className="relative mt-auto">
        <button
          type="button"
          onClick={() => setIsAccountMenuOpen((prev) => !prev)}
          className={`flex h-11 w-11 items-center justify-center rounded-[14px] transition-colors ${
            activePath === '/app/settings'
              ? 'bg-white text-apple-blue shadow-lg shadow-black/5'
              : 'text-gray-400 hover:bg-white/50 hover:text-gray-700'
          }`}
        >
          <Settings className="h-6 w-6" />
        </button>

        <AnimatePresence>
          {isAccountMenuOpen && (
            <motion.div
              initial={{ opacity: 0, x: -12, y: 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: -12, y: 8 }}
              className="absolute bottom-0 left-full ml-4 w-72 rounded-[28px] border border-white/70 bg-white/88 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.12)] backdrop-blur-2xl"
            >
              <div className="flex items-center gap-3 rounded-[22px] bg-apple-gray px-3 py-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-apple-blue text-base font-black text-white">
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-text-primary">
                    {userName ?? '当前账号'}
                  </p>
                  <p className="truncate text-xs font-medium text-text-secondary">
                    {userEmail ?? '还没拿到邮箱'}
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
                  学习设置
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
