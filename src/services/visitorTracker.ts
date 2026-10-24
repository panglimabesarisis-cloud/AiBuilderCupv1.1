import React, { useEffect, useRef } from 'react';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

interface VisitorMeta {
  ip: string;
  lokasi: string;
  os: string;
  operatingSystem: string;
}

function getOSDetails(): { os: string; operatingSystem: string } {
  const ua = navigator.userAgent;
  let os = 'Unknown';
  let operatingSystem = navigator.platform || 'Unknown OS';

  if (/Windows NT 10.0/i.test(ua)) { os = 'Windows'; operatingSystem = 'Windows 10 / 11'; }
  else if (/Windows NT 6.3/i.test(ua)) { os = 'Windows'; operatingSystem = 'Windows 8.1'; }
  else if (/Windows NT 6.1/i.test(ua)) { os = 'Windows'; operatingSystem = 'Windows 7'; }
  else if (/Android/i.test(ua)) {
    os = 'Android';
    const match = ua.match(/Android\s([0-9.]+)/i);
    operatingSystem = match ? `Android ${match[1]}` : 'Android OS';
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = 'iOS';
    const match = ua.match(/OS\s([0-9_]+)/i);
    operatingSystem = match ? `iOS ${match[1].replace(/_/g, '.')}` : 'Apple iOS';
  } else if (/Mac OS X/i.test(ua)) {
    os = 'macOS';
    const match = ua.match(/Mac OS X\s([0-9_]+)/i);
    operatingSystem = match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    operatingSystem = 'Linux OS';
  }

  return { os, operatingSystem };
}

async function fetchVisitorMeta(): Promise<VisitorMeta> {
  const cached = sessionStorage.getItem('rc_v14_meta');
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  const { os, operatingSystem } = getOSDetails();
  let ip = '-';
  let lokasi = '-';

  try {
    const res = await fetch('https://ipapi.co/json/');
    if (res.ok) {
      const data = await res.json();
      ip = data.ip || '-';
      lokasi = [data.city, data.region, data.country_name].filter(Boolean).join(', ') || '-';
    }
  } catch {
    try {
      const resFallback = await fetch('https://api.ipify.org?format=json');
      if (resFallback.ok) {
        const fb = await resFallback.json();
        ip = fb.ip || '-';
      }
    } catch {}
  }

  const meta: VisitorMeta = { ip, lokasi, os, operatingSystem };
  sessionStorage.setItem('rc_v14_meta', JSON.stringify(meta));
  return meta;
}

function detectLoggedInUser(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (/user|auth|staff|session|pin|login|account|access/i.test(key)) {
        const raw = localStorage.getItem(key);
        if (!raw || raw === 'null' || raw === 'false') continue;
        try {
          const parsed = JSON.parse(raw);
          const username = parsed?.username || parsed?.name || parsed?.displayName || parsed?.email || parsed?.user?.username || parsed?.user?.name || parsed?.user?.email;
          if (username && typeof username === 'string') return username;
        } catch {
          if (raw.length > 1 && raw.length < 40 && !raw.includes('{')) return raw;
        }
      }
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || key.startsWith('rc_v14_')) continue;
      if (/user|auth|staff|session|pin|login|account|access/i.test(key)) {
        const raw = sessionStorage.getItem(key);
        if (!raw || raw === 'null' || raw === 'false') continue;
        try {
          const parsed = JSON.parse(raw);
          const username = parsed?.username || parsed?.name || parsed?.displayName || parsed?.email;
          if (username && typeof username === 'string') return username;
        } catch {}
      }
    }
  } catch {}
  return null;
}

function getFormattedDate(): string {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' WIB';
}

export async function sendWhatsAppNotification(halamanAkses: string, statusLogin: string) {
  try {
    const meta = await fetchVisitorMeta();
    await fetch('/api/visitor/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tanggal: getFormattedDate(),
        halamanAkses,
        statusLogin,
        meta,
      }),
    });
  } catch {
    // Silent ignore if visitor notification is disabled or unreachable
  }
}

export const VisitorTracker: React.FC = () => {
  const lastPageRef = useRef<string>('');
  const lastUserRef = useRef<string | null>(detectLoggedInUser());

  useEffect(() => {
    const getCurrentPageName = () => {
      const path = window.location.pathname + window.location.search + window.location.hash;
      return path && path !== '/' ? path : `${path || '/'} (${document.title || 'Home'})`;
    };

    const trackPageView = () => {
      const page = getCurrentPageName();
      if (lastPageRef.current === page) return;
      lastPageRef.current = page;

      const user = detectLoggedInUser();
      const loginStatus = user ? `View (${user})` : 'NO';
      sendWhatsAppNotification(page, loginStatus);
    };

    trackPageView();

    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function (...args) {
      origPush.apply(this, args);
      setTimeout(trackPageView, 150);
    };
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      setTimeout(trackPageView, 150);
    };

    window.addEventListener('popstate', trackPageView);
    window.addEventListener('hashchange', trackPageView);

    const timer = setInterval(() => {
      const currentUser = detectLoggedInUser();
      const currentPage = getCurrentPageName();

      if (currentUser && currentUser !== lastUserRef.current) {
        lastUserRef.current = currentUser;
        sessionStorage.setItem('rc_v14_login_ts', Date.now().toString());
        sessionStorage.removeItem('rc_v14_2h_sent');
        sendWhatsAppNotification(currentPage, `Login (${currentUser})`);
      }

      if (!currentUser && lastUserRef.current) {
        lastUserRef.current = null;
        sessionStorage.removeItem('rc_v14_login_ts');
        sessionStorage.removeItem('rc_v14_2h_sent');
      }

      if (currentUser) {
        let loginStart = Number(sessionStorage.getItem('rc_v14_login_ts'));
        if (!loginStart) {
          loginStart = Date.now();
          sessionStorage.setItem('rc_v14_login_ts', loginStart.toString());
        }

        const is2HoursSent = sessionStorage.getItem('rc_v14_2h_sent');
        if (Date.now() - loginStart >= TWO_HOURS_MS && !is2HoursSent) {
          sessionStorage.setItem('rc_v14_2h_sent', 'true');
          sendWhatsAppNotification(`${currentPage} [Buka > 2 Jam]`, `Login (${currentUser}) - Aktif > 2 Jam`);
        }
      }
    }, 3000);

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', trackPageView);
      window.removeEventListener('hashchange', trackPageView);
      clearInterval(timer);
    };
  }, []);

  return null;
};
