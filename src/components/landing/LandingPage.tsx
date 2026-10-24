import React from 'react';
import {
  Boxes,
  Smartphone,
  Store,
  Gauge,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Lock,
  Flame,
} from 'lucide-react';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { useAppNavigation } from '../../router';

interface LandingPageProps {
  onNavigate: (tab: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  const { navigateToPath } = useAppNavigation();
  return (
    <div className="space-y-16 py-4">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-[#110f0a]/95 border border-amber-500/40 p-8 sm:p-14 text-center shadow-[0_0_24px_rgba(245,158,11,0.14)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.14),_transparent_55%)] pointer-events-none" />

        {/* Competition Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/45 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          Executive Retail Control &amp; AI Intelligence Suite
        </div>

        <h1 className="text-4xl sm:text-6xl font-black text-amber-50 tracking-tight max-w-4xl mx-auto leading-tight">
          Next-Gen <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#fde68a] via-[#fbbf24] to-[#d97706]">Anti-Fraud POS</span> &amp; Client PWA
        </h1>

        <p className="mt-5 text-base sm:text-lg text-amber-100/75 max-w-2xl mx-auto leading-relaxed">
          RiskCart empowers modern retailers with real-time transaction intelligence, high-precision GPS geofencing, automatic carton-to-unit stock conversions, and preventive AI anomaly detection.
        </p>

        {/* Action Button Strip */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => navigateToPath('/dashboard')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-sm border border-amber-300/60 transition shadow-[0_0_18px_rgba(245,158,11,0.38)] cursor-pointer"
          >
            <Store className="w-4 h-4 text-black" />
            Launch POS Admin Terminal
            <ArrowRight className="w-4 h-4 text-black" />
          </button>

          <button
            onClick={() => navigateToPath('/client-pwa')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#18140c] hover:bg-amber-500/20 text-amber-200 font-bold text-sm border border-amber-500/45 transition cursor-pointer"
          >
            <Smartphone className="w-4 h-4 text-amber-400" />
            Open Client PWA (Mobile)
          </button>

          <PWAInstallButton />
        </div>

        {/* Trust Badges */}
        <div className="mt-12 pt-8 border-t border-amber-500/25 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-amber-100/70 font-medium">
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Zero False-Positive Shield
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Sub-500m Geofence Telemetry
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Dus/Carton Wholesale Logic
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Multi-Tenant RBAC Ready
          </div>
        </div>
      </div>

      {/* 3 Core Architecture Pillars */}
      <div>
        <div className="text-center max-w-xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-amber-50 tracking-tight">
            Integrated Retail Defense Architecture
          </h2>
          <p className="text-xs sm:text-sm text-amber-200/65 mt-2">
            Built from the ground up with Firestore persistence, edge telemetry, and real-time operational control.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: POS Admin & Anti-Fraud */}
          <div
            onClick={() => navigateToPath('/dashboard/pos')}
            className="group cursor-pointer bg-[#110f0a]/95 border border-amber-500/40 hover:border-amber-400/80 rounded-2xl p-6 transition shadow-[0_0_18px_rgba(245,158,11,0.12)] space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 group-hover:scale-105 transition">
              <Store className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-amber-50 group-hover:text-amber-400 transition">
              Real-Time POS Cashier Hub
            </h3>
            <p className="text-xs text-amber-100/70 leading-relaxed">
              Reactive live transaction feed listening to Firestore snapshots. Instant visual fraud badges, cashier approval gates, and forensic trace inspection.
            </p>
            <span className="text-xs font-semibold text-amber-400 flex items-center gap-1">
              Explore Live Feed <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>

          {/* Card 2: Financial Asset Dashboard & Gauge */}
          <div
            onClick={() => onNavigate('assets')}
            className="group cursor-pointer bg-[#110f0a]/95 border border-amber-500/40 hover:border-amber-400/80 rounded-2xl p-6 transition shadow-[0_0_18px_rgba(245,158,11,0.12)] space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition">
              <Gauge className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-amber-50 group-hover:text-emerald-400 transition">
              Financial Asset Gauge &amp; Inventory
            </h3>
            <p className="text-xs text-amber-100/70 leading-relaxed">
              Dynamic SVG financial risk gauge meter calculating Value at Risk (VAR), liquid inventory capital, gross margins, and wholesale carton allocation.
            </p>
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
              View Asset Valuation <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>

          {/* Card 3: Client PWA & Typo-Tolerant AI */}
          <div
            onClick={() => onNavigate('client_pwa')}
            className="group cursor-pointer bg-[#110f0a]/95 border border-amber-500/40 hover:border-amber-400/80 rounded-2xl p-6 transition shadow-[0_0_18px_rgba(245,158,11,0.12)] space-y-4"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 group-hover:scale-105 transition">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-amber-50 group-hover:text-amber-400 transition">
              Client PWA Marketplace &amp; NLP
            </h3>
            <p className="text-xs text-amber-100/70 leading-relaxed">
              Mobile web marketplace with conversational AI ordering resistant to typos &amp; slang, high-precision GPS geofencing, and WhatsApp order verification.
            </p>
            <span className="text-xs font-semibold text-amber-400 flex items-center gap-1">
              Open Client App <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </div>

      {/* Feature Highlight Matrix */}
      <div className="bg-[#110f0a]/95 border border-amber-500/40 rounded-3xl p-8 sm:p-12 shadow-[0_0_24px_rgba(245,158,11,0.14)]">
        <h2 className="text-2xl font-bold text-amber-50 mb-8 text-center">
          Engineered for Operational Excellence
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
          <div className="p-4 rounded-xl bg-[#0b0906] border border-amber-500/35 space-y-2">
            <div className="text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Boxes className="w-4 h-4" />
              Carton-to-Unit Math
            </div>
            <p className="text-amber-100/70 leading-relaxed">
              1-click &quot;Unpack Dus&quot; action breaks wholesale packages into retail units without inventory accounting errors.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#0b0906] border border-amber-500/35 space-y-2">
            <div className="text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Flame className="w-4 h-4" />
              Mock GPS Interceptor
            </div>
            <p className="text-amber-100/70 leading-relaxed">
              Detects 0.00m hardware precision anomalies and emulator coordinate jumps before transactions are authorized.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#0b0906] border border-amber-500/35 space-y-2">
            <div className="text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              AI Restock Advisor
            </div>
            <p className="text-amber-100/70 leading-relaxed">
              Forecasts stockout velocity and recommends purchase orders grouped strictly in whole carton multiples.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#0b0906] border border-amber-500/35 space-y-2">
            <div className="text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-4 h-4" />
              Multi-Tenant RBAC
            </div>
            <p className="text-amber-100/70 leading-relaxed">
              Every single collection has storeId embedded and validated by granular Role-Based Access Control rules.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
