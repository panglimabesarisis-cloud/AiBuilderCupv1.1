import React, { useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  RotateCcw,
  Plus,
  X,
  Calendar,
  Link as LinkIcon,
  Barcode,
  FileText,
  Layers,
  Boxes,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { compressImageFile } from '../../utils/imageCompress';
import { useLanguage } from '../../context/LanguageContext';
import { evaluateProductExpiry } from '../../utils/expiryUtils';
import { RawMaterialRecipeItem } from '../../types';
import {
  useRawMaterials,
  saveRawMaterialInDb,
  RawMaterialItem,
  BOM_RECIPE_UNITS,
  computeBomRowSubtotalCost,
  computeBomTotalCost,
  computeBomTotalWeightKg,
  convertRecipeQtyToWarehouseUnit,
} from '../../services/rawMaterialService';
import { AppLink } from '../../router';

export const MAIN_UNITS = ['Dus', 'Karton', 'Pack', 'Box'] as const;
export const SUB_UNITS = ['Unit', 'Pcs', 'Botol', 'Cup', 'Sachet', 'Kg'] as const;
export const VARIANT_TYPES = ['Rasa', 'Ukuran', 'Kemasan', 'Warna'] as const;
export const ADD_NEW_VALUE = '__ADD_NEW__';

export interface ProductFormFieldsValue {
  id?: string;
  docId?: string;
  sku?: string;
  description?: string;
  batchCode?: string;
  pwaPrice?: number;
  /** true (default) = Harga Jual PWA otomatis mengikuti Harga Jual 1 Produk. false = sudah diedit manual. (Hanya state form, tidak disimpan ke DB) */
  pwaPriceLinked?: boolean;
  variantType?: string;
  name: string;
  category: string;
  brand: string;
  storageLocation: string;
  weightMl: number;
  deliveryCommission: number;
  itemsPerCarton: number;
  pricePerCarton: number;
  costPerCarton: number;
  mainUnitStock: number;
  subUnitStock: number;
  mainUnit: string;
  subUnit: string;
  manualCostPrice: number;
  manualSellPrice: number;
  manualStock: number;
  isActive: boolean;
  sellByUnit: boolean;
  isPosVisible: boolean;
  isPwaVisible: boolean;
  trackStockCard: boolean;
  hasRawMaterials?: boolean;
  autoDeductRawMaterial?: boolean;
  rawMaterialRecipe?: RawMaterialRecipeItem[];
  productionDate?: string;
  expiryDate?: string;
  imageUrl?: string;
  galleryImages?: string[];
}

/**
 * ATURAN TUNGGAL Harga Jual PWA (dipakai form & daftar produk):
 * PWA dianggap "ikut" Harga Jual 1 Produk jika kosong/0 atau nilainya sama persis.
 * Jika berbeda, berarti sudah di-custom dan tidak boleh ditimpa otomatis.
 */
export function isPwaPriceLinked(pwaPrice: unknown, sellPrice: unknown): boolean {
  const pwa = Number(pwaPrice);
  const sell = Number(sellPrice) || 0;
  return !Number.isFinite(pwa) || pwa <= 0 || pwa === sell;
}

export function computeEffectiveFields(val: ProductFormFieldsValue) {
  // Items per Carton = Jumlah item yang tersedia di dalam 1 karton
  const safeIsi = Math.max(1, Math.floor(Number(val.itemsPerCarton) || 1));
  const safeWeightMl = Math.max(0, Number(val.weightMl) || 0);
  const totalBeratKg =
    val.hasRawMaterials && Array.isArray(val.rawMaterialRecipe)
      ? computeBomTotalWeightKg(val.rawMaterialRecipe)
      : Number(((safeWeightMl * safeIsi) / 1000).toFixed(3));

  // Harga Jual & Harga Modal = Harga untuk 1 Karton (bukan 1 item)
  const rawSell =
    val.manualSellPrice !== undefined && Number(val.manualSellPrice) > 0
      ? Number(val.manualSellPrice)
      : Number(val.pricePerCarton) || 0;
  const baseSellPrice = Math.max(0, rawSell);

  // Harga Jual PWA: otomatis = Harga Jual 1 Produk selama masih "linked"; jika diedit manual pakai nilai manual
  const isPwaLinked = val.pwaPriceLinked !== false;
  const basePwaPrice =
    !isPwaLinked && Number(val.pwaPrice) > 0
      ? Math.max(0, Number(val.pwaPrice))
      : baseSellPrice;

  const rawCost =
    val.manualCostPrice !== undefined && Number(val.manualCostPrice) > 0
      ? Number(val.manualCostPrice)
      : Number(val.costPerCarton) || 0;
  const baseCostPrice = Math.max(0, rawCost);

  // Harga 1 Item (otomatis) = Harga 1 Karton dibagi Jumlah Item dalam 1 Karton
  const autoUnitSellPrice = Math.round(baseSellPrice / safeIsi);
  const autoUnitCostPrice = Math.round(baseCostPrice / safeIsi);

  // Stok = Jumlah Karton (Carton Qty), bukan dibagi Items per Carton
  // Ketika Bahan Baku Aktif (hasRawMaterials), stok produk selalu ada (minimal 999)
  const rawStock =
    val.manualStock !== undefined && val.manualStock !== null
      ? Number(val.manualStock)
      : Number(val.mainUnitStock) || 0;
  const effectiveStock = val.hasRawMaterials
    ? Math.max(999, Math.floor(Number.isFinite(rawStock) && rawStock > 0 ? rawStock : 999))
    : Math.max(0, Math.floor(Number.isFinite(rawStock) ? rawStock : 0));

  const effectiveCostPrice = baseCostPrice;
  const effectiveSellPrice = baseSellPrice;
  const effectivePwaPrice = basePwaPrice;
  const effectivePricePerCarton = effectiveSellPrice;
  const effectiveCostPerCarton = effectiveCostPrice;
  const stockInCartons = effectiveStock;
  const totalItemsInStock = effectiveStock * safeIsi;
  const calculatedTotalStock = effectiveStock;

  return {
    safeIsi,
    safeWeightMl,
    totalBeratKg,
    autoUnitSellPrice,
    autoUnitCostPrice,
    isPwaLinked,
    calculatedTotalStock,
    effectiveCostPrice,
    effectiveSellPrice,
    effectivePwaPrice,
    effectiveStock,
    stockInCartons,
    totalItemsInStock,
    effectivePricePerCarton,
    effectiveCostPerCarton,
  };
}

interface ProductFormFieldsProps {
  isDark: boolean;
  isVariant?: boolean;
  showPhotoCard?: boolean;
  fallbackImageUrl?: string | null;
  value: ProductFormFieldsValue;
  onChange: (updated: ProductFormFieldsValue) => void;
  categories: string[];
  brands: string[];
  storageLocations: string[];
  onRequestAddMaster: (type: 'category' | 'brand' | 'storage') => void;
  toDisplayValue: (valInIdr: number) => number;
  parseInputToIdr: (displayVal: number | string) => number;
  onShowFlash?: (msg: string) => void;
}

export const ProductFormFields: React.FC<ProductFormFieldsProps> = ({
  isDark,
  isVariant = false,
  showPhotoCard = false,
  fallbackImageUrl,
  value,
  onChange,
  categories,
  brands,
  storageLocations,
  onRequestAddMaster,
  toDisplayValue,
  parseInputToIdr,
  onShowFlash,
}) => {
  const { t, tr, translateCategory, translateUnit, translateVariant } = useLanguage();
  const variantPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const { rawMaterials: liveRawMaterials } = useRawMaterials();
  const [quickAddRmModal, setQuickAddRmModal] = useState<{
    open: boolean;
    targetRowIndex: number | null;
    name: string;
    sku: string;
    category: string;
    mainUnit: string;
    stock: number;
    costPrice: number;
    minStock: number;
    isSaving: boolean;
  }>({
    open: false,
    targetRowIndex: null,
    name: '',
    sku: '',
    category: 'BAHAN BAKU UTAMA',
    mainUnit: 'Kg',
    stock: 20,
    costPrice: 15000,
    minStock: 5,
    isSaving: false,
  });
  const [qtyDraftMap, setQtyDraftMap] = useState<Record<number, string>>({});

  const {
    safeIsi,
    totalBeratKg,
    autoUnitSellPrice,
    autoUnitCostPrice,
    effectiveCostPrice,
    effectiveSellPrice,
    effectivePwaPrice,
    isPwaLinked,
    effectiveStock,
    stockInCartons,
    totalItemsInStock,
  } = computeEffectiveFields(value);

  // Satu handler untuk SEMUA input Harga Jual 1 Produk (kartu utama & blok Jual Satuan)
  const handleSellPriceChange = (rawVal: string) => {
    const parsed = parseInputToIdr(rawVal);
    onChange({
      ...value,
      manualSellPrice: parsed,
      pricePerCarton: parsed,
      // PWA ikut otomatis selama belum diedit manual
      pwaPrice: isPwaLinked ? parsed : value.pwaPrice,
      pwaPriceLinked: isPwaLinked,
    });
  };

  const updateField = <K extends keyof ProductFormFieldsValue>(
    field: K,
    fieldVal: ProductFormFieldsValue[K]
  ) => {
    onChange({
      ...value,
      [field]: fieldVal,
    });
  };

  const handleToggleSellByUnit = () => {
    onChange({
      ...value,
      manualCostPrice: effectiveCostPrice,
      costPerCarton: effectiveCostPrice,
      manualSellPrice: effectiveSellPrice,
      pricePerCarton: effectiveSellPrice,
      manualStock: effectiveStock,
      mainUnitStock: effectiveStock,
      subUnitStock: totalItemsInStock,
      sellByUnit: !value.sellByUnit,
    });
  };

  const handleIsiChange = (rawVal: string) => {
    const parsed = Math.max(1, Math.floor(Number(rawVal) || 1));
    onChange({
      ...value,
      itemsPerCarton: parsed,
      subUnitStock: effectiveStock * parsed,
    });
  };

  const handleSelectMaster = (
    type: 'category' | 'brand' | 'storage',
    selectedVal: string
  ) => {
    if (selectedVal === ADD_NEW_VALUE) {
      onRequestAddMaster(type);
      return;
    }
    if (type === 'category') updateField('category', selectedVal);
    if (type === 'brand') updateField('brand', selectedVal);
    if (type === 'storage') updateField('storageLocation', selectedVal);
  };

  const handleVariantPhotoChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 0.7);
      updateField('imageUrl', compressed);
      onShowFlash?.(
        tr(
          `Photo "${file.name}" compressed & uploaded!`,
          `Foto "${file.name}" berhasil dikompres & diunggah!`
        )
      );
    } catch {
      onShowFlash?.(tr('Failed to process image.', 'Gagal memproses gambar.'));
    } finally {
      if (variantPhotoInputRef.current) variantPhotoInputRef.current.value = '';
    }
  };

  const handleGalleryFilesChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files: File[] = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const currentGallery = Array.isArray(value.galleryImages)
      ? value.galleryImages
      : [];
    const remainingSlots = Math.max(0, 4 - currentGallery.length);
    if (remainingSlots <= 0) {
      onShowFlash?.(
        tr('Image Gallery allows a maximum of 4 photos!', 'Galeri Foto maksimal 4 foto!')
      );
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    try {
      const compressedList: string[] = [];
      for (const file of filesToProcess) {
        const compressed = await compressImageFile(file, 640, 0.6);
        compressedList.push(compressed);
      }
      updateField('galleryImages', [...currentGallery, ...compressedList]);
      onShowFlash?.(
        tr(
          `${compressedList.length} photo(s) added to Image Gallery!`,
          `${compressedList.length} foto ditambahkan ke Galeri Foto!`
        )
      );
    } catch {
      onShowFlash?.(
        tr('Failed to process gallery photos.', 'Gagal memproses foto galeri.')
      );
    } finally {
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleRemoveGalleryImage = (idxToRemove: number) => {
    const currentGallery = Array.isArray(value.galleryImages)
      ? value.galleryImages
      : [];
    updateField(
      'galleryImages',
      currentGallery.filter((_, idx) => idx !== idxToRemove)
    );
  };

  const galleryList = Array.isArray(value.galleryImages)
    ? value.galleryImages
    : [];

  const labelClass = `block text-xs font-medium mb-1.5 ${
    isDark ? 'text-zinc-300' : 'text-slate-700'
  }`;

  const inputBaseClass = `w-full px-3.5 py-2 rounded-lg border text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    isDark
      ? 'bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500'
      : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-blue-500'
  }`;

  const disabledInputClass = `w-full px-3.5 py-2 rounded-lg border text-sm cursor-not-allowed ${
    isDark
      ? 'bg-zinc-800/70 border-zinc-700/80 text-zinc-400'
      : 'bg-slate-100 border-slate-200 text-slate-600'
  }`;

  const renderToggleSwitch = (
    checked: boolean,
    onToggle: () => void,
    labelText: string
  ) => (
    <div className="flex items-center justify-between sm:justify-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-12 shrink-0 items-center cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
          checked
            ? 'bg-blue-600'
            : isDark
            ? 'bg-zinc-700'
            : 'bg-slate-300'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
            checked ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{labelText}</span>
        <span
          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
            checked
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : isDark
              ? 'bg-zinc-800 text-zinc-400 border-zinc-700'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}
        >
          {checked ? tr('ON', 'AKTIF') : tr('OFF', 'NONAKTIF')}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KARTU FOTO VARIAN + IMAGE GALLERY */}
      {showPhotoCard && (
        <div
          className={`rounded-xl border p-4 sm:p-5 transition-colors ${
            isDark
              ? 'border-zinc-800 bg-zinc-950/50'
              : 'border-slate-200 bg-slate-50/70'
          }`}
        >
          <div className="flex flex-col md:flex-row items-start gap-6">
            {/* Kotak Foto Varian (~112px / w-28 h-28) */}
            <div className="space-y-2.5 shrink-0 w-full md:w-auto">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isDark ? 'text-zinc-300' : 'text-slate-700'
                  }`}
                >
                  {t('product.variantPhoto', 'Foto Varian')}
                </span>
                {!value.imageUrl && fallbackImageUrl && (
                  <span className="text-[10px] text-blue-400 font-medium">
                    {t('product.fallbackMainPhoto', 'Cadangan: Foto Utama')}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`relative w-28 h-28 shrink-0 rounded-xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition-all group ${
                    isDark
                      ? 'border-zinc-700 bg-zinc-900 hover:border-blue-500/60'
                      : 'border-slate-300 bg-white hover:border-blue-400'
                  }`}
                >
                  {value.imageUrl ? (
                    <>
                      <img
                        src={value.imageUrl}
                        alt={t('product.variantPhoto', 'Foto Varian')}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => variantPhotoInputRef.current?.click()}
                          className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow cursor-pointer"
                          title={t('common.change', 'Ganti')}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateField('imageUrl', '')}
                          className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow cursor-pointer"
                          title={t('common.delete', 'Hapus')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => variantPhotoInputRef.current?.click()}
                      className="w-full h-full flex flex-col items-center justify-center p-2 text-center cursor-pointer hover:opacity-80 transition"
                    >
                      <ImageIcon
                        className={`w-6 h-6 mb-1 ${
                          isDark ? 'text-zinc-400' : 'text-slate-400'
                        }`}
                      />
                      <span
                        className={`text-[11px] font-semibold leading-tight ${
                          isDark ? 'text-zinc-300' : 'text-slate-600'
                        }`}
                      >
                        {t('product.variantPhoto', 'Foto Varian')}
                      </span>
                      <span className="text-[9px] text-zinc-500 mt-0.5">
                        {t('product.clickToPickShort', 'Klik pilih')}
                      </span>
                    </button>
                  )}
                </div>

                <input
                  ref={variantPhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleVariantPhotoChange}
                  className="hidden"
                />

                <div className="flex flex-col gap-1.5 flex-1">
                  <button
                    type="button"
                    onClick={() => variantPhotoInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-xs w-fit"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>
                      {value.imageUrl
                        ? t('common.change', 'Ganti Gambar')
                        : t('common.upload', 'Upload Gambar')}
                    </span>
                  </button>
                  {value.imageUrl && (
                    <button
                      type="button"
                      onClick={() => updateField('imageUrl', '')}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition w-fit ${
                        isDark
                          ? 'border-zinc-700 bg-zinc-800 text-rose-400 hover:bg-zinc-700'
                          : 'border-slate-200 bg-white text-rose-600 hover:bg-slate-100'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('common.delete', 'Hapus Gambar')}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Input URL Gambar Varian */}
              <div className="pt-1">
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1 flex items-center gap-1">
                  <LinkIcon className="w-3 h-3 text-blue-400" />
                  <span>{tr('Or Input Image URL', 'Atau Input URL Gambar')}</span>
                </label>
                <input
                  type="text"
                  placeholder="https://example.com/foto-varian.jpg"
                  value={value.imageUrl?.startsWith('data:') ? '' : value.imageUrl || ''}
                  onChange={(e) => updateField('imageUrl', e.target.value)}
                  className={`w-full md:w-72 px-2.5 py-1.5 rounded-lg border text-xs transition focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                      : 'bg-white border-slate-300 text-slate-800 placeholder:text-slate-400'
                  }`}
                />
              </div>
            </div>

            {/* Divider on desktop */}
            <div
              className={`hidden md:block w-px self-stretch ${
                isDark ? 'bg-zinc-800' : 'bg-slate-200'
              }`}
            />

            {/* Image Gallery (maks 4 thumbnail ~64px / w-16 h-16) */}
            <div className="flex-1 space-y-2 w-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isDark ? 'text-zinc-300' : 'text-slate-700'
                    }`}
                  >
                    {t('product.imageGallery', 'Galeri Foto')}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                      isDark
                        ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    {galleryList.length}/4
                  </span>
                </div>

                {galleryList.length < 4 && (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="text-xs font-semibold text-blue-500 hover:text-blue-400 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('product.uploadGallery', 'Unggah Galeri')}</span>
                  </button>
                )}
              </div>

              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleGalleryFilesChange}
                className="hidden"
              />

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {galleryList.map((imgSrc, idx) => (
                  <div
                    key={idx}
                    className={`relative w-16 h-16 rounded-xl border overflow-hidden group shrink-0 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-900'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <img
                      src={imgSrc}
                      alt={`Gallery ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveGalleryImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow cursor-pointer opacity-90 hover:opacity-100 transition"
                      title={t('common.delete', 'Hapus')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {galleryList.length < 4 && (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className={`w-16 h-16 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition cursor-pointer shrink-0 ${
                      isDark
                        ? 'border-zinc-700 bg-zinc-900/60 hover:border-blue-500/60 text-zinc-400 hover:text-blue-400'
                        : 'border-slate-300 bg-white hover:border-blue-400 text-slate-400 hover:text-blue-500'
                    }`}
                    title={t('product.uploadGallery', 'Unggah Galeri')}
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-[9px] font-semibold mt-0.5">
                      {t('common.add', 'Tambah')}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Select "Varian" di atas Nama Produk (khusus saat di dalam kartu Varian) */}
      {isVariant && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <label className={labelClass}>{t('product.variants', 'Tipe Varian')}</label>
            <select
              value={value.variantType || 'Rasa'}
              onChange={(e) => updateField('variantType', e.target.value)}
              className={`${inputBaseClass} cursor-pointer`}
            >
              {VARIANT_TYPES.map((vt) => (
                <option key={vt} value={vt}>
                  {translateVariant(vt)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <Barcode className="w-3.5 h-3.5 text-blue-400" />
                <span>{tr('Variant SKU / Barcode', 'SKU / Barcode Varian')}</span>
              </span>
            </label>
            <input
              type="text"
              translate="no"
              placeholder={tr('Auto or custom SKU (e.g. P1001-V1)', 'SKU otomatis atau manual')}
              value={value.sku || ''}
              onChange={(e) => updateField('sku', e.target.value)}
              className={`${inputBaseClass} font-mono notranslate`}
            />
          </div>
        </div>
      )}

      {/* Grid 2 Kolom Utama */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        {/* Row 1: Nama Produk * | SKU / Barcode (untuk produk utama) atau Harga Modal */}
        <div>
          <label className={labelClass}>
            {isVariant ? tr('Variant Name', 'Nama Varian') : t('product.name', 'Nama Produk')}{' '}
            <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            placeholder={
              isVariant
                ? tr('Enter variant name (e.g. Cokelat / 600ml)', 'Masukkan nama varian (misal: Cokelat / 600ml)')
                : t('product.namePlaceholder', 'Masukkan nama produk')
            }
            value={value.name}
            onChange={(e) => updateField('name', e.target.value)}
            className={inputBaseClass}
          />
        </div>

        {!isVariant ? (
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <Barcode className="w-3.5 h-3.5 text-blue-400" />
                <span>{tr('SKU / Barcode', 'SKU / Barcode Produk')}</span>
              </span>
            </label>
            <input
              type="text"
              translate="no"
              placeholder={tr('Enter SKU or Barcode (e.g. BRG-001)', 'Masukkan kode SKU atau Barcode')}
              value={value.sku || ''}
              onChange={(e) => updateField('sku', e.target.value)}
              className={`${inputBaseClass} font-mono notranslate`}
            />
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                {t('product.costPrice', 'Harga Modal')}
              </label>
              <span className="text-[10px] font-mono text-zinc-400">
                {tr('Per Item:', 'Per Item:')} {toDisplayValue(autoUnitCostPrice).toLocaleString('id-ID')}
              </span>
            </div>
            <input
              type="number"
              min="0"
              value={toDisplayValue(effectiveCostPrice)}
              onChange={(e) => {
                const parsed = parseInputToIdr(e.target.value);
                onChange({
                  ...value,
                  manualCostPrice: parsed,
                  costPerCarton: parsed,
                });
              }}
              className={inputBaseClass}
            />
          </div>
        )}

        {/* Row 2: Harga Modal (jika bukan varian) & Harga Jual POS */}
        {!isVariant && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                {t('product.costPrice', 'Harga Modal')}
              </label>
              <span className="text-[10px] font-mono text-zinc-400">
                {tr('Per Item:', 'Per Item:')} {toDisplayValue(autoUnitCostPrice).toLocaleString('id-ID')}
              </span>
            </div>
            <input
              type="number"
              min="0"
              value={toDisplayValue(effectiveCostPrice)}
              onChange={(e) => {
                const parsed = parseInputToIdr(e.target.value);
                onChange({
                  ...value,
                  manualCostPrice: parsed,
                  costPerCarton: parsed,
                });
              }}
              className={inputBaseClass}
            />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
              {t('product.sellingPrice', 'Harga Jual')}
            </label>
            <span className="text-[10px] font-mono font-bold text-blue-400">
              {tr('Per Qty:', 'Per Qty:')}{' '}
              {toDisplayValue(autoUnitSellPrice).toLocaleString('id-ID')}
            </span>
          </div>
          <input
            type="number"
            min="0"
            value={toDisplayValue(effectiveSellPrice)}
            onChange={(e) => handleSellPriceChange(e.target.value)}
            className={inputBaseClass}
          />
        </div>

        {/* Row 3: Harga Jual PWA (otomatis = Harga Jual 1 Produk, bisa diedit) | Komisi Pengirim */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
              {t('product.pwaSellingPrice', 'Harga Jual PWA')}
            </label>
            {isPwaLinked ? (
              <span className="text-[10px] font-bold text-emerald-400">
                {tr('Auto = Selling Price', 'Otomatis = Harga Jual')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    pwaPrice: effectiveSellPrice,
                    pwaPriceLinked: true,
                  })
                }
                className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
              >
                {tr('Reset to Selling Price', 'Samakan dengan Harga Jual')}
              </button>
            )}
          </div>
          <input
            type="number"
            min="0"
            value={
              isPwaLinked
                ? toDisplayValue(effectiveSellPrice)
                : toDisplayValue(Number(value.pwaPrice) || 0)
            }
            onChange={(e) => {
              const parsed = parseInputToIdr(e.target.value);
              onChange({
                ...value,
                pwaPrice: parsed,
                // Diedit manual -> lepas dari Harga Jual; jika diketik sama persis -> otomatis linked lagi
                pwaPriceLinked: parsed === effectiveSellPrice,
              });
            }}
            className={inputBaseClass}
          />
          <p className="mt-1 text-[10px] font-mono text-cyan-400">
            {tr('Per Qty:', 'Per Qty:')}{' '}
            {toDisplayValue(Math.round(effectivePwaPrice / safeIsi)).toLocaleString('id-ID')}
            {!isPwaLinked && !(Number(value.pwaPrice) > 0) && (
              <span className="ml-1 text-amber-400">
                {tr('(empty = follows Selling Price)', '(kosong = ikut Harga Jual)')}
              </span>
            )}
          </p>
        </div>

        {!value.hasRawMaterials && (
          <div>
            <label className={labelClass}>
              {t('product.deliveryCommission', 'Komisi Pengirim')}
            </label>
            <input
              type="number"
              min="0"
              value={toDisplayValue(value.deliveryCommission)}
              onChange={(e) =>
                updateField('deliveryCommission', parseInputToIdr(e.target.value))
              }
              className={inputBaseClass}
            />
          </div>
        )}

        {/* Row 4: Kategori | Brand */}
        <div>
          <label className={labelClass}>{t('product.category', 'Kategori')}</label>
          <select
            value={value.category}
            onChange={(e) => handleSelectMaster('category', e.target.value)}
            className={`${inputBaseClass} cursor-pointer`}
          >
            <option value="">{t('product.selectCategory', 'Pilih kategori')}</option>
            {value.category && !categories.some((c) => c.toLowerCase() === value.category.toLowerCase()) && (
              <option value={value.category}>{translateCategory(value.category)}</option>
            )}
            {categories.map((cat, idx) => (
              <option key={`fld-cat-${cat}-${idx}`} value={cat}>
                {translateCategory(cat)}
              </option>
            ))}
            <option value={ADD_NEW_VALUE}>
              {t('common.addNewOption', '+ Tambah baru...')}
            </option>
          </select>
        </div>

        <div>
          <label className={labelClass}>{t('product.brand', 'Brand')}</label>
          <select
            value={value.brand}
            onChange={(e) => handleSelectMaster('brand', e.target.value)}
            translate="no"
            className={`${inputBaseClass} cursor-pointer notranslate`}
          >
            <option value="">{t('product.selectBrand', 'Pilih brand')}</option>
            {value.brand && !brands.some((b) => b.toLowerCase() === value.brand.toLowerCase()) && (
              <option value={value.brand} data-no-translate="true" className="notranslate">
                {value.brand}
              </option>
            )}
            {brands.map((b, idx) => (
              <option key={`fld-brand-${b}-${idx}`} value={b} data-no-translate="true" className="notranslate">
                {b}
              </option>
            ))}
            <option value={ADD_NEW_VALUE}>
              {t('common.addNewOption', '+ Tambah baru...')}
            </option>
          </select>
        </div>

        {/* Row 5: Stok (= Jumlah Karton) | Berat / Volume 1 Produk (ml) — disembunyikan jika Bahan Baku Aktif */}
        {!value.hasRawMaterials && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                {t('product.stock', 'Stok (Jumlah Dus / Karton)')}
              </label>
              <span translate="no" className="notranslate text-[10px] font-mono font-bold text-emerald-400">
                {stockInCartons} {translateUnit(value.mainUnit || 'Karton')} ({tr('Total:', 'Total Isi:')}{' '}
                {totalItemsInStock.toLocaleString('id-ID')} {translateUnit(value.subUnit || 'Pcs')})
              </span>
            </div>
            <input
              type="number"
              min="0"
              value={effectiveStock}
              onChange={(e) => {
                const nextStk = Math.max(0, Math.floor(Number(e.target.value) || 0));
                onChange({
                  ...value,
                  manualStock: nextStk,
                  mainUnitStock: nextStk,
                  subUnitStock: nextStk * safeIsi,
                });
              }}
              className={`${inputBaseClass} notranslate`}
            />
          </div>
        )}

        {!value.hasRawMaterials && (
          <div>
            <label className={labelClass}>{t('product.weightMl', 'Berat / Volume 1 Produk (ml)')}</label>
            <input
              type="number"
              min="0"
              value={value.weightMl}
              onChange={(e) =>
                updateField('weightMl', Math.max(0, Number(e.target.value) || 0))
              }
              className={`${inputBaseClass} notranslate`}
            />
          </div>
        )}

        {/* Row 6: Produk(Pcs) | Penyimpanan */}
        {!value.hasRawMaterials && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label translate="no" className={`notranslate text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                {t('product.itemsPerCarton', 'Produk(Pcs)')}
              </label>
              <span translate="no" className="notranslate text-[10px] font-mono font-bold text-amber-400">
                1 {translateUnit(value.mainUnit || 'Karton')} = {safeIsi}{' '}
                {translateUnit(value.subUnit || 'Pcs')}
              </span>
            </div>
            <input
              type="number"
              min="1"
              value={value.itemsPerCarton}
              onChange={(e) => handleIsiChange(e.target.value)}
              className={`${inputBaseClass} notranslate`}
            />
          </div>
        )}

        <div>
          <label className={labelClass}>
            {t('product.storageLocation', 'Penyimpanan')}
          </label>
          <select
            value={value.storageLocation}
            onChange={(e) => handleSelectMaster('storage', e.target.value)}
            className={`${inputBaseClass} cursor-pointer`}
          >
            <option value="">
              {t('product.selectStorage', 'Pilih lokasi penyimpanan')}
            </option>
            {value.storageLocation &&
              !storageLocations.some(
                (loc) => loc.toLowerCase() === value.storageLocation.toLowerCase()
              ) && <option value={value.storageLocation}>{value.storageLocation}</option>}
            {storageLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
            <option value={ADD_NEW_VALUE}>
              {t('common.addNewOption', '+ Tambah baru...')}
            </option>
          </select>
        </div>

        {/* Row 7: Batch FEFO (Kode Batch, Tanggal Produksi, Tanggal Kadaluarsa) */}
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>{tr('FEFO Batch Code', 'Kode Batch FEFO')}</span>
            </span>
          </label>
          <input
            type="text"
            translate="no"
            placeholder={tr('e.g. BATCH-2026-01', 'Contoh: BATCH-2026-01')}
            value={value.batchCode || ''}
            onChange={(e) => updateField('batchCode', e.target.value)}
            className={`${inputBaseClass} font-mono notranslate`}
          />
        </div>

        {!value.hasRawMaterials && (
          <div>
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                <span>{t('product.productionDate', 'Tanggal Produksi')}</span>
              </span>
            </label>
            <input
              type="date"
              value={value.productionDate || ''}
              onChange={(e) => updateField('productionDate', e.target.value)}
              className={`${inputBaseClass} cursor-pointer`}
            />
          </div>
        )}

        {!value.hasRawMaterials && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('product.expiryDate', 'Tanggal Kadaluarsa (Expired)')}</span>
                </span>
              </label>
              {value.expiryDate && (() => {
                const evalExp = evaluateProductExpiry({
                  category: value.category,
                  productionDate: value.productionDate,
                  expiryDate: value.expiryDate,
                  stockInUnits: effectiveStock,
                });
                const badgeColor =
                  evalExp.status === 'expired' || evalExp.status === 'critical'
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : evalExp.status === 'warning'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
                return (
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${badgeColor}`}>
                    {evalExp.countdownLabel}
                  </span>
                );
              })()}
            </div>
            <input
              type="date"
              value={value.expiryDate || ''}
              onChange={(e) => updateField('expiryDate', e.target.value)}
              className={`${inputBaseClass} cursor-pointer`}
            />
          </div>
        )}

        {/* Deskripsi Produk */}
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              <span>{tr('Product Description', 'Deskripsi Produk')}</span>
            </span>
          </label>
          <input
            type="text"
            placeholder={tr('Optional product description / notes...', 'Deskripsi singkat atau catatan produk (opsional)...')}
            value={value.description || ''}
            onChange={(e) => updateField('description', e.target.value)}
            className={inputBaseClass}
          />
        </div>
      </div>

      {/* Toggles Grid (2 Kolom) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5 pt-1">
        {/* Produk Aktif */}
        {renderToggleSwitch(
          value.isActive,
          () => updateField('isActive', !value.isActive),
          t('product.activeProduct', 'Produk Aktif')
        )}

        {/* Jual Satuan */}
        {renderToggleSwitch(
          value.sellByUnit,
          handleToggleSellByUnit,
          t('product.sellByUnit', 'Jual Satuan')
        )}

        {/* Tampil di POS */}
        {renderToggleSwitch(
          value.isPosVisible,
          () => updateField('isPosVisible', !value.isPosVisible),
          t('product.showInPos', 'Tampil di POS')
        )}

        {/* Tampil di PWA */}
        {renderToggleSwitch(
          value.isPwaVisible,
          () => updateField('isPwaVisible', !value.isPwaVisible),
          t('product.showInPwa', 'Tampil di PWA')
        )}

        {/* Kartu Stok */}
        {renderToggleSwitch(
          value.trackStockCard,
          () => updateField('trackStockCard', !value.trackStockCard),
          t('product.trackStockCard', 'Kartu Stok')
        )}

        {/* Bahan Baku (Di bawah Tampil di PWA) */}
        {renderToggleSwitch(
          Boolean(value.hasRawMaterials),
          () => {
            const nextHas = !value.hasRawMaterials;
            const currentRecipe = Array.isArray(value.rawMaterialRecipe)
              ? value.rawMaterialRecipe
              : [];
            let nextRecipe = currentRecipe;
            if (nextHas && currentRecipe.length === 0) {
              const firstRm = liveRawMaterials[0];
              const initUnit = firstRm?.mainUnit || 'Kg';
              const initCost = Number(firstRm?.costPrice || 0);
              nextRecipe = [
                {
                  rawMaterialId: firstRm?.id || '',
                  rawMaterialName: firstRm?.name || '',
                  rawMaterialSku: firstRm?.sku || '',
                  unit: initUnit,
                  qtyPerUnit: 1,
                  costPerUnit: initCost,
                  subtotalCost: computeBomRowSubtotalCost({
                    unit: initUnit,
                    qtyPerUnit: 1,
                    costPerUnit: initCost,
                    wastagePercent: 0,
                  }),
                  wastagePercent: 0,
                },
              ];
            }
            const guaranteedStock = nextHas
              ? Math.max(999, Number(value.manualStock ?? value.mainUnitStock) || 999)
              : value.manualStock;
            onChange({
              ...value,
              hasRawMaterials: nextHas,
              autoDeductRawMaterial: value.autoDeductRawMaterial !== false,
              rawMaterialRecipe: nextRecipe,
              ...(nextHas
                ? {
                    manualStock: guaranteedStock,
                    mainUnitStock: guaranteedStock,
                    subUnitStock: guaranteedStock * safeIsi,
                  }
                : {}),
            });
          },
          tr('Raw Materials (BOM)', 'Bahan Baku')
        )}
      </div>

      {/* BLOK RESEP / KOMPOSISI BAHAN BAKU (Tampil saat Bahan Baku ON — seperti Varian ON) */}
      {value.hasRawMaterials && (() => {
        const recipeRows: RawMaterialRecipeItem[] = Array.isArray(value.rawMaterialRecipe)
          ? value.rawMaterialRecipe
          : [];

        const totalBomCost = computeBomTotalCost(recipeRows);

        // Calculate max producible units based on current stock of selected raw materials (with unit conversion)
        const producibleCapacities = recipeRows
          .filter((r) => r.rawMaterialId && Number(r.qtyPerUnit) > 0)
          .map((r) => {
            const found = liveRawMaterials.find(
              (rm) => rm.id === r.rawMaterialId || rm.sku === r.rawMaterialId
            );
            const avail = Number(found?.stock ?? 0);
            const w = 1 + Math.max(0, Number(r.wastagePercent || 0)) / 100;
            const warehouseUnit = found?.mainUnit || 'Kg';
            const qtyInWarehouseUnit = convertRecipeQtyToWarehouseUnit(
              Number(r.qtyPerUnit || 0),
              r.unit || warehouseUnit,
              warehouseUnit
            );
            const reqPerUnit = qtyInWarehouseUnit * w;
            return reqPerUnit > 0 ? Math.floor(avail / reqPerUnit) : 0;
          });
        const maxProducibleUnits =
          producibleCapacities.length > 0 ? Math.min(...producibleCapacities) : 0;

        const handleAddRecipeRow = () => {
          const defaultRm =
            liveRawMaterials.find(
              (rm) => !recipeRows.some((r) => r.rawMaterialId === rm.id)
            ) || liveRawMaterials[0];
          const initUnit = defaultRm?.mainUnit || 'Kg';
          const initCost = Number(defaultRm?.costPrice || 0);
          const nextRow: RawMaterialRecipeItem = {
            rawMaterialId: defaultRm?.id || '',
            rawMaterialName: defaultRm?.name || '',
            rawMaterialSku: defaultRm?.sku || '',
            unit: initUnit,
            qtyPerUnit: 1,
            costPerUnit: initCost,
            subtotalCost: computeBomRowSubtotalCost({
              unit: initUnit,
              qtyPerUnit: 1,
              costPerUnit: initCost,
              wastagePercent: 0,
            }),
            wastagePercent: 0,
          };
          onChange({
            ...value,
            rawMaterialRecipe: [...recipeRows, nextRow],
          });
        };

        const handleUpdateRecipeRow = (
          rowIndex: number,
          patch: Partial<RawMaterialRecipeItem>
        ) => {
          const next = recipeRows.map((row, idx) => {
            if (idx !== rowIndex) return row;
            const updated = { ...row, ...patch };
            updated.subtotalCost = computeBomRowSubtotalCost(updated);
            return updated;
          });
          onChange({
            ...value,
            rawMaterialRecipe: next,
          });
        };

        const handleSelectRawMaterial = (rowIndex: number, selectedId: string) => {
          if (selectedId === '__QUICK_ADD_RM__') {
            setQuickAddRmModal({
              open: true,
              targetRowIndex: rowIndex,
              name: '',
              sku: `BB-${Date.now().toString().slice(-4)}`,
              category: 'BAHAN BAKU UTAMA',
              mainUnit: 'Kg',
              stock: 25,
              costPrice: 15000,
              minStock: 5,
              isSaving: false,
            });
            return;
          }
          const found = liveRawMaterials.find(
            (rm) => rm.id === selectedId || rm.sku === selectedId
          );
          if (!found) {
            handleUpdateRecipeRow(rowIndex, {
              rawMaterialId: '',
              rawMaterialName: '',
              rawMaterialSku: '',
              costPerUnit: 0,
              subtotalCost: 0,
            });
            return;
          }
          const currentRowUnit = recipeRows[rowIndex]?.unit;
          handleUpdateRecipeRow(rowIndex, {
            rawMaterialId: found.id,
            rawMaterialName: found.name,
            rawMaterialSku: found.sku,
            unit: currentRowUnit || found.mainUnit || 'Kg',
            costPerUnit: Number(found.costPrice || 0),
          });
        };

        const handleRemoveRecipeRow = (rowIndex: number) => {
          setQtyDraftMap((prev) => {
            const nextDrafts: Record<number, string> = {};
            Object.entries(prev).forEach(([k, v]) => {
              const numKey = Number(k);
              if (numKey < rowIndex) nextDrafts[numKey] = v;
              else if (numKey > rowIndex) nextDrafts[numKey - 1] = v;
            });
            return nextDrafts;
          });
          const next = recipeRows.filter((_, idx) => idx !== rowIndex);
          onChange({
            ...value,
            rawMaterialRecipe: next,
          });
        };

        const handleApplyBomCostToProduct = () => {
          onChange({
            ...value,
            manualCostPrice: totalBomCost,
            costPerCarton: totalBomCost,
          });
          onShowFlash?.(
            tr(
              `Total BOM Cost (Rp ${totalBomCost.toLocaleString('id-ID')}) applied to Product Cost Price!`,
              `Total HPP Bahan Baku (Rp ${totalBomCost.toLocaleString('id-ID')}) berhasil diterapkan ke Harga Modal Produk!`
            )
          );
        };

        const handleSaveQuickRawMaterial = async () => {
          if (!quickAddRmModal.name.trim()) {
            onShowFlash?.(
              tr('Raw material name cannot be empty!', 'Nama bahan baku tidak boleh kosong!')
            );
            return;
          }
          setQuickAddRmModal((prev) => ({ ...prev, isSaving: true }));
          try {
            const savedRm: RawMaterialItem = await saveRawMaterialInDb({
              name: quickAddRmModal.name.trim(),
              sku: quickAddRmModal.sku.trim() || `BB-${Date.now().toString().slice(-4)}`,
              category: quickAddRmModal.category.trim() || 'BAHAN BAKU UTAMA',
              mainUnit: quickAddRmModal.mainUnit || 'Kg',
              subUnit: quickAddRmModal.mainUnit || 'Kg',
              itemsPerCarton: 1,
              stock: Math.max(0, Number(quickAddRmModal.stock) || 0),
              costPrice: Math.max(0, Number(quickAddRmModal.costPrice) || 0),
              minStock: Math.max(0, Number(quickAddRmModal.minStock) || 5),
              storageLocation: 'Gudang Bahan Baku',
              isActive: true,
              trackStockCard: true,
            });
            if (quickAddRmModal.targetRowIndex !== null) {
              handleUpdateRecipeRow(quickAddRmModal.targetRowIndex, {
                rawMaterialId: savedRm.id,
                rawMaterialName: savedRm.name,
                rawMaterialSku: savedRm.sku,
                unit: savedRm.mainUnit,
                costPerUnit: savedRm.costPrice,
              });
            }
            setQuickAddRmModal((prev) => ({ ...prev, open: false, isSaving: false }));
            onShowFlash?.(
              tr(
                `Raw material "${savedRm.name}" added & synced with /dashboard/bahan-baku!`,
                `Bahan baku "${savedRm.name}" berhasil ditambahkan & tersinkron ke /dashboard/bahan-baku!`
              )
            );
          } catch (err: any) {
            setQuickAddRmModal((prev) => ({ ...prev, isSaving: false }));
            onShowFlash?.(err?.message || 'Gagal menyimpan bahan baku baru');
          }
        };

        return (
          <div
            className={`rounded-2xl border p-5 space-y-4 transition-colors ${
              isDark
                ? 'border-amber-500/40 bg-amber-950/10'
                : 'border-amber-300 bg-amber-50/30'
            }`}
          >
            {/* Modal Quick Add Bahan Baku */}
            {quickAddRmModal.open && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
                <div
                  className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4 ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                      : 'bg-white border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between border-b pb-3 border-zinc-800">
                    <div className="flex items-center gap-2">
                      <Boxes className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold">
                        {tr('Quick Add Raw Material', 'Tambah Bahan Baku Baru (Cepat)')}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuickAddRmModal((prev) => ({ ...prev, open: false }))}
                      className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>
                        {tr('Raw Material Name *', 'Nama Bahan Baku *')}
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: Biji Kopi Arabika / Gula Cair / Botol PET"
                        value={quickAddRmModal.name}
                        onChange={(e) =>
                          setQuickAddRmModal((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className={inputBaseClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>SKU Bahan Baku</label>
                      <input
                        type="text"
                        value={quickAddRmModal.sku}
                        onChange={(e) =>
                          setQuickAddRmModal((prev) => ({ ...prev, sku: e.target.value }))
                        }
                        className={`${inputBaseClass} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{tr('Unit', 'Satuan Takaran')}</label>
                      <select
                        value={quickAddRmModal.mainUnit}
                        onChange={(e) =>
                          setQuickAddRmModal((prev) => ({ ...prev, mainUnit: e.target.value }))
                        }
                        className={inputBaseClass}
                      >
                        {['Kg', 'Gram', 'Liter', 'Ml', 'Pcs', 'Botol', 'Cup', 'Sachet', 'Karung', 'Dus', 'Pack'].map(
                          (u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>{tr('Initial Stock', 'Stok Awal Gudang')}</label>
                      <input
                        type="number"
                        min="0"
                        value={quickAddRmModal.stock}
                        onChange={(e) =>
                          setQuickAddRmModal((prev) => ({
                            ...prev,
                            stock: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className={inputBaseClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>
                        {tr('Cost per Unit (Rp)', 'Harga Modal per Satuan (Rp)')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={quickAddRmModal.costPrice}
                        onChange={(e) =>
                          setQuickAddRmModal((prev) => ({
                            ...prev,
                            costPrice: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className={inputBaseClass}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setQuickAddRmModal((prev) => ({ ...prev, open: false }))}
                      className="px-3.5 py-1.5 rounded-lg border border-zinc-700 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                    >
                      {tr('Cancel', 'Batal')}
                    </button>
                    <button
                      type="button"
                      disabled={quickAddRmModal.isSaving}
                      onClick={handleSaveQuickRawMaterial}
                      className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {quickAddRmModal.isSaving
                        ? tr('Saving...', 'Menyimpan...')
                        : tr('Save & Select', 'Simpan & Pilih')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Header Blok Bahan Baku */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-amber-500/20">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Boxes className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3
                      className={`text-xs font-black uppercase tracking-wider ${
                        isDark ? 'text-amber-300' : 'text-amber-900'
                      }`}
                    >
                      {tr(
                        'RAW MATERIAL BILL OF MATERIALS (BOM)',
                        'DAFTAR KOMPOSISI & RESEP BAHAN BAKU (BOM)'
                      )}
                    </h3>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {liveRawMaterials.length} {tr('Master Items', 'Bahan Baku Tersedia')}
                    </span>
                  </div>
                  <p className={`text-[11px] ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>
                    {tr(
                      'Synchronized live with /dashboard/bahan-baku/. Automatically calculates HPP and deducts raw material stock on sale.',
                      'Tersinkron live dengan /dashboard/bahan-baku/. Menghitung HPP otomatis & memotong stok bahan baku saat transaksi.'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setQuickAddRmModal({
                      open: true,
                      targetRowIndex: recipeRows.length > 0 ? recipeRows.length - 1 : 0,
                      name: '',
                      sku: `BB-${Date.now().toString().slice(-4)}`,
                      category: 'BAHAN BAKU UTAMA',
                      mainUnit: 'Kg',
                      stock: 25,
                      costPrice: 15000,
                      minStock: 5,
                      isSaving: false,
                    })
                  }
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{tr('+ New Raw Material', '+ Master Bahan Baku')}</span>
                </button>

                <AppLink
                  to="/dashboard/bahan-baku"
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                  <span>{tr('Open /dashboard/bahan-baku', 'Buka /dashboard/bahan-baku')}</span>
                </AppLink>
              </div>
            </div>

            {/* Daftar Baris Bahan Baku (Mirip Varian ON) */}
            {liveRawMaterials.length === 0 && (
              <div
                className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isDark
                    ? 'bg-zinc-900/80 border-amber-500/30 text-zinc-300'
                    : 'bg-white border-amber-300 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5 text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    {tr(
                      'No raw materials registered yet in /dashboard/bahan-baku/. Click "+ Master Bahan Baku" to add your first raw material.',
                      'Belum ada data di /dashboard/bahan-baku/. Klik "+ Master Bahan Baku" untuk menambahkan bahan baku pertama Anda.'
                    )}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {recipeRows.map((rRow, rIdx) => {
                const matchedRm = liveRawMaterials.find(
                  (rm) => rm.id === rRow.rawMaterialId || rm.sku === rRow.rawMaterialId
                );
                const availStock = Number(matchedRm?.stock ?? 0);
                const wastageMultiplier =
                  1 + Math.max(0, Number(rRow.wastagePercent || 0)) / 100;
                const rowSubtotal = computeBomRowSubtotalCost(rRow);
                const warehouseUnit = matchedRm?.mainUnit || 'Kg';
                const rawUnitVal = String(rRow.unit || matchedRm?.mainUnit || 'Kg').trim();
                const normalizedSelectUnit =
                  rawUnitVal.toLowerCase() === 'ml'
                    ? 'ml'
                    : rawUnitVal.toLowerCase() === 'gr' || rawUnitVal.toLowerCase() === 'g'
                    ? 'Gram'
                    : BOM_RECIPE_UNITS.find(
                        (u) => u.toLowerCase() === rawUnitVal.toLowerCase()
                      ) || rawUnitVal;

                const reqWarehouseQty =
                  convertRecipeQtyToWarehouseUnit(
                    Number(rRow.qtyPerUnit || 0),
                    normalizedSelectUnit,
                    warehouseUnit
                  ) * wastageMultiplier;
                const isStockSufficient =
                  !rRow.rawMaterialId || availStock >= reqWarehouseQty;

                const displayedQty =
                  qtyDraftMap[rIdx] !== undefined
                    ? qtyDraftMap[rIdx]
                    : rRow.qtyPerUnit !== undefined && rRow.qtyPerUnit !== null
                    ? String(rRow.qtyPerUnit)
                    : '';

                return (
                  <div
                    key={`bom-row-${rIdx}`}
                    className={`rounded-xl border p-4 transition-colors ${
                      isDark
                        ? 'bg-zinc-900/90 border-zinc-800'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          {tr('RAW MATERIAL', 'BAHAN BAKU')} #{rIdx + 1}
                        </span>
                        {matchedRm && (
                          <span
                            className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${
                              isStockSufficient
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                            }`}
                          >
                            {tr('Warehouse Stock:', 'Stok Gudang:')} {availStock}{' '}
                            {matchedRm.mainUnit}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveRecipeRow(rIdx)}
                        className="p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white transition cursor-pointer"
                        title={tr('Remove Raw Material', 'Hapus Bahan Baku')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      {/* Pilih Bahan Baku dari /dashboard/bahan-baku/ */}
                      <div className="md:col-span-4">
                        <label className={labelClass}>
                          {tr('Select Raw Material', 'Pilih Bahan Baku')} *
                        </label>
                        <select
                          value={rRow.rawMaterialId || ''}
                          onChange={(e) => handleSelectRawMaterial(rIdx, e.target.value)}
                          className={`${inputBaseClass} cursor-pointer`}
                        >
                          <option value="">
                            {tr('-- Select Raw Material --', '-- Pilih Bahan Baku --')}
                          </option>
                          {liveRawMaterials.map((rm) => (
                            <option key={rm.id} value={rm.id}>
                              {rm.name} ({rm.sku}) — Stok: {rm.stock} {rm.mainUnit} @ Rp{' '}
                              {Number(rm.costPrice || 0).toLocaleString('id-ID')}
                            </option>
                          ))}
                          <option value="__QUICK_ADD_RM__">
                            {tr('+ Add New Raw Material...', '+ Tambah Bahan Baku Baru...')}
                          </option>
                        </select>
                      </div>

                      {/* Takaran / Qty Pemakaian per 1 Produk (Fleksibel angka bulat & desimal) */}
                      <div className="md:col-span-2">
                        <label className={labelClass}>
                          {tr('Usage Qty', 'Takaran Pakai')}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={displayedQty}
                          onChange={(e) => {
                            const rawStr = e.target.value;
                            setQtyDraftMap((prev) => ({ ...prev, [rIdx]: rawStr }));
                            const parsedNum =
                              rawStr.trim() === ''
                                ? 0
                                : Math.max(0, parseFloat(rawStr.replace(',', '.')) || 0);
                            handleUpdateRecipeRow(rIdx, {
                              qtyPerUnit: parsedNum,
                            });
                          }}
                          onBlur={() => {
                            setQtyDraftMap((prev) => {
                              const copy = { ...prev };
                              delete copy[rIdx];
                              return copy;
                            });
                          }}
                          className={`${inputBaseClass} font-mono`}
                        />
                      </div>

                      {/* Satuan (Dropdown Pilihan Satuan) */}
                      <div className="md:col-span-2">
                        <label className={labelClass}>{tr('Unit', 'Satuan')}</label>
                        <select
                          value={normalizedSelectUnit}
                          onChange={(e) =>
                            handleUpdateRecipeRow(rIdx, { unit: e.target.value })
                          }
                          className={`${inputBaseClass} cursor-pointer`}
                        >
                          {!BOM_RECIPE_UNITS.some(
                            (u) => u.toLowerCase() === normalizedSelectUnit.toLowerCase()
                          ) && (
                            <option value={normalizedSelectUnit}>
                              {normalizedSelectUnit}
                            </option>
                          )}
                          {BOM_RECIPE_UNITS.map((unitOpt) => (
                            <option key={unitOpt} value={unitOpt}>
                              {unitOpt}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Harga Modal per Unit Bahan Baku */}
                      <div className="md:col-span-2">
                        <label className={labelClass}>
                          {tr('Unit Cost', 'Modal / Satuan')}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={toDisplayValue(Number(rRow.costPerUnit || 0))}
                          onChange={(e) =>
                            handleUpdateRecipeRow(rIdx, {
                              costPerUnit: parseInputToIdr(e.target.value),
                            })
                          }
                          className={`${inputBaseClass} font-mono`}
                        />
                      </div>

                      {/* Subtotal HPP */}
                      <div className="md:col-span-2">
                        <label className={labelClass}>
                          {tr('Subtotal HPP', 'Subtotal HPP')}
                        </label>
                        <input
                          type="text"
                          readOnly
                          disabled
                          value={`Rp ${toDisplayValue(rowSubtotal).toLocaleString('id-ID')}`}
                          className={`${disabledInputClass} font-mono font-bold`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer Aksi & Ringkasan HPP Bahan Baku */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-2 border-t border-amber-500/20">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddRecipeRow}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>{tr('Add Raw Material Row', 'Tambah Bahan Baku')}</span>
                </button>

                <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={value.autoDeductRawMaterial !== false}
                    onChange={(e) =>
                      updateField('autoDeductRawMaterial', e.target.checked)
                    }
                    className="rounded border-zinc-600 text-amber-500 focus:ring-amber-500"
                  />
                  <span className={isDark ? 'text-zinc-300' : 'text-slate-700'}>
                    {tr(
                      'Auto-deduct raw material stock when product is sold',
                      'Potong stok bahan baku otomatis saat produk terjual'
                    )}
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-200'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{tr('Est. Max Production:', 'Kapasitas Produksi:')}</span>
                  <span className="font-mono font-black text-emerald-400">
                    {maxProducibleUnits.toLocaleString('id-ID')} {value.mainUnit || 'Produk'}
                  </span>
                </div>

                <div
                  className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                    isDark
                      ? 'bg-zinc-900 border-amber-500/30 text-amber-200'
                      : 'bg-white border-amber-300 text-amber-900'
                  }`}
                >
                  <Calculator className="w-4 h-4 text-amber-400" />
                  <span>{tr('Total BOM HPP:', 'Total HPP Bahan Baku:')}</span>
                  <span className="font-mono text-sm font-black text-amber-400">
                    Rp {toDisplayValue(totalBomCost).toLocaleString('id-ID')}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleApplyBomCostToProduct}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                  title={tr(
                    'Copy Total BOM HPP into Product Cost Price',
                    'Salin Total HPP Bahan Baku ke Harga Modal Produk'
                  )}
                >
                  <Calculator className="w-3.5 h-3.5" />
                  <span>
                    {tr('Use as Product Cost Price', 'Terapkan ke Harga Modal')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Blok Border Biru (Tampil hanya jika Jual Satuan ON) */}
      {value.sellByUnit && (
        <div
          className={`rounded-xl border p-5 transition-colors ${
            isDark
              ? 'border-blue-500/30 bg-blue-950/10'
              : 'border-blue-200 bg-blue-50/20'
          }`}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-4">
            {!value.hasRawMaterials && (
              <div>
                <label translate="no" className={`${labelClass} notranslate`}>
                  {t('product.piecesInOneCarton', 'Produk(Pcs)')}
                </label>
                <input
                  type="number"
                  min="1"
                  value={value.itemsPerCarton}
                  onChange={(e) => handleIsiChange(e.target.value)}
                  className={`${inputBaseClass} notranslate`}
                />
              </div>
            )}

            <div>
              <label className={labelClass}>
                {t('product.cartonSellingPrice', 'Harga Jual 1 Dus / Karton')}
              </label>
              <input
                type="number"
                min="0"
                value={toDisplayValue(effectiveSellPrice)}
                onChange={(e) => handleSellPriceChange(e.target.value)}
                className={`${inputBaseClass} notranslate`}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.mainUnitCost', 'Harga Modal 1 Dus / Karton')}
              </label>
              <input
                type="number"
                min="0"
                value={toDisplayValue(effectiveCostPrice)}
                onChange={(e) => {
                  const parsed = parseInputToIdr(e.target.value);
                  onChange({
                    ...value,
                    costPerCarton: parsed,
                    manualCostPrice: parsed,
                  });
                }}
                className={`${inputBaseClass} notranslate`}
              />
            </div>

            {/* Row 2: Harga Jual Eceran / Pcs (Otomatis) | Modal Eceran / Pcs (Otomatis) | Stok (Jumlah Dus / Karton) */}
            <div>
              <label className={labelClass}>
                {t('product.autoUnitSellingPrice', 'Harga Jual Eceran / Pcs (Otomatis)')}
              </label>
              <input
                type="number"
                disabled
                readOnly
                value={toDisplayValue(autoUnitSellPrice)}
                className={`${disabledInputClass} notranslate`}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.autoUnitCostPrice', 'Harga Modal Eceran / Pcs (Otomatis)')}
              </label>
              <input
                type="number"
                disabled
                readOnly
                value={toDisplayValue(autoUnitCostPrice)}
                className={`${disabledInputClass} notranslate`}
              />
            </div>

            {!value.hasRawMaterials && (
              <div>
                <label className={labelClass}>
                  {t('product.mainUnitStock', 'Stok (Jumlah Dus / Karton)')}
                </label>
                <input
                  type="number"
                  min="0"
                  value={effectiveStock}
                  onChange={(e) => {
                    const nextStk = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    onChange({
                      ...value,
                      mainUnitStock: nextStk,
                      manualStock: nextStk,
                      subUnitStock: nextStk * safeIsi,
                    });
                  }}
                  className={`${inputBaseClass} notranslate`}
                />
              </div>
            )}

            {/* Row 3: Total Pcs Tersedia | Satuan Grosir (Dus / Karton) | Satuan Eceran (Pcs / Botol) */}
            <div>
              <label className={labelClass}>
                {t('product.unitStock', 'Total Pcs Tersedia (Otomatis: Stok Dus × Isi per Dus)')}
              </label>
              <input
                type="number"
                disabled
                readOnly
                value={totalItemsInStock}
                className={`${disabledInputClass} notranslate`}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.mainUnitLabel', 'Satuan Grosir (Dus / Karton)')}
              </label>
              <select
                value={value.mainUnit}
                onChange={(e) => updateField('mainUnit', e.target.value)}
                className={`${inputBaseClass} cursor-pointer`}
              >
                {MAIN_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {translateUnit(u)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                {t('product.subUnitLabel', 'Satuan Eceran (Pcs / Botol)')}
              </label>
              <select
                value={value.subUnit}
                onChange={(e) => updateField('subUnit', e.target.value)}
                className={`${inputBaseClass} cursor-pointer`}
              >
                {SUB_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {translateUnit(u)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Indikator Total Berat per Varian jika di dalam kartu Varian */}
      {isVariant && (
        <div className="flex justify-end pt-1">
          <div
            className={`px-3.5 py-2 rounded-lg border text-xs font-bold flex items-center gap-2 ${
              isDark
                ? 'bg-zinc-900/90 border-zinc-800 text-zinc-200'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            <span>{t('product.totalWeightKg', 'Total Berat ( kg )')} :</span>
            <span className="font-mono font-extrabold text-blue-400">
              {totalBeratKg} kg
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
