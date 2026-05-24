import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  RotateCcw
} from 'lucide-react';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';

import { auth } from '../../shared/api/firebase/client';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { getAuthErrorMessage } from '../../shared/utils/authErrorMessages';

const cardClassName = 'w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl';

const PasswordResetConfirmPage = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const oobCode = searchParams.get('oobCode') || '';

  useEffect(() => {
    let cancelled = false;

    const verifyCode = async () => {
      if (!oobCode) {
        if (!cancelled) {
          setError('再設定リンクを確認できませんでした。メールのリンクを開き直してください。');
          setIsChecking(false);
        }
        return;
      }

      try {
        const verifiedEmail = await verifyPasswordResetCode(auth, oobCode);
        if (!cancelled) {
          setEmail(verifiedEmail);
        }
      } catch (verifyError) {
        if (!cancelled) {
          setError(getAuthErrorMessage(verifyError, '再設定リンクの有効期限が切れているか、すでに利用されています。'));
        }
      } finally {
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    };

    verifyCode();

    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('新しいパスワードを入力してください。');
      return;
    }

    if (password !== confirmPassword) {
      setError('確認用パスワードが一致しません。');
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setSuccess(true);
    } catch (resetError) {
      setError(getAuthErrorMessage(resetError, 'パスワードの再設定に失敗しました。'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-blue-600 p-3 text-white shadow-lg">
              <LoadingSpinner size={32} colorClass="text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">確認中...</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">再設定リンクを確認しています。</p>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-emerald-600 p-3 text-white shadow-lg">
              <CheckCircle2 size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">再設定が完了しました</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">新しいパスワードでログインできます。</p>
          </div>

          <div className="space-y-5 p-8">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm leading-relaxed text-emerald-700">
              パスワードの更新が完了しました。ログイン画面へ戻って、新しいパスワードでログインしてください。
            </div>

            <Link
              to="/login"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 text-base font-black text-white shadow-lg transition hover:bg-black"
            >
              <RotateCcw size={18} />
              ログイン画面へ戻る
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (error && !email) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-red-500 p-3 text-white shadow-lg">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">リンクを確認できませんでした</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">再設定リンクの期限切れ、または既に使用済みの可能性があります。</p>
          </div>

          <div className="space-y-5 p-8">
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-sm leading-relaxed text-red-700">
              {error}
            </div>

            <Link
              to="/reset-password"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-base font-black text-white shadow-lg transition hover:bg-blue-700"
            >
              <KeyRound size={18} />
              再設定メールを送り直す
            </Link>

            <Link
              to="/login"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white text-base font-black text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              <ArrowLeft size={18} />
              ログイン画面に戻る
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
      <div className={cardClassName}>
        <div className="bg-gray-900 p-8 text-center">
          <div className="mb-4 inline-flex rounded-2xl bg-blue-600 p-3 text-white shadow-lg">
            <LockKeyhole size={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">新しいパスワードを設定</h1>
          <p className="mt-2 text-sm font-medium text-gray-400">認証済みのアカウントに新しいパスワードを設定します。</p>
        </div>

        <div className="p-8">
          <Link to="/login" className="mb-6 inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-800">
            <ArrowLeft size={16} className="mr-1" /> ログインに戻る
          </Link>

          {error && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertCircle size={16} />
              <span className="font-bold">{error}</span>
            </div>
          )}

          <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-relaxed text-slate-600">
            <div className="font-black text-slate-800">再設定対象</div>
            <div className="mt-1 break-all">{email}</div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 ml-1 block text-xs font-black uppercase tracking-widest text-gray-500">新しいパスワード</label>
              <input
                type="password"
                required
                className="w-full rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-blue-500 focus:bg-white"
                placeholder="6文字以上で入力"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 ml-1 block text-xs font-black uppercase tracking-widest text-gray-500">確認用パスワード</label>
              <input
                type="password"
                required
                className="w-full rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-blue-500 focus:bg-white"
                placeholder="もう一度入力"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 font-bold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-[0.98] disabled:bg-blue-300"
            >
              {isSubmitting ? <LoadingSpinner size={20} colorClass="text-white" /> : '新しいパスワードを設定'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PasswordResetConfirmPage;
