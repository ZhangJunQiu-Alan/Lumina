import { motion } from 'motion/react';
import { BookMarked, BookOpen, ClipboardList, LayoutDashboard, User } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/app/home', icon: LayoutDashboard, label: '首页' },
  { to: '/app/library', icon: BookOpen, label: '词库' },
  { to: '/app/ielts', icon: ClipboardList, label: '雅思' },
  { to: '/app/notebook', icon: BookMarked, label: '生词' },
  { to: '/app/profile', icon: User, label: '账号' },
] as const;

interface SidebarProps {
  activePath: string;
  onNavigate: (path: string) => void;
  hideOnMobile?: boolean;
}

export const Sidebar = ({ activePath, onNavigate, hideOnMobile = false }: SidebarProps) => {
  return (
    <motion.aside
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className={`fixed bottom-0 left-0 right-0 z-50 h-20 w-full flex-row items-center justify-around rounded-t-[34px] border-t-2 border-[#d8cdb9] bg-[#fffdf3]/95 px-6 pb-safe shadow-[0_-5px_0_0_rgba(189,174,160,0.55),0_-14px_34px_rgba(107,92,67,0.16)] lg:bottom-6 lg:left-6 lg:top-6 lg:h-auto lg:w-20 lg:flex-col lg:justify-start lg:gap-8 lg:rounded-[34px] lg:border-2 lg:px-0 lg:py-8 lg:pb-8 ${hideOnMobile ? 'hidden lg:flex' : 'flex'}`}
    >
      {NAV_ITEMS.map((item) => (
        <button
          key={item.to}
          onClick={() => onNavigate(item.to)}
          className={`group relative flex h-12 w-12 items-center justify-center rounded-[18px] border-2 transition-all duration-300 lg:h-11 lg:w-11 ${
            activePath === item.to
              ? 'border-apple-blue bg-apple-blue text-[#fff9e6] shadow-[0_4px_0_0_#11a89b]'
              : 'border-transparent bg-[#f7f3df] text-text-secondary shadow-[0_3px_0_0_#d4c9b4] hover:border-[#d8cdb9] hover:text-text-primary'
          }`}
        >
          <item.icon className="h-6 w-6 lg:h-6 lg:w-6" />
          <span className="pointer-events-none absolute left-full ml-4 hidden whitespace-nowrap rounded-full bg-[#ffcc00] px-3 py-1 text-xs font-black text-[#725d42] opacity-0 shadow-[0_3px_0_0_#e0b800] transition-opacity group-hover:opacity-100 lg:block">
            {item.label}
          </span>
        </button>
      ))}
    </motion.aside>
  );
};
