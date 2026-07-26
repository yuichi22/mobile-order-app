// useCoreEntitlements.js
// Core契約状態(stores/{id}/settings/coreApps)を購読し、機能出し分けに使う。
// - キャッシュ無し(Core未連携/未取得) = フェイルオープンで全機能表示
// - マウント時に refreshEntitlements を1回だけ裏で叩いて最新化(失敗しても無視)
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functionsApi } from '../api/firebase/client';

const OPEN = { order: true, pos: true, hasData: false };

// 同一セッションで店舗ごとに1回だけ更新キックする
const refreshedStores = new Set();

export function useCoreEntitlements(storeId) {
  // 店舗切替時のリセットは effect ではなくレンダー中の状態調整で行う。
  const [state, setState] = useState({ storeId: null, ent: OPEN });
  if (state.storeId !== (storeId || null)) {
    setState({ storeId: storeId || null, ent: OPEN });
  }

  useEffect(() => {
    if (!storeId) return undefined;

    const ref = doc(db, 'stores', storeId, 'settings', 'coreApps');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.exists() ? snap.data() || {} : null;
        const ent = d
          ? { order: d.order === true, pos: d.pos === true, hasData: true }
          : OPEN;
        setState({ storeId, ent });
      },
      () => setState({ storeId, ent: OPEN })
    );

    if (!refreshedStores.has(storeId)) {
      refreshedStores.add(storeId);
      httpsCallable(functionsApi, 'refreshEntitlements')({ storeId }).catch(() => {
        // オフライン等での失敗は無視（次回起動で再試行できるよう解除）
        refreshedStores.delete(storeId);
      });
    }

    return unsub;
  }, [storeId]);

  return state.ent;
}

export default useCoreEntitlements;
