import React from 'react';
import { Sparkles, ArrowLeft, Clock, Layers } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAppNavigation } from '../../router';

interface ComingSoonPlaceholderProps {
  featureName?: string;
}

export const ComingSoonPlaceholder: React.FC<ComingSoonPlaceholderProps> = ({
  featureName,
}) => {
  const { tr } = useLanguage();
  const { route, navigateToPath } = useAppNavigation();

  const name =
    featureName ||
    route.entityId ||
    new URLSearchParams(window.location.search).get('fitur') ||
    tr('Fitur Ini', 'This Feature');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 animate-in fade-in">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-3xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-xl shadow-blue-900/20">
          <Clock className="w-10 h-10 animate-pulse" />
        </div>
        <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center text-zinc-950 shadow-md">
          <Sparkles className="w-4 h-4 fill-current" />
        </div>
      </div>

      <span className="px-3 py-1 rounded-full text-[11px] font-bold font-mono tracking-wider uppercase bg-blue-950/80 text-blue-400 border border-blue-800/80 mb-3">
        {tr('COMING SOON', 'SEGERA HADIR')}
      </span>

      <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2">
        {name}
      </h2>

      <p className="text-sm text-zinc-400 max-w-md mb-8 leading-relaxed">
        {tr(
          'This feature is currently under active development and will be released in the upcoming RiskCart update.',
          'Sub-fitur ini sedang dalam tahap pengembangan dan akan segera aktif pada pembaruan RiskCart berikutnya.'
        )}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => navigateToPath('/dashboard/pos')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{tr('Back to POS Terminal', 'Kembali ke Terminal Kasir POS')}</span>
        </button>
        <button
          onClick={() => navigateToPath('/dashboard')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 text-xs font-bold transition cursor-pointer"
        >
          <Layers className="w-4 h-4" />
          <span>{tr('Admin Dashboard', 'Dashboard Admin')}</span>
        </button>
      </div>
    </div>
  );
};
