import React, { useRef } from 'react';
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
} from 'lucide-react';
import { compressImageFile } from '../../utils/imageCompress';
import { useLanguage } from '../../context/LanguageContext';
import { evaluateProductExpiry } from '../../utils/expiryUtils';

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
  productionDate?: string;
  expiryDate?: string;
  imageUrl?: string;
  galleryImages?: string[];
}

export function computeEffectiveFields(val: ProductFormFieldsValue) {
  const safeIsi = Math.max(1, Math.floor(Number(val.itemsPerCarton) || 1));
  const safeWeightMl = Math.max(0, Number(val.weightMl) || 0);
  const totalBeratKg = Number(((safeWeightMl * safeIsi) / 1000).toFixed(3));
  const baseSellPrice = Math.max(
    0,
    Number(val.manualSellPrice) || Number(val.pricePerCarton) || 0
  );
  const basePwaPrice =
    val.pwaPrice !== undefined && Number(val.pwaPrice) > 0
      ? Math.max(0, Number(val.pwaPrice))
      : baseSellPrice;
  const baseCostPrice = Math.max(
    0,
    Number(val.manualCostPrice) || Number(val.costPerCarton) || 0
  );
  const autoUnitSellPrice = Math.round(baseSellPrice / safeIsi);
  const autoUnitCostPrice = Math.round(baseCostPrice / safeIsi);
  const mainStk = Math.max(0, Math.floor(Number(val.mainUnitStock) || 0));
  const subStk = Math.max(0, Math.floor(Number(val.subUnitStock) || 0));
  const manualStk = Math.max(0, Math.floor(Number(val.manualStock) || 0));
  const calculatedTotalStock = manualStk > 0 ? manualStk : mainStk + subStk;

  const effectiveCostPrice = baseCostPrice;
  const effectiveSellPrice = baseSellPrice;
  const effectivePwaPrice = basePwaPrice;
  const effectiveStock = manualStk > 0 ? manualStk : mainStk;
  const effectivePricePerCarton = effectiveSellPrice;
  const effectiveCostPerCarton = effectiveCostPrice;
  const stockInCartons = Number((effectiveStock / safeIsi).toFixed(2));

  return {
    safeIsi,
    safeWeightMl,
    totalBeratKg,
    autoUnitSellPrice,
    autoUnitCostPrice,
    calculatedTotalStock,
    effectiveCostPrice,
    effectiveSellPrice,
    effectivePwaPrice,
    effectiveStock,
    stockInCartons,
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

  const {
    safeIsi,
    totalBeratKg,
    autoUnitSellPrice,
    autoUnitCostPrice,
    calculatedTotalStock,
    effectiveCostPrice,
    effectiveSellPrice,
    effectivePwaPrice,
    effectiveStock,
    stockInCartons,
  } = computeEffectiveFields(value);

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
    if (value.sellByUnit) {
      onChange({
        ...value,
        manualCostPrice:
          value.manualCostPrice > 0
            ? value.manualCostPrice
            : value.costPerCarton > 0
            ? value.costPerCarton
            : autoUnitCostPrice,
        manualSellPrice:
          value.manualSellPrice > 0
            ? value.manualSellPrice
            : value.pricePerCarton > 0
            ? value.pricePerCarton
            : autoUnitSellPrice,
        manualStock:
          value.manualStock > 0
            ? value.manualStock
            : value.mainUnitStock > 0
            ? value.mainUnitStock
            : calculatedTotalStock,
        sellByUnit: false,
      });
    } else {
      const nextPricePerCarton =
        value.pricePerCarton === 0 && value.manualSellPrice > 0
          ? value.manualSellPrice
          : value.pricePerCarton;
      const nextCostPerCarton =
        value.costPerCarton === 0 && value.manualCostPrice > 0
          ? value.manualCostPrice
          : value.costPerCarton;
      const nextMainStock =
        value.mainUnitStock === 0 && value.manualStock > 0
          ? value.manualStock
          : value.mainUnitStock;

      onChange({
        ...value,
        pricePerCarton: nextPricePerCarton,
        costPerCarton: nextCostPerCarton,
        mainUnitStock: nextMainStock,
        subUnitStock: 0,
        sellByUnit: true,
      });
    }
  };

  const handleIsiChange = (rawVal: string) => {
    const parsed = Math.max(1, Math.floor(Number(rawVal) || 1));
    updateField('itemsPerCarton', parsed);
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
              placeholder={tr('Auto or custom SKU (e.g. P1001-V1)', 'SKU otomatis atau manual')}
              value={value.sku || ''}
              onChange={(e) => updateField('sku', e.target.value)}
              className={`${inputBaseClass} font-mono`}
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
              placeholder={tr('Enter SKU or Barcode (e.g. BRG-001)', 'Masukkan kode SKU atau Barcode')}
              value={value.sku || ''}
              onChange={(e) => updateField('sku', e.target.value)}
              className={`${inputBaseClass} font-mono`}
            />
          </div>
        ) : (
          <div>
            <label className={labelClass}>{t('product.costPrice', 'Harga Modal (HPP)')}</label>
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
            <label className={labelClass}>{t('product.costPrice', 'Harga Modal (HPP)')}</label>
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
          <label className={labelClass}>{t('product.sellingPrice', 'Harga Jual POS')}</label>
          <input
            type="number"
            min="0"
            value={toDisplayValue(effectiveSellPrice)}
            onChange={(e) => {
              const parsed = parseInputToIdr(e.target.value);
              const shouldSyncPwa =
                !value.pwaPrice || value.pwaPrice === value.manualSellPrice;
              onChange({
                ...value,
                manualSellPrice: parsed,
                pricePerCarton: parsed,
                pwaPrice: shouldSyncPwa ? parsed : value.pwaPrice,
              });
            }}
            className={inputBaseClass}
          />
        </div>

        {/* Row 3: Harga Online PWA | Komisi Pengirim */}
        <div>
          <label className={labelClass}>
            {tr('Online PWA Price', 'Harga Online PWA')}
          </label>
          <input
            type="number"
            min="0"
            value={toDisplayValue(effectivePwaPrice)}
            onChange={(e) => {
              const parsed = parseInputToIdr(e.target.value);
              updateField('pwaPrice', parsed);
            }}
            className={inputBaseClass}
          />
        </div>

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
          <label className={labelClass}>{t('product.brand', 'Brand / Merek')}</label>
          <select
            value={value.brand}
            onChange={(e) => handleSelectMaster('brand', e.target.value)}
            className={`${inputBaseClass} cursor-pointer`}
          >
            <option value="">{t('product.selectBrand', 'Pilih brand')}</option>
            {value.brand && !brands.some((b) => b.toLowerCase() === value.brand.toLowerCase()) && (
              <option value={value.brand} data-no-translate="true">
                {value.brand}
              </option>
            )}
            {brands.map((b, idx) => (
              <option key={`fld-brand-${b}-${idx}`} value={b} data-no-translate="true">
                {b}
              </option>
            ))}
            <option value={ADD_NEW_VALUE}>
              {t('common.addNewOption', '+ Tambah baru...')}
            </option>
          </select>
        </div>

        {/* Row 5: Stok | Berat/Item (ml) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`text-xs font-medium ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
              {t('product.stock', 'Stok Fisik')}
            </label>
            <span className="text-[10px] font-mono font-bold text-emerald-400">
              {tr('Carton Eq:', 'Stok Dus:')} {stockInCartons} {value.mainUnit || 'Dus'}
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
              });
            }}
            className={inputBaseClass}
          />
        </div>

        <div>
          <label className={labelClass}>{t('product.weightMl', 'Berat/Item (ml)')}</label>
          <input
            type="number"
            min="0"
            value={value.weightMl}
            onChange={(e) =>
              updateField('weightMl', Math.max(0, Number(e.target.value) || 0))
            }
            className={inputBaseClass}
          />
        </div>

        {/* Row 6: Isi 1 Dus | Penyimpanan */}
        <div>
          <label className={labelClass}>
            {t('product.itemsPerCarton', 'Isi 1 Dus (Pcs / Karton)')}
          </label>
          <input
            type="number"
            min="1"
            value={value.itemsPerCarton}
            onChange={(e) => handleIsiChange(e.target.value)}
            className={inputBaseClass}
          />
        </div>

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
            placeholder={tr('e.g. BATCH-2026-01', 'Contoh: BATCH-2026-01')}
            value={value.batchCode || ''}
            onChange={(e) => updateField('batchCode', e.target.value)}
            className={`${inputBaseClass} font-mono`}
          />
        </div>

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
      </div>

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
            {/* Row 1: Isi 1 Dus | Harga Jual 1 Dus | Modal Unit Utama */}
            <div>
              <label className={labelClass}>
                {t('product.piecesInOneCarton', 'Isi 1 Dus')}
              </label>
              <input
                type="number"
                min="1"
                value={value.itemsPerCarton}
                onChange={(e) => handleIsiChange(e.target.value)}
                className={inputBaseClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.cartonSellingPrice', 'Harga Jual 1 Dus')}
              </label>
              <input
                type="number"
                min="0"
                value={toDisplayValue(effectiveSellPrice)}
                onChange={(e) => {
                  const parsed = parseInputToIdr(e.target.value);
                  onChange({
                    ...value,
                    pricePerCarton: parsed,
                    manualSellPrice: parsed,
                  });
                }}
                className={inputBaseClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.mainUnitCost', 'Modal Unit Utama')}
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
                className={inputBaseClass}
              />
            </div>

            {/* Row 2: Harga Jual Satuan (Otomatis) | Modal Satuan (Otomatis) | Stok Unit Utama */}
            <div>
              <label className={labelClass}>
                {t('product.autoUnitSellingPrice', 'Harga Jual Satuan (Otomatis)')}
              </label>
              <input
                type="number"
                disabled
                readOnly
                value={toDisplayValue(autoUnitSellPrice)}
                className={disabledInputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.autoUnitCostPrice', 'Modal Satuan (Otomatis)')}
              </label>
              <input
                type="number"
                disabled
                readOnly
                value={toDisplayValue(autoUnitCostPrice)}
                className={disabledInputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.mainUnitStock', 'Stok Unit Utama')}
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
                  });
                }}
                className={inputBaseClass}
              />
            </div>

            {/* Row 3: Stok Satuan | Produk Unit | Unit Satuan */}
            <div>
              <label className={labelClass}>
                {t('product.unitStock', 'Stok Satuan')}
              </label>
              <input
                type="number"
                min="0"
                value={value.subUnitStock}
                onChange={(e) =>
                  updateField(
                    'subUnitStock',
                    Math.max(0, Math.floor(Number(e.target.value) || 0))
                  )
                }
                className={inputBaseClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                {t('product.mainUnitLabel', 'Produk Unit')}
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
                {t('product.subUnitLabel', 'Unit Satuan')}
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
