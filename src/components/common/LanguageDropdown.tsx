import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Check, X, Sparkles } from 'lucide-react';
import {
  useLanguage,
  SupportedTranslateLang,
  applyGoogleTranslateCookie,
} from '../../context/LanguageContext';
import { sanitizeGoogleTranslateDOM } from '../../utils/i18nEngine';

export interface LanguageOption {
  code: SupportedTranslateLang;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'en', name: 'English', nativeName: 'English (US/UK)', flag: '🇺🇸' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'th', name: 'Thai', nativeName: 'ภาษาไทย', flag: '🇹🇭' },
];

interface LanguageDropdownProps {
  className?: string;
  compact?: boolean;
  onSelectComplete?: () => void;
}

export const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  className = '',
  compact = false,
  onSelectComplete,
}) => {
  const { activeLangCode, language, setLanguage } = useLanguage();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const effectiveLangCode = activeLangCode || (language === 'id' ? 'id' : 'en');
  const currentLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === effectiveLangCode) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const handleSelectLanguage = (code: SupportedTranslateLang) => {
    setLanguage(code);
    applyGoogleTranslateCookie(code);
    sanitizeGoogleTranslateDOM();
    setIsModalOpen(false);
    if (onSelectComplete) {
      onSelectComplete();
    }
  };

  return (
    <>
      {/* Tombol Tunggal "Translate" di Kiri Bawah Sidebar */}
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        translate="no"
        data-no-translate="true"
        title={`Translate (${currentLang.nativeName})`}
        className={`notranslate ${
          compact
            ? 'p-2.5 rounded-xl justify-center'
            : 'w-full px-3.5 py-2.5 rounded-xl justify-between'
        } flex items-center bg-[#14110a] hover:bg-[#1f1a0e] border border-amber-500/30 hover:border-amber-400/60 transition-all duration-200 group shadow-sm cursor-pointer ${className}`}
      >
        {compact ? (
          <Globe className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform shrink-0">
                <Globe className="w-4 h-4" />
              </div>
              <div className="text-left min-w-0">
                <div className="text-xs font-bold text-amber-100 tracking-wide">Translate</div>
                <div className="text-[10px] text-amber-400/80 font-medium truncate">
                  {currentLang.flag} {currentLang.nativeName}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
              {currentLang.code.toUpperCase()}
            </span>
          </>
        )}
      </button>

      {/* Modal Pilihan Bahasa (Dirender via Portal agar tampil di tengah layar di atas semua elemen) */}
      {isModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            translate="no"
            data-no-translate="true"
            className="notranslate fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-[#110e08] border border-amber-500/40 shadow-[0_0_50px_rgba(245,158,11,0.18)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header Modal */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-transparent">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-amber-100 uppercase tracking-wider">
                      Pilih Bahasa Aplikasi
                    </h3>
                    <p className="text-[11px] text-amber-200/60">
                      Terjemahkan antarmuka tanpa mengubah data produk &amp; kategori
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-lg text-amber-200/60 hover:text-amber-100 hover:bg-amber-500/10 transition cursor-pointer"
                  aria-label="Tutup modal bahasa"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Grid Daftar Bahasa */}
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[65vh] overflow-y-auto">
                {SUPPORTED_LANGUAGES.map((item) => {
                  const isActive = effectiveLangCode === item.code;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => handleSelectLanguage(item.code)}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isActive
                          ? 'bg-amber-500/20 border-amber-400 text-amber-100 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                          : 'bg-[#18140c] border-amber-500/20 text-zinc-300 hover:border-amber-500/50 hover:bg-[#211b10]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl shrink-0">{item.flag}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-amber-50 truncate">
                            {item.nativeName}
                          </div>
                          <div className="text-[10px] text-amber-200/60 truncate">{item.name}</div>
                        </div>
                      </div>
                      {isActive && (
                        <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Footer Modal */}
              <div className="px-5 py-3 border-t border-amber-500/20 bg-[#0c0a06] flex items-center justify-between text-[11px] text-amber-200/60">
                <span>
                  Bahasa Aktif:{' '}
                  <strong className="text-amber-300">{currentLang.nativeName}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30 transition cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default LanguageDropdown;


