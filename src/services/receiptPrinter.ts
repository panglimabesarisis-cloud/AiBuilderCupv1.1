/**
 * Cetak struk sesuai pengaturan "Printer Struk":
 * - printerInterface 'usb' | 'bluetooth' -> print browser (printer terpasang di OS), lebar kertas 58/80mm
 * - printerInterface 'network'           -> ESC/POS via server /api/print/escpos (IP:port, auto-cut, laci)
 * Opsi: printCopies, printStoreLogo, printTaxDetail, printCustomerPoints, printReceiptBarcode, storeTaxNumber (NPWP), footer.
 */
import QRCode from 'qrcode';
import { formatDateTimeTz } from './posRuntime';
import { getServerToken as getServerTokenSafe } from './firebaseSession';

type Settings = Record<string, any> | null | undefined;

const money = (n: any) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

function normalizeItems(receipt: any): { name: string; qty: number; price: number; subtotal: number }[] {
  const src: any[] = Array.isArray(receipt?.items) ? receipt.items : [];
  return src.map((it) => {
    const p = it.product || {};
    const qty = Number(it.quantity ?? it.qty ?? it.quantityOrdered ?? 1);
    const price = Number(it.unitPrice ?? it.price ?? p.posPrice ?? p.pricePerUnit ?? p.sellPrice ?? 0);
    return {
      name: String(it.productName || it.name || p.name || 'Item'),
      qty,
      price,
      subtotal: Number(it.subtotal ?? price * qty),
    };
  });
}

export function receiptLines(receipt: any, s: Settings, width: number): string[] {
  const pad = (l: string, r: string) => {
    const space = Math.max(1, width - l.length - r.length);
    return (l + ' '.repeat(space) + r).slice(0, Math.max(width, l.length + r.length + 1));
  };
  const center = (t: string) => {
    const x = t.slice(0, width);
    return ' '.repeat(Math.max(0, Math.floor((width - x.length) / 2))) + x;
  };
  const hr = '-'.repeat(width);
  const out: string[] = [];
  out.push(center(String(receipt.storeName || s?.storeName || 'RiskCart Store').toUpperCase()));
  if (receipt.storeAddress || s?.storeAddress) out.push(center(String(receipt.storeAddress || s?.storeAddress)));
  if (s?.storePhone) out.push(center(`Telp ${s.storePhone}`));
  if (s?.storeTaxNumber) out.push(center(`NPWP ${s.storeTaxNumber}`));
  out.push(hr);
  out.push(pad(`No: ${receipt.orderNumber || receipt.id || '-'}`, ''));
  out.push(formatDateTimeTz(receipt.createdAt || receipt.timestamp || Date.now()));
  out.push(`Kasir: ${receipt.cashierName || receipt.cashier || '-'}`);
  if (receipt.customerName) out.push(`Pelanggan: ${receipt.customerName}`);
  out.push(hr);
  for (const it of normalizeItems(receipt)) {
    out.push(it.name.slice(0, width));
    out.push(pad(`  ${it.qty} x ${Math.round(it.price).toLocaleString('id-ID')}`, Math.round(it.subtotal).toLocaleString('id-ID')));
  }
  out.push(hr);
  out.push(pad('Subtotal', money(receipt.subtotal)));
  if (Number(receipt.discountAmount) > 0) out.push(pad(`Diskon ${receipt.discountPct || ''}%`, '-' + money(receipt.discountAmount)));
  if (Number(receipt.serviceChargeAmount) > 0) out.push(pad(`Service ${receipt.serviceChargeRate}%`, money(receipt.serviceChargeAmount)));
  if (s?.printTaxDetail !== false && Number(receipt.taxRate) > 0) out.push(pad(`PPN ${receipt.taxRate}%`, money(receipt.taxAmount)));
  if (Math.abs(Number(receipt.roundingDifference) || 0) > 0.5) out.push(pad('Pembulatan', money(receipt.roundingDifference)));
  out.push(pad('TOTAL', money(receipt.totalAmount ?? receipt.total)));
  out.push(pad(`Bayar (${receipt.paymentMethodLabel || receipt.paymentMethod || '-'})`, money(receipt.cashPaid ?? receipt.paidAmount)));
  if (Number(receipt.remainingDebt) > 0) out.push(pad('Sisa Tagihan', money(receipt.remainingDebt)));
  else out.push(pad('Kembali', money(receipt.change)));
  if (receipt.edcApprovalCode) out.push(pad('Approval EDC', String(receipt.edcApprovalCode)));
  if (s?.printCustomerPoints !== false && receipt.pointsEarned !== undefined) out.push(pad('Poin didapat', String(receipt.pointsEarned)));
  out.push(hr);
  if (receipt.isReprint) out.push(center('*** CETAK ULANG ***'));
  if (s?.storeFooterNote || receipt.storeFooterNote) out.push(String(receipt.storeFooterNote || s?.storeFooterNote));
  if (s?.printReceiptBarcode !== false) out.push(center(`Verifikasi: ${receipt.id || receipt.orderNumber}`));
  return out;
}

async function printViaBrowser(receipt: any, s: Settings) {
  const paper = s?.printerPaperSize === '58mm' ? 58 : 80;
  const width = paper === 58 ? 32 : 48;
  const lines = receiptLines(receipt, s, width);
  const qr =
    s?.printReceiptBarcode !== false
      ? await QRCode.toDataURL(`RISKCART-TX:${receipt.id || receipt.orderNumber || ''}`, { margin: 1, width: 160 })
      : '';
  const logo = s?.printStoreLogo !== false ? `<img src="${s?.storeLogoUrl || '/pwa-192x192.png'}" style="width:40%;filter:grayscale(1);display:block;margin:0 auto 4px" />` : '';
  const copies = Math.min(Math.max(Number(s?.printCopies) || 1, 1), 3);
  const block = `<div class="r">${logo}<pre>${lines.map((l) => l.replace(/</g, '&lt;')).join('\n')}</pre>${
    qr ? `<img src="${qr}" style="width:45%;display:block;margin:4px auto" />` : ''
  }</div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${paper}mm auto; margin: 0 }
    body { margin: 0; width: ${paper}mm; font-family: 'Courier New', monospace; font-size: ${paper === 58 ? 9 : 11}px; color: #000 }
    .r { padding: 2mm; page-break-after: always } pre { white-space: pre-wrap; margin: 0; font: inherit }
  </style></head><body>${Array.from({ length: copies }, () => block).join('')}</body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const d = frame.contentWindow!.document;
  d.open();
  d.write(html);
  d.close();
  await new Promise((r) => setTimeout(r, 350));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 4000);
}

async function postEscPos(body: Record<string, any>) {
  const token = getServerTokenSafe();
  const r = await fetch('/api/print/escpos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.error || `Printer HTTP ${r.status}`);
}

export async function printReceipt(receipt: any, s: Settings, opts: { openDrawer?: boolean } = {}) {
  if (s?.printerInterface === 'network' && s?.networkPrinterIp) {
    const width = s?.printerPaperSize === '58mm' ? 32 : 48;
    await postEscPos({
      ip: s.networkPrinterIp,
      port: Number(s.networkPrinterPort) || 9100,
      lines: receiptLines(receipt, s, width),
      cut: s.autoCutPaper !== false,
      copies: Number(s.printCopies) || 1,
      openDrawer: !!opts.openDrawer,
    });
    return;
  }
  await printViaBrowser(receipt, s);
}

/** Buka laci kasir: hanya bisa lewat printer jaringan ESC/POS (laci tersambung RJ11 ke printer). */
export async function kickCashDrawer(s: Settings): Promise<{ ok: boolean; message: string }> {
  if (s?.printerInterface !== 'network' || !s?.networkPrinterIp) {
    return {
      ok: false,
      message: 'Buka laci otomatis butuh printer LAN (Printer Struk > LAN/Ethernet). Untuk USB, aktifkan "open drawer" di driver printer.',
    };
  }
  try {
    await postEscPos({ ip: s.networkPrinterIp, port: Number(s.networkPrinterPort) || 9100, lines: [], openDrawer: true });
    return { ok: true, message: 'Laci kasir dibuka.' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Gagal membuka laci' };
  }
}
