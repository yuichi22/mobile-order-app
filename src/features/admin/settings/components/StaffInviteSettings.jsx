// StaffInviteSettings.jsx — 設定 › メンバー
// 【AKUTOブランド基準 10-10: 全アプリ共通の「メンバーと招待」】
// 並び: メンバー一覧(役割のチップ) → 招待中 → 招待する。招待と削除はオーナーだけ(ほかは見るだけ)。
// 送り方は「リンクをコピー」(POSの既定=アルバイトにLINEで渡す)と「メールで送る」(件名・本文は例文入りで編集)。
// 招待は stores/{storeId}/staffInvites に作り(1回だけ使える・7日間)、/register?store_id=&invite= で受ける(従来どおり)。
import { SettingsCardHeader } from './SettingsCard';
import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Link2, Mail, UserPlus, Users, X } from 'lucide-react';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functionsApi } from '../../../../shared/api/firebase/client';
import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { appConfirm } from '../../../../shared/components/feedback/AppConfirmDialog';
import { getAuthErrorMessage } from '../../../../shared/utils/authErrorMessages';
import { USER_ROLES } from '../../../../shared/utils/roles';
import { createSecureToken } from '../../../../shared/utils/tableAccess';
import { deleteStoreMember } from '../services/staffManagementService';

const INVITE_DAYS = 7;

const ROLE_OPTIONS = [
  { value: USER_ROLES.STAFF, label: 'スタッフ', desc: 'キッチン・会計・注文対応' },
  { value: USER_ROLES.MANAGER, label: 'マネージャー', desc: '運営管理・分析・一部の設定' }
];

const roleLabel = (role) => {
  if (role === USER_ROLES.MANAGER) return 'マネージャー';
  if (role === USER_ROLES.STAFF) return 'スタッフ';
  if (role === USER_ROLES.SUPER_ADMIN) return '運営';
  return 'オーナー';
};

const formatDate = (value) => {
  if (!value?.toDate) return '-';
  const d = value.toDate();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const isExpired = (invite) => Boolean(invite?.expiresAt?.toDate && invite.expiresAt.toDate() <= new Date());

const mailTemplate = (storeName) => ({
  subject: `「${storeName || 'お店'}」のレジ・管理画面に招待されました`,
  body: [
    '{お名前}',
    '',
    `「${storeName || 'お店'}」のレジ・管理画面(AKUTO)に、{役割}として招待しました。`,
    '下のリンクを開いてアカウントを作ると、使えるようになります。',
    '',
    '{招待リンク}',
    '',
    'リンクの有効期限: {有効期限}まで(1回だけ使えます)',
    'お心当たりがない場合は、このメールを破棄してください。'
  ].join('\n')
});

const inputClass =
  'h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition hover:border-gray-300 focus:border-ui';

const StaffInviteSettings = ({ storeId, ownerUser, role, storeName = '' }) => {
  const canManage = role === USER_ROLES.OWNER || role === USER_ROLES.SUPER_ADMIN;

  const [invites, setInvites] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedRole, setSelectedRole] = useState(USER_ROLES.STAFF);
  const [method, setMethod] = useState('link'); // 'link' | 'email'(POS の既定はリンク)
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [deletingMember, setDeletingMember] = useState(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('');

  const template = useMemo(() => mailTemplate(storeName), [storeName]);
  const resetTemplate = () => { setSubject(template.subject); setBody(template.body); };
  // 店名が読み込まれたら例文を差し替える(描画中に1回だけ合わせる)
  const [templateFor, setTemplateFor] = useState(null);
  if (templateFor !== storeName) {
    setTemplateFor(storeName);
    setSubject(template.subject);
    setBody(template.body);
  }

  useEffect(() => {
    if (!storeId) return undefined;
    const q = query(collection(db, 'stores', storeId, 'staffInvites'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return undefined;
    const q = query(collection(db, 'users'), where('storeId', '==', storeId));
    return onSnapshot(q, (snap) => {
      const order = { super_admin: 0, owner: 0, admin: 0, manager: 1, staff: 2 };
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || String(a.name || a.email).localeCompare(String(b.name || b.email)));
      setMembers(list);
    });
  }, [storeId]);

  const pendingInvites = invites.filter((inv) => inv.status === 'active');
  const linkOf = (inviteId) => `${window.location.origin}/register?store_id=${storeId}&invite=${inviteId}`;

  const run = async (key, fn) => {
    setBusy(key); setError(''); setNotice('');
    try { await fn(); return true; } catch (e) {
      setError(e?.message?.replace(/^.*?: /, '') || 'うまくいきませんでした。時間をおいてもう一度お試しください。');
      return false;
    } finally { setBusy(''); }
  };

  const createInviteDoc = async () => {
    const inviteId = createSecureToken(12);
    await setDoc(doc(db, 'stores', storeId, 'staffInvites', inviteId), {
      storeId,
      role: selectedRole,
      status: 'active',
      createdBy: ownerUser.uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + INVITE_DAYS * 86400000))
    });
    return inviteId;
  };

  const inviteByLink = () => run('invite', async () => {
    const inviteId = await createInviteDoc();
    await navigator.clipboard.writeText(linkOf(inviteId));
    setNotice('招待リンクをコピーしました。LINE などに貼り付けて送ってください。');
  });

  const inviteByEmail = (e) => {
    e.preventDefault();
    const to = email.trim();
    return run('invite', async () => {
      const inviteId = await createInviteDoc();
      await httpsCallable(functionsApi, 'sendStaffInviteEmail')({
        storeId, inviteId, email: to, name: name.trim(), subject: subject.trim(), body, origin: window.location.origin
      });
      setNotice(`${to} に招待メールを送りました。`);
      setEmail(''); setName(''); resetTemplate();
    });
  };

  const copyInvite = (inv) => run(`copy:${inv.id}`, async () => {
    await navigator.clipboard.writeText(linkOf(inv.id));
    setCopiedId(inv.id);
    window.setTimeout(() => setCopiedId(''), 2200);
  });

  const revokeInvite = async (inv) => {
    if (!(await appConfirm('この招待を取り消しますか？リンクは使えなくなります。'))) return;
    run(`revoke:${inv.id}`, () => deleteDoc(doc(db, 'stores', storeId, 'staffInvites', inv.id)));
  };

  const isDeleteConfirmed = deletingMember?.email && deleteConfirmValue.trim() === deletingMember.email;
  const deleteMember = () => run('delete', async () => {
    try {
      await deleteStoreMember(deletingMember.id);
    } catch (err) {
      throw new Error(getAuthErrorMessage(err, 'メンバーを外せませんでした。'));
    }
    setDeletingMember(null); setDeleteConfirmValue('');
    setNotice('メンバーから外しました。');
  });

  const canRemove = (m) => canManage && m.id !== ownerUser?.uid && (m.role === USER_ROLES.STAFF || m.role === USER_ROLES.MANAGER);

  return (
    <div className="w-full pb-20">
      {/* 外枠はほかの設定画面と同じ(見出しの帯＋アイコン＋件数・全幅)。中身の並びは全アプリ共通 */}
      <section className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <SettingsCardHeader
          icon={Users}
          title={'メンバー'}
          meta={<>メンバー {members.length}人 / 招待中 {pendingInvites.length}件</>}
          actions={null}
        />

        <div className="p-8">
        <p className="text-xs font-bold text-gray-500">レジ・管理画面を使える人。招待と削除はオーナーだけができます。</p>

        {/* メンバー一覧 */}
        <ul className="mt-3 divide-y divide-gray-100">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-gray-900">
                  {m.name || m.email || '名前未設定'}
                  {m.id === ownerUser?.uid && <span className="ml-1 text-xs font-bold text-gray-500">(あなた)</span>}
                </div>
                {m.name && m.email && <div className="truncate text-xs font-bold text-gray-500">{m.email}</div>}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${
                m.role === USER_ROLES.STAFF || m.role === USER_ROLES.MANAGER ? 'bg-gray-100 text-gray-700' : 'bg-gray-900 text-white'
              }`}>
                {roleLabel(m.role)}
              </span>
              {canRemove(m) && (
                <button
                  type="button"
                  onClick={() => { setDeletingMember(m); setDeleteConfirmValue(''); }}
                  className="h-9 shrink-0 rounded-xl px-3 text-xs font-black text-red-600 hover:bg-red-50"
                >
                  外す
                </button>
              )}
            </li>
          ))}
        </ul>

        {/* 招待中 */}
        {pendingInvites.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-black text-gray-500">招待中</div>
            <ul className="mt-1 divide-y divide-gray-100">
              {pendingInvites.map((inv) => {
                const expired = isExpired(inv);
                return (
                  <li key={inv.id} className="flex items-center gap-3 py-3">
                    {inv.email ? <Mail size={16} className="shrink-0 text-gray-500" /> : <Link2 size={16} className="shrink-0 text-gray-500" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-gray-900">
                        {inv.name || inv.email || '招待リンク'}
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700">{roleLabel(inv.role)}</span>
                      </div>
                      <div className="truncate text-xs font-bold text-gray-500">
                        {inv.name && inv.email ? `${inv.email}・` : ''}
                        {expired ? <span className="text-amber-700">期限切れ</span> : `${formatDate(inv.expiresAt)}まで有効`}
                      </div>
                    </div>
                    {canManage && !expired && (
                      <button
                        type="button"
                        onClick={() => copyInvite(inv)}
                        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-black text-ui hover:bg-ui-50"
                      >
                        <Copy size={13} /> {copiedId === inv.id ? 'コピーしました' : 'リンクをコピー'}
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => revokeInvite(inv)}
                        className="h-9 shrink-0 rounded-xl px-3 text-xs font-black text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      >
                        取り消す
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 招待する */}
        {canManage ? (
          <div className="mt-5 rounded-2xl bg-gray-50 p-4">
            <div className="text-sm font-black text-gray-900">メンバーを招待</div>
            <div className="mt-0.5 text-xs font-bold text-gray-500">招待は1回だけ使え、有効期限は{INVITE_DAYS}日間です。</div>

            <div className="mt-3 text-xs font-black text-gray-500">役割</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const on = selectedRole === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedRole(opt.value)}
                    aria-pressed={on}
                    className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${on ? 'border-ui bg-ui-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                  >
                    <div className={`text-sm font-black ${on ? 'text-ui' : 'text-gray-900'}`}>{opt.label}</div>
                    <div className="text-[11px] font-bold text-gray-500">{opt.desc}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 text-xs font-black text-gray-500">送り方</div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {[
                { key: 'link', label: 'リンクをコピー', Icon: Link2 },
                { key: 'email', label: 'メールで送る', Icon: Mail }
              ].map(({ key, label, Icon: MethodIcon }) => {
                const on = method === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMethod(key)}
                    aria-pressed={on}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-black transition-colors ${on ? 'bg-ui text-white' : 'border-2 border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
                  >
                    {React.createElement(MethodIcon, { size: 15 })} {label}
                  </button>
                );
              })}
            </div>

            {method === 'link' ? (
              <>
                <div className="mt-3 text-xs font-bold text-gray-500">リンクを作ってコピーします。LINE などに貼り付けて送ってください。</div>
                <button
                  type="button"
                  onClick={inviteByLink}
                  disabled={busy === 'invite'}
                  className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 text-sm font-black text-white hover:bg-gray-800 disabled:bg-gray-300"
                >
                  {busy === 'invite' ? <LoadingSpinner size={16} /> : <Copy size={16} />}
                  招待リンクを作ってコピー
                </button>
              </>
            ) : (
              <form onSubmit={inviteByEmail} className="mt-3 space-y-2">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス" autoComplete="off" className={inputClass} />
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前(任意)" autoComplete="off" className={inputClass} />
                <div className="flex items-end justify-between gap-2 pt-2">
                  <label htmlFor="staff-invite-subject" className="text-xs font-black text-gray-500">件名</label>
                  <button type="button" onClick={resetTemplate} className="text-xs font-bold text-ui hover:underline">例文に戻す</button>
                </div>
                <input id="staff-invite-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className={inputClass} />
                <label htmlFor="staff-invite-body" className="block pt-1 text-xs font-black text-gray-500">本文</label>
                <textarea
                  id="staff-invite-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={9}
                  maxLength={4000}
                  className="w-full resize-y rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-bold leading-relaxed text-gray-900 outline-none transition hover:border-gray-300 focus:border-ui"
                />
                <div className="text-[11px] font-bold leading-relaxed text-gray-500">
                  {'{お名前}'}・{'{役割}'}・{'{招待リンク}'}・{'{有効期限}'} は送るときに置き換わります。{'{招待リンク}'} を消しても、リンクは最後に付きます。
                </div>
                <button
                  type="submit"
                  disabled={!email.trim() || busy === 'invite'}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 text-sm font-black text-white hover:bg-gray-800 disabled:bg-gray-300"
                >
                  {busy === 'invite' ? <LoadingSpinner size={16} /> : <UserPlus size={16} />}
                  招待メールを送る
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl bg-gray-50 p-4 text-xs font-bold text-gray-500">メンバーを増やすときは、オーナーに招待を頼んでください。</div>
        )}

        {notice && <div className="mt-3 rounded-xl bg-ui-50 px-3 py-2 text-sm font-bold text-ui">{notice}</div>}
        {error && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">{error}</div>}
        </div>
      </section>

      {/* メンバーを外す(取り消せないので、メールアドレスの入力で確かめる) */}
      {deletingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => busy !== 'delete' && setDeletingMember(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-black text-gray-900">メンバーから外す</h3>
              <button type="button" onClick={() => setDeletingMember(null)} aria-label="閉じる" className="text-gray-500 hover:text-gray-900"><X size={20} /></button>
            </div>
            <p className="mt-2 text-sm font-bold text-gray-700">
              <span className="font-black text-gray-900">{deletingMember.name || deletingMember.email || '名前未設定'}</span> を外すと、すぐにレジ・管理画面を使えなくなります。
            </p>
            <label className="mt-4 block text-xs font-black text-gray-500">確認のため、メールアドレスを入力してください</label>
            <input
              value={deleteConfirmValue}
              onChange={(e) => setDeleteConfirmValue(e.target.value)}
              placeholder={deletingMember.email}
              className={`mt-1 ${inputClass}`}
            />
            <button
              type="button"
              onClick={deleteMember}
              disabled={!isDeleteConfirmed || busy === 'delete'}
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-red-600 text-sm font-black text-white hover:bg-red-700 disabled:bg-gray-300"
            >
              {busy === 'delete' ? <LoadingSpinner size={16} /> : '外す'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffInviteSettings;
