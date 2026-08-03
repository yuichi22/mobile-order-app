// appOptions.js
// 「この拠点で実際に使っている台数」を Akuto Core へ通知する。
// 台数の発生源は現場（POSのレジ追加）。Core側で space.appOptions に反映し、
// 含み台数を超えた分がサブスク明細へ自動で載る。
//
// 設定保存(settings/basic)のトリガで送るため、レジの追加・削除・部門変更の
// どの経路でも取りこぼさない。件数が変わらない保存では何もしない。
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();

/** POS課金の対象になるレジ台数（POS部門に紐づくレジのみ。ORDERレジはKDS課金） */
function countPosRegisters(data) {
  const departments = Array.isArray(data?.departments) ? data.departments : [];
  const registers = Array.isArray(data?.registers) ? data.registers : [];
  if (registers.length === 0) return 0;

  const modeById = new Map(
    departments.map((d) => [str(d?.id), str(d?.registerMode) === "order" ? "order" : "pos"])
  );
  return registers.filter((r) => {
    const mode = str(r?.registerMode) || modeById.get(str(r?.departmentId)) || "pos";
    return mode !== "order";
  }).length;
}

export const onBasicSettingsWriteSyncAppOptions = onDocumentWritten(
  { region: REGION, database: DB_ID, document: "stores/{storeId}/settings/basic" },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // 削除は対象外

    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const nextCount = countPosRegisters(after.data());
    const prevCount = before ? countPosRegisters(before) : null;
    if (prevCount === nextCount) return; // 台数に変化なし

    const storeId = event.params.storeId;
    const url = str(process.env.CORE_APP_OPTION_URL);
    const secret = str(process.env.CORE_SALES_SECRET);
    if (!url || !secret) {
      console.warn("[appOptions] CORE_APP_OPTION_URL/CORE_SALES_SECRET 未設定のため通知をスキップ");
      return;
    }

    // 拠点の紐づけはプロビジョニング時に settings/terminal へ保存済み
    const termSnap = await db.collection("stores").doc(storeId).collection("settings").doc("terminal").get();
    const term = termSnap.exists ? termSnap.data() || {} : {};
    const tenantId = str(term.coreTenantId);
    const spaceId = str(term.coreSpaceId);
    if (!tenantId || !spaceId) return; // Core未連携の店舗（単独運用）は対象外

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          tenantId,
          spaceId,
          appKey: "pos",
          optionKey: "terminal",
          quantity: nextCount,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        console.warn("[appOptions] Core応答NG:", res.status, payload?.error || "");
        return;
      }
      console.log(
        `[appOptions] ${storeId} POSレジ ${prevCount ?? "-"} -> ${nextCount} 台をCoreへ通知` +
          `(課金対象 ${payload.billableOverage ?? "?"} 台)`
      );
    } catch (e) {
      console.warn("[appOptions] Core接続失敗:", e?.message || e);
    }
  }
);
