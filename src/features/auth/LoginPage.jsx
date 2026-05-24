import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, LogIn, Store } from 'lucide-react';

import { useAuth } from '../../app/providers/useAuth';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { getAuthErrorMessage } from '../../shared/utils/authErrorMessages';
import ForgotEmailHelpModal from './components/ForgotEmailHelpModal';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showForgotEmailHelp, setShowForgotEmailHelp] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsLoggingIn(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (loginError) {
      setError(getAuthErrorMessage(loginError, 'ログインに失敗しました。'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 font-sans">
      <ForgotEmailHelpModal open={showForgotEmailHelp} onClose={() => setShowForgotEmailHelp(false)} />
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="bg-gray-900 p-8 text-center">
          <div className="mb-4 inline-flex rounded-2xl bg-blue-600 p-3 text-white shadow-lg"><Store size={32} /></div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Akuto Order System</h1>
          <p className="mt-2 text-sm font-medium text-gray-400">店舗管理コンソール</p>
        </div>

        <div className="p-8">
          {error && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 animate-in fade-in slide-in-from-top-1">
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
            <div>
              <label className="mb-2 ml-1 block text-xs font-black uppercase tracking-widest text-gray-500">パスワード</label>
              <input
                type="password"
                required
                className="w-full rounded-xl border-2 border-gray-100 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-blue-500 focus:bg-white"
                placeholder="パスワードを入力"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 font-bold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-[0.98]"
            >
              {isLoggingIn ? <LoadingSpinner size={20} colorClass="text-white" /> : <><LogIn size={20} /><span>ログイン</span></>}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between gap-4 text-sm">
            <button
              type="button"
              onClick={() => setShowForgotEmailHelp(true)}
              className="font-bold text-gray-500 transition hover:text-gray-700 hover:underline"
            >
              メールアドレスを忘れた方
            </button>
            <Link to="/reset-password" className="font-bold text-blue-600 transition hover:text-blue-700 hover:underline">
              パスワードを忘れた方
            </Link>
          </div>

          <div className="mt-8 border-t border-gray-100 pt-6 text-center">
            <p className="text-sm text-gray-500">
              アカウントをお持ちでないですか？
              <Link to="/register" className="ml-2 font-bold text-blue-600 hover:underline">新規登録</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
