import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Power, RefreshCw, Play } from 'lucide-react';

export interface UseAiFeatureControlOptions<TArg = any> {
  featureKey: string;
  onRun: (signal: AbortSignal, customArg?: TArg) => Promise<void>;
}

export interface UseAiFeatureControlReturn<TArg = any> {
  isEnabled: boolean;
  setIsEnabled: (next: boolean) => void;
  toggleEnabled: () => void;
  isRunning: boolean;
  runAi: (customArg?: TArg) => Promise<void>;
  abortAi: () => void;
  statusMessage: string | null;
}

const AI_TOGGLE_PREFIX = 'riskcart_ai_feature_enabled_';

export function getAiFeatureToggleState(featureKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`${AI_TOGGLE_PREFIX}${featureKey}`) === 'true';
  } catch {
    return false;
  }
}

export function setAiFeatureToggleState(featureKey: string, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${AI_TOGGLE_PREFIX}${featureKey}`, enabled ? 'true' : 'false');
  } catch {}
}

/**
 * Enforces manual + ON/OFF toggle control for every AI feature in POS Admin:
 * - Default OFF, saved in localStorage (zero Firestore reads).
 * - ON = auto-runs once when the feature page/panel is opened (no polling, no re-run on re-render).
 * - OFF = no automatic API call; aborts any in-flight request with AbortController; shows "AI OFF — press Run AI".
 * - Disables Run AI while a request is in progress (no double calls).
 */
export function useAiFeatureControl<TArg = any>({
  featureKey,
  onRun,
}: UseAiFeatureControlOptions<TArg>): UseAiFeatureControlReturn<TArg> {
  const [isEnabled, setIsEnabledState] = useState<boolean>(() =>
    getAiFeatureToggleState(featureKey)
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasAutoRunOnMountRef = useRef<boolean>(false);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  // Sync featureKey change (e.g. switching between AI agent slugs)
  useEffect(() => {
    const saved = getAiFeatureToggleState(featureKey);
    setIsEnabledState(saved);
    hasAutoRunOnMountRef.current = false;
  }, [featureKey]);

  const abortAi = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const runAi = useCallback(
    async (customArg?: TArg) => {
      if (isRunning) return;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsRunning(true);
      try {
        await onRunRef.current(controller.signal, customArg);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn(`[AI Control ${featureKey}] Execution notice:`, err);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsRunning(false);
      }
    },
    [featureKey, isRunning]
  );

  const setIsEnabled = useCallback(
    (next: boolean) => {
      setAiFeatureToggleState(featureKey, next);
      setIsEnabledState(next);
      if (!next) {
        abortAi();
      }
    },
    [featureKey, abortAi]
  );

  const toggleEnabled = useCallback(() => {
    setIsEnabled(!isEnabled);
  }, [isEnabled, setIsEnabled]);

  // Auto-run ONCE when panel opens if toggle is ON (no polling, no re-run on re-render)
  useEffect(() => {
    if (isEnabled && !hasAutoRunOnMountRef.current) {
      hasAutoRunOnMountRef.current = true;
      void runAi();
    }
  }, [isEnabled, featureKey, runAi]);

  // Cleanup in-flight request on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const statusMessage = !isEnabled && !isRunning ? 'AI OFF — press Run AI' : null;

  return {
    isEnabled,
    setIsEnabled,
    toggleEnabled,
    isRunning,
    runAi,
    abortAi,
    statusMessage,
  };
}

export interface AiRunControlBarProps {
  label?: string;
  isEnabled: boolean;
  isRunning: boolean;
  onToggle: () => void;
  onRun: () => void;
  className?: string;
}

export const AiRunControlBar: React.FC<AiRunControlBarProps> = ({
  label = 'AI Engine',
  isEnabled,
  isRunning,
  onToggle,
  onRun,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl bg-zinc-950/90 border border-amber-500/30 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border flex items-center gap-1.5 transition cursor-pointer ${
            isEnabled
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200'
          }`}
          title="ON = Auto-run sekali saat halaman dibuka. OFF = Manual saja & batalkan request berjalan."
        >
          <Power className="w-3 h-3" />
          <span>{label}: {isEnabled ? 'ON' : 'OFF'}</span>
        </button>

        {!isEnabled && !isRunning && (
          <span className="text-[11px] font-mono font-semibold text-amber-300/90">
            AI OFF — press Run AI
          </span>
        )}
        {isRunning && (
          <span className="text-[11px] font-mono font-semibold text-emerald-400 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Running AI...
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={isRunning}
        className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm"
      >
        {isRunning ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Running...</span>
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run AI</span>
          </>
        )}
      </button>
    </div>
  );
};
