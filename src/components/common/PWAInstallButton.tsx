import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed standalone PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-xl bg-amber-500/20 border border-amber-500/50 px-3 py-1.5 text-xs font-bold text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.2)] hover:bg-amber-500/30 transition cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-amber-400" />
        Install App
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-[#110f0a] px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/15 transition cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-amber-400" />
          Install on iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#110f0a] border border-amber-500/40 p-6 shadow-[0_0_24px_rgba(245,158,11,0.18)]">
              <h3 className="text-base font-bold text-amber-100">Install on iPhone / iPad</h3>
              <p className="mt-2 text-xs text-amber-200/80 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari toolbar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] py-2 text-xs font-bold text-black hover:brightness-110 cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
