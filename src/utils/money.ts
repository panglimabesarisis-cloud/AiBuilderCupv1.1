import { Product } from '../types';

export type CurrencyMode = 'IDR' | 'USD';

export const FALLBACK_IDR_RATE = 16200;
export let IDR_RATE = FALLBACK_IDR_RATE;

const CURRENCY_STORAGE_KEY = 'riskcart_currency';
const RATE_STORAGE_KEY = 'riskcart_exchange_rate';
const RATE_UPDATED_KEY = 'riskcart_exchange_rate_updated_at';

type CurrencyListener = (currency: CurrencyMode, exchangeRate: number) => void;
const listeners = new Set<CurrencyListener>();

const EXPLICIT_CURRENCY_PREF_KEY = 'riskcart_explicit_currency_v2';

function readInitialCurrency(): CurrencyMode {
  try {
    if (typeof window !== 'undefined') {
      const explicitChoice = localStorage.getItem(EXPLICIT_CURRENCY_PREF_KEY);
      if (explicitChoice === 'USD') return 'USD';
      if (explicitChoice === 'IDR') return 'IDR';
      // Default strictly to IDR (Rupiah) and reset any stale auto-USD value
      localStorage.setItem(CURRENCY_STORAGE_KEY, 'IDR');
    }
  } catch {
    // ignore
  }
  return 'IDR';
}

function readInitialRate(): number {
  try {
    if (typeof window !== 'undefined') {
      const saved = Number(localStorage.getItem(RATE_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= 10000 && saved <= 25000) {
        IDR_RATE = saved;
        return saved;
      }
    }
  } catch {
    // ignore
  }
  return FALLBACK_IDR_RATE;
}

let currentCurrencyMode: CurrencyMode = readInitialCurrency();
let currentExchangeRate: number = readInitialRate();

export function getCurrencyMode(): CurrencyMode {
  return currentCurrencyMode;
}

export function getExchangeRate(): number {
  return currentExchangeRate || FALLBACK_IDR_RATE;
}

export function getExchangeRateUpdatedAt(): string | null {
  try {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(RATE_UPDATED_KEY);
    }
  } catch {
    // ignore
  }
  return null;
}

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn(currentCurrencyMode, currentExchangeRate);
    } catch {
      // ignore listener errors
    }
  });
}

export function setCurrencyModeGlobal(mode: CurrencyMode, skipBroadcast = false): void {
  if (mode !== 'IDR' && mode !== 'USD') return;
  const changed = currentCurrencyMode !== mode;
  currentCurrencyMode = mode;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(CURRENCY_STORAGE_KEY, mode);
      localStorage.setItem(EXPLICIT_CURRENCY_PREF_KEY, mode);
      if (!skipBroadcast && changed) {
        window.dispatchEvent(
          new CustomEvent('riskcart:currency-change', {
            detail: { currency: currentCurrencyMode, exchangeRate: currentExchangeRate },
          })
        );
      }
    }
  } catch {
    // ignore
  }
  if (changed) {
    notifyListeners();
  }
}

export function setExchangeRateGlobal(rate: number, updatedAtIso?: string, skipBroadcast = false): void {
  const cleanRate = Number(rate);
  if (!Number.isFinite(cleanRate) || cleanRate < 10000 || cleanRate > 25000) return;
  const roundedRate = Math.round(cleanRate * 100) / 100;
  const changed = Math.abs(currentExchangeRate - roundedRate) > 0.01;
  currentExchangeRate = roundedRate;
  IDR_RATE = roundedRate;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(RATE_STORAGE_KEY, String(roundedRate));
      if (updatedAtIso) {
        localStorage.setItem(RATE_UPDATED_KEY, updatedAtIso);
      }
      if (!skipBroadcast && changed) {
        window.dispatchEvent(
          new CustomEvent('riskcart:currency-change', {
            detail: { currency: currentCurrencyMode, exchangeRate: currentExchangeRate },
          })
        );
      }
    }
  } catch {
    // ignore
  }
  if (changed) {
    notifyListeners();
  }
}

export function subscribeCurrency(listener: CurrencyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Fetches live USD -> IDR exchange rate from free public APIs with automatic fallback (16200).
 */
export async function fetchLiveExchangeRate(): Promise<{
  rate: number;
  isLive: boolean;
  updatedAt: string;
}> {
  const endpoints = [
    'https://open.er-api.com/v6/latest/USD',
    'https://api.exchangerate-api.com/v4/latest/USD',
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const idrRate = Number(data?.rates?.IDR);
        if (Number.isFinite(idrRate) && idrRate >= 10000 && idrRate <= 25000) {
          const nowIso = new Date().toISOString();
          setExchangeRateGlobal(idrRate, nowIso);
          return { rate: Math.round(idrRate * 100) / 100, isLive: true, updatedAt: nowIso };
        }
      }
    } catch {
      // try next endpoint or fallback
    }
  }

  const fallbackRate = getExchangeRate() || FALLBACK_IDR_RATE;
  const fallbackIso = getExchangeRateUpdatedAt() || new Date().toISOString();
  setExchangeRateGlobal(fallbackRate, fallbackIso);
  return { rate: fallbackRate, isLive: false, updatedAt: fallbackIso };
}

export function toIdr(v: number, baseCurrency: CurrencyMode = 'IDR', customRate?: number): number {
  const num = Number(v) || 0;
  const rate = customRate || getExchangeRate();
  if (baseCurrency === 'USD') {
    return Math.round(num * rate);
  }
  return Math.round(num);
}

export function toUsd(v: number, baseCurrency: CurrencyMode = 'IDR', customRate?: number): number {
  const num = Number(v) || 0;
  const rate = customRate || getExchangeRate();
  if (baseCurrency === 'USD') {
    return num;
  }
  return num / rate;
}

export function formatRupiah(
  val: number,
  mode?: CurrencyMode,
  baseCurrency: CurrencyMode = 'IDR',
  customRate?: number
): string {
  return fmtMoney(val, mode, baseCurrency, customRate);
}

/**
 * Formats a monetary value according to the active (or specified) currency ('IDR' | 'USD')
 * and live USD/IDR exchange rate.
 */
export function fmtMoney(
  v: number,
  mode?: CurrencyMode,
  baseCurrency: CurrencyMode = 'IDR',
  customRate?: number
): string {
  const num = Number(v) || 0;
  const activeMode: CurrencyMode = mode || getCurrencyMode();
  const rate = customRate && customRate > 0 ? customRate : getExchangeRate();

  if (activeMode === 'USD') {
    const usdVal = baseCurrency === 'USD' ? num : num / rate;
    if (Math.abs(usdVal) < 0.0001) {
      return '$0.00';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(usdVal);
  }

  const idrVal = Math.round(baseCurrency === 'USD' ? num * rate : num);
  const formattedIdr = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  })
    .format(Math.abs(idrVal))
    .replace(/\u00a0/g, ' ');

  if (idrVal < 0) {
    return `-${formattedIdr}`;
  }
  return formattedIdr;
}

export const formatMoney = fmtMoney;
export const formatCurrencyValue = fmtMoney;
export const formatCurrency = fmtMoney;

/**
 * Formats compact monetary values for chart axes and compact badges (e.g. Rp 1,5 Jt / Rp 500 Rb or $1.5K).
 */
export function formatCompactMoney(
  v: number,
  mode?: CurrencyMode,
  baseCurrency: CurrencyMode = 'IDR',
  customRate?: number
): string {
  const num = Number(v) || 0;
  const activeMode: CurrencyMode = mode || getCurrencyMode();
  const rate = customRate && customRate > 0 ? customRate : getExchangeRate();

  if (activeMode === 'USD') {
    const usdVal = baseCurrency === 'USD' ? num : num / rate;
    const absUsd = Math.abs(usdVal);
    if (absUsd < 0.0001) return '$0.00';
    const sign = usdVal < 0 ? '-' : '';
    if (absUsd >= 1_000_000) {
      return `${sign}$${(absUsd / 1_000_000).toFixed(1)}M`;
    }
    if (absUsd >= 1_000) {
      return `${sign}$${(absUsd / 1_000).toFixed(1)}K`;
    }
    if (absUsd >= 100) {
      return `${sign}$${absUsd.toFixed(0)}`;
    }
    return `${sign}$${absUsd.toFixed(2)}`;
  }

  const idrVal = Math.round(baseCurrency === 'USD' ? num * rate : num);
  const absIdr = Math.abs(idrVal);
  if (absIdr === 0) return 'Rp 0';
  const sign = idrVal < 0 ? '-' : '';
  if (absIdr >= 1_000_000_000) {
    return `${sign}Rp ${(absIdr / 1_000_000_000).toLocaleString('id-ID', {
      maximumFractionDigits: 1,
    })} M`;
  }
  if (absIdr >= 1_000_000) {
    return `${sign}Rp ${(absIdr / 1_000_000).toLocaleString('id-ID', {
      maximumFractionDigits: 1,
    })} Jt`;
  }
  if (absIdr >= 1_000) {
    return `${sign}Rp ${(absIdr / 1_000).toLocaleString('id-ID', {
      maximumFractionDigits: 0,
    })} Rb`;
  }
  return `${sign}Rp ${absIdr.toLocaleString('id-ID')}`;
}

/**
 * Parses an Indonesian Rupiah string (e.g. "35.000", "1.250.000", "1,5 Jt", "500 Rb", "0")
 * into its numeric IDR value.
 */
export function parseIdrStringValue(numPart: string, suffix?: string): number | null {
  const cleanNum = numPart.trim();
  if (!cleanNum) return null;

  let multiplier = 1;
  const s = (suffix || '').trim().toLowerCase();
  if (s === 'm' || s === 'miliar') multiplier = 1_000_000_000;
  else if (s === 'jt' || s === 'juta') multiplier = 1_000_000;
  else if (s === 'rb' || s === 'ribu') multiplier = 1_000;

  if (multiplier > 1) {
    // e.g. "1,5" in "Rp 1,5 Jt" or "1.5" in "Rp 1.5 Jt"
    const normalized = cleanNum.replace(/\./g, '').replace(',', '.');
    const val = Number(normalized);
    return Number.isFinite(val) ? val * multiplier : null;
  }

  // Standard formatted IDR: dots are thousand separators (e.g. "35.000", "1.250.000"), comma is decimal
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleanNum)) {
    const normalized = cleanNum.replace(/\./g, '').replace(',', '.');
    const val = Number(normalized);
    return Number.isFinite(val) ? val : null;
  }

  // US-formatted with commas as thousand separators (e.g. "35,000")
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleanNum)) {
    const normalized = cleanNum.replace(/,/g, '');
    const val = Number(normalized);
    return Number.isFinite(val) ? val : null;
  }

  // Plain digits or decimal
  const normalized = cleanNum.replace(',', '.');
  const val = Number(normalized);
  return Number.isFinite(val) ? val : null;
}

const DOM_RP_REGEX = /([+-]?\s*)Rp\.?\s*([\d.,]+)(?:\s*(Jt|Juta|Rb|Ribu|Miliar|M)\b)?/gi;

/**
 * Global DOM Currency Scanner converter:
 * Automatically converts any hardcoded "Rp ..." substring inside DOM text nodes or attributes
 * into "$..." when currencyMode === 'USD', using the live exchange rate.
 */
export function convertDomCurrencyInText(
  text: string,
  mode?: CurrencyMode,
  customRate?: number
): string {
  if (!text || typeof text !== 'string') return text;
  const activeMode = mode || getCurrencyMode();
  if (activeMode !== 'USD') return text;
  if (!/Rp/i.test(text)) return text;

  const rate = customRate && customRate > 0 ? customRate : getExchangeRate();

  return text.replace(
    DOM_RP_REGEX,
    (fullMatch, signPrefix: string, numStr: string, suffix?: string) => {
      const parsedIdr = parseIdrStringValue(numStr, suffix);
      if (parsedIdr === null || !Number.isFinite(parsedIdr)) return fullMatch;

      const trimmedSign = (signPrefix || '').trim();
      const formattedUsd = suffix
        ? formatCompactMoney(parsedIdr, 'USD', 'IDR', rate)
        : fmtMoney(parsedIdr, 'USD', 'IDR', rate);

      if (trimmedSign === '+') {
        const leadingSpace = signPrefix.startsWith(' ') ? ' ' : '';
        return `${leadingSpace}+${formattedUsd}`;
      }
      if (trimmedSign === '-') {
        const leadingSpace = signPrefix.startsWith(' ') ? ' ' : '';
        return `${leadingSpace}-${formattedUsd.replace(/^-/, '')}`;
      }
      return `${signPrefix || ''}${formattedUsd}`;
    }
  );
}

/**
 * Computes Modal (COGS), Keuntungan (Profit = Total Nilai - Modal), and Total Nilai
 * for a transaction by inspecting its items and cross-referencing product costPrice / buyPrice / modal / costPerUnit
 * from AppDataContext products.
 */
export function calcTransactionModalAndProfit(
  tx: any,
  products: Product[] = []
): { modal: number; keuntungan: number; totalNilai: number } {
  const totalNilai = Math.round(Number(tx?.totalAmount ?? tx?.total ?? tx?.subtotal ?? 0));

  let calculatedModal = 0;

  if (Array.isArray(tx?.items) && tx.items.length > 0) {
    for (const item of tx.items) {
      const qty = Math.max(1, Number(item?.qty ?? item?.quantityOrdered ?? item?.quantity ?? 1));
      const itemProdId = String(item?.productId || item?.id || '').trim();
      const itemSku = String(item?.sku || '').trim().toLowerCase();
      const itemName = String(item?.productName || item?.name || '').trim().toLowerCase();

      const matchedProd = products.find((p: any) => {
        if (itemProdId && (p.id === itemProdId || p.sku === itemProdId)) return true;
        if (itemSku && p.sku && String(p.sku).toLowerCase() === itemSku) return true;
        if (itemName && p.name && String(p.name).toLowerCase().trim() === itemName) return true;
        return false;
      }) as any;

      const baseProdCost = Number(
        matchedProd?.costPrice ??
          matchedProd?.buyPrice ??
          matchedProd?.modal ??
          matchedProd?.costPerUnit ??
          0
      );

      const rawItemCost = Number(
        item?.costPrice ?? item?.buyPrice ?? item?.modal ?? item?.unitCost ?? 0
      );

      const effectiveUnitCost = baseProdCost > 0 ? baseProdCost : rawItemCost;
      calculatedModal += effectiveUnitCost * qty;
    }
  }

  if (calculatedModal <= 0) {
    calculatedModal = Number(tx?.totalCost ?? tx?.modal ?? tx?.costPrice ?? 0);
  }

  const modal = Math.round(calculatedModal);
  const keuntungan = totalNilai - modal;

  return {
    modal,
    keuntungan,
    totalNilai,
  };
}

export const formatRibuanInput = (val: string | number): string => {
  const raw = String(val ?? '').replace(/\D/g, '');
  if (!raw) return '';
  return Number(raw).toLocaleString('id-ID');
};

export const parseRibuanInput = (val: string | number): number => {
  return Number(String(val ?? '').replace(/\D/g, '')) || 0;
};

