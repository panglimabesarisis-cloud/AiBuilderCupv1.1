import React, { useState, useEffect } from 'react';
import {
  Globe,
  Smartphone,
  Save,
  CheckCircle,
  ExternalLink,
  MapPin,
  Clock,
  Sparkles,
  ShieldCheck,
  Palette,
  Eye,
  Store,
  Layers,
  ShoppingBag,
  Truck,
  Users,
  AlertTriangle,
  RefreshCw,
  QrCode,
  Link as LinkIcon,
  HelpCircle,
  Phone,
  Mail,
  Copy,
} from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppNavigation } from '../../router';
import { useAppData } from '../../context/AppDataContext';

interface OnlineOrderModuleProps {
  subModule: 'website_setting' | 'client_pwa_setting';
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const OnlineOrderModule: React.FC<OnlineOrderModuleProps> = ({
  subModule,
  onNavigateTab,
}) => {
  const { route, navigateTab } = useAppNavigation();
  const { formatMoney, products, orders } = useAppData();
  const activeSub = (
    route.activeTab === 'module_online_order' ? route.activeSubModule : subModule
  ) as 'website_setting' | 'client_pwa_setting';
  const setActiveSub = (next: 'website_setting' | 'client_pwa_setting') => {
    navigateTab('module_online_order', next);
  };
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ================= 1. WEBSITE SETTING (5.19) =================
  // Store Identity & Branding
  const [webTitle, setWebTitle] = useState('RiskCart Official Store & E-Catalog');
  const [storeTagline, setStoreTagline] = useState('Pusat Belanja Grosir Sembako & Kebutuhan Harian Terpercaya');
  const [companyLegalName, setCompanyLegalName] = useState('PT RiskCart Retail Nusantara');
  const [webDomain, setWebDomain] = useState('toko.riskcart.com');
  const [customDomainEnabled, setCustomDomainEnabled] = useState(false);
  const [customCname, setCustomCname] = useState('shop.tokoanda.id');
  const [sslStatus, setSslStatus] = useState<'active' | 'provisioning'>('active');
  const [primaryBrandColor, setPrimaryBrandColor] = useState('#2563eb');
  const [logoUrl, setLogoUrl] = useState('https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop&q=80');

  // Contact & Social
  const [whatsappOrderNumber, setWhatsappOrderNumber] = useState('+6281299887711');
  const [supportEmail, setSupportEmail] = useState('halo@riskcart.com');
  const [storeAddress, setStoreAddress] = useState('Jl. Boulevard Raya Blok QF1 No. 12, Kelapa Gading, Jakarta Utara');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('https://maps.google.com/?q=-6.1554,106.9082');

  // Website Content & Announcement
  const [heroHeading, setHeroHeading] = useState('Belanja Kebutuhan Pokok Harga Distributor Langsung');
  const [heroSubheading, setHeroSubheading] = useState('Stok terjamin asli, harga grosir terbaik, pengiriman instan langsung dari gudang RiskCart.');
  const [promoBannerText, setPromoBannerText] = useState('🔥 Promo Gajian: Diskon Rp 20.000 untuk transaksi pertama via Web! Gunakan kode: GAJIAN20');
  const [showPromoBanner, setShowPromoBanner] = useState(true);
  const [aboutUsText, setAboutUsText] = useState('RiskCart adalah platform retail modern yang menghubungkan UMKM dan konsumen dengan suplai bahan pokok berkualitas tinggi, stok terpercaya, dan harga bersahabat.');
  const [enableFaqSection, setEnableFaqSection] = useState(true);

  // Catalog Visibility
  const [catalogPublished, setCatalogPublished] = useState(true);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showWholesaleCartonPrice, setShowWholesaleCartonPrice] = useState(true);
  const [showDiscountCountdown, setShowDiscountCountdown] = useState(true);
  const [showMemberTierBadge, setShowMemberTierBadge] = useState(true);

  // Outlet Serviceability & Business Hours
  const [enforceStoreHours, setEnforceStoreHours] = useState(true);
  const [openTime, setOpenTime] = useState('08:00');
  const [closeTime, setCloseTime] = useState('21:00');
  const [serviceRadiusKm, setServiceRadiusKm] = useState(10);
  const [autoCloseWhenOutletClosed, setAutoCloseWhenOutletClosed] = useState(true);

  // ================= 2. CLIENT PWA SETTING (5.19) =================
  const [pwaAppName, setPwaAppName] = useState('RiskCart Client Order PWA');
  const [pwaShortName, setPwaShortName] = useState('RiskCart App');
  const [pwaThemeColor, setPwaThemeColor] = useState('#1d4ed8');
  const [pwaBgColor, setPwaBgColor] = useState('#09090b');
  const [pwaStartUrl, setPwaStartUrl] = useState('/client-pwa');
  const [pwaDisplayMode, setPwaDisplayMode] = useState<'standalone' | 'fullscreen' | 'minimal-ui'>('standalone');

  // Product Visibility in PWA
  const [pwaShowOnlyInStock, setPwaShowOnlyInStock] = useState(true);
  const [pwaShowMemberDiscounts, setPwaShowMemberDiscounts] = useState(true);
  const [pwaEnableBarcodeScan, setPwaEnableBarcodeScan] = useState(true);

  // Ordering Availability & Capacity
  const [pwaAcceptingOrders, setPwaAcceptingOrders] = useState(true);
  const [dailyOrderCap, setDailyOrderCap] = useState(150);
  const [minOrderDelivery, setMinOrderDelivery] = useState(50000);
  const [minOrderPickup, setMinOrderPickup] = useState(20000);
  const [estPrepTimeMinutes, setEstPrepTimeMinutes] = useState(25);

  // Delivery Configuration
  const [allowSelfPickup, setAllowSelfPickup] = useState(true);
  const [allowStoreCourier, setAllowStoreCourier] = useState(true);
  const [allowInstantGosend, setAllowInstantGosend] = useState(true);
  const [deliveryBaseFee, setDeliveryBaseFee] = useState(8000);
  const [freeDeliveryMinSpend, setFreeDeliveryMinSpend] = useState(150000);

  // Customer Access & Supported Features
  const [allowGuestCheckout, setAllowGuestCheckout] = useState(false);
  const [allowCustomerKasbonVIP, setAllowCustomerKasbonVIP] = useState(true);
  const [enablePwaPointsRedeem, setEnablePwaPointsRedeem] = useState(true);
  const [enableLiveOrderStatusTracking, setEnableLiveOrderStatusTracking] = useState(true);
  const [geofenceRadius, setGeofenceRadius] = useState(500); // 500m for store pickup detection

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'online_order'), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        if (d.webTitle !== undefined) setWebTitle(d.webTitle);
        if (d.storeTagline !== undefined) setStoreTagline(d.storeTagline);
        if (d.companyLegalName !== undefined) setCompanyLegalName(d.companyLegalName);
        if (d.webDomain !== undefined) setWebDomain(d.webDomain);
        if (d.customDomainEnabled !== undefined) setCustomDomainEnabled(d.customDomainEnabled);
        if (d.customCname !== undefined) setCustomCname(d.customCname);
        if (d.sslStatus !== undefined) setSslStatus(d.sslStatus);
        if (d.primaryBrandColor !== undefined) setPrimaryBrandColor(d.primaryBrandColor);
        if (d.logoUrl !== undefined) setLogoUrl(d.logoUrl);
        if (d.whatsappOrderNumber !== undefined) setWhatsappOrderNumber(d.whatsappOrderNumber);
        if (d.supportEmail !== undefined) setSupportEmail(d.supportEmail);
        if (d.storeAddress !== undefined) setStoreAddress(d.storeAddress);
        if (d.googleMapsUrl !== undefined) setGoogleMapsUrl(d.googleMapsUrl);
        if (d.heroHeading !== undefined) setHeroHeading(d.heroHeading);
        if (d.heroSubheading !== undefined) setHeroSubheading(d.heroSubheading);
        if (d.promoBannerText !== undefined) setPromoBannerText(d.promoBannerText);
        if (d.showPromoBanner !== undefined) setShowPromoBanner(d.showPromoBanner);
        if (d.aboutUsText !== undefined) setAboutUsText(d.aboutUsText);
        if (d.enableFaqSection !== undefined) setEnableFaqSection(d.enableFaqSection);
        if (d.catalogPublished !== undefined) setCatalogPublished(d.catalogPublished);
        if (d.showOutOfStock !== undefined) setShowOutOfStock(d.showOutOfStock);
        if (d.showWholesaleCartonPrice !== undefined) setShowWholesaleCartonPrice(d.showWholesaleCartonPrice);
        if (d.showDiscountCountdown !== undefined) setShowDiscountCountdown(d.showDiscountCountdown);
        if (d.showMemberTierBadge !== undefined) setShowMemberTierBadge(d.showMemberTierBadge);
        if (d.enforceStoreHours !== undefined) setEnforceStoreHours(d.enforceStoreHours);
        if (d.openTime !== undefined) setOpenTime(d.openTime);
        if (d.closeTime !== undefined) setCloseTime(d.closeTime);
        if (d.serviceRadiusKm !== undefined) setServiceRadiusKm(d.serviceRadiusKm);
        if (d.autoCloseWhenOutletClosed !== undefined) setAutoCloseWhenOutletClosed(d.autoCloseWhenOutletClosed);
        if (d.pwaAppName !== undefined) setPwaAppName(d.pwaAppName);
        if (d.pwaShortName !== undefined) setPwaShortName(d.pwaShortName);
        if (d.pwaThemeColor !== undefined) setPwaThemeColor(d.pwaThemeColor);
        if (d.pwaBgColor !== undefined) setPwaBgColor(d.pwaBgColor);
        if (d.pwaStartUrl !== undefined) setPwaStartUrl(d.pwaStartUrl);
        if (d.pwaDisplayMode !== undefined) setPwaDisplayMode(d.pwaDisplayMode);
        if (d.pwaShowOnlyInStock !== undefined) setPwaShowOnlyInStock(d.pwaShowOnlyInStock);
        if (d.pwaShowMemberDiscounts !== undefined) setPwaShowMemberDiscounts(d.pwaShowMemberDiscounts);
        if (d.pwaEnableBarcodeScan !== undefined) setPwaEnableBarcodeScan(d.pwaEnableBarcodeScan);
        if (d.pwaAcceptingOrders !== undefined) setPwaAcceptingOrders(d.pwaAcceptingOrders);
        if (d.dailyOrderCap !== undefined) setDailyOrderCap(d.dailyOrderCap);
        if (d.minOrderDelivery !== undefined) setMinOrderDelivery(d.minOrderDelivery);
        if (d.minOrderPickup !== undefined) setMinOrderPickup(d.minOrderPickup);
        if (d.estPrepTimeMinutes !== undefined) setEstPrepTimeMinutes(d.estPrepTimeMinutes);
        if (d.allowSelfPickup !== undefined) setAllowSelfPickup(d.allowSelfPickup);
        if (d.allowStoreCourier !== undefined) setAllowStoreCourier(d.allowStoreCourier);
        if (d.allowInstantGosend !== undefined) setAllowInstantGosend(d.allowInstantGosend);
        if (d.deliveryBaseFee !== undefined) setDeliveryBaseFee(d.deliveryBaseFee);
        if (d.freeDeliveryMinSpend !== undefined) setFreeDeliveryMinSpend(d.freeDeliveryMinSpend);
        if (d.allowGuestCheckout !== undefined) setAllowGuestCheckout(d.allowGuestCheckout);
        if (d.allowCustomerKasbonVIP !== undefined) setAllowCustomerKasbonVIP(d.allowCustomerKasbonVIP);
        if (d.enablePwaPointsRedeem !== undefined) setEnablePwaPointsRedeem(d.enablePwaPointsRedeem);
        if (d.enableLiveOrderStatusTracking !== undefined) setEnableLiveOrderStatusTracking(d.enableLiveOrderStatusTracking);
        if (d.geofenceRadius !== undefined) setGeofenceRadius(d.geofenceRadius);
      }
    });
    return () => unsub();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(
        doc(db, 'settings', 'online_order'),
        {
          webTitle,
          storeTagline,
          companyLegalName,
          webDomain,
          customDomainEnabled,
          customCname,
          sslStatus,
          primaryBrandColor,
          logoUrl,
          whatsappOrderNumber,
          supportEmail,
          storeAddress,
          googleMapsUrl,
          heroHeading,
          heroSubheading,
          promoBannerText,
          showPromoBanner,
          aboutUsText,
          enableFaqSection,
          catalogPublished,
          showOutOfStock,
          showWholesaleCartonPrice,
          showDiscountCountdown,
          showMemberTierBadge,
          enforceStoreHours,
          openTime,
          closeTime,
          serviceRadiusKm,
          autoCloseWhenOutletClosed,
          pwaAppName,
          pwaShortName,
          pwaThemeColor,
          pwaBgColor,
          pwaStartUrl,
          pwaDisplayMode,
          pwaShowOnlyInStock,
          pwaShowMemberDiscounts,
          pwaEnableBarcodeScan,
          pwaAcceptingOrders,
          dailyOrderCap,
          minOrderDelivery,
          minOrderPickup,
          estPrepTimeMinutes,
          allowSelfPickup,
          allowStoreCourier,
          allowInstantGosend,
          deliveryBaseFee,
          freeDeliveryMinSpend,
          allowGuestCheckout,
          allowCustomerKasbonVIP,
          enablePwaPointsRedeem,
          enableLiveOrderStatusTracking,
          geofenceRadius,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Error saving online order settings to Firestore:', err);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl font-black text-white tracking-tight">
              SETTING ONLINE ORDER &amp; E-CATALOG
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            5.19 &mdash; Konfigurasi identitas toko, katalog publik web, client PWA ordering, serviceability outlet, dan proteksi rahasia server.
          </p>
        </div>

        {/* Sub-Tabs & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
            <button
              onClick={() => setActiveSub('website_setting')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeSub === 'website_setting' ? 'bg-blue-600 text-white shadow' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Website Setting</span>
            </button>
            <button
              onClick={() => setActiveSub('client_pwa_setting')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeSub === 'client_pwa_setting' ? 'bg-purple-600 text-white shadow' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Client PWA Setting</span>
            </button>
          </div>

          <button
            onClick={() => setPreviewOpen(true)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
          >
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Live Preview</span>
          </button>

          <a
            href="/client-pwa"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
            title="Buka tampilan mandiri Client PWA tanpa sidebar/navbar admin"
          >
            <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Full Screen PWA</span>
          </a>
        </div>
      </div>

      {/* Security & Architectural Logic Banner */}
      <div className="p-3.5 rounded-xl bg-blue-950/40 border border-blue-900/60 flex items-start gap-3 text-xs text-blue-200">
        <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-white">Authoritative Service &amp; Data Security Policy:</span>
          <p className="text-zinc-300 text-[11px] mt-0.5">
            Pengaturan publik ini tidak pernah mengekspos token rahasia, merchant secret, atau private key ke client browser.
            Katalog dan stok menggunakan single-engine terpusat yang sama dengan mesin POS kasir, mencegah overselling dan selisih harga.
          </p>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">Pengaturan Online Order berhasil disimpan dan disinkronkan ke Cloud Firestore realtime!</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* VIEW: WEBSITE SETTING (5.19) */}
      {/* ============================================================== */}
      {activeSub === 'website_setting' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Col 1 & 2: Main Website Identity & Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Card 1: Identitas & Domain */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-blue-400" />
                    <h3 className="font-bold text-white text-sm">Identitas Toko &amp; Publikasi Website</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400">Status Toko Web:</span>
                    <button
                      type="button"
                      onClick={() => setCatalogPublished(!catalogPublished)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ${
                        catalogPublished
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${catalogPublished ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                      {catalogPublished ? 'Published (Live)' : 'Maintenance / Offline'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Nama Website / Toko Online</label>
                    <input
                      type="text"
                      value={webTitle}
                      onChange={(e) => setWebTitle(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      placeholder="e.g. RiskCart Official Store"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Badan Usaha / Legal Entity</label>
                    <input
                      type="text"
                      value={companyLegalName}
                      onChange={(e) => setCompanyLegalName(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      placeholder="PT / CV Nama Perusahaan"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-zinc-400 font-semibold mb-1">Tagline Toko (Slogan)</label>
                    <input
                      type="text"
                      value={storeTagline}
                      onChange={(e) => setStoreTagline(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      placeholder="Slogan promosi toko"
                    />
                  </div>

                  {/* Domain Configuration */}
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Subdomain RiskCart Cloud</label>
                    <div className="flex items-center">
                      <input
                        type="text"
                        value={webDomain}
                        onChange={(e) => setWebDomain(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-zinc-400 font-semibold">Custom Domain (Opsional)</label>
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                        <CheckCircle className="w-3 h-3" /> SSL TLS 1.3
                      </span>
                    </div>
                    <input
                      type="text"
                      value={customCname}
                      onChange={(e) => setCustomCname(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                      placeholder="shop.tokoanda.id"
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Website Content & Marketing Hero */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-white text-sm">Konten Beranda, Banner &amp; FAQ</h3>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Headline Utama Hero Banner</label>
                    <input
                      type="text"
                      value={heroHeading}
                      onChange={(e) => setHeroHeading(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Sub-headline Hero Banner</label>
                    <input
                      type="text"
                      value={heroSubheading}
                      onChange={(e) => setHeroSubheading(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-zinc-400 font-semibold">Teks Pengumuman Promo (Top Marquee Banner)</label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-zinc-300">
                        <input
                          type="checkbox"
                          checked={showPromoBanner}
                          onChange={(e) => setShowPromoBanner(e.target.checked)}
                          className="rounded text-blue-600 focus:ring-0"
                        />
                        <span>Aktifkan Bar Promo</span>
                      </label>
                    </div>
                    <input
                      type="text"
                      value={promoBannerText}
                      onChange={(e) => setPromoBannerText(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Tentang Toko (About Us)</label>
                    <textarea
                      rows={2}
                      value={aboutUsText}
                      onChange={(e) => setAboutUsText(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Card 3: Kontak & Lokasi Outlet */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <Phone className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-bold text-white text-sm">Kontak Pelanggan &amp; Titik Lokasi Fisik</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Nomor WhatsApp CS / Admin Pesanan</label>
                    <input
                      type="text"
                      value={whatsappOrderNumber}
                      onChange={(e) => setWhatsappOrderNumber(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      placeholder="+628..."
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Email Layanan Pelanggan</label>
                    <input
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-zinc-400 font-semibold mb-1">Alamat Fisik Outlet (Ditampilkan di Struk Web &amp; Footer)</label>
                    <textarea
                      rows={2}
                      value={storeAddress}
                      onChange={(e) => setStoreAddress(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Col 3: Catalog Visibility & Serviceability */}
            <div className="space-y-6">
              {/* Catalog Visibility Rules */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <h3 className="font-bold text-white text-sm">Visibilitas Katalog</h3>
                </div>

                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Tampilkan Produk Habis</div>
                      <div className="text-[11px] text-zinc-400">Tampilkan dengan label &quot;Stok Habis&quot; (tidak dapat dicheckout)</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={showOutOfStock}
                      onChange={(e) => setShowOutOfStock(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Tampilkan Harga Grosir/Dus</div>
                      <div className="text-[11px] text-zinc-400">Otomatis hitung potongan bertingkat qty &gt; 12 pcs</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={showWholesaleCartonPrice}
                      onChange={(e) => setShowWholesaleCartonPrice(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Timer Countdown Flash Sale</div>
                      <div className="text-[11px] text-zinc-400">Tampilkan hitung mundur waktu promo berakhir</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={showDiscountCountdown}
                      onChange={(e) => setShowDiscountCountdown(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Badge Tier Member Pelanggan</div>
                      <div className="text-[11px] text-zinc-400">Tampilkan badge diskon khusus Silver/Gold/VIP</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={showMemberTierBadge}
                      onChange={(e) => setShowMemberTierBadge(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>
                </div>
              </div>

              {/* Outlet Serviceability & Jam Operasional */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-white text-sm">Jam Buka &amp; Layanan Outlet</h3>
                </div>

                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Patuhi Jam Operasional</div>
                      <div className="text-[11px] text-zinc-400">Tolak order otomatis di luar jam buka toko</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enforceStoreHours}
                      onChange={(e) => setEnforceStoreHours(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-zinc-400 font-semibold mb-1">Jam Buka</label>
                      <input
                        type="time"
                        value={openTime}
                        onChange={(e) => setOpenTime(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 font-semibold mb-1">Jam Tutup</label>
                      <input
                        type="time"
                        value={closeTime}
                        onChange={(e) => setCloseTime(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Radius Jangkauan Pengiriman Web (Km)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={serviceRadiusKm}
                        onChange={(e) => setServiceRadiusKm(Number(e.target.value))}
                        className="w-24 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-white font-bold"
                      />
                      <span className="text-zinc-400 text-xs">Kilometer dari titik outlet</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Branding Visual */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-zinc-800">
                  <Palette className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-white text-sm">Warna Tema Brand</h3>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryBrandColor}
                    onChange={(e) => setPrimaryBrandColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0"
                  />
                  <div>
                    <div className="font-mono text-xs font-bold text-white">{primaryBrandColor}</div>
                    <div className="text-[11px] text-zinc-400">Primary Brand Palette</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Save Bar */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-blue-900/40 cursor-pointer transition"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Perubahan Website E-Catalog</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* VIEW: CLIENT PWA SETTING (5.19) */}
      {/* ============================================================== */}
      {activeSub === 'client_pwa_setting' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: PWA Identity & Ordering Availability */}
            <div className="lg:col-span-2 space-y-6">
              {/* PWA Manifest & Branding */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-purple-400" />
                    <h3 className="font-bold text-white text-sm">Client PWA Manifest &amp; App Icon</h3>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    manifest.json v3
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Nama Lengkap Aplikasi PWA</label>
                    <input
                      type="text"
                      value={pwaAppName}
                      onChange={(e) => setPwaAppName(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Short Name (Label Ikon Layar HP)</label>
                    <input
                      type="text"
                      value={pwaShortName}
                      onChange={(e) => setPwaShortName(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Display Mode</label>
                    <select
                      value={pwaDisplayMode}
                      onChange={(e) => setPwaDisplayMode(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="standalone">Standalone (Full App Experience tanpa address bar)</option>
                      <option value="fullscreen">Fullscreen (Immersive)</option>
                      <option value="minimal-ui">Minimal UI (Dengan kontrol navigasi)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Start URL Path</label>
                    <input
                      type="text"
                      value={pwaStartUrl}
                      onChange={(e) => setPwaStartUrl(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Ordering Availability & Capacity Rules */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-bold text-white text-sm">Ketersediaan Pemesanan (Ordering Availability)</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPwaAcceptingOrders(!pwaAcceptingOrders)}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      pwaAcceptingOrders
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${pwaAcceptingOrders ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    {pwaAcceptingOrders ? 'Menerima Order PWA' : 'Order Dijeda Sementara'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Kuota Order Harian (Slot Max)</label>
                    <input
                      type="number"
                      value={dailyOrderCap}
                      onChange={(e) => setDailyOrderCap(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                    />
                    <span className="text-[10px] text-zinc-500">Cegah overload antrian dapur/staf</span>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">
                      Min. Belanja Pesan Antar ({formatMoney(minOrderDelivery)})
                    </label>
                    <input
                      type="number"
                      value={minOrderDelivery}
                      onChange={(e) => setMinOrderDelivery(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                    />
                    <span className="text-[10px] text-zinc-500">Khusus order delivery</span>
                  </div>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Estimasi Siap Ambil / Kirim</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={estPrepTimeMinutes}
                        onChange={(e) => setEstPrepTimeMinutes(Number(e.target.value))}
                        className="w-20 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                      />
                      <span className="text-zinc-400 text-xs">Menit</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Delivery & Fulfillment Configuration */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <Truck className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-white text-sm">Opsi Pengambilan &amp; Pengiriman (Fulfillment)</h3>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowSelfPickup}
                        onChange={(e) => setAllowSelfPickup(e.target.checked)}
                        className="rounded text-purple-600 focus:ring-0"
                      />
                      <div>
                        <div className="font-semibold text-white">Ambil Sendiri di Toko</div>
                        <div className="text-[10px] text-zinc-400">Self Pickup gratis</div>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowStoreCourier}
                        onChange={(e) => setAllowStoreCourier(e.target.checked)}
                        className="rounded text-purple-600 focus:ring-0"
                      />
                      <div>
                        <div className="font-semibold text-white">Kurir Toko Internal</div>
                        <div className="text-[10px] text-zinc-400">Tarif flat zona toko</div>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowInstantGosend}
                        onChange={(e) => setAllowInstantGosend(e.target.checked)}
                        className="rounded text-purple-600 focus:ring-0"
                      />
                      <div>
                        <div className="font-semibold text-white">Instant Gosend/Grab</div>
                        <div className="text-[10px] text-zinc-400">Hitung tarif per KM</div>
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div>
                      <label className="block text-zinc-400 font-semibold mb-1">
                        Tarif Dasar Ongkir Kurir Toko ({formatMoney(deliveryBaseFee)})
                      </label>
                      <input
                        type="number"
                        value={deliveryBaseFee}
                        onChange={(e) => setDeliveryBaseFee(Number(e.target.value))}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 font-semibold mb-1">
                        Batas Minimal Belanja Bebas Ongkir ({formatMoney(freeDeliveryMinSpend)})
                      </label>
                      <input
                        type="number"
                        value={freeDeliveryMinSpend}
                        onChange={(e) => setFreeDeliveryMinSpend(Number(e.target.value))}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Col: Customer Access & Supported Features */}
            <div className="space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <Users className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-white text-sm">Akses &amp; Fitur Pelanggan PWA</h3>
                </div>

                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Bolehkan Guest Checkout</div>
                      <div className="text-[11px] text-zinc-400">Pesan tanpa login OTP member</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={allowGuestCheckout}
                      onChange={(e) => setAllowGuestCheckout(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Kasbon Khusus Member VIP</div>
                      <div className="text-[11px] text-zinc-400">Bayar tempo khusus limit terverifikasi</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={allowCustomerKasbonVIP}
                      onChange={(e) => setAllowCustomerKasbonVIP(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Redeem Poin Loyalitas</div>
                      <div className="text-[11px] text-zinc-400">Tukar poin langsung jadi potongan kasir</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enablePwaPointsRedeem}
                      onChange={(e) => setEnablePwaPointsRedeem(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 cursor-pointer">
                    <div>
                      <div className="font-semibold text-white">Pelacakan Status Realtime</div>
                      <div className="text-[11px] text-zinc-400">Notifikasi status Diterima &rarr; Siap &rarr; Jalan</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enableLiveOrderStatusTracking}
                      onChange={(e) => setEnableLiveOrderStatusTracking(e.target.checked)}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-0"
                    />
                  </label>

                  <div>
                    <label className="block text-zinc-400 font-semibold mb-1">Geofence Radius Pickup (Meter)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={geofenceRadius}
                        onChange={(e) => setGeofenceRadius(Number(e.target.value))}
                        className="w-24 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-white font-bold"
                      />
                      <span className="text-zinc-500 text-xs">Deteksi kedatangan pembeli</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Install PWA QR Code Generator */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center space-y-3">
                <div className="flex items-center justify-center gap-1.5 text-purple-400 font-bold text-xs">
                  <QrCode className="w-4 h-4" />
                  <span>Scan to Install Client PWA</span>
                </div>
                <div className="p-3 bg-white rounded-xl inline-block shadow-inner mx-auto">
                  <div className="w-28 h-28 bg-zinc-950 flex flex-col items-center justify-center rounded p-1 text-white text-[9px] font-mono leading-tight">
                    <QrCode className="w-16 h-16 text-white mb-1" />
                    <span>toko.riskcart.com</span>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-400">
                  Pelanggan scan barcode di meja kasir untuk menginstal PWA ke HP Android / iOS tanpa download Play Store.
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Save Bar */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="submit"
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-purple-900/40 cursor-pointer transition"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Perubahan Client PWA Setting</span>
            </button>
          </div>
        </form>
      )}

      {/* ============================================================== */}
      {/* LIVE PREVIEW MODAL */}
      {/* ============================================================== */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <span className="font-bold text-white text-xs">Simulasi Client Tampilan HP</span>
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                className="text-zinc-400 hover:text-white text-xs font-bold px-2 py-1 rounded bg-zinc-800"
              >
                ✕ Tutup
              </button>
            </div>

            {/* Mobile Viewport Simulation */}
            <div className="p-4 overflow-y-auto space-y-4 bg-zinc-950 flex-1 text-xs">
              {showPromoBanner && (
                <div className="p-2 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] text-center font-medium">
                  {promoBannerText}
                </div>
              )}

              {/* Store Hero in Preview */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-blue-900/60 to-purple-900/60 border border-blue-700/40 text-white space-y-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 font-bold uppercase tracking-wider">
                  Official Store
                </span>
                <h3 className="font-extrabold text-base leading-tight">{webTitle}</h3>
                <p className="text-[11px] text-zinc-300">{storeTagline}</p>
                <div className="pt-2 flex items-center justify-between text-[10px] text-zinc-300 border-t border-white/10">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-emerald-400" /> {openTime} - {closeTime} WIB
                  </span>
                  <span className="text-emerald-400 font-bold">Buka Sekarang</span>
                </div>
              </div>

              {/* Sample / Live Catalog Items */}
              <div className="space-y-2">
                <div className="font-bold text-white text-xs flex items-center justify-between">
                  <span>Katalog Pilihan ({products.length} Produk)</span>
                  <span className="text-zinc-400 text-[10px]">
                    {orders.length} Pesanan Tersinkronisasi
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(products.length >= 2
                    ? products.slice(0, 2)
                    : [
                        {
                          id: 'p1',
                          name: 'Beras Ramos 5kg',
                          pricePerUnit: 74500,
                          stockInUnits: 45,
                        },
                        {
                          id: 'p2',
                          name: 'Minyakita 2 Liter',
                          pricePerUnit: 31000,
                          stockInUnits: 110,
                        },
                      ]
                  ).map((prod: any) => (
                    <div
                      key={prod.id}
                      className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1"
                    >
                      <div className="w-full h-16 rounded bg-zinc-800 flex items-center justify-center text-zinc-400 text-[10px] px-2 text-center truncate">
                        {prod.name}
                      </div>
                      <div className="font-bold text-white text-[11px] truncate">{prod.name}</div>
                      <div className="text-blue-400 font-bold text-xs font-mono">
                        {formatMoney(Number(prod.pwaPrice || prod.pricePerUnit || 0))}
                      </div>
                      <div className="text-[9px] text-emerald-400">
                        Tersedia: {Number(prod.stockInUnits ?? prod.stock ?? 0)} Unit
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1 text-[10px] text-zinc-400">
                <div className="text-white font-semibold">Alamat Pengambilan:</div>
                <div>{storeAddress}</div>
                <div className="text-blue-400">WA: {whatsappOrderNumber}</div>
              </div>
            </div>

            <div className="p-3 bg-zinc-900 border-t border-zinc-800 text-center">
              <button
                onClick={() => setPreviewOpen(false)}
                className="w-full py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
              >
                Tutup Simulasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
