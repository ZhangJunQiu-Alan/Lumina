import { motion } from 'motion/react';
import { BookMarked, BookOpen, ClipboardList, LayoutDashboard, User } from 'lucide-react';
import { LuminaLogo } from '../brand/LuminaLogo';

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
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className={`lumina-sidebar ${hideOnMobile ? 'hidden lg:flex' : 'flex'}`}
    >
      <button
        className="lumina-sidebar__brand"
        type="button"
        onClick={() => onNavigate('/app/home')}
        aria-label="回到首页"
      >
        <LuminaLogo size={44} className="lumina-sidebar__logo" wordmarkClassName="lumina-sidebar__wordmark" />
      </button>

      <nav className="lumina-sidebar__nav" aria-label="主要导航">
        {NAV_ITEMS.map((item) => {
          const isActive = activePath === item.to || (item.to !== '/app/home' && activePath.startsWith(`${item.to}/`));
          return (
            <button
              key={item.to}
              type="button"
              onClick={() => onNavigate(item.to)}
              className="lumina-nav-item"
              data-active={isActive ? 'true' : 'false'}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && <motion.span className="lumina-nav-item__indicator" layoutId="lumina-nav-active" />}
              <item.icon className="lumina-nav-item__icon" />
              <span className="lumina-nav-item__label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </motion.aside>
  );
};
