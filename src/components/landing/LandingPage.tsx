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
          Executive Point Of Sale With AI Intelligence Suite
        </div>

        <h1 className="text-4xl sm:text-6xl font-black text-amber-50 tracking-tight max-w-4xl mx-auto leading-tight">
          <span className="block">RiskCart</span>
          <span className="block text-2xl sm:text-4xl mt-2 text-transparent bg-clip-text bg-gradient-to-r from-[#fde68a] via-[#fbbf24] to-[#d97706]">
            12 AI Agents Working to Protect Your Business
          </span>
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
            onClick={() => navigateToPath('/dashboard/layout-table')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#18140c] hover:bg-amber-500/20 text-amber-200 font-bold text-sm border border-amber-500/45 transition cursor-pointer"
          >
            <Boxes className="w-4 h-4 text-amber-400" />
            Layout Table (Denah Meja)
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
            Retail Business
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Cafe / Restaurant
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Bakery and Pastry
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Coffee Shop And Other
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

      {/* Application Flow Matrix */}
      <div className="bg-[#110f0a]/95 border border-amber-500/40 rounded-3xl p-8 sm:p-12 shadow-[0_0_24px_rgba(245,158,11,0.14)]">
        <h2 className="text-2xl font-bold text-amber-50 mb-8 text-center">
          Application Flow
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
          {/* 1. Waiter */}
          <div
            onClick={() => navigateToPath('/waiter')}
            className="group cursor-pointer p-5 rounded-xl bg-[#0b0906] border border-amber-500/35 hover:border-emerald-400/70 transition flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5 text-sm">
                <Boxes className="w-4 h-4" />
                Waiter
              </div>
              <p className="text-amber-100/80 leading-relaxed">
                Application that allows waiters to serve customers, starting with table selection, menu selection, and entering customer information into the database. Once an order is placed, it is automatically sent to both the Kitchen and Cashier departments.
              </p>
            </div>
            <a
              href="/waiter"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateToPath('/waiter');
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 group-hover:text-emerald-300 pt-2 border-t border-amber-500/20"
            >
              <span>Explore Life</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* 2. Kitchen */}
          <div
            onClick={() => navigateToPath('/kitchen')}
            className="group cursor-pointer p-5 rounded-xl bg-[#0b0906] border border-amber-500/35 hover:border-rose-400/70 transition flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1.5 text-sm">
                <Flame className="w-4 h-4" />
                Kitchen
              </div>
              <p className="text-amber-100/80 leading-relaxed">
                Application that displays the order processing pipeline in real time, from incoming orders to preparation progress and finally marking orders as ready to be served to customers.
              </p>
            </div>
            <a
              href="/kitchen"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateToPath('/kitchen');
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-400 group-hover:text-rose-300 pt-2 border-t border-amber-500/20"
            >
              <span>Explore Life</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* 3. Cashier */}
          <div
            onClick={() => navigateToPath('/pos')}
            className="group cursor-pointer p-5 rounded-xl bg-[#0b0906] border border-amber-500/35 hover:border-amber-400/80 transition flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5 text-sm">
                <Sparkles className="w-4 h-4" />
                Cashier
              </div>
              <p className="text-amber-100/80 leading-relaxed">
                A POS Cashier application that processes payments for both dine-in customers and walk-in takeaway customers.
              </p>
            </div>
            <a
              href="/pos"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateToPath('/pos');
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 group-hover:text-amber-300 pt-2 border-t border-amber-500/20"
            >
              <span>Explore Life</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* 4. Real-Time Control */}
          <div
            onClick={() => navigateToPath('/dashboard')}
            className="group cursor-pointer p-5 rounded-xl bg-[#0b0906] border border-amber-500/35 hover:border-amber-300/80 transition flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1.5 text-sm">
                <Lock className="w-4 h-4" />
                Real-Time Control
              </div>
              <p className="text-amber-100/80 leading-relaxed">
                A centralized dashboard that allows administrators to monitor all transactions in real time. Every transaction, order status, kitchen progress, and payment update is synchronized and displayed instantly.
              </p>
            </div>
            <a
              href="/dashboard"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateToPath('/dashboard');
              }}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 group-hover:text-amber-200 pt-2 border-t border-amber-500/20"
            >
              <span>Explore Life</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
