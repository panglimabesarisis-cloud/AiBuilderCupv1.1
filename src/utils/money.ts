import { Product } from '../types';

export type CurrencyMode = 'IDR' | 'USD' | 'EUR' | 'SGD';

export const SUPPORTED_CURRENCIES: readonly CurrencyMode[] = ['IDR', 'USD', 'EUR', 'SGD'] as const;

export function isSupportedCurrency(val: unknown): val is CurrencyMode {
  return val === 'IDR' || val === 'USD' || val === 'EUR' || val === 'SGD';
}

export const FALLBACK_IDR_RATE = 16200;
export const FALLBACK_RATES_TO_IDR: Record<CurrencyMode, number> = {
  IDR: 1,
  USD: 16200,
  EUR: 17600,
  SGD: 12100,
};

export let IDR_RATE = FALLBACK_IDR_RATE;

const CURRENCY_STORAGE_KEY = 'riskcart_currency';
const RATE_STORAGE_KEY = 'riskcart_exchange_rate';
const MULTI_RATES_STORAGE_KEY = 'riskcart_multi_exchange_rates';
const RATE_UPDATED_KEY = 'riskcart_exchange_rate_updated_at';

type CurrencyListener = (currency: CurrencyMode, exchangeRate: number) => void;
const listeners = new Set<CurrencyListener>();

const EXPLICIT_CURRENCY_PREF_KEY = 'riskcart_explicit_currency_v2';

function readInitialCurrency(): CurrencyMode {
  try {
    if (typeof window !== 'undefined') {
      const explicitChoice = localStorage.getItem(EXPLICIT_CURRENCY_PREF_KEY);
      if (isSupportedCurrency(explicitChoice)) return explicitChoice;
      const savedCurr = localStorage.getItem(CURRENCY_STORAGE_KEY);
      if (isSupportedCurrency(savedCurr)) return savedCurr;
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

function readInitialMultiRates(): Record<CurrencyMode, number> {
  const base = { ...FALLBACK_RATES_TO_IDR };
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(MULTI_RATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(Number(parsed?.USD)) && Number(parsed.USD) >= 10000) {
          base.USD = Number(parsed.USD);
        }
        if (Number.isFinite(Number(parsed?.EUR)) && Number(parsed.EUR) >= 10000) {
          base.EUR = Number(parsed.EUR);
        }
        if (Number.isFinite(Number(parsed?.SGD)) && Number(parsed.SGD) >= 8000) {
          base.SGD = Number(parsed.SGD);
        }
      }
    }
  } catch {
    // ignore
  }
  return base;
}

let currentCurrencyMode: CurrencyMode = readInitialCurrency();
let currentExchangeRate: number = readInitialRate();
let currentRatesToIdr: Record<CurrencyMode, number> = readInitialMultiRates();

export function getCurrencyMode(): CurrencyMode {
  return currentCurrencyMode;
}

export function getExchangeRate(): number {
  return currentExchangeRate || FALLBACK_IDR_RATE;
}

export function getCurrencyRatesToIdr(): Record<CurrencyMode, number> {
  return {
    ...currentRatesToIdr,
    IDR: 1,
    USD: currentExchangeRate || currentRatesToIdr.USD || FALLBACK_IDR_RATE,
  };
}

export function getRateForCurrency(mode: CurrencyMode, customUsdRate?: number): number {
  if (mode === 'IDR') return 1;
  const usdRate = customUsdRate && customUsdRate > 0 ? customUsdRate : getExchangeRate();
  if (mode === 'USD') return usdRate;
  if (mode === 'EUR') {
    const ratio = (currentRatesToIdr.EUR || FALLBACK_RATES_TO_IDR.EUR) / (currentRatesToIdr.USD || FALLBACK_IDR_RATE);
    return Math.round(usdRate * ratio * 100) / 100;
  }
  if (mode === 'SGD') {
    const ratio = (currentRatesToIdr.SGD || FALLBACK_RATES_TO_IDR.SGD) / (currentRatesToIdr.USD || FALLBACK_IDR_RATE);
    return Math.round(usdRate * ratio * 100) / 100;
  }
  return usdRate;
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
  if (!isSupportedCurrency(mode)) return;
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
  currentRatesToIdr.USD = roundedRate;
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
 * Fetches live USD, EUR, and SGD -> IDR exchange rates from free public APIs with automatic fallback.
 */
export async function fetchLiveExchangeRate(): Promise<{
  rate: number;
  ratesToIdr: Record<CurrencyMode, number>;
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
          const eurPerUsd = Number(data?.rates?.EUR);
          const sgdPerUsd = Number(data?.rates?.SGD);
          const eurToIdr =
            Number.isFinite(eurPerUsd) && eurPerUsd > 0.3 && eurPerUsd < 2
              ? Math.round((idrRate / eurPerUsd) * 100) / 100
              : Math.round(idrRate * (FALLBACK_RATES_TO_IDR.EUR / FALLBACK_IDR_RATE));
          const sgdToIdr =
            Number.isFinite(sgdPerUsd) && sgdPerUsd > 0.5 && sgdPerUsd < 3
              ? Math.round((idrRate / sgdPerUsd) * 100) / 100
              : Math.round(idrRate * (FALLBACK_RATES_TO_IDR.SGD / FALLBACK_IDR_RATE));

          currentRatesToIdr = {
            IDR: 1,
            USD: Math.round(idrRate * 100) / 100,
            EUR: eurToIdr,
            SGD: sgdToIdr,
          };
          try {
            if (typeof window !== 'undefined') {
              localStorage.setItem(MULTI_RATES_STORAGE_KEY, JSON.stringify(currentRatesToIdr));
            }
          } catch {
            // ignore
          }
          const nowIso = new Date().toISOString();
          setExchangeRateGlobal(idrRate, nowIso);
          return {
            rate: Math.round(idrRate * 100) / 100,
            ratesToIdr: currentRatesToIdr,
            isLive: true,
            updatedAt: nowIso,
          };
        }
      }
    } catch {
      // try next endpoint or fallback
    }
  }

  const fallbackRate = getExchangeRate() || FALLBACK_IDR_RATE;
  const fallbackIso = getExchangeRateUpdatedAt() || new Date().toISOString();
  setExchangeRateGlobal(fallbackRate, fallbackIso);
  return {
    rate: fallbackRate,
    ratesToIdr: getCurrencyRatesToIdr(),
    isLive: false,
    updatedAt: fallbackIso,
  };
}

export function toIdr(v: number, baseCurrency: CurrencyMode = 'IDR', customRate?: number): number {
  const num = Number(v) || 0;
  if (baseCurrency === 'IDR') return Math.round(num);
  const rate = getRateForCurrency(baseCurrency, customRate);
  return Math.round(num * rate);
}

export function toUsd(v: number, baseCurrency: CurrencyMode = 'IDR', customRate?: number): number {
  const num = Number(v) || 0;
  if (baseCurrency === 'USD') return num;
  const idrVal = toIdr(num, baseCurrency, customRate);
  const usdRate = getRateForCurrency('USD', customRate);
  return idrVal / usdRate;
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
 * Formats a monetary value according to the active (or specified) currency ('IDR' | 'USD' | 'EUR' | 'SGD')
 * and live exchange rates.
 */
export function fmtMoney(
  v: number,
  mode?: CurrencyMode,
  baseCurrency: CurrencyMode = 'IDR',
  customRate?: number
): string {
  const num = Number(v) || 0;
  const activeMode: CurrencyMode = mode && isSupportedCurrency(mode) ? mode : getCurrencyMode();
  const idrVal = baseCurrency === 'IDR' ? num : num * getRateForCurrency(baseCurrency, customRate);

  if (activeMode === 'USD') {
    const usdVal = idrVal / getRateForCurrency('USD', customRate);
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

  if (activeMode === 'EUR') {
    const eurVal = idrVal / getRateForCurrency('EUR', customRate);
    if (Math.abs(eurVal) < 0.0001) {
      return '€0.00';
    }
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(eurVal);
  }

  if (activeMode === 'SGD') {
    const sgdVal = idrVal / getRateForCurrency('SGD', customRate);
    if (Math.abs(sgdVal) < 0.0001) {
      return 'S$0.00';
    }
    const sign = sgdVal < 0 ? '-' : '';
    const formatted = Math.abs(sgdVal).toLocaleString('en-SG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${sign}S$${formatted}`;
  }

  const roundedIdr = Math.round(idrVal);
  const formattedIdr = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  })
    .format(Math.abs(roundedIdr))
    .replace(/\u00a0/g, ' ');

  if (roundedIdr < 0) {
    return `-${formattedIdr}`;
  }
  return formattedIdr;
}

export const formatMoney = fmtMoney;
export const formatCurrencyValue = fmtMoney;
export const formatCurrency = fmtMoney;

/**
 * Formats compact monetary values for chart axes and compact badges (e.g. Rp 1,5 Jt / $1.5K / €1.5K / S$1.5K).
 */
export function formatCompactMoney(
  v: number,
  mode?: CurrencyMode,
  baseCurrency: CurrencyMode = 'IDR',
  customRate?: number
): string {
  const num = Number(v) || 0;
  const activeMode: CurrencyMode = mode && isSupportedCurrency(mode) ? mode : getCurrencyMode();
  const idrVal = baseCurrency === 'IDR' ? num : num * getRateForCurrency(baseCurrency, customRate);

  if (activeMode !== 'IDR') {
    const sym = activeMode === 'EUR' ? '€' : activeMode === 'SGD' ? 'S$' : '$';
    const foreignVal = idrVal / getRateForCurrency(activeMode, customRate);
    const absVal = Math.abs(foreignVal);
    if (absVal < 0.0001) return `${sym}0.00`;
    const sign = foreignVal < 0 ? '-' : '';
    if (absVal >= 1_000_000) {
      return `${sign}${sym}${(absVal / 1_000_000).toFixed(1)}M`;
    }
    if (absVal >= 1_000) {
      return `${sign}${sym}${(absVal / 1_000).toFixed(1)}K`;
    }
    if (absVal >= 100) {
      return `${sign}${sym}${absVal.toFixed(0)}`;
    }
    return `${sign}${sym}${absVal.toFixed(2)}`;
  }

  const roundedIdr = Math.round(idrVal);
  const absIdr = Math.abs(roundedIdr);
  if (absIdr === 0) return 'Rp 0';
  const sign = roundedIdr < 0 ? '-' : '';
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
 * into the active foreign currency (USD $, EUR €, SGD S$), using the live exchange rate.
 */
export function convertDomCurrencyInText(
  text: string,
  mode?: CurrencyMode,
  customRate?: number
): string {
  if (!text || typeof text !== 'string') return text;
  const activeMode = mode && isSupportedCurrency(mode) ? mode : getCurrencyMode();
  if (activeMode === 'IDR') return text;
  if (!/Rp/i.test(text)) return text;

  const rate = customRate && customRate > 0 ? customRate : getExchangeRate();

  return text.replace(
    DOM_RP_REGEX,
    (fullMatch, signPrefix: string, numStr: string, suffix?: string) => {
      const parsedIdr = parseIdrStringValue(numStr, suffix);
      if (parsedIdr === null || !Number.isFinite(parsedIdr)) return fullMatch;

      const trimmedSign = (signPrefix || '').trim();
      const formattedForeign = suffix
        ? formatCompactMoney(parsedIdr, activeMode, 'IDR', rate)
        : fmtMoney(parsedIdr, activeMode, 'IDR', rate);

      if (trimmedSign === '+') {
        const leadingSpace = signPrefix.startsWith(' ') ? ' ' : '';
        return `${leadingSpace}+${formattedForeign}`;
      }
      if (trimmedSign === '-') {
        const leadingSpace = signPrefix.startsWith(' ') ? ' ' : '';
        return `${leadingSpace}-${formattedForeign.replace(/^-/, '')}`;
      }
      return `${signPrefix || ''}${formattedForeign}`;
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

