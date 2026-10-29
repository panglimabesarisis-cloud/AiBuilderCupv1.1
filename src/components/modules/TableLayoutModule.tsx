import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  RotateCw,
  RotateCcw,
  Plus,
  Trash2,
  Users,
  Clock,
  ShoppingBag,
  CheckCircle2,
  User,
  Utensils,
  X,
  Grid,
  CreditCard,
  Calendar as CalendarIcon,
  Phone,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BarChart3,
  ListChecks,
  LayoutGrid,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Wallet,
  Edit3,
  Check,
  Save,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useAppData } from '../../context/AppDataContext';
import { fmtMoney, CurrencyMode } from '../../utils/money';
import { useLanguage } from '../../context/LanguageContext';
import { AppLink, useAppNavigation } from '../../router';
import { publishRealtimeEvent, subscribeRealtimeEvent } from '../../utils/realtimeSyncBus';
import {
  sanitizeForDatabase,
  syncDocToDatabase,
  deleteDocFromDatabase,
  autoResyncLocalCachesToServer,
} from '../../utils/dbSync';

export type TableShape = 'round' | 'rectangle' | 'square';
export type TableStatus = 'occupied' | 'available' | 'reserved' | 'billing';
export type TableZone = string;

export const DEFAULT_TABLE_AREAS: string[] = [
  'Indoor Utama',
  'VIP Room',
  'Outdoor Teras',
];

export interface TableOrderItem {
  id: string;
  productId?: string;
  name: string;
  qty: number;
  price: number;
  note?: string;
}

export interface RestaurantTableDoc {
  id: string;
  tableNumber: string;
  name: string;
  shape: TableShape;
  seats: number;
  x: number; // percentage 8..88
  y: number; // percentage 12..85
  rotation: number; // 0..360 degrees
  zone: TableZone;
  status: TableStatus;
  visitorName: string;
  visitorPax: number;
  seatedAt: string; // ISO string or HH:mm
  orders: TableOrderItem[];
  totalOrder: number;
  notes?: string;
  updatedAt: string;
}

export interface TableReservationDoc {
  id: string;
  reservationCode: string;
  nama: string;
  nomorHandphone: string;
  tanggal: string; // YYYY-MM-DD
  jamDatang: string; // HH:mm
  durasi: number; // minutes, e.g. 90, 120
  tableId: string;
  tableNumber: string;
  tableName: string;
  area: TableZone;
  visitorPax: number;
  orders: TableOrderItem[];
  totalOrder: number;
  downpayment: number;
  status: 'confirmed' | 'checked_in' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: string;
}

export interface DailyTableBookingRecord {
  id: string;
  tanggal: string; // YYYY-MM-DD
  jam: string; // HH:mm
  tableId: string;
  tableNumber: string;
  tableName: string;
  area: TableZone;
  visitorName: string;
  visitorCount: number;
  totalRevenue: number;
  durasiDineIn: number; // minutes
  source?: 'dine_in' | 'reservation';
}

const LOCAL_STORAGE_TABLES_KEY = 'riskcart_restaurant_tables_v1';
const LOCAL_STORAGE_RESERVATIONS_KEY = 'riskcart_table_reservations_v1';
const LOCAL_STORAGE_DINEIN_HISTORY_KEY = 'riskcart_table_dinein_history_v1';
const LOCAL_STORAGE_TABLE_AREAS_KEY = 'riskcart_table_areas_v1';
const LOCAL_STORAGE_DELETED_TABLES_KEY = 'riskcart_deleted_table_ids_v1';
const LOCAL_STORAGE_DELETED_RESERVATIONS_KEY = 'riskcart_deleted_reservation_ids_v1';
const LOCAL_STORAGE_DELETED_DINEIN_KEY = 'riskcart_deleted_dinein_ids_v1';
const LOCAL_STORAGE_DUMMY_TABLES_PURGED_FLAG = 'riskcart_purge_dummy_tables_v4';

function getDeletedIdsSet(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((id) => String(id).trim()).filter(Boolean));
    }
  } catch {}
  return new Set();
}

function addDeletedIdsToStorage(storageKey: string, ids: string[]): void {
  try {
    const current = getDeletedIdsSet(storageKey);
    ids.forEach((id) => {
      if (id) current.add(String(id).trim());
    });
    localStorage.setItem(storageKey, JSON.stringify(Array.from(current)));
  } catch {}
}

const DUMMY_VISITOR_NAMES_REGEX =
  /hendra\s*wijaya|ratna\s*sari|kevin\s*&\s*rina|sinar\s*mandiri|dimas\s*anggara|clarissa\s*wijaya|clarissa\s*putri|rendra\s*pratama|nadia\s*kusuma|komunitas\s*bisnis\s*muda|gunawan\s*setiawan|maya\s*&\s*rekan|surya\s*darma|marketing\s*bank\s*bca|amelia\s*putri|fajar\s*nugroho|h\.\s*ridwan|diana\s*kartika|antonius|bagas\s*&\s*dito|bpk\.\s*wahyu|komunitas\s*fotografi|lukman\s*hakim|ibu\s*sinta|reza\s*rahadian|nusantara\s*jaya|rini\s*astuti|cv\.\s*makmur|yudi\s*latif|taufik\s*hidayat|bpk\.\s*bambang|karin\s*novilda|erick\s*&\s*partner|gilang\s*dirga|denny\s*sumargo/i;

const DUMMY_TABLE_NOTES_SET = new Set([
  'meja dekat jendela utama',
  'minta tambahan piring kecil 2',
  'menunggu struk pembayaran qris',
  'meeting makan siang pukul 13.00',
  'meja kosong siap pakai',
  'area bebas asap rokok',
  'dekat area panggung akustik',
  'tengah ruangan utama',
  'ruang vip privat proyektor',
  'teras taman belakang',
  'pojok baca tenang',
  'sofa melingkar vip',
]);

export function isDummyTableDoc(tbl: any): boolean {
  if (!tbl || typeof tbl !== 'object') return false;
  const id = String(tbl.id || '').trim();
  if (/^tbl_0?[1-9]$|^tbl_1[0-2]$/i.test(id)) return true;
  const visitor = String(tbl.visitorName || '').trim();
  if (visitor && DUMMY_VISITOR_NAMES_REGEX.test(visitor)) return true;
  const notes = String(tbl.notes || '').trim().toLowerCase();
  if (notes && DUMMY_TABLE_NOTES_SET.has(notes)) return true;
  return false;
}

export function isDummyReservationDoc(res: any): boolean {
  if (!res || typeof res !== 'object') return false;
  const id = String(res.id || '').trim();
  const code = String(res.reservationCode || '').trim();
  if (/^rsv_0?[1-9]$/i.test(id) || /^RSV-2026-00[1-9]$/i.test(code)) return true;
  const nama = String(res.nama || '').trim();
  if (nama && DUMMY_VISITOR_NAMES_REGEX.test(nama)) return true;
  return false;
}

export function isDummyDineInDoc(rec: any): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const id = String(rec.id || '').trim();
  if (/^dh_0?[1-9]$|^dh_[12]\d$|^dh_30$/i.test(id)) return true;
  const visitor = String(rec.visitorName || '').trim();
  if (visitor && DUMMY_VISITOR_NAMES_REGEX.test(visitor)) return true;
  return false;
}

function getTodayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getRelativeDateString(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getAreaFirstWordPrefix(zone: string): string {
  const cleaned = String(zone || 'Indoor Utama').trim();
  if (!cleaned) return 'Indoor';
  const firstWord = cleaned.split(/\s+/)[0] || 'Indoor';
  return firstWord;
}

function getShapeDisplayLabel(shape?: string): string {
  if (shape === 'round') return 'Bulat';
  if (shape === 'rectangle') return 'Persegi Panjang';
  return 'Kotak';
}

function normalizeTablesByAreaPrefix(tablesList: RestaurantTableDoc[]): {
  normalized: RestaurantTableDoc[];
  changedDocs: RestaurantTableDoc[];
  idToTableMap: Record<string, RestaurantTableDoc>;
} {
  const zoneCounters: Record<string, number> = {};
  const changedDocs: RestaurantTableDoc[] = [];
  const idToTableMap: Record<string, RestaurantTableDoc> = {};

  const normalized = tablesList.map((tbl) => {
    const zone = String(tbl.zone || 'Indoor Utama').trim() || 'Indoor Utama';
    const prefix = getAreaFirstWordPrefix(zone);
    const nextIdx = (zoneCounters[prefix.toLowerCase()] || 0) + 1;
    zoneCounters[prefix.toLowerCase()] = nextIdx;

    const expectedTableNumber = `${prefix} ${nextIdx}`;
    const shapeLabel = getShapeDisplayLabel(tbl.shape);
    const currentNum = String(tbl.tableNumber || '').trim();
    const currentName = String(tbl.name || '').trim();

    const isLegacyOrMismatched =
      !currentNum ||
      /^M-\d+/i.test(currentNum) ||
      !currentNum.toLowerCase().startsWith(prefix.toLowerCase() + ' ');

    const finalTableNumber = isLegacyOrMismatched ? expectedTableNumber : currentNum;
    const isLegacyName =
      !currentName ||
      /^Meja\s+\d+/i.test(currentName) ||
      /^M-\d+/i.test(currentName) ||
      !currentName.toLowerCase().startsWith(prefix.toLowerCase() + ' ');

    const finalName = isLegacyName ? `${finalTableNumber} (${shapeLabel})` : currentName;

    if (finalTableNumber !== tbl.tableNumber || finalName !== tbl.name) {
      const updatedDoc: RestaurantTableDoc = {
        ...tbl,
        zone,
        tableNumber: finalTableNumber,
        name: finalName,
      };
      changedDocs.push(updatedDoc);
      idToTableMap[updatedDoc.id] = updatedDoc;
      return updatedDoc;
    }

    idToTableMap[tbl.id] = tbl;
    return tbl;
  });

  // Deduplicate any duplicate tableNumber within the same area prefix
  const seenNumbers = new Set<string>();
  const dedupedCounters: Record<string, number> = {};
  const finalNormalized = normalized.map((tbl) => {
    const zone = String(tbl.zone || 'Indoor Utama').trim() || 'Indoor Utama';
    const prefix = getAreaFirstWordPrefix(zone);
    const key = prefix.toLowerCase();
    dedupedCounters[key] = (dedupedCounters[key] || 0) + 1;
    const lowerNum = tbl.tableNumber.toLowerCase();
    if (seenNumbers.has(lowerNum)) {
      const fixedNumber = `${prefix} ${dedupedCounters[key]}`;
      const fixedName = `${fixedNumber} (${getShapeDisplayLabel(tbl.shape)})`;
      const updatedDoc: RestaurantTableDoc = {
        ...tbl,
        tableNumber: fixedNumber,
        name: fixedName,
      };
      seenNumbers.add(fixedNumber.toLowerCase());
      if (!changedDocs.some((c) => c.id === updatedDoc.id)) {
        changedDocs.push(updatedDoc);
      }
      idToTableMap[updatedDoc.id] = updatedDoc;
      return updatedDoc;
    }
    seenNumbers.add(lowerNum);
    idToTableMap[tbl.id] = tbl;
    return tbl;
  });

  return { normalized: finalNormalized, changedDocs, idToTableMap };
}

function createInitialSampleTables(): RestaurantTableDoc[] {
  return [];
}

function createInitialSampleReservations(): TableReservationDoc[] {
  return [];
}

function createInitialSampleDineInHistory(): DailyTableBookingRecord[] {
  return [];
}

function formatSeatedTimeDisplay(isoOrTime: string, nowTick: number): { clock: string; duration: string } {
  if (!isoOrTime) {
    return { clock: 'Belum duduk', duration: '-' };
  }
  const parsed = Date.parse(isoOrTime);
  if (Number.isNaN(parsed)) {
    return { clock: isoOrTime, duration: 'Aktif' };
  }
  const dateObj = new Date(parsed);
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  const diffMin = Math.max(0, Math.floor((nowTick - parsed) / 60000));
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  const duration = hours > 0 ? `${hours} jam ${mins} mnt` : `${mins} menit`;
  return { clock: `${hh}:${mm} WIB`, duration };
}

function formatDurationMinutes(mins: number): string {
  const clean = Math.max(15, Number(mins) || 60);
  const h = Math.floor(clean / 60);
  const m = clean % 60;
  if (h > 0 && m > 0) return `${clean} Menit (${h} jam ${m} mnt)`;
  if (h > 0) return `${clean} Menit (${h} jam)`;
  return `${clean} Menit`;
}

function computeEndTime(startTime: string, durationMinutes: number): string {
  const [hhStr, mmStr] = (startTime || '12:00').split(':');
  const startTotal = (Number(hhStr) || 12) * 60 + (Number(mmStr) || 0);
  const endTotal = (startTotal + (Number(durationMinutes) || 60)) % (24 * 60);
  const endH = String(Math.floor(endTotal / 60)).padStart(2, '0');
  const endM = String(endTotal % 60).padStart(2, '0');
  return `${endH}:${endM}`;
}

function parseTimeToMinutes(timeStr: string): number {
  const [hhStr, mmStr] = (timeStr || '00:00').split(':');
  return (Number(hhStr) || 0) * 60 + (Number(mmStr) || 0);
}

/**
 * Checks whether a reservation/booking starting at `startTime` (HH:mm)
 * with duration `durationMinutes` covers the hourly column `hourSlot` (HH:00).
 * Example: startTime = "19:00", duration = 150 (ends 21:30)
 * -> covers "19:00" (19:00..20:00), "20:00" (20:00..21:00), and "21:00" (21:00..21:30).
 */
function doesIntervalCoverHourSlot(
  startTime: string,
  durationMinutes: number,
  hourSlot: string
): boolean {
  const startMin = parseTimeToMinutes(startTime);
  const dur = Math.max(15, Number(durationMinutes) || 60);
  const endMin = startMin + dur;
  const slotStartMin = parseTimeToMinutes(hourSlot);
  const slotEndMin = slotStartMin + 60;
  return slotStartMin < endMin && slotEndMin > startMin;
}

function doTimeIntervalsOverlap(
  startA: string,
  durA: number,
  startB: string,
  durB: number
): boolean {
  const a0 = parseTimeToMinutes(startA);
  const a1 = a0 + Math.max(15, Number(durA) || 60);
  const b0 = parseTimeToMinutes(startB);
  const b1 = b0 + Math.max(15, Number(durB) || 60);
  return a0 < b1 && b0 < a1;
}

/**
 * Top-down SVG / Visual Renderer for a Table + Chairs (Round, Rectangle, Square)
 */
const TableTopDownArtwork: React.FC<{
  shape: TableShape;
  seats: number;
  status: TableStatus;
  tableNumber: string;
  visitorName?: string;
  totalOrder?: number;
  selected?: boolean;
  rotation?: number;
  currencyMode: CurrencyMode;
  compactPreview?: boolean;
}> = ({
  shape,
  seats,
  status,
  tableNumber,
  visitorName,
  totalOrder = 0,
  selected = false,
  rotation = 0,
  currencyMode,
  compactPreview = false,
}) => {
  const statusPalette: Record<
    TableStatus,
    {
      surface: string;
      border: string;
      chair: string;
      badgeBg: string;
      badgeText: string;
      label: string;
    }
  > = {
    occupied: {
      surface: 'from-amber-950/95 via-[#271b09] to-[#1a1206]',
      border: 'border-amber-400',
      chair: 'bg-amber-400/90 border-amber-200',
      badgeBg: 'bg-amber-500/25 text-amber-200 border-amber-400/50',
      badgeText: 'text-amber-300',
      label: 'TERISI',
    },
    available: {
      surface: 'from-emerald-950/85 via-[#0b2117] to-[#07150f]',
      border: 'border-emerald-400/80',
      chair: 'bg-emerald-400/80 border-emerald-200',
      badgeBg: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
      badgeText: 'text-emerald-300',
      label: 'KOSONG',
    },
    reserved: {
      surface: 'from-sky-950/90 via-[#0c1e33] to-[#081321]',
      border: 'border-sky-400/85',
      chair: 'bg-sky-400/85 border-sky-200',
      badgeBg: 'bg-sky-500/25 text-sky-200 border-sky-400/50',
      badgeText: 'text-sky-300',
      label: 'RESERVASI',
    },
    billing: {
      surface: 'from-rose-950/90 via-[#2b0f16] to-[#1c090e]',
      border: 'border-rose-400',
      chair: 'bg-rose-400/90 border-rose-200',
      badgeBg: 'bg-rose-500/25 text-rose-200 border-rose-400/50',
      badgeText: 'text-rose-300',
      label: 'SIAP BAYAR',
    },
  };

  const theme = statusPalette[status] || statusPalette.available;
  const clampedSeats = Math.max(2, Math.min(12, seats || 4));

  if (shape === 'round') {
    const size = compactPreview ? 74 : 96;
    const radius = compactPreview ? 44 : 58;
    const chairAngles = Array.from({ length: clampedSeats }, (_, i) => (i * 360) / clampedSeats);

    return (
      <div
        className="relative flex items-center justify-center select-none"
        style={{
          width: compactPreview ? 108 : 138,
          height: compactPreview ? 108 : 138,
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {chairAngles.map((deg, idx) => {
          const rad = (deg * Math.PI) / 180;
          const cx = Math.cos(rad) * radius;
          const cy = Math.sin(rad) * radius;
          return (
            <div
              key={idx}
              style={{
                transform: `translate(${cx}px, ${cy}px) rotate(${deg + 90}deg)`,
              }}
              className={`rc-table-chair rc-table-chair-${status} absolute w-5 h-2.5 rounded-t-full border shadow-sm ${theme.chair}`}
            />
          );
        })}

        <div
          style={{ width: size, height: size }}
          className={`rc-table-artwork rc-table-status-${status} ${
            selected ? 'rc-table-selected' : ''
          } relative rounded-full bg-gradient-to-br ${theme.surface} border-2 ${
            selected
              ? 'border-amber-300 ring-4 ring-amber-400/35 shadow-[0_0_25px_rgba(251,191,36,0.45)]'
              : theme.border
          } flex flex-col items-center justify-center p-2 text-center shadow-xl`}
        >
          <div
            style={{ transform: `rotate(${-rotation}deg)` }}
            className="flex flex-col items-center justify-center leading-tight"
          >
            <span className="rc-table-num text-[11px] font-black text-white font-mono tracking-tight">
              {tableNumber}
            </span>
            {!compactPreview && (
              <>
                <span className="rc-table-label text-[9px] font-bold text-amber-100/90 max-w-[74px] truncate mt-0.5">
                  {visitorName ? visitorName : theme.label}
                </span>
                {totalOrder > 0 && (
                  <span className="rc-table-price text-[8px] font-mono font-extrabold text-amber-300 mt-0.5 tabular-nums">
                    {fmtMoney(totalOrder, currencyMode)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (shape === 'rectangle') {
    const width = compactPreview ? 116 : 156;
    const height = compactPreview ? 62 : 82;
    const sideSeats = clampedSeats >= 6 ? 2 : 0;
    const topBottomTotal = Math.max(2, clampedSeats - sideSeats);
    const topCount = Math.ceil(topBottomTotal / 2);
    const bottomCount = Math.floor(topBottomTotal / 2);

    return (
      <div
        className="relative flex items-center justify-center select-none"
        style={{
          width: compactPreview ? 142 : 188,
          height: compactPreview ? 96 : 120,
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          style={{ width: width - 16 }}
          className="absolute top-0.5 flex items-center justify-around"
        >
          {Array.from({ length: topCount }).map((_, i) => (
            <div
              key={`top-${i}`}
              className={`rc-table-chair rc-table-chair-${status} w-6 h-2.5 rounded-t-md border shadow-sm ${theme.chair}`}
            />
          ))}
        </div>

        <div
          style={{ width: width - 16 }}
          className="absolute bottom-0.5 flex items-center justify-around"
        >
          {Array.from({ length: bottomCount }).map((_, i) => (
            <div
              key={`bot-${i}`}
              className={`rc-table-chair rc-table-chair-${status} w-6 h-2.5 rounded-b-md border shadow-sm ${theme.chair}`}
            />
          ))}
        </div>

        {sideSeats > 0 && (
          <>
            <div
              className={`rc-table-chair rc-table-chair-${status} absolute left-0.5 w-2.5 h-6 rounded-l-md border shadow-sm ${theme.chair}`}
            />
            <div
              className={`rc-table-chair rc-table-chair-${status} absolute right-0.5 w-2.5 h-6 rounded-r-md border shadow-sm ${theme.chair}`}
            />
          </>
        )}

        <div
          style={{ width, height }}
          className={`rc-table-artwork rc-table-status-${status} ${
            selected ? 'rc-table-selected' : ''
          } relative rounded-2xl bg-gradient-to-br ${theme.surface} border-2 ${
            selected
              ? 'border-amber-300 ring-4 ring-amber-400/35 shadow-[0_0_25px_rgba(251,191,36,0.45)]'
              : theme.border
          } flex flex-col items-center justify-center px-2.5 py-1.5 text-center shadow-xl`}
        >
          <div
            style={{ transform: `rotate(${-rotation}deg)` }}
            className="flex flex-col items-center justify-center leading-tight w-full"
          >
            <div className="flex items-center gap-1.5">
              <span className="rc-table-num text-xs font-black text-white font-mono">
                {tableNumber}
              </span>
              {!compactPreview && (
                <span className="rc-table-seats text-[9px] font-mono text-zinc-300">
                  ({clampedSeats} Kursi)
                </span>
              )}
            </div>
            {!compactPreview && (
              <>
                <span className="rc-table-label text-[10px] font-bold text-amber-100/95 max-w-[125px] truncate mt-0.5">
                  {visitorName ? visitorName : theme.label}
                </span>
                {totalOrder > 0 && (
                  <span className="rc-table-price text-[9px] font-mono font-extrabold text-amber-300 mt-0.5 tabular-nums">
                    {fmtMoney(totalOrder, currencyMode)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const sqSize = compactPreview ? 68 : 88;
  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{
        width: compactPreview ? 102 : 126,
        height: compactPreview ? 102 : 126,
        transform: `rotate(${rotation}deg)`,
        transition: 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div className={`rc-table-chair rc-table-chair-${status} absolute top-1 w-7 h-2.5 rounded-t-md border shadow-sm ${theme.chair}`} />
      <div className={`rc-table-chair rc-table-chair-${status} absolute bottom-1 w-7 h-2.5 rounded-b-md border shadow-sm ${theme.chair}`} />
      {clampedSeats >= 3 && (
        <div className={`rc-table-chair rc-table-chair-${status} absolute left-1 w-2.5 h-7 rounded-l-md border shadow-sm ${theme.chair}`} />
      )}
      {clampedSeats >= 4 && (
        <div className={`rc-table-chair rc-table-chair-${status} absolute right-1 w-2.5 h-7 rounded-r-md border shadow-sm ${theme.chair}`} />
      )}

      <div
        style={{ width: sqSize, height: sqSize }}
        className={`rc-table-artwork rc-table-status-${status} ${
          selected ? 'rc-table-selected' : ''
        } relative rounded-xl bg-gradient-to-br ${theme.surface} border-2 ${
          selected
            ? 'border-amber-300 ring-4 ring-amber-400/35 shadow-[0_0_25px_rgba(251,191,36,0.45)]'
            : theme.border
        } flex flex-col items-center justify-center p-2 text-center shadow-xl`}
      >
        <div
          style={{ transform: `rotate(${-rotation}deg)` }}
          className="flex flex-col items-center justify-center leading-tight"
        >
          <span className="rc-table-num text-xs font-black text-white font-mono">
            {tableNumber}
          </span>
          {!compactPreview && (
            <>
              <span className="rc-table-label text-[9px] font-bold text-amber-100/90 max-w-[72px] truncate mt-0.5">
                {visitorName ? visitorName : theme.label}
              </span>
              {totalOrder > 0 && (
                <span className="rc-table-price text-[8px] font-mono font-extrabold text-amber-300 mt-0.5 tabular-nums">
                  {fmtMoney(totalOrder, currencyMode)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const OPERATIONAL_HOURS = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
  '21:00',
  '22:00',
];

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export interface TableLayoutModuleProps {
  waiterMode?: boolean;
  subModule?: string;
}

export const TableLayoutModule: React.FC<TableLayoutModuleProps> = ({
  waiterMode = false,
  subModule = 'layout',
}) => {
  const { currencyMode: rawCurr } = useLanguage();
  const currencyMode = (rawCurr as CurrencyMode) || 'IDR';
  const { navigateToPath, pathname } = useAppNavigation();
  const appData = useAppData();
  const storeProducts = Array.isArray(appData?.products) ? appData.products : [];
  const storeCustomers = Array.isArray(appData?.customers) ? appData.customers : [];
  const addTransactionLocal = appData?.addTransactionLocal;

  // Determine active view mode from URL / subModule
  const activeView: 'reservation' | 'reservation_list' | 'layout' | 'summary' = useMemo(() => {
    if (waiterMode) return 'layout';
    const cleanPath = (pathname || '').toLowerCase();
    if (cleanPath.includes('/reservation/list') || subModule === 'reservation_list') {
      return 'reservation_list';
    }
    if (cleanPath.includes('/reservation') || subModule === 'reservation') {
      return 'reservation';
    }
    if (cleanPath.includes('/summary') || subModule === 'summary') {
      return 'summary';
    }
    return 'layout';
  }, [waiterMode, pathname, subModule]);

  // ---------------------------------------------------------------------------
  // 1. TABLES STATE & PERSISTENCE (NO AUTO-SEEDING OF DUMMY DATA)
  // ---------------------------------------------------------------------------
  const [tables, setTables] = useState<RestaurantTableDoc[]>(() => {
    try {
      const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_TABLES_KEY);
      const cached = localStorage.getItem(LOCAL_STORAGE_TABLES_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const baseList: RestaurantTableDoc[] = parsed
            .filter((t: any) => t && t.id && !deletedSet.has(String(t.id)) && !isDummyTableDoc(t))
            .map((t: any, idx: number) => ({
              ...t,
              id: String(t.id),
              tableNumber: String(t?.tableNumber || `Indoor ${idx + 1}`),
              name: String(t?.name || `Indoor ${idx + 1}`),
              shape:
                t?.shape === 'round' || t?.shape === 'rectangle' || t?.shape === 'square'
                  ? t.shape
                  : 'square',
              seats: Number(t?.seats) || 4,
              x: typeof t?.x === 'number' ? t.x : 25 + (idx % 3) * 25,
              y: typeof t?.y === 'number' ? t.y : 30 + Math.floor(idx / 3) * 30,
              rotation: Number(t?.rotation) || 0,
              zone: t?.zone || 'Indoor Utama',
              status: t?.status || 'available',
              visitorName: String(t?.visitorName || ''),
              visitorPax: Number(t?.visitorPax) || 0,
              seatedAt: String(t?.seatedAt || ''),
              orders: Array.isArray(t?.orders) ? t.orders : [],
              totalOrder: Number(t?.totalOrder) || 0,
              updatedAt: String(t?.updatedAt || new Date().toISOString()),
            }));
          // If more than 20 tables accumulated due to the old auto-seeding bug, clear the corrupted cache
          if (baseList.length > 20) {
            return [];
          }
          const { normalized } = normalizeTablesByAreaPrefix(baseList);
          return normalized;
        }
      }
    } catch {}
    return [];
  });

  // ---------------------------------------------------------------------------
  // 2. RESERVATIONS STATE & PERSISTENCE (NO AUTO-SEEDING OF DUMMY DATA)
  // ---------------------------------------------------------------------------
  const [reservations, setReservations] = useState<TableReservationDoc[]>(() => {
    try {
      const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_RESERVATIONS_KEY);
      const cached = localStorage.getItem(LOCAL_STORAGE_RESERVATIONS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (r: any) => r && r.id && !deletedSet.has(String(r.id)) && !isDummyReservationDoc(r)
          );
        }
      }
    } catch {}
    return [];
  });

  // ---------------------------------------------------------------------------
  // 3. DAILY DINE-IN BOOKING HISTORY STATE & PERSISTENCE (NO AUTO-SEEDING)
  // ---------------------------------------------------------------------------
  const [dineInHistory, setDineInHistory] = useState<DailyTableBookingRecord[]>(() => {
    try {
      const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_DINEIN_KEY);
      const cached = localStorage.getItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (d: any) => d && d.id && !deletedSet.has(String(d.id)) && !isDummyDineInDoc(d)
          );
        }
      }
    } catch {}
    return [];
  });

  // ---------------------------------------------------------------------------
  // 3B. DYNAMIC TABLE AREAS STATE & PERSISTENCE (Edit, Tambah, Hapus Area)
  // ---------------------------------------------------------------------------
  const [tableAreas, setTableAreas] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_TABLE_AREAS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((a) => String(a).trim()).filter(Boolean);
        }
      }
    } catch {}
    return [...DEFAULT_TABLE_AREAS];
  });

  const [isAreaMenuOpen, setIsAreaMenuOpen] = useState<boolean>(false);
  const [isTableAreaDropdownOpen, setIsTableAreaDropdownOpen] = useState<boolean>(false);
  const [newAreaName, setNewAreaName] = useState<string>('');
  const [editingAreaOriginal, setEditingAreaOriginal] = useState<string | null>(null);
  const [editingAreaValue, setEditingAreaValue] = useState<string>('');
  const areaMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const tableAreaDropdownRef = useRef<HTMLDivElement | null>(null);

  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [activeZoneFilter, setActiveZoneFilter] = useState<string>('Indoor Utama');
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [statusFeedback, setStatusFeedback] = useState<string>('');
  const [isSavingLayout, setIsSavingLayout] = useState<boolean>(false);
  const [lastSavedLayoutAt, setLastSavedLayoutAt] = useState<string>('');

  // Order addition state in the Visitor Detail Panel (Table Layout)
  const [selectedProductIdToAdd, setSelectedProductIdToAdd] = useState<string>('');
  const [customOrderName, setCustomOrderName] = useState<string>('');
  const [customOrderPrice, setCustomOrderPrice] = useState<number>(25000);
  const [customOrderQty, setCustomOrderQty] = useState<number>(1);

  // ---------------------------------------------------------------------------
  // 4. RESERVATION FORM & CALENDAR STATE (/dashboard/reservation)
  // ---------------------------------------------------------------------------
  const todayStr = useMemo(() => getTodayDateString(), []);
  const [calendarMonthDate, setCalendarMonthDate] = useState<Date>(() => new Date());
  const [resTableId, setResTableId] = useState<string>('');
  const [resNama, setResNama] = useState<string>('');
  const [resNomorHp, setResNomorHp] = useState<string>('');
  const [resTanggal, setResTanggal] = useState<string>(todayStr);
  const [resJamDatang, setResJamDatang] = useState<string>('19:00');
  const [resDurasi, setResDurasi] = useState<number>(120);
  const [resVisitorPax, setResVisitorPax] = useState<number>(4);
  const [resDownpayment, setResDownpayment] = useState<number>(0);
  const [resNotes, setResNotes] = useState<string>('');
  const [resOrders, setResOrders] = useState<TableOrderItem[]>([]);
  const [resProductToAdd, setResProductToAdd] = useState<string>('');
  const [resCustomItemName, setResCustomItemName] = useState<string>('');
  const [resCustomItemPrice, setResCustomItemPrice] = useState<number>(25000);
  const [resCustomItemQty, setResCustomItemQty] = useState<number>(1);
  const [calendarAreaFilter, setCalendarAreaFilter] = useState<string>('Semua Area');

  // ---------------------------------------------------------------------------
  // 5. LIST RESERVASI FILTERS (/dashboard/reservation/list)
  // ---------------------------------------------------------------------------
  const [listSearch, setListSearch] = useState<string>('');
  const [listDateFilter, setListDateFilter] = useState<string>('');
  const [listStatusFilter, setListStatusFilter] = useState<string>('all');
  const [listAreaFilter, setListAreaFilter] = useState<string>('Semua Area');

  // ---------------------------------------------------------------------------
  // 6. SUMMARY REPORT FILTERS (/dashboard/layout-table/summary)
  // ---------------------------------------------------------------------------
  const [summaryStartDate, setSummaryStartDate] = useState<string>(() => getRelativeDateString(-7));
  const [summaryEndDate, setSummaryEndDate] = useState<string>(() => getRelativeDateString(2));
  const [summarySpecificDate, setSummarySpecificDate] = useState<string>('');
  const [summaryAreaFilter, setSummaryAreaFilter] = useState<string>('Semua Area');
  const [summarySearch, setSummarySearch] = useState<string>('');

  // Dragging state on the floorplan canvas
  const floorCanvasRef = useRef<HTMLDivElement | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 });
  const didMoveRef = useRef<boolean>(false);

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  // Close area popup menu when clicking outside
  useEffect(() => {
    if (!isAreaMenuOpen && !isTableAreaDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        isAreaMenuOpen &&
        areaMenuContainerRef.current &&
        !areaMenuContainerRef.current.contains(e.target as Node)
      ) {
        setIsAreaMenuOpen(false);
        setEditingAreaOriginal(null);
      }
      if (
        isTableAreaDropdownOpen &&
        tableAreaDropdownRef.current &&
        !tableAreaDropdownRef.current.contains(e.target as Node)
      ) {
        setIsTableAreaDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isAreaMenuOpen, isTableAreaDropdownOpen]);

  // Firestore Persistence Helpers
  const persistTableAreas = useCallback(async (areasList: string[]) => {
    const cleanAreas = areasList.map((a) => String(a).trim()).filter(Boolean);
    try {
      localStorage.setItem(LOCAL_STORAGE_TABLE_AREAS_KEY, JSON.stringify(cleanAreas));
    } catch {}
    const payload = sanitizeForDatabase({
      id: 'table_areas_config',
      areas: cleanAreas,
      updatedAt: new Date().toISOString(),
    });
    await Promise.allSettled([
      syncDocToDatabase('settings', 'table_areas_config', payload),
      ACTIVE_STORE_ID
        ? syncDocToDatabase(`stores/${ACTIVE_STORE_ID}/settings`, 'table_areas_config', payload)
        : Promise.resolve(true),
    ]);
  }, []);

  useEffect(() => {
    const docRef = doc(db, 'settings', 'table_areas_config');
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) {
          void persistTableAreas(tableAreas);
          return;
        }
        const data = snap.data();
        if (data && Array.isArray(data.areas) && data.areas.length > 0) {
          const cleaned = data.areas.map((a: any) => String(a).trim()).filter(Boolean);
          if (cleaned.length > 0) {
            setTableAreas(cleaned);
            try {
              localStorage.setItem(LOCAL_STORAGE_TABLE_AREAS_KEY, JSON.stringify(cleaned));
            } catch {}
          }
        }
      },
      () => {}
    );
    return () => unsub();
  }, [persistTableAreas]);

  useEffect(() => {
    const docRef = doc(db, 'settings', 'table_layout_config');
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (!data) return;
        if (typeof data.snapToGrid === 'boolean') {
          setSnapToGrid(data.snapToGrid);
        }
        if (typeof data.updatedAt === 'string' && data.updatedAt) {
          try {
            const formatted = new Date(data.updatedAt).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            setLastSavedLayoutAt(formatted);
          } catch {}
        }
      },
      () => {}
    );
    return () => unsub();
  }, []);

  const handleAddArea = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newAreaName.trim();
    if (!trimmed) return;
    if (
      trimmed.toLowerCase() === 'semua area' ||
      tableAreas.some((a) => a.toLowerCase() === trimmed.toLowerCase())
    ) {
      setStatusFeedback(`Area "${trimmed}" sudah ada pada daftar area.`);
      return;
    }
    const nextAreas = [...tableAreas, trimmed];
    setTableAreas(nextAreas);
    void persistTableAreas(nextAreas);
    setNewAreaName('');
    setStatusFeedback(`+ Area baru "${trimmed}" berhasil ditambahkan!`);
  };

  const handleSaveEditArea = (oldName: string) => {
    const trimmed = editingAreaValue.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingAreaOriginal(null);
      return;
    }
    if (
      trimmed.toLowerCase() === 'semua area' ||
      tableAreas.some(
        (a) => a.toLowerCase() === trimmed.toLowerCase() && a !== oldName
      )
    ) {
      setStatusFeedback(`Nama area "${trimmed}" sudah digunakan.`);
      return;
    }
    const nextAreas = tableAreas.map((a) => (a === oldName ? trimmed : a));
    setTableAreas(nextAreas);
    void persistTableAreas(nextAreas);

    // Update active filters if they pointed to oldName
    if (calendarAreaFilter === oldName) setCalendarAreaFilter(trimmed);
    if (activeZoneFilter === oldName) setActiveZoneFilter(trimmed);
    if (listAreaFilter === oldName) setListAreaFilter(trimmed);
    if (summaryAreaFilter === oldName) setSummaryAreaFilter(trimmed);

    // Update tables, reservations, and dine-in history that belonged to oldName
    setTables((prev) => {
      const zoneUpdated = prev.map((t) => {
        if (t.zone !== oldName) return t;
        return { ...t, zone: trimmed, updatedAt: new Date().toISOString() };
      });
      const { normalized, changedDocs } = normalizeTablesByAreaPrefix(zoneUpdated);
      normalized.forEach((docItem) => {
        if (docItem.zone === trimmed || changedDocs.some((c) => c.id === docItem.id)) {
          void persistTableDoc(docItem);
        }
      });
      try {
        localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(normalized));
      } catch {}
      return normalized;
    });

    setReservations((prev) => {
      const updated = prev.map((r) => {
        if (r.area !== oldName) return r;
        const nextRes = { ...r, area: trimmed };
        void persistReservationDoc(nextRes);
        return nextRes;
      });
      try {
        localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setDineInHistory((prev) => {
      const updated = prev.map((d) => {
        if (d.area !== oldName) return d;
        const nextRec = { ...d, area: trimmed };
        void persistDineInRecord(nextRec);
        return nextRec;
      });
      try {
        localStorage.setItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setEditingAreaOriginal(null);
    setEditingAreaValue('');
    setStatusFeedback(`Area "${oldName}" berhasil diubah menjadi "${trimmed}".`);
  };

  const handleDeleteArea = (targetArea: string) => {
    if (tableAreas.length <= 1) {
      setStatusFeedback('Minimal harus terdapat 1 area aktif.');
      return;
    }
    const nextAreas = tableAreas.filter((a) => a !== targetArea);
    const fallbackArea = nextAreas[0] || 'Indoor Utama';
    setTableAreas(nextAreas);
    void persistTableAreas(nextAreas);

    if (calendarAreaFilter === targetArea) setCalendarAreaFilter('Semua Area');
    if (activeZoneFilter === targetArea) setActiveZoneFilter('Semua Area');
    if (listAreaFilter === targetArea) setListAreaFilter('Semua Area');
    if (summaryAreaFilter === targetArea) setSummaryAreaFilter('Semua Area');

    // Reassign tables in deleted area to fallbackArea
    setTables((prev) => {
      const zoneUpdated = prev.map((t) => {
        if (t.zone !== targetArea) return t;
        return { ...t, zone: fallbackArea, updatedAt: new Date().toISOString() };
      });
      const { normalized } = normalizeTablesByAreaPrefix(zoneUpdated);
      normalized.forEach((docItem) => {
        if (docItem.zone === fallbackArea) {
          void persistTableDoc(docItem);
        }
      });
      try {
        localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(normalized));
      } catch {}
      return normalized;
    });

    if (editingAreaOriginal === targetArea) {
      setEditingAreaOriginal(null);
    }
    setStatusFeedback(`Area "${targetArea}" telah dihapus.`);
  };

  const persistTableDoc = useCallback(async (tableDoc: RestaurantTableDoc) => {
    try {
      const cleanPayload = sanitizeForDatabase({
        ...tableDoc,
        x: Number.isFinite(Number(tableDoc.x)) ? Number(tableDoc.x) : 25,
        y: Number.isFinite(Number(tableDoc.y)) ? Number(tableDoc.y) : 35,
        rotation: Number.isFinite(Number(tableDoc.rotation)) ? Number(tableDoc.rotation) : 0,
        seats: Math.max(1, Number(tableDoc.seats) || 4),
        visitorPax: Math.max(1, Number(tableDoc.visitorPax || tableDoc.seats) || 4),
        orders: Array.isArray(tableDoc.orders) ? tableDoc.orders : [],
        totalOrder: Number.isFinite(Number(tableDoc.totalOrder)) ? Number(tableDoc.totalOrder) : 0,
        updatedAt: new Date().toISOString(),
      });
      publishRealtimeEvent('tables_updated', {
        tableId: tableDoc.id,
        tableNumber: tableDoc.tableNumber,
        status: tableDoc.status,
        tableDoc: cleanPayload,
      });
      await Promise.allSettled([
        syncDocToDatabase('restaurant_tables', tableDoc.id, cleanPayload),
        syncDocToDatabase('tables', tableDoc.id, cleanPayload),
        syncDocToDatabase('table_layouts', tableDoc.id, cleanPayload),
        ACTIVE_STORE_ID
          ? syncDocToDatabase(
              `stores/${ACTIVE_STORE_ID}/restaurant_tables`,
              tableDoc.id,
              cleanPayload
            )
          : Promise.resolve(true),
      ]);
    } catch (err) {
      console.error('[TableLayoutModule] persistTableDoc error:', err);
    }
  }, []);

  const persistReservationDoc = useCallback(async (resDoc: TableReservationDoc) => {
    try {
      const clean = sanitizeForDatabase({
        ...resDoc,
        durasi: Math.max(15, Number(resDoc.durasi) || 120),
        visitorPax: Math.max(1, Number(resDoc.visitorPax) || 2),
        totalOrder: Number(resDoc.totalOrder) || 0,
        downpayment: Number(resDoc.downpayment) || 0,
        orders: Array.isArray(resDoc.orders) ? resDoc.orders : [],
      });
      publishRealtimeEvent('reservations_updated', {
        reservationId: resDoc.id,
        reservationDoc: clean,
      });
      await Promise.allSettled([
        syncDocToDatabase('table_reservations', resDoc.id, clean),
        syncDocToDatabase('reservations', resDoc.id, clean),
        ACTIVE_STORE_ID
          ? syncDocToDatabase(
              `stores/${ACTIVE_STORE_ID}/table_reservations`,
              resDoc.id,
              clean
            )
          : Promise.resolve(true),
      ]);
    } catch (err) {
      console.error('[TableLayoutModule] persistReservationDoc error:', err);
    }
  }, []);

  const persistDineInRecord = useCallback(async (rec: DailyTableBookingRecord) => {
    try {
      const clean = sanitizeForDatabase({
        ...rec,
        visitorCount: Math.max(1, Number(rec.visitorCount) || 2),
        totalRevenue: Number(rec.totalRevenue) || 0,
        durasiDineIn: Math.max(15, Number(rec.durasiDineIn) || 60),
      });
      await Promise.allSettled([
        syncDocToDatabase('table_dinein_history', rec.id, clean),
        ACTIVE_STORE_ID
          ? syncDocToDatabase(
              `stores/${ACTIVE_STORE_ID}/table_dinein_history`,
              rec.id,
              clean
            )
          : Promise.resolve(true),
      ]);
    } catch (err) {
      console.error('[TableLayoutModule] persistDineInRecord error:', err);
    }
  }, []);

  // Auto-sync any pending local data on mount + purge verified dummy entries
  useEffect(() => {
    void autoResyncLocalCachesToServer();
    const runOneTimeDummyPurge = async () => {
      try {
        const alreadyPurged = localStorage.getItem(LOCAL_STORAGE_DUMMY_TABLES_PURGED_FLAG);
        if (alreadyPurged === 'true') return;
        localStorage.setItem(LOCAL_STORAGE_DUMMY_TABLES_PURGED_FLAG, 'true');

        try {
          const snapTables = await getDocs(collection(db, 'restaurant_tables'));
          await Promise.allSettled(
            snapTables.docs
              .filter((d) => isDummyTableDoc({ ...d.data(), id: d.id }))
              .map((d) => deleteDocFromDatabase('restaurant_tables', d.id))
          );
        } catch {}
        if (ACTIVE_STORE_ID) {
          try {
            const snapStoreTables = await getDocs(
              collection(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables')
            );
            await Promise.allSettled(
              snapStoreTables.docs
                .filter((d) => isDummyTableDoc({ ...d.data(), id: d.id }))
                .map((d) =>
                  deleteDocFromDatabase(
                    `stores/${ACTIVE_STORE_ID}/restaurant_tables`,
                    d.id
                  )
                )
            );
          } catch {}
        }
      } catch (e) {
        console.warn('Purge dummy tables warning:', e);
      }
    };
    void runOneTimeDummyPurge();
  }, []);

  // Real-time Firestore listener on `restaurant_tables` (with local recovery push if server is empty)
  useEffect(() => {
    const colRef = collection(db, 'restaurant_tables');
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_TABLES_KEY);
        if (snap.empty) {
          try {
            const rawLocal = localStorage.getItem(LOCAL_STORAGE_TABLES_KEY);
            if (rawLocal) {
              const parsedLocal = JSON.parse(rawLocal);
              if (Array.isArray(parsedLocal)) {
                const validLocal = parsedLocal.filter(
                  (t: any) =>
                    t &&
                    t.id &&
                    !deletedSet.has(String(t.id)) &&
                    !isDummyTableDoc(t)
                );
                if (validLocal.length > 0) {
                  setTables(validLocal);
                  validLocal.forEach((t: RestaurantTableDoc) => {
                    void persistTableDoc(t);
                  });
                  return;
                }
              }
            }
          } catch {}
          setTables([]);
          try {
            localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify([]));
          } catch {}
          return;
        }
        const loaded: RestaurantTableDoc[] = [];
        const dummyDocIdsToPurge: string[] = [];
        snap.forEach((d) => {
          const data = { ...(d.data() as RestaurantTableDoc), id: d.id };
          if (deletedSet.has(d.id) || isDummyTableDoc(data)) {
            dummyDocIdsToPurge.push(d.id);
            return;
          }
          if (data && data.id) {
            loaded.push({
              ...data,
              orders: Array.isArray(data.orders) ? data.orders : [],
              totalOrder:
                typeof data.totalOrder === 'number'
                  ? data.totalOrder
                  : (Array.isArray(data.orders) ? data.orders : []).reduce(
                      (s, o) => s + Number(o.price || 0) * Number(o.qty || 1),
                      0
                    ),
            });
          }
        });

        // Clean any detected dummy or tombstoned documents from Firestore
        if (dummyDocIdsToPurge.length > 0) {
          dummyDocIdsToPurge.forEach((badId) => {
            void deleteDocFromDatabase('restaurant_tables', badId);
            if (ACTIVE_STORE_ID) {
              void deleteDocFromDatabase(
                `stores/${ACTIVE_STORE_ID}/restaurant_tables`,
                badId
              );
            }
          });
        }

        loaded.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        const { normalized } = normalizeTablesByAreaPrefix(loaded);
        normalized.sort((a, b) =>
          a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true })
        );
        setTables(normalized);
        try {
          localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(normalized));
        } catch {}
      },
      (err) => {
        console.warn('restaurant_tables listener warning:', err);
      }
    );

    const reloadTablesFromLocalStorage = () => {
      try {
        const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_TABLES_KEY);
        const raw = localStorage.getItem(LOCAL_STORAGE_TABLES_KEY);
        if (!raw) {
          setTables([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter(
            (inc: any) => inc && inc.id && !deletedSet.has(String(inc.id)) && !isDummyTableDoc(inc)
          );
          setTables(cleaned);
        }
      } catch {}
    };

    const unsubRealtimeTables = subscribeRealtimeEvent('tables_updated', () => {
      reloadTablesFromLocalStorage();
    });

    const onStorageChange = (ev: StorageEvent) => {
      if (ev.key === LOCAL_STORAGE_TABLES_KEY) {
        reloadTablesFromLocalStorage();
      } else if (ev.key === LOCAL_STORAGE_RESERVATIONS_KEY && ev.newValue) {
        try {
          const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_RESERVATIONS_KEY);
          const parsed = JSON.parse(ev.newValue);
          if (Array.isArray(parsed)) {
            setReservations(
              parsed.filter(
                (r: any) =>
                  r && r.id && !deletedSet.has(String(r.id)) && !isDummyReservationDoc(r)
              )
            );
          }
        } catch {}
      }
    };
    window.addEventListener('storage', onStorageChange);

    return () => {
      unsub();
      unsubRealtimeTables();
      window.removeEventListener('storage', onStorageChange);
    };
  }, [persistTableDoc]);

  // Real-time Firestore listener on `table_reservations` (with local recovery push if server is empty)
  useEffect(() => {
    const colRef = collection(db, 'table_reservations');
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_RESERVATIONS_KEY);
        if (snap.empty) {
          try {
            const rawLocal = localStorage.getItem(LOCAL_STORAGE_RESERVATIONS_KEY);
            if (rawLocal) {
              const parsedLocal = JSON.parse(rawLocal);
              if (Array.isArray(parsedLocal)) {
                const validLocal = parsedLocal.filter(
                  (r: any) =>
                    r &&
                    r.id &&
                    !deletedSet.has(String(r.id)) &&
                    !isDummyReservationDoc(r)
                );
                if (validLocal.length > 0) {
                  setReservations(validLocal);
                  validLocal.forEach((r: TableReservationDoc) => {
                    void persistReservationDoc(r);
                  });
                  return;
                }
              }
            }
          } catch {}
          setReservations([]);
          try {
            localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify([]));
          } catch {}
          return;
        }
        const loaded: TableReservationDoc[] = [];
        const dummyIdsToDelete: string[] = [];
        snap.forEach((d) => {
          const data = { ...(d.data() as TableReservationDoc), id: d.id };
          if (deletedSet.has(d.id) || isDummyReservationDoc(data)) {
            dummyIdsToDelete.push(d.id);
            return;
          }
          if (data && data.id) {
            loaded.push({
              ...data,
              orders: Array.isArray(data.orders) ? data.orders : [],
            });
          }
        });
        if (dummyIdsToDelete.length > 0) {
          dummyIdsToDelete.forEach((badId) => {
            void deleteDocFromDatabase('table_reservations', badId);
            if (ACTIVE_STORE_ID) {
              void deleteDocFromDatabase(
                `stores/${ACTIVE_STORE_ID}/table_reservations`,
                badId
              );
            }
          });
        }
        loaded.sort((a, b) =>
          `${b.tanggal} ${b.jamDatang}`.localeCompare(`${a.tanggal} ${a.jamDatang}`)
        );
        setReservations(loaded);
        try {
          localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify(loaded));
        } catch {}
      },
      () => {}
    );
    return () => unsub();
  }, [persistReservationDoc]);

  // Real-time Firestore listener on `table_dinein_history` (with local recovery push if server is empty)
  useEffect(() => {
    const colRef = collection(db, 'table_dinein_history');
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_DINEIN_KEY);
        if (snap.empty) {
          try {
            const rawLocal = localStorage.getItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY);
            if (rawLocal) {
              const parsedLocal = JSON.parse(rawLocal);
              if (Array.isArray(parsedLocal)) {
                const validLocal = parsedLocal.filter(
                  (d: any) =>
                    d &&
                    d.id &&
                    !deletedSet.has(String(d.id)) &&
                    !isDummyDineInDoc(d)
                );
                if (validLocal.length > 0) {
                  setDineInHistory(validLocal);
                  validLocal.forEach((d: DailyTableBookingRecord) => {
                    void persistDineInRecord(d);
                  });
                  return;
                }
              }
            }
          } catch {}
          setDineInHistory([]);
          try {
            localStorage.setItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY, JSON.stringify([]));
          } catch {}
          return;
        }
        const loaded: DailyTableBookingRecord[] = [];
        const dummyIdsToDelete: string[] = [];
        snap.forEach((d) => {
          const data = { ...(d.data() as DailyTableBookingRecord), id: d.id };
          if (deletedSet.has(d.id) || isDummyDineInDoc(data)) {
            dummyIdsToDelete.push(d.id);
            return;
          }
          if (data && data.id) {
            loaded.push(data);
          }
        });
        if (dummyIdsToDelete.length > 0) {
          dummyIdsToDelete.forEach((badId) => {
            void deleteDocFromDatabase('table_dinein_history', badId);
            if (ACTIVE_STORE_ID) {
              void deleteDocFromDatabase(
                `stores/${ACTIVE_STORE_ID}/table_dinein_history`,
                badId
              );
            }
          });
        }
        loaded.sort((a, b) =>
          `${b.tanggal} ${b.jam}`.localeCompare(`${a.tanggal} ${a.jam}`)
        );
        setDineInHistory(loaded);
        try {
          localStorage.setItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY, JSON.stringify(loaded));
        } catch {}
      },
      () => {}
    );
    return () => unsub();
  }, [persistDineInRecord]);

  // Update helper for a table
  const updateTableById = useCallback(
    (tableId: string, updater: (prev: RestaurantTableDoc) => RestaurantTableDoc, persist = true) => {
      setTables((prevList) => {
        const nextList = prevList.map((t) => {
          if (t.id !== tableId) return t;
          const updated = updater(t);
          const recalcTotal = (updated.orders || []).reduce(
            (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1),
            0
          );
          const finalDoc: RestaurantTableDoc = {
            ...updated,
            totalOrder: recalcTotal,
            updatedAt: new Date().toISOString(),
          };
          if (persist) {
            void persistTableDoc(finalDoc);
          }
          return finalDoc;
        });
        try {
          localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(nextList));
        } catch {}
        return nextList;
      });
    },
    [persistTableDoc]
  );

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || tables[0] || null,
    [tables, selectedTableId]
  );

  const selectedResTable = useMemo(
    () => tables.find((t) => t.id === resTableId) || tables[0] || null,
    [tables, resTableId]
  );

  const handleSelectTableAndRedirectToWaiterPos = useCallback(
    (table: RestaurantTableDoc) => {
      setSelectedTableId(table.id);
      const updatedTable: RestaurantTableDoc = {
        ...table,
        status: table.status === 'available' ? 'occupied' : table.status,
        seatedAt: table.seatedAt || new Date().toISOString(),
      };
      try {
        localStorage.setItem('riskcart_waiter_active_table', JSON.stringify(updatedTable));
      } catch {}
      updateTableById(table.id, () => updatedTable);
      navigateToPath(
        `/waiters/pos?waiter=1&tableId=${encodeURIComponent(
          updatedTable.id
        )}&tableNumber=${encodeURIComponent(updatedTable.tableNumber)}`
      );
    },
    [navigateToPath, updateTableById]
  );

  // Pointer Move / Up handlers for Drag and Drop inside Floorplan Box
  useEffect(() => {
    if (!draggingTableId) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!floorCanvasRef.current) return;
      const rect = floorCanvasRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      didMoveRef.current = true;
      const rawX = ((e.clientX - rect.left - dragOffsetRef.current.offsetX) / rect.width) * 100;
      const rawY = ((e.clientY - rect.top - dragOffsetRef.current.offsetY) / rect.height) * 100;

      const clampedX = Math.max(9, Math.min(91, rawX));
      const clampedY = Math.max(13, Math.min(87, rawY));

      const finalX = snapToGrid ? Math.round(clampedX / 5) * 5 : Math.round(clampedX * 10) / 10;
      const finalY = snapToGrid ? Math.round(clampedY / 5) * 5 : Math.round(clampedY * 10) / 10;

      updateTableById(
        draggingTableId,
        (prev) => ({
          ...prev,
          x: finalX,
          y: finalY,
        }),
        false
      );
    };

    const handlePointerUp = () => {
      if (draggingTableId) {
        const current = tables.find((t) => t.id === draggingTableId);
        if (current && didMoveRef.current) {
          void persistTableDoc(current);
        } else if (current && !didMoveRef.current && waiterMode) {
          setDraggingTableId(null);
          didMoveRef.current = false;
          handleSelectTableAndRedirectToWaiterPos(current);
          return;
        }
      }
      setDraggingTableId(null);
      didMoveRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    draggingTableId,
    snapToGrid,
    tables,
    updateTableById,
    persistTableDoc,
    waiterMode,
    handleSelectTableAndRedirectToWaiterPos,
  ]);

  // Add a new table from bottom gallery
  const handleAddTableFromBottomGallery = (shape: TableShape, defaultSeats: number) => {
    const targetZone: TableZone =
      activeZoneFilter !== 'Semua Area' ? (activeZoneFilter as TableZone) : 'Indoor Utama';
    const areaPrefix = getAreaFirstWordPrefix(targetZone);
    const existingInAreaCount = tables.filter(
      (t) => getAreaFirstWordPrefix(t.zone).toLowerCase() === areaPrefix.toLowerCase()
    ).length;
    const nextAreaNumber = existingInAreaCount + 1;
    const shapeLabel =
      shape === 'round' ? 'Bulat' : shape === 'rectangle' ? 'Persegi Panjang' : 'Kotak';

    const offsetIdx = tables.length % 6;
    const spawnX = 24 + (offsetIdx % 3) * 24;
    const spawnY = 34 + Math.floor(offsetIdx / 3) * 26;

    const newTableNumber = `${areaPrefix} ${nextAreaNumber}`;
    const newTable: RestaurantTableDoc = {
      id: `tbl_${Date.now()}`,
      tableNumber: newTableNumber,
      name: `${newTableNumber} (${shapeLabel})`,
      shape,
      seats: defaultSeats,
      x: spawnX,
      y: spawnY,
      rotation: 0,
      zone: targetZone,
      status: 'available',
      visitorName: '',
      visitorPax: defaultSeats,
      seatedAt: new Date().toISOString(),
      orders: [],
      totalOrder: 0,
      notes: `Ditambahkan dari galeri meja ${shapeLabel.toLowerCase()}`,
      updatedAt: new Date().toISOString(),
    };

    setTables((prev) => {
      const next = [...prev, newTable];
      try {
        localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setSelectedTableId(newTable.id);
    void persistTableDoc(newTable);
    setStatusFeedback(
      `+ ${newTable.name} (${defaultSeats} Kursi) berhasil ditambahkan ke kotak denah atas!`
    );
  };

  const handleRotateTable = (tableId: string, deltaDeg: number) => {
    updateTableById(tableId, (prev) => ({
      ...prev,
      rotation: ((prev.rotation || 0) + deltaDeg + 360) % 360,
    }));
  };

  const handleDeleteTable = async (tableId: string) => {
    addDeletedIdsToStorage(LOCAL_STORAGE_DELETED_TABLES_KEY, [tableId]);
    const target = tables.find((t) => t.id === tableId);
    const remaining = tables.filter((t) => t.id !== tableId);
    setTables(remaining);
    if (selectedTableId === tableId) {
      setSelectedTableId(remaining[0]?.id || '');
    }
    try {
      localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(remaining));
      await deleteDoc(doc(db, 'restaurant_tables', tableId)).catch(() => {});
      if (ACTIVE_STORE_ID) {
        await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables', tableId)).catch(
          () => {}
        );
      }
    } catch {}
    if (target) {
      setStatusFeedback(`Meja "${target.name}" telah dihapus permanen dari database & denah.`);
    }
  };

  const handleClearTablesInCurrentArea = async () => {
    const isAllAreas = activeZoneFilter === 'Semua Area';
    const tablesToDelete = isAllAreas
      ? [...tables]
      : tables.filter((t) => t.zone === activeZoneFilter);
    const remaining = isAllAreas ? [] : tables.filter((t) => t.zone !== activeZoneFilter);

    const idsToDelete = tablesToDelete.map((t) => t.id);
    addDeletedIdsToStorage(LOCAL_STORAGE_DELETED_TABLES_KEY, idsToDelete);
    setTables(remaining);
    setSelectedTableId(remaining[0]?.id || '');

    try {
      localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(remaining));
      await Promise.all(
        idsToDelete.flatMap((id) => [
          deleteDoc(doc(db, 'restaurant_tables', id)).catch(() => {}),
          ACTIVE_STORE_ID
            ? deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables', id)).catch(
                () => {}
              )
            : Promise.resolve(),
        ])
      );
      if (isAllAreas) {
        const snapRoot = await getDocs(collection(db, 'restaurant_tables')).catch(() => null);
        if (snapRoot) {
          await Promise.all(
            snapRoot.docs.map((d) => deleteDoc(doc(db, 'restaurant_tables', d.id)).catch(() => {}))
          );
        }
        if (ACTIVE_STORE_ID) {
          const snapStore = await getDocs(
            collection(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables')
          ).catch(() => null);
          if (snapStore) {
            await Promise.all(
              snapStore.docs.map((d) =>
                deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables', d.id)).catch(
                  () => {}
                )
              )
            );
          }
        }
      }
    } catch {}

    setStatusFeedback(
      isAllAreas
        ? 'Semua meja di seluruh area berhasil dikosongkan permanen (0 Meja).'
        : `Semua meja pada area "${activeZoneFilter}" (${idsToDelete.length} meja) berhasil dikosongkan permanen.`
    );
  };

  const handleSaveLayoutToDatabase = async () => {
    if (isSavingLayout) return;
    setIsSavingLayout(true);
    try {
      const nowIso = new Date().toISOString();
      const activeIdsSet = new Set(tables.map((t) => t.id));

      // Remove any active table IDs from deleted tombstone list
      try {
        const deletedSet = getDeletedIdsSet(LOCAL_STORAGE_DELETED_TABLES_KEY);
        activeIdsSet.forEach((id) => deletedSet.delete(id));
        localStorage.setItem(
          LOCAL_STORAGE_DELETED_TABLES_KEY,
          JSON.stringify(Array.from(deletedSet))
        );
      } catch {}

      const cleanTables: RestaurantTableDoc[] = tables.map((t) =>
        sanitizeForDatabase({
          ...t,
          x: Number.isFinite(Number(t.x)) ? Number(t.x) : 25,
          y: Number.isFinite(Number(t.y)) ? Number(t.y) : 35,
          rotation: Number.isFinite(Number(t.rotation)) ? Number(t.rotation) : 0,
          seats: Math.max(1, Number(t.seats) || 4),
          visitorPax: Math.max(1, Number(t.visitorPax || t.seats) || 4),
          orders: Array.isArray(t.orders) ? t.orders : [],
          totalOrder:
            typeof t.totalOrder === 'number' && Number.isFinite(t.totalOrder)
              ? t.totalOrder
              : (Array.isArray(t.orders) ? t.orders : []).reduce(
                  (s, o) => s + Number(o.price || 0) * Number(o.qty || 1),
                  0
                ),
          updatedAt: nowIso,
        })
      );

      setTables(cleanTables);
      try {
        localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify(cleanTables));
        localStorage.setItem(LOCAL_STORAGE_TABLE_AREAS_KEY, JSON.stringify(tableAreas));
      } catch {}

      // 1. Save all current tables to root (`restaurant_tables`, `tables`, `table_layouts`) and store subcollection
      await Promise.allSettled(
        cleanTables.flatMap((tbl) => [
          syncDocToDatabase('restaurant_tables', tbl.id, tbl),
          syncDocToDatabase('tables', tbl.id, tbl),
          syncDocToDatabase('table_layouts', tbl.id, tbl),
          ACTIVE_STORE_ID
            ? syncDocToDatabase(`stores/${ACTIVE_STORE_ID}/restaurant_tables`, tbl.id, tbl)
            : Promise.resolve(true),
        ])
      );

      // 2. Clean up any stale table docs in Firestore that are no longer on the canvas
      try {
        const snapRoot = await getDocs(collection(db, 'restaurant_tables'));
        await Promise.allSettled(
          snapRoot.docs
            .filter((d) => !activeIdsSet.has(d.id))
            .map((d) => deleteDocFromDatabase('restaurant_tables', d.id))
        );
      } catch {}
      if (ACTIVE_STORE_ID) {
        try {
          const snapStore = await getDocs(
            collection(db, 'stores', ACTIVE_STORE_ID, 'restaurant_tables')
          );
          await Promise.allSettled(
            snapStore.docs
              .filter((d) => !activeIdsSet.has(d.id))
              .map((d) =>
                deleteDocFromDatabase(
                  `stores/${ACTIVE_STORE_ID}/restaurant_tables`,
                  d.id
                )
              )
          );
        } catch {}
      }

      // 3. Persist table areas & complete layout snapshot config to Firestore + Backend Server
      await persistTableAreas(tableAreas);
      const layoutConfigPayload = sanitizeForDatabase({
        id: 'table_layout_config',
        storeId: ACTIVE_STORE_ID,
        areas: tableAreas,
        snapToGrid: Boolean(snapToGrid),
        activeZoneFilter: String(activeZoneFilter || 'Indoor Utama'),
        tablesCount: cleanTables.length,
        tables: cleanTables,
        updatedAt: nowIso,
      });

      const logId = `log_layout_${Date.now()}`;
      await Promise.allSettled([
        syncDocToDatabase('settings', 'table_layout_config', layoutConfigPayload),
        syncDocToDatabase('table_layouts', 'active_layout', layoutConfigPayload),
        ACTIVE_STORE_ID
          ? syncDocToDatabase(
              `stores/${ACTIVE_STORE_ID}/settings`,
              'table_layout_config',
              layoutConfigPayload
            )
          : Promise.resolve(true),
        syncDocToDatabase(
          'ai_activity_logs',
          logId,
          sanitizeForDatabase({
            id: logId,
            module: 'TableLayoutModule',
            action: 'SAVE_TABLE_LAYOUT',
            summary: `Save Layout Denah Meja (${cleanTables.length} Meja, ${tableAreas.length} Area)`,
            tablesCount: cleanTables.length,
            areas: tableAreas,
            snapToGrid: Boolean(snapToGrid),
            storeId: ACTIVE_STORE_ID,
            timestamp: nowIso,
          })
        ),
      ]);

      publishRealtimeEvent('tables_updated', {
        savedLayout: true,
        tablesCount: cleanTables.length,
        updatedAt: nowIso,
      });

      const jamSaved = new Date(nowIso).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setLastSavedLayoutAt(jamSaved);
      setStatusFeedback(
        `Layout denah meja (${cleanTables.length} Meja & ${tableAreas.length} Area) berhasil disimpan secara real-time ke database server pada pukul ${jamSaved}!`
      );
    } catch (err) {
      console.error('[TableLayoutModule] handleSaveLayoutToDatabase error:', err);
      const jamFallback = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setLastSavedLayoutAt(jamFallback);
      setStatusFeedback(
        `Layout denah meja (${tables.length} Meja) berhasil diamankan & masuk antrean sinkronisasi otomatis ke server.`
      );
    } finally {
      setIsSavingLayout(false);
    }
  };

  const handleWipeAllTablesAndDummyData = async () => {
    const allTableIds = tables.map((t) => t.id);
    const allResIds = reservations.map((r) => r.id);
    const allDhIds = dineInHistory.map((d) => d.id);
    addDeletedIdsToStorage(LOCAL_STORAGE_DELETED_TABLES_KEY, allTableIds);
    addDeletedIdsToStorage(LOCAL_STORAGE_DELETED_RESERVATIONS_KEY, allResIds);
    addDeletedIdsToStorage(LOCAL_STORAGE_DELETED_DINEIN_KEY, allDhIds);

    setTables([]);
    setReservations([]);
    setDineInHistory([]);
    setSelectedTableId('');
    setResTableId('');

    try {
      localStorage.setItem(LOCAL_STORAGE_TABLES_KEY, JSON.stringify([]));
      localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify([]));
      localStorage.setItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY, JSON.stringify([]));
      localStorage.removeItem('riskcart_waiter_active_table');

      const cols = ['restaurant_tables', 'table_reservations', 'table_dinein_history'];
      for (const colName of cols) {
        try {
          const snapRoot = await getDocs(collection(db, colName));
          await Promise.all(
            snapRoot.docs.map((d) => deleteDoc(doc(db, colName, d.id)).catch(() => {}))
          );
        } catch {}
        if (ACTIVE_STORE_ID) {
          try {
            const snapStore = await getDocs(
              collection(db, 'stores', ACTIVE_STORE_ID, colName)
            );
            await Promise.all(
              snapStore.docs.map((d) =>
                deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, colName, d.id)).catch(() => {})
              )
            );
          } catch {}
        }
      }
    } catch {}

    setStatusFeedback(
      'Seluruh meja, reservasi, dan riwayat telah dikosongkan dari Firestore & LocalStorage.'
    );
  };

  const handleAddOrderToSelectedTable = () => {
    if (!selectedTable) return;

    let itemName = customOrderName.trim();
    let itemPrice = Number(customOrderPrice) || 0;
    let prodId: string | undefined = undefined;

    if (selectedProductIdToAdd) {
      const foundProd = storeProducts.find((p) => p.id === selectedProductIdToAdd);
      if (foundProd) {
        prodId = foundProd.id;
        itemName = foundProd.name;
        itemPrice = Number(
          foundProd.posPrice ??
            foundProd.sellPrice ??
            foundProd.pricePerUnit ??
            foundProd.pricePerCarton ??
            25000
        );
      }
    }

    if (!itemName) return;
    const qty = Math.max(1, Number(customOrderQty) || 1);

    updateTableById(selectedTable.id, (prev) => {
      const prevOrders = Array.isArray(prev.orders) ? prev.orders : [];
      const existingIdx = prevOrders.findIndex(
        (o) => String(o?.name || '').toLowerCase() === itemName.toLowerCase()
      );
      let nextOrders: TableOrderItem[];
      if (existingIdx >= 0) {
        nextOrders = prevOrders.map((o, idx) =>
          idx === existingIdx ? { ...o, qty: (Number(o.qty) || 1) + qty } : o
        );
      } else {
        nextOrders = [
          ...prevOrders,
          {
            id: `ord_${Date.now()}`,
            productId: prodId,
            name: itemName,
            qty,
            price: itemPrice,
          },
        ];
      }
      return {
        ...prev,
        status: prev.status === 'available' ? 'occupied' : prev.status,
        seatedAt: prev.seatedAt || new Date().toISOString(),
        visitorName: prev.visitorName || 'Tamu Walk-In',
        orders: nextOrders,
      };
    });

    setCustomOrderName('');
    setCustomOrderQty(1);
    setSelectedProductIdToAdd('');
  };

  const handleCompleteAndClearTable = async () => {
    if (!selectedTable) return;
    const currentOrders = Array.isArray(selectedTable.orders) ? selectedTable.orders : [];
    const parsedSeated = selectedTable.seatedAt ? Date.parse(selectedTable.seatedAt) : NaN;
    const calcDuration = !Number.isNaN(parsedSeated)
      ? Math.max(15, Math.floor((Date.now() - parsedSeated) / 60000))
      : 60;

    if (currentOrders.length > 0 || selectedTable.visitorName) {
      // Record into Daily Dine-In History for Summary Report
      const nowObj = new Date();
      const jamNow = `${String(nowObj.getHours()).padStart(2, '0')}:${String(
        nowObj.getMinutes()
      ).padStart(2, '0')}`;
      const newHistoryRec: DailyTableBookingRecord = {
        id: `dh_${Date.now()}`,
        tanggal: getTodayDateString(),
        jam: jamNow,
        tableId: selectedTable.id,
        tableNumber: selectedTable.tableNumber,
        tableName: selectedTable.name,
        area: selectedTable.zone,
        visitorName: selectedTable.visitorName || 'Tamu Dine-In',
        visitorCount: Number(selectedTable.visitorPax) || Number(selectedTable.seats) || 2,
        totalRevenue: Number(selectedTable.totalOrder) || 0,
        durasiDineIn: calcDuration,
        source: 'dine_in',
      };
      setDineInHistory((prev) => {
        const next = [newHistoryRec, ...prev];
        try {
          localStorage.setItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      void persistDineInRecord(newHistoryRec);
    }

    if (currentOrders.length > 0) {
      try {
        const txId = `tx_tbl_${Date.now()}`;
        const newTx: any = {
          id: txId,
          receiptNo: `INV-TBL-${String(Date.now()).slice(-6)}`,
          timestamp: new Date().toISOString(),
          customerName: `${selectedTable.visitorName || 'Tamu Dine-In'} (${selectedTable.tableNumber})`,
          items: currentOrders.map((o) => ({
            productId: o.productId || o.id,
            name: o.name,
            qty: Number(o.qty) || 1,
            unit: 'unit',
            price: Number(o.price) || 0,
          })),
          totalAmount: Number(selectedTable.totalOrder) || 0,
          paymentMethod: 'TUNAI / QRIS (DINE-IN)',
          status: 'COMPLETED',
        };
        if (addTransactionLocal) {
          addTransactionLocal(newTx);
        }
        await setDoc(doc(db, 'transactions', txId), JSON.parse(JSON.stringify(newTx)), { merge: true });
      } catch (e) {
        console.warn('Optional POS transaction log warning:', e);
      }
    }

    const oldVisitor = selectedTable.visitorName || selectedTable.tableNumber;
    updateTableById(selectedTable.id, (prev) => ({
      ...prev,
      status: 'available',
      visitorName: '',
      visitorPax: prev.seats,
      seatedAt: '',
      orders: [],
      totalOrder: 0,
      notes: 'Meja telah dibersihkan & siap untuk pengunjung berikutnya',
    }));

    setStatusFeedback(
      `Transaksi meja ${selectedTable.tableNumber} (${oldVisitor}) selesai, tercatat ke Summary Report & meja kini berstatus KOSONG.`
    );
  };

  // ---------------------------------------------------------------------------
  // RESERVATION ACTIONS (/dashboard/reservation & /dashboard/reservation/list)
  // ---------------------------------------------------------------------------
  const resTotalOrder = useMemo(
    () =>
      resOrders.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1),
        0
      ),
    [resOrders]
  );

  const handleAddItemToReservation = () => {
    let itemName = resCustomItemName.trim();
    let itemPrice = Number(resCustomItemPrice) || 0;
    let prodId: string | undefined = undefined;

    if (resProductToAdd) {
      const found = storeProducts.find((p) => p.id === resProductToAdd);
      if (found) {
        prodId = found.id;
        itemName = found.name;
        itemPrice = Number(
          found.posPrice ??
            found.sellPrice ??
            found.pricePerUnit ??
            found.pricePerCarton ??
            25000
        );
      }
    }
    if (!itemName) return;
    const qty = Math.max(1, Number(resCustomItemQty) || 1);

    setResOrders((prev) => {
      const existingIdx = prev.findIndex(
        (o) => o.name.toLowerCase() === itemName.toLowerCase()
      );
      if (existingIdx >= 0) {
        return prev.map((o, i) => (i === existingIdx ? { ...o, qty: o.qty + qty } : o));
      }
      return [
        ...prev,
        {
          id: `ro_${Date.now()}`,
          productId: prodId,
          name: itemName,
          qty,
          price: itemPrice,
        },
      ];
    });
    setResCustomItemName('');
    setResCustomItemQty(1);
    setResProductToAdd('');
  };

  const handleSaveNewReservation = (e: React.FormEvent) => {
    e.preventDefault();
    const targetTable = selectedResTable || tables[0];
    if (!targetTable) return;

    const cleanNama = resNama.trim() || 'Tamu Reservasi';
    const cleanPhone = resNomorHp.trim() || '0812-0000-0000';
    const code = `RSV-${new Date().getFullYear()}-${String(reservations.length + 1).padStart(3, '0')}`;

    const newRes: TableReservationDoc = {
      id: `rsv_${Date.now()}`,
      reservationCode: code,
      nama: cleanNama,
      nomorHandphone: cleanPhone,
      tanggal: resTanggal || todayStr,
      jamDatang: resJamDatang || '19:00',
      durasi: Math.max(30, Number(resDurasi) || 120),
      tableId: targetTable.id,
      tableNumber: targetTable.tableNumber,
      tableName: targetTable.name,
      area: targetTable.zone,
      visitorPax: Math.max(1, Number(resVisitorPax) || targetTable.seats || 4),
      orders: [...resOrders],
      totalOrder: resTotalOrder,
      downpayment: Math.max(0, Number(resDownpayment) || 0),
      status: 'confirmed',
      notes: resNotes.trim() || `Reservasi ${cleanNama} (${cleanPhone})`,
      createdAt: new Date().toISOString(),
    };

    setReservations((prev) => {
      const next = [newRes, ...prev];
      try {
        localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    void persistReservationDoc(newRes);

    // Also record in daily booking table so Summary Report immediately reflects this booking
    const newBookingRecord: DailyTableBookingRecord = {
      id: `dh_rsv_${Date.now()}`,
      tanggal: newRes.tanggal,
      jam: newRes.jamDatang,
      tableId: newRes.tableId,
      tableNumber: newRes.tableNumber,
      tableName: newRes.tableName,
      area: newRes.area,
      visitorName: newRes.nama,
      visitorCount: newRes.visitorPax,
      totalRevenue: newRes.totalOrder > 0 ? newRes.totalOrder : newRes.downpayment,
      durasiDineIn: newRes.durasi,
      source: 'reservation',
    };
    setDineInHistory((prev) => {
      const next = [newBookingRecord, ...prev];
      try {
        localStorage.setItem(LOCAL_STORAGE_DINEIN_HISTORY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    void persistDineInRecord(newBookingRecord);

    // If reservation has Downpayment (DP > 0), record cash inflow into transactions, cash_flows, and pos_incomes
    if (newRes.downpayment > 0) {
      const nowIso = newRes.createdAt || new Date().toISOString();
      const formattedDateStr = new Date(nowIso).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const dpTxId = `TX-RSV-${newRes.id}`;
      const dpAmount = Number(newRes.downpayment) || 0;
      const totalOrderVal = Number(newRes.totalOrder) > 0 ? Number(newRes.totalOrder) : dpAmount;
      const remainingVal = Math.max(0, totalOrderVal - dpAmount);
      const activeShiftId = appData?.activeShift?.id || null;
      const activeCashierName =
        appData?.activeShift?.cashierName ||
        (appData?.activeCashier as any)?.name ||
        'Admin Reservasi';

      const dpTxDoc = {
        id: dpTxId,
        storeId: ACTIVE_STORE_ID,
        orderNumber: newRes.reservationCode,
        tableId: newRes.tableId,
        tableNumber: newRes.tableNumber,
        customerName: `${newRes.nama} (Reservasi ${newRes.tableNumber})`,
        customerPhone: newRes.nomorHandphone,
        customerAddress: `Reservasi Meja ${newRes.tableNumber} (${newRes.area})`,
        channel: 'pos',
        source: 'Reservation DP',
        items: newRes.orders.map((o) => ({
          productId: o.productId || o.id,
          productName: o.name,
          name: o.name,
          packageType: 'unit',
          quantityOrdered: o.qty,
          qty: o.qty,
          unitPrice: o.price,
          price: o.price,
          subtotal: o.price * o.qty,
        })),
        itemsCount: newRes.orders.reduce((s, o) => s + (o.qty || 1), 0) || 1,
        subtotal: totalOrderVal,
        total: totalOrderVal,
        totalAmount: totalOrderVal,
        totalCost: Math.round(totalOrderVal * 0.65),
        totalProfit: Math.round(dpAmount * 0.35),
        paymentMethod: 'cash',
        paymentMethodLabel: 'DP Reservasi Meja',
        paymentStatus: remainingVal <= 0 ? 'paid' : 'partial',
        paidAmount: dpAmount,
        remainingDebt: remainingVal,
        status: 'completed',
        fulfillmentStatus: 'New',
        cashierName: activeCashierName,
        shiftId: activeShiftId,
        notes: `DP Reservasi ${newRes.reservationCode} — Meja ${newRes.tableNumber} (${newRes.tanggal} ${newRes.jamDatang})`,
        orderDate: newRes.tanggal,
        timestamp: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (addTransactionLocal) {
        addTransactionLocal(dpTxDoc as any);
      }

      void Promise.all([
        setDoc(doc(db, 'transactions', dpTxId), dpTxDoc, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'transactions', dpTxId), dpTxDoc, {
          merge: true,
        }).catch(() => {}),
        setDoc(
          doc(db, 'cash_flows', `CF-${dpTxId}`),
          {
            id: `CF-${dpTxId}`,
            transactionId: dpTxId,
            storeId: ACTIVE_STORE_ID,
            type: 'in',
            category: 'DP Reservasi Meja',
            source: 'Reservasi',
            method: 'DP Reservasi Meja',
            paymentMethod: 'cash',
            paymentStatus: 'paid',
            amount: dpAmount,
            customerName: newRes.nama,
            cashierName: activeCashierName,
            shiftId: activeShiftId,
            description: `DP Reservasi ${newRes.reservationCode} - ${newRes.nama} (Meja ${newRes.tableNumber})`,
            note: `DP Reservasi ${newRes.reservationCode} (${newRes.tanggal} ${newRes.jamDatang})`,
            date: formattedDateStr,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          { merge: true }
        ).catch(() => {}),
        setDoc(
          doc(db, 'pos_incomes', `INC-${dpTxId}`),
          {
            id: `INC-${dpTxId}`,
            transactionId: dpTxId,
            source: `DP Reservasi #${newRes.reservationCode} (${newRes.nama})`,
            category: 'DP Reservasi Meja',
            customer: newRes.nama,
            cashierName: activeCashierName,
            shiftId: activeShiftId,
            method: 'DP Reservasi Meja',
            paymentStatus: 'paid',
            amount: dpAmount,
            note: `DP Reservasi Meja ${newRes.tableNumber} (${newRes.tanggal} ${newRes.jamDatang})`,
            date: formattedDateStr,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          { merge: true }
        ).catch(() => {}),
      ]);

      publishRealtimeEvent('transactions_updated', { transaction: dpTxDoc });
      publishRealtimeEvent('finance_updated', { transactionId: dpTxId, amount: dpAmount });
    }

    // If reservation is for today, mark the table as reserved if currently available
    if (newRes.tanggal === todayStr) {
      updateTableById(targetTable.id, (prev) => ({
        ...prev,
        status: prev.status === 'available' ? 'reserved' : prev.status,
        visitorName: prev.visitorName || `Reservasi ${newRes.nama}`,
        visitorPax: newRes.visitorPax,
        orders: prev.orders.length > 0 ? prev.orders : newRes.orders,
      }));
    }

    setStatusFeedback(
      `Reservasi ${newRes.reservationCode} atas nama "${newRes.nama}" (${newRes.nomorHandphone}) pada ${newRes.tanggal} pukul ${newRes.jamDatang} (${newRes.durasi} menit) di meja ${newRes.tableNumber} berhasil disimpan!`
    );
    setResNama('');
    setResNomorHp('');
    setResNotes('');
  };

  const handleUpdateReservationStatus = (
    resId: string,
    nextStatus: TableReservationDoc['status']
  ) => {
    setReservations((prev) => {
      const next = prev.map((r) => {
        if (r.id !== resId) return r;
        const updated = { ...r, status: nextStatus };
        void persistReservationDoc(updated);
        if (nextStatus === 'checked_in') {
          updateTableById(r.tableId, (t) => ({
            ...t,
            status: 'occupied',
            visitorName: r.nama,
            visitorPax: r.visitorPax,
            seatedAt: new Date().toISOString(),
            orders: r.orders.length > 0 ? r.orders : t.orders,
          }));
        }
        return updated;
      });
      try {
        localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setStatusFeedback(`Status reservasi berhasil diperbarui menjadi ${nextStatus.toUpperCase()}.`);
  };

  const handleDeleteReservation = async (resId: string) => {
    addDeletedIdsToStorage(LOCAL_STORAGE_DELETED_RESERVATIONS_KEY, [resId]);
    setReservations((prev) => {
      const next = prev.filter((r) => r.id !== resId);
      try {
        localStorage.setItem(LOCAL_STORAGE_RESERVATIONS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    try {
      await deleteDoc(doc(db, 'table_reservations', resId)).catch(() => {});
      if (ACTIVE_STORE_ID) {
        await deleteDoc(doc(db, 'stores', ACTIVE_STORE_ID, 'table_reservations', resId)).catch(
          () => {}
        );
      }
    } catch {}
    setStatusFeedback('Data reservasi telah dihapus permanen dari database.');
  };

  // ---------------------------------------------------------------------------
  // CALENDAR COMPUTATIONS FOR /dashboard/reservation
  // ---------------------------------------------------------------------------
  const calendarDays = useMemo(() => {
    const year = calendarMonthDate.getFullYear();
    const month = calendarMonthDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    // Convert Sunday=0..Saturday=6 into Monday=0..Sunday=6
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    const totalDays = lastDayOfMonth.getDate();

    const cells: Array<{
      dateStr: string;
      dayNum: number;
      inCurrentMonth: boolean;
      reservationsCount: number;
    }> = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const dNum = prevMonthLastDay - i;
      const dObj = new Date(year, month - 1, dNum);
      const dStr = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(
        dObj.getDate()
      ).padStart(2, '0')}`;
      const count = reservations.filter(
        (r) =>
          r.tanggal === dStr &&
          r.status !== 'cancelled' &&
          (calendarAreaFilter === 'Semua Area' || r.area === calendarAreaFilter)
      ).length;
      cells.push({
        dateStr: dStr,
        dayNum: dNum,
        inCurrentMonth: false,
        reservationsCount: count,
      });
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = reservations.filter(
        (r) =>
          r.tanggal === dStr &&
          r.status !== 'cancelled' &&
          (calendarAreaFilter === 'Semua Area' || r.area === calendarAreaFilter)
      ).length;
      cells.push({
        dateStr: dStr,
        dayNum: d,
        inCurrentMonth: true,
        reservationsCount: count,
      });
    }

    // Next month padding up to 35 or 42 cells
    const totalCells = cells.length <= 35 ? 35 : 42;
    const remaining = totalCells - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const dObj = new Date(year, month + 1, d);
      const dStr = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(
        dObj.getDate()
      ).padStart(2, '0')}`;
      const count = reservations.filter(
        (r) =>
          r.tanggal === dStr &&
          r.status !== 'cancelled' &&
          (calendarAreaFilter === 'Semua Area' || r.area === calendarAreaFilter)
      ).length;
      cells.push({
        dateStr: dStr,
        dayNum: d,
        inCurrentMonth: false,
        reservationsCount: count,
      });
    }

    return cells;
  }, [calendarMonthDate, reservations, calendarAreaFilter]);

  const reservationsForSelectedDate = useMemo(() => {
    return reservations.filter(
      (r) =>
        r.tanggal === resTanggal &&
        r.status !== 'cancelled' &&
        (calendarAreaFilter === 'Semua Area' || r.area === calendarAreaFilter)
    );
  }, [reservations, resTanggal, calendarAreaFilter]);

  // ---------------------------------------------------------------------------
  // SUMMARY REPORT ANALYTICS (/dashboard/layout-table/summary)
  // ---------------------------------------------------------------------------
  const filteredDailyRecords = useMemo(() => {
    return dineInHistory.filter((rec) => {
      if (summarySpecificDate) {
        if (rec.tanggal !== summarySpecificDate) return false;
      } else {
        if (summaryStartDate && rec.tanggal < summaryStartDate) return false;
        if (summaryEndDate && rec.tanggal > summaryEndDate) return false;
      }
      if (summaryAreaFilter !== 'Semua Area' && rec.area !== summaryAreaFilter) {
        return false;
      }
      if (summarySearch.trim()) {
        const q = summarySearch.toLowerCase();
        const match =
          rec.tableNumber.toLowerCase().includes(q) ||
          rec.tableName.toLowerCase().includes(q) ||
          rec.visitorName.toLowerCase().includes(q) ||
          rec.area.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    dineInHistory,
    summarySpecificDate,
    summaryStartDate,
    summaryEndDate,
    summaryAreaFilter,
    summarySearch,
  ]);

  // Aggregate occupancy frequency, total visitors, total revenue, and avg duration per table
  const tableOccupancyAnalytics = useMemo(() => {
    const map = new Map<
      string,
      {
        tableNumber: string;
        tableName: string;
        area: TableZone;
        occupiedCount: number;
        totalVisitors: number;
        totalRevenue: number;
        totalDuration: number;
      }
    >();

    // Seed all known tables so even 0-visit tables appear in "10 Table jarang di isi"
    tables.forEach((t) => {
      map.set(t.tableNumber, {
        tableNumber: t.tableNumber,
        tableName: t.name,
        area: t.zone,
        occupiedCount: 0,
        totalVisitors: 0,
        totalRevenue: 0,
        totalDuration: 0,
      });
    });

    filteredDailyRecords.forEach((rec) => {
      const existing = map.get(rec.tableNumber) || {
        tableNumber: rec.tableNumber,
        tableName: rec.tableName,
        area: rec.area,
        occupiedCount: 0,
        totalVisitors: 0,
        totalRevenue: 0,
        totalDuration: 0,
      };
      existing.occupiedCount += 1;
      existing.totalVisitors += Number(rec.visitorCount) || 0;
      existing.totalRevenue += Number(rec.totalRevenue) || 0;
      existing.totalDuration += Number(rec.durasiDineIn) || 0;
      map.set(rec.tableNumber, existing);
    });

    const allStats = Array.from(map.values());

    // Top 10 Most Occupied Tables (10 Table terbanyak di isi)
    const top10MostOccupied = [...allStats]
      .sort((a, b) =>
        b.occupiedCount !== a.occupiedCount
          ? b.occupiedCount - a.occupiedCount
          : b.totalRevenue - a.totalRevenue
      )
      .slice(0, 10);

    // Top 10 Least Occupied Tables (10 Table jarang di isi)
    const top10LeastOccupied = [...allStats]
      .sort((a, b) =>
        a.occupiedCount !== b.occupiedCount
          ? a.occupiedCount - b.occupiedCount
          : a.totalRevenue - b.totalRevenue
      )
      .slice(0, 10);

    return {
      top10MostOccupied,
      top10LeastOccupied,
    };
  }, [tables, filteredDailyRecords]);

  // Filtered Reservations for List Reservasi (/dashboard/reservation/list)
  const filteredReservationList = useMemo(() => {
    return reservations.filter((r) => {
      if (listDateFilter && r.tanggal !== listDateFilter) return false;
      if (listStatusFilter !== 'all' && r.status !== listStatusFilter) return false;
      if (listAreaFilter !== 'Semua Area' && r.area !== listAreaFilter) return false;
      if (listSearch.trim()) {
        const q = listSearch.toLowerCase();
        const match =
          r.nama.toLowerCase().includes(q) ||
          r.nomorHandphone.toLowerCase().includes(q) ||
          r.tableNumber.toLowerCase().includes(q) ||
          r.reservationCode.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [reservations, listDateFilter, listStatusFilter, listAreaFilter, listSearch]);

  const visibleTables = useMemo(() => {
    if (activeZoneFilter === 'Semua Area') return tables;
    return tables.filter((t) => t.zone === activeZoneFilter);
  }, [tables, activeZoneFilter]);

  const occupiedCount = tables.filter((t) => t.status === 'occupied' || t.status === 'billing').length;
  const availableCount = tables.filter((t) => t.status === 'available').length;
  const reservedCount = tables.filter((t) => t.status === 'reserved').length;
  const totalActiveRevenue = tables.reduce((s, t) => s + (Number(t.totalOrder) || 0), 0);

  const seatedTimeInfo = selectedTable
    ? formatSeatedTimeDisplay(selectedTable.seatedAt, nowTick)
    : { clock: '-', duration: '-' };

  // ---------------------------------------------------------------------------
  // RENDER SUB-NAVIGATION BAR FOR "RESERVATION TABLE"
  // ---------------------------------------------------------------------------
  const renderReservationTableSubNav = () => {
    if (waiterMode) return null;
    const navItems = [
      {
        id: 'reservation',
        label: 'Reservasi',
        path: '/dashboard/reservation',
        icon: <CalendarIcon className="w-4 h-4" />,
        active: activeView === 'reservation',
      },
      {
        id: 'reservation_list',
        label: 'List Reservasi',
        path: '/dashboard/reservation/list',
        icon: <ListChecks className="w-4 h-4" />,
        active: activeView === 'reservation_list',
        badge: reservations.length,
      },
      {
        id: 'layout',
        label: 'Table Layout',
        path: '/dashboard/layout-table',
        icon: <LayoutGrid className="w-4 h-4" />,
        active: activeView === 'layout',
      },
      {
        id: 'summary',
        label: 'Summary Report',
        path: '/dashboard/layout-table/summary',
        icon: <BarChart3 className="w-4 h-4" />,
        active: activeView === 'summary',
      },
    ];

    return (
      <div className="p-3 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 px-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span className="text-xs font-black uppercase tracking-wider text-amber-300">
            Reservation Table Menu
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {navItems.map((item) => (
            <AppLink
              key={item.id}
              to={item.path}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer ${
                item.active
                  ? 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black shadow-[0_0_14px_rgba(245,158,11,0.3)]'
                  : 'bg-[#090805] text-amber-100/80 hover:text-white border border-amber-500/30 hover:border-amber-400/60'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                    item.active
                      ? 'bg-black/20 text-black'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </AppLink>
          ))}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // RENDER TOMBOL ICON 3 TITIK VERTIKAL PUTIH (EDIT, TAMBAH, HAPUS AREA)
  // ---------------------------------------------------------------------------
  const renderAreaManagerButtonAndMenu = () => {
    return (
      <div className="relative inline-block" ref={areaMenuContainerRef}>
        <button
          type="button"
          onClick={() => {
            setIsAreaMenuOpen((prev) => !prev);
            setEditingAreaOriginal(null);
          }}
          title="Edit, Tambah & Hapus Area"
          aria-label="Edit, Tambah & Hapus Area"
          className={`px-2.5 py-1.5 rounded-lg border transition cursor-pointer flex items-center justify-center ${
            isAreaMenuOpen
              ? 'bg-amber-500/25 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
              : 'bg-[#0b0906] hover:bg-zinc-900 border-amber-500/35 hover:border-amber-400'
          }`}
        >
          {/* Icon 3 Titik Vertikal Warna Putih sesuai lampiran */}
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 text-white"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="12" cy="4.5" r="2.6" fill="currentColor" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            <circle cx="12" cy="19.5" r="2.6" fill="currentColor" />
          </svg>
        </button>

        {isAreaMenuOpen && (
          <div className="rc-tooltip-box absolute left-0 sm:left-auto sm:right-0 lg:left-0 mt-2 w-80 rounded-2xl bg-[#120f09] border-2 border-amber-500/50 shadow-[0_18px_45px_rgba(0,0,0,0.85)] p-4 z-50 space-y-3.5">
            <div className="flex items-center justify-between border-b border-amber-500/25 pb-2.5">
              <div>
                <div className="text-xs font-black text-white uppercase tracking-wider">
                  Kelola Area Meja
                </div>
                <div className="text-[10px] text-amber-200/75">
                  Tambah, Edit, atau Hapus Area Ruangan
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAreaMenuOpen(false);
                  setEditingAreaOriginal(null);
                }}
                className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Form Tambah Area Baru */}
            <form onSubmit={handleAddArea} className="space-y-1.5">
              <label className="block text-[11px] font-extrabold text-amber-300">
                + Tambah Area Baru
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  placeholder="Contoh: Rooftop / Balkon..."
                  className="flex-1 px-2.5 py-1.5 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-bold text-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs flex items-center gap-1 transition cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah</span>
                </button>
              </div>
            </form>

            {/* Daftar Area (Edit & Hapus) */}
            <div className="space-y-1.5 pt-1 border-t border-amber-500/20">
              <div className="text-[11px] font-extrabold text-amber-300">
                Daftar Area ({tableAreas.length} Area) — Edit / Hapus
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                {tableAreas.map((areaName) => {
                  const isEditingThis = editingAreaOriginal === areaName;
                  return (
                    <div
                      key={areaName}
                      className="p-2 rounded-xl bg-[#090805] border border-zinc-800/90 flex items-center justify-between gap-2"
                    >
                      {isEditingThis ? (
                        <div className="flex items-center gap-1.5 w-full">
                          <input
                            type="text"
                            value={editingAreaValue}
                            onChange={(e) => setEditingAreaValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveEditArea(areaName);
                              } else if (e.key === 'Escape') {
                                setEditingAreaOriginal(null);
                              }
                            }}
                            autoFocus
                            className="flex-1 px-2 py-1 rounded-lg bg-zinc-950 border border-amber-400 text-xs font-bold text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEditArea(areaName)}
                            className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold cursor-pointer"
                            title="Simpan Nama Area"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingAreaOriginal(null)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                            title="Batal"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs font-bold text-white truncate pl-1">
                            {areaName}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAreaOriginal(areaName);
                                setEditingAreaValue(areaName);
                              }}
                              className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/30 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                              title={`Edit Area ${areaName}`}
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteArea(areaName)}
                              disabled={tableAreas.length <= 1}
                              className="px-2 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
                              title={`Hapus Area ${areaName}`}
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Hapus</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ===========================================================================
  // VIEW 1: RESERVASI (/dashboard/reservation)
  // 2 Kolom seperti Table Layout, mengganti denah table menjadi Kalender beserta Jam,
  // Kanan bagian Reservasi: Nama, Nomor Handphone, Tanggal, Jam Datang, Durasi,
  // Menu yang Dipesan, Downpayment.
  // ===========================================================================
  const renderReservasiView = () => {
    const endTimeStr = computeEndTime(resJamDatang, resDurasi);
    const remainingPayment = Math.max(0, resTotalOrder - (Number(resDownpayment) || 0));

    return (
      <div className="space-y-5">
        {/* Page Header */}
        <div className="p-5 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-amber-50 tracking-tight">
                Reservasi Table — Kalender Jadwal Jam &amp; Form Pemesanan Meja
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                /dashboard/reservation
              </span>
            </div>
            <p className="text-xs text-amber-100/70">
              Pilih tanggal dan jam kedatangan pada kalender di sebelah kiri, lalu lengkapi data reservasi (Nama, Nomor Handphone, Tanggal, Jam Datang, Durasi, Menu yang Dipesan, dan Downpayment) di sebelah kanan.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <AppLink
              to="/dashboard/reservation/list"
              className="px-4 py-2.5 rounded-xl bg-[#090805] hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-2 transition cursor-pointer"
            >
              <ListChecks className="w-4 h-4" />
              <span>Lihat List Reservasi ({reservations.length})</span>
            </AppLink>
          </div>
        </div>

        {/* 2 KOLOM UTAMA (Sama seperti Table Layout: Kiri Kalender + Jam lg:col-span-8, Kanan Form Reservasi lg:col-span-4) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ================================================================= */}
          {/* KOLOM KIRI (lg:col-span-8): KALENDER BESERTA JAM                  */}
          {/* ================================================================= */}
          <div className="lg:col-span-8 space-y-5">
            <div className="rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl">
              {/* Calendar Top Toolbar */}
              <div className="p-3.5 rounded-t-2xl bg-[#17130b] border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {['Semua Area', ...tableAreas].map((zone) => (
                    <button
                      key={zone}
                      type="button"
                      onClick={() => setCalendarAreaFilter(zone)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        calendarAreaFilter === zone
                          ? 'bg-amber-500 text-black shadow-sm'
                          : 'bg-[#0b0906] text-amber-100/75 hover:text-white border border-amber-500/25'
                      }`}
                    >
                      {zone}
                    </button>
                  ))}
                  {renderAreaManagerButtonAndMenu()}
                </div>

                {/* Month Navigation */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarMonthDate(
                        (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                      )
                    }
                    className="p-1.5 rounded-lg bg-[#090805] hover:bg-amber-500 hover:text-black text-amber-200 border border-amber-500/30 transition cursor-pointer"
                    title="Bulan Sebelumnya"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs sm:text-sm font-black text-amber-100 min-w-[130px] text-center">
                    {INDONESIAN_MONTHS[calendarMonthDate.getMonth()]}{' '}
                    {calendarMonthDate.getFullYear()}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCalendarMonthDate(
                        (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                      )
                    }
                    className="p-1.5 rounded-lg bg-[#090805] hover:bg-amber-500 hover:text-black text-amber-200 border border-amber-500/30 transition cursor-pointer"
                    title="Bulan Berikutnya"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarMonthDate(new Date());
                      setResTanggal(todayStr);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/40 text-xs font-bold transition cursor-pointer"
                  >
                    Hari Ini
                  </button>
                </div>
              </div>

              {/* Monthly Calendar Grid */}
              <div className="rc-cal-grid-wrap p-4 bg-[#080705] space-y-4">
                <div className="grid grid-cols-7 gap-1.5 text-center">
                  {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((dName) => (
                    <div
                      key={dName}
                      className="rc-cal-day-header py-1.5 text-[11px] font-black uppercase tracking-wider text-amber-300/80 bg-[#12100a] rounded-lg border border-amber-500/20"
                    >
                      {dName}
                    </div>
                  ))}

                  {calendarDays.map((cell) => {
                    const isSelected = cell.dateStr === resTanggal;
                    const isToday = cell.dateStr === todayStr;

                    return (
                      <button
                        key={cell.dateStr}
                        type="button"
                        onClick={() => setResTanggal(cell.dateStr)}
                        className={`rc-cal-cell ${
                          isSelected
                            ? 'rc-cal-cell-selected'
                            : cell.inCurrentMonth
                            ? 'rc-cal-cell-current'
                            : 'rc-cal-cell-muted'
                        } min-h-[64px] p-2 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-br from-amber-500/30 via-[#291d09] to-[#171106] border-amber-400 ring-2 ring-amber-400/40 shadow-lg'
                            : cell.inCurrentMonth
                            ? 'bg-[#110f0a] hover:bg-[#1b160d] border-zinc-800/90 hover:border-amber-500/40'
                            : 'bg-[#090805]/50 border-zinc-900 text-zinc-600'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`rc-cal-day-num text-xs font-mono font-black ${
                              isSelected
                                ? 'text-amber-300'
                                : isToday
                                ? 'text-emerald-400'
                                : cell.inCurrentMonth
                                ? 'text-white'
                                : 'text-zinc-600'
                            }`}
                          >
                            {cell.dayNum}
                          </span>
                          {isToday && (
                            <span className="rc-cal-today-badge text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                              Hari Ini
                            </span>
                          )}
                        </div>

                        {cell.reservationsCount > 0 ? (
                          <div className="rc-cal-res-badge mt-1 px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-400/40 text-[10px] font-bold text-sky-300 truncate">
                            {cell.reservationsCount} Reservasi
                          </div>
                        ) : (
                          <div className="rc-cal-avail-label text-[9px] text-zinc-600 font-mono">Tersedia</div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Bagian Jam Kedatangan (Hourly Time Slots) */}
                <div className="pt-3 border-t border-amber-500/25 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <h3 className="text-xs sm:text-sm font-black text-white">
                        Jadwal Jam Reservasi — Tanggal{' '}
                        <span className="text-amber-300 font-mono">{resTanggal}</span>
                        {selectedResTable ? (
                          <span className="text-emerald-300 font-mono">
                            {' '}
                            · Meja {selectedResTable.tableNumber}
                          </span>
                        ) : null}
                      </h3>
                    </div>
                    <span className="text-[11px] text-amber-200/70">
                      Klik jam di bawah untuk memilih Jam Datang
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                    {OPERATIONAL_HOURS.map((hourSlot) => {
                      const isHourStart = resJamDatang.slice(0, 2) === hourSlot.slice(0, 2);
                      const isHourInSelectedSpan = doesIntervalCoverHourSlot(
                        resJamDatang,
                        resDurasi,
                        hourSlot
                      );
                      // Find if any existing reservation on this date covers this hour for the selected table or overall
                      const matchingResOnTable = reservationsForSelectedDate.find(
                        (r) =>
                          r.tableId === (selectedResTable?.id || '') &&
                          doesIntervalCoverHourSlot(r.jamDatang, r.durasi, hourSlot)
                      );
                      const allResAtHour = reservationsForSelectedDate.filter((r) =>
                        doesIntervalCoverHourSlot(r.jamDatang, r.durasi, hourSlot)
                      );

                      const matchedEndClock = matchingResOnTable
                        ? computeEndTime(matchingResOnTable.jamDatang, matchingResOnTable.durasi)
                        : '';

                      return (
                        <button
                          key={hourSlot}
                          type="button"
                          onClick={() => setResJamDatang(hourSlot)}
                          className={`rc-hour-slot ${
                            isHourStart || isHourInSelectedSpan
                              ? 'rc-hour-slot-selected'
                              : matchingResOnTable
                              ? 'rc-hour-slot-booked'
                              : 'rc-hour-slot-empty'
                          } p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                            isHourStart
                              ? 'bg-amber-500 text-black border-amber-200 ring-2 ring-amber-300/60 shadow-[0_0_16px_rgba(245,158,11,0.45)] font-black'
                              : isHourInSelectedSpan
                              ? 'bg-amber-500/80 text-black border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)] font-bold'
                              : matchingResOnTable
                              ? 'bg-sky-950/75 border-sky-400/70 text-sky-200 hover:border-sky-300'
                              : 'bg-[#12100a] hover:bg-[#1c170d] border-zinc-800 text-zinc-200 hover:border-amber-500/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="rc-hour-time text-xs font-mono font-black">{hourSlot}</span>
                            <span
                              className={`rc-hour-badge ${
                                isHourStart || isHourInSelectedSpan
                                  ? 'rc-hour-badge-selected'
                                  : matchingResOnTable
                                  ? 'rc-hour-badge-booked'
                                  : 'rc-hour-badge-empty'
                              } text-[9px] px-1.5 py-0.2 rounded font-bold whitespace-nowrap ${
                                isHourStart || isHourInSelectedSpan
                                  ? 'bg-black/25 text-black'
                                  : matchingResOnTable
                                  ? 'bg-sky-500/30 text-sky-200'
                                  : 'bg-emerald-500/15 text-emerald-400'
                              }`}
                            >
                              {matchingResOnTable || isHourStart || isHourInSelectedSpan
                                ? 'Terisi'
                                : allResAtHour.length > 0
                                ? `${allResAtHour.length} Meja`
                                : 'Kosong'}
                            </span>
                          </div>
                          <div
                            className={`rc-hour-subtext text-[10px] mt-1 truncate ${
                              isHourStart || isHourInSelectedSpan
                                ? 'text-black/85 font-bold'
                                : matchingResOnTable
                                ? 'text-sky-300 font-semibold'
                                : 'text-zinc-500'
                            }`}
                          >
                            {matchingResOnTable
                              ? `${matchingResOnTable.nama} (${matchingResOnTable.jamDatang}–${matchedEndClock})`
                              : isHourStart || isHourInSelectedSpan
                              ? `${resNama.trim() || 'Terisi'} (${resJamDatang}–${endTimeStr})`
                              : allResAtHour.length > 0
                              ? `${allResAtHour[0].tableNumber}: ${allResAtHour[0].nama}`
                              : 'Siap Dipesan'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer Info Bar inside Left Box */}
              <div className="rc-res-schedule-footer px-4 py-3 bg-[#16120a] border-t border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-black text-amber-400">
                    Tanggal: {resTanggal}
                  </span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-amber-100">
                    Jam Datang:{' '}
                    <strong className="text-white font-mono">
                      {resJamDatang} s/d {endTimeStr} WIB ({resDurasi} Menit)
                    </strong>
                  </span>
                </div>
                <div className="text-emerald-400 font-mono font-bold">
                  {reservationsForSelectedDate.length} Reservasi Terjadwal di Tanggal Ini
                </div>
              </div>
            </div>
          </div>

          {/* ================================================================= */}
          {/* KOLOM KANAN (lg:col-span-4): BAGIAN RESERVASI                     */}
          {/* Nama, Nomor Handphone, Tanggal, Jam Datang, Durasi,               */}
          {/* Menu yang Dipesan, Downpayment                                    */}
          {/* ================================================================= */}
          <form
            onSubmit={handleSaveNewReservation}
            className="lg:col-span-4 rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl p-5 space-y-4"
          >
            <div className="pb-3 border-b border-amber-500/25">
              <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold">
                Form Input Reservasi Meja
              </div>
              <h2 className="text-lg font-black text-white mt-0.5">
                Bagian Reservasi Pengunjung
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Meja Terpilih:{' '}
                <strong className="text-amber-300">
                  {selectedResTable?.tableNumber} — {selectedResTable?.name} (
                  {selectedResTable?.zone})
                </strong>
              </p>
            </div>

            {/* Pilih Meja & Jumlah Tamu */}
            <div className="grid grid-cols-12 gap-2.5">
              <div className="col-span-8">
                <label className="block text-xs font-bold text-amber-200 mb-1">
                  Meja &amp; Area
                </label>
                <select
                  value={resTableId}
                  onChange={(e) => {
                    const found = tables.find((t) => t.id === e.target.value);
                    setResTableId(e.target.value);
                    if (found) setResVisitorPax(found.seats);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-bold text-white"
                >
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.tableNumber} — {t.zone} ({t.seats} Kursi)
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-4">
                <label className="block text-xs font-bold text-amber-200 mb-1">
                  Visitor (Pax)
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={resVisitorPax}
                  onChange={(e) => setResVisitorPax(Number(e.target.value) || 2)}
                  className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-mono font-bold text-white"
                />
              </div>
            </div>

            {/* 1. NAMA */}
            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                <span>Nama</span>
              </label>
              <input
                type="text"
                required
                value={resNama}
                onChange={(e) => setResNama(e.target.value)}
                placeholder="Masukkan nama lengkap pemesan..."
                className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-bold text-white focus:outline-none"
              />
              {storeCustomers.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const found = storeCustomers.find((c) => c.id === e.target.value);
                    if (found) {
                      setResNama(found.name);
                      if ((found as any).phone) setResNomorHp((found as any).phone);
                    }
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#090805] border border-zinc-800 text-[11px] text-zinc-300"
                >
                  <option value="">-- Atau Pilih Cepat dari Pelanggan Terdaftar --</option>
                  {storeCustomers.slice(0, 15).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {(c as any).phone ? `(${(c as any).phone})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 2. NOMOR HANDPHONE */}
            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                <span>Nomor Handphone</span>
              </label>
              <input
                type="tel"
                required
                value={resNomorHp}
                onChange={(e) => setResNomorHp(e.target.value)}
                placeholder="Contoh: 0812-3456-7890"
                className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-mono font-bold text-white focus:outline-none"
              />
            </div>

            {/* 3. TANGGAL & 4. JAM DATANG */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  <span>Tanggal</span>
                </label>
                <input
                  type="date"
                  required
                  value={resTanggal}
                  onChange={(e) => setResTanggal(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-mono font-bold text-white focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Jam Datang</span>
                </label>
                <input
                  type="time"
                  required
                  value={resJamDatang}
                  onChange={(e) => setResJamDatang(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-mono font-bold text-white focus:outline-none"
                />
              </div>
            </div>

            {/* 5. DURASI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Durasi (Menit / Jam)</span>
                </label>
                <span className="text-[11px] font-mono text-emerald-400 font-bold">
                  Est. Selesai: {endTimeStr} WIB
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[60, 90, 120, 150, 180, 240].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setResDurasi(mins)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                      resDurasi === mins
                        ? 'bg-amber-500 text-black border-amber-300'
                        : 'bg-[#090805] text-zinc-300 border-zinc-800 hover:border-amber-500/40'
                    }`}
                  >
                    {mins} Menit ({mins / 60}j)
                  </button>
                ))}
              </div>
            </div>

            {/* 6. MENU YANG DIPESAN */}
            <div className="p-3.5 rounded-xl bg-[#090805] border border-amber-500/25 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Menu yang Dipesan ({resOrders.length} Item)</span>
                </span>
                <span className="text-xs font-mono font-black text-emerald-400">
                  {fmtMoney(resTotalOrder, currencyMode)}
                </span>
              </div>

              {/* Ordered Items List */}
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                {resOrders.length === 0 ? (
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-center text-[11px] text-zinc-500">
                    Belum ada menu dipilih. Tambahkan menu di bawah.
                  </div>
                ) : (
                  resOrders.map((item) => (
                    <div
                      key={item.id}
                      className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-white truncate">{item.name}</div>
                        <div className="text-[10px] font-mono text-zinc-400">
                          {fmtMoney(item.price, currencyMode)} × {item.qty}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setResOrders((prev) =>
                              prev
                                .map((o) =>
                                  o.id === item.id ? { ...o, qty: o.qty - 1 } : o
                                )
                                .filter((o) => o.qty > 0)
                            )
                          }
                          className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <span className="w-5 text-center font-mono font-bold text-amber-300">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setResOrders((prev) =>
                              prev.map((o) =>
                                o.id === item.id ? { ...o, qty: o.qty + 1 } : o
                              )
                            )
                          }
                          className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Menu Controls */}
              <div className="pt-2 border-t border-zinc-800 space-y-2">
                {storeProducts.length > 0 && (
                  <select
                    value={resProductToAdd}
                    onChange={(e) => {
                      const pid = e.target.value;
                      setResProductToAdd(pid);
                      const found = storeProducts.find((p) => p.id === pid);
                      if (found) {
                        setResCustomItemName(found.name);
                        setResCustomItemPrice(
                          Number(
                            found.posPrice ??
                              found.sellPrice ??
                              found.pricePerUnit ??
                              found.pricePerCarton ??
                              25000
                          )
                        );
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
                  >
                    <option value="">-- Pilih Menu dari Katalog Produk --</option>
                    {storeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} —{' '}
                        {fmtMoney(
                          Number(
                            p.posPrice ??
                              p.sellPrice ??
                              p.pricePerUnit ??
                              p.pricePerCarton ??
                              0
                          ),
                          currencyMode
                        )}
                      </option>
                    ))}
                  </select>
                )}

                <div className="grid grid-cols-12 gap-1.5">
                  <input
                    type="text"
                    value={resCustomItemName}
                    onChange={(e) => setResCustomItemName(e.target.value)}
                    placeholder="Nama menu..."
                    className="col-span-6 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
                  />
                  <input
                    type="number"
                    min={1}
                    value={resCustomItemQty}
                    onChange={(e) => setResCustomItemQty(Number(e.target.value) || 1)}
                    className="col-span-2 px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white text-center"
                  />
                  <input
                    type="number"
                    step={1000}
                    value={resCustomItemPrice}
                    onChange={(e) => setResCustomItemPrice(Number(e.target.value) || 0)}
                    className="col-span-4 px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddItemToReservation}
                  className="w-full py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/40 font-bold text-xs flex items-center justify-center gap-1 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Menu Dipesan</span>
                </button>
              </div>
            </div>

            {/* 7. DOWNPAYMENT (DP) */}
            <div className="p-3.5 rounded-xl bg-[#090805] border border-amber-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Downpayment (DP)</span>
                </label>
                <div className="flex items-center gap-1">
                  {[
                    { label: 'DP 30%', val: Math.round((resTotalOrder * 0.3) / 1000) * 1000 },
                    { label: 'DP 50%', val: Math.round((resTotalOrder * 0.5) / 1000) * 1000 },
                    { label: 'Lunas', val: resTotalOrder },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setResDownpayment(preset.val)}
                      className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500 hover:text-black text-amber-300 text-[10px] font-bold transition cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="number"
                min={0}
                step={5000}
                value={resDownpayment}
                onChange={(e) => setResDownpayment(Number(e.target.value) || 0)}
                placeholder="Nominal Downpayment (Rp)"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-amber-400 text-sm font-mono font-black text-emerald-400 focus:outline-none"
              />

              <div className="pt-1 flex items-center justify-between text-[11px] font-mono">
                <span className="text-zinc-400">
                  Total Menu: <strong className="text-white">{fmtMoney(resTotalOrder, currencyMode)}</strong>
                </span>
                <span className="text-amber-300">
                  Sisa Bayar: <strong>{fmtMoney(remainingPayment, currencyMode)}</strong>
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition"
            >
              <CheckCircle2 className="w-4 h-4 text-black" />
              <span>Simpan Reservasi Meja</span>
            </button>
          </form>

          {/* ================================================================= */}
          {/* BARIS BAWAH FULL WIDTH (lg:col-span-12):                          */}
          {/* PILIHAN MEJA UNTUK RESERVASI (1 ROW 4 MEJA & GAMBAR LEBIH BESAR)  */}
          {/* ================================================================= */}
          <div className="lg:col-span-12 w-full p-5 sm:p-6 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
              <div>
                <h2 className="text-base sm:text-lg font-black text-amber-50 flex items-center gap-2">
                  <Utensils className="w-5 h-5 text-amber-400" />
                  <span>
                    Pilih Meja untuk Reservasi (
                    {calendarAreaFilter === 'Semua Area'
                      ? tables.length
                      : tables.filter((t) => t.zone === calendarAreaFilter).length}{' '}
                    Meja Tersedia)
                  </span>
                </h2>
                <p className="text-xs sm:text-sm text-amber-100/65 mt-0.5">
                  Klik salah satu meja di bawah ini untuk memilih meja yang akan direservasi pada tanggal {resTanggal} pukul {resJamDatang}.
                </p>
              </div>

              {/* BUTTON DROPDOWN PANEL UNTUK AREA MEJA */}
              <div className="relative shrink-0" ref={tableAreaDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsTableAreaDropdownOpen((prev) => !prev)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-between gap-2.5 min-w-[210px] transition cursor-pointer ${
                    isTableAreaDropdownOpen
                      ? 'bg-amber-500 text-black border-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.35)]'
                      : 'bg-[#090805] hover:bg-[#17130b] text-amber-100 border-amber-500/40 hover:border-amber-400'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <LayoutGrid
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isTableAreaDropdownOpen ? 'text-black' : 'text-amber-400'
                      }`}
                    />
                    <span className="truncate">
                      Area Meja: <strong>{calendarAreaFilter}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-black ${
                        isTableAreaDropdownOpen
                          ? 'bg-black/20 text-black'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {calendarAreaFilter === 'Semua Area'
                        ? tables.length
                        : tables.filter((t) => t.zone === calendarAreaFilter).length}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-200 ${
                        isTableAreaDropdownOpen ? 'rotate-180 text-black' : 'text-amber-300'
                      }`}
                    />
                  </div>
                </button>

                {isTableAreaDropdownOpen && (
                  <div className="rc-tooltip-box absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-[#120f09] border-2 border-amber-500/50 shadow-[0_18px_45px_rgba(0,0,0,0.85)] p-3.5 z-50 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-amber-500/25 pb-2">
                      <div>
                        <div className="text-xs font-black text-white uppercase tracking-wider">
                          Pilih Area Meja
                        </div>
                        <div className="text-[10px] text-amber-200/75">
                          Filter daftar meja berdasarkan area ruangan
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsTableAreaDropdownOpen(false)}
                        className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                      {['Semua Area', ...tableAreas].map((areaOption) => {
                        const isSelectedArea = calendarAreaFilter === areaOption;
                        const areaTableCount =
                          areaOption === 'Semua Area'
                            ? tables.length
                            : tables.filter((t) => t.zone === areaOption).length;

                        return (
                          <button
                            key={areaOption}
                            type="button"
                            onClick={() => {
                              setCalendarAreaFilter(areaOption);
                              setIsTableAreaDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between transition cursor-pointer ${
                              isSelectedArea
                                ? 'bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] text-black shadow-sm'
                                : 'bg-[#090805] hover:bg-[#19140b] text-amber-100 border border-zinc-800/90 hover:border-amber-500/40'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isSelectedArea ? 'bg-black' : 'bg-amber-400'
                                }`}
                              />
                              <span className="truncate">{areaOption}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black ${
                                  isSelectedArea
                                    ? 'bg-black/20 text-black'
                                    : 'bg-zinc-900 text-amber-300 border border-amber-500/25'
                                }`}
                              >
                                {areaTableCount} Meja
                              </span>
                              {isSelectedArea && <Check className="w-3.5 h-3.5 text-black" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
              {(calendarAreaFilter === 'Semua Area'
                ? tables
                : tables.filter((t) => t.zone === calendarAreaFilter)
              ).map((tbl) => {
                const isSelected = tbl.id === resTableId;
                const overlappingRes = reservationsForSelectedDate.find(
                  (r) =>
                    r.tableId === tbl.id &&
                    doTimeIntervalsOverlap(r.jamDatang, r.durasi, resJamDatang, resDurasi)
                );
                const bookedAtSameSlot = Boolean(overlappingRes);
                const visualStatus: TableStatus = bookedAtSameSlot
                  ? 'reserved'
                  : isSelected
                  ? 'occupied'
                  : 'available';

                return (
                  <button
                    key={tbl.id}
                    type="button"
                    onClick={() => {
                      setResTableId(tbl.id);
                      setResVisitorPax(tbl.seats);
                    }}
                    className={`group rc-res-table-card ${
                      isSelected
                        ? 'rc-res-table-card-selected'
                        : bookedAtSameSlot
                        ? 'rc-res-table-card-booked'
                        : 'rc-res-table-card-avail'
                    } w-full p-4 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-amber-500/25 border-amber-400 ring-2 ring-amber-400/40 shadow-lg'
                        : bookedAtSameSlot
                        ? 'bg-sky-950/40 border-sky-500/40'
                        : 'bg-[#090805] hover:bg-[#17130b] border-zinc-800 hover:border-amber-500/40'
                    }`}
                  >
                    {/* Header Info Meja */}
                    <div className="flex items-center justify-between w-full">
                      <span className="rc-res-table-num text-sm sm:text-base font-mono font-black text-white">
                        {tbl.tableNumber}
                      </span>
                      <span className="rc-res-table-seats px-2.5 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs font-mono font-bold text-amber-300">
                        {tbl.seats} Kursi
                      </span>
                    </div>

                    {/* Visual Gambar Meja & Kursi Lebih Besar */}
                    <div className="w-full h-36 sm:h-40 rounded-xl bg-black/25 border border-amber-500/15 flex items-center justify-center overflow-hidden py-2">
                      <div className="scale-105 group-hover:scale-110 transition-transform duration-200 flex items-center justify-center">
                        <TableTopDownArtwork
                          shape={tbl.shape}
                          seats={tbl.seats}
                          status={visualStatus}
                          tableNumber={tbl.tableNumber}
                          visitorName={
                            overlappingRes
                              ? overlappingRes.nama
                              : isSelected
                              ? 'DIPILIH'
                              : 'TERSEDIA'
                          }
                          selected={isSelected}
                          currencyMode={currencyMode}
                          compactPreview={false}
                        />
                      </div>
                    </div>

                    {/* Footer Area & Status */}
                    <div className="w-full flex items-center justify-between gap-2 pt-1 border-t border-amber-500/15">
                      <div className="rc-res-table-zone text-xs font-semibold text-zinc-300 truncate">
                        {tbl.zone}
                      </div>
                      <div
                        className={`rc-res-table-status text-[11px] font-extrabold truncate shrink-0 ${
                          bookedAtSameSlot ? 'text-sky-300' : 'text-emerald-400'
                        }`}
                      >
                        {overlappingRes
                          ? `Terisi (${overlappingRes.jamDatang}–${computeEndTime(
                              overlappingRes.jamDatang,
                              overlappingRes.durasi
                            )})`
                          : 'Tersedia'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ===========================================================================
  // VIEW 2: LIST RESERVASI (/dashboard/reservation/list)
  // ===========================================================================
  const renderListReservasiView = () => {
    const totalDpCollected = filteredReservationList.reduce(
      (s, r) => s + (Number(r.downpayment) || 0),
      0
    );
    const totalOrderVal = filteredReservationList.reduce(
      (s, r) => s + (Number(r.totalOrder) || 0),
      0
    );

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="p-5 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-amber-50 tracking-tight">
                List Reservasi Table — Daftar Jadwal &amp; Status Reservasi
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                /dashboard/reservation/list
              </span>
            </div>
            <p className="text-xs text-amber-100/70">
              Kelola seluruh daftar reservasi meja pelanggan lengkap dengan Nama, Nomor Handphone, Tanggal, Jam Datang, Durasi, Menu yang Dipesan, dan Downpayment.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {reservations.length > 0 && (
              <button
                type="button"
                onClick={handleWipeAllTablesAndDummyData}
                className="px-3.5 py-2.5 rounded-xl bg-rose-950/70 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Kosongkan Semua Reservasi</span>
              </button>
            )}
            <AppLink
              to="/dashboard/reservation"
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs flex items-center gap-2 shadow-lg cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4 text-black" />
              <span>+ Buat Reservasi Baru</span>
            </AppLink>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-[#110f0a] border border-amber-500/30">
            <div className="text-xs text-amber-200/70 font-semibold">Total Reservasi</div>
            <div className="text-2xl font-black text-white font-mono mt-1">
              {filteredReservationList.length} Reservasi
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#110f0a] border border-sky-500/30">
            <div className="text-xs text-sky-300/80 font-semibold">Terjadwal (Confirmed)</div>
            <div className="text-2xl font-black text-sky-400 font-mono mt-1">
              {filteredReservationList.filter((r) => r.status === 'confirmed').length} Meja
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#110f0a] border border-emerald-500/30">
            <div className="text-xs text-emerald-300/80 font-semibold">Total Downpayment (DP)</div>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
              {fmtMoney(totalDpCollected, currencyMode)}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#110f0a] border border-amber-500/40">
            <div className="text-xs text-amber-300/80 font-semibold">Total Nilai Pesanan</div>
            <div className="text-2xl font-black text-amber-300 font-mono mt-1">
              {fmtMoney(totalOrderVal, currencyMode)}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-4 rounded-2xl bg-[#110f0a] border border-amber-500/35 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative min-w-[220px] flex-1 max-w-xs">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Cari Nama, No HP, Kode, atau Meja..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs text-white focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-amber-200/80 font-bold">Tanggal:</span>
              <input
                type="date"
                value={listDateFilter}
                onChange={(e) => setListDateFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-[#090805] border border-zinc-800 text-xs font-mono text-white"
              />
              {listDateFilter && (
                <button
                  type="button"
                  onClick={() => setListDateFilter('')}
                  className="px-2 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:text-white cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>

            <select
              value={listAreaFilter}
              onChange={(e) => setListAreaFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 text-xs font-bold text-white"
            >
              <option value="Semua Area">Semua Area</option>
              {tableAreas.map((areaName) => (
                <option key={areaName} value={areaName}>
                  {areaName}
                </option>
              ))}
            </select>

            <select
              value={listStatusFilter}
              onChange={(e) => setListStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 text-xs font-bold text-white"
            >
              <option value="all">Semua Status</option>
              <option value="confirmed">Terjadwal (Confirmed)</option>
              <option value="checked_in">Sedang Dine-In (Checked-In)</option>
              <option value="completed">Selesai (Completed)</option>
              <option value="cancelled">Dibatalkan (Cancelled)</option>
            </select>
          </div>
        </div>

        {/* Reservation List Table */}
        <div className="rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#17130b] border-b border-amber-500/30 text-amber-300 uppercase tracking-wider font-black text-[11px]">
                  <th className="py-3.5 px-4">Kode &amp; Tanggal</th>
                  <th className="py-3.5 px-4">Nama &amp; Nomor Handphone</th>
                  <th className="py-3.5 px-4">Jam Datang &amp; Durasi</th>
                  <th className="py-3.5 px-4">Table &amp; Area</th>
                  <th className="py-3.5 px-4">Menu yang Dipesan</th>
                  <th className="py-3.5 px-4 text-right">Downpayment &amp; Total</th>
                  <th className="py-3.5 px-4 text-center">Status &amp; Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {filteredReservationList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-zinc-500">
                      Tidak ada data reservasi yang sesuai dengan filter.
                    </td>
                  </tr>
                ) : (
                  filteredReservationList.map((r) => {
                    const endClock = computeEndTime(r.jamDatang, r.durasi);
                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-amber-500/5 transition"
                      >
                        <td className="py-3.5 px-4 font-mono">
                          <div className="font-black text-amber-400">{r.reservationCode}</div>
                          <div className="text-white font-bold mt-0.5">{r.tanggal}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{r.nama}</div>
                          <div className="text-[11px] font-mono text-amber-200/80 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-amber-400" />
                            <span>{r.nomorHandphone}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono">
                          <div className="font-bold text-white">
                            {r.jamDatang} – {endClock} WIB
                          </div>
                          <div className="text-[11px] text-amber-300">
                            {formatDurationMinutes(r.durasi)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-black text-white">
                            {r.tableNumber} ({r.visitorPax} Org)
                          </div>
                          <div className="text-[11px] text-zinc-400">{r.area}</div>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          {(r.orders || []).length === 0 ? (
                            <span className="text-zinc-500">Pesan di tempat</span>
                          ) : (
                            <div className="space-y-0.5">
                              {r.orders.map((o) => (
                                <div key={o.id} className="text-[11px] text-zinc-200 truncate">
                                  • {o.name} <span className="text-amber-300 font-mono">×{o.qty}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono">
                          <div className="text-emerald-400 font-black">
                            DP: {fmtMoney(r.downpayment, currencyMode)}
                          </div>
                          <div className="text-[11px] text-zinc-300 mt-0.5">
                            Total: {fmtMoney(r.totalOrder, currencyMode)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                r.status === 'confirmed'
                                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                                  : r.status === 'checked_in'
                                  ? 'bg-amber-500/25 text-amber-300 border border-amber-400/50'
                                  : r.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-400/40'
                              }`}
                            >
                              {r.status === 'confirmed'
                                ? 'Terjadwal'
                                : r.status === 'checked_in'
                                ? 'Dine-In'
                                : r.status === 'completed'
                                ? 'Selesai'
                                : 'Batal'}
                            </span>
                            <div className="flex items-center gap-1">
                              {r.status === 'confirmed' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateReservationStatus(r.id, 'checked_in')}
                                  className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 text-[10px] font-bold transition cursor-pointer"
                                >
                                  Check-In
                                </button>
                              )}
                              {r.status !== 'completed' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateReservationStatus(r.id, 'completed')}
                                  className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500 hover:text-black text-emerald-300 text-[10px] font-bold transition cursor-pointer"
                                >
                                  Selesai
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteReservation(r.id)}
                                className="p-1 rounded bg-rose-950/60 hover:bg-rose-600 text-rose-300 hover:text-white transition cursor-pointer"
                                title="Hapus"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ===========================================================================
  // VIEW 3: SUMMARY REPORT (/dashboard/layout-table/summary)
  // Berisikan beberapa chart:
  // - 10 Table terbanyak di isi
  // - 10 Table jarang di isi
  // Data table pemesanan per hari dan terdapat filter tanggal:
  // Tanggal | Table | Area | Visitor | Total Revenue | Durasi Dine In
  // ===========================================================================
  const renderSummaryReportView = () => {
    const { top10MostOccupied, top10LeastOccupied } = tableOccupancyAnalytics;
    const totalFilteredRevenue = filteredDailyRecords.reduce(
      (s, r) => s + (Number(r.totalRevenue) || 0),
      0
    );
    const totalFilteredVisitors = filteredDailyRecords.reduce(
      (s, r) => s + (Number(r.visitorCount) || 0),
      0
    );
    const avgDuration =
      filteredDailyRecords.length > 0
        ? Math.round(
            filteredDailyRecords.reduce((s, r) => s + (Number(r.durasiDineIn) || 0), 0) /
              filteredDailyRecords.length
          )
        : 0;

    return (
      <div className="space-y-6">
        {/* Page Header */}
        <div className="p-5 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-amber-50 tracking-tight">
                Summary Report Table — Analitik Kunjungan &amp; Data Pemesanan Harian
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                /dashboard/layout-table/summary
              </span>
            </div>
            <p className="text-xs text-amber-100/70">
              Grafik perbandingan 10 Table Terbanyak Diisi &amp; 10 Table Jarang Diisi beserta tabel rekapitulasi pemesanan meja per hari dengan filter tanggal.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 shrink-0">
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-amber-500/30">
              <div className="text-[10px] text-amber-200/70 font-semibold">Total Visitor</div>
              <div className="text-base font-black text-white font-mono">
                {totalFilteredVisitors} Orang
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-emerald-500/30">
              <div className="text-[10px] text-emerald-300/80 font-semibold">Total Revenue</div>
              <div className="text-base font-black text-emerald-400 font-mono">
                {fmtMoney(totalFilteredRevenue, currencyMode)}
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-sky-500/30">
              <div className="text-[10px] text-sky-300/80 font-semibold">Rata-rata Durasi</div>
              <div className="text-base font-black text-sky-400 font-mono">
                {avgDuration} Menit
              </div>
            </div>
          </div>
        </div>

        {/* Global Date & Area Filter Bar */}
        <div className="p-4 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-md flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-xs font-black text-amber-300">
              <Filter className="w-4 h-4" />
              <span>Filter Tanggal:</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">Dari:</span>
              <input
                type="date"
                value={summaryStartDate}
                onChange={(e) => {
                  setSummarySpecificDate('');
                  setSummaryStartDate(e.target.value);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-[#090805] border border-zinc-800 text-xs font-mono text-white"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">Sampai:</span>
              <input
                type="date"
                value={summaryEndDate}
                onChange={(e) => {
                  setSummarySpecificDate('');
                  setSummaryEndDate(e.target.value);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-[#090805] border border-zinc-800 text-xs font-mono text-white"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-amber-200/80 font-bold">Pilih 1 Tanggal:</span>
              <input
                type="date"
                value={summarySpecificDate}
                onChange={(e) => setSummarySpecificDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-[#090805] border border-amber-500/40 text-xs font-mono text-amber-300"
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setSummarySpecificDate(todayStr);
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  summarySpecificDate === todayStr
                    ? 'bg-amber-500 text-black'
                    : 'bg-[#090805] text-zinc-300 border border-zinc-800 hover:border-amber-500/40'
                }`}
              >
                Hari Ini
              </button>
              <button
                type="button"
                onClick={() => {
                  setSummarySpecificDate('');
                  setSummaryStartDate(getRelativeDateString(-7));
                  setSummaryEndDate(getRelativeDateString(2));
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  !summarySpecificDate && summaryStartDate === getRelativeDateString(-7)
                    ? 'bg-amber-500 text-black'
                    : 'bg-[#090805] text-zinc-300 border border-zinc-800 hover:border-amber-500/40'
                }`}
              >
                7 Hari
              </button>
              <button
                type="button"
                onClick={() => {
                  setSummarySpecificDate('');
                  setSummaryStartDate('');
                  setSummaryEndDate('');
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  !summarySpecificDate && !summaryStartDate && !summaryEndDate
                    ? 'bg-amber-500 text-black'
                    : 'bg-[#090805] text-zinc-300 border border-zinc-800 hover:border-amber-500/40'
                }`}
              >
                Semua Tanggal
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={summaryAreaFilter}
              onChange={(e) => setSummaryAreaFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-[#090805] border border-zinc-800 text-xs font-bold text-white"
            >
              <option value="Semua Area">Semua Area</option>
              {tableAreas.map((areaName) => (
                <option key={areaName} value={areaName}>
                  {areaName}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={summarySearch}
                onChange={(e) => setSummarySearch(e.target.value)}
                placeholder="Cari Table / Visitor..."
                className="pl-8 pr-3 py-1.5 rounded-xl bg-[#090805] border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* 2 CHARTS UTAMA:                                                     */}
        {/* 1. 10 Table Terbanyak Diisi                                         */}
        {/* 2. 10 Table Jarang Diisi                                            */}
        {/* =================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CHART 1: 10 TABLE TERBANYAK DI ISI */}
          <div className="p-5 rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-base font-black text-white">
                    10 Table Terbanyak Diisi
                  </h2>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Peringkat 10 meja dengan tingkat frekuensi terisi tertinggi
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] font-mono font-bold">
                TOP 10 TERBANYAK
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top10MostOccupied}
                  margin={{ top: 10, right: 12, left: -12, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 158, 11, 0.12)" />
                  <XAxis
                    dataKey="tableNumber"
                    stroke="#f59e0b"
                    tick={{ fill: '#fef3c7', fontSize: 11, fontWeight: 700 }}
                  />
                  <YAxis
                    stroke="#a1a1aa"
                    tick={{ fill: '#d4d4d8', fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#090805',
                      border: '1px solid rgba(245, 158, 11, 0.5)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(val: any, name: any) => {
                      if (name === 'occupiedCount') return [`${val} Kali Terisi`, 'Frekuensi'];
                      return [val, name];
                    }}
                  />
                  <Bar dataKey="occupiedCount" name="occupiedCount" radius={[6, 6, 0, 0]}>
                    {top10MostOccupied.map((_, idx) => (
                      <Cell
                        key={`most-${idx}`}
                        fill={idx < 3 ? '#10b981' : '#f59e0b'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Detailed Top 10 List */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              {top10MostOccupied.map((item, idx) => (
                <div
                  key={item.tableNumber}
                  className="px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800/90 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-black flex items-center justify-center text-[11px]">
                      #{idx + 1}
                    </span>
                    <div>
                      <span className="font-mono font-black text-white">
                        {item.tableNumber}
                      </span>
                      <span className="text-zinc-400 ml-1.5">· {item.area}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-amber-300 font-bold">
                      {item.occupiedCount}x Terisi ({item.totalVisitors} Visitor)
                    </span>
                    <span className="text-emerald-400 font-black">
                      {fmtMoney(item.totalRevenue, currencyMode)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CHART 2: 10 TABLE JARANG DI ISI */}
          <div className="p-5 rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-rose-400" />
                  <h2 className="text-base font-black text-white">
                    10 Table Jarang Diisi
                  </h2>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Peringkat 10 meja dengan frekuensi terisi paling rendah (jarang ditempati)
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/35 text-rose-300 text-[11px] font-mono font-bold">
                10 JARANG DIISI
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top10LeastOccupied}
                  margin={{ top: 10, right: 12, left: -12, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 158, 11, 0.12)" />
                  <XAxis
                    dataKey="tableNumber"
                    stroke="#f43f5e"
                    tick={{ fill: '#fecdd3', fontSize: 11, fontWeight: 700 }}
                  />
                  <YAxis
                    stroke="#a1a1aa"
                    tick={{ fill: '#d4d4d8', fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#090805',
                      border: '1px solid rgba(244, 63, 94, 0.5)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#fff',
                    }}
                    formatter={(val: any, name: any) => {
                      if (name === 'occupiedCount') return [`${val} Kali Terisi`, 'Frekuensi'];
                      return [val, name];
                    }}
                  />
                  <Bar dataKey="occupiedCount" name="occupiedCount" radius={[6, 6, 0, 0]}>
                    {top10LeastOccupied.map((_, idx) => (
                      <Cell
                        key={`least-${idx}`}
                        fill={idx < 4 ? '#f43f5e' : '#38bdf8'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Detailed Least 10 List */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              {top10LeastOccupied.map((item, idx) => (
                <div
                  key={item.tableNumber}
                  className="px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800/90 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono font-black flex items-center justify-center text-[11px]">
                      #{idx + 1}
                    </span>
                    <div>
                      <span className="font-mono font-black text-white">
                        {item.tableNumber}
                      </span>
                      <span className="text-zinc-400 ml-1.5">· {item.area}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-rose-300 font-bold">
                      {item.occupiedCount}x Terisi ({item.totalVisitors} Visitor)
                    </span>
                    <span className="text-amber-300 font-black">
                      {fmtMoney(item.totalRevenue, currencyMode)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* DATA TABLE PEMESANAN PER HARI (DENGAN FILTER TANGGAL)               */}
        {/* Kolom: Tanggal | Table | Area | Visitor | Total Revenue | Durasi Dine In */}
        {/* =================================================================== */}
        <div className="rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl overflow-hidden">
          <div className="p-4 bg-[#17130b] border-b border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-amber-400" />
                <span>Data Table Pemesanan per Hari</span>
              </h2>
              <p className="text-xs text-amber-100/70 mt-0.5">
                Menampilkan {filteredDailyRecords.length} data pemesanan meja berdasarkan filter tanggal
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-amber-200">Filter Tanggal:</span>
              <input
                type="date"
                value={summarySpecificDate}
                onChange={(e) => setSummarySpecificDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-[#090805] border border-amber-500/40 text-xs font-mono text-white"
              />
              {summarySpecificDate && (
                <button
                  type="button"
                  onClick={() => setSummarySpecificDate('')}
                  className="px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
                >
                  Tampilkan Rentang
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#141109] border-b border-amber-500/30 text-amber-300 uppercase tracking-wider font-black text-[11px]">
                  <th className="py-3.5 px-4">Tanggal</th>
                  <th className="py-3.5 px-4">Table</th>
                  <th className="py-3.5 px-4">Area</th>
                  <th className="py-3.5 px-4">Visitor</th>
                  <th className="py-3.5 px-4 text-right">Total Revenue</th>
                  <th className="py-3.5 px-4 text-right">Durasi Dine In</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {filteredDailyRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-zinc-500">
                      Tidak ada data pemesanan table pada tanggal yang dipilih.
                    </td>
                  </tr>
                ) : (
                  filteredDailyRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-amber-500/5 transition">
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-white">{rec.tanggal}</div>
                        <div className="text-[10px] text-amber-300/80">{rec.jam} WIB</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-black text-amber-400">
                          {rec.tableNumber}
                        </div>
                        <div className="text-[11px] text-zinc-400">{rec.tableName}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-1 rounded-lg bg-[#090805] border border-amber-500/25 text-amber-100 font-semibold">
                          {rec.area}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white">{rec.visitorName}</div>
                        <div className="text-[11px] font-mono text-zinc-400">
                          {rec.visitorCount} Orang (Pax)
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400 text-sm tabular-nums">
                        {fmtMoney(rec.totalRevenue, currencyMode)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-300">
                        {formatDurationMinutes(rec.durasiDineIn)}
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

  // ===========================================================================
  // VIEW 4: TABLE LAYOUT (/dashboard/layout-table)
  // ===========================================================================
  const renderTableLayoutView = () => {
    return (
      <div className="space-y-5">
        {/* Top Page Header & Summary Strip */}
        <div className="p-5 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-amber-50 tracking-tight">
                Layout Table — Denah Meja, Kursi &amp; Pesanan Pengunjung
              </h1>
              <span className="text-xs text-amber-300/80 font-mono">
                {waiterMode
                  ? 'Mode Waiters · Klik Meja untuk Masuk ke POS Pesanan'
                  : 'Drag & Drop · Putar 360° · Real-Time Firestore'}
              </span>
            </div>
            <p className="text-xs text-amber-100/70">
              Geser posisi meja dan kursi secara bebas, putar sudut rotasi meja, klik meja untuk melihat detail pengunjung (Nama, Pesanan, Total Pesanan, Waktu Mulai Duduk), atau klik gambar meja di bawah untuk menambahkannya ke kotak atas.
            </p>
          </div>

          {/* Summary Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-amber-500/30">
              <div className="text-[10px] text-amber-200/60 font-semibold">Total Meja</div>
              <div className="text-base font-black text-white font-mono tabular-nums">
                {tables.length} Meja
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-amber-500/30">
              <div className="text-[10px] text-amber-300/80 font-semibold">Terisi / Aktif</div>
              <div className="text-base font-black text-amber-400 font-mono tabular-nums">
                {occupiedCount} Meja
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-emerald-500/30">
              <div className="text-[10px] text-emerald-300/80 font-semibold">Kosong / Siap</div>
              <div className="text-base font-black text-emerald-400 font-mono tabular-nums">
                {availableCount} ({reservedCount} Rsv)
              </div>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-[#090805] border border-amber-500/40">
              <div className="text-[10px] text-amber-200/70 font-semibold">Total Bill Meja Aktif</div>
              <div className="text-base font-black text-amber-300 font-mono tabular-nums">
                {fmtMoney(totalActiveRevenue, currencyMode)}
              </div>
            </div>
          </div>
        </div>

        {/* 2 KOTAK BOX UTAMA */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* KOTAK 1 (KIRI - lg:col-span-8): DENAH INTERAKTIF + GALERI MEJA DI BAWAH */}
          <div className="lg:col-span-8 space-y-5">
            <div className="rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl">
              {/* Canvas Toolbar */}
              <div className="p-3.5 rounded-t-2xl bg-[#17130b] border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {['Semua Area', ...tableAreas].map((zone) => (
                    <button
                      key={zone}
                      type="button"
                      onClick={() => setActiveZoneFilter(zone)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                        activeZoneFilter === zone
                          ? 'bg-amber-500 text-black shadow-sm'
                          : 'bg-[#0b0906] text-amber-100/75 hover:text-white border border-amber-500/25'
                      }`}
                    >
                      {zone}
                    </button>
                  ))}
                  {renderAreaManagerButtonAndMenu()}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedTable && (
                    <div className="flex items-center gap-1 bg-[#090805] px-2.5 py-1 rounded-xl border border-amber-500/35">
                      <span className="text-[11px] font-mono font-bold text-amber-300 mr-1">
                        {selectedTable.tableNumber} ({selectedTable.rotation}°):
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRotateTable(selectedTable.id, -45)}
                        className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-500 hover:text-black text-amber-200 transition cursor-pointer"
                        title="Putar Kiri -45°"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRotateTable(selectedTable.id, 45)}
                        className="p-1 rounded-lg bg-zinc-800 hover:bg-amber-500 hover:text-black text-amber-200 transition cursor-pointer"
                        title="Putar Kanan +45°"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRotateTable(selectedTable.id, 90)}
                        className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 text-[10px] font-bold transition cursor-pointer"
                        title="Putar +90°"
                      >
                        +90°
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveLayoutToDatabase}
                    disabled={isSavingLayout}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500 hover:brightness-110 text-black font-black text-xs flex items-center gap-1.5 border border-emerald-300/80 shadow-[0_0_14px_rgba(16,185,129,0.35)] transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                    title={
                      lastSavedLayoutAt
                        ? `Simpan posisi & konfigurasi denah meja ke database (Terakhir disimpan: ${lastSavedLayoutAt})`
                        : 'Simpan posisi & konfigurasi denah meja ke database Firestore'
                    }
                  >
                    {isSavingLayout ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 text-black animate-spin" />
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5 text-black" />
                        <span>Save Layout</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSnapToGrid((prev) => !prev)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer whitespace-nowrap shrink-0 ${
                      snapToGrid
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                        : 'bg-[#090805] border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Grid className="w-3.5 h-3.5" />
                    <span>Snap Grid</span>
                  </button>

                  {visibleTables.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearTablesInCurrentArea}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                      title="Kosongkan / Reset semua meja di area ini secara permanen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {activeZoneFilter === 'Semua Area'
                          ? 'Kosongkan Semua Meja'
                          : `Kosongkan Area ${activeZoneFilter}`}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* Interactive Floorplan Canvas Box */}
              <div
                ref={floorCanvasRef}
                className="rc-floorplan-canvas relative w-full h-[500px] sm:h-[540px] bg-[#080705] overflow-hidden select-none"
                style={{
                  backgroundImage:
                    'radial-gradient(rgba(245, 158, 11, 0.16) 1px, transparent 1px), linear-gradient(to right, rgba(245, 158, 11, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(245, 158, 11, 0.04) 1px, transparent 1px)',
                  backgroundSize: '24px 24px, 96px 96px, 96px 96px',
                }}
              >
                <div className="rc-floorplan-badge absolute top-3 left-4 px-3 py-1 rounded-lg bg-zinc-900/90 border border-amber-500/30 text-[10px] font-mono text-amber-200/80 pointer-events-none">
                  PINTU MASUK UTAMA &amp; RESEPSIONIS
                </div>
                <div className="rc-floorplan-badge absolute top-3 right-4 px-3 py-1 rounded-lg bg-zinc-900/90 border border-emerald-500/30 text-[10px] font-mono text-emerald-300/80 pointer-events-none">
                  MEJA KASIR POS &amp; BAR
                </div>
                <div className="rc-floorplan-badge absolute bottom-3 left-4 px-3 py-1 rounded-lg bg-zinc-900/90 border border-zinc-700 text-[10px] font-mono text-zinc-400 pointer-events-none">
                  AREA DAPUR / PICKUP PESANAN
                </div>

                <div className="rc-floorplan-legend absolute bottom-3 right-4 flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-xl bg-zinc-950/90 border border-zinc-800 text-[10px] text-zinc-300 pointer-events-none">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Terisi
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Kosong
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" /> Reservasi
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> Siap Bayar
                  </span>
                </div>

                {visibleTables.map((table) => {
                  const isSelected = selectedTable?.id === table.id;
                  const isDragging = draggingTableId === table.id;

                  return (
                    <div
                      key={table.id}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedTableId(table.id);
                        if (!floorCanvasRef.current) return;
                        const rect = floorCanvasRef.current.getBoundingClientRect();
                        const currentPxX = (table.x / 100) * rect.width;
                        const currentPxY = (table.y / 100) * rect.height;
                        dragOffsetRef.current = {
                          offsetX: e.clientX - rect.left - currentPxX,
                          offsetY: e.clientY - rect.top - currentPxY,
                        };
                        didMoveRef.current = false;
                        setDraggingTableId(table.id);
                      }}
                      style={{
                        left: `${table.x}%`,
                        top: `${table.y}%`,
                        transform: 'translate(-50%, -50%)',
                        touchAction: 'none',
                      }}
                      className={`absolute group cursor-grab active:cursor-grabbing ${
                        isDragging ? 'z-40 scale-105' : isSelected ? 'z-30' : 'z-20 hover:z-30'
                      }`}
                    >
                      {isSelected && (
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          className="rc-floorplan-rotate-pill absolute -top-9 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2 py-1 rounded-xl bg-zinc-950/95 border border-amber-400/60 shadow-xl whitespace-nowrap"
                        >
                          <button
                            type="button"
                            onClick={() => handleRotateTable(table.id, -45)}
                            className="p-1 rounded hover:bg-amber-500 hover:text-black text-amber-300 transition cursor-pointer"
                            title="Putar -45°"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                          <span className="text-[10px] font-mono font-bold text-amber-200 px-1">
                            {table.rotation}°
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRotateTable(table.id, 45)}
                            className="p-1 rounded hover:bg-amber-500 hover:text-black text-amber-300 transition cursor-pointer"
                            title="Putar +45°"
                          >
                            <RotateCw className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      <TableTopDownArtwork
                        shape={table.shape}
                        seats={table.seats}
                        status={table.status}
                        tableNumber={table.tableNumber}
                        visitorName={table.visitorName}
                        totalOrder={table.totalOrder}
                        selected={isSelected}
                        rotation={table.rotation}
                        currencyMode={currencyMode}
                      />
                    </div>
                  );
                })}
              </div>

              {selectedTable && (
                <div className="rc-floorplan-footer px-4 py-3 bg-[#16120a] border-t border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono font-black text-amber-400 text-sm">
                      {selectedTable.tableNumber} — {selectedTable.name}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-amber-100">
                      Pengunjung:{' '}
                      <strong className="text-white">
                        {selectedTable.visitorName || 'Belum Ada (Meja Kosong)'}
                      </strong>
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-amber-100">
                      Mulai Duduk:{' '}
                      <strong className="text-amber-300 font-mono">
                        {seatedTimeInfo.clock} ({seatedTimeInfo.duration})
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-zinc-300">
                      Pesanan: <strong>{(selectedTable.orders || []).length} menu</strong>
                    </span>
                    <span className="text-sm font-black text-emerald-400 tabular-nums">
                      Total: {fmtMoney(selectedTable.totalOrder, currencyMode)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Table Shape Gallery */}
            <div className="p-5 rounded-2xl bg-[#110f0a] border border-amber-500/35 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm sm:text-base font-black text-amber-50 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-amber-400" />
                    <span>Pilihan Gambar Meja &amp; Kursi (Klik untuk Masuk ke Kotak Denah Atas)</span>
                  </h2>
                  <p className="text-xs text-amber-100/65 mt-0.5">
                    Klik salah satu gambar meja di bawah ini (Meja Bulat, Meja Persegi Panjang, atau Meja Kotak) untuk langsung menambahkannya ke kotak denah di atas.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-amber-300/80 whitespace-nowrap">
                  Klik Gambar = +1 Meja Baru ke Atas
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => handleAddTableFromBottomGallery('round', 4)}
                  className="group p-4 rounded-2xl bg-[#090805] hover:bg-[#19140b] border border-amber-500/30 hover:border-amber-400 transition flex flex-col items-center text-center cursor-pointer shadow-md"
                >
                  <div className="h-32 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <TableTopDownArtwork
                      shape="round"
                      seats={4}
                      status="available"
                      tableNumber="BULAT"
                      currencyMode={currencyMode}
                      compactPreview
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-sm font-black text-white group-hover:text-amber-300 transition">
                      Meja Bulat &amp; Kursi
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Kapasitas 4–6 Kursi Melingkar
                    </div>
                    <div className="pt-1 inline-flex items-center gap-1 text-xs font-extrabold text-amber-400">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Klik Masukkan ke Kotak Atas</span>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddTableFromBottomGallery('rectangle', 6)}
                  className="group p-4 rounded-2xl bg-[#090805] hover:bg-[#19140b] border border-amber-500/30 hover:border-amber-400 transition flex flex-col items-center text-center cursor-pointer shadow-md"
                >
                  <div className="h-32 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <TableTopDownArtwork
                      shape="rectangle"
                      seats={6}
                      status="occupied"
                      tableNumber="PANJANG"
                      currencyMode={currencyMode}
                      compactPreview
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-sm font-black text-white group-hover:text-amber-300 transition">
                      Meja Persegi Panjang
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Kapasitas 6–8 Kursi Keluarga / VIP
                    </div>
                    <div className="pt-1 inline-flex items-center gap-1 text-xs font-extrabold text-amber-400">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Klik Masukkan ke Kotak Atas</span>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddTableFromBottomGallery('square', 4)}
                  className="group p-4 rounded-2xl bg-[#090805] hover:bg-[#19140b] border border-amber-500/30 hover:border-amber-400 transition flex flex-col items-center text-center cursor-pointer shadow-md"
                >
                  <div className="h-32 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <TableTopDownArtwork
                      shape="square"
                      seats={4}
                      status="reserved"
                      tableNumber="KOTAK"
                      currencyMode={currencyMode}
                      compactPreview
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-sm font-black text-white group-hover:text-amber-300 transition">
                      Meja Kotak &amp; Kursi
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Kapasitas 2–4 Kursi Reguler
                    </div>
                    <div className="pt-1 inline-flex items-center gap-1 text-xs font-extrabold text-amber-400">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Klik Masukkan ke Kotak Atas</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* KOTAK 2 (KANAN - lg:col-span-4): INFORMASI PENGUNJUNG & PESANAN */}
          <div className="lg:col-span-4 rounded-2xl bg-[#110f0a] border-2 border-amber-500/40 shadow-2xl p-5 space-y-5">
            {!selectedTable ? (
              <div className="py-16 text-center space-y-3">
                <Utensils className="w-10 h-10 text-amber-400/60 mx-auto" />
                <div className="text-sm font-bold text-white">
                  Pilih / Klik Salah Satu Meja
                </div>
                <p className="text-xs text-zinc-400">
                  Klik meja pada kotak denah di sebelah kiri untuk melihat dan mengelola informasi pengunjung, pesanan, total tagihan, serta waktu mulai duduk.
                </p>
              </div>
            ) : (
              <>
                <div className="pb-4 border-b border-amber-500/25 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold">
                      Informasi Meja &amp; Pengunjung
                    </div>
                    <h2 className="text-lg font-black text-white mt-0.5 flex items-center gap-2">
                      <span>{selectedTable.tableNumber}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-sm font-bold text-amber-200">
                        {selectedTable.shape === 'round'
                          ? 'Meja Bulat'
                          : selectedTable.shape === 'rectangle'
                          ? 'Meja Persegi Panjang'
                          : 'Meja Kotak'}
                      </span>
                    </h2>
                    <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                      Posisi ({selectedTable.x}%, {selectedTable.y}%) · Sudut Putar {selectedTable.rotation}° · {selectedTable.seats} Kursi
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteTable(selectedTable.id)}
                    className="p-2 rounded-xl bg-rose-950/60 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 transition cursor-pointer"
                    title="Hapus meja ini dari denah"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Status Meja Selector */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-amber-100/90">
                    Status Meja Saat Ini
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'occupied', label: 'Terisi (Dine-In)' },
                        { id: 'available', label: 'Kosong (Siap)' },
                        { id: 'reserved', label: 'Reservasi' },
                        { id: 'billing', label: 'Siap Bayar' },
                      ] as { id: TableStatus; label: string }[]
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() =>
                          updateTableById(selectedTable.id, (prev) => ({
                            ...prev,
                            status: st.id,
                            seatedAt:
                              st.id === 'occupied' && !prev.seatedAt
                                ? new Date().toISOString()
                                : prev.seatedAt,
                          }))
                        }
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition cursor-pointer whitespace-nowrap ${
                          selectedTable.status === st.id
                            ? 'bg-amber-500 text-black border-amber-300 shadow'
                            : 'bg-[#090805] text-zinc-300 border-zinc-800 hover:border-amber-500/40'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Area / Zona Meja Selector */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-amber-100/90">
                    Area / Zona Meja
                  </label>
                  <select
                    value={selectedTable.zone}
                    onChange={(e) => {
                      const nextZone = e.target.value;
                      const nextPrefix = getAreaFirstWordPrefix(nextZone);
                      const countInTargetZone = tables.filter(
                        (t) =>
                          t.id !== selectedTable.id &&
                          getAreaFirstWordPrefix(t.zone).toLowerCase() ===
                            nextPrefix.toLowerCase()
                      ).length;
                      const nextTableNumber = `${nextPrefix} ${countInTargetZone + 1}`;
                      const shapeLabel = getShapeDisplayLabel(selectedTable.shape);
                      updateTableById(selectedTable.id, (prev) => ({
                        ...prev,
                        zone: nextZone,
                        tableNumber: nextTableNumber,
                        name: `${nextTableNumber} (${shapeLabel})`,
                      }));
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-[#090805] border border-zinc-800 focus:border-amber-400 text-xs font-bold text-white"
                  >
                    {tableAreas.map((areaName) => (
                      <option key={areaName} value={areaName}>
                        {areaName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 1. NAMA PENGUNJUNG & JUMLAH KURSI/TAMU */}
                <div className="p-4 rounded-xl bg-[#090805] border border-amber-500/25 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" />
                      <span>1. Nama Pengunjung yang Datang</span>
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400">
                      Kapasitas: {selectedTable.seats} Kursi
                    </span>
                  </div>

                  <div className="space-y-2">
                    <input
                      type="text"
                      value={selectedTable.visitorName}
                      onChange={(e) =>
                        updateTableById(selectedTable.id, (prev) => ({
                          ...prev,
                          visitorName: e.target.value,
                          status:
                            e.target.value.trim() && prev.status === 'available'
                              ? 'occupied'
                              : prev.status,
                          seatedAt:
                            e.target.value.trim() && !prev.seatedAt
                              ? new Date().toISOString()
                              : prev.seatedAt,
                        }))
                      }
                      placeholder="Ketik nama pengunjung / pelanggan..."
                      className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-amber-400 text-xs font-bold text-white focus:outline-none"
                    />

                    {storeCustomers.length > 0 && (
                      <div className="flex items-center gap-2">
                        <select
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            updateTableById(selectedTable.id, (prev) => ({
                              ...prev,
                              visitorName: e.target.value,
                              status: 'occupied',
                              seatedAt: prev.seatedAt || new Date().toISOString(),
                            }));
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300"
                        >
                          <option value="">-- Pilih Cepat dari Data Pelanggan --</option>
                          {storeCustomers.slice(0, 15).map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name} ({c.type || 'Member'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Jumlah Kursi Meja
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={12}
                        value={selectedTable.seats}
                        onChange={(e) =>
                          updateTableById(selectedTable.id, (prev) => ({
                            ...prev,
                            seats: Math.max(2, Math.min(12, Number(e.target.value) || 4)),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-1">
                        Rotasi Meja ({selectedTable.rotation}°)
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={315}
                        step={15}
                        value={selectedTable.rotation}
                        onChange={(e) =>
                          updateTableById(selectedTable.id, (prev) => ({
                            ...prev,
                            rotation: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-amber-400 cursor-pointer mt-2"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. WAKTU (SAAT MULAI DUDUK) */}
                <div className="p-4 rounded-xl bg-[#090805] border border-amber-500/25 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span>2. Waktu (Saat Mulai Duduk)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateTableById(selectedTable.id, (prev) => ({
                          ...prev,
                          seatedAt: new Date().toISOString(),
                          status: 'occupied',
                        }))
                      }
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 text-[10px] font-bold transition cursor-pointer"
                    >
                      Set Duduk Sekarang
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                      <div className="text-[10px] text-zinc-400">Jam Mulai Duduk</div>
                      <div className="text-sm font-black text-white font-mono tabular-nums mt-0.5">
                        {seatedTimeInfo.clock}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                      <div className="text-[10px] text-zinc-400">Durasi Duduk</div>
                      <div className="text-sm font-black text-amber-400 font-mono tabular-nums mt-0.5">
                        {seatedTimeInfo.duration}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. DAFTAR PESANAN PENGUNJUNG */}
                <div className="p-4 rounded-xl bg-[#090805] border border-amber-500/25 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>3. Daftar Pesanan ({(selectedTable.orders || []).length} Item)</span>
                    </span>
                  </div>

                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                    {(selectedTable.orders || []).length === 0 ? (
                      <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-500">
                        Belum ada pesanan tercatat di meja ini. Tambahkan pesanan di bawah.
                      </div>
                    ) : (
                      (selectedTable.orders || []).map((ord) => (
                        <div
                          key={ord.id}
                          className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-white truncate">{ord.name}</div>
                            <div className="text-[10px] font-mono text-zinc-400 tabular-nums">
                              {fmtMoney(ord.price, currencyMode)} × {ord.qty}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                updateTableById(selectedTable.id, (prev) => ({
                                  ...prev,
                                  orders: (prev.orders || [])
                                    .map((o) =>
                                      o.id === ord.id ? { ...o, qty: o.qty - 1 } : o
                                    )
                                    .filter((o) => o.qty > 0),
                                }))
                              }
                              className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
                            >
                              -
                            </button>
                            <span className="w-5 text-center font-mono font-bold text-amber-300 tabular-nums">
                              {ord.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateTableById(selectedTable.id, (prev) => ({
                                  ...prev,
                                  orders: (prev.orders || []).map((o) =>
                                    o.id === ord.id ? { ...o, qty: o.qty + 1 } : o
                                  ),
                                }))
                              }
                              className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-white font-bold cursor-pointer"
                            >
                              +
                            </button>
                            <div className="w-20 text-right font-mono font-bold text-emerald-400 tabular-nums">
                              {fmtMoney(ord.price * ord.qty, currencyMode)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Order Form */}
                  <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                    <div className="text-[11px] font-bold text-zinc-300">
                      + Tambah Pesanan ke {selectedTable.tableNumber}
                    </div>

                    {storeProducts.length > 0 && (
                      <select
                        value={selectedProductIdToAdd}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setSelectedProductIdToAdd(pid);
                          const found = storeProducts.find((p) => p.id === pid);
                          if (found) {
                            setCustomOrderName(found.name);
                            setCustomOrderPrice(
                              Number(
                                found.posPrice ??
                                  found.sellPrice ??
                                  found.pricePerUnit ??
                                  found.pricePerCarton ??
                                  25000
                              )
                            );
                          }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
                      >
                        <option value="">-- Pilih dari Katalog Produk POS --</option>
                        {storeProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} —{' '}
                            {fmtMoney(
                              Number(
                                p.posPrice ??
                                  p.sellPrice ??
                                  p.pricePerUnit ??
                                  p.pricePerCarton ??
                                  0
                              ),
                              currencyMode
                            )}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="grid grid-cols-12 gap-1.5">
                      <input
                        type="text"
                        value={customOrderName}
                        onChange={(e) => setCustomOrderName(e.target.value)}
                        placeholder="Nama menu / pesanan..."
                        className="col-span-6 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white"
                      />
                      <input
                        type="number"
                        min={1}
                        value={customOrderQty}
                        onChange={(e) => setCustomOrderQty(Number(e.target.value) || 1)}
                        className="col-span-2 px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white text-center"
                        title="Qty"
                      />
                      <input
                        type="number"
                        step={1000}
                        value={customOrderPrice}
                        onChange={(e) => setCustomOrderPrice(Number(e.target.value) || 0)}
                        className="col-span-4 px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-white"
                        title="Harga Satuan"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleAddOrderToSelectedTable}
                      className="w-full py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/40 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Masukkan ke Pesanan Meja</span>
                    </button>
                  </div>
                </div>

                {/* 4. TOTAL PESANAN & TOMBOL SELESAI */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/15 via-[#181208] to-[#0c0a06] border border-amber-400/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-200 uppercase tracking-wider">
                      4. Total Pesanan Meja
                    </span>
                    <span className="text-xl font-black text-amber-400 font-mono tabular-nums">
                      {fmtMoney(selectedTable.totalOrder, currencyMode)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 pt-1">
                    {waiterMode ? (
                      <button
                        type="button"
                        onClick={() => handleSelectTableAndRedirectToWaiterPos(selectedTable)}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition"
                      >
                        <ShoppingBag className="w-4 h-4 text-black" />
                        <span>Pilih Meja {selectedTable.tableNumber} &amp; Buka Menu POS →</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectTableAndRedirectToWaiterPos(selectedTable)}
                          className="w-full py-2.5 px-4 rounded-xl bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/40 font-black text-xs flex items-center justify-center gap-2 cursor-pointer transition"
                        >
                          <ShoppingBag className="w-4 h-4" />
                          <span>Pesan Menu di POS (Mode Waiter)</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCompleteAndClearTable}
                          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-[#d97706] hover:brightness-110 text-black font-black text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer transition"
                        >
                          <CreditCard className="w-4 h-4 text-black" />
                          <span>Selesai Bayar &amp; Kosongkan Meja</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Sub-Navigation Bar for Reservation Table Menu */}
      {renderReservationTableSubNav()}

      {/* Feedback Banner */}
      {statusFeedback && (
        <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusFeedback('')}
            className="text-emerald-300 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active View Content */}
      {activeView === 'reservation' && renderReservasiView()}
      {activeView === 'reservation_list' && renderListReservasiView()}
      {activeView === 'summary' && renderSummaryReportView()}
      {activeView === 'layout' && renderTableLayoutView()}
    </div>
  );
};
