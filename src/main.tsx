import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/lightTheme.css';
import { VisitorTracker } from './services/visitorTracker';
import { startPosSettingsSync } from './services/posRuntime';

// Bersihkan cache localStorage produk & transaksi saat inisialisasi agar aplikasi mulai bersih tanpa sisa cache dummy
function clearDataCacheOnInit(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('riskcart_cache_') ||
        k.startsWith('riskcart_fs_') ||
        k.startsWith('riskcart_demo_') ||
        k === 'riskcart_locked_cart' ||
        k === 'riskcart_categories' ||
        k === 'riskcart_brands' ||
        k === 'pos_categories' ||
        k === 'pos_brands'
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    });
  } catch {}
}

clearDataCacheOnInit();

// Sinkron pengaturan POS (stok minimum, zona waktu, format SKU, dll.) untuk seluruh modul
startPosSettingsSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VisitorTracker />
    <App />
  </StrictMode>,
);

