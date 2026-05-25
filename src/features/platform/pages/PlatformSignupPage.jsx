import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MonitorSmartphone,
  QrCode,
  ReceiptText,
  Sparkles
} from 'lucide-react';

const initialForm = {
  companyName: '',
  storeName: '',
  contactName: '',
  email: '',
  tel: '',
  message: ''
};

const submitSignupLead = async (form) => {
  const response = await fetch('/api/submitPlatformSignupLead', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...form,
      source: 'akuto_signup_page'
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || '送信に失敗しました。');
    error.code = payload?.error?.code || 'app/request-failed';
    throw error;
  }

  return payload;
};

const PlatformSignupPage = () => {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const updateField = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.storeName.trim() || !form.contactName.trim() || !form.email.trim()) {
      setError('店舗名・担当者名・メールアドレスを入力してください。');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await submitSignupLead(form);
      setSubmitted(true);
      setForm(initialForm);
    } catch (submitError) {
      console.error('[PlatformSignupPage] submit failed', submitError);
      setError(submitError.message || '送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1fr_460px] lg:items-center">
        <section>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-black text-emerald-200">
            <Sparkles size={15} strokeWidth={3} />
            Akuto Mobile Order
          </div>

          <h1 className="max-w-3xl text-4xl font-black tracking-tight md:text-6xl">
            お店の注文体験を、<br className="hidden md:block" />
            もっとスマートに。
          </h1>

          <p className="mt-6 max-w-2xl text-base font-bold leading-8 text-slate-300 md:text-lg">
            固定QR注文、スマートメニュー、キッチンモニター、売上分析まで。
            省人化と売上アップを、ひとつのシンプルな店舗システムで支えます。
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {[
              { icon: QrCode, title: '固定QR注文', text: '会計ごとのQR発行・設置作業から解放。' },
              { icon: ReceiptText, title: 'スマートメニュー', text: 'ミニマルな画面とクロスセルで注文体験を向上。' },
              { icon: MonitorSmartphone, title: 'キッチン・分析', text: '提供タイミングと売上トレンドを見える化。' }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-3xl border border-white/10 bg-white/10 p-5">
                  <Icon className="h-7 w-7 text-emerald-300" strokeWidth={3} />
                  <h3 className="mt-4 text-sm font-black">{item.title}</h3>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-400">{item.text}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-8 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
            <p className="text-sm font-black text-emerald-200">
              Standard 月額 14,800円 / 店舗
            </p>
            <p className="mt-2 text-xs font-bold leading-6 text-slate-300">
              固定QR、POS、キッチン表示、売上分析に対応。SNS画像URLを活用したメニュー登録や、売り上げUPに直結する、ビジュアルを使ったスタイリッシュなおすすめ機能。
            </p>
          </div>
        </section>

        <section className="rounded-[2rem] bg-white p-6 text-slate-900 shadow-2xl">
          {submitted ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={34} strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-black">送信しました</h2>
              <p className="mt-3 text-sm font-bold leading-7 text-slate-500">
                お申し込み内容を確認のうえ、Akuto担当者よりご連絡します。
                デモ画面、初期設定、メニュー登録、プリンター接続など、店舗の状況に合わせてご案内します。
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="mt-8 h-12 rounded-2xl bg-slate-900 px-6 text-sm font-black text-white"
              >
                もう一度入力する
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-black">無料デモ・導入相談</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
                店舗情報を入力してください。担当者より、デモのご案内と導入方法についてご連絡します。
              </p>

              <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">会社名・運営名</span>
                  <input
                    value={form.companyName}
                    onChange={(event) => updateField('companyName', event.target.value)}
                    className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-slate-900"
                    placeholder="例：株式会社〇〇"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">店舗名 *</span>
                  <input
                    value={form.storeName}
                    onChange={(event) => updateField('storeName', event.target.value)}
                    className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-slate-900"
                    placeholder="例：TABLE HAUS"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">担当者名 *</span>
                  <input
                    value={form.contactName}
                    onChange={(event) => updateField('contactName', event.target.value)}
                    className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-slate-900"
                    placeholder="例：山田 太郎"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-xs font-black text-slate-400">メール *</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => updateField('email', event.target.value)}
                      className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-slate-900"
                      placeholder="owner@example.com"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-xs font-black text-slate-400">電話番号</span>
                    <input
                      value={form.tel}
                      onChange={(event) => updateField('tel', event.target.value)}
                      className="h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-slate-900"
                      placeholder="090-0000-0000"
                    />
                  </label>
                </div>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">ご相談内容</span>
                  <textarea
                    value={form.message}
                    onChange={(event) => updateField('message', event.target.value)}
                    className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-slate-900"
                    placeholder="例：QR注文を試したい、SNS画像URLからメニュー登録したい、レシートプリンター接続も確認したい"
                  />
                </label>

                {error && (
                  <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 inline-flex h-13 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-sm font-black text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      送信中...
                    </>
                  ) : (
                    <>
                      無料デモを相談する
                      <ArrowRight size={16} strokeWidth={3} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default PlatformSignupPage;
