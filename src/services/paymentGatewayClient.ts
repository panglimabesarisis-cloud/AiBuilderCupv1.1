import QRCode from 'qrcode';
import { auth } from '../firebase';
import { getServerToken } from './firebaseSession';

export type ProviderId = 'xendit' | 'midtrans' | 'doku' | 'tripay';

export interface ProviderPublicConfig {
  enabled: boolean;
  mode: 'sandbox' | 'production';
  publicFields: Record<string, string>;
  secretLast4: Record<string, string>;
  verified: boolean;
  lastTestAt?: string;
  lastTestMessage?: string;
  updatedAt?: string;
}

export interface PaymentConfigResponse {
  success: boolean;
  providers: Record<ProviderId, ProviderPublicConfig>;
  activeQrisProvider: ProviderId | null;
  webhooks: Record<ProviderId, string>;
  envOverrides: Record<ProviderId, string[]>;
  encryptionReady: boolean;
  error?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const serverToken = getServerToken();
  if (serverToken) {
    h.Authorization = `Bearer ${serverToken}`;
    return h;
  }
  try {
    const token = await auth?.currentUser?.getIdToken();
    if (token) h.Authorization = `Bearer ${token}`;
  } catch {}
  return h;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(await authHeaders()), ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
  return json as T;
}

export const paymentGatewayApi = {
  getConfig: () => call<PaymentConfigResponse>('/api/payments/config'),
  saveConfig: (
    provider: ProviderId,
    body: {
      enabled?: boolean;
      mode?: 'sandbox' | 'production';
      publicFields?: Record<string, string>;
      secrets?: Record<string, string>;
      setActive?: boolean;
    }
  ) => call<PaymentConfigResponse>(`/api/payments/config/${provider}`, { method: 'POST', body: JSON.stringify(body) }),
  test: (provider: ProviderId) =>
    call<{ success: boolean; message: string }>(`/api/payments/test/${provider}`, { method: 'POST', body: '{}' }),
  createQris: async (body: {
    transactionId: string;
    invoiceNumber: string;
    amount: number;
    customerName?: string;
    isOrder?: boolean;
    gateway?: ProviderId;
    items?: Array<{ id?: string; name?: string; price: number; quantity: number }>;
  }) => {
    try {
      const directRes = await call<{
        success: boolean;
        gateway: ProviderId;
        mode: string;
        orderId: string;
        paymentUrl?: string;
        qrString?: string;
        token?: string;
        reference?: string;
      }>('/api/payment/create', {
        method: 'POST',
        body: JSON.stringify({
          gateway: body.gateway,
          orderId: body.invoiceNumber || body.transactionId,
          transactionId: body.transactionId,
          amount: body.amount,
          customerName: body.customerName || 'Walk-in Customer',
          items: body.items,
        }),
      });
      const qrPayload = directRes.qrString || directRes.paymentUrl || body.invoiceNumber || body.transactionId;
      const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 340,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      const gross = Math.max(1, Math.round(Number(body.amount || 0)));
      const mdrFee = Math.round(gross * 0.007);
      return {
        success: true,
        provider: (directRes.gateway || 'midtrans') as ProviderId,
        mode: directRes.mode || 'sandbox',
        paymentId:
          directRes.reference ||
          directRes.token ||
          `${String(directRes.gateway || 'GW').toUpperCase()}-${String(body.invoiceNumber || body.transactionId).slice(-8)}`,
        amount: gross,
        mdrFee,
        netAmount: Math.max(0, gross - mdrFee),
        qrString: directRes.qrString || '',
        checkoutUrl: directRes.paymentUrl || '',
        qrCodeDataUrl,
        sourceGateway: `${String(directRes.gateway || 'midtrans').toUpperCase()} (${directRes.mode || 'sandbox'})`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    } catch (directErr) {
      // Fallback to encrypted server-side /api/payments/create
      try {
        return await call<{
          success: boolean;
          provider: ProviderId;
          mode: string;
          paymentId: string;
          amount: number;
          mdrFee: number;
          netAmount: number;
          qrString: string;
          checkoutUrl: string;
          qrCodeDataUrl: string;
          sourceGateway: string;
          expiresAt: string;
        }>('/api/payments/create', { method: 'POST', body: JSON.stringify(body) });
      } catch {
        throw directErr;
      }
    }
  },
  simulatePaid: async (transactionId: string, orderId?: string) => {
    try {
      return await call<{ success: boolean; message: string }>('/api/payments/simulate-paid', {
        method: 'POST',
        body: JSON.stringify({ transactionId }),
      });
    } catch {
      return await call<{ success: boolean; message: string }>('/api/payment/webhook', {
        method: 'POST',
        body: JSON.stringify({
          transactionId,
          order_id: orderId || transactionId,
          transaction_status: 'settlement',
          status: 'PAID',
        }),
      });
    }
  },
};

