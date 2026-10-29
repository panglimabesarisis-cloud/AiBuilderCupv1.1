import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface ThemeToggleButtonProps {
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title="Ganti Tema (Dark / Light)"
      aria-label="Ganti Tema (Dark / Light)"
      className={`rc-theme-toggle-btn w-8 h-8 p-1.5 rounded-xl border transition-all duration-200 cursor-pointer flex items-center justify-center shrink-0 ${
        isLight
          ? 'bg-[#FCFAF7] hover:bg-[#EFE8DD] border-[#DDD2C3] text-[#34503F] shadow-sm'
          : 'bg-zinc-900/90 hover:bg-zinc-800 border-amber-500/40 text-amber-400 hover:text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.18)]'
      } ${className}`}
    >
      {isLight ? (
        <Moon className="w-4 h-4 stroke-[2.2]" />
      ) : (
        <Sun className="w-4 h-4 stroke-[2.2]" />
      )}
    </button>
  );
};

export default ThemeToggleButton;
