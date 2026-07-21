// CoreSpaceLinkGuard.jsx
// Akuto Core ポータルの「開く」リンク (?tenantId=..&spaceId=..&app=order|pos) を受ける番人。
// - 初期モードへの反映 (app=pos→admin / app=order→launcher) は appRouteState 側で実施済み。
// - ここでは「ログイン中スタッフの店舗」と「リンクの拠点(spaceId)」を
//   stores/{storeId}/settings/terminal ({coreTenantId, coreSpaceId}) で突き合わせ、
//   未連携・不一致ならトーストで知らせる（遷移は妨げない）。
// - 判定後は Core パラメータを URL から除去する（既存ルーティングへの影響を残さない）。
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../shared/api/firebase/client';
import { useAuth } from '../providers/useAuth';
import NotificationToast from '../../shared/components/feedback/NotificationToast';

const CoreSpaceLinkGuard = () => {
  const { currentUser, storeId, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState(null);
  const processedRef = useRef(false); // 一度だけ判定する（render状態ではないので ref）

  useEffect(() => {
    if (processedRef.current) return undefined;

    const params = new URLSearchParams(location.search);
    const linkSpaceId = params.get('spaceId');
    const linkTenantId = params.get('tenantId');
    const hasCoreParams = Boolean(linkSpaceId || linkTenantId || params.get('app'));

    if (!hasCoreParams) {
      processedRef.current = true;
      return undefined;
    }

    // スタッフのログインと店舗確定を待つ（顧客QR等の匿名フローでは何もしない）
    if (loading) return undefined;
    if (!currentUser || currentUser.isAnonymous || !storeId) return undefined;

    let cancelled = false;

    (async () => {
      let result = null;
      if (linkSpaceId) {
        try {
          const snap = await getDoc(doc(db, 'stores', storeId, 'settings', 'terminal'));
          const link = snap.exists() ? snap.data() : null;
          if (!link?.coreSpaceId) {
            result = {
              type: 'error',
              message: 'この店舗はポータルの拠点と未連携です',
              description: '管理画面の基本設定から拠点連携を行うと、ポータルのリンクと店舗が結び付きます。'
            };
          } else if (link.coreSpaceId !== linkSpaceId) {
            result = {
              type: 'error',
              message: '別の拠点のリンクから開かれています',
              description: 'この端末でログイン中の店舗は、選択された拠点と一致しません。正しい拠点のリンクをご利用ください。'
            };
          } else if (linkTenantId && link.coreTenantId && link.coreTenantId !== linkTenantId) {
            result = {
              type: 'error',
              message: '別のテナントのリンクから開かれています',
              description: 'この店舗は別のテナントに紐づいています。リンク元のポータルをご確認ください。'
            };
          }
        } catch {
          // 読み取り不可(権限等)は判定不能として黙って通す
        }
      }

      if (cancelled) return;
      if (result) setNotice(result);

      // 判定済み: Core パラメータを URL から除去（mode 状態は AppRouter 側で保持済み）
      const next = new URLSearchParams(location.search);
      next.delete('tenantId');
      next.delete('spaceId');
      next.delete('app');
      const nextSearch = next.toString();
      navigate(
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
        { replace: true }
      );
      processedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, currentUser, storeId, location, navigate]);

  if (!notice) return null;

  return (
    <NotificationToast
      message={notice.message}
      description={notice.description}
      type={notice.type}
      dismissible
      autoCloseMs={0}
      onClose={() => setNotice(null)}
    />
  );
};

export default CoreSpaceLinkGuard;
