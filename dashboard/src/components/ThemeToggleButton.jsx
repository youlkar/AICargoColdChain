import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../lib/ThemeContext';

export default function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-heading text-[var(--text-secondary-2)] hover:bg-white/[0.04] hover:text-[var(--text-primary)] transition-all duration-200"
    >
      {isLight ? <Moon className="w-4 h-4 shrink-0" /> : <Sun className="w-4 h-4 shrink-0" />}
      {isLight ? 'Dark mode' : 'Light mode'}
    </button>
  );
}
