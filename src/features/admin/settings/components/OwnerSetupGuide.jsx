import React, { useMemo } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Sparkles,
  X
} from 'lucide-react';

const StepCard = ({ step, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(step.id)}
    className={`w-full rounded-3xl border px-5 py-4 text-left transition-all ${
      step.isComplete
        ? 'border-emerald-100 bg-emerald-50/80'
        : step.isRequired
          ? 'border-orange-100 bg-white hover:border-orange-200 hover:bg-orange-50/40'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
    }`}
  >
    <div className="flex items-start gap-4">
      <div
        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
          step.isComplete
            ? 'bg-emerald-500 text-white'
            : step.isRequired
              ? 'bg-orange-500 text-white'
              : 'bg-slate-100 text-slate-500'
        }`}
      >
        {step.isComplete ? <CheckCircle2 size={20} /> : <step.icon size={20} strokeWidth={2.4} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-base font-black text-gray-900">{step.label}</div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black tracking-[0.18em] ${
              step.isComplete
                ? 'bg-emerald-100 text-emerald-700'
                : step.isRequired
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {step.isComplete ? '完了' : step.isRequired ? '必須' : 'おすすめ'}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{step.desc}</p>
      </div>
      <ArrowRight size={18} className="mt-1 shrink-0 text-gray-300" />
    </div>
  </button>
);

const OwnerSetupGuide = ({
  ownerName,
  steps,
  onSelectStep,
  isModalOpen,
  onCloseModal
}) => {
  const requiredSteps = useMemo(() => steps.filter((step) => step.isRequired), [steps]);
  const recommendedSteps = useMemo(() => steps.filter((step) => !step.isRequired), [steps]);
  const completedRequiredCount = requiredSteps.filter((step) => step.isComplete).length;
  const completedCount = steps.filter((step) => step.isComplete).length;
  const nextStep = steps.find((step) => !step.isComplete) || null;
  const isReadyToLaunch = completedRequiredCount === requiredSteps.length;

  return (
    <>
      <section className="mb-8 overflow-hidden rounded-[2rem] border border-orange-100 bg-white shadow-sm">
        <div className="flex flex-col gap-6 border-b border-orange-100 bg-orange-50/70 px-8 py-7 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-200">
                <Sparkles size={22} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-2xl font-black tracking-tight text-orange-600">
                    {isReadyToLaunch ? '営業開始の準備が整いました' : '最初にここまで設定すると使い始めやすいです'}
                  </h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-orange-900/70">
                  {ownerName ? `${ownerName} さん向けに` : 'オーナー向けに'}、開店前に整えておくと安心な設定をまとめています。
                  まずは必須の項目から進めれば十分です。
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[10px] font-black tracking-[0.18em] text-orange-300">必須ステップ</div>
              <div className="mt-1 text-lg font-black text-gray-900">
                {completedRequiredCount} / {requiredSteps.length}
              </div>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[10px] font-black tracking-[0.18em] text-orange-300">全体の進み具合</div>
              <div className="mt-1 text-lg font-black text-gray-900">
                {completedCount} / {steps.length}
              </div>
            </div>
            {nextStep && (
              <button
                type="button"
                onClick={() => onSelectStep(nextStep.id)}
                className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3.5 text-sm font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95"
              >
                次は {nextStep.label}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-6 px-8 py-8 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-orange-500" />
              <h4 className="text-sm font-black tracking-[0.18em] text-gray-400">まずはここまで</h4>
            </div>
            <div className="space-y-3">
              {requiredSteps.map((step) => (
                <StepCard key={step.id} step={step} onSelect={onSelectStep} />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-center gap-2">
              <Circle size={18} className="text-gray-300" />
              <h4 className="text-sm font-black tracking-[0.18em] text-gray-400">あとからでも大丈夫</h4>
            </div>
            <div className="space-y-3">
              {recommendedSteps.map((step) => (
                <StepCard key={step.id} step={step} onSelect={onSelectStep} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-[2.2rem] bg-white shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-4 border-b border-orange-100 bg-orange-50/80 px-8 py-7">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-200">
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black tracking-tight text-orange-600">
                      はじめに確認しておきたい項目
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-orange-900/70">
                      すべて一気に設定しなくても大丈夫です。まずは営業開始に必要な項目から進めましょう。
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseModal}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm transition-colors hover:text-gray-600"
                aria-label="閉じる"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-6 px-8 py-8 xl:grid-cols-2">
              <div className="rounded-3xl border border-orange-100 bg-orange-50/50 p-6">
                <div className="mb-4 text-sm font-black tracking-[0.18em] text-orange-400">
                  最低限で営業を始める順番
                </div>
                <div className="space-y-3">
                  {requiredSteps.map((step, index) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => onSelectStep(step.id)}
                      className="flex w-full items-start gap-4 rounded-2xl bg-white px-4 py-4 text-left shadow-sm transition-all hover:shadow-md"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-sm font-black text-white">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="text-base font-black text-gray-900">{step.label}</div>
                        <div className="mt-1 text-sm leading-relaxed text-gray-500">{step.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-gray-100 bg-gray-50/70 p-6">
                <div className="mb-4 text-sm font-black tracking-[0.18em] text-gray-400">
                  あとから整えてもよい項目
                </div>
                <div className="space-y-3">
                  {recommendedSteps.map((step) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => onSelectStep(step.id)}
                      className="flex w-full items-start gap-4 rounded-2xl bg-white px-4 py-4 text-left shadow-sm transition-all hover:shadow-md"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <step.icon size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base font-black text-gray-900">{step.label}</div>
                        <div className="mt-1 text-sm leading-relaxed text-gray-500">{step.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 px-8 py-6 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCloseModal}
                className="rounded-2xl px-6 py-3.5 text-sm font-bold text-gray-400 transition-colors hover:bg-gray-50"
              >
                あとで見る
              </button>
              {nextStep && (
                <button
                  type="button"
                  onClick={() => onSelectStep(nextStep.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95"
                >
                  最初の1項目へ進む
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OwnerSetupGuide;
