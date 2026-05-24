import React, { useEffect, useMemo, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  ChevronDown,
  ChevronUp,
  GitBranch,
  Layers3,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2
} from 'lucide-react';

import { db } from '../../../../shared/api/firebase/client';
import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';

const createId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const VISIBILITY_OPTIONS = [
  {
    value: 'always',
    label: '通常表示',
    description: '通常のカテゴリータブに表示します'
  },
  {
    value: 'crossSellOnly',
    label: 'クロスセル時のみ',
    description: '通常時は非表示、クロスセル提案中だけ表示します'
  },
  {
    value: 'hidden',
    label: '非表示',
    description: '顧客画面には表示しません'
  }
];

const STEP_TYPE_OPTIONS = [
  { value: 'category', label: 'カテゴリー' },
  { value: 'group', label: 'グループ' }
];

const getCategoryName = (categories, categoryId) => (
  categories.find((category) => String(category.id) === String(categoryId))?.name || categoryId || '未設定'
);

const getGroupName = (groups, groupId) => (
  groups.find((group) => String(group.id) === String(groupId))?.name || groupId || '未設定'
);

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const createBlankGroup = () => ({
  id: createId('group'),
  name: '',
  categoryIds: []
});

const createBlankStep = () => ({
  id: createId('step'),
  type: 'category',
  categoryId: '',
  groupId: '',
  title: '',
  description: '',
  skipLabel: 'おすすめを閉じる'
});

const createBlankFlow = () => ({
  id: createId('flow'),
  enabled: true,
  name: '',
  triggerType: 'category',
  triggerCategoryId: '',
  triggerGroupId: '',
  serviceTimingEnabled: false,
  steps: [createBlankStep()]
});

const normalizeFlowForForm = (flow) => {
  const hasGroupTrigger = Boolean(flow?.triggerGroupId);

  return {
    id: flow?.id || createId('flow'),
    enabled: flow?.enabled !== false,
    name: flow?.name || '',
    triggerType: hasGroupTrigger ? 'group' : 'category',
    triggerCategoryId: flow?.triggerCategoryId || '',
    triggerGroupId: flow?.triggerGroupId || '',
    serviceTimingEnabled: flow?.serviceTimingEnabled === true,
    steps: normalizeArray(flow?.steps).length > 0
      ? normalizeArray(flow.steps).map((step) => ({
          id: step?.id || createId('step'),
          type: step?.type === 'group' ? 'group' : 'category',
          categoryId: step?.categoryId || '',
          groupId: step?.groupId || '',
          title: step?.title || '',
          description: step?.description || '',
          skipLabel: step?.skipLabel || 'おすすめを閉じる'
        }))
      : [createBlankStep()]
  };
};

const prepareFlowForSave = (flow) => {
  const cleanSteps = normalizeArray(flow.steps)
    .map((step) => ({
      id: step.id || createId('step'),
      type: step.type === 'group' ? 'group' : 'category',
      ...(step.type === 'group'
        ? { groupId: step.groupId || '' }
        : { categoryId: step.categoryId || '' }),
      ...(step.title ? { title: step.title } : {}),
      ...(step.description ? { description: step.description } : {}),
      skipLabel: step.skipLabel || 'おすすめを閉じる'
    }))
    .filter((step) => (
      step.type === 'group'
        ? Boolean(step.groupId)
        : Boolean(step.categoryId)
    ));

  return {
    id: flow.id || createId('flow'),
    enabled: flow.enabled !== false,
    ...(flow.name ? { name: flow.name } : {}),
    ...(flow.triggerType === 'group'
      ? { triggerGroupId: flow.triggerGroupId || '' }
      : { triggerCategoryId: flow.triggerCategoryId || '' }),
    serviceTimingEnabled: flow.serviceTimingEnabled === true,
    steps: cleanSteps
  };
};

const CategoryVisibilityEditor = ({
  categories,
  visibilityDraft,
  setVisibilityDraft
}) => {
  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-bold text-gray-400">
        カテゴリーがまだありません
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {categories.map((category) => {
        const currentValue = visibilityDraft[category.id] || category.customerTabVisibility || 'always';

        return (
          <div
            key={category.id}
            className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-gray-800">
                  {category.name || category.id}
                </p>
                <p className="mt-1 text-xs font-bold text-gray-400">
                  ID: {category.id}
                </p>
              </div>

              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black text-gray-500">
                {VISIBILITY_OPTIONS.find((option) => option.value === currentValue)?.label || '通常表示'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {VISIBILITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setVisibilityDraft((previous) => ({
                      ...previous,
                      [category.id]: option.value
                    }));
                  }}
                  className={`rounded-xl border px-3 py-2 text-left transition-all ${
                    currentValue === option.value
                      ? 'border-green-300 bg-green-50 text-green-800 ring-2 ring-green-100'
                      : 'border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <div className="text-xs font-black">
                    {option.label}
                  </div>
                  <div className="mt-1 text-[10px] font-bold leading-relaxed opacity-70">
                    {option.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const GroupEditor = ({
  groups,
  setGroups,
  categories
}) => {
  const addGroup = () => {
    setGroups((previous) => [...previous, createBlankGroup()]);
  };

  const updateGroup = (groupId, updater) => {
    setGroups((previous) => previous.map((group) => (
      group.id === groupId ? updater(group) : group
    )));
  };

  const removeGroup = (groupId) => {
    setGroups((previous) => previous.filter((group) => group.id !== groupId));
  };

  const toggleCategory = (groupId, categoryId) => {
    updateGroup(groupId, (group) => {
      const currentIds = normalizeArray(group.categoryIds).map(String);
      const targetId = String(categoryId);
      const nextIds = currentIds.includes(targetId)
        ? currentIds.filter((id) => id !== targetId)
        : [...currentIds, targetId];

      return {
        ...group,
        categoryIds: nextIds
      };
    });
  };

  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        const selectedIds = normalizeArray(group.categoryIds).map(String);

        return (
          <div
            key={group.id}
            className="rounded-[1.75rem] border border-green-100 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => removeGroup(group.id)}
                className="rounded-xl bg-red-50 p-2 text-red-500 transition-colors hover:bg-red-100"
                aria-label="グループを削除"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-black text-gray-500">
                グループ名
              </span>
              <input
                value={group.name}
                onChange={(event) => {
                  updateGroup(group.id, (current) => ({
                    ...current,
                    name: event.target.value
                  }));
                }}
                placeholder="例：ドリンク"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none transition-colors focus:border-green-300 focus:bg-white"
              />
              <span className="mt-1 block text-[11px] font-bold text-gray-400">
                顧客画面では「ドリンクはいかがですか？」のように使われます。
              </span>
            </label>

            <div>
              <div className="mb-2 text-xs font-black text-gray-500">
                対象カテゴリー
              </div>

              <div className="grid grid-cols-2 gap-2">
                {categories.map((category) => {
                  const checked = selectedIds.includes(String(category.id));

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleCategory(group.id, category.id)}
                      className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                        checked
                          ? 'border-green-300 bg-green-50 text-green-800 ring-2 ring-green-100'
                          : 'border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      <div className="truncate text-sm font-black">
                        {category.name || category.id}
                      </div>
                      <div className="mt-1 truncate text-[10px] font-bold opacity-70">
                        {category.id}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addGroup}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-green-300 bg-green-50 text-sm font-black text-green-700 transition-colors hover:bg-green-100"
      >
        <Plus size={18} />
        グループを追加
      </button>
    </div>
  );
};

const FlowStepEditor = ({
  flow,
  groups,
  categories,
  updateFlow
}) => {
  const updateStep = (stepId, updater) => {
    updateFlow((current) => ({
      ...current,
      steps: normalizeArray(current.steps).map((step) => (
        step.id === stepId ? updater(step) : step
      ))
    }));
  };

  const addStep = () => {
    updateFlow((current) => ({
      ...current,
      steps: [...normalizeArray(current.steps), createBlankStep()]
    }));
  };

  const removeStep = (stepId) => {
    updateFlow((current) => ({
      ...current,
      steps: normalizeArray(current.steps).filter((step) => step.id !== stepId)
    }));
  };

  return (
    <div className="space-y-5">
      {normalizeArray(flow.steps).map((step, index) => (
        <div
          key={step.id}
          className="rounded-[1.75rem] border-2 border-green-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-green-100 pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex shrink-0 items-center rounded-full bg-green-600 px-3 py-1.5 text-xs font-black text-white shadow-sm">
                ステップ {index + 1}
              </div>
              <p className="truncate text-xs font-bold text-green-700/70">
                この順番でお客様に提案します
              </p>
            </div>

            {normalizeArray(flow.steps).length > 1 && (
              <button
                type="button"
                onClick={() => removeStep(step.id)}
                className="shrink-0 rounded-xl bg-red-50 p-2 text-red-500 transition-colors hover:bg-red-100"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1 block text-xs font-black text-gray-500">
                種類
              </span>
              <select
                value={step.type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  updateStep(step.id, (current) => ({
                    ...current,
                    type: nextType,
                    categoryId: '',
                    groupId: ''
                  }));
                }}
                className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold outline-none"
              >
                {STEP_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {step.type === 'group' ? (
              <label>
                <span className="mb-1 block text-xs font-black text-gray-500">
                  グループ
                </span>
                <select
                  value={step.groupId}
                  onChange={(event) => {
                    updateStep(step.id, (current) => ({
                      ...current,
                      groupId: event.target.value
                    }));
                  }}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold outline-none"
                >
                  <option value="">選択してください</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name || group.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                <span className="mb-1 block text-xs font-black text-gray-500">
                  カテゴリー
                </span>
                <select
                  value={step.categoryId}
                  onChange={(event) => {
                    updateStep(step.id, (current) => ({
                      ...current,
                      categoryId: event.target.value
                    }));
                  }}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold outline-none"
                >
                  <option value="">選択してください</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name || category.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3">
            <label>
              <span className="mb-1 block text-xs font-black text-gray-500">
                表示タイトル 任意
              </span>
              <input
                value={step.title || ''}
                onChange={(event) => {
                  updateStep(step.id, (current) => ({
                    ...current,
                    title: event.target.value
                  }));
                }}
                placeholder={
                  step.type === 'group'
                    ? '未入力なら「グループ名はいかがですか？」'
                    : '未入力なら「カテゴリー名はいかがですか？」'
                }
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold outline-none"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-black text-gray-500">
                説明文 任意
              </span>
              <input
                value={step.description || ''}
                onChange={(event) => {
                  updateStep(step.id, (current) => ({
                    ...current,
                    description: event.target.value
                  }));
                }}
                placeholder={
                  step.type === 'group'
                    ? '未入力なら「上のタブからお好きなグループ名をお選びください。」'
                    : 'カテゴリー単体では未入力推奨'
                }
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold outline-none"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-black text-gray-500">
                スキップボタン
              </span>
              <input
                value={step.skipLabel || ''}
                onChange={(event) => {
                  updateStep(step.id, (current) => ({
                    ...current,
                    skipLabel: event.target.value
                  }));
                }}
                placeholder="おすすめを閉じる"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold outline-none"
              />
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addStep}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-white text-sm font-black text-gray-500 transition-colors hover:bg-gray-50"
      >
        <Plus size={16} />
        ステップを追加
      </button>
    </div>
  );
};

const FlowEditor = ({
  flows,
  setFlows,
  groups,
  categories
}) => {
  const [selectedFlowId, setSelectedFlowId] = useState('');

  useEffect(() => {
    if (!Array.isArray(flows) || flows.length === 0) {
      setSelectedFlowId('');
      return;
    }

    const selectedExists = flows.some((flow) => flow.id === selectedFlowId);

    if (!selectedFlowId || !selectedExists) {
      setSelectedFlowId(flows[0].id);
    }
  }, [flows, selectedFlowId]);

  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) || flows[0] || null;

  const addFlow = () => {
    const nextFlow = createBlankFlow();

    setFlows((previous) => [...previous, nextFlow]);
    setSelectedFlowId(nextFlow.id);
  };

  const updateFlowById = (flowId, updater) => {
    setFlows((previous) => previous.map((flow) => (
      flow.id === flowId ? updater(flow) : flow
    )));
  };

  const removeFlow = (flowId) => {
    setFlows((previous) => {
      const nextFlows = previous.filter((flow) => flow.id !== flowId);

      if (selectedFlowId === flowId) {
        setSelectedFlowId(nextFlows[0]?.id || '');
      }

      return nextFlows;
    });
  };

  if (!selectedFlow) {
    return (
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-gray-900">フロー一覧</h4>
              <p className="mt-1 text-[11px] font-bold text-gray-400">0件</p>
            </div>

            <button
              type="button"
              onClick={addFlow}
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green-600 text-white shadow-lg shadow-green-100 transition-transform active:scale-95"
              aria-label="フローを追加"
            >
              <Plus size={18} strokeWidth={3} />
            </button>
          </div>
        </aside>

        <div className="flex min-h-[18rem] items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <div>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-white text-gray-400 shadow-sm">
              <GitBranch size={24} />
            </div>
            <h4 className="text-lg font-black text-gray-800">まだフローがありません</h4>
            <p className="mt-2 text-sm font-bold leading-relaxed text-gray-400">
              左上の＋から、クロスセルの流れを追加してください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const selectedIndex = flows.findIndex((flow) => flow.id === selectedFlow.id);
  const triggerLabel = selectedFlow.triggerType === 'group'
    ? `グループ：${getGroupName(groups, selectedFlow.triggerGroupId)}`
    : `カテゴリー：${getCategoryName(categories, selectedFlow.triggerCategoryId)}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-gray-900">フロー一覧</h4>
            <p className="mt-1 text-[11px] font-bold text-gray-400">
              {flows.length}件
            </p>
          </div>

          <button
            type="button"
            onClick={addFlow}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green-600 text-white shadow-lg shadow-green-100 transition-transform active:scale-95"
            aria-label="フローを追加"
          >
            <Plus size={18} strokeWidth={3} />
          </button>
        </div>

        <div className="space-y-2">
          {flows.map((flow, index) => {
            const isSelected = selectedFlow.id === flow.id;
            const listTriggerLabel = flow.triggerType === 'group'
              ? getGroupName(groups, flow.triggerGroupId)
              : getCategoryName(categories, flow.triggerCategoryId);

            return (
              <button
                key={flow.id}
                type="button"
                onClick={() => setSelectedFlowId(flow.id)}
                className={`w-full rounded-2xl border p-3 text-left transition-all ${
                  isSelected
                    ? 'border-green-200 bg-green-50 shadow-sm'
                    : 'border-transparent bg-gray-50 hover:border-green-100 hover:bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                    flow.enabled !== false
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}>
                    <GitBranch size={16} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className={`truncate text-xs font-black ${
                        isSelected ? 'text-green-900' : 'text-gray-800'
                      }`}>
                        {flow.name || `フロー ${index + 1}`}
                      </p>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                        flow.enabled !== false
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-400'
                      }`}>
                        {flow.enabled !== false ? '有効' : '無効'}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-[10px] font-bold text-gray-400">
                      {listTriggerLabel || '未設定'} → {normalizeArray(flow.steps).length}ステップ
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-6 py-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                selectedFlow.enabled !== false
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-400'
              }`}>
                {selectedFlow.enabled !== false ? '有効' : '無効'}
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">
                FLOW {String(selectedIndex + 1).padStart(2, '0')}
              </span>
            </div>

            <h4 className="truncate text-xl font-black text-gray-900">
              {selectedFlow.name || `フロー ${selectedIndex + 1}`}
            </h4>

            <p className="mt-1 truncate text-sm font-bold text-gray-400">
              {triggerLabel} → {normalizeArray(selectedFlow.steps).length}ステップ
            </p>
          </div>

          <button
            type="button"
            onClick={() => removeFlow(selectedFlow.id)}
            className="rounded-2xl bg-red-50 p-3 text-red-500 transition-colors hover:bg-red-100"
            aria-label="フローを削除"
          >
            <Trash2 size={17} />
          </button>
        </div>

        <div className="space-y-5 bg-gray-50/60 p-5">
          <div className="grid grid-cols-1 gap-3">
            <label>
              <span className="mb-1 block text-xs font-black text-gray-500">
                フロー名 任意
              </span>
              <input
                value={selectedFlow.name || ''}
                onChange={(event) => {
                  updateFlowById(selectedFlow.id, (current) => ({
                    ...current,
                    name: event.target.value
                  }));
                }}
                placeholder="例：ランチ料理からドリンク・デザート"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-green-300 focus:ring-4 focus:ring-green-100"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-black text-gray-800">
                  このフローを有効にする
                </p>
                <p className="mt-1 text-xs font-bold text-gray-400">
                  無効にすると顧客画面では起動しません
                </p>
              </div>

              <input
                type="checkbox"
                checked={selectedFlow.enabled !== false}
                onChange={(event) => {
                  updateFlowById(selectedFlow.id, (current) => ({
                    ...current,
                    enabled: event.target.checked
                  }));
                }}
                className="h-5 w-5 accent-green-600"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
              <div>
                <p className="text-sm font-black text-gray-800">
                  提供タイミングを表示する
                </p>
                <p className="mt-1 text-xs font-bold leading-relaxed text-gray-500">
                  このクロスセルで、対象カテゴリの商品に「食前・食事と一緒に・食後」を表示します。
                </p>
              </div>

              <input
                type="checkbox"
                checked={selectedFlow.serviceTimingEnabled === true}
                onChange={(event) => {
                  updateFlowById(selectedFlow.id, (current) => ({
                    ...current,
                    serviceTimingEnabled: event.target.checked
                  }));
                }}
                className="h-5 w-5 accent-blue-600"
              />
            </label>
          </div>

          <section className="rounded-3xl border border-orange-100 bg-orange-50/70 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-orange-600 shadow-sm">
                <GitBranch size={18} />
              </div>
              <div>
                <h5 className="text-sm font-black text-orange-900">トリガー設定</h5>
                <p className="mt-1 text-xs font-bold text-orange-700/70">
                  どの商品をきっかけに提案を始めるかを設定します。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-xs font-black text-orange-800">
                  トリガー種類
                </span>
                <select
                  value={selectedFlow.triggerType}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    updateFlowById(selectedFlow.id, (current) => ({
                      ...current,
                      triggerType: nextType,
                      triggerCategoryId: '',
                      triggerGroupId: ''
                    }));
                  }}
                  className="w-full rounded-2xl border border-orange-100 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                >
                  <option value="category">カテゴリー</option>
                  <option value="group">グループ</option>
                </select>
              </label>

              {selectedFlow.triggerType === 'group' ? (
                <label>
                  <span className="mb-1 block text-xs font-black text-orange-800">
                    トリガーグループ
                  </span>
                  <select
                    value={selectedFlow.triggerGroupId}
                    onChange={(event) => {
                      updateFlowById(selectedFlow.id, (current) => ({
                        ...current,
                        triggerGroupId: event.target.value
                      }));
                    }}
                    className="w-full rounded-2xl border border-orange-100 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  >
                    <option value="">選択してください</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name || group.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  <span className="mb-1 block text-xs font-black text-orange-800">
                    トリガーカテゴリー
                  </span>
                  <select
                    value={selectedFlow.triggerCategoryId}
                    onChange={(event) => {
                      updateFlowById(selectedFlow.id, (current) => ({
                        ...current,
                        triggerCategoryId: event.target.value
                      }));
                    }}
                    className="w-full rounded-2xl border border-orange-100 bg-white px-3 py-3 text-sm font-bold outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  >
                    <option value="">選択してください</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name || category.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-green-100 bg-green-50/70 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-green-700 shadow-sm">
                <Layers3 size={18} />
              </div>
              <div>
                <h5 className="text-sm font-black text-green-900">ステップ設定</h5>
                <p className="mt-1 text-xs font-bold text-green-700/70">
                  提案する順番や対象カテゴリを設定します。
                </p>
              </div>
            </div>

            <FlowStepEditor
              flow={selectedFlow}
              groups={groups}
              categories={categories}
              updateFlow={(updater) => updateFlowById(selectedFlow.id, updater)}
            />
          </section>
        </div>
      </div>
    </div>
  );
};


const CrossSellSettings = ({ storeId, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [categories, setCategories] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [groups, setGroups] = useState([]);
  const [flows, setFlows] = useState([]);
  const [visibilityDraft, setVisibilityDraft] = useState({});
  const [activeSection, setActiveSection] = useState('categories');

  const sectionTabs = [
    {
      id: 'categories',
      label: 'カテゴリ表示',
      description: 'クロスセル時だけ表示するカテゴリを設定'
    },
    {
      id: 'groups',
      label: 'グループ設定',
      description: 'ドリンク・スイーツなどのまとまりを設定'
    },
    {
      id: 'flows',
      label: 'フロー設定',
      description: 'どの商品から何を提案するかを設定'
    }
  ];

  useEffect(() => {
    if (!storeId) return undefined;

    let mounted = true;

    const loadSettings = async () => {
      setLoading(true);

      try {
        const [categoriesSnapshot, crossSellSnapshot] = await Promise.all([
          getDoc(doc(db, 'stores', storeId, 'settings', 'categories')),
          getDoc(doc(db, 'stores', storeId, 'settings', 'crossSell'))
        ]);

        if (!mounted) return;

        const categoriesData = categoriesSnapshot.exists() ? categoriesSnapshot.data() : {};
        const rawCategories = Array.isArray(categoriesData.list) ? categoriesData.list : [];

        const nextCategories = rawCategories
          .map((category, index) => ({
            id: category.id || category.categoryId || String(index),
            ...category
          }))
          .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));

        setCategories(nextCategories);

        setVisibilityDraft(() => {
          const next = {};

          nextCategories.forEach((category) => {
            next[category.id] = category.customerTabVisibility || 'always';
          });

          return next;
        });

        if (crossSellSnapshot.exists()) {
          const data = crossSellSnapshot.data();

          setEnabled(Boolean(data.enabled));
          setGroups(normalizeArray(data.groups).map((group) => ({
            id: group.id || createId('group'),
            name: group.name || '',
            categoryIds: normalizeArray(group.categoryIds)
          })));
          setFlows(normalizeArray(data.flows).map(normalizeFlowForForm));
        } else {
          setEnabled(false);
          setGroups([]);
          setFlows([]);
        }
      } catch (error) {
        console.error('Failed to load cross sell settings:', error);
        setCategories([]);
        setEnabled(false);
        setGroups([]);
        setFlows([]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadSettings();

    return () => {
      mounted = false;
    };
  }, [storeId]);

  const handleSave = async () => {
    if (!storeId) return;

    setSaving(true);
    try {
      const cleanGroups = groups
        .map((group) => ({
          id: group.id || createId('group'),
          name: group.name || '',
          categoryIds: normalizeArray(group.categoryIds).filter(Boolean)
        }))
        .filter((group) => group.name || group.categoryIds.length > 0);

      const cleanFlows = flows
        .map(prepareFlowForSave)
        .filter((flow) => {
          const hasTrigger = Boolean(flow.triggerCategoryId || flow.triggerGroupId);
          const hasSteps = normalizeArray(flow.steps).length > 0;
          return hasTrigger && hasSteps;
        });

      await setDoc(
        doc(db, 'stores', storeId, 'settings', 'crossSell'),
        {
          enabled,
          groups: cleanGroups,
          flows: cleanFlows,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      const categoriesWithVisibility = categories.map((category) => ({
        ...category,
        customerTabVisibility: visibilityDraft[category.id] || category.customerTabVisibility || 'always'
      }));

        await setDoc(
        doc(db, 'stores', storeId, 'settings', 'categories'),
        {
            list: categoriesWithVisibility,
            updatedAt: serverTimestamp()
        },
        { merge: true }
        );

      setCategories(categoriesWithVisibility);

      onSaved?.();

      window.setTimeout(() => {
          }, 2500);
    } catch (error) {
      console.error('Failed to save cross sell settings:', error);
      alert('クロスセル設定の保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  if (!storeId) {
    return (
      <div className="rounded-3xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
        店舗情報を読み込み中です。
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-gray-100 bg-white">
        <LoadingSpinner size={32} colorClass="text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-green-100 bg-gradient-to-br from-green-50 to-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-green-700 shadow-sm">
              <Sparkles size={24} />
            </div>

            <h2 className="text-xl font-black text-gray-900">
              クロスセル設定
            </h2>

            <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-gray-500">
              商品をカートに追加した後に、関連カテゴリーやグループへ自然に誘導します。
              ランチのセットドリンク、デザート追加などに利用できます。
            </p>
          </div>

          <label className="flex shrink-0 items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-green-100">
            <div className="text-right">
              <p className="text-sm font-black text-gray-800">
                機能を有効化
              </p>
              <p className="text-xs font-bold text-gray-400">
                顧客画面に反映
              </p>
            </div>

            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-5 w-5 accent-green-600"
            />
          </label>
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-1 mb-6 rounded-[2rem] border border-gray-100 bg-white/90 p-2 shadow-sm backdrop-blur">
        <div className="grid grid-cols-3 gap-2">
          {sectionTabs.map((tab) => {
            const isActive = activeSection === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`rounded-2xl px-4 py-3 text-left transition-all ${
                  isActive
                    ? 'bg-green-600 text-white shadow-lg shadow-green-100'
                    : 'bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-700'
                }`}
              >
                <div className="text-sm font-black leading-tight">{tab.label}</div>
                <div className={`mt-1 text-[10px] font-bold leading-snug ${
                  isActive ? 'text-green-100' : 'text-gray-400'
                }`}>
                  {tab.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeSection === 'categories' && (
        <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100 text-gray-600">
            <Settings2 size={20} />
          </div>

          <div>
            <h3 className="text-lg font-black text-gray-900">
              カテゴリー表示設定
            </h3>
            <p className="mt-1 text-sm font-bold text-gray-400">
              通常タブに出すか、クロスセル時だけ出すかを設定します。
            </p>
          </div>
        </div>

        <CategoryVisibilityEditor
          categories={categories}
          visibilityDraft={visibilityDraft}
          setVisibilityDraft={setVisibilityDraft}
        />
        </section>
      )}

      {activeSection === 'groups' && (
        <section className="rounded-3xl border border-green-100 bg-green-50/60 p-6 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-green-700 shadow-sm">
            <Layers3 size={20} />
          </div>

          <div>
            <h3 className="text-lg font-black text-gray-900">
              グループ設定
            </h3>
            <p className="mt-1 text-sm font-bold text-gray-400">
              複数カテゴリーをまとめて、1つの提案対象にします。
            </p>
          </div>
        </div>

        <GroupEditor
          groups={groups}
          setGroups={setGroups}
          categories={categories}
        />
        </section>
      )}

      {activeSection === 'flows' && (
        <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green-50 text-green-700">
            <GitBranch size={20} />
          </div>

          <div>
            <h3 className="text-lg font-black text-gray-900">
              フロー設定
            </h3>
            <p className="mt-1 text-sm font-bold text-gray-400">
              どの商品カテゴリーをきっかけに、どの順番で提案するかを設定します。
            </p>
          </div>
        </div>

        <FlowEditor
          flows={flows}
          setFlows={setFlows}
          groups={groups}
          categories={categories}
        />
        </section>
      )}

      <div className="sticky bottom-4 z-20 flex justify-end">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white/95 p-3 shadow-2xl backdrop-blur">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-green-600 px-6 text-sm font-black text-white shadow-lg transition-transform active:scale-95 disabled:bg-gray-300"
          >
            {saving ? (
              <LoadingSpinner size={18} colorClass="text-white" />
            ) : (
              <Save size={18} />
            )}
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CrossSellSettings;