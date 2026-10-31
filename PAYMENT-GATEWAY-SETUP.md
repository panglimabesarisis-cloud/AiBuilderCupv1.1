# RiskCart — Audit Store Settings & Integrasi Payment Gateway

## 1. Hasil audit (sebelum patch)

| Halaman | Baca/tulis DB? | Dipakai mesin kasir? | Status |
|---|---|---|---|
| /pengaturan-pos/umum | Ya (`settings/pos` + `stores/store_001/settings/pos`) | **Tidak** (auto-lock, beep, barcode enter, diskon manual, laci otomatis) | Tersimpan, tapi tidak berpengaruh |
| /pengaturan-pos/toko | Ya | Sebagian: nama, alamat, footer struk, PPN, pembulatan ✅ — NPWP ❌ | Terkoneksi |
| /pengaturan-pos/pembayaran | Ya | Cash/Kasbon/COD/pembulatan ✅ — QRIS & EDC toggle ❌, alert kas laci ❌, wajib hitung kas ❌ | Sebagian |
| /pengaturan-pos/printer-struk | Ya | **Tidak**; preview struk pakai item hardcode | Tersimpan, tidak berpengaruh |
| /pengaturan-pos/global-setup | Ya | PPN ✅ — mata uang, timezone, service charge, format SKU, ambang stok ❌ | Sebagian |
| /pengaturan-pos/hak-akses | Ya, **PIN disimpan plaintext** | **Tidak** (POS pakai PIN staff/ENV, bukan PIN ini) | Tidak aman + tidak berpengaruh |
| /pengaturan-pos/backup-restore | Tabel baca `backup_snapshots` (tidak ada yang menulis) | Tombol unduh = JSON palsu (recordsCount 1240, checksum teks) ; **tidak ada restore** | **DUMMY** (reset DB nyata) |
| /pengaturan-pos/payment-gateway | Tabel baca `settlement_history` (tidak ada yang menulis) | Input key **readOnly**, Test Connection = `setTimeout` palsu, status/metode hardcode, tidak ada tombol simpan, webhook Xendit/Midtrans/Tripay **tidak ada di server**, Tripay tidak ada backend | **DUMMY** |
| /pengaturan-pos/audit-log | Ya (`audit_logs` realtime) | Tombol Refresh palsu, user "Owner Admin" & IP hardcode | Terkoneksi, data meta palsu |

### Temuan kritis (anti-fraud)
1. **QRIS palsu**: `/api/doku/create-qris` gagal → membuat string EMVCo dengan NMID karangan; POS juga punya fallback QR hardcode (CRC `A1B2`). QR ini tidak bisa dibayar.
2. **Kasir bisa "tandai lunas"**: tombol konfirmasi menulis `LUNAS` langsung ke Firestore + `/api/doku/confirm-payment` & `/api/webhooks/doku` tanpa verifikasi signature → siapa pun bisa melunasi transaksi tanpa uang masuk. Ini persis celah fraud yang mau dicegah RiskCart.
3. **Secret key terbuka**: DOKU secret disimpan plaintext di `settings/payment_gateway` dan dikirim ke browser kasir; `firestore.rules` mengizinkan read/write publik (`allow ... if true`).
4. Dua halaman payment terpisah (`/dashboard/payment/*` dan `/pengaturan-pos/payment-gateway`) dengan data berbeda.
5. **(Versi zip terbaru) Rules Firestore ketat, tapi aplikasi tidak pernah login Firebase Auth.** Semua rule butuh `request.auth`, sedangkan app hanya memakai PIN + session token server. Akibatnya, jika rules ini aktif: semua halaman (termasuk Store Settings) tidak bisa baca/tulis database, tombol Simpan gagal diam-diam, dan server (yang memakai client SDK tanpa login) juga ditolak — termasuk simpan/verifikasi PIN dan webhook. `settings/*` juga `write: false` dan `stores/{id}/...` tidak punya rule sama sekali.
6. Deploy: `package-lock.json` tidak sinkron (Dockerfile `npm ci` gagal), konflik peer `esbuild`, `start` memakai `node server.ts` di Node 20.

## 2. Yang diubah oleh patch

| File | Perubahan |
|---|---|
| `payments/gatewayRouter.ts` (baru) | Backend nyata Xendit / Midtrans / DOKU / Tripay: simpan config (secret AES-256-GCM), test koneksi ke API asli, create QRIS dinamis, webhook **terverifikasi signature**, cek nominal (mismatch → audit log `PAYMENT_AMOUNT_MISMATCH`), tulis `payment_intents`, `transactions`, `settlement_history`, `cash_flows`, `pos_incomes`, `audit_logs` |
| `server.ts` | rawBody untuk verifikasi signature, daftarkan router, matikan endpoint lama `/api/doku/confirm-payment` & `/api/doku/create-qris` (410) |
| `src/components/settings/PaymentGatewaySettings.tsx` (baru) | Form nyata 4 provider, Test Connection asli, pilih provider QRIS aktif, URL webhook, tabel tagihan & settlement realtime |
| `src/services/paymentGatewayClient.ts` (baru) | Client API + Firebase ID token |
| `POSSettingsModule.tsx` | Tab payment-gateway pakai komponen baru; gatewaysData dihapus dari `settings/pos`; PIN di-hash via `/api/settings/pin`; backup = export koleksi nyata + SHA-256 + restore; audit log user/waktu nyata & urut terbaru; outlet dari koleksi `outlets`; error simpan ditampilkan |
| `PosMachine.tsx` | QRIS via `/api/payments/create`, tanpa QR palsu; tombol konfirmasi hanya simulasi SANDBOX; LUNAS hanya dari webhook |
| `App.tsx` | `/dashboard/payment/*` memakai komponen yang sama (satu sumber data) |
| `payments/serverStore.ts` (baru) | Server memakai **Firebase Admin SDK** (`FIREBASE_SERVICE_ACCOUNT`) agar lolos rules ketat; fallback client SDK |
| `server.ts` (tambahan) | Endpoint `/api/auth/firebase-token` (session token PIN → Firebase custom token berisi role); simpan/verifikasi PIN lewat Admin SDK |
| `src/services/firebaseSession.ts` (baru) + `AccessControlContext.tsx` | Setelah login PIN owner, app otomatis login Firebase Auth (custom token) & dipulihkan saat reload |
| `firestore.rules` | Role dibaca dari token; staff baca `settings`, owner tulis (kecuali `payment_gateway`); rule untuk `stores/{id}/...`; `payment_gateway_secrets`, `payment_intents`, `settlement_history` hanya ditulis server; katalog PWA bisa dibaca publik |
| `package.json`, `package-lock.json` | + `firebase-admin`, esbuild ^0.28, `start: tsx server.ts`, lock disinkronkan |

## 3. Setup (sekali)

**Env server (AI Studio → Secrets / Cloud Run → Variables):**
```
PAYMENT_ENC_KEY=<string acak ≥32 karakter>     # wajib untuk simpan secret di DB
PUBLIC_BASE_URL=<URL_APP_ANDA>  # URL publik app, untuk webhook
PIN_SALT=<string acak>
FIREBASE_SERVICE_ACCOUNT=<isi JSON service account>  # WAJIB untuk rules ketat
```
Cara dapat `FIREBASE_SERVICE_ACCOUNT`: Firebase Console → project **<PROJECT_ID>** → ⚙ Project settings → **Service accounts** → **Generate new private key** → buka file JSON → copy seluruh isinya ke secret tersebut.

Deploy rules: Firebase Console → Firestore → (database `ai-studio-…`) → **Rules** → tempel isi `firestore.rules` → **Publish**.
Opsional (lebih aman, prioritas di atas DB): `XENDIT_SECRET_KEY, XENDIT_CALLBACK_TOKEN, MIDTRANS_SERVER_KEY, DOKU_CLIENT_ID, DOKU_SECRET_KEY, TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE`.

**Per provider (mode SANDBOX dulu):**
| Provider | Isi di RiskCart | Daftarkan di dashboard provider |
|---|---|---|
| Xendit | Secret Key (`xnd_development_…`), Webhook Verification Token | Settings → Webhooks → QR Code paid: `{PUBLIC_BASE_URL}/api/webhooks/xendit` |
| Midtrans | Merchant ID, Client Key, Server Key | Settings → Payment → Notification URL: `/api/webhooks/midtrans` ; aktifkan QRIS/GoPay |
| DOKU | Client ID, Secret Key | Back Office → Notification URL: `/api/webhooks/doku` ; aktifkan QRIS di Checkout |
| Tripay | Kode Merchant, API Key, Private Key | Merchant → URL Callback: `/api/webhooks/tripay` ; aktifkan channel QRIS |

Lalu: **Simpan → Test Connection → Jadikan QRIS POS**.

Uji: buat transaksi QRIS di POS → scan QR (Xendit sandbox: tombol konfirmasi memanggil simulator resmi; Midtrans: simulator.sandbox.midtrans.com; Tripay: simulator di dashboard sandbox) → webhook masuk → modal POS tertutup otomatis, muncul di Riwayat Settlement & Audit Log.

> Catatan: webhook butuh URL publik. Jika URL AI Studio memerlukan login Google, deploy ke Cloud Run publik (Dockerfile sudah siap).
> DOKU Checkout menghasilkan link (QR berisi URL halaman bayar DOKU). QRIS mentah DOKU butuh SNAP API (token B2B + RSA) — gunakan Xendit/Midtrans/Tripay untuk QR langsung di layar kasir.

## 4. Status setelah patch v3 — setiap pengaturan dipakai POS

| Halaman | Setting | Dipakai di |
|---|---|---|
| Umum | Auto-lock (menit) | POS terkunci otomatis saat tidak aktif (`lockPosSession`) + audit `POS_AUTO_LOCK` |
| Umum | Scanner Enter / Beep | Scanner barcode (keyboard wedge) di POS; bunyi saat item masuk keranjang |
| Umum | Diskon manual + batas % | Kolom Diskon di keranjang; di atas batas / dinonaktifkan → PIN supervisor; tersimpan di transaksi |
| Umum | Buka laci otomatis (tunai) | Kirim pulsa laci ESC/POS setelah bayar tunai (printer LAN) |
| Pembayaran | Cash/QRIS/EDC/Kasbon/COD | Tombol metode bayar POS (QRIS juga butuh gateway aktif; EDC wajib kode approval) |
| Pembayaran | Pembulatan | Total POS & struk |
| Pembayaran | Peringatan kas laci | Banner merah di POS bila kas tunai shift > batas |
| Pembayaran | Wajib hitung kas | Form pecahan uang wajib saat Tutup Shift, tersimpan `cashDenominations` |
| Printer Struk | Interface, kertas, IP/port, auto-cut, salinan, logo, PPN, poin, QR, NPWP, footer | `receiptPrinter.ts` (POS, riwayat transaksi, Test Print); preview dari transaksi terakhir |
| Global Setup | Mata uang | Diterapkan ke seluruh aplikasi saat disimpan |
| Global Setup | Zona waktu | Tanggal di struk & aturan "struk hari sebelumnya" |
| Global Setup | PPN, Service charge | Perhitungan total POS + struk |
| Global Setup | Format SKU | Generator SKU form tambah produk (`{RAND4} {RAND6} {YY} {MM} {YYMM} {SEQ}`) |
| Global Setup | Stok minimum default | Ambang stok kritis di POS, dashboard asset, inventory, AI |
| Hak Akses | PIN void / laci / cetak ulang | Modal otorisasi PIN Owner/Supervisor/Manager (`role: approver`), semua tercatat di audit |
| Hak Akses | PIN Supervisor/Manager | Disimpan hash di server, dipakai verifikasi di atas |
| Audit Log | User & IP | Ditulis server (`/api/audit-log`): IP asli dari request, user dari token login, user-agent, tanda "terverifikasi" |
| Backup & Restore | — | Export koleksi asli + SHA-256, restore dengan validasi checksum |
| Payment Gateway | — | Xendit/Midtrans/DOKU/Tripay nyata (lihat bagian 2–3) |

Keterbatasan jujur: browser tidak bisa mengirim pulsa laci / auto-cut ke printer USB — gunakan printer LAN, atau aktifkan "open drawer / auto cut" di driver printer USB. Printer LAN hanya bisa dijangkau bila server berjalan di jaringan toko.

## 5. Sisa pekerjaan — prompt singkat (satu prompt per masalah)

1. `Di PosPinGate.tsx (login kasir/staff), setelah PIN valid dan server mengembalikan token, simpan ke sessionStorage 'riskcart_server_token' lalu panggil ensureFirebaseSession() dari src/services/firebaseSession.ts. Hanya file itu.`
2. `Client PWA: setelah OTP WhatsApp sukses (/api/auth/verify-otp mengembalikan token), simpan ke sessionStorage 'riskcart_server_token', panggil ensureFirebaseSession(), dan isi customerUid = auth.currentUser.uid pada setiap order. Hanya file login & checkout PWA.`
3. `Di server.ts, ganti semua getDoc/setDoc/getDocs/addDoc yang memakai firestoreDb (OTP, products, safes, page builder, google drive) menjadi serverStore.get/set/list/add. Jangan ubah logika lain.`
