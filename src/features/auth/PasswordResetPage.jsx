import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, MailCheck, RotateCcw } from 'lucide-react';

import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { getAuthErrorMessage } from '../../shared/utils/authErrorMessages';
import ForgotEmailHelpModal from './components/ForgotEmailHelpModal';
import { sendResetPasswordMail } from './services/passwordResetService';

const PasswordResetPage = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [showForgotEmailHelp, setShowForgotEmailHelp] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await sendResetPasswordMail(email);
      setSent(true);
    } catch (resetError) {
      setError(getAuthErrorMessage(resetError, '再設定メールの送信に失敗しました。'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
        <ForgotEmailHelpModal open={showForgotEmailHelp} onClose={() => setShowForgotEmailHelp(false)} />
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="bg-gray-900 p-8 text-center">
            <div className="mb-4 inline-flex rounded-2xl bg-blue-600 p-3 text-white shadow-lg">
              <MailCheck size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">再設定メールを送信しました</h1>
            <p className="mt-2 text-sm font-medium text-gray-400">受信したメールから新しいパスワードを設定してください。</p>
          </div>

          <div className="space-y-5 p-8">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-relaxed text-slate-600">
              <div className="font-black text-slate-800">送信先</div>
              <div className="mt-1 break-all">{email}</div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-sm leading-relaxed text-slate-500">
              登録メールアドレスを忘れた場合は、
              <button
                type="button"
                onClick={() => setShowForgotEmailHelp(true)}
                className="ml-1 font-bold text-blue-600 transition hover:text-blue-700 hover:underline"
              >
                こちらの案内
              </button>
              をご確認ください。
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm leading-relaxed text-amber-700">
              メールが届かない場合は、迷惑メールフォルダもあわせてご確認ください。
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans">
      <ForgotEmailHelpModal open={showForgotEmailHelp} onClose={() => setShowForgotEmailHelp(false)} />
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="bg-gray-900 p-8 text-center">
          <div className="mb-4 inline-flex rounded-2xl bg-blue-600 p-3 text-white shadow-lg">
            <MailCheck size={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">パスワードを再設定</h1>
          <p className="mt-2 text-sm font-medium text-gray-400">登録メールアドレス宛に再設定用のメールを送信します。</p>
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

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 ml-1 block text-xs font-black uppercase tracking-widest text-gray-500">メールアドレス</label>
              <input
                type="email"
                required
                className="w-full rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-blue-500 focus:bg-white"
                placeholder="owner@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 font-bold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-[0.98] disabled:bg-blue-300"
            >
              {isSubmitting ? <LoadingSpinner size={20} colorClass="text-white" /> : '再設定メールを送信'}
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-sm leading-relaxed text-slate-500">
            登録メールアドレスを忘れた場合は、
            <button
              type="button"
              onClick={() => setShowForgotEmailHelp(true)}
              className="ml-1 font-bold text-blue-600 transition hover:text-blue-700 hover:underline"
            >
              こちらの案内
            </button>
            をご確認ください。
          </div>

          <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm leading-relaxed text-amber-700">
            メールが届かない場合は、迷惑メールフォルダもあわせてご確認ください。
          </div>
        </div>
      </div>
    </div>
  );
};

export default PasswordResetPage;
