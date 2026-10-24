import React, { useState, useEffect, useMemo } from 'react';
import { X, Package } from 'lucide-react';

export interface ProductGalleryModalProps {
  open: boolean;
  onClose: () => void;
  product: {
    name: string;
    variantLabel?: string;
    imageUrl?: string;
    galleryUrls?: string[];
  } | null;
}

export const ProductGalleryModal: React.FC<ProductGalleryModalProps> = ({
  open,
  onClose,
  product,
}) => {
  const images = useMemo(() => {
    if (!product) return [];
    const raw = [
      product.imageUrl,
      ...(Array.isArray(product.galleryUrls) ? product.galleryUrls : []),
    ]
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean);
    return Array.from(new Set(raw));
  }, [product]);

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setActiveIndex(0);
    setFailedUrls({});
  }, [product, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !product) return null;

  const activeUrl = images[activeIndex] || '';
  const showFallback = !activeUrl || failedUrls[activeUrl];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          background: 'linear-gradient(180deg, #161006 0%, #090603 100%)',
          border: '1.5px solid rgba(255, 200, 82, 0.45)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), 0 0 28px rgba(255, 185, 45, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{
            background: 'rgba(24, 18, 9, 0.92)',
            borderBottom: '1px solid rgba(255, 200, 82, 0.25)',
          }}
        >
          <div className="min-w-0 pr-3">
            <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
              {product.name}
            </h3>
            {product.variantLabel && (
              <p className="text-xs font-semibold truncate mt-0.5" style={{ color: '#ffd86b' }}>
                {product.variantLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg transition cursor-pointer shrink-0"
            style={{
              background: 'rgba(20, 15, 8, 0.85)',
              border: '1px solid rgba(255, 200, 82, 0.4)',
              color: '#f7f3ea',
            }}
            aria-label="Close gallery"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Large Photo */}
        <div
          className="flex-1 min-h-[280px] sm:min-h-[380px] flex items-center justify-center p-4 overflow-hidden"
          style={{
            background:
              'radial-gradient(220px 160px at 50% 45%, rgba(255, 200, 80, 0.16), rgba(10, 8, 4, 0.96))',
          }}
        >
          {showFallback ? (
            <div className="flex flex-col items-center justify-center gap-2" style={{ color: '#b7ad99' }}>
              <Package className="w-16 h-16 stroke-[1.5]" style={{ color: '#ffd86b' }} />
              <span className="text-xs">No product image available</span>
            </div>
          ) : (
            <img
              src={activeUrl}
              alt={product.name}
              onError={() =>
                setFailedUrls((prev) => ({ ...prev, [activeUrl]: true }))
              }
              className="max-h-[60vh] w-full object-contain rounded-lg select-none"
            />
          )}
        </div>

        {/* Thumbnail Strip */}
        {images.length > 0 && (
          <div
            className="px-4 py-3 flex items-center justify-center gap-2.5 overflow-x-auto shrink-0"
            style={{
              background: 'rgba(20, 15, 8, 0.92)',
              borderTop: '1px solid rgba(255, 200, 82, 0.25)',
            }}
          >
            {images.map((url, idx) => {
              const isSelected = idx === activeIndex;
              const thumbFailed = failedUrls[url];
              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className="w-14 h-14 rounded-xl overflow-hidden shrink-0 flex items-center justify-center transition cursor-pointer"
                  style={
                    isSelected
                      ? {
                          background: '#0b0804',
                          border: '2px solid #ffd86b',
                          boxShadow: '0 0 12px rgba(255, 185, 45, 0.35)',
                        }
                      : {
                          background: '#0b0804',
                          border: '1px solid rgba(255, 200, 82, 0.28)',
                          opacity: 0.72,
                        }
                  }
                >
                  {thumbFailed ? (
                    <Package className="w-6 h-6" style={{ color: '#ffd86b' }} />
                  ) : (
                    <img
                      src={url}
                      alt={`${product.name} ${idx + 1}`}
                      onError={() =>
                        setFailedUrls((prev) => ({ ...prev, [url]: true }))
                      }
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
