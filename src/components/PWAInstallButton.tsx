import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'card'
            ? 'w-full min-h-[44px] px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap'
            : 'min-h-[40px] px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'card'
              ? 'w-full min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap'
              : 'min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0 text-blue-700" />
          <span>Install on iPhone</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Install SmartAttend on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 -mr-2 text-slate-400 hover:text-slate-700 rounded-lg"
                  aria-label="Close install instructions"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Install SmartAttend to your iPhone or iPad Home Screen for full-screen standalone access:
              </p>
              <ol className="mt-4 space-y-3 text-xs text-slate-800">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-mono font-semibold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    Tap the <strong className="inline-flex items-center gap-1">Share <Share className="w-3.5 h-3.5 inline text-blue-700" /></strong> button in the Safari toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-mono font-semibold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong className="inline-flex items-center gap-1">Add to Home Screen <PlusSquare className="w-3.5 h-3.5 inline text-blue-700" /></strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-md bg-blue-50 text-blue-700 font-mono font-semibold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span>Tap <strong>Add</strong> in the top-right corner to launch SmartAttend as an app.</span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-lg bg-navy-950 hover:bg-navy-900 text-white text-sm font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
