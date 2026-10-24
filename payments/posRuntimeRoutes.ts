/**
 * RiskCart POS runtime routes:
 *   GET  /api/whoami        -> IP & user-agent asli pemanggil (untuk audit)
 *   POST /api/audit-log     -> tulis audit log dengan IP, user-agent & identitas dari token server (bukan teks hardcode)
 *   POST /api/print/escpos  -> kirim struk / buka laci ke printer jaringan ESC/POS (TCP 9100)
 *                              catatan: hanya bisa jika server berada di jaringan LAN yang sama dengan printer
 */
import type { Express, Request } from 'express';
import net from 'net';
import type { ServerStore } from './serverStore.ts';
import { verifySignedSessionToken } from '../src/middleware/auth.ts';

export function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] || '') || req.socket.remoteAddress || '';
}

function sessionFrom(req: Request) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return null;
  try {
    return verifySignedSessionToken(h.slice(7).trim());
  } catch {
    return null;
  }
}

// ---------------- ESC/POS helpers ----------------
const ESC = 0x1b;
const GS = 0x1d;
export function buildEscPos(opts: {
  lines?: string[];
  cut?: boolean;
  openDrawer?: boolean;
  copies?: number;
}): Buffer {
  const parts: Buffer[] = [];
  const copies = Math.min(Math.max(Number(opts.copies) || 1, 1), 3);
  const lines = Array.isArray(opts.lines) ? opts.lines : [];
  for (let c = 0; c < (lines.length ? copies : 0); c++) {
    parts.push(Buffer.from([ESC, 0x40])); // init
    for (const l of lines) parts.push(Buffer.from(String(l).normalize('NFKD').replace(/[^\x20-\x7E]/g, '') + '\n', 'ascii'));
    parts.push(Buffer.from('\n\n\n', 'ascii'));
    if (opts.cut) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00])); // partial cut
  }
  if (opts.openDrawer) parts.push(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa])); // pulse pin 2
  return Buffer.concat(parts);
}

function sendTcp(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port, timeout: 4000 }, () => {
      sock.write(data, () => sock.end());
    });
    sock.on('close', () => resolve());
    sock.on('timeout', () => {
      sock.destroy();
      reject(new Error(`Printer ${ip}:${port} tidak merespons (timeout).`));
    });
    sock.on('error', (e) => reject(e));
  });
}

const isPrivateIp = (ip: string) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip) && /^[\d.]+$/.test(ip);

export function registerPosRuntimeRoutes(app: Express, store: ServerStore) {
  app.get('/api/whoami', (req, res) => {
    const s = sessionFrom(req);
    res.json({
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
      uid: s?.uid || null,
      role: s?.role || null,
    });
  });

  app.post('/api/audit-log', async (req, res) => {
    try {
      const s = sessionFrom(req);
      const b = req.body || {};
      const nowIso = new Date().toISOString();
      const action = String(b.action || '').slice(0, 80);
      if (!action) return res.status(400).json({ success: false, error: 'action wajib' });
      const entry = {
        action,
        type: String(b.type || action).slice(0, 80),
        target: String(b.target || '').slice(0, 500),
        user: String(b.user || s?.uid || 'unknown').slice(0, 120),
        userRole: String(b.userRole || s?.role || '').slice(0, 40),
        verifiedUid: s?.uid || null,
        verifiedRole: s?.role || null,
        verified: !!s,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
        meta: typeof b.meta === 'object' && b.meta ? b.meta : null,
        storeId: 'store_001',
        createdAt: nowIso,
        timestamp: nowIso,
      };
      await store.add('audit_logs', entry);
      res.json({ success: true, ip: entry.ip });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  app.post('/api/print/escpos', async (req, res) => {
    try {
      const { ip, port = 9100, lines = [], cut = true, openDrawer = false, copies = 1 } = req.body || {};
      const host = String(ip || '').trim();
      if (!isPrivateIp(host)) return res.status(400).json({ success: false, error: 'IP printer harus IP jaringan lokal (mis. 192.168.x.x).' });
      await sendTcp(host, Number(port) || 9100, buildEscPos({ lines, cut, openDrawer, copies }));
      if (openDrawer && !(lines || []).length) {
        await store.add('audit_logs', {
          action: 'DRAWER_KICK',
          type: 'DRAWER_KICK',
          target: `Laci kasir dibuka via printer ${host}`,
          user: sessionFrom(req)?.uid || String(req.body?.user || 'unknown'),
          ip: clientIp(req),
          storeId: 'store_001',
          createdAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(502).json({ success: false, error: e?.message || 'Gagal kirim ke printer' });
    }
  });
}
