const COOLDOWN_STORAGE_KEY = 'riskcart_ai_manual_cooldown_v1';
export const DEFAULT_AI_COOLDOWN_MS = 30_000; // Minimum 30 seconds between manual AI clicks

interface CooldownMap {
  globalLastCallTs?: number;
  byKey?: Record<string, number>;
}

function readCooldownMap(): CooldownMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CooldownMap;
  } catch {
    return {};
  }
}

function writeCooldownMap(map: CooldownMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Checks whether a manual Gemini API button click is allowed (minimum 30s cooldown).
 * If allowed, records the current timestamp immediately.
 */
export function checkAndRecordAiCooldown(
  actionKey = 'global',
  cooldownMs: number = DEFAULT_AI_COOLDOWN_MS
): { allowed: boolean; remainingSeconds: number; message: string } {
  const now = Date.now();
  const state = readCooldownMap();
  const lastGlobal = state.globalLastCallTs || 0;
  const lastByKey = state.byKey?.[actionKey] || 0;
  const lastTs = Math.max(lastGlobal, lastByKey);
  const elapsed = now - lastTs;

  if (lastTs > 0 && elapsed < cooldownMs) {
    const remainingSeconds = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
    return {
      allowed: false,
      remainingSeconds,
      message: `Pembatas Cooldown Gemini API aktif: tunggu ${remainingSeconds} detik lagi sebelum menekan tombol analisis AI kembali.`,
    };
  }

  writeCooldownMap({
    globalLastCallTs: now,
    byKey: {
      ...(state.byKey || {}),
      [actionKey]: now,
    },
  });

  return {
    allowed: true,
    remainingSeconds: 0,
    message: '',
  };
}

/**
 * Returns remaining cooldown seconds without recording a new call.
 */
export function getRemainingAiCooldownSeconds(
  actionKey = 'global',
  cooldownMs: number = DEFAULT_AI_COOLDOWN_MS
): number {
  const now = Date.now();
  const state = readCooldownMap();
  const lastGlobal = state.globalLastCallTs || 0;
  const lastByKey = state.byKey?.[actionKey] || 0;
  const lastTs = Math.max(lastGlobal, lastByKey);
  if (lastTs <= 0) return 0;
  const elapsed = now - lastTs;
  if (elapsed >= cooldownMs) return 0;
  return Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
}
