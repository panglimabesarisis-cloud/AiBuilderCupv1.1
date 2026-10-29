import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  MenuGroupConfig,
  MenuItemConfig,
  SidebarMenuStructure,
  AICustomPageSchema,
  getLocalMenuStructure,
  buildResolvedMenu,
  applyFocusMenuRemoval,
  saveSidebarMenuStructure,
  resetSidebarMenuStructure,
  saveAiCustomPageToMenu,
  deleteAiCustomPageFromMenu,
  MENU_UPDATED_EVENT,
} from '../services/sidebarMenuService';
import {
  loadAIAgentInstructions,
  updateAIAgentsOrder,
  saveAIAgentInstruction,
  AIAgentInstructionConfig,
} from '../services/aiInstructionStore';
import { getPathForTab } from '../router';

export interface ResolvedSidebarAiAgent {
  id: string;
  slug: string;
  nameId: string;
  nameEn: string;
  customLabel?: string;
  displayName: string;
  visible: boolean;
  latency: string;
  path: string;
  modelId: string;
  badgeText: string;
  movedToGroupId?: string;
  rawAgent: AIAgentInstructionConfig;
}

export function useSidebarMenu() {
  const [structure, setStructure] = useState<SidebarMenuStructure>(getLocalMenuStructure);
  const [resolvedGroups, setResolvedGroups] = useState<MenuGroupConfig[]>(() =>
    buildResolvedMenu(getLocalMenuStructure())
  );
  const [rawAiAgents, setRawAiAgents] = useState<AIAgentInstructionConfig[]>(() =>
    loadAIAgentInstructions()
  );
  const [loading, setLoading] = useState<boolean>(false);

  // Re-resolve groups whenever structure updates
  const updateStructureState = useCallback((next: SidebarMenuStructure) => {
    const { structure: effective } = applyFocusMenuRemoval(next);
    setStructure(effective);
    setResolvedGroups(buildResolvedMenu(effective));
  }, []);

  // Listen to AI Agent Instructions updates (from Firestore ai_agents or local edits)
  useEffect(() => {
    const handleAiSync = () => {
      setRawAiAgents(loadAIAgentInstructions());
    };
    window.addEventListener('riskcart_ai_instructions_updated', handleAiSync);
    return () => window.removeEventListener('riskcart_ai_instructions_updated', handleAiSync);
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
            if (!data.focusRemovedG1C8) {
              const { structure: migrated } = applyFocusMenuRemoval(data);
              updateStructureState(migrated);
              void saveSidebarMenuStructure(migrated);
              return;
            }
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

  // Resolved AI Agents list (ordered by structure.aiAgentsOrder, then agent.orderIndex)
  const aiAgents = useMemo<ResolvedSidebarAiAgent[]>(() => {
    const savedOrder = Array.isArray(structure.aiAgentsOrder) ? structure.aiAgentsOrder : [];
    const orderMap = new Map<string, number>();
    savedOrder.forEach((key, idx) => {
      orderMap.set(key, idx);
    });

    const sorted = [...rawAiAgents].sort((a, b) => {
      const posA = orderMap.has(a.id)
        ? orderMap.get(a.id)!
        : orderMap.has(a.slug)
        ? orderMap.get(a.slug)!
        : 1000 + (typeof a.orderIndex === 'number' ? a.orderIndex : 999);
      const posB = orderMap.has(b.id)
        ? orderMap.get(b.id)!
        : orderMap.has(b.slug)
        ? orderMap.get(b.slug)!
        : 1000 + (typeof b.orderIndex === 'number' ? b.orderIndex : 999);
      return posA - posB;
    });

    return sorted.map((agent, idx) => {
      const underscoreSlug = agent.slug.replace(/-/g, '_');
      const customLabel =
        structure.aiAgentsCustomLabels?.[agent.id] ||
        structure.aiAgentsCustomLabels?.[agent.slug] ||
        structure.childrenCustomLabels?.[`ai:ai_agent_${agent.id}`] ||
        structure.childrenCustomLabels?.[`ai_agent_${agent.id}`] ||
        structure.childrenCustomLabels?.[`ai:${underscoreSlug}`] ||
        undefined;

      const explicitVis =
        structure.aiAgentsVisible?.[agent.id] !== undefined
          ? structure.aiAgentsVisible[agent.id]
          : structure.aiAgentsVisible?.[agent.slug] !== undefined
          ? structure.aiAgentsVisible[agent.slug]
          : undefined;

      const isVisible = explicitVis !== undefined ? explicitVis : agent.isActive !== false;
      const movedToGroupId = structure.aiAgentsMovedToGroup?.[agent.id];

      return {
        id: agent.id,
        slug: agent.slug,
        nameId: agent.nameId,
        nameEn: agent.nameEn || agent.nameId,
        customLabel,
        displayName: customLabel || agent.nameId,
        visible: isVisible,
        latency: `${130 + ((idx * 17) % 95)}ms`,
        path: getPathForTab('module_ai', agent.slug),
        modelId: agent.modelId || 'gemini-2.5-flash',
        badgeText: agent.badgeText || 'AI AGENT',
        movedToGroupId,
        rawAgent: agent,
      };
    });
  }, [rawAiAgents, structure]);

  const isAiAgentsSectionVisible = structure.aiAgentsVisible?.['__root__'] !== false;
  const aiAgentsSectionCustomLabel = structure.aiAgentsCustomLabels?.['__root__'] || '';

  // Helper actions
  const saveStructure = useCallback(
    async (newStructure: SidebarMenuStructure) => {
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
    },
    [updateStructureState]
  );

  const resetToDefault = useCallback(async () => {
    setLoading(true);
    try {
      const def = await resetSidebarMenuStructure();
      updateStructureState(def);
    } finally {
      setLoading(false);
    }
  }, [updateStructureState]);

  const toggleGroupVisibility = useCallback(
    (groupId: string) => {
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
    },
    [updateStructureState]
  );

  const toggleItemVisibility = useCallback(
    (itemId: string) => {
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
    },
    [updateStructureState]
  );

  const setGroupCustomLabel = useCallback(
    (groupId: string, label: string) => {
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
    },
    [updateStructureState]
  );

  const setItemCustomLabel = useCallback(
    (itemId: string, label: string, groupId?: string) => {
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
    },
    [updateStructureState]
  );

  // AI Agents section & item actions
  const toggleAiAgentsSectionVisibility = useCallback(() => {
    const prev = getLocalMenuStructure();
    const current = prev.aiAgentsVisible?.['__root__'] !== false;
    const next: SidebarMenuStructure = {
      ...prev,
      aiAgentsVisible: {
        ...(prev.aiAgentsVisible || {}),
        __root__: !current,
      },
      updatedAt: new Date().toISOString(),
    };
    updateStructureState(next);
    void saveSidebarMenuStructure(next);
  }, [updateStructureState]);

  const setAiAgentsSectionCustomLabel = useCallback(
    (label: string) => {
      const prev = getLocalMenuStructure();
      const next: SidebarMenuStructure = {
        ...prev,
        aiAgentsCustomLabels: {
          ...(prev.aiAgentsCustomLabels || {}),
          __root__: label.trim(),
        },
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);
    },
    [updateStructureState]
  );

  const toggleAiAgentVisibility = useCallback(
    (agentId: string) => {
      const prev = getLocalMenuStructure();
      const target = aiAgents.find((a) => a.id === agentId || a.slug === agentId);
      const currentVis = target ? target.visible : prev.aiAgentsVisible?.[agentId] !== false;
      const nextVis = !currentVis;

      const next: SidebarMenuStructure = {
        ...prev,
        aiAgentsVisible: {
          ...(prev.aiAgentsVisible || {}),
          [agentId]: nextVis,
          ...(target?.slug ? { [target.slug]: nextVis } : {}),
        },
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);

      if (target) {
        void saveAIAgentInstruction(target.id, target.rawAgent.customInstruction || '', {
          isActive: nextVis,
        });
      }
    },
    [aiAgents, updateStructureState]
  );

  const setAiAgentCustomLabel = useCallback(
    (agentId: string, label: string) => {
      const cleanLabel = label.trim();
      if (!cleanLabel) return;
      const prev = getLocalMenuStructure();
      const target = aiAgents.find((a) => a.id === agentId || a.slug === agentId);
      const underscoreSlug = target?.slug ? target.slug.replace(/-/g, '_') : agentId;

      const next: SidebarMenuStructure = {
        ...prev,
        aiAgentsCustomLabels: {
          ...(prev.aiAgentsCustomLabels || {}),
          [agentId]: cleanLabel,
          ...(target?.slug ? { [target.slug]: cleanLabel } : {}),
        },
        childrenCustomLabels: {
          ...(prev.childrenCustomLabels || {}),
          [`ai_agent_${agentId}`]: cleanLabel,
          [`ai:${underscoreSlug}`]: cleanLabel,
        },
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);

      if (target) {
        void saveAIAgentInstruction(target.id, target.rawAgent.customInstruction || '', {
          nameId: cleanLabel,
        });
      }
    },
    [aiAgents, updateStructureState]
  );

  const reorderAiAgents = useCallback(
    (newOrderIds: string[]) => {
      const prev = getLocalMenuStructure();
      const next: SidebarMenuStructure = {
        ...prev,
        aiAgentsOrder: newOrderIds,
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);

      const agentMap = new Map<string, AIAgentInstructionConfig>();
      rawAiAgents.forEach((a) => {
        agentMap.set(a.id, a);
        agentMap.set(a.slug, a);
      });
      const reorderedRaw: AIAgentInstructionConfig[] = [];
      const visited = new Set<string>();
      newOrderIds.forEach((id) => {
        const found = agentMap.get(id);
        if (found && !visited.has(found.id)) {
          visited.add(found.id);
          reorderedRaw.push(found);
        }
      });
      rawAiAgents.forEach((a) => {
        if (!visited.has(a.id)) {
          reorderedRaw.push(a);
        }
      });
      setRawAiAgents(reorderedRaw);
      void updateAIAgentsOrder(reorderedRaw);
    },
    [rawAiAgents, updateStructureState]
  );

  const moveAiAgent = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const currentOrder = aiAgents.map((a) => a.id);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= currentOrder.length) return;
      const temp = currentOrder[index];
      currentOrder[index] = currentOrder[targetIndex];
      currentOrder[targetIndex] = temp;
      reorderAiAgents(currentOrder);
    },
    [aiAgents, reorderAiAgents]
  );

  const moveAiAgentToGroup = useCallback(
    (agentId: string, targetGroupId: string, targetIndex?: number) => {
      const targetAgent = aiAgents.find((a) => a.id === agentId || a.slug === agentId);
      if (!targetAgent) return;

      const prev = getLocalMenuStructure();
      const resolved = buildResolvedMenu(prev);
      const menuItemId = `ai_agent_${targetAgent.id}`;

      // Remove from any group where it was previously placed as a custom item
      const nextCustomMenuItems: Record<string, MenuItemConfig[]> = {
        ...(prev.customMenuItems || {}),
      };
      const nextChildOrder: Record<string, string[]> = {
        ...(prev.childrenOrderByGroup || {}),
      };

      for (const g of resolved) {
        if (nextCustomMenuItems[g.id]) {
          nextCustomMenuItems[g.id] = nextCustomMenuItems[g.id].filter(
            (item) => item.id !== menuItemId
          );
        }
        if (nextChildOrder[g.id]) {
          nextChildOrder[g.id] = nextChildOrder[g.id].filter((id) => id !== menuItemId);
        }
      }

      const nextMovedMap: Record<string, string> = {
        ...(prev.aiAgentsMovedToGroup || {}),
      };

      // If returning to 'ai_agents' (default Agen AI nested section), clear movedToGroupId
      if (targetGroupId === 'ai_agents') {
        delete nextMovedMap[targetAgent.id];
        const next: SidebarMenuStructure = {
          ...prev,
          customMenuItems: nextCustomMenuItems,
          childrenOrderByGroup: nextChildOrder,
          aiAgentsMovedToGroup: nextMovedMap,
          updatedAt: new Date().toISOString(),
        };
        updateStructureState(next);
        void saveSidebarMenuStructure(next);
        return;
      }

      const targetGroup = resolved.find((g) => g.id === targetGroupId);
      if (!targetGroup) return;

      const newMenuItem: MenuItemConfig = {
        id: menuItemId,
        labelId: targetAgent.displayName,
        labelEn: targetAgent.nameEn || targetAgent.displayName,
        path: targetAgent.path,
        badge: targetAgent.latency,
        visible: true,
        customLabel: targetAgent.customLabel,
      };

      const groupCustomList = Array.isArray(nextCustomMenuItems[targetGroupId])
        ? [...nextCustomMenuItems[targetGroupId].filter((c) => c.id !== menuItemId)]
        : [];
      groupCustomList.push(newMenuItem);
      nextCustomMenuItems[targetGroupId] = groupCustomList;

      const baseOrder = Array.isArray(nextChildOrder[targetGroupId])
        ? [...nextChildOrder[targetGroupId].filter((id) => id !== menuItemId)]
        : targetGroup.children.map((c) => c.id).filter((id) => id !== menuItemId);

      const insertAt =
        targetIndex !== undefined && targetIndex >= 0 && targetIndex <= baseOrder.length
          ? targetIndex
          : baseOrder.length;
      baseOrder.splice(insertAt, 0, menuItemId);
      nextChildOrder[targetGroupId] = baseOrder;
      nextMovedMap[targetAgent.id] = targetGroupId;

      const next: SidebarMenuStructure = {
        ...prev,
        customMenuItems: nextCustomMenuItems,
        childrenOrderByGroup: nextChildOrder,
        aiAgentsMovedToGroup: nextMovedMap,
        childrenVisible: {
          ...(prev.childrenVisible || {}),
          [menuItemId]: true,
        },
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);
    },
    [aiAgents, updateStructureState]
  );

  const moveGroup = useCallback(
    (index: number, direction: 'up' | 'down') => {
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
    },
    [updateStructureState]
  );

  const moveItem = useCallback(
    (groupId: string, itemIndex: number, direction: 'up' | 'down') => {
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
    },
    [updateStructureState]
  );

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

      const nextMovedMap: Record<string, string> = {
        ...(prev.aiAgentsMovedToGroup || {}),
      };
      if (movedItem.id.startsWith('ai_agent_')) {
        const rawAgentId = movedItem.id.replace(/^ai_agent_/, '');
        nextMovedMap[rawAgentId] = targetGroupId;
      }

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
        aiAgentsMovedToGroup: nextMovedMap,
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);
    },
    [updateStructureState]
  );

  const reorderGroups = useCallback(
    (newOrder: string[]) => {
      const prev = getLocalMenuStructure();
      const next: SidebarMenuStructure = {
        ...prev,
        groupsOrder: newOrder,
        updatedAt: new Date().toISOString(),
      };
      updateStructureState(next);
      void saveSidebarMenuStructure(next);
    },
    [updateStructureState]
  );

  const reorderItems = useCallback(
    (groupId: string, newOrder: string[]) => {
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
    },
    [updateStructureState]
  );

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
    aiAgents,
    isAiAgentsSectionVisible,
    aiAgentsSectionCustomLabel,
    customPages: structure.customPages || {},
    loading,
    saveStructure,
    resetToDefault,
    toggleGroupVisibility,
    toggleItemVisibility,
    setGroupCustomLabel,
    setItemCustomLabel,
    toggleAiAgentsSectionVisibility,
    setAiAgentsSectionCustomLabel,
    toggleAiAgentVisibility,
    setAiAgentCustomLabel,
    moveAiAgent,
    reorderAiAgents,
    moveAiAgentToGroup,
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

