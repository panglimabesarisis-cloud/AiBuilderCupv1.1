import React from 'react';

export interface BrandLogoGoldProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CONFIG = {
  sm: {
    shield: 'w-9 h-9',
    divider: 'h-7 mx-2.5',
    title: 'text-base',
    subtitle: 'text-[9px]',
  },
  md: {
    shield: 'w-12 h-12',
    divider: 'h-9 mx-3',
    title: 'text-xl',
    subtitle: 'text-[11px]',
  },
  lg: {
    shield: 'w-16 h-16',
    divider: 'h-12 mx-4',
    title: 'text-3xl',
    subtitle: 'text-sm',
  },
} as const;

export const BrandLogoGold: React.FC<BrandLogoGoldProps> = ({
  size = 'md',
  className = '',
}) => {
  const cfg = SIZE_CONFIG[size];

  return (
    <div
      translate="no"
      data-no-translate="true"
      className={`notranslate inline-flex items-center select-none ${className}`}
    >
      {/* Left: Metallic Gold Shield with Bold White "POS" */}
      <div className={`relative shrink-0 ${cfg.shield}`}>
        <svg
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_4px_14px_rgba(244,204,116,0.25)]"
          aria-label="POS Shield Logo"
        >
          <defs>
            <linearGradient id="rcGoldTopLeft" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFF0B8" />
              <stop offset="45%" stopColor="#F4CC74" />
              <stop offset="100%" stopColor="#B8924E" />
            </linearGradient>
            <linearGradient id="rcGoldRight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#E6BE6A" />
              <stop offset="100%" stopColor="#8E6C32" />
            </linearGradient>
            <linearGradient id="rcGoldBottom" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#9C7A3C" />
              <stop offset="50%" stopColor="#D8B265" />
              <stop offset="100%" stopColor="#F4CC74" />
            </linearGradient>
          </defs>

          {/* Top-Left Beveled Shield Wing */}
          <path
            d="M58 8 L10 30 L10 62 C10 84 29 102 58 114 L58 98 C36 88 24 75 24 59 L24 39 L58 23 Z"
            fill="url(#rcGoldTopLeft)"
          />

          {/* Top-Right Beveled Shield Crest (opens above 'S') */}
          <path
            d="M58 8 L98 26 L88 38 L58 23 Z"
            fill="url(#rcGoldRight)"
          />

          {/* Bottom-Right Beveled Shield Tip (closes below 'S') */}
          <path
            d="M89 80 C79 95 69 106 58 114 L58 98 C66 92 73 85 77 77 Z"
            fill="url(#rcGoldBottom)"
          />

          {/* Bold White "POS" Text */}
          <text
            x="64"
            y="71"
            textAnchor="middle"
            fill="#FFFFFF"
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            fontWeight="900"
            fontSize="37"
            letterSpacing="1"
          >
            POS
          </text>
        </svg>
      </div>

      {/* Vertical Thin Divider */}
      <div
        className={`w-[1.5px] shrink-0 bg-[#3F3F46] ${cfg.divider}`}
        aria-hidden="true"
      />

      {/* Right: RiskCart + Artificial Intelligence */}
      <div
        translate="no"
        data-no-translate="true"
        className="notranslate flex flex-col justify-center leading-none"
      >
        <span
          className={`notranslate font-extrabold text-white tracking-tight leading-none ${cfg.title}`}
        >
          Risk<span className="text-[#F4CC74]">Cart</span>
        </span>
        <span
          className={`notranslate font-medium text-[#F4CC74] tracking-wide mt-1 leading-none ${cfg.subtitle}`}
        >
          Artificial Intelligence
        </span>
      </div>
    </div>
  );
};

export default BrandLogoGold;
