import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { doc, collection, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import {
  TRANSLATION_DICTIONARY,
  translateTextToEnglish,
  translateTextToIndonesian,
  translateCategoryName,
  translatePackageUnit,
  translateVariantType,
  translateOrderStatus,
  setLiveTextOverrides,
  applyLiveTextOverride,
  UITextOverrideRule,
  restoreBrandTerms,
  sanitizeGoogleTranslateDOM,
  startPosGlossarySanitizer,
} from '../utils/i18nEngine';
import {
  CurrencyMode,
  isSupportedCurrency,
  fmtMoney,
  formatCompactMoney,
  FALLBACK_IDR_RATE,
  getCurrencyMode,
  getExchangeRate,
  getExchangeRateUpdatedAt,
  setCurrencyModeGlobal,
  setExchangeRateGlobal,
  subscribeCurrency,
  fetchLiveExchangeRate,
} from '../utils/money';

export type Language = 'en' | 'id';
export type SupportedTranslateLang =
  | 'id'
  | 'en'
  | 'ms'
  | 'zh-CN'
  | 'ja'
  | 'ko'
  | 'ar'
  | 'th'
  | 'es';
export type { CurrencyMode };

export const USD_TO_IDR_RATE = FALLBACK_IDR_RATE;
export const LANGUAGE_STORAGE_KEY = 'riskcart_app_language';
const LEGACY_LANGUAGE_STORAGE_KEY = 'riskcart-language';
const EXPLICIT_LANG_PREF_KEY = 'riskcart_explicit_lang_v3';
const GOOGLE_LANG_CODE_KEY = 'riskcart_google_lang_code';

export function normalizeGoogleLangCode(raw: string): SupportedTranslateLang {
  const clean = String(raw || 'en').trim();
  const lower = clean.toLowerCase();
  if (lower === 'zh-cn' || lower === 'zh' || lower === 'cn') return 'zh-CN';
  if (lower === 'id' || lower === 'in') return 'id';
  if (lower === 'ja' || lower === 'jp') return 'ja';
  if (lower === 'ko' || lower === 'kr') return 'ko';
  if (lower === 'ar') return 'ar';
  if (lower === 'ms' || lower === 'my') return 'ms';
  if (lower === 'th') return 'th';
  if (lower === 'es') return 'es';
  return 'en';
}

export function clearGoogleTranslateCookie() {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    if (typeof window !== 'undefined' && window.location.hostname) {
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname}; SameSite=Lax`;
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.${window.location.hostname}; SameSite=Lax`;
    }
  } catch {
    // ignore cookie errors
  }
}

export function applyGoogleTranslateCookie(targetLang: string) {
  if (typeof document === 'undefined') return;
  try {
    const langCode = normalizeGoogleLangCode(targetLang);
    document.documentElement.lang = langCode;

    // Saat Bahasa Indonesia ('id') dipilih, utamakan kamus internal POS Indonesia yang baku
    // dan bersihkan intervensi Google Translate agar istilah & data asli tetap bersih.
    if (langCode === 'id') {
      clearGoogleTranslateCookie();
      const combos = document.querySelectorAll('.goog-te-combo') as NodeListOf<HTMLSelectElement>;
      combos.forEach((combo) => {
        if (combo.value !== '' && combo.value !== 'id') {
          combo.value = 'id';
          combo.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      setTimeout(() => {
        sanitizeGoogleTranslateDOM();
      }, 60);
      setTimeout(() => {
        sanitizeGoogleTranslateDOM();
      }, 350);
      return;
    }

    const autoVal = `/auto/${langCode}`;
    document.cookie = `googtrans=${autoVal}; path=/; SameSite=Lax`;
    if (typeof window !== 'undefined' && window.location.hostname) {
      document.cookie = `googtrans=${autoVal}; path=/; domain=${window.location.hostname}; SameSite=Lax`;
    }

    const triggerCombo = () => {
      const combos = document.querySelectorAll('.goog-te-combo') as NodeListOf<HTMLSelectElement>;
      if (combos.length > 0) {
        combos.forEach((combo) => {
          const hasOption = Array.from(combo.options).some((opt) => opt.value === langCode);
          if (!hasOption) {
            const opt = document.createElement('option');
            opt.value = langCode;
            opt.text = langCode;
            combo.add(opt);
          }
          if (combo.value !== langCode) {
            combo.value = langCode;
            combo.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        return true;
      }
      return false;
    };

    if (!triggerCombo()) {
      if (
        typeof window !== 'undefined' &&
        typeof (window as any).googleTranslateElementInit === 'function'
      ) {
        try {
          (window as any).googleTranslateElementInit();
        } catch {}
      }
      setTimeout(triggerCombo, 300);
      setTimeout(triggerCombo, 900);
    }
  } catch {
    // ignore cookie errors
  }
}

interface LanguageContextType {
  language: Language;
  activeLangCode: SupportedTranslateLang;
  setLanguage: (lang: Language | SupportedTranslateLang | 'EN' | 'ID' | string) => void;
  toggleLanguage: () => void;
  currencyMode: CurrencyMode;
  currency: CurrencyMode;
  setCurrencyMode: (curr: CurrencyMode) => void;
  setCurrency: (curr: CurrencyMode) => void;
  toggleCurrency: () => void;
  exchangeRate: number;
  setExchangeRate: (rate: number) => void;
  isRateLive: boolean;
  lastRateUpdated: string | null;
  detectedCountry: string;
  refreshExchangeRate: () => Promise<void>;
  formatCurrency: (amount: number, baseCurrency?: CurrencyMode) => string;
  formatCompactCurrency: (amount: number, baseCurrency?: CurrencyMode) => string;
  tr: (en: string, id?: string) => string;
  t: (key: string, defaultText?: string) => string;
  translateCategory: (category: string) => string;
  translateUnit: (unit: string) => string;
  translateVariant: (variantType: string) => string;
  translateStatus: (status: string) => string;
  translateText: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  activeLangCode: 'en',
  setLanguage: () => {},
  toggleLanguage: () => {},
  currencyMode: 'IDR',
  currency: 'IDR',
  setCurrencyMode: () => {},
  setCurrency: () => {},
  toggleCurrency: () => {},
  exchangeRate: FALLBACK_IDR_RATE,
  setExchangeRate: () => {},
  isRateLive: false,
  lastRateUpdated: null,
  detectedCountry: 'EN',
  refreshExchangeRate: async () => {},
  formatCurrency: (v: number) => fmtMoney(v),
  formatCompactCurrency: (v: number) => formatCompactMoney(v),
  tr: (en: string, id?: string): string => en || id || '',
  t: (key: string, defaultText?: string) => defaultText || key,
  translateCategory: (cat: string) => cat,
  translateUnit: (unit: string) => unit,
  translateVariant: (vt: string) => vt,
  translateStatus: (status: string) => status,
  translateText: (text: string) => text,
});

function resolveInitialLocaleState(): {
  lang: Language;
  langCode: SupportedTranslateLang;
  currency: CurrencyMode;
} {
  try {
    if (typeof window !== 'undefined') {
      const savedAppLang =
        localStorage.getItem(LANGUAGE_STORAGE_KEY) ||
        localStorage.getItem(GOOGLE_LANG_CODE_KEY) ||
        localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
      const explicitChoice = localStorage.getItem(EXPLICIT_LANG_PREF_KEY);
      if (savedAppLang) {
        const code = normalizeGoogleLangCode(savedAppLang);
        const baseLang: Language = code === 'id' || code === 'ms' ? 'id' : 'en';
        applyGoogleTranslateCookie(code);
        return { lang: baseLang, langCode: code, currency: getCurrencyMode() };
      }
      if (explicitChoice === 'id') {
        applyGoogleTranslateCookie('id');
        return { lang: 'id', langCode: 'id', currency: getCurrencyMode() };
      }
      // Default to Indonesian ('id') or English ('en') cleanly
      localStorage.setItem(LANGUAGE_STORAGE_KEY, 'id');
      localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, 'id');
      localStorage.setItem(GOOGLE_LANG_CODE_KEY, 'id');
      applyGoogleTranslateCookie('id');
      return { lang: 'id', langCode: 'id', currency: getCurrencyMode() };
    }
  } catch {
    // ignore storage errors
  }
  return { lang: 'id', langCode: 'id', currency: 'IDR' };
}

async function persistCurrencyToFirestore(
  currency: CurrencyMode,
  exchangeRate: number,
  isLive?: boolean
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, any> = {
    currency,
    currencyMode: currency,
    exchangeRate,
    usdToIdrRate: exchangeRate,
    updatedAt: nowIso,
  };
  if (typeof isLive === 'boolean') {
    payload.isLive = isLive;
  }
  try {
    await Promise.all([
      setDoc(doc(db, 'settings', 'currency'), payload, { merge: true }),
      setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'settings', 'currency'), payload, { merge: true }),
    ]);
  } catch {
    // ignore offline/permission write notices
  }
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialLocale = useRef(resolveInitialLocaleState());
  const [language, setLanguageState] = useState<Language>(initialLocale.current.lang);
  const [activeLangCode, setActiveLangCode] = useState<SupportedTranslateLang>(
    initialLocale.current.langCode
  );
  const [currencyMode, setCurrencyModeState] = useState<CurrencyMode>(
    initialLocale.current.currency
  );
  const [detectedCountry] = useState<string>('EN');
  const [exchangeRate, setExchangeRateState] = useState<number>(getExchangeRate);
  const [isRateLive, setIsRateLive] = useState<boolean>(false);
  const [lastRateUpdated, setLastRateUpdated] = useState<string | null>(getExchangeRateUpdatedAt);

  const setCurrencyMode = useCallback((curr: CurrencyMode) => {
    if (!isSupportedCurrency(curr)) return;
    setCurrencyModeGlobal(curr);
    setCurrencyModeState(curr);
    void persistCurrencyToFirestore(curr, getExchangeRate());
  }, []);

  const setLanguage = useCallback(
    (rawLang: Language | SupportedTranslateLang | 'EN' | 'ID' | string) => {
      const langCode = normalizeGoogleLangCode(rawLang);
      const normalized: Language = langCode === 'id' || langCode === 'ms' ? 'id' : 'en';

      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, langCode);
        localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, normalized);
        localStorage.setItem(EXPLICIT_LANG_PREF_KEY, normalized);
        localStorage.setItem(GOOGLE_LANG_CODE_KEY, langCode);
      } catch {
        // ignore
      }

      setActiveLangCode(langCode);
      setLanguageState(normalized);
      applyGoogleTranslateCookie(langCode);
    },
    []
  );

  const toggleLanguage = useCallback(() => {
    const nextLang: Language = language === 'id' ? 'en' : 'id';
    setLanguage(nextLang);
  }, [language, setLanguage]);

  const toggleCurrency = useCallback(() => {
    const order: CurrencyMode[] = ['IDR', 'USD', 'EUR', 'SGD'];
    const idx = order.indexOf(currencyMode);
    const nextCurr: CurrencyMode = order[(idx + 1) % order.length];
    setCurrencyMode(nextCurr);
  }, [currencyMode, setCurrencyMode]);

  const setExchangeRate = useCallback((rate: number) => {
    if (!Number.isFinite(rate) || rate < 10000 || rate > 25000) return;
    const nowIso = new Date().toISOString();
    setExchangeRateGlobal(rate, nowIso);
    setExchangeRateState(Math.round(rate * 100) / 100);
    setLastRateUpdated(nowIso);
    void persistCurrencyToFirestore(getCurrencyMode(), rate);
  }, []);

  const refreshExchangeRate = useCallback(async () => {
    const result = await fetchLiveExchangeRate();
    setExchangeRateState(result.rate);
    setIsRateLive(result.isLive);
    setLastRateUpdated(result.updatedAt);
    void persistCurrencyToFirestore(getCurrencyMode(), result.rate, result.isLive);
  }, []);

  // Subscribe to module-level currency/rate updates and cross-tab storage events
  useEffect(() => {
    const unsubLocal = subscribeCurrency((curr, rate) => {
      setCurrencyModeState(curr);
      setExchangeRateState(rate);
      setLastRateUpdated(getExchangeRateUpdatedAt());
    });

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'riskcart_currency' && isSupportedCurrency(e.newValue)) {
        setCurrencyModeGlobal(e.newValue, true);
        setCurrencyModeState(e.newValue);
      } else if (e.key === 'riskcart_exchange_rate' && e.newValue) {
        const parsed = Number(e.newValue);
        if (Number.isFinite(parsed) && parsed >= 10000 && parsed <= 25000) {
          setExchangeRateGlobal(parsed, undefined, true);
          setExchangeRateState(parsed);
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      unsubLocal();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Fetch live USD/IDR rate on mount and sync exchange rate + currencyMode with Firestore `settings/currency`
  useEffect(() => {
    void refreshExchangeRate();

    const unsubFirestore = onSnapshot(
      doc(db, 'settings', 'currency'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const remoteCurr = data?.currencyMode || data?.currency;
        if (isSupportedCurrency(remoteCurr)) {
          setCurrencyModeGlobal(remoteCurr, true);
          setCurrencyModeState(remoteCurr);
        }
        const remoteRate = Number(data?.exchangeRate ?? data?.usdToIdrRate);
        if (Number.isFinite(remoteRate) && remoteRate >= 10000 && remoteRate <= 25000) {
          setExchangeRateGlobal(remoteRate, data?.updatedAt, true);
          setExchangeRateState(Math.round(remoteRate * 100) / 100);
          if (data?.updatedAt) setLastRateUpdated(String(data.updatedAt));
          if (typeof data?.isLive === 'boolean') setIsRateLive(data.isLive);
        }
      },
      () => {
        // ignore offline listener errors
      }
    );

    return () => {
      unsubFirestore();
    };
  }, [refreshExchangeRate]);

  const formatCurrency = useCallback(
    (amount: number, baseCurrency: CurrencyMode = 'IDR'): string => {
      return fmtMoney(amount, currencyMode, baseCurrency, exchangeRate);
    },
    [currencyMode, exchangeRate]
  );

  const formatCompactCurrency = useCallback(
    (amount: number, baseCurrency: CurrencyMode = 'IDR'): string => {
      return formatCompactMoney(amount, currencyMode, baseCurrency, exchangeRate);
    },
    [currencyMode, exchangeRate]
  );

  const [overrideVersion, setOverrideVersion] = useState<number>(0);

  // Real-time Firestore listener for AI System Architect `ui_text_overrides` & `ui_layout_overrides`
  useEffect(() => {
    const unsubText = onSnapshot(
      collection(db, 'ui_text_overrides'),
      (snap) => {
        const rules: UITextOverrideRule[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setLiveTextOverrides(rules);
        setOverrideVersion((v) => v + 1);
      },
      () => {}
    );

    const unsubLayout = onSnapshot(
      collection(db, 'ui_layout_overrides'),
      (snap) => {
        if (typeof document === 'undefined') return;
        const rules = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((r) => r.enabled !== false);

        let styleEl = document.getElementById(
          'riskcart-ai-layout-overrides'
        ) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'riskcart-ai-layout-overrides';
          document.head.appendChild(styleEl);
        }

        const currentPath = window.location.pathname || '/dashboard';
        const activeCssBlocks: string[] = [];
        for (const r of rules) {
          const routeMatch =
            !r.targetRoute ||
            r.targetRoute === 'ALL' ||
            r.targetRoute === '*' ||
            currentPath.toLowerCase().includes(String(r.targetRoute).toLowerCase());
          if (!routeMatch) continue;
          if (r.cssRules && typeof r.cssRules === 'string') {
            activeCssBlocks.push(`/* Rule: ${r.title || r.id} */\n${r.cssRules}`);
          }
          if (r.hideSelector && typeof r.hideSelector === 'string') {
            activeCssBlocks.push(`${r.hideSelector} { display: none !important; }`);
          }
        }
        styleEl.textContent = activeCssBlocks.join('\n\n');
      },
      () => {}
    );

    return () => {
      unsubText();
      unsubLayout();
    };
  }, []);

  const tr = (en: string, id?: string): string => {
    const enText = en !== undefined ? en : '';
    const idText = id !== undefined && id !== '' ? id : enText;
    if (language === 'id') {
      const baseId = idText !== enText ? idText : translateTextToIndonesian(enText);
      return restoreBrandTerms(applyLiveTextOverride(baseId, 'id'));
    }
    const baseEn = enText !== idText ? enText : translateTextToEnglish(idText);
    return restoreBrandTerms(applyLiveTextOverride(baseEn, 'en'));
  };

  const t = (key: string, defaultText?: string): string => {
    const dict = TRANSLATION_DICTIONARY[language];
    if (dict && dict[key] !== undefined) {
      return restoreBrandTerms(applyLiveTextOverride(dict[key], language));
    }
    if (defaultText !== undefined) {
      const base =
        language === 'en'
          ? translateTextToEnglish(defaultText)
          : translateTextToIndonesian(defaultText);
      return restoreBrandTerms(applyLiveTextOverride(base, language));
    }
    return restoreBrandTerms(applyLiveTextOverride(key, language));
  };

  const translateCategory = (category: string): string =>
    translateCategoryName(category, language);

  const translateUnit = (unit: string): string => translatePackageUnit(unit, language);

  const translateVariant = (variantType: string): string =>
    translateVariantType(variantType, language);

  const translateStatus = (status: string): string => translateOrderStatus(status, language);

  const translateText = (text: string): string =>
    language === 'en' ? translateTextToEnglish(text) : translateTextToIndonesian(text);

  // Set HTML document lang attribute and start POS glossary sanitizer
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = activeLangCode;
      sanitizeGoogleTranslateDOM();
    }
  }, [activeLangCode, language]);

  useEffect(() => {
    const stopSanitizer = startPosGlossarySanitizer();
    return () => {
      stopSanitizer();
    };
  }, []);

  return (
    <LanguageContext.Provider
      value={{
        language,
        activeLangCode,
        setLanguage,
        toggleLanguage,
        currencyMode,
        currency: currencyMode,
        setCurrencyMode,
        setCurrency: setCurrencyMode,
        toggleCurrency,
        exchangeRate,
        setExchangeRate,
        isRateLive,
        lastRateUpdated,
        detectedCountry,
        refreshExchangeRate,
        formatCurrency,
        formatCompactCurrency,
        tr,
        t,
        translateCategory,
        translateUnit,
        translateVariant,
        translateStatus,
        translateText,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
