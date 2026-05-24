import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  MailPlus,
  RefreshCw,
  Shield,
  Trash2,
  UserCog,
  Users
} from 'lucide-react';
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

import { db } from '../../../../shared/api/firebase/client';
import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { getAuthErrorMessage } from '../../../../shared/utils/authErrorMessages';
import { USER_ROLES } from '../../../../shared/utils/roles';
import { createSecureToken } from '../../../../shared/utils/tableAccess';
import { deleteStoreMember } from '../services/staffManagementService';

const ROLE_OPTIONS = [
  {
    value: USER_ROLES.STAFF,
    label: 'スタッフ',
    desc: 'キッチン・会計・注文対応向け'
  },
  {
    value: USER_ROLES.MANAGER,
    label: 'マネージャー',
    desc: '運営管理・分析確認・一部設定向け'
  }
];

const formatRoleLabel = (role) => {
  if (role === USER_ROLES.MANAGER) return 'マネージャー';
  if (role === USER_ROLES.STAFF) return 'スタッフ';
  return 'オーナー';
};

const formatInviteStatusLabel = (status) => {
  if (status === 'used') return '利用済み';
  if (status === 'active') return '有効';
  return '-';
};

const formatDate = (value) => {
  if (!value?.toDate) return '-';
  const date = value.toDate();
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const isInviteUnavailable = (invite) => {
  if (!invite) return true;
  if (invite.status !== 'active') return true;
  return Boolean(invite.expiresAt?.toDate && invite.expiresAt.toDate() <= new Date());
};

const canManageMember = (member, ownerUser) => {
  if (!member?.id) return false;
  if (member.id === ownerUser?.uid) return false;
  return member.role === USER_ROLES.STAFF || member.role === USER_ROLES.MANAGER;
};

const getRoleMeta = (role) => {
  if (role === USER_ROLES.MANAGER) {
    return {
      Icon: UserCog,
      className: 'bg-orange-50 text-orange-700 border border-orange-100'
    };
  }

  if (role === USER_ROLES.STAFF) {
    return {
      Icon: Users,
      className: 'bg-slate-100 text-slate-700 border border-slate-200'
    };
  }

  return {
    Icon: Shield,
    className: 'bg-emerald-50 text-emerald-700 border border-emerald-100'
  };
};

const StaffInviteSettings = ({ storeId, ownerUser }) => {
  const [selectedRole, setSelectedRole] = useState(USER_ROLES.STAFF);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [invites, setInvites] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [copiedInviteId, setCopiedInviteId] = useState('');
  const [deletingMember, setDeletingMember] = useState(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('');
  const [deletingMemberNow, setDeletingMemberNow] = useState(false);

  useEffect(() => {
    if (!storeId) return undefined;

    const invitesQuery = query(
      collection(db, 'stores', storeId, 'staffInvites'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(invitesQuery, (snapshot) => {
      setInvites(snapshot.docs.map((inviteDoc) => ({ id: inviteDoc.id, ...inviteDoc.data() })));
    });

    return () => unsubscribe();
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return undefined;

    const usersQuery = query(collection(db, 'users'), where('storeId', '==', storeId));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const members = snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }));
      members.sort((leftMember, rightMember) => {
        const left = `${leftMember.role || ''}:${leftMember.name || leftMember.email || leftMember.uid}`;
        const right = `${rightMember.role || ''}:${rightMember.name || rightMember.email || rightMember.uid}`;
        return left.localeCompare(right);
      });
      setTeamMembers(members);
    });

    return () => unsubscribe();
  }, [storeId]);

  const inviteBaseUrl = useMemo(() => `${window.location.origin}/register`, []);
  const selectedRoleMeta = ROLE_OPTIONS.find((option) => option.value === selectedRole) || ROLE_OPTIONS[0];
  const activeInviteCount = invites.filter((invite) => invite.status === 'active').length;
  const isDeleteConfirmed = deletingMember?.email && deleteConfirmValue.trim() === deletingMember.email;

  const createInvite = async () => {
    if (!storeId || !ownerUser?.uid) return;

    setCreatingInvite(true);
    try {
      const inviteCode = createSecureToken(12);
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      await setDoc(doc(db, 'stores', storeId, 'staffInvites', inviteCode), {
        storeId,
        role: selectedRole,
        status: 'active',
        createdBy: ownerUser.uid,
        createdAt: serverTimestamp(),
        expiresAt
      });

      await navigator.clipboard.writeText(`${inviteBaseUrl}?store_id=${storeId}&invite=${inviteCode}`);
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyInvite = async (inviteId) => {
    const invite = invites.find((item) => item.id === inviteId);
    if (isInviteUnavailable(invite)) return;

    await navigator.clipboard.writeText(`${inviteBaseUrl}?store_id=${storeId}&invite=${inviteId}`);
    setCopiedInviteId(inviteId);
    window.setTimeout(() => setCopiedInviteId(''), 2200);
  };

  const removeInvite = async (inviteId) => {
    await deleteDoc(doc(db, 'stores', storeId, 'staffInvites', inviteId));
  };

  const openDeleteModal = (member) => {
    setDeletingMember(member);
    setDeleteConfirmValue('');
  };

  const closeDeleteModal = () => {
    if (deletingMemberNow) return;
    setDeletingMember(null);
    setDeleteConfirmValue('');
  };

  const deleteMember = async () => {
    if (!deletingMember?.id || !isDeleteConfirmed) return;

    setDeletingMemberNow(true);
    try {
      await deleteStoreMember(deletingMember.id);
      closeDeleteModal();
    } catch (error) {
      window.alert(getAuthErrorMessage(error, 'メンバー削除に失敗しました。'));
    } finally {
      setDeletingMemberNow(false);
    }
  };

  return (
    <div className="w-full animate-in fade-in duration-300 pb-20">
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex h-24 items-center justify-between border-b bg-orange-50/50 px-8 transition-none">
          <div className="flex min-w-0 items-center gap-5">
            <div className="shrink-0 rounded-2xl bg-orange-500 p-3 text-white shadow-xl shadow-orange-200">
              <Shield size={24} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">スタッフ招待</h3>
              <p className="mt-0.5 text-[10px] font-black tracking-[0.2em] text-orange-300">
                招待管理 / 有効な招待 {activeInviteCount} 件 / 登録人数 {teamMembers.length} 人
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={createInvite}
            disabled={creatingInvite}
            className="inline-flex items-center gap-3 rounded-xl bg-orange-500 px-6 py-3.5 font-black text-white shadow-xl shadow-orange-200 transition-colors hover:bg-orange-600 active:scale-95 disabled:bg-orange-300 disabled:shadow-none"
          >
            {creatingInvite ? <LoadingSpinner size={18} /> : <MailPlus size={20} strokeWidth={2.6} />}
            招待リンクを発行
          </button>
        </div>

        <div className="space-y-5 p-8">
          <p className="text-sm leading-relaxed text-gray-500">
            役割ごとの招待リンクを発行できます。発行したリンクは1回だけ利用でき、有効期限は7日間です。
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {ROLE_OPTIONS.map((option) => {
              const isActive = selectedRole === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedRole(option.value)}
                  className={`rounded-3xl border-2 px-5 py-5 text-left transition-all ${
                    isActive
                      ? 'border-orange-500 bg-orange-50 shadow-xl shadow-orange-100'
                      : 'border-gray-100 bg-white hover:border-orange-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-lg font-black text-gray-900">{option.label}</div>
                      <div className="mt-1 text-sm leading-relaxed text-gray-500">{option.desc}</div>
                    </div>
                    <div
                      className={`h-6 w-6 shrink-0 rounded-full border-2 transition-all ${
                        isActive ? 'border-orange-500 bg-orange-500' : 'border-gray-200 bg-white'
                      }`}
                    >
                      {isActive && <div className="h-full w-full scale-50 rounded-full bg-white" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-2xl">
            <div className="text-[11px] font-black tracking-[0.18em] text-white/45">選択中の招待ロール</div>
            <div className="mt-2 text-2xl font-black">{selectedRoleMeta.label}</div>
            <div className="mt-2 text-sm text-white/60">{selectedRoleMeta.desc}</div>
            <div className="mt-5 text-xs text-white/55">
              発行後は必要なときだけ招待リンクをコピーして共有できます。
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="min-h-[200px] w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex h-24 items-center gap-3 border-b bg-gray-50/70 px-8 transition-none">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
              <RefreshCw size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-black tracking-tight text-gray-900">発行済み招待</h3>
              <p className="mt-1 text-xs text-gray-400">
                リンクは表示せず、必要なときだけコピーして共有できます。
              </p>
            </div>
          </div>

          <div className="space-y-4 p-6">
            {invites.length === 0 && (
              <div className="flex min-h-[78px] items-center justify-center rounded-[1.35rem] border border-dashed border-gray-200 bg-gray-50/70 p-4 text-center shadow-sm">
                <div className="text-sm font-bold text-gray-400">まだ招待リンクは発行されていません</div>
              </div>
            )}

            {invites.map((invite) => {
              const roleMeta = getRoleMeta(invite.role);
              const RoleIcon = roleMeta.Icon;
              const isUnavailable = isInviteUnavailable(invite);
              const statusLabel =
                invite.status === 'active' && isUnavailable
                  ? '期限切れ'
                  : formatInviteStatusLabel(invite.status);

              return (
                <div
                  key={invite.id}
                  className={`overflow-hidden rounded-[1.6rem] border border-gray-100 bg-white shadow-sm ${
                    invite.role === USER_ROLES.MANAGER
                      ? 'border-l-[6px] border-l-orange-400'
                      : 'border-l-[6px] border-l-slate-500'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-4">
                        <div className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${roleMeta.className}`}>
                          <RoleIcon size={18} strokeWidth={2.3} />
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex rounded-full bg-slate-900 px-3 py-1.5 text-xs font-black tracking-[0.12em] text-white">
                              {formatRoleLabel(invite.role)}
                            </span>
                            <span
                              className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black tracking-[0.12em] ${
                                !isUnavailable ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-2xl bg-gray-50 px-3 py-2.5">
                              <div className="text-[10px] font-black tracking-[0.18em] text-gray-400">有効期限</div>
                              <div className="mt-1 text-sm font-bold text-gray-700">{formatDate(invite.expiresAt)}</div>
                            </div>
                            <div className="rounded-2xl bg-gray-50 px-3 py-2.5">
                              <div className="text-[10px] font-black tracking-[0.18em] text-gray-400">発行日時</div>
                              <div className="mt-1 text-sm font-bold text-gray-700">{formatDate(invite.createdAt)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                      <button
                        type="button"
                        onClick={() => copyInvite(invite.id)}
                        disabled={isUnavailable}
                        className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-black ${
                          isUnavailable
                            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <Copy size={14} />
                        {isUnavailable
                          ? 'コピー不可'
                          : copiedInviteId === invite.id
                            ? 'コピーしました'
                            : '招待リンクをコピー'}
                      </button>

                      <button
                        type="button"
                        onClick={() => removeInvite(invite.id)}
                        className="inline-flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-xs font-black text-red-600"
                      >
                        <Trash2 size={14} />
                        招待を削除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-h-[200px] w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex h-24 items-center gap-3 border-b bg-gray-50/70 px-8 transition-none">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200">
              <Users size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-black tracking-tight text-gray-900">登録メンバー</h3>
              <p className="mt-1 text-xs text-gray-400">
                現在この店舗に登録されているユーザー一覧です。
              </p>
            </div>
          </div>

          <div className="space-y-3 p-6">
            {teamMembers.length === 0 && (
              <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50/70 p-8 text-center">
                <div className="text-sm font-bold text-gray-400">登録メンバーはまだ追加されていません</div>
              </div>
            )}

            {teamMembers.map((member) => {
              const roleMeta = getRoleMeta(member.role);
              const RoleIcon = roleMeta.Icon;
              const isManageable = canManageMember(member, ownerUser);

              return (
                <div key={member.id} className="rounded-[1.35rem] border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-gray-900">{member.name || '名前未設定'}</div>
                      <div className="mt-1 truncate text-xs text-gray-400">{member.email || member.uid}</div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <div className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-black tracking-widest ${roleMeta.className}`}>
                        <RoleIcon size={14} />
                        {formatRoleLabel(member.role)}
                      </div>
                      {isManageable && (
                        <button
                          type="button"
                          onClick={() => openDeleteModal(member)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-black text-red-600"
                          title="メンバーを削除"
                        >
                          <Trash2 size={14} />
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {deletingMember && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md rounded-[2.5rem] bg-white p-10 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">
              登録メンバーを削除しますか？
            </h3>
            <p className="mb-6 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">{deletingMember.name || '名前未設定'}</span> を削除します。
              誤削除を防ぐため、下に同じメールアドレスをそのまま入力してください。
            </p>

            <div className="mb-8 space-y-3 text-left">
              <label className="block px-1 text-xs font-black uppercase tracking-[0.18em] text-gray-400">
                確認用メールアドレス
              </label>
              <input
                value={deleteConfirmValue}
                onChange={(event) => setDeleteConfirmValue(event.target.value)}
                placeholder={deletingMember.email}
                className="h-14 w-full rounded-2xl border-2 border-gray-100 px-5 text-base font-bold text-gray-800 outline-none transition-all focus:border-red-400 focus:ring-4 focus:ring-red-50"
              />
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={deleteMember}
                disabled={!isDeleteConfirmed || deletingMemberNow}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600 active:scale-95 disabled:bg-red-200 disabled:shadow-none"
              >
                {deletingMemberNow ? <LoadingSpinner size={20} /> : '削除する'}
              </button>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deletingMemberNow}
                className="w-full rounded-2xl py-4 font-bold text-gray-400 transition-colors hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffInviteSettings;
