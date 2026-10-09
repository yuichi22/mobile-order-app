import React from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Copy,
  Edit,
  Link,
  RotateCw,
  Trash2,
  Type,
  Unlink,
} from 'lucide-react';

const PANEL_SECTION_TITLE_CLASS = 'text-[11px] font-black tracking-[0.18em] text-gray-300';
const ACTION_BUTTON_CLASS =
  'flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-black text-gray-500 transition-colors hover:border-ui-100 hover:bg-ui-50 hover:text-ui';

export const FloorMapProperties = ({
  selectedIds,
  items,
  updateSelectedItems,
  handleRotate,
  handleDelete,
  handleDuplicate,
  alignSelected,
  handleGroup,
  handleUngroup,
}) => {
  const selectedItem = items.find((item) => item.id === selectedIds[0]);
  const hasGroupedItems = selectedIds.some((id) => items.find((item) => item.id === id)?.groupId);

  if (selectedIds.length === 0) return null;

  return (
    <div className="z-20 flex h-full w-full flex-col border-l border-gray-100 bg-white shadow-xl shadow-gray-200/70">
      <div className="border-b border-gray-100 bg-ui-50/60 px-4 py-4">
        <h4 className="flex items-center gap-2.5 text-sm font-black text-gray-500">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white shadow-lg shadow-gray-200">
            <Edit size={16} />
          </span>
          <span className="block leading-tight">テーブル設定</span>
        </h4>
      </div>

      <div className="flex-grow space-y-5 overflow-y-auto px-4 py-4">
        {selectedIds.length > 1 && (
          <section className="space-y-2.5 rounded-2xl border border-ui-100 bg-ui-50/40 p-3">
            <div className="space-y-1">
              <label className={PANEL_SECTION_TITLE_CLASS}>複数選択</label>
              <p className="text-xs font-bold leading-relaxed text-gray-500">
                選択したパーツをまとめて整列したり、グループ化して扱えます。
              </p>
            </div>
          </section>
        )}

        {selectedIds.length === 1 && selectedItem?.type === 'table' && (
          <div className="space-y-5">
            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>テーブルID</label>
              <div className="relative">
                <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} />
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={selectedItem.label || ''}
                  onChange={(event) => updateSelectedItems({ label: event.target.value })}
                  placeholder="半角数字で入力"
                  className="h-11 w-full rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-3 text-center text-lg font-black text-gray-500 outline-none transition-colors focus:border-ui-100 focus:ring-4 focus:ring-ui-100"
                />
              </div>
              <p className="text-[11px] font-bold leading-relaxed text-gray-500">
                QRコードや会計で使う内部番号です。通常は変更不要です。
              </p>
            </section>

            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>テーブル形状</label>

              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-2">
            <button
              type="button"
              onClick={() => updateSelectedItems({ shape: 'rect' })}
              className={`h-11 rounded-xl border text-sm font-black transition-colors ${
                selectedItem.shape !== 'circle'
                  ? 'border-ui-100 bg-ui-50 text-ui'
                  : 'border-transparent bg-white text-gray-500 hover:border-ui-100 hover:text-ui'
              }`}
            >
              四角テーブル
            </button>

            <button
              type="button"
              onClick={() => updateSelectedItems({ shape: 'circle' })}
              className={`h-11 rounded-xl border text-sm font-black transition-colors ${
                selectedItem.shape === 'circle'
                  ? 'border-ui-100 bg-ui-50 text-ui'
                  : 'border-transparent bg-white text-gray-500 hover:border-ui-100 hover:text-ui'
              }`}
            >
              丸テーブル
            </button>
              </div>
            </section>

            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>テーブル名</label>
              <div className="relative">
                <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} />
                <input
                  value={selectedItem.displayName || ''}
                  onChange={(event) => updateSelectedItems({ displayName: event.target.value })}
                  placeholder="例：窓側席 / カウンターA / 個室"
                  className="h-11 w-full rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-3 text-center text-sm font-black text-gray-800 outline-none transition-colors focus:border-ui-100 focus:ring-4 focus:ring-ui-100"
                />
              </div>
              <p className="text-[11px] font-bold leading-relaxed text-gray-500">
                管理画面やテーブル上で見やすい名前を設定できます。
              </p>
            </section>

            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>座席数</label>
              <div className="rounded-2xl border border-ui-100 bg-gradient-to-br from-ui via-white to-ui/70 p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => updateSelectedItems({ seats: Math.max(1, (selectedItem.seats || 2) - 1) })}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-ui-100 bg-white text-lg font-black text-ui shadow-sm transition-colors hover:bg-ui-50"
                  >
                    -
                  </button>
                  <div className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-white px-4 text-center shadow-sm">
                    <span className="text-base font-black text-gray-800">{selectedItem.seats} 席</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSelectedItems({ seats: (selectedItem.seats || 2) + 1 })}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-ui-100 bg-white text-lg font-black text-ui shadow-sm transition-colors hover:bg-ui-50"
                  >
                    +
                  </button>
                </div>
              </div>
            </section>

            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>利用状態</label>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-2">
                <button
                  type="button"
                  onClick={() => updateSelectedItems({ isDisabled: false })}
                  className={`h-11 rounded-xl border text-sm font-black transition-colors ${
                    !selectedItem.isDisabled
                      ? 'border-ui-100 bg-ui-50 text-ui'
                      : 'border-transparent bg-white text-gray-500 hover:border-ui-100 hover:text-ui'
                  }`}
                >
                  利用可
                </button>
                <button
                  type="button"
                  onClick={() => updateSelectedItems({ isDisabled: true })}
                  className={`h-11 rounded-xl border text-sm font-black transition-colors ${
                    selectedItem.isDisabled
                      ? 'border-red-200 bg-red-50 text-red-600'
                      : 'border-transparent bg-white text-gray-500 hover:border-red-100 hover:text-red-600'
                  }`}
                >
                  利用停止
                </button>
              </div>
            </section>
          </div>
        )}

        <section className="space-y-2.5">
          <label className={PANEL_SECTION_TITLE_CLASS}>アクション</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={handleDuplicate} className={ACTION_BUTTON_CLASS}>
              <Copy size={15} />
              複製
            </button>
            <button type="button" onClick={handleRotate} className={ACTION_BUTTON_CLASS}>
              <RotateCw size={15} />
              回転
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-xs font-black text-red-500 transition-colors hover:bg-red-50"
            >
              <Trash2 size={15} />
              削除
            </button>
          </div>
        </section>

        {selectedIds.length > 1 && (
          <>
            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>整列</label>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-2">
                <button type="button" onClick={() => alignSelected('left')} className={ACTION_BUTTON_CLASS}>
                  <AlignStartVertical size={15} />
                  左揃え
                </button>
                <button type="button" onClick={() => alignSelected('right')} className={ACTION_BUTTON_CLASS}>
                  <AlignEndVertical size={15} />
                  右揃え
                </button>
                <button type="button" onClick={() => alignSelected('top')} className={ACTION_BUTTON_CLASS}>
                  <AlignStartHorizontal size={15} />
                  上揃え
                </button>
                <button type="button" onClick={() => alignSelected('bottom')} className={ACTION_BUTTON_CLASS}>
                  <AlignEndHorizontal size={15} />
                  下揃え
                </button>
                <button type="button" onClick={() => alignSelected('center-x')} className={ACTION_BUTTON_CLASS}>
                  <AlignCenterVertical size={15} />
                  横中央
                </button>
                <button type="button" onClick={() => alignSelected('center-y')} className={ACTION_BUTTON_CLASS}>
                  <AlignCenterHorizontal size={15} />
                  縦中央
                </button>
              </div>
            </section>

            <section className="space-y-2.5">
              <label className={PANEL_SECTION_TITLE_CLASS}>グループ設定</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={handleGroup}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-ui-100 bg-ui-50 px-3 text-xs font-black text-ui transition-colors hover:bg-ui-50"
                >
                  <Link size={15} />
                  グループ化する
                </button>
                {hasGroupedItems && (
                  <button type="button" onClick={handleUngroup} className={ACTION_BUTTON_CLASS}>
                    <Unlink size={15} />
                    グループ解除
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
