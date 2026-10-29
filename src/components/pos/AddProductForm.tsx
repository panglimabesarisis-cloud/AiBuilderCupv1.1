import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Check,
  Package,
  Sun,
  Moon,
  RotateCcw,
  Image as ImageIcon,
  Upload,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Save,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  Link as LinkIcon,
  Edit3,
} from 'lucide-react';
import {
  saveProductDocToAllPaths,
  getJsonByteSize,
  MAX_PRODUCT_DOC_BYTES,
  PHOTO_TOO_LARGE_MESSAGE,
} from '../../services/productService';
import { ProductGroupItem, ProductVariantItem } from './ProductCartonManager';
import { ACTIVE_STORE_ID } from '../../config/store';
import { useLanguage, USD_TO_IDR_RATE } from '../../context/LanguageContext';
import {
  useCategories,
  useBrands,
  useStorageLocations,
  addCategory,
  addBrand,
  addStorageLocation,
} from '../../services/masterDataService';
import {
  ProductFormFields,
  ProductFormFieldsValue,
  computeEffectiveFields,
  ADD_NEW_VALUE,
  isPwaPriceLinked,
} from './ProductFormFields';
import { compressImageFile } from '../../utils/imageCompress';
import { normalizeToInputDate } from '../../utils/expiryUtils';
import { getDefaultMinStock, generateSku } from '../../services/posRuntime';
import {
  computeBomRowSubtotalCost,
  computeBomTotalWeightKg,
} from '../../services/rawMaterialService';

interface AddProductFormProps {
  isDark: boolean;
  onBack: () => void;
  onSubmit: (product: ProductGroupItem) => void;
  onToggleTheme: (theme: 'dark' | 'light') => void;
  onSaveAndAddAnother?: (product: ProductGroupItem) => void;
  initialProduct?: any;
}

function deriveInitialFieldValues(src: any, fallbackGroup?: any): ProductFormFieldsValue {
  const isi = Math.max(
    1,
    Number(
      src?.isiPerDus ??
        src?.piecesPerCarton ??
        src?.itemsPerCarton ??
        fallbackGroup?.isiPerDus ??
        fallbackGroup?.piecesPerCarton ??
        fallbackGroup?.itemsPerCarton ??
        1
    )
  );
  // Stok = Jumlah Carton
  const stk = Math.max(
    0,
    Math.floor(Number(src?.stock ?? src?.stockInUnits ?? src?.totalStock ?? 0))
  );
  // Harga Modal & Harga Jual = Harga 1 Carton (bukan 1 item)
  const uCost = Number(
    src?.costPerCarton ?? src?.costPrice ?? src?.costPerUnit ?? 0
  );
  const uSell = Number(
    src?.pricePerCarton ?? src?.posPrice ?? src?.sellPrice ?? src?.pricePerUnit ?? src?.price ?? 0
  );
  const uPwa = Number(
    src?.pwaPrice ?? uSell
  );
  const pCarton = uSell;
  const cCarton = uCost;

  const groupPrefix = (src?.groupName || fallbackGroup?.groupName || fallbackGroup?.name || '').trim();
  const rawName = (src?.name || '').trim();
  const initialName = fallbackGroup
    ? src?.variantName?.trim() ||
      (groupPrefix && rawName.toLowerCase().startsWith(groupPrefix.toLowerCase() + ' ')
        ? rawName.slice(groupPrefix.length).trim()
        : rawName)
    : rawName;

  const gallery = Array.isArray(src?.galleryUrls)
    ? src.galleryUrls
    : Array.isArray(src?.galleryImages)
    ? src.galleryImages
    : [];

  return {
    id: src?.id || 'vrow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    docId: src?.docId || src?.id,
    sku: src?.sku || fallbackGroup?.sku || '',
    description: src?.description || fallbackGroup?.description || '',
    batchCode:
      src?.batchCode ||
      src?.batches?.[0]?.batchCode ||
      fallbackGroup?.batchCode ||
      fallbackGroup?.batches?.[0]?.batchCode ||
      '',
    pwaPrice: uPwa,
    // Produk baru: otomatis ikut Harga Jual. Edit: ikut jika PWA tersimpan kosong/0 atau sama dengan Harga Jual
    pwaPriceLinked: isPwaPriceLinked(uPwa, uSell),
    variantType: src?.variantType || 'Rasa',
    name: initialName,
    category: src?.category || fallbackGroup?.category || '',
    brand: src?.brand !== undefined ? src.brand : (fallbackGroup?.brand || ''),
    storageLocation:
      src?.shelfLocation ||
      src?.storageLocation ||
      fallbackGroup?.shelfLocation ||
      fallbackGroup?.storageLocation ||
      '',
    weightMl: Number(
      src?.beratPerItem ?? src?.weightMl ?? fallbackGroup?.beratPerItem ?? fallbackGroup?.weightMl ?? 0
    ),
    deliveryCommission: Number(
      src?.deliveryCommission ?? fallbackGroup?.deliveryCommission ?? 0
    ),
    itemsPerCarton: isi,
    pricePerCarton: pCarton,
    costPerCarton: cCarton,
    mainUnitStock: stk,
    subUnitStock: stk * isi,
    mainUnit: src?.mainUnit || fallbackGroup?.mainUnit || 'Dus',
    subUnit: src?.subUnit || fallbackGroup?.subUnit || 'Unit',
    manualCostPrice: uCost,
    manualSellPrice: uSell,
    manualStock: stk,
    isActive: src ? src.isActive !== false : true,
    sellByUnit: src ? Boolean(src.sellByUnit) : false,
    isPosVisible: src ? src.isPosVisible !== false : true,
    isPwaVisible: src ? src.isPwaVisible !== false : true,
    trackStockCard: src ? src.trackStockCard !== false : true,
    hasRawMaterials: Boolean(
      src?.hasRawMaterials ??
        fallbackGroup?.hasRawMaterials ??
        (Array.isArray(src?.rawMaterialRecipe) && src.rawMaterialRecipe.length > 0)
    ),
    autoDeductRawMaterial:
      (src?.autoDeductRawMaterial ?? fallbackGroup?.autoDeductRawMaterial) !== false,
    rawMaterialRecipe: (
      Array.isArray(src?.rawMaterialRecipe)
        ? src.rawMaterialRecipe
        : Array.isArray(fallbackGroup?.rawMaterialRecipe)
        ? fallbackGroup.rawMaterialRecipe
        : []
    ).map((r: any) => ({
      ...r,
      subtotalCost: computeBomRowSubtotalCost(r),
    })),
    productionDate: normalizeToInputDate(
      src?.productionDate ??
        src?.tanggalProduksi ??
        fallbackGroup?.productionDate ??
        fallbackGroup?.tanggalProduksi ??
        ''
    ),
    expiryDate: normalizeToInputDate(
      src?.expiryDate ??
        src?.tanggalKadaluarsa ??
        fallbackGroup?.expiryDate ??
        fallbackGroup?.tanggalKadaluarsa ??
        ''
    ),
    imageUrl: src?.imageUrl || '',
    galleryImages: gallery,
  };
}

export const AddProductForm: React.FC<AddProductFormProps> = ({
  isDark,
  onBack,
  onSubmit,
  onToggleTheme,
  initialProduct,
}) => {
  const { language, t, tr, currencyMode, translateCategory, translateVariant } = useLanguage();
  const isEditMode = Boolean(initialProduct);

  const categories = useCategories();
  const brands = useBrands();
  const storageLocations = useStorageLocations();

  const toDisplayValue = (valInIdr: number): number => {
    if (currencyMode === 'USD') {
      const usd = (Number(valInIdr) || 0) / USD_TO_IDR_RATE;
      return Number(usd.toFixed(2));
    }
    return Math.round(Number(valInIdr) || 0);
  };

  const parseInputToIdr = (displayVal: number | string): number => {
    const num = Number(displayVal) || 0;
    if (currencyMode === 'USD') {
      return Math.round(num * USD_TO_IDR_RATE);
    }
    return Math.round(num);
  };

  // Main form state (used directly for standalone product, and header fields when Varian is ON)
  const [mainFields, setMainFields] = useState<ProductFormFieldsValue>(() => {
    const derived = deriveInitialFieldValues(initialProduct);
    return {
      ...derived,
      sku: initialProduct?.sku || derived.sku || generateSku(),
    };
  });
  const [sku, setSku] = useState<string>(
    initialProduct?.sku || generateSku()
  );
  const [minStockAlert, setMinStockAlert] = useState<number>(
    Number(initialProduct?.minStockAlert ?? initialProduct?.minStock ?? getDefaultMinStock())
  );
  const [hasVariants, setHasVariants] = useState<boolean>(
    Boolean(initialProduct?.hasVariants)
  );

  const createVariantRowFromMain = (
    sourceMain: ProductFormFieldsValue
  ): ProductFormFieldsValue => {
    const safeIsi = Math.max(1, Number(sourceMain.itemsPerCarton) || 1);
    const safeStk = Math.max(0, Number(sourceMain.mainUnitStock ?? sourceMain.manualStock) || 0);
    return {
      id: 'vrow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      variantType: 'Rasa',
      name: '',
      sku: '',
      description: sourceMain.description || '',
      batchCode: sourceMain.batchCode || '',
      pwaPrice: Number(sourceMain.pwaPrice ?? sourceMain.manualSellPrice) || 0,
      pwaPriceLinked: sourceMain.pwaPriceLinked !== false,
      category: sourceMain.category || '',
      brand: sourceMain.brand || '',
      storageLocation: sourceMain.storageLocation || '',
      weightMl: Number(sourceMain.weightMl) || 0,
      deliveryCommission: Number(sourceMain.deliveryCommission) || 0,
      itemsPerCarton: safeIsi,
      pricePerCarton: Number(sourceMain.pricePerCarton || sourceMain.manualSellPrice) || 0,
      costPerCarton: Number(sourceMain.costPerCarton || sourceMain.manualCostPrice) || 0,
      mainUnitStock: safeStk,
      subUnitStock: safeStk * safeIsi,
      mainUnit: sourceMain.mainUnit || 'Dus',
      subUnit: sourceMain.subUnit || 'Unit',
      manualCostPrice: Number(sourceMain.manualCostPrice || sourceMain.costPerCarton) || 0,
      manualSellPrice: Number(sourceMain.manualSellPrice || sourceMain.pricePerCarton) || 0,
      manualStock: safeStk,
      isActive: true,
      sellByUnit: false,
      isPosVisible: true,
      isPwaVisible: true,
      trackStockCard: true,
      hasRawMaterials: Boolean(sourceMain.hasRawMaterials),
      autoDeductRawMaterial: sourceMain.autoDeductRawMaterial !== false,
      rawMaterialRecipe: Array.isArray(sourceMain.rawMaterialRecipe)
        ? [...sourceMain.rawMaterialRecipe]
        : [],
      productionDate: sourceMain.productionDate || '',
      expiryDate: sourceMain.expiryDate || '',
      imageUrl: '',
      galleryImages: [],
    };
  };

  const [variantRows, setVariantRows] = useState<ProductFormFieldsValue[]>(() => {
    if (
      initialProduct?.hasVariants &&
      Array.isArray(initialProduct?.variants) &&
      initialProduct.variants.length > 0
    ) {
      return initialProduct.variants.map((v: any, idx: number) => ({
        ...deriveInitialFieldValues(v, initialProduct),
        id: v.id || `vrow_init_${idx}`,
      }));
    }
    const initMain = deriveInitialFieldValues(initialProduct);
    return [
      {
        ...createVariantRowFromMain(initMain),
        id: 'vrow_1',
      },
    ];
  });

  // Accordion open state: targeted variant or newest variant open by default
  const [openVariantIds, setOpenVariantIds] = useState<Record<string, boolean>>(() => {
    if (initialProduct?.editingVariantId) {
      const targetRow = variantRows.find(
        (r) =>
          r.id === initialProduct.editingVariantId ||
          r.docId === initialProduct.editingVariantId ||
          r.sku === initialProduct.editingVariantId
      );
      if (targetRow?.id) {
        return { [targetRow.id]: true };
      }
    }
    const lastRow = variantRows[variantRows.length - 1];
    return lastRow?.id ? { [lastRow.id]: true } : { vrow_1: true };
  });

  // Foto Utama (main photo & fallback for variants)
  const [uploadedImage, setUploadedImage] = useState<string | null>(
    initialProduct?.imageUrl || initialProduct?.variants?.[0]?.imageUrl || null
  );
  const [uploadedImageName, setUploadedImageName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mainGalleryInputRef = useRef<HTMLInputElement | null>(null);

  // Flash message
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const showFlash = (msg: string) => {
    setFlashMessage(msg);
    setTimeout(() => setFlashMessage(null), 3000);
  };

  // Add new master data modal state
  const [addMasterModal, setAddMasterModal] = useState<{
    type: 'category' | 'brand' | 'storage' | null;
    value: string;
    isSaving: boolean;
    variantRowId?: string | null;
  }>({ type: null, value: '', isSaving: false, variantRowId: null });

  // Sync state when initialProduct changes (Edit mode)
  useEffect(() => {
    if (initialProduct) {
      const derived = deriveInitialFieldValues(initialProduct);
      const resolvedSku =
        initialProduct.sku ||
        derived.sku ||
        generateSku();
      setMainFields({
        ...derived,
        name: initialProduct.groupName || initialProduct.name || '',
        sku: resolvedSku,
      });
      setSku(resolvedSku);
      setMinStockAlert(
        Number(initialProduct.minStockAlert ?? initialProduct.minStock ?? getDefaultMinStock())
      );
      setHasVariants(Boolean(initialProduct.hasVariants && !initialProduct.hasRawMaterials));
      setUploadedImage(
        initialProduct.imageUrl || initialProduct.variants?.[0]?.imageUrl || null
      );

      if (
        initialProduct.hasVariants &&
        Array.isArray(initialProduct.variants) &&
        initialProduct.variants.length > 0
      ) {
        const mapped = initialProduct.variants.map((v: any, idx: number) => ({
          ...deriveInitialFieldValues(v, initialProduct),
          id: v.id || `vrow_init_${idx}`,
        }));
        setVariantRows(mapped);
        if (initialProduct.editingVariantId) {
          const targetRow = mapped.find(
            (r: ProductFormFieldsValue) =>
              r.id === initialProduct.editingVariantId ||
              r.docId === initialProduct.editingVariantId ||
              r.sku === initialProduct.editingVariantId
          );
          if (targetRow?.id) {
            setOpenVariantIds({ [targetRow.id]: true });
            return;
          }
        }
        const last = mapped[mapped.length - 1];
        if (last?.id) {
          setOpenVariantIds({ [last.id]: true });
        }
      }
    }
  }, [initialProduct]);

  // Propagate main card category/brand/storageLocation changes to variants that haven't overridden them
  const updateMainSharedField = (
    field: 'category' | 'brand' | 'storageLocation',
    newVal: string
  ) => {
    const prevVal = mainFields[field];
    setMainFields((prev) => ({ ...prev, [field]: newVal }));
    setVariantRows((prev) =>
      prev.map((r) =>
        !r[field] || r[field] === prevVal ? { ...r, [field]: newVal } : r
      )
    );
  };

  const handleToggleHasVariants = () => {
    if (!hasVariants) {
      setVariantRows((prev) => {
        if (prev.length === 0) {
          const newRow = createVariantRowFromMain(mainFields);
          setOpenVariantIds({ [newRow.id!]: true });
          return [newRow];
        }
        if (prev.length === 1 && !prev[0].name.trim()) {
          const updatedFirst: ProductFormFieldsValue = {
            ...createVariantRowFromMain(mainFields),
            id: prev[0].id || 'vrow_1',
            category: prev[0].category || mainFields.category || '',
            brand: prev[0].brand || mainFields.brand || '',
            storageLocation:
              prev[0].storageLocation || mainFields.storageLocation || '',
          };
          setOpenVariantIds({ [updatedFirst.id!]: true });
          return [updatedFirst];
        }
        const last = prev[prev.length - 1];
        if (last?.id) {
          setOpenVariantIds({ [last.id]: true });
        }
        return prev;
      });
      setHasVariants(true);
    } else {
      setHasVariants(false);
    }
  };

  const handleAddVariantRow = () => {
    const newRow = createVariantRowFromMain(mainFields);
    setVariantRows((prev) => [...prev, newRow]);
    // Open the newly added variant and collapse others
    setOpenVariantIds({ [newRow.id!]: true });
  };

  const handleRemoveVariantRow = (rowId: string) => {
    setVariantRows((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((r) => r.id !== rowId);
      setOpenVariantIds((openPrev) => {
        const copy = { ...openPrev };
        delete copy[rowId];
        if (Object.values(copy).every((v) => !v) && next.length > 0) {
          const last = next[next.length - 1];
          if (last.id) copy[last.id] = true;
        }
        return copy;
      });
      return next;
    });
  };

  const handleToggleAccordion = (rowId: string) => {
    setOpenVariantIds((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }));
  };

  const handleMainImageChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 0.7);
      setUploadedImage(compressed);
      setUploadedImageName(file.name);
      showFlash(
        language === 'id'
          ? `Foto Utama "${file.name}" berhasil dikompres & diunggah!`
          : `Main Photo "${file.name}" uploaded successfully!`
      );
    } catch {
      showFlash('Gagal memproses gambar utama.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMainGalleryChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files: File[] = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const currentGallery = Array.isArray(mainFields.galleryImages)
      ? mainFields.galleryImages
      : [];
    const remainingSlots = Math.max(0, 4 - currentGallery.length);
    if (remainingSlots <= 0) {
      showFlash(tr('Image Gallery allows a maximum of 4 photos!', 'Galeri Foto maksimal 4 foto!'));
      if (mainGalleryInputRef.current) mainGalleryInputRef.current.value = '';
      return;
    }
    const filesToProcess = files.slice(0, remainingSlots);
    try {
      const compressedList: string[] = [];
      for (const file of filesToProcess) {
        const compressed = await compressImageFile(file, 640, 0.6);
        compressedList.push(compressed);
      }
      setMainFields((prev) => ({
        ...prev,
        galleryImages: [...currentGallery, ...compressedList],
      }));
      showFlash(
        tr(
          `${compressedList.length} photo(s) added to Image Gallery!`,
          `${compressedList.length} foto ditambahkan ke Galeri Foto!`
        )
      );
    } catch {
      showFlash(tr('Failed to process gallery photos.', 'Gagal memproses foto galeri.'));
    } finally {
      if (mainGalleryInputRef.current) mainGalleryInputRef.current.value = '';
    }
  };

  const handleRemoveMainGalleryImage = (idxToRemove: number) => {
    const currentGallery = Array.isArray(mainFields.galleryImages)
      ? mainFields.galleryImages
      : [];
    setMainFields((prev) => ({
      ...prev,
      galleryImages: currentGallery.filter((_, idx) => idx !== idxToRemove),
    }));
  };

  const handleSelectChangeMain = (
    type: 'category' | 'brand' | 'storage',
    val: string
  ) => {
    if (val === ADD_NEW_VALUE) {
      setAddMasterModal({
        type,
        value: '',
        isSaving: false,
        variantRowId: null,
      });
      return;
    }
    if (type === 'category') updateMainSharedField('category', val);
    if (type === 'brand') updateMainSharedField('brand', val);
    if (type === 'storage') updateMainSharedField('storageLocation', val);
  };

  const handleConfirmAddMaster = async () => {
    if (!addMasterModal.type) return;
    const trimmed = addMasterModal.value.trim();
    if (!trimmed) {
      showFlash(tr('Name cannot be empty!', 'Nama tidak boleh kosong!'));
      return;
    }
    setAddMasterModal((prev) => ({ ...prev, isSaving: true }));
    try {
      const targetRowId = addMasterModal.variantRowId;
      if (addMasterModal.type === 'category') {
        const created = await addCategory(trimmed);
        if (targetRowId) {
          setVariantRows((prev) =>
            prev.map((r) =>
              r.id === targetRowId ? { ...r, category: created.name } : r
            )
          );
        } else {
          updateMainSharedField('category', created.name);
        }
        showFlash(
          tr(
            `Category "${created.name}" added successfully!`,
            `Kategori "${created.name}" berhasil ditambahkan!`
          )
        );
      } else if (addMasterModal.type === 'brand') {
        const created = await addBrand(trimmed);
        if (targetRowId) {
          setVariantRows((prev) =>
            prev.map((r) =>
              r.id === targetRowId ? { ...r, brand: created.name } : r
            )
          );
        } else {
          updateMainSharedField('brand', created.name);
        }
        showFlash(
          tr(
            `Brand "${created.name}" added successfully!`,
            `Brand "${created.name}" berhasil ditambahkan!`
          )
        );
      } else if (addMasterModal.type === 'storage') {
        const created = await addStorageLocation(trimmed);
        if (targetRowId) {
          setVariantRows((prev) =>
            prev.map((r) =>
              r.id === targetRowId ? { ...r, storageLocation: created.name } : r
            )
          );
        } else {
          updateMainSharedField('storageLocation', created.name);
        }
        showFlash(
          tr(
            `Storage location "${created.name}" added successfully!`,
            `Lokasi "${created.name}" berhasil ditambahkan!`
          )
        );
      }
      setAddMasterModal({
        type: null,
        value: '',
        isSaving: false,
        variantRowId: null,
      });
    } catch (err: any) {
      showFlash(
        err?.message ||
          tr('Failed to add new master data.', 'Gagal menambahkan data baru.')
      );
      setAddMasterModal((prev) => ({ ...prev, isSaving: false }));
    }
  };

  const buildProductObject = (): ProductGroupItem => {
    const cleanName = mainFields.name.trim();
    const generatedSku = (
      mainFields.sku?.trim() ||
      sku ||
      generateSku()
    ).trim();

    if (hasVariants) {
      const variantGroupId =
        initialProduct?.variantGroupId ||
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'vgrp_' + Date.now());

      const mappedVariants: ProductVariantItem[] = variantRows.map(
        (v, idx) => {
          const eff = computeEffectiveFields(v);
          const vSku = (v.sku || `${generatedSku}-V${idx + 1}`).trim();
          const finalImageUrl = v.imageUrl || uploadedImage || '';
          const galleryUrls = Array.isArray(v.galleryImages) ? v.galleryImages : [];
          const shelfLocation = (
            v.storageLocation ||
            mainFields.storageLocation ||
            ''
          ).trim();
          const selectedBrand = (
            v.brand !== undefined && v.brand !== '' ? v.brand : mainFields.brand
          ).trim();
          const minStockVal = Number(minStockAlert) || 10;
          const variantName = v.name.trim();
          const fullVariantName =
            cleanName && variantName && !variantName.toLowerCase().startsWith(cleanName.toLowerCase())
              ? `${cleanName} ${variantName}`.trim()
              : variantName || cleanName;

          return {
            id: v.docId || v.id || `var_${Date.now()}_${idx}`,
            docId: v.docId,
            sku: vSku,
            name: fullVariantName,
            variantName,
            groupName: cleanName,
            variantType: v.variantType || 'Rasa',
            variantGroupId,
            category: v.category || mainFields.category || '',
            brand: selectedBrand,
            description: (v.description || mainFields.description || '').trim(),
            batchCode: (v.batchCode || mainFields.batchCode || '').trim(),
            costPrice: eff.effectiveCostPrice,
            costPerUnit: eff.effectiveCostPrice,
            sellPrice: eff.effectiveSellPrice,
            pricePerUnit: eff.effectiveSellPrice,
            posPrice: eff.effectiveSellPrice,
            pwaPrice: eff.effectivePwaPrice,
            stock: eff.effectiveStock,
            stockInUnits: eff.effectiveStock,
            itemsPerCarton: eff.safeIsi,
            piecesPerCarton: eff.safeIsi,
            isiPerDus: eff.safeIsi,
            pricePerCarton: eff.effectivePricePerCarton,
            cartonWholesalePrice: eff.effectivePricePerCarton,
            costPerCarton: eff.effectiveCostPerCarton,
            weightMl: eff.safeWeightMl,
            beratPerItem: eff.safeWeightMl,
            totalBeratKg: eff.totalBeratKg,
            deliveryCommission: Number(v.deliveryCommission) || 0,
            storageLocation: shelfLocation,
            shelfLocation,
            isActive: v.isActive !== false,
            isPosVisible: v.isPosVisible !== false,
            isPwaVisible: v.isPwaVisible !== false,
            trackStockCard: v.trackStockCard !== false,
            sellByUnit: Boolean(v.sellByUnit),
            hasRawMaterials: Boolean(v.hasRawMaterials ?? mainFields.hasRawMaterials),
            autoDeductRawMaterial:
              (v.autoDeductRawMaterial ?? mainFields.autoDeductRawMaterial) !== false,
            rawMaterialRecipe: Array.isArray(v.rawMaterialRecipe)
              ? v.rawMaterialRecipe
              : Array.isArray(mainFields.rawMaterialRecipe)
              ? mainFields.rawMaterialRecipe
              : [],
            mainUnit: v.mainUnit || 'Dus',
            subUnit: v.subUnit || 'Unit',
            imageUrl: finalImageUrl,
            galleryUrls,
            galleryImages: galleryUrls,
            minStock: minStockVal,
            minStockAlert: minStockVal,
            productionDate: (v.productionDate || mainFields.productionDate || '').trim(),
            tanggalProduksi: (v.productionDate || mainFields.productionDate || '').trim(),
            expiryDate: (v.expiryDate || mainFields.expiryDate || '').trim(),
            tanggalKadaluarsa: (v.expiryDate || mainFields.expiryDate || '').trim(),
          };
        }
      );

      const firstVar = mappedVariants[0];
      const totalVariantStock = mappedVariants.reduce(
        (sum, item) => sum + (item.stock || 0),
        0
      );

      return {
        id: initialProduct?.id || `grp_${variantGroupId}`,
        docIds: mappedVariants
          .map((v) => v.docId || v.id)
          .filter(Boolean) as string[],
        name: cleanName,
        groupName: cleanName,
        variantGroupId,
        sku: generatedSku,
        category: firstVar?.category || mainFields.category || '',
        brand: firstVar?.brand !== undefined ? firstVar.brand : mainFields.brand.trim(),
        description: (mainFields.description || firstVar?.description || '').trim(),
        batchCode: (mainFields.batchCode || firstVar?.batchCode || '').trim(),
        hasVariants: true,
        costPrice: firstVar?.costPrice ?? 0,
        costPerUnit: firstVar?.costPerUnit ?? firstVar?.costPrice ?? 0,
        sellPrice: firstVar?.sellPrice ?? 0,
        pricePerUnit: firstVar?.pricePerUnit ?? firstVar?.sellPrice ?? 0,
        posPrice: firstVar?.posPrice ?? 0,
        pwaPrice: firstVar?.pwaPrice ?? 0,
        totalStock: totalVariantStock,
        stockInUnits: totalVariantStock,
        itemsPerCarton: firstVar?.itemsPerCarton ?? 1,
        piecesPerCarton: firstVar?.piecesPerCarton ?? firstVar?.itemsPerCarton ?? 1,
        isiPerDus: firstVar?.isiPerDus ?? firstVar?.itemsPerCarton ?? 1,
        weightMl: firstVar?.weightMl ?? 0,
        beratPerItem: firstVar?.beratPerItem ?? firstVar?.weightMl ?? 0,
        totalBeratKg: firstVar?.totalBeratKg ?? 0,
        isActive: mappedVariants.some((v) => v.isActive !== false),
        isPosVisible: mappedVariants.some((v) => v.isPosVisible !== false),
        isPwaVisible: mappedVariants.some((v) => v.isPwaVisible !== false),
        imageUrl: uploadedImage || firstVar?.imageUrl || '',
        galleryUrls: firstVar?.galleryUrls || [],
        galleryImages: firstVar?.galleryImages || [],
        deliveryCommission: firstVar?.deliveryCommission ?? 0,
        trackStockCard: mappedVariants.some((v) => v.trackStockCard !== false),
        sellByUnit: Boolean(firstVar?.sellByUnit),
        mainUnit: firstVar?.mainUnit || 'Dus',
        subUnit: firstVar?.subUnit || 'Unit',
        costPerCarton: firstVar?.costPerCarton ?? 0,
        pricePerCarton: firstVar?.pricePerCarton ?? 0,
        cartonWholesalePrice: firstVar?.cartonWholesalePrice ?? firstVar?.pricePerCarton ?? 0,
        storageLocation:
          firstVar?.storageLocation || mainFields.storageLocation.trim(),
        shelfLocation:
          firstVar?.shelfLocation || mainFields.storageLocation.trim(),
        minStock: Number(minStockAlert) || 10,
        minStockAlert: Number(minStockAlert) || 10,
        variantType: firstVar?.variantType || 'Rasa',
        variantName: firstVar?.variantName,
        productionDate: firstVar?.productionDate || mainFields.productionDate || '',
        tanggalProduksi: firstVar?.tanggalProduksi || mainFields.productionDate || '',
        expiryDate: firstVar?.expiryDate || mainFields.expiryDate || '',
        tanggalKadaluarsa: firstVar?.tanggalKadaluarsa || mainFields.expiryDate || '',
        variants: mappedVariants,
      };
    }

    const effMain = computeEffectiveFields(mainFields);
    const galleryUrls = Array.isArray(mainFields.galleryImages)
      ? mainFields.galleryImages
      : [];
    const shelfLocation = mainFields.storageLocation.trim();
    const minStockVal = Number(minStockAlert) || 10;
    const resolvedDocId =
      initialProduct?.editingVariantId ||
      initialProduct?.docId ||
      initialProduct?.id;

    return {
      id: resolvedDocId || 'grp_' + Date.now(),
      ...(resolvedDocId ? { docId: resolvedDocId } : {}),
      ...(initialProduct?.editingVariantId
        ? { editingVariantId: initialProduct.editingVariantId }
        : {}),
      name: cleanName,
      sku: generatedSku,
      category: mainFields.category || '',
      brand: mainFields.brand.trim(),
      description: (mainFields.description || '').trim(),
      batchCode: (mainFields.batchCode || '').trim(),
      batches: initialProduct?.batches,
      hasVariants: false,
      costPrice: effMain.effectiveCostPrice,
      costPerUnit: effMain.effectiveCostPrice,
      sellPrice: effMain.effectiveSellPrice,
      pricePerUnit: effMain.effectiveSellPrice,
      posPrice: effMain.effectiveSellPrice,
      pwaPrice: effMain.effectivePwaPrice,
      totalStock: effMain.effectiveStock,
      stockInUnits: effMain.effectiveStock,
      itemsPerCarton: effMain.safeIsi,
      piecesPerCarton: effMain.safeIsi,
      isiPerDus: effMain.safeIsi,
      weightMl: effMain.safeWeightMl,
      beratPerItem: effMain.safeWeightMl,
      totalBeratKg: effMain.totalBeratKg,
      isActive: mainFields.isActive,
      isPosVisible: mainFields.isPosVisible,
      isPwaVisible: mainFields.isPwaVisible,
      imageUrl: uploadedImage || '',
      galleryUrls,
      galleryImages: galleryUrls,
      deliveryCommission: Number(mainFields.deliveryCommission) || 0,
      trackStockCard: mainFields.trackStockCard,
      sellByUnit: Boolean(mainFields.sellByUnit),
      hasRawMaterials: Boolean(mainFields.hasRawMaterials),
      autoDeductRawMaterial: mainFields.autoDeductRawMaterial !== false,
      rawMaterialRecipe: Array.isArray(mainFields.rawMaterialRecipe)
        ? mainFields.rawMaterialRecipe
        : [],
      mainUnit: mainFields.mainUnit,
      subUnit: mainFields.subUnit,
      costPerCarton: effMain.effectiveCostPerCarton,
      pricePerCarton: effMain.effectivePricePerCarton,
      cartonWholesalePrice: effMain.effectivePricePerCarton,
      storageLocation: shelfLocation,
      shelfLocation,
      minStock: minStockVal,
      minStockAlert: minStockVal,
      productionDate: (mainFields.productionDate || '').trim(),
      tanggalProduksi: (mainFields.productionDate || '').trim(),
      expiryDate: (mainFields.expiryDate || '').trim(),
      tanggalKadaluarsa: (mainFields.expiryDate || '').trim(),
    };
  };

  const saveEditedProductToFirestore = async (group: ProductGroupItem) => {
    const isEdit = Boolean(initialProduct?.id || initialProduct?.docId);
    if (!isEdit || group.hasVariants) return;
    const prodId =
      initialProduct.editingVariantId ||
      initialProduct.docId ||
      initialProduct.id;
    if (!prodId) return;

    const safeIsi = Math.max(1, Number(group.isiPerDus ?? group.itemsPerCarton ?? 1));
    const safeWeightMl = Math.max(0, Number(group.beratPerItem ?? group.weightMl ?? 0));
    const totalBeratKg =
      group.hasRawMaterials && Array.isArray(group.rawMaterialRecipe)
        ? computeBomTotalWeightKg(group.rawMaterialRecipe)
        : group.totalBeratKg !== undefined
        ? Number(group.totalBeratKg)
        : Number(((safeWeightMl * safeIsi) / 1000).toFixed(3));

    const productionDate = (group.productionDate ?? group.tanggalProduksi ?? '').trim();
    const expiryDate = (group.expiryDate ?? group.tanggalKadaluarsa ?? '').trim();
    const batchCode = (group.batchCode ?? '').trim();
    const batches =
      Array.isArray(group.batches) && group.batches.length > 0
        ? group.batches.map((b: any, idx: number) =>
            idx === 0
              ? {
                  ...b,
                  batchCode: batchCode || b.batchCode,
                  productionDate: productionDate || b.productionDate,
                  expiryDate: expiryDate || b.expiryDate,
                  qty: group.totalStock,
                  buyPrice: group.costPrice,
                }
              : b
          )
        : batchCode || productionDate || expiryDate
        ? [
            {
              batchCode: batchCode || `BATCH-${prodId.slice(0, 6).toUpperCase()}`,
              productionDate,
              expiryDate,
              qty: group.totalStock,
              initialQty: group.totalStock,
              buyPrice: group.costPrice,
            },
          ]
        : undefined;

    const firestoreData: Record<string, any> = {
      id: prodId,
      storeId: initialProduct.storeId || ACTIVE_STORE_ID,
      name: group.name,
      sku: group.sku,
      barcode: group.sku,
      category: group.category,
      description: group.description || '',
      batchCode,
      ...(batches ? { batches } : {}),
      price: group.sellPrice,
      sellPrice: group.sellPrice,
      posPrice: group.posPrice,
      pwaPrice: group.pwaPrice,
      costPrice: group.costPrice,
      stock: group.totalStock,
      pricePerUnit: group.sellPrice,
      costPerUnit: group.costPrice,
      stockInUnits: group.totalStock,
      piecesPerCarton: safeIsi,
      itemsPerCarton: safeIsi,
      isiPerDus: safeIsi,
      pricePerCarton: group.sellPrice,
      cartonWholesalePrice: group.sellPrice,
      costPerCarton: group.costPrice,
      minStockAlert: group.minStockAlert,
      minStock: group.minStockAlert,
      brand: group.brand,
      storageLocation: group.storageLocation || '',
      shelfLocation: group.storageLocation || '',
      deliveryCommission: group.deliveryCommission ?? 0,
      trackStockCard: group.trackStockCard !== false,
      sellByUnit: Boolean(group.sellByUnit),
      hasRawMaterials: Boolean(group.hasRawMaterials),
      autoDeductRawMaterial: group.autoDeductRawMaterial !== false,
      rawMaterialRecipe: Array.isArray(group.rawMaterialRecipe)
        ? group.rawMaterialRecipe
        : [],
      mainUnit: group.mainUnit || 'Dus',
      subUnit: group.subUnit || 'Unit',
      imageUrl: uploadedImage || '',
      galleryUrls: group.galleryUrls || [],
      galleryImages: group.galleryImages || [],
      isActive: group.isActive !== false,
      isPosVisible: group.isPosVisible !== false,
      isPwaVisible: group.isPwaVisible !== false,
      weightMl: safeWeightMl,
      beratPerItem: safeWeightMl,
      totalBeratKg,
      productionDate,
      tanggalProduksi: productionDate,
      expiryDate,
      tanggalKadaluarsa: expiryDate,
      updatedAt: new Date().toISOString(),
    };

    await saveProductDocToAllPaths(prodId, firestoreData);
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mainFields.name.trim()) {
      showFlash(
        language === 'en'
          ? 'Warning: Please enter the Product Name first!'
          : 'Peringatan: Silakan isi Nama Produk terlebih dahulu!'
      );
      return;
    }

    if (hasVariants) {
      const emptyVariantIndex = variantRows.findIndex((v) => !v.name.trim());
      if (emptyVariantIndex !== -1) {
        const emptyRow = variantRows[emptyVariantIndex];
        if (emptyRow?.id) {
          setOpenVariantIds((prev) => ({ ...prev, [emptyRow.id!]: true }));
        }
        showFlash(
          tr(
            `Warning: Product Name on VARIANT ${emptyVariantIndex + 1} is required!`,
            `Peringatan: Nama Produk pada VARIAN ${emptyVariantIndex + 1} wajib diisi!`
          )
        );
        return;
      }
    }

    const newGroup = buildProductObject();

    // Check JSON size of each document before saving (> 900 KB)
    if (newGroup.hasVariants && newGroup.variants) {
      for (const v of newGroup.variants) {
        if (getJsonByteSize(v) > MAX_PRODUCT_DOC_BYTES) {
          showFlash(PHOTO_TOO_LARGE_MESSAGE);
          return;
        }
      }
    } else if (getJsonByteSize(newGroup) > MAX_PRODUCT_DOC_BYTES) {
      showFlash(PHOTO_TOO_LARGE_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    try {
      if ((initialProduct?.id || initialProduct?.docId) && !hasVariants) {
        await saveEditedProductToFirestore(newGroup);
      }
      await Promise.resolve(onSubmit(newGroup));
    } catch (err: any) {
      showFlash(err?.message || PHOTO_TOO_LARGE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  };

  const labelClass = `block text-xs font-medium mb-1.5 ${
    isDark ? 'text-zinc-300' : 'text-slate-700'
  }`;

  const inputBaseClass = `w-full px-3.5 py-2 rounded-lg border text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    isDark
      ? 'bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500'
      : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-blue-500'
  }`;

  const mainGalleryList = Array.isArray(mainFields.galleryImages)
    ? mainFields.galleryImages
    : [];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {flashMessage && (() => {
        const isErrorFlash =
          /gagal|error|warning|peringatan|invalid|unsupported/i.test(flashMessage);
        return (
          <div
            className={`fixed top-20 right-6 z-50 ${
              isErrorFlash ? 'bg-rose-600' : 'bg-emerald-600'
            } text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in slide-in-from-top-2`}
          >
            {isErrorFlash ? (
              <AlertTriangle className="w-4 h-4 text-white shrink-0" />
            ) : (
              <CheckCircle className="w-4 h-4 text-white shrink-0" />
            )}
            <span>{flashMessage}</span>
          </div>
        );
      })()}

      {/* Modal Tambah Kategori / Brand / Penyimpanan Baru */}
      {addMasterModal.type && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl space-y-4 ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {addMasterModal.type === 'category'
                  ? t('product.addCategoryTitle', 'Tambah Kategori Baru')
                  : addMasterModal.type === 'brand'
                  ? t('product.addBrandTitle', 'Tambah Brand Baru')
                  : t('product.addStorageTitle', 'Tambah Lokasi Penyimpanan')}
              </h3>
              <button
                type="button"
                onClick={() =>
                  setAddMasterModal({
                    type: null,
                    value: '',
                    isSaving: false,
                    variantRowId: null,
                  })
                }
                className="p-1 rounded-lg hover:bg-zinc-800/40 text-zinc-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <input
                type="text"
                autoFocus
                placeholder={t('product.enterNamePlaceholder', 'Masukkan nama...')}
                value={addMasterModal.value}
                onChange={(e) =>
                  setAddMasterModal((prev) => ({
                    ...prev,
                    value: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmAddMaster();
                  }
                }}
                className={inputBaseClass}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setAddMasterModal({
                    type: null,
                    value: '',
                    isSaving: false,
                    variantRowId: null,
                  })
                }
                className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                  isDark
                    ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t('common.cancel', 'Batal')}
              </button>
              <button
                type="button"
                disabled={addMasterModal.isSaving}
                onClick={handleConfirmAddMaster}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {addMasterModal.isSaving
                  ? t('common.saving', 'Menyimpan...')
                  : t('common.save', 'Simpan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-xl border flex items-center justify-center font-bold ${
                isEditMode
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-blue-600/20 text-blue-500 border-blue-500/30'
              }`}
            >
              {isEditMode ? (
                <Edit3 className="w-4 h-4" />
              ) : (
                <Package className="w-4 h-4" />
              )}
            </div>
            <h1
              className={`text-2xl font-black tracking-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {isEditMode
                ? tr('Edit Product & Catalog', 'Edit Produk & Katalog')
                : t('add_product', 'Tambah Produk')}
            </h1>
          </div>
          <p
            className={`text-xs mt-1 ${
              isDark ? 'text-zinc-400' : 'text-slate-500'
            }`}
          >
            {isEditMode
              ? tr(
                  'Update product photos, packaging, pricing, variants, and FEFO batches synchronized in real-time with POS & Client PWA.',
                  'Perbarui foto produk, konfigurasi dus/karton, harga POS & PWA, varian, serta batch FEFO secara real-time.'
                )
              : t(
                  'add_product_subtitle',
                  'Fill out the form below to add a new item into the POS Machine catalog & Customer Online PWA.'
                )}
          </p>
        </div>

        {/* Action Controls: Theme Switcher & Back Button */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`flex items-center p-1 rounded-xl border shadow-xs ${
              isDark
                ? 'bg-zinc-900 border-zinc-800'
                : 'bg-white border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggleTheme('dark')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-800 text-white shadow-xs font-bold border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Dark Theme"
            >
              <Moon className="w-3.5 h-3.5 text-blue-400" />
              <span>Dark</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleTheme('light')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                !isDark
                  ? 'bg-slate-100 text-slate-900 shadow-xs font-bold border border-slate-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Light Theme"
            >
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Light</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onBack}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-semibold transition shadow-xs cursor-pointer ${
              isDark
                ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-200'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>
              {isEditMode
                ? tr('Back to Product List', 'Kembali ke Daftar Produk')
                : t('back', 'Kembali')}
            </span>
          </button>
        </div>
      </div>

      {/* MAIN FORM */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* KARTU FOTO PALING ATAS: FOTO UTAMA & GALERI */}
        <div
          className={`rounded-2xl border p-6 sm:p-7 space-y-5 shadow-sm transition-colors ${
            isDark
              ? 'bg-zinc-900/90 border-zinc-800 text-zinc-100'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between border-b pb-3 border-zinc-800/60">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider">
                {t('product.mainPhoto', 'Foto / Gambar Produk Utama')}
              </h2>
            </div>
            <span className="text-[11px] text-zinc-400">
              {t('product.photoFormatHint', 'Format: JPG, PNG, WebP (Kompres otomatis 800px) atau URL Gambar')}
            </span>
          </div>

          <div className="flex flex-col lg:flex-row items-start lg:items-stretch gap-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-6 flex-1 w-full">
              <div
                className={`relative w-44 h-44 sm:w-48 sm:h-48 shrink-0 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition-all group ${
                  isDark
                    ? 'border-zinc-700 bg-zinc-950/70 hover:border-blue-500/60'
                    : 'border-slate-300 bg-slate-50 hover:border-blue-400'
                }`}
              >
                {uploadedImage ? (
                  <>
                    <img
                      src={uploadedImage}
                      alt={t('product.mainPhoto', 'Foto Utama')}
                      className="w-full h-full object-cover rounded-2xl"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg cursor-pointer transition"
                        title={t('change_image', 'Ganti Foto')}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedImage(null);
                          setUploadedImageName('');
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="p-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg cursor-pointer transition"
                        title={t('delete_image', 'Hapus')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center p-4 text-center cursor-pointer hover:opacity-80 transition w-full h-full"
                  >
                    <div
                      className={`w-12 h-12 rounded-2xl border flex items-center justify-center mb-2.5 transition ${
                        isDark
                          ? 'bg-zinc-800/80 border-zinc-700/60 text-zinc-400 group-hover:text-blue-400 group-hover:border-blue-500/50'
                          : 'bg-white border-slate-200 text-slate-400 group-hover:text-blue-500 group-hover:border-blue-400'
                      }`}
                    >
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        isDark ? 'text-zinc-300' : 'text-slate-700'
                      }`}
                    >
                      {t('product.mainPhoto', 'Foto Utama')}
                    </span>
                    <span className="text-[10px] text-zinc-500 mt-0.5">
                      {t('product.clickToPickPhoto', 'Klik untuk memilih foto')}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col justify-center space-y-3 w-full">
                <div>
                  <h3
                    className={`text-sm font-bold flex items-center gap-2 ${
                      isDark ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    <span>{t('product.uploadMainPhoto', 'Unggah / Edit Foto Produk')}</span>
                    {uploadedImage && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-semibold">
                        <Check className="w-3 h-3" />{' '}
                        {t('product.uploadedBadge', 'Tersedia')}
                      </span>
                    )}
                  </h3>
                  <p
                    className={`text-xs mt-1 leading-relaxed ${
                      isDark ? 'text-zinc-400' : 'text-slate-500'
                    }`}
                  >
                    {t(
                      'product.mainPhotoDescription',
                      'Digunakan sebagai foto produk utama pada POS & PWA, serta menjadi cadangan otomatis untuk varian yang belum memiliki foto sendiri.'
                    )}
                  </p>
                  {uploadedImageName && (
                    <p className="text-[11px] text-zinc-400 mt-1.5 font-mono flex items-center gap-1.5">
                      <span className="text-zinc-500">{t('common.file', 'Berkas:')}</span>
                      <span className="text-blue-400 font-semibold truncate max-w-xs" data-no-translate="true">
                        {uploadedImageName}
                      </span>
                    </p>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleMainImageChange}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>
                      {uploadedImage
                        ? tr('Change / Upload New Image', 'Ganti / Upload Gambar Baru')
                        : tr('Upload Image from Device', 'Upload Gambar dari Perangkat')}
                    </span>
                  </button>

                  {uploadedImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedImage(null);
                        setUploadedImageName('');
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className={`px-3.5 py-2.5 rounded-xl font-semibold text-xs border transition flex items-center gap-1.5 cursor-pointer ${
                        isDark
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-rose-400 hover:text-rose-300 border-zinc-700'
                          : 'bg-slate-100 hover:bg-slate-200 text-rose-600 border-slate-200'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{tr('Delete Image', 'Hapus Gambar')}</span>
                    </button>
                  )}
                </div>

                {/* Input URL Gambar Produk */}
                <div className="pt-1 max-w-md">
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1 flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5 text-blue-400" />
                    <span>{tr('Or Input Image URL', 'Atau Input URL Gambar Produk')}</span>
                  </label>
                  <input
                    type="text"
                    placeholder="https://example.com/foto-produk.jpg"
                    value={uploadedImage?.startsWith('data:') ? '' : uploadedImage || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUploadedImage(val ? val : null);
                      if (val) setUploadedImageName('URL Eksternal');
                    }}
                    className={inputBaseClass}
                  />
                </div>
              </div>
            </div>

            {/* Galeri Foto Tambahan untuk Produk Tunggal (!hasVariants) */}
            {!hasVariants && (
              <>
                <div
                  className={`hidden lg:block w-px self-stretch ${
                    isDark ? 'bg-zinc-800' : 'bg-slate-200'
                  }`}
                />
                <div className="lg:w-72 space-y-2.5 w-full">
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
                        {mainGalleryList.length}/4
                      </span>
                    </div>

                    {mainGalleryList.length < 4 && (
                      <button
                        type="button"
                        onClick={() => mainGalleryInputRef.current?.click()}
                        className="text-xs font-semibold text-blue-500 hover:text-blue-400 flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t('product.uploadGallery', 'Unggah Galeri')}</span>
                      </button>
                    )}
                  </div>

                  <input
                    ref={mainGalleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleMainGalleryChange}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {mainGalleryList.map((imgSrc, idx) => (
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
                          onClick={() => handleRemoveMainGalleryImage(idx)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow cursor-pointer opacity-90 hover:opacity-100 transition"
                          title={t('common.delete', 'Hapus')}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    {mainGalleryList.length < 4 && (
                      <button
                        type="button"
                        onClick={() => mainGalleryInputRef.current?.click()}
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
              </>
            )}
          </div>
        </div>

        {/* KARTU UTAMA */}
        <div
          className={`rounded-2xl border p-6 sm:p-7 space-y-6 shadow-sm transition-colors ${
            isDark
              ? 'bg-zinc-900/90 border-zinc-800 text-zinc-100'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          {hasVariants ? (
            /* Saat toggle Varian ON: tampilkan Nama Produk (nama grup), SKU Grup, Kategori, Brand, Penyimpanan */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <label className={labelClass}>
                  {t('product.name', 'Nama Produk (Grup)')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={t('product.groupNamePlaceholder', 'Masukkan nama grup produk')}
                  value={mainFields.name}
                  onChange={(e) =>
                    setMainFields((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className={inputBaseClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t('product.category', 'Kategori')}</label>
                <select
                  value={mainFields.category}
                  onChange={(e) =>
                    handleSelectChangeMain('category', e.target.value)
                  }
                  className={`${inputBaseClass} cursor-pointer`}
                >
                  <option value="">{t('product.selectCategory', 'Pilih kategori')}</option>
                  {mainFields.category &&
                    !categories.some(
                      (c) => c.toLowerCase() === mainFields.category.toLowerCase()
                    ) && (
                      <option value={mainFields.category}>
                        {translateCategory(mainFields.category)}
                      </option>
                    )}
                  {categories.map((cat, idx) => (
                    <option key={`add-cat-${cat}-${idx}`} value={cat}>
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
                  value={mainFields.brand}
                  onChange={(e) =>
                    handleSelectChangeMain('brand', e.target.value)
                  }
                  className={`${inputBaseClass} cursor-pointer`}
                >
                  <option value="">{t('product.selectBrand', 'Pilih brand')}</option>
                  {mainFields.brand &&
                    !brands.some(
                      (b) => b.toLowerCase() === mainFields.brand.toLowerCase()
                    ) && (
                      <option value={mainFields.brand} data-no-translate="true">
                        {mainFields.brand}
                      </option>
                    )}
                  {brands.map((b, idx) => (
                    <option key={`add-brand-${b}-${idx}`} value={b} data-no-translate="true">
                      {b}
                    </option>
                  ))}
                  <option value={ADD_NEW_VALUE}>
                    {t('common.addNewOption', '+ Tambah baru...')}
                  </option>
                </select>
              </div>

              <div>
                <label className={labelClass}>
                  {t('product.storageLocation', 'Penyimpanan')}
                </label>
                <select
                  value={mainFields.storageLocation}
                  onChange={(e) =>
                    handleSelectChangeMain('storage', e.target.value)
                  }
                  className={`${inputBaseClass} cursor-pointer`}
                >
                  <option value="">
                    {t('product.selectStorage', 'Pilih lokasi penyimpanan')}
                  </option>
                  {mainFields.storageLocation &&
                    !storageLocations.some(
                      (loc) => loc.toLowerCase() === mainFields.storageLocation.toLowerCase()
                    ) && (
                      <option value={mainFields.storageLocation}>
                        {mainFields.storageLocation}
                      </option>
                    )}
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
            </div>
          ) : (
            /* Saat toggle Varian OFF: tampilkan seluruh ProductFormFields untuk produk tunggal */
            <ProductFormFields
              isDark={isDark}
              isVariant={false}
              showPhotoCard={false}
              value={mainFields}
              onChange={(updated) => {
                setMainFields(updated);
                if (updated.sku !== undefined) {
                  setSku(updated.sku);
                }
                if (updated.hasRawMaterials && hasVariants) {
                  setHasVariants(false);
                }
              }}
              categories={categories}
              brands={brands}
              storageLocations={storageLocations}
              onRequestAddMaster={(type) =>
                setAddMasterModal({
                  type,
                  value: '',
                  isSaving: false,
                  variantRowId: null,
                })
              }
              toDisplayValue={toDisplayValue}
              parseInputToIdr={parseInputToIdr}
              onShowFlash={showFlash}
            />
          )}

          {/* Box Toggle "Varian" Border Biru — Disembunyikan jika Bahan Baku Aktif */}
          {!mainFields.hasRawMaterials && (
            <div
              className={`rounded-xl border p-4 transition-colors ${
                isDark
                  ? 'border-blue-500/30 bg-blue-950/10'
                  : 'border-blue-200 bg-blue-50/15'
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={hasVariants}
                  onClick={handleToggleHasVariants}
                  className={`relative inline-flex h-6 w-12 shrink-0 items-center cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                    hasVariants
                      ? 'bg-blue-600'
                      : isDark
                      ? 'bg-zinc-700'
                      : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                      hasVariants ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">
                    {t('product.variants', 'Varian')}
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      hasVariants
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : isDark
                        ? 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {hasVariants ? tr('ON', 'AKTIF') : tr('OFF', 'NONAKTIF')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tombol Submit Produk & Total Berat ( kg ) di Kartu Utama saat Varian OFF */}
          {!hasVariants && (
            <div className="flex flex-wrap items-center justify-end gap-4 pt-2">
              <div
                className={`px-4 py-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 ${
                  isDark
                    ? 'bg-zinc-950/90 border-zinc-800 text-zinc-200'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <span>{t('product.totalWeightKg', 'Total Berat ( kg )')} :</span>
                <span className="font-mono text-sm font-extrabold text-blue-400">
                  {computeEffectiveFields(mainFields).totalBeratKg} kg
                </span>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>
                  {isEditMode
                    ? tr('Save Product Changes', 'Simpan Perubahan Produk')
                    : t('product.submitProduct', 'Simpan Produk')}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* DAFTAR KARTU ACCORDION VARIAN PRODUK (Tampil saat toggle Varian ON) */}
        {hasVariants && (
          <div
            className={`rounded-2xl border p-6 sm:p-7 space-y-5 shadow-sm transition-colors ${
              isDark
                ? 'bg-zinc-900/90 border-zinc-800 text-zinc-100'
                : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            <h2
              className={`text-sm font-bold uppercase tracking-wider ${
                isDark ? 'text-zinc-200' : 'text-slate-800'
              }`}
            >
              {t('product.productVariants', 'VARIAN PRODUK')}
            </h2>

            <div className="space-y-4">
              {variantRows.map((row, idx) => {
                const rowId = row.id || `vrow_${idx}`;
                const isOpen = Boolean(openVariantIds[rowId]);
                const variantPrefix = `${t('product.variantLabel', 'VARIAN')} ${idx + 1}`;
                const headerTitle = row.name.trim()
                  ? `${variantPrefix} - ${row.name.trim()}`
                  : variantPrefix;

                return (
                  <div
                    key={rowId}
                    className={`rounded-2xl border overflow-hidden transition-colors ${
                      isDark
                        ? 'border-zinc-800 bg-zinc-950/35'
                        : 'border-slate-200 bg-slate-50/40'
                    }`}
                  >
                    {/* Header Accordion: VARIAN N - {nama} + tombol hapus + chevron */}
                    <div
                      onClick={() => handleToggleAccordion(rowId)}
                      className={`flex items-center justify-between px-5 py-3.5 cursor-pointer select-none transition-colors ${
                        isOpen
                          ? isDark
                            ? 'bg-zinc-900/90 border-b border-zinc-800'
                            : 'bg-slate-100/80 border-b border-slate-200'
                          : isDark
                          ? 'hover:bg-zinc-900/60'
                          : 'hover:bg-slate-100/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`text-xs font-bold uppercase tracking-wide truncate ${
                            isDark ? 'text-zinc-200' : 'text-slate-800'
                          }`}
                        >
                          {headerTitle}
                        </span>
                        {row.variantType && (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${
                              isDark
                                ? 'bg-zinc-800 border-zinc-700 text-zinc-400'
                                : 'bg-white border-slate-200 text-slate-500'
                            }`}
                          >
                            {translateVariant(row.variantType)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={variantRows.length <= 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveVariantRow(rowId);
                          }}
                          className="p-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={t('product.deleteVariant', 'Hapus Varian')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleAccordion(rowId);
                          }}
                          className={`p-2 rounded-lg border transition cursor-pointer ${
                            isDark
                              ? 'border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-800'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                          }`}
                          title={
                            isOpen
                              ? t('product.collapseVariant', 'Ciutkan Varian')
                              : t('product.expandVariant', 'Buka Varian')
                          }
                        >
                          {isOpen ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Isi Accordion: ProductFormFields penuh */}
                    {isOpen && (
                      <div className="p-5 sm:p-6">
                        <ProductFormFields
                          isDark={isDark}
                          isVariant={true}
                          showPhotoCard={true}
                          fallbackImageUrl={uploadedImage}
                          value={row}
                          onChange={(updatedRow) =>
                            setVariantRows((prev) =>
                              prev.map((r) =>
                                (r.id || '') === rowId
                                  ? { ...updatedRow, id: rowId }
                                  : r
                              )
                            )
                          }
                          categories={categories}
                          brands={brands}
                          storageLocations={storageLocations}
                          onRequestAddMaster={(type) =>
                            setAddMasterModal({
                              type,
                              value: '',
                              isSaving: false,
                              variantRowId: rowId,
                            })
                          }
                          toDisplayValue={toDisplayValue}
                          parseInputToIdr={parseInputToIdr}
                          onShowFlash={showFlash}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer Varian: + Tambah Varian (kiri) & Total Berat + Submit Produk (kanan) */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={handleAddVariantRow}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t('product.addVariant', 'Tambah Varian')}</span>
              </button>

              <div className="flex flex-wrap items-center gap-4">
                <div
                  className={`px-4 py-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 ${
                    isDark
                      ? 'bg-zinc-950/90 border-zinc-800 text-zinc-200'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <span>{t('product.totalWeightKg', 'Total Berat ( kg )')} :</span>
                  <span className="font-mono text-sm font-extrabold text-blue-400">
                    {computeEffectiveFields(
                      variantRows.find((r) => r.id && openVariantIds[r.id]) ||
                        variantRows[variantRows.length - 1] ||
                        mainFields
                    ).totalBeratKg}{' '}
                    kg
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {isEditMode
                      ? tr('Save Product Changes', 'Simpan Perubahan Produk')
                      : t('product.submitProduct', 'Simpan Produk')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
