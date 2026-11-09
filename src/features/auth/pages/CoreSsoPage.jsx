import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import { auth, ensureSessionPersistence, functionsApi } from '../../../shared/api/firebase/client';
import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';

/** /sso#ticket=… の入場券を取り出す。無ければ null */
const parseSsoHash = (hash) => {
  const ticket = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('ticket');
  return ticket && /^[A-Za-z0-9_-]{32,128}$/.test(ticket) ? ticket : null;
};

// AKUTO Core のポータルの「開く」から来る画面。
// 入場券（1回限り・約1分）をログイン用のトークンに替えてログインし、
// ?app=pos|order&tenantId&spaceId を付けたままトップへ移る（拠点の突き合わせは CoreSpaceLinkGuard）。
const CoreSsoPage = () => {
  // 入場券は最初の描画で1度だけ読む（このあとアドレスバーから消す）
  const [ticket] = useState(() => parseSsoHash(window.location.hash));
  const [error, setError] = useState(() =>
    ticket ? '' : 'このリンクは使えません。ポータルからもう一度開くか、ログインしてください。'
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const search = window.location.search;
    // 入場券を履歴とアドレスバーに残さない
    window.history.replaceState(null, '', `/sso${search}`);
    if (!ticket) return;
    (async () => {
      try {
        await ensureSessionPersistence();
        const res = await httpsCallable(functionsApi, 'redeemCoreLoginTicket')({ ticket });
        await signInWithCustomToken(auth, res.data.token);
        window.location.replace(`/${search}`);
      } catch (e) {
        setError(e?.message || 'ログインできませんでした。ポータルからもう一度開くか、ログインしてください。');
      }
    })();
  }, [ticket]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-xl">
        {error ? (
          <>
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-600">
              <AlertCircle size={16} className="shrink-0" />
              <span className="font-bold">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => window.location.replace('/login')}
              className="flex h-14 w-full items-center justify-center rounded-xl bg-gray-900 text-base font-black text-white shadow-lg transition hover:bg-black"
            >
              ログイン画面へ
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-sm font-bold text-gray-600">
            <LoadingSpinner />
            ログインしています…
          </div>
        )}
      </div>
    </div>
  );
};

export default CoreSsoPage;
