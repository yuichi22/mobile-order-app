import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ShieldCheck, UserPlus } from 'lucide-react';

import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { useAuth } from '../../app/providers/useAuth';
import { getAuthErrorMessage } from '../../shared/utils/authErrorMessages';

const RegisterPage = () => {
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') || '');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const inviteStoreId = searchParams.get('store_id') || '';
  const hasInvite = Boolean(inviteCode && inviteStoreId);
  const pageTitle = useMemo(
    () => (hasInvite ? 'スタッフアカウント登録' : 'オーナーアカウント登録'),
    [hasInvite]
  );

  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleRegister = async (event) => {
    event.preventDefault();
    setError('');
    setIsProcessing(true);

    try {
      const signupResult = await signup(email, password, {
        name: name.trim(),
        inviteCode: inviteCode.trim(),
        inviteStoreId: inviteStoreId.trim()
      });

      navigate(hasInvite || signupResult?.invited || signupResult?.ownerRegistered ? '/login' : '/');
    } catch (signupError) {
      setError(getAuthErrorMessage(signupError, 'アカウント登録に失敗しました。'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <Link to="/login" className="mb-6 inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-800">
          <ArrowLeft size={16} className="mr-1" /> ログインに戻る
        </Link>

        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="mb-1 text-2xl font-bold text-gray-800">{pageTitle}</h1>
            <p className="text-sm leading-relaxed text-gray-500">
              {hasInvite
                ? '招待リンクからスタッフ用アカウントを登録します。'
                : '最初の店舗オーナーアカウントを登録します。'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle size={16} />
            <span className="font-bold">{error}</span>
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-5">
          <div>
            <label className="mb-2 block text-xs font-black text-gray-500">名前</label>
            <input
              type="text"
              required
              className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="河野 瑛篤"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-black text-gray-500">メールアドレス</label>
            <input
              type="email"
              required
              className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="staff@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-black text-gray-500">パスワード</label>
            <input
              type="password"
              required
              className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="6文字以上で入力"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <div className="hidden">
            <label className="mb-2 block text-xs font-black text-gray-500">招待コード</label>
            <input
              type="text"
              className="w-full rounded-xl border-2 border-gray-100 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="招待コードを入力"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
            />
          </div>

          {inviteStoreId && (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs font-medium text-gray-500">
              対象店舗ID: {inviteStoreId}
            </div>
          )}

          <button
            type="submit"
            disabled={isProcessing}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-4 font-bold text-white shadow-lg transition-all active:scale-[0.98] hover:bg-black"
          >
            {isProcessing ? <LoadingSpinner size={20} colorClass="text-white" /> : <><UserPlus size={20} /><span>アカウントを登録</span></>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
