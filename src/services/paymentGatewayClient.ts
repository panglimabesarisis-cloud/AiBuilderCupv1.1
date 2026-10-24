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
  // Prioritas: session token server (login PIN owner) -> Firebase ID token
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
  createQris: (body: { transactionId: string; invoiceNumber: string; amount: number; customerName?: string; isOrder?: boolean }) =>
    call<{
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
    }>('/api/payments/create', { method: 'POST', body: JSON.stringify(body) }),
  simulatePaid: (transactionId: string) =>
    call<{ success: boolean; message: string }>('/api/payments/simulate-paid', {
      method: 'POST',
      body: JSON.stringify({ transactionId }),
    }),
};
