export {
  getFirestore,
  enableNetwork,
  disableNetwork,
  getDocFromServer,
  setLogLevel,
  where,
  orderBy,
  limit,
  Timestamp,
  type Firestore,
  type QueryConstraint,
  type DocumentData,
  type DocumentReference,
  type CollectionReference,
  type Query,
  type QuerySnapshot,
  type DocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
  type FieldValue,
} from 'firebase/firestore';
import {
  collection as rawCollection,
  doc as rawDoc,
  query as rawQuery,
  onSnapshot as rawOnSnapshot,
  setDoc as rawSetDoc,
  addDoc as rawAddDoc,
  updateDoc as rawUpdateDoc,
  deleteDoc as rawDeleteDoc,
  getDocs as rawGetDocs,
  getDoc as rawGetDoc,
  writeBatch as rawWriteBatch,
  runTransaction as rawRunTransaction,
  increment as rawIncrement,
  serverTimestamp as rawServerTimestamp,
  arrayUnion as rawArrayUnion,
  arrayRemove as rawArrayRemove,
  deleteField as rawDeleteField,
} from 'firebase/firestore';

const DEMO_MODE_STORAGE_KEY = 'riskcart_demo_mode_active';
const DEMO_SANDBOX_STORAGE_KEY = 'riskcart_demo_sandbox_v1';

interface SandboxStoreState {
  // colPath -> docId -> document data
  upserts: Record<string, Record<string, Record<string, any>>>;
  // colPath -> array of deleted docIds
  deletes: Record<string, string[]>;
  updatedAt: string;
}

// In-memory cache of live Firestore documents so sandbox incremental updates (e.g. increment(-1))
// know the baseline document fields without mutating Firestore.
const liveBaselineCache: Record<string, Record<string, Record<string, any>>> = {};

// Track FieldValue operations (increment, serverTimestamp, arrayUnion, arrayRemove, deleteField)
// without mutating Firebase's internal FieldValue instances.
type FieldOpMeta =
  | { op: 'increment'; operand: number }
  | { op: 'serverTimestamp' }
  | { op: 'arrayUnion'; elements: any[] }
  | { op: 'arrayRemove'; elements: any[] }
  | { op: 'deleteField' };

const fieldValueMeta = new WeakMap<object, FieldOpMeta>();

export function isDemoModeActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if ((window as any).__RISKCART_DEMO_MODE__ === true || (window as any).__IS_DEMO_MODE__ === true) {
      return true;
    }
    const sessionFlag = sessionStorage.getItem(DEMO_MODE_STORAGE_KEY);
    if (sessionFlag === 'true') return true;
    const localFlag = localStorage.getItem(DEMO_MODE_STORAGE_KEY);
    return localFlag === 'true';
  } catch {
    return Boolean((window as any).__RISKCART_DEMO_MODE__ || (window as any).__IS_DEMO_MODE__);
  }
}

export function setDemoModeActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    (window as any).__RISKCART_DEMO_MODE__ = active;
    (window as any).__IS_DEMO_MODE__ = active;
    if (active) {
      sessionStorage.setItem(DEMO_MODE_STORAGE_KEY, 'true');
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, 'true');
    } else {
      sessionStorage.removeItem(DEMO_MODE_STORAGE_KEY);
      localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
      sessionStorage.removeItem(DEMO_SANDBOX_STORAGE_KEY);
      localStorage.removeItem(DEMO_SANDBOX_STORAGE_KEY);
    }
    window.dispatchEvent(
      new CustomEvent('riskcart_demo_mode_changed', { detail: { isDemoMode: active } })
    );
    window.dispatchEvent(new CustomEvent('riskcart_demo_sandbox_updated'));
  } catch {}
}

export function resetDemoSandbox(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DEMO_SANDBOX_STORAGE_KEY);
    localStorage.removeItem(DEMO_SANDBOX_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('riskcart_demo_sandbox_updated'));
  } catch {}
}

function createEmptySandboxState(): SandboxStoreState {
  return {
    upserts: {},
    deletes: {},
    updatedAt: new Date().toISOString(),
  };
}

function loadSandboxState(): SandboxStoreState {
  if (typeof window === 'undefined') return createEmptySandboxState();
  try {
    const raw =
      sessionStorage.getItem(DEMO_SANDBOX_STORAGE_KEY) ||
      localStorage.getItem(DEMO_SANDBOX_STORAGE_KEY);
    if (!raw) return createEmptySandboxState();
    const parsed = JSON.parse(raw);
    return {
      upserts: parsed?.upserts && typeof parsed.upserts === 'object' ? parsed.upserts : {},
      deletes: parsed?.deletes && typeof parsed.deletes === 'object' ? parsed.deletes : {},
      updatedAt: parsed?.updatedAt || new Date().toISOString(),
    };
  } catch {
    return createEmptySandboxState();
  }
}

function saveSandboxState(state: SandboxStoreState): void {
  if (typeof window === 'undefined') return;
  try {
    state.updatedAt = new Date().toISOString();
    const serialized = JSON.stringify(state);
    sessionStorage.setItem(DEMO_SANDBOX_STORAGE_KEY, serialized);
  } catch (err) {
    console.warn('[Sandbox] Storage quota warning, keeping state in memory:', err);
  }
  try {
    window.dispatchEvent(new CustomEvent('riskcart_demo_sandbox_updated'));
  } catch {}
}

function normalizePath(p: string): string {
  return String(p || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function extractTargetPath(target: any): string {
  if (!target) return '';
  if (typeof target.__rcPath === 'string' && target.__rcPath) {
    return normalizePath(target.__rcPath);
  }
  if (typeof target.path === 'string' && target.path) {
    return normalizePath(target.path);
  }
  const segments = target?._query?.path?.segments || target?._path?.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    return normalizePath(segments.join('/'));
  }
  return '';
}

function splitDocPath(fullPath: string): { colPath: string; docId: string } {
  const clean = normalizePath(fullPath);
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2 && parts.length % 2 === 0) {
    const docId = parts[parts.length - 1];
    const colPath = parts.slice(0, parts.length - 1).join('/');
    return { colPath, docId };
  }
  return { colPath: clean, docId: '' };
}

function cacheBaselineDoc(colPath: string, docId: string, data: any): void {
  if (!colPath || !docId || !data || typeof data !== 'object') return;
  if (!liveBaselineCache[colPath]) {
    liveBaselineCache[colPath] = {};
  }
  liveBaselineCache[colPath][docId] = JSON.parse(JSON.stringify(data));
}

function getBaselineDoc(colPath: string, docId: string): Record<string, any> | undefined {
  return liveBaselineCache[colPath]?.[docId];
}

function resolveFieldValue(currentVal: any, incomingVal: any): { delete?: boolean; value: any } {
  if (incomingVal && typeof incomingVal === 'object') {
    const meta = fieldValueMeta.get(incomingVal);
    if (meta) {
      if (meta.op === 'increment') {
        const base = typeof currentVal === 'number' && !Number.isNaN(currentVal) ? currentVal : 0;
        return { value: base + Number(meta.operand || 0) };
      }
      if (meta.op === 'serverTimestamp') {
        return { value: new Date().toISOString() };
      }
      if (meta.op === 'arrayUnion') {
        const baseArr = Array.isArray(currentVal) ? [...currentVal] : [];
        for (const item of meta.elements) {
          if (!baseArr.some((x) => JSON.stringify(x) === JSON.stringify(item))) {
            baseArr.push(item);
          }
        }
        return { value: baseArr };
      }
      if (meta.op === 'arrayRemove') {
        const baseArr = Array.isArray(currentVal) ? [...currentVal] : [];
        return {
          value: baseArr.filter(
            (x) => !meta.elements.some((rem) => JSON.stringify(x) === JSON.stringify(rem))
          ),
        };
      }
      if (meta.op === 'deleteField') {
        return { delete: true, value: undefined };
      }
    }

    // Fallback detection for native Firebase FieldValue internal _methodName
    const methodName = (incomingVal as any)._methodName;
    if (methodName === 'FieldValue.increment') {
      const base = typeof currentVal === 'number' && !Number.isNaN(currentVal) ? currentVal : 0;
      return { value: base + Number((incomingVal as any)._operand || 0) };
    }
    if (methodName === 'FieldValue.serverTimestamp') {
      return { value: new Date().toISOString() };
    }
    if (methodName === 'FieldValue.delete') {
      return { delete: true, value: undefined };
    }
  }
  return { value: incomingVal };
}

function setNestedField(target: Record<string, any>, dottedKey: string, incomingVal: any): void {
  const parts = dottedKey.split('.');
  let curr = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!curr[key] || typeof curr[key] !== 'object' || Array.isArray(curr[key])) {
      curr[key] = {};
    }
    curr = curr[key];
  }
  const lastKey = parts[parts.length - 1];
  const resolved = resolveFieldValue(curr[lastKey], incomingVal);
  if (resolved.delete) {
    delete curr[lastKey];
  } else {
    curr[lastKey] = resolved.value;
  }
}

function applyPatchToDoc(
  baseDoc: Record<string, any>,
  patch: Record<string, any>,
  isMerge: boolean
): Record<string, any> {
  const result: Record<string, any> = isMerge
    ? JSON.parse(JSON.stringify(baseDoc || {}))
    : {};

  if (!patch || typeof patch !== 'object') return result;

  for (const [key, rawVal] of Object.entries(patch)) {
    if (key.includes('.')) {
      setNestedField(result, key, rawVal);
    } else if (
      rawVal &&
      typeof rawVal === 'object' &&
      !Array.isArray(rawVal) &&
      !fieldValueMeta.has(rawVal) &&
      !(rawVal as any)._methodName &&
      !(rawVal instanceof Date) &&
      isMerge &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = applyPatchToDoc(result[key], rawVal, true);
    } else {
      const resolved = resolveFieldValue(result[key], rawVal);
      if (resolved.delete) {
        delete result[key];
      } else {
        result[key] = resolved.value;
      }
    }
  }

  return result;
}

function recordSandboxUpsert(
  colPath: string,
  docId: string,
  data: Record<string, any>,
  merge: boolean
): Record<string, any> {
  const state = loadSandboxState();
  if (!state.upserts[colPath]) {
    state.upserts[colPath] = {};
  }
  const deletedList = state.deletes[colPath] || [];
  const wasDeleted = deletedList.includes(docId);
  if (wasDeleted) {
    state.deletes[colPath] = deletedList.filter((id) => id !== docId);
  }

  const existingSandboxDoc = state.upserts[colPath][docId];
  const baselineDoc = wasDeleted ? {} : getBaselineDoc(colPath, docId) || {};
  const startingDoc = existingSandboxDoc
    ? { ...baselineDoc, ...existingSandboxDoc }
    : baselineDoc;

  const nextDoc = applyPatchToDoc(startingDoc, data, merge);
  state.upserts[colPath][docId] = nextDoc;
  saveSandboxState(state);
  return nextDoc;
}

function recordSandboxDelete(colPath: string, docId: string): void {
  const state = loadSandboxState();
  if (state.upserts[colPath]) {
    delete state.upserts[colPath][docId];
  }
  if (!state.deletes[colPath]) {
    state.deletes[colPath] = [];
  }
  if (!state.deletes[colPath].includes(docId)) {
    state.deletes[colPath].push(docId);
  }
  saveSandboxState(state);
}

function buildMergedDocumentSnapshot(rawSnap: any, colPath: string, docId: string): any {
  const rawExists = typeof rawSnap?.exists === 'function' ? rawSnap.exists() : false;
  const rawData = rawExists && typeof rawSnap?.data === 'function' ? rawSnap.data() : undefined;
  if (rawExists && rawData) {
    cacheBaselineDoc(colPath, docId, rawData);
  }

  if (!isDemoModeActive()) {
    return rawSnap;
  }

  const state = loadSandboxState();
  const isDeleted = Boolean(state.deletes[colPath]?.includes(docId));
  if (isDeleted) {
    return {
      id: docId,
      ref: rawSnap?.ref,
      metadata: rawSnap?.metadata,
      exists: () => false,
      data: () => undefined,
      get: (field: string) => undefined,
    };
  }

  const sandboxDoc = state.upserts[colPath]?.[docId];
  if (!sandboxDoc && !rawExists) {
    return rawSnap;
  }

  const mergedData = sandboxDoc
    ? { ...(rawData || {}), ...sandboxDoc }
    : rawData;

  return {
    id: docId,
    ref: rawSnap?.ref,
    metadata: rawSnap?.metadata,
    exists: () => Boolean(mergedData),
    data: () => (mergedData ? JSON.parse(JSON.stringify(mergedData)) : undefined),
    get: (field: string) => (mergedData ? mergedData[field] : undefined),
  };
}

function buildMergedQuerySnapshot(rawSnap: any, colPath: string): any {
  const rawDocs: any[] = Array.isArray(rawSnap?.docs) ? rawSnap.docs : [];
  for (const d of rawDocs) {
    try {
      const dData = typeof d.data === 'function' ? d.data() : undefined;
      const inferredCol =
        colPath || splitDocPath(d?.ref?.path || '').colPath;
      if (inferredCol && d?.id && dData) {
        cacheBaselineDoc(inferredCol, d.id, dData);
      }
    } catch {}
  }

  if (!isDemoModeActive()) {
    return rawSnap;
  }

  const effectiveColPath =
    colPath ||
    (rawDocs[0]?.ref?.path ? splitDocPath(rawDocs[0].ref.path).colPath : '');

  if (!effectiveColPath) {
    return rawSnap;
  }

  const state = loadSandboxState();
  const deletedSet = new Set(state.deletes[effectiveColPath] || []);
  const upsertsMap = state.upserts[effectiveColPath] || {};
  const handledIds = new Set<string>();

  const mergedDocs: any[] = [];

  // 1. Prepend new sandbox-created documents that weren't in Firestore so newest items appear immediately
  for (const [upId, upData] of Object.entries(upsertsMap)) {
    if (deletedSet.has(upId)) continue;
    const existsInRaw = rawDocs.some((d) => d.id === upId);
    if (!existsInRaw) {
      handledIds.add(upId);
      const cloned = JSON.parse(JSON.stringify(upData));
      mergedDocs.push({
        id: upId,
        ref: { id: upId, path: `${effectiveColPath}/${upId}` },
        exists: () => true,
        data: () => JSON.parse(JSON.stringify(cloned)),
        get: (field: string) => cloned[field],
      });
    }
  }

  // 2. Include live Firestore documents (excluding sandbox-deleted ones, merging sandbox-updated ones)
  for (const d of rawDocs) {
    const id = d.id;
    if (deletedSet.has(id) || handledIds.has(id)) continue;
    handledIds.add(id);
    const baseData = typeof d.data === 'function' ? d.data() : {};
    const override = upsertsMap[id];
    if (override) {
      const merged = { ...baseData, ...override };
      mergedDocs.push({
        id,
        ref: d.ref,
        metadata: d.metadata,
        exists: () => true,
        data: () => JSON.parse(JSON.stringify(merged)),
        get: (field: string) => merged[field],
      });
    } else {
      mergedDocs.push(d);
    }
  }

  return {
    docs: mergedDocs,
    size: mergedDocs.length,
    empty: mergedDocs.length === 0,
    metadata: rawSnap?.metadata,
    forEach: (cb: (docSnap: any, index: number) => void) => {
      mergedDocs.forEach((docSnap, idx) => cb(docSnap, idx));
    },
    docChanges: () => (typeof rawSnap?.docChanges === 'function' ? rawSnap.docChanges() : []),
  };
}

// Wrapped path builders so every reference & query carries its exact collection/document path
export const collection: typeof rawCollection = ((firestore: any, path: string, ...pathSegments: string[]) => {
  const ref = rawCollection(firestore, path, ...pathSegments);
  try {
    const basePath = typeof firestore?.path === 'string' ? firestore.path : '';
    const full = [basePath, path, ...pathSegments].filter(Boolean).join('/');
    Object.defineProperty(ref, '__rcPath', {
      value: normalizePath(ref.path || full),
      configurable: true,
    });
  } catch {}
  return ref;
}) as any;

export const doc: typeof rawDoc = ((firestoreOrCol: any, path?: string, ...pathSegments: string[]) => {
  const ref = (rawDoc as any)(firestoreOrCol, path, ...pathSegments);
  try {
    Object.defineProperty(ref, '__rcPath', {
      value: normalizePath(ref.path || ''),
      configurable: true,
    });
  } catch {}
  return ref;
}) as any;

export const query: typeof rawQuery = ((queryRef: any, ...queryConstraints: any[]) => {
  const q = rawQuery(queryRef, ...queryConstraints);
  try {
    const p = extractTargetPath(queryRef);
    if (p) {
      Object.defineProperty(q, '__rcPath', {
        value: p,
        configurable: true,
      });
    }
  } catch {}
  return q;
}) as any;

// Wrapped FieldValues
export const increment: typeof rawIncrement = (n: number) => {
  const fv = rawIncrement(n);
  if (fv && typeof fv === 'object') {
    fieldValueMeta.set(fv, { op: 'increment', operand: n });
  }
  return fv;
};

export const serverTimestamp: typeof rawServerTimestamp = () => {
  const fv = rawServerTimestamp();
  if (fv && typeof fv === 'object') {
    fieldValueMeta.set(fv, { op: 'serverTimestamp' });
  }
  return fv;
};

export const arrayUnion: typeof rawArrayUnion = (...elements: any[]) => {
  const fv = rawArrayUnion(...elements);
  if (fv && typeof fv === 'object') {
    fieldValueMeta.set(fv, { op: 'arrayUnion', elements });
  }
  return fv;
};

export const arrayRemove: typeof rawArrayRemove = (...elements: any[]) => {
  const fv = rawArrayRemove(...elements);
  if (fv && typeof fv === 'object') {
    fieldValueMeta.set(fv, { op: 'arrayRemove', elements });
  }
  return fv;
};

export const deleteField: typeof rawDeleteField = () => {
  const fv = rawDeleteField();
  if (fv && typeof fv === 'object') {
    fieldValueMeta.set(fv, { op: 'deleteField' });
  }
  return fv;
};

// Wrapped Read Operations (100% live Firestore baseline + Sandbox Overlay when in Demo Mode)
export const onSnapshot: typeof rawOnSnapshot = ((target: any, ...args: any[]) => {
  let onNext: ((snap: any) => void) | undefined;
  let onError: ((err: any) => void) | undefined;
  let options: any;

  if (typeof args[0] === 'function') {
    onNext = args[0];
    onError = typeof args[1] === 'function' ? args[1] : undefined;
  } else if (args[0] && typeof args[0] === 'object' && typeof args[1] === 'function') {
    options = args[0];
    onNext = args[1];
    onError = typeof args[2] === 'function' ? args[2] : undefined;
  } else if (args[0] && typeof args[0] === 'object') {
    onNext = args[0].next;
    onError = args[0].error;
  }

  if (!onNext) {
    return (rawOnSnapshot as any)(target, ...args);
  }

  const targetPath = extractTargetPath(target);
  const pathSegments = targetPath.split('/').filter(Boolean);
  const isDocTarget = target?.type === 'document' || (pathSegments.length >= 2 && pathSegments.length % 2 === 0);
  const { colPath, docId } = isDocTarget
    ? splitDocPath(targetPath)
    : { colPath: targetPath, docId: '' };

  let latestRawSnap: any = null;

  const emitSnapshot = () => {
    if (!latestRawSnap || !onNext) return;
    if (!isDemoModeActive()) {
      onNext(latestRawSnap);
      return;
    }
    if (isDocTarget && docId) {
      onNext(buildMergedDocumentSnapshot(latestRawSnap, colPath, docId));
    } else {
      onNext(buildMergedQuerySnapshot(latestRawSnap, colPath));
    }
  };

  const handleRawNext = (snap: any) => {
    latestRawSnap = snap;
    emitSnapshot();
  };

  const unsubRaw = options
    ? (rawOnSnapshot as any)(target, options, handleRawNext, onError)
    : (rawOnSnapshot as any)(target, handleRawNext, onError);

  const handleSandboxEvent = () => {
    if (latestRawSnap) {
      emitSnapshot();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('riskcart_demo_sandbox_updated', handleSandboxEvent);
    window.addEventListener('riskcart_demo_mode_changed', handleSandboxEvent);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('riskcart_demo_sandbox_updated', handleSandboxEvent);
      window.removeEventListener('riskcart_demo_mode_changed', handleSandboxEvent);
    }
    unsubRaw();
  };
}) as any;

export const getDocs: typeof rawGetDocs = (async (target: any) => {
  const rawSnap = await rawGetDocs(target);
  if (!isDemoModeActive()) {
    return rawSnap;
  }
  const colPath = extractTargetPath(target);
  return buildMergedQuerySnapshot(rawSnap, colPath);
}) as any;

export const getDoc: typeof rawGetDoc = (async (docRef: any) => {
  const rawSnap = await rawGetDoc(docRef);
  if (!isDemoModeActive()) {
    return rawSnap;
  }
  const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
  return buildMergedDocumentSnapshot(rawSnap, colPath, docId);
}) as any;

// Wrapped Write Operations (Isolated to sessionStorage when in Demo Mode; 100% live Firestore when not in Demo Mode)
export const setDoc: typeof rawSetDoc = (async (docRef: any, data: any, options?: any) => {
  if (!isDemoModeActive()) {
    return rawSetDoc(docRef, data, options);
  }
  const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
  if (colPath && docId) {
    const isMerge = Boolean(options?.merge || options?.mergeFields);
    recordSandboxUpsert(colPath, docId, data, isMerge);
  }
}) as any;

export const addDoc: typeof rawAddDoc = (async (colRef: any, data: any) => {
  if (!isDemoModeActive()) {
    return rawAddDoc(colRef, data);
  }
  const colPath = extractTargetPath(colRef);
  const generatedId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (colPath) {
    recordSandboxUpsert(colPath, generatedId, { id: generatedId, ...data }, false);
  }
  return {
    id: generatedId,
    path: `${colPath}/${generatedId}`,
    __rcPath: `${colPath}/${generatedId}`,
  };
}) as any;

export const updateDoc: typeof rawUpdateDoc = (async (docRef: any, data: any, ...moreFields: any[]) => {
  if (!isDemoModeActive()) {
    return (rawUpdateDoc as any)(docRef, data, ...moreFields);
  }
  const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
  if (colPath && docId) {
    let patchObj: Record<string, any> = {};
    if (typeof data === 'string') {
      patchObj[data] = moreFields[0];
      for (let i = 1; i < moreFields.length; i += 2) {
        if (typeof moreFields[i] === 'string') {
          patchObj[moreFields[i]] = moreFields[i + 1];
        }
      }
    } else if (data && typeof data === 'object') {
      patchObj = data;
    }
    recordSandboxUpsert(colPath, docId, patchObj, true);
  }
}) as any;

export const deleteDoc: typeof rawDeleteDoc = (async (docRef: any) => {
  if (!isDemoModeActive()) {
    return rawDeleteDoc(docRef);
  }
  const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
  if (colPath && docId) {
    recordSandboxDelete(colPath, docId);
  }
}) as any;

export const writeBatch: typeof rawWriteBatch = ((firestore: any) => {
  if (!isDemoModeActive()) {
    return rawWriteBatch(firestore);
  }
  const ops: Array<() => void> = [];
  return {
    set(docRef: any, data: any, options?: any) {
      ops.push(() => {
        const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
        if (colPath && docId) {
          recordSandboxUpsert(colPath, docId, data, Boolean(options?.merge || options?.mergeFields));
        }
      });
      return this;
    },
    update(docRef: any, data: any) {
      ops.push(() => {
        const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
        if (colPath && docId && data && typeof data === 'object') {
          recordSandboxUpsert(colPath, docId, data, true);
        }
      });
      return this;
    },
    delete(docRef: any) {
      ops.push(() => {
        const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
        if (colPath && docId) {
          recordSandboxDelete(colPath, docId);
        }
      });
      return this;
    },
    async commit() {
      ops.forEach((fn) => fn());
    },
  } as any;
}) as any;

export const runTransaction: typeof rawRunTransaction = (async (firestore: any, updateFunction: any, options?: any) => {
  if (!isDemoModeActive()) {
    return rawRunTransaction(firestore, updateFunction, options);
  }
  const pendingWrites: Array<() => void> = [];
  const mockTransaction = {
    async get(docRef: any) {
      return getDoc(docRef);
    },
    set(docRef: any, data: any, setOptions?: any) {
      pendingWrites.push(() => {
        const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
        if (colPath && docId) {
          recordSandboxUpsert(colPath, docId, data, Boolean(setOptions?.merge || setOptions?.mergeFields));
        }
      });
      return this;
    },
    update(docRef: any, data: any) {
      pendingWrites.push(() => {
        const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
        if (colPath && docId && data && typeof data === 'object') {
          recordSandboxUpsert(colPath, docId, data, true);
        }
      });
      return this;
    },
    delete(docRef: any) {
      pendingWrites.push(() => {
        const { colPath, docId } = splitDocPath(extractTargetPath(docRef));
        if (colPath && docId) {
          recordSandboxDelete(colPath, docId);
        }
      });
      return this;
    },
  };
  const res = await updateFunction(mockTransaction);
  pendingWrites.forEach((fn) => fn());
  return res;
}) as any;

export const sandboxOnSnapshot = onSnapshot;
export const sandboxGetDocs = getDocs;
export const sandboxGetDoc = getDoc;
export const sandboxSetDoc = setDoc;
export const sandboxAddDoc = addDoc;
export const sandboxUpdateDoc = updateDoc;
export const sandboxDeleteDoc = deleteDoc;
