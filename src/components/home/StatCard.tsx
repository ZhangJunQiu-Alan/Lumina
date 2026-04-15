import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  value: number | string;
  label: string;
  index?: number;
}

export const StatCard = ({ icon: Icon, iconColor, iconBg, value, label, index = 0 }: StatCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.07, duration: 0.4 }}
      className="glass p-6 rounded-apple-lg jelly-shadow"
    >
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mb-4`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="text-3xl font-black">{value}</div>
      <div className="text-xs font-bold text-text-secondary uppercase tracking-widest mt-1">{label}</div>
    </motion.div>
  );
};
