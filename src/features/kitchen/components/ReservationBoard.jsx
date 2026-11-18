import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Printer, X } from 'lucide-react';

import { appConfirm } from '../../../shared/components/feedback/AppConfirmDialog';
import {
  cancelTakeoutOrder,
  subscribeReservationDays,
  subscribeReservationOrders,
  updateTakeoutOrderStatus
} from '../services/kitchenBoardService';
import {
  buildPrepSheet,
  formatDateKey,
  jstDateKey,
  pickupTimeLabel,
  shiftDateKey,
  summarizeDays
} from '../utils/reservationUtils';

const STATUS_LABEL = {
  pending: '未準備',
  ready: '準備済み',
  handed: '渡した',
  cancelled: '取消'
};

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * 紙の仕込み表・受け渡し表。⚠ 厨房とレジで1枚ずつ持てるよう、白黒で読める形にする。
 */
const printPrepSheet = ({ dateKey, sheet, storeName }) => {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  const itemRows = sheet.items
    .map((i) => `<tr><td>${escapeHtml(i.name)}</td><td class="n">${i.quantity}</td></tr>`)
    .join('');
  const slotRows = sheet.slots
    .map((s) => `<tr><td>${s.time}</td><td class="n">${s.orderCount}件</td><td>${s.lines
      .map((l) => `${escapeHtml(l.name)} ×${l.quantity}`)
      .join('<br>')}</td></tr>`)
    .join('');
  const orderRows = sheet.orders
    .filter((o) => o.status !== 'cancelled')
    .map((o) => `<tr><td class="box"></td><td>${pickupTimeLabel(o.pickupAt)}</td><td>${escapeHtml(o.customerName)} 様<br><small>${escapeHtml(o.customerTel)}</small></td><td>${(o.items || [])
      .map((i) => `${escapeHtml(String(i.name || '').replace(/\s*\n\s*/g, ' '))} ×${i.quantity}`)
      .join('<br>')}${o.note ? `<br><small>※${escapeHtml(o.note)}</small>` : ''}</td><td class="n">¥${Number(o.totalAmount || 0).toLocaleString()}</td></tr>`)
    .join('');

  win.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>予約 ${formatDateKey(dateKey)}</title>
<style>
body{font-family:-apple-system,'Hiragino Sans',sans-serif;color:#000;margin:24px;font-size:13px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;border-bottom:2px solid #000;padding-bottom:2px}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #888;padding:6px;vertical-align:top;text-align:left}
.n{text-align:right;white-space:nowrap;font-weight:700}.box{width:18px}small{color:#333}
</style></head><body>
<h1>予約の仕込み・受け渡し表 ${formatDateKey(dateKey)}</h1>
<div>${escapeHtml(storeName || '')} / 印刷 ${new Date().toLocaleString('ja-JP')}</div>
<h2>品目ごとの合計</h2><table>${itemRows}</table>
<h2>受取時刻ごと</h2><table>${slotRows}</table>
<h2>受け渡しチェック（店頭払い）</h2><table><tr><th></th><th>受取</th><th>お客様</th><th>品</th><th>金額</th></tr>${orderRows}</table>
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
};

/**
 * 予約一覧（受取日別）。クリスマスケーキ等の予約品を、キッチンの注文ボードとは分けて扱う。
 *  ・日付タブ: 受取日ごとの件数
 *  ・仕込み表: 品目ごとの合計と、上限に対する残り
 *  ・受取時刻ごとの内訳
 *  ・受け渡しチェック: 準備できた / 渡した / 取消
 */
const ReservationBoard = ({ storeId, storeName, menuItemLookup = {}, onClose }) => {
  const todayKey = jstDateKey();
  // ⚠ 過去分は1週間だけ（渡し忘れ・取消の確認用）。それより前は要らない。
  const fromKey = shiftDateKey(todayKey, -7);
  const [orders, setOrders] = useState([]);
  const [dayCounts, setDayCounts] = useState({});
  const [selectedKey, setSelectedKey] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!storeId) return undefined;
    const unsubOrders = subscribeReservationOrders(storeId, fromKey, setOrders);
    const unsubDays = subscribeReservationDays(storeId, fromKey, setDayCounts);
    return () => {
      unsubOrders();
      unsubDays();
    };
  }, [storeId, fromKey]);

  const days = useMemo(() => summarizeDays(orders), [orders]);

  // 既定は「今日以降で一番近い受取日」
  const activeKey = useMemo(() => {
    if (selectedKey && days.some((d) => d.dateKey === selectedKey)) return selectedKey;
    return (days.find((d) => d.dateKey >= todayKey) || days[days.length - 1])?.dateKey || null;
  }, [days, selectedKey, todayKey]);

  const sheet = useMemo(
    () => (activeKey ? buildPrepSheet(orders, activeKey) : { items: [], slots: [], orders: [] }),
    [orders, activeKey]
  );

  const run = async (orderId, fn) => {
    setBusyId(orderId);
    try {
      await fn();
    } catch (error) {
      console.error('[reservation] update failed', error);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (order) => {
    const ok = await appConfirm(
      `${order.customerName} 様（${formatDateKey(order.pickupDate)} ${pickupTimeLabel(order.pickupAt)}）の予約を取り消しますか？\nこの日の受付枠も戻ります。`,
      { okLabel: '取り消す', tone: 'danger' }
    );
    if (!ok) return;
    await run(order.id, () => cancelTakeoutOrder(storeId, order.id));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-gray-100">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-700 bg-gray-950 px-5 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} className="text-rose-300" />
          <h2 className="text-lg font-black">予約一覧（受取日別）</h2>
          <span className="text-xs font-bold text-gray-500">
            予約品はキッチンのボードには受取当日まで出ません
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeKey && sheet.orders.length > 0 && (
            <button
              type="button"
              onClick={() => printPrepSheet({ dateKey: activeKey, sheet, storeName })}
              className="flex items-center gap-1.5 rounded-xl bg-gray-800 px-3 py-2 text-sm font-black text-gray-100"
            >
              <Printer size={16} /> 印刷
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-xl bg-gray-700 px-3 py-2 text-sm font-black text-white"
          >
            <X size={16} /> 閉じる
          </button>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-lg font-bold text-gray-500">
          予約はまだありません
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-gray-800 px-5 py-3">
            {days.map((d) => {
              const active = d.dateKey === activeKey;
              const past = d.dateKey < todayKey;
              return (
                <button
                  key={d.dateKey}
                  type="button"
                  onClick={() => setSelectedKey(d.dateKey)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-left ${
                    active ? 'bg-rose-500 text-white' : past ? 'bg-gray-800/60 text-gray-500' : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  <div className="text-sm font-black">
                    {d.dateKey === todayKey ? '本日 ' : ''}{formatDateKey(d.dateKey)}
                  </div>
                  <div className="text-[11px] font-bold opacity-80">
                    {d.orderCount}件 / {d.itemCount}点{d.handedCount > 0 ? `・渡済${d.handedCount}` : ''}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="custom-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[360px_1fr]">
            <div className="space-y-5">
              <section className="rounded-2xl bg-gray-800 p-4">
                <h3 className="mb-3 text-sm font-black text-gray-300">仕込み表（品目ごとの合計）</h3>
                <ul className="space-y-2">
                  {sheet.items.map((item) => {
                    const limit = Number(menuItemLookup[item.menuItemId]?.reservationDailyLimit) || 0;
                    const counted = Number(dayCounts[activeKey]?.[item.menuItemId]) || 0;
                    return (
                      <li key={item.menuItemId || item.name} className="flex items-start justify-between gap-3">
                        <span className="text-sm font-bold">{item.name}</span>
                        <span className="shrink-0 text-right">
                          <span className="text-xl font-black text-rose-300">{item.quantity}</span>
                          {item.isReservation && limit > 0 && (
                            <span className="block text-[11px] font-bold text-gray-400">
                              上限{limit}・残り{Math.max(limit - counted, 0)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="rounded-2xl bg-gray-800 p-4">
                <h3 className="mb-3 text-sm font-black text-gray-300">受取時刻ごと</h3>
                <ul className="space-y-2">
                  {sheet.slots.map((slot) => (
                    <li key={slot.time} className="flex gap-3 border-b border-gray-700 pb-2 last:border-0">
                      <span className="w-12 shrink-0 text-sm font-black text-rose-300">{slot.time}</span>
                      <span className="flex-1 text-xs font-bold leading-relaxed text-gray-200">
                        {slot.lines.map((l) => `${l.name} ×${l.quantity}`).join('、')}
                      </span>
                      <span className="shrink-0 text-xs font-bold text-gray-400">{slot.orderCount}件</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="rounded-2xl bg-gray-800 p-4">
              <h3 className="mb-3 text-sm font-black text-gray-300">受け渡しチェック（店頭払い）</h3>
              <div className="space-y-2">
                {sheet.orders.map((order) => {
                  const cancelled = order.status === 'cancelled';
                  const handed = order.status === 'handed';
                  const busy = busyId === order.id;
                  return (
                    <div
                      key={order.id}
                      className={`rounded-xl p-3 ${cancelled ? 'bg-gray-900/40 opacity-50' : handed ? 'bg-gray-900/60' : 'bg-gray-900'}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-rose-300">{pickupTimeLabel(order.pickupAt)}</span>
                            <span className="text-sm font-black">{order.customerName} 様</span>
                            <span className="text-xs font-bold text-gray-400">{order.customerTel}</span>
                          </div>
                          <div className="mt-1 text-xs font-bold leading-relaxed text-gray-200">
                            {(order.items || [])
                              .map((i) => `${String(i.name || '').replace(/\s*\n\s*/g, ' ')} ×${i.quantity}`)
                              .join('、')}
                          </div>
                          {order.note && (
                            <div className="mt-1 text-[11px] font-bold text-amber-200">※{order.note}</div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-black">¥{Number(order.totalAmount || 0).toLocaleString()}</div>
                          <div className="text-[11px] font-bold text-gray-400">{STATUS_LABEL[order.status] || order.status}</div>
                        </div>
                      </div>

                      {!cancelled && (
                        <div className="mt-2 flex gap-2">
                          {order.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run(order.id, () => updateTakeoutOrderStatus(storeId, order.id, 'ready'))}
                              className="flex-1 rounded-lg bg-gray-700 px-2 py-1.5 text-xs font-black text-white disabled:opacity-50"
                            >
                              準備できた
                            </button>
                          )}
                          {handed ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run(order.id, () => updateTakeoutOrderStatus(storeId, order.id, 'ready'))}
                              className="flex-1 rounded-lg bg-gray-800 px-2 py-1.5 text-xs font-black text-gray-300 disabled:opacity-50"
                            >
                              渡したを戻す
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run(order.id, () => updateTakeoutOrderStatus(storeId, order.id, 'handed'))}
                              className="flex-1 rounded-lg bg-rose-500 px-2 py-1.5 text-xs font-black text-white disabled:opacity-50"
                            >
                              渡した
                            </button>
                          )}
                          {!handed && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCancel(order)}
                              className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-black text-gray-400 disabled:opacity-50"
                            >
                              取消
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReservationBoard;
