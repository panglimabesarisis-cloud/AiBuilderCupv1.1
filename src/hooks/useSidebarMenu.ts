import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ACTIVE_STORE_ID } from '../config/store';
import {
  MenuGroupConfig,
  SidebarMenuStructure,
  AICustomPageSchema,
  getLocalMenuStructure,
  buildResolvedMenu,
  saveSidebarMenuStructure,
  resetSidebarMenuStructure,
  saveAiCustomPageToMenu,
  deleteAiCustomPageFromMenu,
  MENU_UPDATED_EVENT,
} from '../services/sidebarMenuService';

export function useSidebarMenu() {
  const [structure, setStructure] = useState<SidebarMenuStructure>(getLocalMenuStructure);
  const [resolvedGroups, setResolvedGroups] = useState<MenuGroupConfig[]>(() =>
    buildResolvedMenu(getLocalMenuStructure())
  );
  const [loading, setLoading] = useState<boolean>(false);

  // Re-resolve groups whenever structure updates
  const updateStructureState = useCallback((next: SidebarMenuStructure) => {
    setStructure(next);
    setResolvedGroups(buildResolvedMenu(next));
  }, []);

  // 1. Listen to instant custom window event and storage event
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const customEvt = e as CustomEvent<SidebarMenuStructure>;
      if (customEvt.detail) {
        updateStructureState(customEvt.detail);
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'riskcart_wp_sidebar_menu_v1' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          updateStructureState(parsed);
        } catch {}
      }
    };

    window.addEventListener(MENU_UPDATED_EVENT, handleCustomEvent);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener(MENU_UPDATED_EVENT, handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [updateStructureState]);

  // 2. Real-time subscription to Firestore (guarded against older snapshots / rejected-write rollbacks)
  useEffect(() => {
    const docRef = doc(db, 'settings', 'sidebar_menu');
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as SidebarMenuStructure;
          if (Array.isArray(data.groupsOrder) && data.groupsOrder.length > 0) {
            const localCurrent = getLocalMenuStructure();
            const remoteTime = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
            const localTime = localCurrent?.updatedAt ? new Date(localCurrent.updatedAt).getTime() : 0;
            // Only apply remote snapshot if it is newer than our local saved structure
            if (remoteTime > localTime) {
              updateStructureState(data);
              try {
                localStorage.setItem('riskcart_wp_sidebar_menu_v1', JSON.stringify(data));
              } catch {}
            }
          }
        }
      },
      (err) => {
        console.warn('Firestore sidebar_menu listener warning:', err);
      }
    );

    return () => unsub();
  }, [updateStructureState]);

  // Helper actions
  const saveStructure = useCallback(async (newStructure: SidebarMenuStructure) => {
    setLoading(true);
    try {
      const next: SidebarMenuStructure = {
        ...newStructure,
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      await saveSidebarMenuStructure(next);
    } finally {
      setLoading(false);
    }
  }, [updateStructureState]);

  const resetToDefault = useCallback(async () => {
    setLoading(true);
    try {
      const def = await resetSidebarMenuStructure();
      updateStructureState(def);
    } finally {
      setLoading(false);
    }
  }, [updateStructureState]);

  const toggleGroupVisibility = useCallback((groupId: string) => {
    const prev = getLocalMenuStructure();
    const current = prev.groupVisible?.[groupId] !== false;
    const next: SidebarMenuStructure = {
      ...prev,
      groupVisible: {
        ...prev.groupVisible,
        [groupId]: !current,
      },
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const toggleItemVisibility = useCallback((itemId: string) => {
    const prev = getLocalMenuStructure();
    const current = prev.childrenVisible?.[itemId] !== false;
    const next: SidebarMenuStructure = {
      ...prev,
      childrenVisible: {
        ...prev.childrenVisible,
        [itemId]: !current,
      },
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const setGroupCustomLabel = useCallback((groupId: string, label: string) => {
    const prev = getLocalMenuStructure();
    const next: SidebarMenuStructure = {
      ...prev,
      groupCustomLabels: {
        ...prev.groupCustomLabels,
        [groupId]: label.trim(),
      },
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const setItemCustomLabel = useCallback((itemId: string, label: string, groupId?: string) => {
    const prev = getLocalMenuStructure();
    const cleanLabel = label.trim();
    const nextLabels: Record<string, string> = {
      ...prev.childrenCustomLabels,
      [itemId]: cleanLabel,
    };
    if (groupId) {
      nextLabels[`${groupId}:${itemId}`] = cleanLabel;
    }
    const next: SidebarMenuStructure = {
      ...prev,
      childrenCustomLabels: nextLabels,
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const moveGroup = useCallback((index: number, direction: 'up' | 'down') => {
    const prev = getLocalMenuStructure();
    const resolved = buildResolvedMenu(prev);
    const currentOrder = resolved.map((g) => g.id);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;

    const temp = currentOrder[index];
    currentOrder[index] = currentOrder[targetIndex];
    currentOrder[targetIndex] = temp;

    const next: SidebarMenuStructure = {
      ...prev,
      groupsOrder: currentOrder,
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const moveItem = useCallback((groupId: string, itemIndex: number, direction: 'up' | 'down') => {
    const prev = getLocalMenuStructure();
    const resolved = buildResolvedMenu(prev);
    const groupObj = resolved.find((g) => g.id === groupId);
    const childOrder = groupObj
      ? groupObj.children.map((c) => c.id)
      : [...(prev.childrenOrderByGroup?.[groupId] || [])];
    const targetIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
    if (targetIndex < 0 || targetIndex >= childOrder.length) return;

    const temp = childOrder[itemIndex];
    childOrder[itemIndex] = childOrder[targetIndex];
    childOrder[targetIndex] = temp;

    const next: SidebarMenuStructure = {
      ...prev,
      childrenOrderByGroup: {
        ...prev.childrenOrderByGroup,
        [groupId]: childOrder,
      },
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const moveItemAcrossGroups = useCallback(
    (sourceGroupId: string, sourceIndex: number, targetGroupId: string, targetIndex?: number) => {
      const prev = getLocalMenuStructure();
      const resolved = buildResolvedMenu(prev);
      const sourceGroup = resolved.find((g) => g.id === sourceGroupId);
      const targetGroup = resolved.find((g) => g.id === targetGroupId);
      if (!sourceGroup || !targetGroup) return;

      const sourceChildren = [...sourceGroup.children];
      const movedItem = sourceChildren[sourceIndex];
      if (!movedItem) return;

      if (sourceGroupId === targetGroupId) {
        const order = sourceChildren.map((c) => c.id);
        const [removed] = order.splice(sourceIndex, 1);
        const destIdx = targetIndex !== undefined ? targetIndex : order.length;
        order.splice(destIdx, 0, removed);
        const next: SidebarMenuStructure = {
          ...prev,
          childrenOrderByGroup: {
            ...prev.childrenOrderByGroup,
            [sourceGroupId]: order,
          },
          updatedAt: new Date().toISOString(),
        };
        updateStructureState(next);
        void saveSidebarMenuStructure(next);
        return;
      }

      const nextSourceOrder = sourceChildren
        .filter((_, idx) => idx !== sourceIndex)
        .map((c) => c.id);

      const targetOrder = targetGroup.children
        .map((c) => c.id)
        .filter((id) => id !== movedItem.id);
      const insertAt =
        targetIndex !== undefined && targetIndex >= 0 && targetIndex <= targetOrder.length
          ? targetIndex
          : targetOrder.length;
      targetOrder.splice(insertAt, 0, movedItem.id);

      // Also persist moved item metadata in customMenuItems[targetGroupId] so even shared IDs (like 'umum') keep their exact path/label
      const targetCustomList = Array.isArray(prev.customMenuItems?.[targetGroupId])
        ? [...prev.customMenuItems![targetGroupId].filter((c) => c.id !== movedItem.id)]
        : [];
      targetCustomList.push(movedItem);

      const next: SidebarMenuStructure = {
        ...prev,
        childrenOrderByGroup: {
          ...prev.childrenOrderByGroup,
          [sourceGroupId]: nextSourceOrder,
          [targetGroupId]: targetOrder,
        },
        customMenuItems: {
          ...(prev.customMenuItems || {}),
          [targetGroupId]: targetCustomList,
        },
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);
    },
    [updateStructureState]
  );

  const reorderGroups = useCallback((newOrder: string[]) => {
    const prev = getLocalMenuStructure();
    const next: SidebarMenuStructure = {
      ...prev,
      groupsOrder: newOrder,
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const reorderItems = useCallback((groupId: string, newOrder: string[]) => {
    const prev = getLocalMenuStructure();
    const next: SidebarMenuStructure = {
      ...prev,
      childrenOrderByGroup: {
        ...prev.childrenOrderByGroup,
        [groupId]: newOrder,
      },
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const addCustomPage = useCallback(
    async (schema: AICustomPageSchema) => {
      setLoading(true);
      try {
        const next = await saveAiCustomPageToMenu(structure, schema);
        updateStructureState(next);
        return next;
      } finally {
        setLoading(false);
      }
    },
    [structure, updateStructureState]
  );

  const deleteCustomPage = useCallback(
    async (slug: string) => {
      setLoading(true);
      try {
        const next = await deleteAiCustomPageFromMenu(structure, slug);
        updateStructureState(next);
        return next;
      } finally {
        setLoading(false);
      }
    },
    [structure, updateStructureState]
  );

  return {
    groups: resolvedGroups,
    structure,
    customPages: structure.customPages || {},
    loading,
    saveStructure,
    resetToDefault,
    toggleGroupVisibility,
    toggleItemVisibility,
    setGroupCustomLabel,
    setItemCustomLabel,
    moveGroup,
    moveItem,
    moveItemAcrossGroups,
    reorderGroups,
    reorderItems,
    addCustomPage,
    deleteCustomPage,
  };
}

export const useSidebarMenuConfig = useSidebarMenu;
