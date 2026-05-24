import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BadgeCheck, MailCheck } from 'lucide-react';
import { applyActionCode } from 'firebase/auth';

import { auth } from '../../shared/api/firebase/client';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { getAuthErrorMessage } from '../../shared/utils/authErrorMessages';
import PasswordResetConfirmPage from './PasswordResetConfirmPage';

const cardClassName = 'w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl';

const EmailActionPage = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || '';
  const oobCode = searchParams.get('oobCode') || '';
  const isResetMode = mode === 'resetPassword';
  const isVerifyMode = mode === 'verifyEmail';
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const loadingTitle = useMemo(() => {
    if (isVerifyMode) return 'メールアドレスを確認中...';
    return '読み込み中...';
  }, [isVerifyMode]);

  useEffect(() => {
    if (isResetMode || !isVerifyMode || !oobCode) {
      return undefined;
    }

    let cancelled = false;

    const verifyEmailAddress = async () => {
      try {
        await applyActionCode(auth, oobCode);
        if (!cancelled) {
          setStatus('success');
        }
      } catch (verifyError) {
        if (!cancelled) {
          setError(getAuthErrorMessage(verifyError, 'メールアドレスの確認に失敗しました。'));
          setStatus('error');
        }
      }
    };

    verifyEmailAddress();

    return () => {
      cancelled = true;
    };
  }, [isResetMode, isVerifyMode, oobCode]);

  if (isResetMode) {
    return <PasswordResetConfirmPage />;
  }

  if (!isVerifyMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-red-500 p-3 text-white shadow-lg">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">認証リンクを確認できませんでした</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">この認証リンクには対応していません。</p>
          </div>

          <div className="space-y-5 p-8">
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

  if (!oobCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-red-500 p-3 text-white shadow-lg">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">認証リンクを確認できませんでした</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">メール内のリンクを開き直してください。</p>
          </div>

          <div className="space-y-5 p-8">
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

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-blue-600 p-3 text-white shadow-lg">
              <LoadingSpinner size={32} colorClass="text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{loadingTitle}</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">リンクの有効性を確認しています。</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <div className={cardClassName}>
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-emerald-600 p-3 text-white shadow-lg">
              <BadgeCheck size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">メールアドレスを確認しました</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">認証が完了しました。ログインしてご利用ください。</p>
          </div>

          <div className="space-y-5 p-8">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm leading-relaxed text-emerald-700">
              メールアドレスの確認が完了しました。ログイン画面からそのままご利用いただけます。
            </div>

            <Link
              to="/login"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 text-base font-black text-white shadow-lg transition hover:bg-black"
            >
              <MailCheck size={18} />
              ログイン画面へ進む
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
          <div className="mb-4 inline-flex rounded-2xl bg-red-500 p-3 text-white shadow-lg">
            <AlertCircle size={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">認証リンクを確認できませんでした</h1>
          <p className="mt-2 text-sm font-medium text-gray-400">リンクの有効期限切れ、または既に使用済みの可能性があります。</p>
        </div>

        <div className="space-y-5 p-8">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-sm leading-relaxed text-red-700">
            {error || '認証リンクを開けませんでした。必要に応じて認証メールを再送してください。'}
          </div>

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
};

export default EmailActionPage;
