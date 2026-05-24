import React from 'react';
import { AlertTriangle, MailQuestion, UserCog, UserRound } from 'lucide-react';

const ForgotEmailHelpModal = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-[2.25rem] bg-white p-8 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 shadow-inner">
            <MailQuestion size={26} strokeWidth={2.4} />
          </div>
          <div>
            <h3 className="text-2xl font-black tracking-tight text-gray-900">登録メールアドレスを忘れた方</h3>
            <p className="mt-1 text-sm font-medium text-gray-500">
              メールアドレスの確認は自動では行えないため、立場に応じてご案内しています。
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
              <UserCog size={16} className="text-orange-500" />
              スタッフ・マネージャーの方
            </div>
            <p className="text-sm leading-relaxed text-gray-600">
              店舗オーナーへご確認ください。必要に応じて、オーナーから再招待を依頼してください。
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
              <UserRound size={16} className="text-orange-500" />
              オーナーの方
            </div>
            <p className="text-sm leading-relaxed text-gray-600">
              ご利用開始時の情報をご確認のうえ、運営サポートへお問い合わせください。本人確認後、登録メールアドレスの確認をご案内します。
            </p>
          </div>

          <div className="flex gap-3 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4 text-sm leading-relaxed text-orange-700">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>パスワードが分からない場合は、この画面を閉じて「パスワードを忘れた方」から再設定してください。</p>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl bg-slate-900 px-6 text-sm font-black text-white shadow-lg transition hover:bg-black active:scale-[0.98]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForgotEmailHelpModal;
