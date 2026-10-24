import React from 'react';

interface RiskCartLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const RiskCartLogo: React.FC<RiskCartLogoProps> = ({
  className = '',
  size = 'md',
  showSubtitle = true,
}) => {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const shieldDimension = isSm ? 'w-8 h-8' : isLg ? 'w-11 h-11' : 'w-9 h-9';
  const titleSize = isSm ? 'text-xs' : isLg ? 'text-lg' : 'text-sm';
  const subtitleSize = isSm ? 'text-[9px]' : isLg ? 'text-xs' : 'text-[10px]';

  return (
    <div
      translate="no"
      data-no-translate="true"
      className={`notranslate flex items-center gap-2.5 select-none ${className}`}
    >
      {/* Official RiskCart Luxury Gold Shield with POS */}
      <div className={`relative ${shieldDimension} shrink-0 group`}>
        <div className="absolute inset-0 bg-amber-500/25 blur-md rounded-xl group-hover:bg-amber-400/40 transition-all" />
        <svg
          viewBox="0 0 100 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full relative drop-shadow-[0_0_10px_rgba(245,158,11,0.55)]"
        >
          <defs>
            <linearGradient id="shieldGradGold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fde68a" />
              <stop offset="45%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
            <linearGradient id="borderGradGold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>

          {/* Shield Outline Outer */}
          <path
            d="M50 4 L88 18 C88 56 68 88 50 102 C32 88 12 56 12 18 Z"
            fill="url(#shieldGradGold)"
            stroke="url(#borderGradGold)"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />

          {/* Inner Obsidian Shield Accent */}
          <path
            d="M50 12 L80 23 C80 54 63 80 50 92 C37 80 20 54 20 23 Z"
            fill="#0b0906"
            fillOpacity="0.9"
            stroke="#fbbf24"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />

          {/* Bold POS Typography */}
          <text
            x="50"
            y="62"
            textAnchor="middle"
            fill="#fffbeb"
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            fontWeight="900"
            fontSize="30"
            letterSpacing="1.5"
          >
            POS
          </text>

          {/* Micro Gold AI Chip Indicator Dot */}
          <circle cx="50" cy="80" r="3.5" fill="#fbbf24" />
          <line x1="38" y1="80" x2="44" y2="80" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="56" y1="80" x2="62" y2="80" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Vertical Gold Brand Divider */}
      <div className="h-7 w-[1.5px] bg-gradient-to-b from-transparent via-amber-500/70 to-transparent shrink-0" />

      {/* Brand Typography */}
      <div translate="no" data-no-translate="true" className="notranslate flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`notranslate font-black text-amber-50 tracking-tight ${titleSize} leading-tight`}>
            Risk<span className="text-amber-400">Cart</span>
          </span>
          <span className="notranslate text-[9px] font-black px-1.5 py-0.2 rounded bg-gradient-to-r from-[#f59e0b] to-[#d97706] text-black border border-amber-300/60 uppercase tracking-wider shadow-[0_0_8px_rgba(245,158,11,0.3)]">
            AI
          </span>
        </div>
        {showSubtitle && (
          <span className={`notranslate text-amber-200/70 font-semibold tracking-wide truncate ${subtitleSize} leading-tight -mt-0.5`}>
            Artificial Intelligence
          </span>
        )}
      </div>
    </div>
  );
};
