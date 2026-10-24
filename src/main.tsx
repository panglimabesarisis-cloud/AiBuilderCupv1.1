import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { VisitorTracker } from './services/visitorTracker';
import { startPosSettingsSync } from './services/posRuntime';

// Sinkron pengaturan POS (stok minimum, zona waktu, format SKU, dll.) untuk seluruh modul
startPosSettingsSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VisitorTracker />
    <App />
  </StrictMode>,
);
