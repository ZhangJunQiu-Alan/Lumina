import { motion } from 'motion/react';
import { BookMarked, BookOpen, ClipboardList, LayoutDashboard, User } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/app/home', icon: LayoutDashboard, label: '路线' },
  { to: '/app/library', icon: BookOpen, label: '地图' },
  { to: '/app/ielts-reading', icon: ClipboardList, label: '雅思' },
  { to: '/app/notebook', icon: BookMarked, label: '生词' },
  { to: '/app/profile', icon: User, label: '账号' },
] as const;

interface SidebarProps {
  activePath: string;
  onNavigate: (path: string) => void;
}

export const Sidebar = ({ activePath, onNavigate }: SidebarProps) => {
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
    </motion.aside>
  );
};
