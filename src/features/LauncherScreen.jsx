import React, { useState } from 'react';
import {
  AlertCircle,
  Calculator,
  ChefHat,
  LogOut,
  Settings,
  Utensils
} from 'lucide-react';

import { useAuth } from '../app/providers/useAuth';
import {
  USER_ROLES,
  canAccessAdminPanel,
  canAccessKitchen,
  normalizeUserRole
} from '../shared/utils/roles';

const LauncherScreen = ({ onModeSelect }) => {
  const { logout, currentUser, role, profileName } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const normalizedRole = normalizeUserRole(role);
  const canUseKitchen = canAccessKitchen(normalizedRole);
  const canUseAdminPanel = canAccessAdminPanel(normalizedRole);
  const isStaffOnly = normalizedRole === USER_ROLES.STAFF;

  const accountLabel = (() => {
    if (profileName?.trim()) return profileName.trim();
    if (currentUser?.email) return currentUser.email.split('@')[0];
    return 'ゲスト';
  })();

  const kitchenCardLayout = 'md:col-span-2 md:col-start-1';
  const serveCardLayout = 'md:col-span-2 md:col-start-3';
  const adminCardLayout = 'md:col-span-2 md:col-start-5';

  const adminCardTitle = isStaffOnly ? 'レジ' : '管理画面';
  const AdminCardIcon = isStaffOnly ? Calculator : Settings;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-100 p-6 font-sans">
      <div className="absolute right-6 top-6">
        <div className="flex items-center gap-4">
          <div className="hidden min-w-0 items-center gap-3 sm:flex">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white shadow-sm shadow-slate-300/70">
              {accountLabel.slice(0, 1)}
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900">
                {accountLabel}
              </p>
              <p className="truncate text-[11px] text-slate-600">
                {currentUser?.email || ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="flex h-12 items-center justify-center gap-2 rounded-[1.1rem] bg-red-100 px-4 text-red-600 shadow-sm ring-1 ring-red-200 transition-all hover:bg-red-500 hover:text-white hover:ring-red-300 focus-visible:bg-red-500 focus-visible:text-white focus-visible:ring-red-300"
            aria-label="ログアウト"
            title="ログアウト"
          >
            <LogOut size={20} />
            <span className="text-[12px] font-black leading-none">
              ログアウト
            </span>
          </button>
        </div>
      </div>

      <div className="grid w-full max-w-5xl gap-6 md:grid-cols-6">
        <div className="col-span-full mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-slate-800">
            Pitto Order System
          </h1>
          <p className="text-slate-500">
            最初のモードを選択して作業を開始してください。
          </p>
        </div>

        {canUseKitchen && (
          <button
            type="button"
            onClick={() => onModeSelect('kitchen')}
            className={`group flex flex-col items-center rounded-2xl border-b-4 border-slate-700 bg-white p-8 shadow-xl transition-all hover:-translate-y-1 ${kitchenCardLayout}`}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors">
              <ChefHat size={32} />
            </div>

            <h2 className="text-xl font-bold text-gray-800">
              キッチンディスプレイ
            </h2>

            <p className="mt-2 text-center text-sm font-bold leading-relaxed text-gray-400">
              調理状況と注文を確認
            </p>
          </button>
        )}

        {canUseAdminPanel && (
          <button
            type="button"
            onClick={() => onModeSelect('admin')}
            className={`group flex flex-col items-center rounded-2xl border-b-4 border-orange-600 bg-white p-8 shadow-xl transition-all hover:-translate-y-1 ${adminCardLayout}`}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-600 transition-colors">
              <AdminCardIcon size={32} />
            </div>

            <h2 className="text-xl font-bold text-gray-800">
              {adminCardTitle}
            </h2>

            <p className="mt-2 text-center text-sm font-bold leading-relaxed text-gray-400">
              会計・設定・管理
            </p>
          </button>
        )}

        <div className="col-span-full mt-4 text-center text-sm text-gray-400">
          従業員専用画面
        </div>
      </div>

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] bg-white p-10 text-center shadow-2xl animate-in zoom-in-95">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertCircle size={40} className="text-red-500" />
            </div>

            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">
              ログアウトしますか？
            </h3>

            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              設定中の内容を確認してからログイン画面に戻ります。
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={logout}
                className="w-full rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600 active:scale-95"
              >
                ログアウト
              </button>

              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
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

export default LauncherScreen;