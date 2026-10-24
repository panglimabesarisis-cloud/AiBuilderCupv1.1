import React, { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { useLanguage, Language } from '../../context/LanguageContext';

interface LanguageDropdownProps {
  className?: string;
  compact?: boolean;
}

const LANGUAGE_OPTIONS: Array<{
  code: Language;
  label: string;
  subLabel: string;
  short: string;
}> = [
  {
    code: 'en',
    label: 'English — EN (Default)',
    subLabel: 'Google Translate • English',
    short: 'EN',
  },
  {
    code: 'id',
    label: 'Bahasa Indonesia — ID',
    subLabel: 'Google Translate • Indonesia',
    short: 'ID',
  },
];

export const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  className = '',
  compact = false,
}) => {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const activeCode = language === 'id' ? 'ID' : 'EN';

  return (
    <div
      ref={dropdownRef}
      translate="no"
      data-no-translate="true"
      className={`notranslate relative inline-block text-left ${className}`}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Select Language (${activeCode})`}
        title={
          language === 'id'
            ? 'Bahasa Aktif: Bahasa Indonesia (ID) — Klik untuk memilih bahasa'
            : 'Active Language: English (EN) — Click to select language'
        }
        className={`flex items-center gap-1.5 ${
          compact ? 'px-2.5 py-1.5 rounded-lg' : 'px-3 py-1.5 rounded-xl'
        } bg-[#18140c] hover:bg-[#221c10] border border-amber-500/40 hover:border-amber-400 text-xs font-bold transition shadow-sm cursor-pointer group focus:outline-none focus:ring-2 focus:ring-amber-500/40`}
      >
        <Globe className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-12 transition-transform shrink-0" />
        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[11px] font-black tracking-wide leading-none">
          {activeCode}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-amber-300/70 group-hover:text-amber-300 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-amber-400' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Language options"
          className="absolute right-0 mt-2 w-60 rounded-xl bg-[#110f0a]/95 backdrop-blur-md border border-amber-500/40 shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          {LANGUAGE_OPTIONS.map((opt) => {
            const isSelected = language === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setLanguage(opt.code);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-left transition cursor-pointer ${
                  isSelected
                    ? 'bg-amber-500/20 text-amber-200 font-bold border-l-2 border-amber-400'
                    : 'text-amber-100/80 hover:text-amber-50 hover:bg-amber-500/10 font-medium border-l-2 border-transparent'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate font-bold">{opt.label}</div>
                  <div className="truncate text-[10px] text-amber-300/70 font-mono mt-0.5">
                    {opt.subLabel}
                  </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

