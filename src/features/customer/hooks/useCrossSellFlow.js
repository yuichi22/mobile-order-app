// src/features/customer/hooks/useCrossSellFlow.js
import { useCallback, useMemo, useRef, useState } from 'react';

const normalizeId = (value) => String(value || '').trim();

const normalizeArray = (value) => (
  Array.isArray(value) ? value : []
);

const getItemCategoryId = (item) => normalizeId(item?.category || item?.categoryId);

const getGroupById = (groups, groupId) => (
  groups.find((group) => normalizeId(group.id) === normalizeId(groupId)) || null
);

const getCategoryById = (categories, categoryId) => (
  categories.find((category) => normalizeId(category.id) === normalizeId(categoryId)) || null
);

const isCategoryInGroup = (categoryId, group) => {
  if (!group || !Array.isArray(group.categoryIds)) return false;

  return group.categoryIds
    .map((id) => normalizeId(id))
    .includes(normalizeId(categoryId));
};

const flowHasTriggerForItem = ({ flow, item, groups }) => {
  const categoryId = getItemCategoryId(item);

  if (!categoryId || flow?.enabled === false) return false;

  if (flow.triggerCategoryId && normalizeId(flow.triggerCategoryId) === categoryId) {
    return true;
  }

  if (flow.triggerGroupId) {
    const group = getGroupById(groups, flow.triggerGroupId);
    return isCategoryInGroup(categoryId, group);
  }

  return false;
};

const getAllowedCategoryIdsForStep = (step, groups) => {
  if (!step) return [];

  if (step.type === 'category') {
    const categoryId = normalizeId(step.categoryId);
    return categoryId ? [categoryId] : [];
  }

  if (step.type === 'group') {
    const group = getGroupById(groups, step.groupId);
    return Array.isArray(group?.categoryIds)
      ? group.categoryIds.map((id) => normalizeId(id)).filter(Boolean)
      : [];
  }

  return [];
};

const resolveStepGroup = (step, groups) => {
  if (step?.type !== 'group') return null;
  return getGroupById(groups, step.groupId);
};

const resolveStepCategory = (step, categories) => {
  if (step?.type !== 'category') return null;
  return getCategoryById(categories, step.categoryId);
};

const resolveStepTitle = ({ step, group, category }) => {
  if (step?.title) return step.title;

  if (step?.type === 'group' && group?.name) {
    return `${group.name}はいかがですか？`;
  }

  if (step?.type === 'category' && category?.name) {
    return `${category.name}はいかがですか？`;
  }

  return 'こちらもいかがですか？';
};

const resolveStepDescription = ({ step }) => {
  if (step?.description) return step.description;

  return '';
};

const sortCategories = (categories) => (
  [...categories].sort((left, right) => {
    const leftOrder = Number(left?.order ?? left?.sortOrder ?? 9999);
    const rightOrder = Number(right?.order ?? right?.sortOrder ?? 9999);

    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return String(left?.name || left?.id || '').localeCompare(
      String(right?.name || right?.id || ''),
      'ja'
    );
  })
);

export const useCrossSellFlow = ({
  crossSellSettings,
  categories,
  onMoveCategory,
  onStartFlow,
  onCompleteFlow
}) => {
  const [activeFlow, setActiveFlow] = useState(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [activeCrossSellOfferCategoryIds, setActiveCrossSellOfferCategoryIds] = useState([]);
  const [activeCrossSellOfferGroups, setActiveCrossSellOfferGroups] = useState([]);
  const acceptedDuringFlowRef = useRef(false);

  const safeCategories = useMemo(() => (
    Array.isArray(categories) ? categories : []
  ), [categories]);

  const orderedCategories = useMemo(() => (
    sortCategories(safeCategories)
  ), [safeCategories]);

  const groups = useMemo(() => (
    Array.isArray(crossSellSettings?.groups) ? crossSellSettings.groups : []
  ), [crossSellSettings]);

  const flows = useMemo(() => (
    Array.isArray(crossSellSettings?.flows)
      ? crossSellSettings.flows.filter((flow) => flow?.enabled !== false)
      : []
  ), [crossSellSettings]);

  const isEnabled = Boolean(crossSellSettings?.enabled);

  const collectOfferCategoryIdsForFlow = useCallback((flow) => {
    const ids = new Set();

    normalizeArray(flow?.steps).forEach((step) => {
      getAllowedCategoryIdsForStep(step, groups).forEach((categoryId) => {
        const normalizedId = normalizeId(categoryId);
        if (normalizedId) ids.add(normalizedId);
      });
    });

    return Array.from(ids);
  }, [groups]);

  const collectOfferGroupsForFlow = useCallback((flow) => {
    const groupMap = new Map();

    normalizeArray(flow?.steps).forEach((step) => {
      if (step?.type === 'group' && step.groupId) {
        const group = resolveStepGroup(step, groups);
        const categoryIds = normalizeArray(group?.categoryIds)
          .map((categoryId) => normalizeId(categoryId))
          .filter(Boolean);

        if (categoryIds.length > 0) {
          const groupId = normalizeId(step.groupId);
          groupMap.set(`group:${groupId}`, {
            key: `group:${groupId}`,
            type: 'group',
            groupId,
            name: group?.name || '',
            categoryIds
          });
        }

        return;
      }

      const categoryId = normalizeId(step?.categoryId);
      if (categoryId) {
        groupMap.set(`category:${categoryId}`, {
          key: `category:${categoryId}`,
          type: 'category',
          categoryId,
          name: resolveStepCategory(step, safeCategories)?.name || '',
          categoryIds: [categoryId]
        });
      }
    });

    return Array.from(groupMap.values());
  }, [groups, safeCategories]);

  const activeStep = useMemo(() => {
    if (!activeFlow || !Array.isArray(activeFlow.steps)) return null;
    return activeFlow.steps[activeStepIndex] || null;
  }, [activeFlow, activeStepIndex]);

  const allowedCategoryIds = useMemo(() => (
    getAllowedCategoryIdsForStep(activeStep, groups)
  ), [activeStep, groups]);

  const activeGroup = useMemo(() => (
    resolveStepGroup(activeStep, groups)
  ), [activeStep, groups]);

  const activeCategory = useMemo(() => (
    resolveStepCategory(activeStep, safeCategories)
  ), [activeStep, safeCategories]);

  const prompt = useMemo(() => {
    if (!activeStep) return null;

    return {
      title: resolveStepTitle({
        step: activeStep,
        group: activeGroup,
        category: activeCategory
      }),
  description: resolveStepDescription({
    step: activeStep
  }),
      skipLabel: activeStep.skipLabel || 'おすすめを閉じる',
      stepType: activeStep.type,
      serviceTimingEnabled: activeFlow?.serviceTimingEnabled === true
    };
  }, [activeCategory, activeFlow, activeGroup, activeStep]);

    const moveToFirstAllowedCategory = useCallback((categoryIds) => {
    const allowedIds = categoryIds.map((id) => normalizeId(id)).filter(Boolean);

    const firstCategory = categories.find((category) => (
        allowedIds.includes(normalizeId(category.id))
    ));

    if (firstCategory?.id) {
        onMoveCategory?.(firstCategory.id);
        return;
    }

    const fallbackId = allowedIds[0];
    if (fallbackId) {
        onMoveCategory?.(fallbackId);
    }
    }, [categories, onMoveCategory]);

  const finishFlow = useCallback(() => {
    const completedByAcceptedItem = acceptedDuringFlowRef.current;

    setActiveFlow(null);
    setActiveStepIndex(0);
    acceptedDuringFlowRef.current = false;

    onCompleteFlow?.({
      completedByAcceptedItem
    });
  }, [onCompleteFlow]);

  const cancelFlow = useCallback(() => {
    setActiveFlow(null);
    setActiveStepIndex(0);
    acceptedDuringFlowRef.current = false;
  }, []);

  const goToStep = useCallback((flow, stepIndex) => {
    const nextStep = flow?.steps?.[stepIndex];

    if (!nextStep) {
      finishFlow();
      return;
    }

    if (stepIndex === 0) {
      acceptedDuringFlowRef.current = false;
    }

    const nextAllowedCategoryIds = getAllowedCategoryIdsForStep(nextStep, groups);

    setActiveFlow(flow);
    setActiveStepIndex(stepIndex);
    moveToFirstAllowedCategory(nextAllowedCategoryIds);
  }, [finishFlow, groups, moveToFirstAllowedCategory]);

  const goToNextStep = useCallback(() => {
    if (!activeFlow) return;

    goToStep(activeFlow, activeStepIndex + 1);
  }, [activeFlow, activeStepIndex, goToStep]);

  const skipCurrentStep = useCallback(() => {
    goToNextStep();
  }, [goToNextStep]);

  const startFlowForItem = useCallback((item) => {
    if (!isEnabled || !item) return false;

    const matchedFlow = flows.find((flow) => (
      flowHasTriggerForItem({ flow, item, groups })
    ));

    if (!matchedFlow || !Array.isArray(matchedFlow.steps) || matchedFlow.steps.length === 0) {
      return false;
    }

    const offerCategoryIds = collectOfferCategoryIdsForFlow(matchedFlow);
    const offerGroups = collectOfferGroupsForFlow(matchedFlow);

    setActiveCrossSellOfferCategoryIds(offerCategoryIds);
    setActiveCrossSellOfferGroups(offerGroups);

    onStartFlow?.({ item, flow: matchedFlow, offerCategoryIds, offerGroups });

    goToStep(matchedFlow, 0);
    return true;
  }, [collectOfferCategoryIdsForFlow, collectOfferGroupsForFlow, flows, goToStep, groups, isEnabled, onStartFlow]);

  const handleCartItemAdded = useCallback((item) => {
    if (!isEnabled || !item) return false;

    const isCrossSellPricedItem = item?.appliedPriceMode === 'crossSell';

    if (!activeStep && isCrossSellPricedItem) {
      return false;
    }

    if (!activeStep) {
      return startFlowForItem(item);
    }

    const categoryId = getItemCategoryId(item);

    if (allowedCategoryIds.includes(categoryId)) {
      acceptedDuringFlowRef.current = true;
      goToNextStep();
      return true;
    }

    // 現在のStepではないが、同じ料理クロスセル枠内の商品が追加された場合は、
    // 新しい別フローにはせず、現在のStepのおすすめへ戻す。
    // 例：料理 → スイーツ追加時、残っているドリンクおすすめへ戻す。
    if (activeCrossSellOfferCategoryIds.includes(categoryId)) {
      moveToFirstAllowedCategory(allowedCategoryIds);
      return true;
    }

    return false;
  }, [
    activeCrossSellOfferCategoryIds,
    activeStep,
    allowedCategoryIds,
    goToNextStep,
    isEnabled,
    moveToFirstAllowedCategory,
    startFlowForItem
  ]);

  const isCategoryAllowed = useCallback((categoryId) => {
    if (!activeStep) return true;
    return allowedCategoryIds.includes(normalizeId(categoryId));
  }, [activeStep, allowedCategoryIds]);

  return {
    isCrossSellActive: Boolean(activeStep),
    activeCrossSellStep: activeStep,
    activeCrossSellStepIndex: activeStepIndex,
    activeCrossSellPrompt: prompt,
    allowedCrossSellCategoryIds: allowedCategoryIds,
    activeCrossSellOfferCategoryIds,
    activeCrossSellOfferGroups,
    isCategoryAllowed,
    handleCartItemAdded,
    skipCurrentCrossSellStep: skipCurrentStep,
    finishCrossSellFlow: finishFlow,
    cancelCrossSellFlow: cancelFlow
  };
};