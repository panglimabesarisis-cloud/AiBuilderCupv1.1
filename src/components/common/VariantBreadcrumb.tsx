import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export interface VariantBreadcrumbProps {
  items: BreadcrumbItem[];
}

export const VariantBreadcrumb: React.FC<VariantBreadcrumbProps> = ({ items }) => {
  if (!items || items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-zinc-400 mb-3"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {idx > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            {!isLast && item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="text-blue-400 hover:text-blue-300 hover:underline transition cursor-pointer font-semibold"
              >
                {item.label}
              </button>
            ) : (
              <span
                className={
                  isLast
                    ? 'text-white font-bold truncate max-w-[240px]'
                    : 'text-zinc-400'
                }
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
