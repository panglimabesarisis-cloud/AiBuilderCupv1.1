import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase';

/** Ambil session token server (hasil verifikasi PIN owner/staff). */
export function getServerToken(): string {
  try {
    return sessionStorage.getItem('riskcart_server_token') || '';
  } catch {
    return '';
  }
}

/**
 * Tukar session token server -> Firebase custom token lalu login Firebase Auth,
 * supaya security rules (request.auth.token.role) mengizinkan baca/tulis Firestore.
 */
export async function ensureFirebaseSession(): Promise<boolean> {
  try {
    if (!auth) return false;
    if (auth.currentUser && !auth.currentUser.isAnonymous) return true;
    const serverToken = getServerToken();
    if (!serverToken) return false;
    const res = await fetch('/api/auth/firebase-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
      body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.customToken) {
      console.warn('[firebaseSession] gagal mendapat custom token:', json?.error || res.status);
      return false;
    }
    await signInWithCustomToken(auth, json.customToken);
    return true;
  } catch (e) {
    console.warn('[firebaseSession] signIn gagal:', e);
    return false;
  }
}
