import React, { useState, useEffect, useMemo } from 'react';
import {
  CreditCard,
  QrCode,
  CheckCircle,
  Save,
  RefreshCw,
  Activity,
  Power,
  CheckCircle2,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, isDemoModeActive } from '../../firebase';
import { useAppNavigation } from '../../router';
import { useFirestoreList } from '../../hooks/useFirestoreList';
import { logRealAudit } from '../../utils/auditLogger';
import { DEFAULT_PAYMENT_GATEWAY_CONFIG } from '../../types/settings';

type GatewaySubTab = 'xendit' | 'doku' | 'midtrans' | 'tripay';

interface PaymentIntegrationModuleProps {
  subModule: GatewaySubTab;
  currencyMode?: 'IDR' | 'USD';
  onNavigateTab?: (tab: string) => void;
}

export const PaymentIntegrationModule: React.FC<PaymentIntegrationModuleProps> = ({
  subModule,
  currencyMode: _currencyMode = 'IDR',
}) => {
  const { route, navigateTab } = useAppNavigation();
  const rawSub = route.activeTab === 'module_payment' ? route.activeSubModule : subModule;
  const activeSub: GatewaySubTab =
    rawSub === 'xendit' || rawSub === 'doku' || rawSub === 'midtrans' || rawSub === 'tripay'
      ? rawSub
      : 'xendit';
  const setActiveSub = (next: GatewaySubTab) => {
    navigateTab('module_payment', next);
  };
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string>(
    'Kredensial payment gateway berhasil disimpan ke Firestore (settings/payment_gateways)!'
  );
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookFeedback, setWebhookFeedback] = useState<string | null>(null);
  const [testCheckoutUrl, setTestCheckoutUrl] = useState<string | null>(null);
  const [isTogglingDoku, setIsTogglingDoku] = useState(false);
  const [confirmingTxId, setConfirmingTxId] = useState<string | null>(null);

  // Read initial fast cache from localStorage
  const initialCachedDoku = useMemo(() => {
    try {
      const rawCfg = localStorage.getItem('riskcart_doku_config');
      const rawEnabled = localStorage.getItem('riskcart_doku_enabled');
      const parsed = rawCfg ? JSON.parse(rawCfg) : {};
      const enabled =
        rawEnabled !== null
          ? rawEnabled === 'true'
          : typeof parsed.dokuEnabled === 'boolean'
          ? parsed.dokuEnabled
          : true;
      return {
        enabled,
        mode: (parsed.environment || parsed.mode || 'sandbox') as 'sandbox' | 'production',
        clientId: parsed.clientId || '',
        sharedKey: parsed.secretKey || parsed.sharedKey || '',
      };
    } catch {
      return {
        enabled: true,
        mode: 'sandbox' as 'sandbox' | 'production',
        clientId: '',
        sharedKey: '',
      };
    }
  }, []);

  const [dokuEnabled, setDokuEnabled] = useState<boolean>(initialCachedDoku.enabled);

  // Gateway Configurations synced with Firestore doc(db, 'settings', 'payment_gateways') & doc(db, 'settings', 'payment_gateway')
  const [gateways, setGateways] = useState({
    xendit: {
      name: 'Xendit Payments Indonesia',
      mode: 'sandbox' as 'sandbox' | 'production',
      publicKey: '',
      secretKey: '',
      verified: false,
      webhookUrl: `${window.location.origin}/api/payment/webhook`,
      qrisEnabled: true,
      vaEnabled: true,
      retailOutletEnabled: false,
      dailyVolume: 0,
      settlementTime: 'T+1 Otomatis',
    },
    doku: {
      name: 'DOKU Payment Gateway',
      mode: initialCachedDoku.mode,
      clientId: initialCachedDoku.clientId,
      sharedKey: initialCachedDoku.sharedKey,
      verified: true,
      dokuEnabled: initialCachedDoku.enabled,
      webhookUrl: `${window.location.origin}/api/payment/webhook`,
      qrisEnabled: initialCachedDoku.enabled,
      vaEnabled: true,
      retailOutletEnabled: true,
      dailyVolume: 0,
      settlementTime: 'T+1 / Instan QRIS',
    },
    midtrans: {
      name: 'Midtrans Snap & Core API',
      mode: 'sandbox' as 'sandbox' | 'production',
      serverKey: '',
      clientKey: '',
      merchantCode: '',
      verified: false,
      webhookUrl: `${window.location.origin}/api/payment/webhook`,
      qrisEnabled: true,
      vaEnabled: true,
      retailOutletEnabled: true,
      dailyVolume: 0,
      settlementTime: 'T+1 Otomatis',
    },
    tripay: {
      name: 'Tripay Payment Gateway',
      mode: 'sandbox' as 'sandbox' | 'production',
      merchantCode: '',
      apiKey: '',
      privateKey: '',
      verified: false,
      webhookUrl: `${window.location.origin}/api/payment/webhook`,
      qrisEnabled: true,
      vaEnabled: true,
      retailOutletEnabled: true,
      dailyVolume: 0,
      settlementTime: 'Real-time / H+1',
    },
  });

  const syncDokuToLocalStorage = (params: {
    dokuEnabled: boolean;
    environment: 'sandbox' | 'production';
    clientId: string;
    secretKey: string;
    webhookUrl: string;
  }) => {
    try {
      if (isDemoModeActive()) return;
      localStorage.setItem('riskcart_doku_enabled', String(params.dokuEnabled));
      localStorage.setItem('riskcart_pos_enable_qris', String(params.dokuEnabled));
      localStorage.setItem(
        'riskcart_doku_config',
        JSON.stringify({
          dokuEnabled: params.dokuEnabled,
          environment: params.environment,
          clientId: params.clientId,
          webhookUrl: params.webhookUrl,
        })
      );
      window.dispatchEvent(new Event('riskcart-doku-config-updated'));
    } catch {}
  };

  useEffect(() => {
    const applySnapshotData = (d: any) => {
      if (!d) return;
      const gws = d.gateways || d;
      const resolvedDokuEnabled =
        typeof d.dokuEnabled === 'boolean'
          ? d.dokuEnabled
          : typeof gws.doku?.dokuEnabled === 'boolean'
          ? gws.doku.dokuEnabled
          : typeof gws.doku?.enabled === 'boolean'
          ? gws.doku.enabled
          : true;

      const resolvedEnv = (
        d.environment ||
        gws.doku?.mode ||
        gws.doku?.environment ||
        (gws.doku?.isSandbox === false ? 'production' : 'sandbox')
      ) as 'sandbox' | 'production';
      const resolvedClientId =
        d.clientId ?? gws.doku?.clientId ?? gws.doku?.merchantCode ?? gws.doku?.clientKey ?? '';
      const resolvedSecretKey =
        d.secretKey ?? d.sharedKey ?? gws.doku?.sharedKey ?? gws.doku?.secretKey ?? '';
      const dokuWebhook = `${window.location.origin}/api/payment/webhook`;

      setDokuEnabled(resolvedDokuEnabled);
      syncDokuToLocalStorage({
        dokuEnabled: resolvedDokuEnabled,
        environment: resolvedEnv,
        clientId: resolvedClientId,
        secretKey: resolvedSecretKey,
        webhookUrl: dokuWebhook,
      });

      const isDemo = isDemoModeActive();
      const maskIfDemo = (val: string) =>
        isDemo && val ? '•••••••••••••••• (Protected in Demo Sandbox)' : val;

      setGateways((prev) => ({
        xendit: {
          ...prev.xendit,
          ...(gws.xendit || {}),
          mode:
            gws.xendit?.mode ||
            (gws.xendit?.isSandbox === false ? 'production' : prev.xendit.mode),
          publicKey: String(
            gws.xendit?.publicKey ?? gws.xendit?.clientKey ?? prev.xendit.publicKey ?? ''
          ),
          secretKey: maskIfDemo(
            String(gws.xendit?.secretKey ?? gws.xendit?.apiKey ?? prev.xendit.secretKey ?? '')
          ),
          webhookUrl: `${window.location.origin}/api/payment/webhook`,
        },
        doku: {
          ...prev.doku,
          ...(gws.doku || {}),
          mode: resolvedEnv,
          clientId: resolvedClientId,
          sharedKey: maskIfDemo(String(resolvedSecretKey || '')),
          dokuEnabled: resolvedDokuEnabled,
          qrisEnabled: resolvedDokuEnabled,
          webhookUrl: dokuWebhook,
        },
        midtrans: {
          ...prev.midtrans,
          ...(gws.midtrans || {}),
          mode:
            gws.midtrans?.mode ||
            (gws.midtrans?.isSandbox === false ? 'production' : prev.midtrans.mode),
          clientKey: String(gws.midtrans?.clientKey ?? prev.midtrans.clientKey ?? ''),
          merchantCode: String(gws.midtrans?.merchantCode ?? prev.midtrans.merchantCode ?? ''),
          serverKey: maskIfDemo(
            String(gws.midtrans?.serverKey ?? gws.midtrans?.secretKey ?? prev.midtrans.serverKey ?? '')
          ),
          webhookUrl: `${window.location.origin}/api/payment/webhook`,
        },
        tripay: {
          ...prev.tripay,
          ...(gws.tripay || {}),
          mode:
            gws.tripay?.mode ||
            (gws.tripay?.isSandbox === false ? 'production' : prev.tripay.mode),
          merchantCode: String(gws.tripay?.merchantCode ?? prev.tripay.merchantCode ?? ''),
          apiKey: String(gws.tripay?.apiKey ?? gws.tripay?.clientKey ?? prev.tripay.apiKey ?? ''),
          privateKey: maskIfDemo(
            String(gws.tripay?.privateKey ?? gws.tripay?.secretKey ?? prev.tripay.privateKey ?? '')
          ),
          webhookUrl: `${window.location.origin}/api/payment/webhook`,
        },
      }));
    };

    const unsubPlural = onSnapshot(doc(db, 'settings', 'payment_gateways'), (snap) => {
      if (snap.exists()) applySnapshotData(snap.data());
    });
    const unsubSingular = onSnapshot(doc(db, 'settings', 'payment_gateway'), (snap) => {
      if (snap.exists()) applySnapshotData(snap.data());
    });
    return () => {
      unsubPlural();
      unsubSingular();
    };
  }, []);

  const activeGw = gateways[activeSub];

  const getPublicCredential = (sub: GatewaySubTab) => {
    if (sub === 'xendit') return gateways.xendit.publicKey;
    if (sub === 'doku') return gateways.doku.clientId;
    if (sub === 'tripay') return gateways.tripay.apiKey;
    return gateways.midtrans.clientKey;
  };

  const getSecretCredential = (sub: GatewaySubTab) => {
    if (sub === 'xendit') return gateways.xendit.secretKey;
    if (sub === 'doku') return gateways.doku.sharedKey;
    if (sub === 'tripay') return gateways.tripay.privateKey;
    return gateways.midtrans.serverKey;
  };

  const hasSavedCredential = Boolean(
    getSecretCredential(activeSub)?.trim() &&
      !getSecretCredential(activeSub).trim().endsWith('...')
  );
  const isConnected =
    activeSub === 'doku'
      ? dokuEnabled
      : hasSavedCredential && Boolean(activeGw.verified);

  const computedStatus =
    activeSub === 'doku'
      ? dokuEnabled
        ? 'Terhubung (Live)'
        : 'Nonaktif (Disabled)'
      : !hasSavedCredential
      ? 'Belum Dikonfigurasi'
      : isConnected
      ? `Terhubung (${activeGw.mode === 'production' ? 'Live' : 'Sandbox'})`
      : `Kredensial Tersimpan (${activeGw.mode === 'production' ? 'Live' : 'Sandbox'})`;

  const updateActiveGatewayField = (
    field: 'mode' | 'public' | 'secret' | 'merchantCode',
    value: string
  ) => {
    setGateways((prev) => {
      const current = { ...prev[activeSub] } as any;
      if (field === 'mode') {
        current.mode = value === 'production' ? 'production' : 'sandbox';
      } else if (field === 'merchantCode') {
        current.merchantCode = value;
      } else if (field === 'public') {
        if (activeSub === 'xendit') current.publicKey = value;
        else if (activeSub === 'doku') current.clientId = value;
        else if (activeSub === 'tripay') current.apiKey = value;
        else current.clientKey = value;
      } else if (field === 'secret') {
        if (activeSub === 'xendit') current.secretKey = value;
        else if (activeSub === 'doku') current.sharedKey = value;
        else if (activeSub === 'tripay') current.privateKey = value;
        else current.serverKey = value;
      }
      return {
        ...prev,
        [activeSub]: current,
      };
    });
  };

  // Toggle DOKU ON / OFF immediately and persist to Firestore + localStorage
  const handleToggleDokuEnabled = async (nextEnabled: boolean) => {
    setIsTogglingDoku(true);
    setDokuEnabled(nextEnabled);
    const dokuWebhook = `${window.location.origin}/api/payment/webhook`;
    const updatedDoku = {
      ...gateways.doku,
      dokuEnabled: nextEnabled,
      enabled: nextEnabled,
      qrisEnabled: nextEnabled,
      verified: nextEnabled ? true : gateways.doku.verified,
      webhookUrl: dokuWebhook,
    };

    setGateways((prev) => ({
      ...prev,
      doku: updatedDoku,
    }));

    syncDokuToLocalStorage({
      dokuEnabled: nextEnabled,
      environment: updatedDoku.mode,
      clientId: updatedDoku.clientId,
      secretKey: updatedDoku.sharedKey,
      webhookUrl: dokuWebhook,
    });

    try {
      const nowIso = new Date().toISOString();
      const posQrisSyncPayload = {
        acceptQris: nextEnabled,
        enableQRIS: nextEnabled,
        payment: {
          enableQRIS: nextEnabled,
          acceptQris: nextEnabled,
        },
        updatedAt: nowIso,
      };
      await Promise.all([
        setDoc(
          doc(db, 'settings', 'payment_gateway'),
          {
            dokuEnabled: nextEnabled,
            environment: updatedDoku.mode,
            clientId: updatedDoku.clientId,
            secretKey: updatedDoku.sharedKey,
            sharedKey: updatedDoku.sharedKey,
            webhookUrl: dokuWebhook,
            doku: updatedDoku,
            updatedAt: nowIso,
          },
          { merge: true }
        ),
        setDoc(
          doc(db, 'settings', 'payment_gateways'),
          {
            dokuEnabled: nextEnabled,
            gateways: {
              doku: {
                ...DEFAULT_PAYMENT_GATEWAY_CONFIG.gateways.doku,
                enabled: nextEnabled,
                isSandbox: updatedDoku.mode !== 'production',
                merchantCode: updatedDoku.clientId,
                clientKey: updatedDoku.clientId,
                secretKey: updatedDoku.sharedKey,
              },
            },
            updatedAt: nowIso,
          },
          { merge: true }
        ),
        setDoc(doc(db, 'settings', 'pos'), posQrisSyncPayload, { merge: true }),
        setDoc(doc(db, 'settings', 'pos_config'), posQrisSyncPayload, { merge: true }),
        setDoc(doc(db, 'stores', 'store_001', 'settings', 'pos'), posQrisSyncPayload, {
          merge: true,
        }),
      ]);
      await logRealAudit({
        action: nextEnabled ? 'ENABLE_DOKU_GATEWAY' : 'DISABLE_DOKU_GATEWAY',
        module: 'PAYMENT_GATEWAY',
        details: `Toggle QRIS DOKU: ${nextEnabled ? 'ON' : 'OFF'}`,
      });
      setSavedMessage(
        nextEnabled
          ? 'Pembayaran QRIS DOKU diaktifkan (ON) — Tombol QRIS kini aktif di Terminal Kasir POS!'
          : 'Pembayaran QRIS DOKU dinonaktifkan (OFF) — Tombol QRIS disembunyikan dari Terminal Kasir POS.'
      );
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.warn('Failed to toggle dokuEnabled in Firestore:', err);
    } finally {
      setIsTogglingDoku(false);
    }
  };

  const handleTestWebhook = async () => {
    setIsTestingWebhook(true);
    setWebhookFeedback(null);
    setTestCheckoutUrl(null);
    const pubKey = getPublicCredential(activeSub);
    const secKey = getSecretCredential(activeSub);

    if (!secKey || !secKey.trim()) {
      setWebhookFeedback(
        `❌ Gagal: Kredensial ${activeSub.toUpperCase()} kosong. Isi dan simpan kredensial terlebih dahulu.`
      );
      setIsTestingWebhook(false);
      return;
    }

    try {
      const testOrderId = `TEST-${activeSub.toUpperCase()}-${Date.now()}`;
      const res = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway: activeSub,
          isSandbox: activeGw.mode !== 'production',
          credentials: {
            serverKey: activeSub === 'midtrans' ? secKey : '',
            clientKey: pubKey,
            secretKey: secKey,
            apiKey: activeSub === 'tripay' ? pubKey : secKey,
            privateKey: activeSub === 'tripay' ? secKey : '',
            merchantCode:
              activeSub === 'doku'
                ? pubKey
                : activeSub === 'tripay'
                ? gateways.tripay.merchantCode
                : gateways.midtrans.merchantCode,
          },
          orderId: testOrderId,
          amount: 10000,
          customerName: 'RiskCart Test Connection',
          customerEmail: 'test@riskcart.id',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const updatedProvider = { ...gateways[activeSub], verified: true };
        setGateways((prev) => ({ ...prev, [activeSub]: updatedProvider }));
        await Promise.all([
          setDoc(
            doc(db, 'settings', 'payment_gateway'),
            {
              [activeSub]: updatedProvider,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ),
          setDoc(
            doc(db, 'settings', 'payment_gateways'),
            {
              activeGateway: activeSub,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ),
        ]);
        if (data.paymentUrl) setTestCheckoutUrl(data.paymentUrl);
        setWebhookFeedback(
          `✅ Koneksi ${activeSub.toUpperCase()} (${activeGw.mode.toUpperCase()}) Berhasil! Invoice Test #${testOrderId} dibuat.`
        );
        await logRealAudit({
          action: 'TEST_PAYMENT_GATEWAY_SUCCESS',
          module: 'PAYMENT_GATEWAY',
          details: `Uji koneksi ${activeSub.toUpperCase()} (${activeGw.mode}) berhasil [${testOrderId}]`,
        });
      } else {
        const updatedProvider = { ...gateways[activeSub], verified: false };
        setGateways((prev) => ({ ...prev, [activeSub]: updatedProvider }));
        setWebhookFeedback(
          `❌ Gagal Validasi ${activeSub.toUpperCase()}: ${data.error || 'Kredensial ditolak oleh payment gateway'}`
        );
        await logRealAudit({
          action: 'TEST_PAYMENT_GATEWAY_FAILED',
          module: 'PAYMENT_GATEWAY',
          details: `Uji koneksi ${activeSub.toUpperCase()} gagal: ${data.error || 'Rejected'}`,
          severity: 'warning',
        });
      }
    } catch (err: any) {
      setWebhookFeedback(
        `❌ Gagal menghubungi server validasi gateway: ${err?.message || 'Network error'}`
      );
    } finally {
      setIsTestingWebhook(false);
    }
  };

  // Real-time DOKU Settlements from `doku_settlements` + QRIS `transactions` in Cloud Firestore
  const [dokuSettlementDocs, setDokuSettlementDocs] = useState<any[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'doku_settlements'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setDokuSettlementDocs(rows);
    });
    return () => unsub();
  }, []);

  const { data: realTransactions } = useFirestoreList<any>('transactions', []);

  const gatewayTransactions = useMemo(() => {
    const mapById = new Map<string, any>();

    // 1. Add QRIS / Non-Cash transactions from `transactions` collection
    realTransactions
      .filter((tx) => {
        const pm = String(tx.paymentMethod || '').toLowerCase();
        const pmLabel = String(tx.paymentMethodLabel || '').toLowerCase();
        if (activeSub === 'doku') {
          return pm === 'qris' || pmLabel.includes('qris') || pmLabel.includes('doku');
        }
        return pm === 'qris' || pm === 'card' || pm === 'transfer';
      })
      .forEach((tx) => {
        const amt = Math.round(Number(tx.totalRevenue ?? tx.totalAmount ?? tx.total ?? 0));
        const fee = Math.round(Number(tx.mdrFee ?? amt * 0.007));
        const net = Math.max(0, amt - fee);
        const rawStatus = String(tx.paymentStatus || tx.status || '').toUpperCase();
        const isSettled =
          rawStatus === 'LUNAS' ||
          rawStatus === 'PAID' ||
          rawStatus === 'SETTLED' ||
          rawStatus.includes('LUNAS');
        const orderNo = tx.orderNumber || tx.invoiceNumber || `POS-${String(tx.id).slice(-6).toUpperCase()}`;
        const paymentId =
          tx.dokuPaymentId ||
          `DOKU-QRIS-${String(orderNo).replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}`;
        const createdIso = tx.paidAt || tx.createdAt || tx.date || '';

        mapById.set(tx.id, {
          id: tx.id,
          transactionId: tx.id,
          paymentId,
          gateway: activeSub.toUpperCase(),
          time: createdIso ? new Date(createdIso).toLocaleString('id-ID') : '-',
          sortTime: createdIso ? new Date(createdIso).getTime() : 0,
          orderId: orderNo,
          customerName: tx.customerName || 'Walk-in Customer',
          channel: activeSub === 'doku' ? 'QRIS DOKU' : (tx.paymentMethod || 'QRIS').toUpperCase(),
          amount: amt,
          fee,
          netAmount: net,
          status: isSettled ? 'LUNAS (SETTLED)' : 'PENDING',
          isSettled,
        });
      });

    // 2. Overlay dedicated `doku_settlements` collection documents when viewing DOKU
    if (activeSub === 'doku') {
      dokuSettlementDocs.forEach((ds) => {
        const key = ds.transactionId || ds.id;
        const amt = Math.round(Number(ds.amount ?? 0));
        const fee = Math.round(Number(ds.mdrFee ?? ds.fee ?? amt * 0.007));
        const net = Math.max(0, Number(ds.netAmount ?? amt - fee));
        const rawStatus = String(ds.status || ds.paymentStatus || '').toUpperCase();
        const isSettled =
          rawStatus.includes('LUNAS') ||
          rawStatus.includes('SETTLED') ||
          rawStatus === 'PAID';
        const orderNo =
          ds.invoiceNumber || ds.orderId || `POS-${String(key).slice(-6).toUpperCase()}`;
        const paymentId =
          ds.paymentId ||
          `DOKU-QRIS-${String(orderNo).replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}`;
        const createdIso = ds.paidAt || ds.updatedAt || ds.createdAt || '';

        mapById.set(key, {
          id: key,
          transactionId: key,
          paymentId,
          gateway: 'DOKU',
          time: createdIso ? new Date(createdIso).toLocaleString('id-ID') : '-',
          sortTime: createdIso ? new Date(createdIso).getTime() : Date.now(),
          orderId: orderNo,
          customerName: ds.customerName || 'Walk-in Customer',
          channel: 'QRIS DOKU',
          amount: amt,
          fee,
          netAmount: net,
          status: isSettled ? 'LUNAS (SETTLED)' : 'PENDING',
          isSettled,
        });
      });
    }

    return Array.from(mapById.values()).sort((a, b) => b.sortTime - a.sortTime);
  }, [realTransactions, dokuSettlementDocs, activeSub]);

  const handleConfirmPendingSettlement = async (row: any) => {
    if (!row?.transactionId) return;
    setConfirmingTxId(row.transactionId);
    try {
      await fetch('/api/doku/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: row.transactionId,
          invoiceNumber: row.orderId,
          paymentId: row.paymentId,
          amount: row.amount,
          customerName: row.customerName,
        }),
      });
    } catch (e) {
      console.warn('Error confirming settlement:', e);
    } finally {
      setConfirmingTxId(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const pubKey = getPublicCredential(activeSub);
      const secKey = getSecretCredential(activeSub);
      let isVerified = activeSub === 'doku' ? dokuEnabled : Boolean(secKey && secKey.trim());

      const updatedProvider = {
        ...gateways[activeSub],
        verified: isVerified,
        ...(activeSub === 'doku'
          ? {
              dokuEnabled,
              enabled: dokuEnabled,
              qrisEnabled: dokuEnabled,
              webhookUrl: `${window.location.origin}/api/payment/webhook`,
            }
          : {}),
      };
      setGateways((prev) => ({
        ...prev,
        [activeSub]: updatedProvider,
      }));

      const nowIso = new Date().toISOString();

      // Build unified `settings/payment_gateways` payload
      const unifiedGatewaysPayload = {
        activeGateway: activeSub,
        updatedAt: nowIso,
        gateways: {
          xendit: {
            ...DEFAULT_PAYMENT_GATEWAY_CONFIG.gateways.xendit,
            enabled: Boolean(gateways.xendit.secretKey),
            isSandbox: (activeSub === 'xendit' ? updatedProvider.mode : gateways.xendit.mode) !== 'production',
            clientKey: activeSub === 'xendit' ? pubKey : gateways.xendit.publicKey,
            secretKey: activeSub === 'xendit' ? secKey : gateways.xendit.secretKey,
            apiKey: activeSub === 'xendit' ? secKey : gateways.xendit.secretKey,
            webhookUrl: `${window.location.origin}/api/payment/webhook`,
          },
          doku: {
            ...DEFAULT_PAYMENT_GATEWAY_CONFIG.gateways.doku,
            enabled: dokuEnabled,
            isSandbox: (activeSub === 'doku' ? updatedProvider.mode : gateways.doku.mode) !== 'production',
            merchantCode: activeSub === 'doku' ? pubKey : gateways.doku.clientId,
            clientKey: activeSub === 'doku' ? pubKey : gateways.doku.clientId,
            secretKey: activeSub === 'doku' ? secKey : gateways.doku.sharedKey,
            webhookUrl: `${window.location.origin}/api/payment/webhook`,
          },
          midtrans: {
            ...DEFAULT_PAYMENT_GATEWAY_CONFIG.gateways.midtrans,
            enabled: Boolean(gateways.midtrans.serverKey || (activeSub === 'midtrans' && secKey)),
            isSandbox: (activeSub === 'midtrans' ? updatedProvider.mode : gateways.midtrans.mode) !== 'production',
            merchantCode: gateways.midtrans.merchantCode || '',
            clientKey: activeSub === 'midtrans' ? pubKey : gateways.midtrans.clientKey,
            serverKey: activeSub === 'midtrans' ? secKey : gateways.midtrans.serverKey,
            secretKey: activeSub === 'midtrans' ? secKey : gateways.midtrans.serverKey,
            webhookUrl: `${window.location.origin}/api/payment/webhook`,
          },
          tripay: {
            ...DEFAULT_PAYMENT_GATEWAY_CONFIG.gateways.tripay,
            enabled: Boolean(gateways.tripay.privateKey || (activeSub === 'tripay' && secKey)),
            isSandbox: (activeSub === 'tripay' ? updatedProvider.mode : gateways.tripay.mode) !== 'production',
            merchantCode: gateways.tripay.merchantCode || '',
            apiKey: activeSub === 'tripay' ? pubKey : gateways.tripay.apiKey,
            privateKey: activeSub === 'tripay' ? secKey : gateways.tripay.privateKey,
            secretKey: activeSub === 'tripay' ? secKey : gateways.tripay.privateKey,
            webhookUrl: `${window.location.origin}/api/payment/webhook`,
          },
        },
      };

      if (activeSub === 'doku') {
        const dokuWebhook = `${window.location.origin}/api/payment/webhook`;
        const posQrisSyncPayload = {
          acceptQris: dokuEnabled,
          enableQRIS: dokuEnabled,
          payment: {
            enableQRIS: dokuEnabled,
            acceptQris: dokuEnabled,
          },
          updatedAt: nowIso,
        };
        syncDokuToLocalStorage({
          dokuEnabled,
          environment: gateways.doku.mode,
          clientId: gateways.doku.clientId,
          secretKey: gateways.doku.sharedKey,
          webhookUrl: dokuWebhook,
        });

        await Promise.all([
          setDoc(doc(db, 'settings', 'payment_gateways'), unifiedGatewaysPayload, { merge: true }),
          setDoc(
            doc(db, 'settings', 'payment_gateway'),
            {
              dokuEnabled,
              environment: gateways.doku.mode,
              clientId: gateways.doku.clientId,
              secretKey: gateways.doku.sharedKey,
              sharedKey: gateways.doku.sharedKey,
              webhookUrl: dokuWebhook,
              doku: updatedProvider,
              updatedAt: nowIso,
            },
            { merge: true }
          ),
          setDoc(doc(db, 'settings', 'pos'), posQrisSyncPayload, { merge: true }),
          setDoc(doc(db, 'settings', 'pos_config'), posQrisSyncPayload, { merge: true }),
          setDoc(doc(db, 'stores', 'store_001', 'settings', 'pos'), posQrisSyncPayload, {
            merge: true,
          }),
        ]);
      } else {
        await Promise.all([
          setDoc(doc(db, 'settings', 'payment_gateways'), unifiedGatewaysPayload, { merge: true }),
          setDoc(
            doc(db, 'settings', 'payment_gateway'),
            {
              [activeSub]: updatedProvider,
              updatedAt: nowIso,
            },
            { merge: true }
          ),
        ]);
      }

      await logRealAudit({
        action: 'UPDATE_PAYMENT_GATEWAY',
        module: 'PAYMENT_GATEWAY',
        details: `Menyimpan konfigurasi ${activeSub.toUpperCase()} (${activeGw.mode.toUpperCase()}) ke settings/payment_gateways`,
      });
    } catch (err) {
      console.warn('Error saving payment gateway config:', err);
    }
    setSavedMessage(
      `Kredensial & konfigurasi ${activeSub.toUpperCase()} berhasil disimpan ke Firestore (settings/payment_gateways)!`
    );
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-black text-white tracking-tight">
            INTEGRASI PAYMENT GATEWAY INDONESIA
          </h1>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Arsitektur terpusat QRIS nasional, Virtual Account bank, rekonsiliasi fee, dan monitoring settlement otomatis.
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto w-full max-w-none mb-4">
        <button
          onClick={() => setActiveSub('xendit')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'xendit' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>Xendit</span>
        </button>
        <button
          onClick={() => setActiveSub('doku')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'doku' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Doku</span>
        </button>
        <button
          onClick={() => setActiveSub('midtrans')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'midtrans' ? 'bg-cyan-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Midtrans</span>
        </button>
        <button
          onClick={() => setActiveSub('tripay')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
            activeSub === 'tripay' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>Tripay</span>
        </button>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{savedMessage}</span>
        </div>
      )}

      {/* Gateway Overview Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-blue-400 uppercase bg-blue-950/80 border border-blue-800 px-2 py-0.5 rounded">
                {activeSub.toUpperCase()} INTEGRATION
              </span>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                  activeSub === 'doku'
                    ? dokuEnabled
                      ? 'bg-emerald-950/80 border-emerald-700/80 text-emerald-400'
                      : 'bg-rose-950/80 border-rose-800/80 text-rose-400'
                    : isConnected
                    ? 'bg-emerald-950/80 border-emerald-700/80 text-emerald-400'
                    : hasSavedCredential
                    ? 'bg-amber-950/80 border-amber-700/80 text-amber-400'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    activeSub === 'doku'
                      ? dokuEnabled
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-rose-500'
                      : isConnected
                      ? 'bg-emerald-400 animate-pulse'
                      : hasSavedCredential
                      ? 'bg-amber-400'
                      : 'bg-zinc-500'
                  }`}
                />
                {computedStatus}
              </span>
            </div>
            <h3 className="font-black text-white text-lg mt-1.5">{activeGw.name}</h3>
            {activeSub === 'doku' && (
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {dokuEnabled
                  ? '✅ Pembayaran QRIS Dinamis aktif di Terminal Kasir POS (/dashboard/pos).'
                  : '⚠️ Pembayaran QRIS Dinamis saat ini dinonaktifkan dan disembunyikan dari Kasir POS.'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Interactive ON / OFF Switch for DOKU Payment Gateway */}
            {activeSub === 'doku' && (
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800">
                <Power
                  className={`w-4 h-4 ${
                    dokuEnabled ? 'text-emerald-400' : 'text-zinc-500'
                  }`}
                />
                <span className="text-xs font-bold text-zinc-200">
                  Aktifkan Pembayaran DOKU (QRIS POS):
                </span>
                <div className="inline-flex rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
                  <button
                    type="button"
                    disabled={isTogglingDoku}
                    onClick={() => handleToggleDokuEnabled(true)}
                    className={`px-3 py-1 rounded-md text-xs font-black transition cursor-pointer ${
                      dokuEnabled
                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/40'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    ON
                  </button>
                  <button
                    type="button"
                    disabled={isTogglingDoku}
                    onClick={() => handleToggleDokuEnabled(false)}
                    className={`px-3 py-1 rounded-md text-xs font-black transition cursor-pointer ${
                      !dokuEnabled
                        ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/40'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    OFF
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleTestWebhook}
              disabled={isTestingWebhook}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-zinc-400 ${
                  isTestingWebhook ? 'animate-spin' : ''
                }`}
              />
              <span>
                {isTestingWebhook ? 'Memvalidasi ke Gateway...' : 'Tes Koneksi & Buat Invoice Test'}
              </span>
            </button>
          </div>
        </div>

        {webhookFeedback && (
          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-200 flex flex-wrap items-center justify-between gap-2">
            <span>{webhookFeedback}</span>
            {testCheckoutUrl && (
              <a
                href={testCheckoutUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Buka Link Pembayaran Test</span>
              </a>
            )}
          </div>
        )}

        {/* Configuration Form */}
        <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
          <div>
            <label className="block text-zinc-400 font-bold mb-1">Environment Mode:</label>
            <select
              value={activeGw.mode}
              onChange={(e) => updateActiveGatewayField('mode', e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-bold"
            >
              <option value="production">Production (Real Money / Live Settlement)</option>
              <option value="sandbox">Sandbox (Testing Simulator)</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 font-bold mb-1">Webhook Endpoint URL (Auto):</label>
            <input
              type="text"
              readOnly
              value={activeGw.webhookUrl}
              className="w-full bg-zinc-950/70 border border-zinc-800/80 rounded-xl px-3 py-2 text-zinc-400 font-mono"
            />
          </div>

          {(activeSub === 'tripay' || activeSub === 'midtrans') && (
            <div className="md:col-span-2">
              <label className="block text-zinc-400 font-bold mb-1">
                {activeSub === 'tripay' ? 'Merchant Code Tripay (contoh: T12345):' : 'Merchant ID Midtrans ( contoh: G123456789):'}
              </label>
              <input
                type="text"
                value={
                  activeSub === 'tripay'
                    ? gateways.tripay.merchantCode
                    : gateways.midtrans.merchantCode
                }
                onChange={(e) => updateActiveGatewayField('merchantCode', e.target.value)}
                placeholder={
                  activeSub === 'tripay'
                    ? 'Masukkan Kode Merchant Tripay...'
                    : 'Masukkan Merchant ID Midtrans...'
                }
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-zinc-400 font-bold mb-1">
              {activeSub === 'doku'
                ? 'Client ID:'
                : activeSub === 'midtrans'
                ? 'Client Key:'
                : activeSub === 'tripay'
                ? 'API Key Tripay:'
                : 'Public Key:'}
            </label>
            <input
              type="text"
              value={getPublicCredential(activeSub)}
              onChange={(e) => updateActiveGatewayField('public', e.target.value)}
              placeholder={
                activeSub === 'doku'
                  ? 'Masukkan Client ID DOKU (contoh: BRN-0291-...)...'
                  : activeSub === 'midtrans'
                  ? 'Masukkan Client Key Midtrans...'
                  : activeSub === 'tripay'
                  ? 'Masukkan API Key Tripay (DEV-...)...'
                  : 'Masukkan Public Key Xendit...'
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-zinc-400 font-bold mb-1">
              {activeSub === 'doku'
                ? 'Shared Key (Secret Key):'
                : activeSub === 'midtrans'
                ? 'Server Key:'
                : activeSub === 'tripay'
                ? 'Private Key Tripay (HMAC-SHA256):'
                : 'Secret Key:'}
            </label>
            <input
              type="password"
              value={getSecretCredential(activeSub)}
              onChange={(e) => updateActiveGatewayField('secret', e.target.value)}
              placeholder={
                activeSub === 'doku'
                  ? 'Masukkan Shared Key DOKU (SK-...)...'
                  : activeSub === 'midtrans'
                  ? 'Masukkan Server Key Midtrans...'
                  : activeSub === 'tripay'
                  ? 'Masukkan Private Key Tripay...'
                  : 'Masukkan Secret Key Xendit...'
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
            />
          </div>

          <div className="md:col-span-2 pt-2 border-t border-zinc-800 flex flex-wrap justify-between items-center gap-3">
            <div className="text-[11px] text-zinc-400 flex items-center gap-3">
              <span>
                Jadwal Pencairan: <strong className="text-white">{activeGw.settlementTime}</strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span>
                Potongan Fee QRIS (MDR): <strong className="text-amber-400">0.7%</strong>
              </span>
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Kredensial {activeSub.toUpperCase()}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Gateway Settlement Log */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span>Log Transaksi &amp; Settlement {activeSub.toUpperCase()}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
              REAL-TIME FIRESTORE ({gatewayTransactions.length})
            </span>
          </h3>
          <span className="text-[11px] text-zinc-400">
            Otomatis membaca transaksi QRIS POS &amp; callback settlement DOKU (MDR 0.7%)
          </span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Payment ID</th>
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">No. Order POS</th>
                <th className="py-3 px-4">Metode Bayar</th>
                <th className="py-3 px-4 text-right">Potongan Fee MDR (0.7%)</th>
                <th className="py-3 px-4 text-right">Nominal Bersih</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {gatewayTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-zinc-500 text-xs">
                    Belum ada transaksi {activeSub.toUpperCase()} QRIS tercatat. Buat transaksi dengan metode QRIS di Terminal Kasir POS untuk melihat log settlement secara real-time.
                  </td>
                </tr>
              ) : (
                gatewayTransactions.map((gt) => (
                  <tr key={gt.id} className="hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-blue-400">
                      {gt.paymentId || gt.id}
                    </td>
                    <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">{gt.time}</td>
                    <td className="py-3 px-4 font-mono text-zinc-200 font-semibold">
                      #{String(gt.orderId).replace(/^#/, '')}
                    </td>
                    <td className="py-3 px-4 font-bold text-white">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-[11px]">
                        <QrCode className="w-3 h-3 text-emerald-400" />
                        {gt.channel}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-rose-400">
                      -Rp {Number(gt.fee || 0).toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                      Rp {Number(gt.netAmount ?? gt.amount - gt.fee).toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {gt.isSettled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          LUNAS (SETTLED)
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800 animate-pulse">
                            <Clock className="w-3 h-3" />
                            PENDING
                          </span>
                          <button
                            type="button"
                            disabled={confirmingTxId === gt.transactionId}
                            onClick={() => handleConfirmPendingSettlement(gt)}
                            className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition cursor-pointer"
                            title="Konfirmasi Pelunasan Manual / Settlement"
                          >
                            {confirmingTxId === gt.transactionId ? '...' : 'Settle'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
