//basicSettings.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  ChefHat,
  Copy,
  CreditCard,
  DollarSign,
  Edit2,
  Percent,
  Plus,
  ScanQrCode,
  Receipt,
  Printer,
  Save,
  Smartphone,
  Star,
  Store,
  Palette,
  Trash2,
  Layers
} from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { TAX_ROUNDING_OPTIONS, normalizeTaxRounding } from '../../../../shared/utils/tax';
import { checkPrintBridgeHealth, printTestViaBridge } from '../../../../shared/api/printBridge';
import { getActiveRegisterContext, getAvailableRegisters, setActiveRegisterContext } from '../../../pos/utils/registerContext';

const SettingSection = ({ title, desc, icon, children }) => {
  const SectionIcon = icon;

  return (
    <div className="grid grid-cols-1 gap-8 border-b border-gray-200 py-10 last:border-0 lg:grid-cols-12 lg:gap-12">


      <div className="space-y-2 lg:col-span-4">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
            <SectionIcon size={16} strokeWidth={2.5} />
          </div>
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        </div>
        <p className="pl-10 text-sm font-medium leading-relaxed text-gray-500">{desc}</p>
      </div>

      <div className="lg:col-span-8">
        <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:p-8">
          {children}
        </div>
      </div>
    </div>
  );
};

const DEFAULT_KITCHENS = [
  { id: 'k1', name: 'メインキッチン', isDefault: true }
];

const PAYMENT_METHOD_OPTIONS = [
  { id: 'cash', label: '現金', icon: DollarSign },
  { id: 'card', label: 'カード', icon: CreditCard },
  { id: 'qr', label: 'QR決済', icon: ScanQrCode }
];

const CUSTOMER_THEME_COLORS = [
  '#0f172a',
  '#475569',
  '#6a8ba2',
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#92400e',
  '#dc2626',
  '#ea580c'
];

const BasicSettings = ({
  settings,
  onSave,
  storeId,
  cookingCategories = [],
  onSaveCookingCategories,
  onSaved
}) => {
  const formRef = useRef(null);
  const [activeRegisterContext, setActiveRegisterContextState] = useState(() => (
    getActiveRegisterContext(storeId, settings?.registers)
  ));

  useEffect(() => {
    setActiveRegisterContextState(getActiveRegisterContext(storeId, settings?.registers));
  }, [storeId, settings?.registers]);

  const registerOptions = useMemo(
    () => getAvailableRegisters(settings?.registers),
    [settings?.registers]
  );

  const [registerDrafts, setRegisterDrafts] = useState(() => registerOptions);

  useEffect(() => {
    setRegisterDrafts(registerOptions);
  }, [registerOptions]);

  const saveRegisterDrafts = async (nextRegisters = registerDrafts) => {
    const normalizedRegisters = getAvailableRegisters(nextRegisters);

    await onSave({
      ...settings,
      registers: normalizedRegisters
    });

    return normalizedRegisters;
  };

  const updateRegisterNameDraft = (registerId, name) => {
    setRegisterDrafts((current) => (
      getAvailableRegisters(current).map((register) => (
        register.id === registerId
          ? { ...register, name, label: name }
          : register
      ))
    ));
  };

  const commitRegisterNameDraft = async () => {
    await saveRegisterDrafts(registerDrafts);
  };

  const handleSelectActiveRegister = async (register) => {
    const normalizedDrafts = await saveRegisterDrafts(registerDrafts);
    const latestRegister = normalizedDrafts.find((entry) => entry.id === register.id) || register;
    const nextRegister = setActiveRegisterContext(storeId, latestRegister);
    setActiveRegisterContextState(nextRegister);
  };

  const [bannerPreview, setBannerPreview] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [taxRounding, setTaxRounding] = useState('floor');
  const [menuPriceTaxMode, setMenuPriceTaxMode] = useState('tax_included');
  const [defaultCostTaxMode, setDefaultCostTaxMode] = useState('tax_included');
  const [defaultCostTaxRateType, setDefaultCostTaxRateType] = useState('standard');
  const [enabledPaymentMethods, setEnabledPaymentMethods] = useState(['cash', 'card', 'qr']);
  const [allowTakeout, setAllowTakeout] = useState(true);
  const [newKitchenName, setNewKitchenName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [deletingKitchen, setDeletingKitchen] = useState(null);
  const [kitchenDraft, setKitchenDraft] = useState(null);
  const [kitchenDraftSourceKey, setKitchenDraftSourceKey] = useState(null);
  const [customerLogoPreview, setCustomerLogoPreview] = useState(null);
  const [customerThemeColor, setCustomerThemeColor] = useState('#0f172a');
  const [noOrderAutoVacateMinutes, setNoOrderAutoVacateMinutes] = useState(0);

  const [newCookingCategoryName, setNewCookingCategoryName] = useState('');
  const [editingCookingCategoryId, setEditingCookingCategoryId] = useState(null);
  const [deletingCookingCategory, setDeletingCookingCategory] = useState(null);
  const [cookingCategoryDraft, setCookingCategoryDraft] = useState(null);
  const [cookingCategoryDraftSourceKey, setCookingCategoryDraftSourceKey] = useState(null);

  const [copiedServeUrl, setCopiedServeUrl] = useState(false);
  const [printerHealth, setPrinterHealth] = useState(null);
  const [printerTestStatus, setPrinterTestStatus] = useState(null);
  const [isCheckingPrinter, setIsCheckingPrinter] = useState(false);
  const [isTestingPrinter, setIsTestingPrinter] = useState(false);
  const serveModeUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';

    const params = new URLSearchParams();
    params.set('mode', 'serve');

    if (storeId) {
      params.set('store_id', storeId);
    }

    return `${window.location.origin}/?${params.toString()}`;
  }, [storeId]);

  const copyServeModeUrl = async () => {
    if (!serveModeUrl) return;

    try {
      await navigator.clipboard.writeText(serveModeUrl);
      setCopiedServeUrl(true);

      window.setTimeout(() => {
        setCopiedServeUrl(false);
      }, 1600);
    } catch {
      setCopiedServeUrl(false);
    }
  };

  const persistedKitchens = settings?.kitchens?.length ? settings.kitchens : DEFAULT_KITCHENS;
  const kitchensSourceKey = JSON.stringify(persistedKitchens);
  const kitchens = kitchenDraft && kitchenDraftSourceKey === kitchensSourceKey ? kitchenDraft : persistedKitchens;

  const persistedCookingCategories = Array.isArray(cookingCategories)
    ? cookingCategories
    : [];

  const cookingCategoriesSourceKey = JSON.stringify(persistedCookingCategories);

  const cookingCategoryItems =
    cookingCategoryDraft && cookingCategoryDraftSourceKey === cookingCategoriesSourceKey
      ? cookingCategoryDraft
      : persistedCookingCategories;

  const previewImage = bannerPreview ?? settings?.receiptBannerImage ?? '';
  const customerLogoImage = customerLogoPreview ?? settings?.customerLogoUrl ?? '';

  useEffect(() => {
    if (!formRef.current || !settings) return;

    const form = formRef.current;
    form.name.value = settings.name || '';
    form.address.value = settings.address || '';
    form.tel.value = settings.tel || '';
    form.invoiceNumber.value = settings.invoiceNumber || '';
    form.taxRate.value = settings.taxRate ?? 10;
    form.taxRateReduced.value = settings.taxRateReduced ?? 8;
    form.receiptBannerImage.value = settings.receiptBannerImage || '';
    form.customerLogoUrl.value = settings.customerLogoUrl || '';
    const printerSettings = settings.printerSettings || {};
    form.printerEnabled.checked = Boolean(printerSettings.enabled);
    form.printerBridgeUrl.value = printerSettings.bridgeUrl || 'http://localhost:8787';
    form.printerIp.value = printerSettings.printerIp || '';
    form.printerPort.value = printerSettings.printerPort || 9100;
    form.printerAutoPrintReceipt.checked = Boolean(printerSettings.autoPrintReceipt);
    
    setCustomerLogoPreview(null);
    setCustomerThemeColor(settings.customerThemeColor || '#0f172a');
    setTaxRounding(normalizeTaxRounding(settings.taxRounding));
    setMenuPriceTaxMode(['tax_included', 'tax_excluded'].includes(settings.menuPriceTaxMode) ? settings.menuPriceTaxMode : 'tax_included');
    setDefaultCostTaxMode(['tax_included', 'tax_excluded'].includes(settings.defaultCostTaxMode) ? settings.defaultCostTaxMode : 'tax_included');
    setDefaultCostTaxRateType(['standard', 'reduced', 'exempt'].includes(settings.defaultCostTaxRateType) ? settings.defaultCostTaxRateType : 'standard');
    setEnabledPaymentMethods(
      Array.isArray(settings.acceptedPaymentMethods) && settings.acceptedPaymentMethods.length > 0
        ? settings.acceptedPaymentMethods
        : ['cash', 'card', 'qr']
    );
    setAllowTakeout(settings.allowTakeout !== false);
    setNoOrderAutoVacateMinutes(
      Math.max(0, Number(settings.noOrderAutoVacateMinutes ?? 0) || 0)
    );
  }, [settings]);

  const setKitchens = (nextValue) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(kitchens) : nextValue;
    setKitchenDraft(resolvedValue);
    setKitchenDraftSourceKey(kitchensSourceKey);
  };

  const addKitchen = () => {
    const nextName = newKitchenName.trim();
    if (!nextName) return;

    setKitchens([
      ...kitchens,
      {
        id: `k_${Date.now()}`,
        name: nextName,
        isDefault: kitchens.length === 0,
        sidebarPosition: 'left'
      }
    ]);
    setNewKitchenName('');
  };

  const updateKitchenName = (id, nextName) => {
    setKitchens(kitchens.map((kitchen) => (
      kitchen.id === id ? { ...kitchen, name: nextName } : kitchen
    )));
  };

  const updateKitchenSidebarPosition = (id, sidebarPosition) => {
    setKitchens(kitchens.map((kitchen) => (
      kitchen.id === id
        ? { ...kitchen, sidebarPosition }
        : kitchen
    )));
  };

  const setAsDefault = (id) => {
    setKitchens(kitchens.map((kitchen) => ({ ...kitchen, isDefault: kitchen.id === id })));
  };

  const confirmDeleteKitchen = () => {
    if (!deletingKitchen || kitchens.length <= 1) return;

    const filtered = kitchens.filter((kitchen) => kitchen.id !== deletingKitchen.id);
    if (!filtered.some((kitchen) => kitchen.isDefault) && filtered[0]) {
      filtered[0] = { ...filtered[0], isDefault: true };
    }

    setKitchens(filtered);
    setDeletingKitchen(null);
  };

const setCookingCategories = (nextValue) => {
  const resolvedValue = typeof nextValue === 'function'
    ? nextValue(cookingCategoryItems)
    : nextValue;

  setCookingCategoryDraft(resolvedValue);
  setCookingCategoryDraftSourceKey(cookingCategoriesSourceKey);
};

const addCookingCategory = () => {
  const nextName = String(newCookingCategoryName || '').trim();
  if (!nextName) return;

  setCookingCategories([
    ...cookingCategoryItems,
    {
      id: `cook_${Date.now()}`,
      name: nextName,
      sortOrder: (cookingCategoryItems.length + 1) * 1000
    }
  ]);

  window.setTimeout(() => {
    setNewCookingCategoryName('');
  }, 0);
};

const updateCookingCategoryName = (id, nextName) => {
  setCookingCategories(
    cookingCategoryItems.map((category) => (
      category.id === id
        ? { ...category, name: nextName }
        : category
    ))
  );
};

const moveCookingCategory = (fromIndex, toIndex) => {
  if (fromIndex === toIndex || toIndex < 0 || toIndex >= cookingCategoryItems.length) return;

  const nextItems = [...cookingCategoryItems];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);

  setCookingCategories(
    nextItems.map((item, index) => ({
      ...item,
      sortOrder: (index + 1) * 1000
    }))
  );
};

const confirmDeleteCookingCategory = () => {
  if (!deletingCookingCategory) return;

  setCookingCategories(
    cookingCategoryItems.filter((category) => category.id !== deletingCookingCategory.id)
  );

  setDeletingCookingCategory(null);
};


  const togglePaymentMethod = (methodId) => {
    setEnabledPaymentMethods((current) => {
      if (current.includes(methodId)) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== methodId);
      }

      return [...current, methodId];
    });
  };

const buildPrinterSettingsFromForm = () => {
  const form = formRef.current;
  if (!form) {
    return {
      printerSettings: {
        enabled: false,
        mode: 'local_bridge',
        bridgeUrl: 'http://localhost:8787',
        printerIp: '',
        printerPort: 9100,
        autoPrintReceipt: false
      }
    };
  }

  return {
    printerSettings: {
      enabled: form.printerEnabled.checked,
      mode: 'local_bridge',
      bridgeUrl: form.printerBridgeUrl.value.trim() || 'http://localhost:8787',
      printerIp: form.printerIp.value.trim(),
      printerPort: Number(form.printerPort.value || 9100),
      autoPrintReceipt: form.printerAutoPrintReceipt.checked
    }
  };
};

const handleCheckPrinterBridge = async () => {
  setIsCheckingPrinter(true);
  setPrinterHealth(null);

  try {
    const currentSettings = buildPrinterSettingsFromForm();
    const result = await checkPrintBridgeHealth(currentSettings);

    setPrinterHealth({
      ok: true,
      message: `印刷ブリッジに接続できました。${result.printerIp ? `現在の既定IP: ${result.printerIp}` : ''}`
    });
  } catch (error) {
    console.error('[printer bridge health error]', error);
    setPrinterHealth({
      ok: false,
      message: error.message || '印刷ブリッジに接続できませんでした'
    });
  } finally {
    setIsCheckingPrinter(false);
  }
};

const handleTestPrinter = async () => {
  setIsTestingPrinter(true);
  setPrinterTestStatus(null);

  try {
    const currentSettings = buildPrinterSettingsFromForm();
    await printTestViaBridge(currentSettings);

    setPrinterTestStatus({
      ok: true,
      message: 'テスト印刷を送信しました。プリンターから紙が出たか確認してください。'
    });
  } catch (error) {
    console.error('[printer test error]', error);
    setPrinterTestStatus({
      ok: false,
      message: error.message || 'テスト印刷に失敗しました'
    });
  } finally {
    setIsTestingPrinter(false);
  }
};


  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const formData = new FormData(event.currentTarget);
      await onSave({
        name: formData.get('name'),
        address: formData.get('address'),
        tel: formData.get('tel'),
        invoiceNumber: formData.get('invoiceNumber'),
        taxRate: Number(formData.get('taxRate')),
        taxRateReduced: Number(formData.get('taxRateReduced')),
        taxRounding,
        menuPriceTaxMode,
        defaultCostTaxMode,
        defaultCostTaxRateType,
        acceptedPaymentMethods: enabledPaymentMethods,
        allowTakeout,
        noOrderAutoVacateMinutes: Math.max(0, Number(noOrderAutoVacateMinutes) || 0),
        customerThemeColor,
        receiptBannerImage: formData.get('receiptBannerImage'),
        customerLogoUrl: formData.get('customerLogoUrl'),
        kitchens,
        printerSettings: {
          enabled: formData.get('printerEnabled') === 'on',
          mode: 'local_bridge',
          bridgeUrl: String(formData.get('printerBridgeUrl') || '').trim() || 'http://localhost:8787',
          printerIp: String(formData.get('printerIp') || '').trim(),
          printerPort: Number(formData.get('printerPort') || 9100),
          autoPrintReceipt: formData.get('printerAutoPrintReceipt') === 'on'
        }
      });
      onSaved?.();

      if (typeof onSaveCookingCategories === 'function') {
        await onSaveCookingCategories(
          cookingCategoryItems
            .filter((category) => String(category.name || '').trim())
            .map((category, index) => ({
              id: category.id || `cook_${Date.now()}_${index}`,
              name: String(category.name || '').trim(),
              sortOrder: Number(category.sortOrder ?? ((index + 1) * 1000))
            }))
        );
        onSaved?.();
      }

    } finally {
      setIsSaving(false);
    }
  };

  const kitchenHelperText = useMemo(
    () => 'キッチン名は注文の振り分け先として使われます。メイン料理やドリンクなど、役割ごとに分けて設定できます。',
    []
  );

  return (
    <div className="mx-auto w-full max-w-6xl animate-in fade-in pb-32 duration-500">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Register Settings
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-gray-900">
            レジ設定
          </h2>
          <p className="mt-1 text-sm font-bold leading-relaxed text-gray-400">
            レジ名と、この端末で使用するレジを設定します。選択したレジはORDER/POS会計に記録されます。
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {registerDrafts.map((register) => {
            const active = activeRegisterContext?.id === register.id;

            return (
              <div
                key={register.id}
                className={`rounded-2xl border p-4 transition-all ${
                  active
                    ? 'border-slate-900 bg-slate-50 shadow-sm'
                    : 'border-gray-100 bg-white'
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-black text-gray-400">{register.id}</span>
                  {active && (
                    <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-black text-white">
                      この端末
                    </span>
                  )}
                </div>

                <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">
                  レジ名
                </label>
                <input
                  value={register.name || ''}
                  onChange={(event) => updateRegisterNameDraft(register.id, event.target.value)}
                  onBlur={commitRegisterNameDraft}
                  className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
                  placeholder="例：メインレジ"
                />

                <button
                  type="button"
                  onClick={() => handleSelectActiveRegister(register)}
                  className={`mt-3 flex h-11 w-full items-center justify-center rounded-2xl text-sm font-black transition-all active:scale-95 ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-950'
                  }`}
                >
                  {active ? 'この端末で使用中' : 'この端末で使う'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pb-10 pt-6">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
          <span>Settings</span>
          <ChevronRight size={14} />
          <span className="text-orange-500">Basic Info</span>
        </div>

        <div className="flex items-end gap-4">
          <h2 className="text-4xl font-black tracking-tight text-gray-900">基本設定</h2>
          <span className="pb-1 text-2xl font-light text-gray-300">/</span>
          <p className="pb-1.5 text-base font-bold text-gray-500">
            店舗プロフィールと会計に関わる基本項目を設定できます
          </p>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit}>
        <SettingSection
          title="店舗プロフィール"
          desc="画面に表示される店舗名や連絡先などの基本情報を設定します。"
          icon={Store}
        >
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                店舗名 <span className="text-red-500">*</span>
              </label>
              <input
                name="name"
                required
                className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 text-base font-bold text-gray-800 outline-none transition-all focus:border-orange-500"
                placeholder="例: TEAM CAFE 東京店"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">電話番号</label>
                <input
                  name="tel"
                  className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 text-base outline-none transition-all focus:border-orange-500"
                  placeholder="03-1234-5678"
                />
              </div>

              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">住所</label>
                <input
                  name="address"
                  className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 text-base outline-none transition-all focus:border-orange-500"
                  placeholder="東京都渋谷区..."
                />
              </div>
            </div>

            <div className="space-y-3 border-t border-gray-100 pt-6">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">支払い方法</label>
              <div className="grid grid-cols-3 gap-3">
                {PAYMENT_METHOD_OPTIONS.map((option) => {
                  const isActive = enabledPaymentMethods.includes(option.id);
                  const OptionIcon = option.icon;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => togglePaymentMethod(option.id)}
                      className={`flex h-14 items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-all ${
                        isActive
                          ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-orange-200 hover:text-orange-600'
                      }`}
                    >
                      <OptionIcon size={16} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="pl-1 text-[11px] font-medium text-gray-400">
                レジ画面で表示する支払い方法を店舗ごとに設定できます。
              </p>
            </div>

            <div className="space-y-3 border-t border-gray-100 pt-6">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">会計ルール</label>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setAllowTakeout((current) => !current)}
                  className={`flex h-14 items-center justify-between rounded-xl border px-4 text-sm font-bold transition-all ${
                    allowTakeout
                      ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-orange-200 hover:text-orange-600'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Store size={16} />
                    テイクアウト切替
                  </span>
                  <span>{allowTakeout ? '有効' : '無効'}</span>
                </button>
              </div>
              <p className="pl-1 text-[11px] font-medium text-gray-400">
                レジでのテイクアウト切替の可否を設定できます。
              </p>
            </div>
          </div>
        </SettingSection>

<SettingSection
  title="顧客画面設定"
  desc="QRから開くお客様用メニュー画面のロゴとアクセントカラーを設定します。"
  icon={Palette}
>
  <div className="space-y-8">
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_260px]">
      <div className="space-y-6">
        <div className="space-y-3">
          <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
            顧客画面ロゴ URL
          </label>

          <input
            name="customerLogoUrl"
            onChange={(event) => setCustomerLogoPreview(event.target.value)}
            className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 font-mono text-xs text-gray-600 outline-none transition-all focus:border-orange-500"
            placeholder="https://..."
          />

          <p className="pl-1 text-[11px] font-medium text-gray-400">
            人数入力画面と注文画面下部に表示されます。透過PNG・SVG推奨です。
          </p>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-6">
          <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
            顧客画面のテーマカラー
          </label>

          <div className="flex items-center gap-4">
            <input
              type="color"
              value={customerThemeColor}
              onChange={(event) => setCustomerThemeColor(event.target.value)}
              className="h-12 w-16 cursor-pointer rounded-xl border border-gray-200 bg-white p-1"
            />

            <input
              type="text"
              value={customerThemeColor}
              onChange={(event) => setCustomerThemeColor(event.target.value)}
              className="h-12 flex-1 rounded-lg border border-gray-300 bg-white px-4 font-mono text-sm outline-none transition-all focus:border-orange-500"
              placeholder="#0f172a"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {CUSTOMER_THEME_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setCustomerThemeColor(color)}
                className={`h-9 w-9 rounded-full border-2 transition-all ${
                  customerThemeColor === color
                    ? 'scale-110 border-gray-900'
                    : 'border-white shadow'
                }`}
                style={{ backgroundColor: color }}
                aria-label={`テーマカラー ${color}`}
              />
            ))}
          </div>

          <p className="pl-1 text-[11px] font-medium text-gray-400">
            現時点では、カテゴリタブ・カート確認ボタン・注文確定ボタンなどの主要操作に反映されます。
          </p>
        </div>
      </div>

      <div className="rounded-[2rem] border border-gray-100 bg-gray-50 p-4">
        <div className="overflow-hidden rounded-[1.6rem] bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 pb-4 pt-5 text-center">
            {customerLogoImage ? (
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
                <img
                  src={customerLogoImage}
                  alt="顧客画面ロゴのプレビュー"
                  className="max-h-20 max-w-20 object-contain"
                />
              </div>
            ) : (
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 text-xs font-black text-gray-300">
                LOGO
              </div>
            )}

            <p className="text-xs font-black text-gray-400">いらっしゃいませ</p>
            <p className="mt-1 text-[11px] font-bold text-gray-300">
              ご利用人数を入力してください
            </p>
          </div>

          <div className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <div
                className="h-8 flex-1 rounded-full"
                style={{ backgroundColor: customerThemeColor }}
              />
              <div className="h-8 flex-1 rounded-full bg-gray-100" />
            </div>

            <div
              className="flex h-12 items-center justify-center rounded-[1.3rem] text-sm font-black text-white shadow-sm"
              style={{ backgroundColor: customerThemeColor }}
            >
              メニューを見る
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] font-medium leading-relaxed text-gray-400">
          お客様がQRから開く画面の簡易プレビューです。
        </p>
      </div>
    </div>
  </div>
</SettingSection>


        <SettingSection
          title="キッチン設定"
          desc="注文の振り分け先になるキッチンを設定します。メインキッチンは標準の振り分け先として使われます。"
          icon={ChefHat}
        >
          <div className="space-y-6">
            <div className="space-y-4">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                登録済みキッチン
              </label>

              <div className="grid grid-cols-1 gap-3">
                {kitchens.map((kitchen) => {
                  const isEditing = editingId === kitchen.id;

                  return (
                    <div
                      key={kitchen.id}
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 transition-all duration-200 ${
                        isEditing
                          ? 'border-orange-500 bg-white ring-2 ring-orange-500/20'
                          : kitchen.isDefault
                            ? 'border-orange-200 bg-orange-50 ring-1 ring-orange-200'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <div className="relative flex h-6 min-w-[180px] flex-grow items-center gap-4">
                        <button
                          type="button"
                          onClick={() => !isEditing && setAsDefault(kitchen.id)}
                          disabled={isEditing}
                          className={`z-10 flex-shrink-0 transition-colors ${
                            isEditing ? 'cursor-not-allowed opacity-50' : 'active:scale-90'
                          } ${
                            kitchen.isDefault
                              ? 'text-orange-500'
                              : 'text-gray-300 hover:text-orange-300'
                          }`}
                          title={kitchen.isDefault ? 'メインキッチン' : 'メインに設定'}
                        >
                          <Star size={20} fill={kitchen.isDefault ? 'currentColor' : 'none'} />
                        </button>

                        <div className="absolute inset-y-0 left-9 right-0 flex items-center">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={kitchen.name}
                              onChange={(event) => updateKitchenName(kitchen.id, event.target.value)}
                              onBlur={() => setEditingId(null)}
                              onKeyDown={(event) => event.key === 'Enter' && setEditingId(null)}
                              className="h-full w-full bg-transparent text-base font-bold text-gray-900 outline-none"
                              placeholder="キッチン名を入力"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center">
                              <span className="truncate font-bold leading-none text-gray-700">
                                {kitchen.name}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="z-10 flex shrink-0 items-center gap-2">
                        <span className="text-[10px] font-black text-gray-400">
                          サイドバー
                        </span>

                        <div className="flex items-center gap-1 rounded-xl bg-white/80 p-1 ring-1 ring-gray-200">
                          {[
                            { id: 'left', label: '左' },
                            { id: 'right', label: '右' }
                          ].map((option) => {
                            const isActive = (kitchen.sidebarPosition || 'left') === option.id;

                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => updateKitchenSidebarPosition(kitchen.id, option.id)}
                                className={`h-8 rounded-lg px-3 text-xs font-black transition-colors ${
                                  isActive
                                    ? 'bg-orange-500 text-white shadow-sm'
                                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="z-10 flex w-[68px] shrink-0 items-center justify-end gap-1">
                        {isEditing ? (
                          <button
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setEditingId(null);
                            }}
                            className="rounded-lg bg-green-500 p-2 text-white shadow-sm transition-all hover:bg-green-600 active:scale-95"
                            title="保存"
                          >
                            <Check size={16} strokeWidth={3} />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditingId(kitchen.id)}
                              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                              title="編集"
                            >
                              <Edit2 size={16} />
                            </button>

                            <button
                              type="button"
                              onClick={() => setDeletingKitchen(kitchen)}
                              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                              title="削除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="pt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKitchenName}
                  onChange={(event) => setNewKitchenName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addKitchen())}
                  className="h-12 flex-grow rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium outline-none transition-all focus:border-orange-500"
                  placeholder="新しいキッチン名 (例: ドリンク場)"
                />
                <button
                  type="button"
                  onClick={addKitchen}
                  className="flex h-12 items-center gap-2 rounded-lg bg-slate-900 px-6 font-bold text-white shadow-md transition-all hover:bg-black active:scale-95"
                >
                  <Plus size={18} />
                  <span>追加</span>
                </button>
              </div>
              <p className="mt-3 pl-1 text-[11px] font-medium text-gray-400">{kitchenHelperText}</p>
            </div>

            <div className="border-t border-gray-100 pt-6">
              <div className="rounded-[2rem] border border-blue-100 bg-blue-50/50 p-6">
                <div className="mb-5 flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
                    <Smartphone size={22} strokeWidth={2.7} />
                  </div>

                  <div className="min-w-0">
                    <h3 className="text-lg font-black text-slate-900">
                      提供モード用QRコード
                    </h3>
                    <p className="mt-1 text-sm font-bold leading-relaxed text-slate-500">
                      ホールスタッフのスマートフォンで読み込むと、提供モードを開けます。
                      提供モード内で「全て表示」や各キッチンを自由に切り替えできます。
                    </p>
                  </div>
                </div>

                <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
                  <div className="flex items-center justify-center rounded-[1.5rem] border border-blue-100 bg-white p-5 shadow-sm">
                    {serveModeUrl ? (
                      <QRCodeCanvas
                        value={serveModeUrl}
                        size={170}
                        level="M"
                        includeMargin
                      />
                    ) : (
                      <div className="flex h-[170px] w-[170px] items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-400">
                        URL生成中
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col justify-center rounded-[1.5rem] border border-blue-100 bg-white p-5 shadow-sm">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-blue-400">
                      Serve Mode URL
                    </div>

                    <div className="min-w-0 rounded-2xl bg-slate-50 px-4 py-3 font-mono text-xs font-bold leading-relaxed text-slate-600">
                      <span className="break-all">
                        {serveModeUrl}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={copyServeModeUrl}
                        className={`flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black shadow-sm transition-all active:scale-95 ${
                          copiedServeUrl
                            ? 'bg-green-600 text-white'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {copiedServeUrl ? (
                          <>
                            <Check size={17} strokeWidth={3} />
                            コピーしました
                          </>
                        ) : (
                          <>
                            <Copy size={17} strokeWidth={3} />
                            URLをコピー
                          </>
                        )}
                      </button>

                      <a
                        href={serveModeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center rounded-2xl border border-blue-100 bg-white px-5 py-3 text-sm font-black text-blue-600 shadow-sm transition-all hover:bg-blue-50 active:scale-95"
                      >
                        開いて確認
                      </a>
                    </div>

                    <p className="mt-4 text-xs font-bold leading-relaxed text-slate-400">
                      スタッフが未ログインの場合は、ログイン後に提供モードへ進みます。
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </SettingSection>

        <SettingSection
          title="調理分類設定"
          desc="キッチン画面の集計に使う分類を設定します。パスタ、揚げ物、ご飯プレートなど、調理単位でまとめられます。"
          icon={Layers}
        >
          <div className="space-y-6">
            <div className="space-y-4">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                登録済み調理分類
              </label>

              <div className="grid grid-cols-1 gap-3">
                {cookingCategoryItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm font-bold text-gray-400">
                    調理分類はまだありません
                  </div>
                ) : (
                  cookingCategoryItems.map((category, index) => {
                    const isEditing = editingCookingCategoryId === category.id;

                    return (
                      <div
                        key={category.id}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 transition-all duration-200 ${
                          isEditing
                            ? 'border-orange-500 bg-white ring-2 ring-orange-500/20'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex min-w-[180px] flex-grow items-center gap-3">
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveCookingCategory(index, index - 1)}
                              disabled={index === 0}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-black text-gray-400 ring-1 ring-gray-200 transition-colors hover:text-orange-500 disabled:opacity-30"
                            >
                              ↑
                            </button>

                            <button
                              type="button"
                              onClick={() => moveCookingCategory(index, index + 1)}
                              disabled={index === cookingCategoryItems.length - 1}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-black text-gray-400 ring-1 ring-gray-200 transition-colors hover:text-orange-500 disabled:opacity-30"
                            >
                              ↓
                            </button>
                          </div>

                          {isEditing ? (
                            <input
                              autoFocus
                              value={category.name}
                              onChange={(event) => updateCookingCategoryName(category.id, event.target.value)}
                              onBlur={() => setEditingCookingCategoryId(null)}
                              onKeyDown={(event) => event.key === 'Enter' && setEditingCookingCategoryId(null)}
                              className="h-10 min-w-0 flex-grow bg-transparent text-base font-bold text-gray-900 outline-none"
                              placeholder="分類名を入力"
                            />
                          ) : (
                            <div className="min-w-0 flex-grow">
                              <div className="truncate font-bold leading-none text-gray-700">
                                {category.name}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="z-10 flex w-[68px] shrink-0 items-center justify-end gap-1">
                          {isEditing ? (
                            <button
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                setEditingCookingCategoryId(null);
                              }}
                              className="rounded-lg bg-green-500 p-2 text-white shadow-sm transition-all hover:bg-green-600 active:scale-95"
                              title="保存"
                            >
                              <Check size={16} strokeWidth={3} />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingCookingCategoryId(category.id)}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                                title="編集"
                              >
                                <Edit2 size={16} />
                              </button>

<button
  type="button"
  onClick={(event) => {
    event.preventDefault();
    event.stopPropagation();
    setDeletingCookingCategory(category);
  }}
  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
  title="削除"
>
  <Trash2 size={16} />
</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCookingCategoryName}
                  onChange={(event) => setNewCookingCategoryName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCookingCategory();
                    }
                  }}
                  className="h-12 flex-grow rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium outline-none transition-all focus:border-orange-500"
                  placeholder="新しい調理分類名（例：パスタ）"
                />

                <button
                  type="button"
                  onClick={addCookingCategory}
                  className="flex h-12 items-center gap-2 rounded-lg bg-slate-900 px-6 font-bold text-white shadow-md transition-all hover:bg-black active:scale-95"
                >
                  <Plus size={18} />
                  <span>追加</span>
                </button>
              </div>

              <p className="mt-3 text-xs font-medium leading-relaxed text-gray-400">
                登録した分類は、メニュー設定で複数選択できます。キッチン画面では未完了商品の集計に表示されます。
              </p>
            </div>
          </div>
        </SettingSection>


        <SettingSection
          title="売値・原価の税設定"
          desc="メニュー価格と原価の入力方式を設定します。"
          icon={Percent}
        >
          <div className="space-y-6">
            <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
              <p className="text-sm font-black text-orange-700">
                既存メニューは税込価格として扱います
              </p>
              <p className="mt-1 text-xs font-bold leading-relaxed text-orange-600/80">
                税抜入力への切り替えは、注文作成と日計集計の対応後に使う想定です。現時点では税込入力のまま運用するのが安全です。
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-3">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                  売値の入力方式
                </label>
                <div className="grid gap-2">
                  {[
                    { value: 'tax_included', label: '税込で入力', note: '現在の既存仕様です' },
                    { value: 'tax_excluded', label: '税抜で入力', note: '今後の拡張用です' }
                  ].map((option) => {
                    const isActive = menuPriceTaxMode === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMenuPriceTaxMode(option.value)}
                        className={`rounded-2xl border-2 p-4 text-left transition-all ${
                          isActive
                            ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-orange-200 hover:text-orange-600'
                        }`}
                      >
                        <div className="text-sm font-black">{option.label}</div>
                        <div className="mt-1 text-xs font-bold opacity-70">{option.note}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                  原価の入力方式
                </label>
                <div className="grid gap-2">
                  {[
                    { value: 'tax_included', label: '税込で入力' },
                    { value: 'tax_excluded', label: '税抜で入力' }
                  ].map((option) => {
                    const isActive = defaultCostTaxMode === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDefaultCostTaxMode(option.value)}
                        className={`rounded-2xl border-2 p-4 text-left text-sm font-black transition-all ${
                          isActive
                            ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:text-blue-600'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
                  原価の標準税区分
                </label>
                <div className="grid gap-2">
                  {[
                    { value: 'standard', label: '標準税率' },
                    { value: 'reduced', label: '軽減税率' },
                    { value: 'exempt', label: '非課税/対象外' }
                  ].map((option) => {
                    const isActive = defaultCostTaxRateType === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDefaultCostTaxRateType(option.value)}
                        className={`rounded-2xl border-2 p-4 text-left text-sm font-black transition-all ${
                          isActive
                            ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:text-blue-600'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </SettingSection>


        <SettingSection
          title="税率・インボイス"
          desc="会計時に適用される税率とインボイス登録番号を設定します。"
          icon={Percent}
        >
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">インボイス登録番号</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 select-none font-bold text-gray-400">T</span>
                <input
                  name="invoiceNumber"
                  className="h-12 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-4 text-base font-bold tracking-wider outline-none transition-all focus:border-orange-500"
                  placeholder="1234567890123"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 pt-2">
              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">標準税率</label>
                <div className="relative">
                  <input
                    name="taxRate"
                    type="number"
                    className="h-12 w-full rounded-lg border border-gray-300 bg-white pl-4 pr-10 text-right font-mono text-base font-bold outline-none focus:border-orange-500"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">%</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">軽減税率</label>
                <div className="relative">
                  <input
                    name="taxRateReduced"
                    type="number"
                    className="h-12 w-full rounded-lg border border-gray-300 bg-white pl-4 pr-10 text-right font-mono text-base font-bold outline-none focus:border-orange-500"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">%</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">税の端数処理</label>
              <div className="grid grid-cols-3 gap-3">
                {TAX_ROUNDING_OPTIONS.map((option) => {
                  const isActive = taxRounding === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTaxRounding(option.value)}
                      className={`h-12 rounded-xl border text-sm font-bold transition-all ${
                        isActive
                          ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-orange-200 hover:text-orange-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </SettingSection>
<SettingSection
  title="レシートプリンター"
  desc="レジ端末にインストールした印刷ブリッジを経由して、LAN内のレシートプリンターへ印刷します。"
  icon={Printer}
>
  <div className="space-y-6">
    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <div>
        <p className="text-sm font-black text-gray-800">レシートプリンターを使用する</p>
        <p className="mt-1 text-xs font-bold leading-relaxed text-gray-400">
          POSのレシート印刷ボタンから、ローカル印刷ブリッジへ送信します。
        </p>
      </div>
      <input
        name="printerEnabled"
        type="checkbox"
        className="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
      />
    </label>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
          印刷ブリッジURL
        </label>
        <input
          name="printerBridgeUrl"
          className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 font-mono text-sm text-gray-700 outline-none transition-all focus:border-orange-500"
          placeholder="http://localhost:8787"
        />
        <p className="ml-1 text-[11px] font-bold leading-relaxed text-gray-400">
          通常は http://localhost:8787 のままで使用します。レジ端末上で印刷ブリッジを起動してください。
        </p>
      </div>

      <div className="space-y-2">
        <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
          プリンターIPアドレス
        </label>
        <input
          name="printerIp"
          className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 font-mono text-sm font-bold text-gray-700 outline-none transition-all focus:border-orange-500"
          placeholder="192.168.1.51"
        />
      </div>

      <div className="space-y-2">
        <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">
          ポート
        </label>
        <input
          name="printerPort"
          type="number"
          min="1"
          className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 font-mono text-sm font-bold text-gray-700 outline-none transition-all focus:border-orange-500"
          placeholder="9100"
        />
      </div>
    </div>

    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-gray-200 bg-white p-4">
      <div>
        <p className="text-sm font-black text-gray-800">会計完了後に自動印刷する</p>
        <p className="mt-1 text-xs font-bold leading-relaxed text-gray-400">
          まずはOFF推奨です。運用が安定してからONにしてください。
        </p>
      </div>
      <input
        name="printerAutoPrintReceipt"
        type="checkbox"
        className="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
      />
    </label>

    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
          <Printer size={20} />
        </div>
        <div>
          <p className="text-sm font-black text-gray-800">印刷ブリッジをインストール</p>
          <p className="mt-1 text-xs font-bold leading-relaxed text-gray-400">
            この端末でレシート印刷するには、印刷ブリッジを起動してください。
            初回のみNode.jsのインストールが必要です。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <a
          href="/downloads/mobile-order-print-bridge-mac.zip"
          download
          className="flex h-12 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 shadow-sm transition-all hover:bg-gray-50"
        >
          Mac版をダウンロード
        </a>

        <a
          href="/downloads/mobile-order-print-bridge-windows.zip"
          download
          className="flex h-12 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 shadow-sm transition-all hover:bg-gray-50"
        >
          Windows版をダウンロード
        </a>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <button
        type="button"
        onClick={handleCheckPrinterBridge}
        disabled={isCheckingPrinter}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-60"
      >
        {isCheckingPrinter ? <LoadingSpinner size={16} /> : <Smartphone size={18} />}
        接続確認
      </button>

      <button
        type="button"
        onClick={handleTestPrinter}
        disabled={isTestingPrinter}
        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-black text-white shadow-sm transition-all hover:bg-black disabled:opacity-60"
      >
        {isTestingPrinter ? <LoadingSpinner size={16} /> : <Receipt size={18} />}
        テスト印刷
      </button>
    </div>

    {(printerHealth || printerTestStatus) && (
      <div className="space-y-2">
        {printerHealth && (
          <div className={`rounded-2xl border p-4 text-xs font-bold ${
            printerHealth.ok
              ? 'border-green-100 bg-green-50 text-green-700'
              : 'border-red-100 bg-red-50 text-red-700'
          }`}>
            {printerHealth.message}
          </div>
        )}

        {printerTestStatus && (
          <div className={`rounded-2xl border p-4 text-xs font-bold ${
            printerTestStatus.ok
              ? 'border-green-100 bg-green-50 text-green-700'
              : 'border-red-100 bg-red-50 text-red-700'
          }`}>
            {printerTestStatus.message}
          </div>
        )}
      </div>
    )}

    <div className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs">
      <AlertCircle className="shrink-0 text-blue-500" size={18} />
      <p className="font-bold leading-relaxed text-blue-700">
        プリンターIPはルーター側で固定割当してください。IPが変わると印刷できなくなります。
        印刷ブリッジ未起動時は、POS側で従来のブラウザ印刷にフォールバックできます。
      </p>
    </div>
  </div>
</SettingSection>


        <SettingSection
          title="レシートデザイン"
          desc="印字に表示するロゴ画像を設定できます。"
          icon={Receipt}
        >
          <div className="flex flex-col gap-8 md:flex-row">
            <div className="flex-1 space-y-4">
              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-wider text-gray-500">ロゴ画像 URL</label>
                <input
                  name="receiptBannerImage"
                  onChange={(event) => setBannerPreview(event.target.value)}
                  className="h-12 w-full rounded-lg border border-gray-300 bg-white px-4 font-mono text-xs text-gray-600 outline-none transition-all focus:border-orange-500"
                  placeholder="https://..."
                />
              </div>

              <div className="flex gap-3 rounded-lg border border-orange-100 bg-orange-50 p-4 text-xs">
                <AlertCircle className="shrink-0 text-orange-500" size={18} />
                <p className="font-medium text-orange-700">
                  透過 PNG などを設定すると、印刷時のレシート上部にきれいに表示されます。
                </p>
              </div>
            </div>

            <div className="w-64 shrink-0 rounded-xl border border-gray-200 bg-gray-100 p-4">
              <div className="relative min-h-[150px] rounded border-t-4 border-gray-800 bg-white p-4 shadow-md">
                {previewImage ? (
                  <img
                    src={previewImage}
                    alt="レシートロゴのプレビュー"
                    className="w-full object-contain grayscale contrast-150"
                  />
                ) : (
                  <div className="py-8 text-center text-[10px] font-bold text-gray-300">ロゴ未設定</div>
                )}
                <div className="mt-4 space-y-1.5 opacity-20">
                  <div className="mx-auto h-1.5 w-2/3 rounded bg-gray-400" />
                  <div className="mx-auto h-1 w-1/2 rounded bg-gray-300" />
                </div>
              </div>
            </div>
          </div>
        </SettingSection>

        <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-200 bg-white/80 p-6 backdrop-blur-md md:left-72">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="group flex items-center gap-3 rounded-xl bg-slate-900 px-10 py-4 text-base font-bold text-white shadow-xl transition-all hover:bg-black"
            >
                  {isSaving ? <LoadingSpinner size={20} /> : <Save size={20} />}
              <span>設定を保存</span>
              {!isSaving && <ArrowRight size={18} className="translate-x-0 opacity-70 transition-all group-hover:translate-x-1 group-hover:opacity-100" />}
            </button>
          </div>
        </div>
      
        <SettingSection
          title="未注文テーブルの自動退席"
          desc="QRを読み込んだまま席を移動した場合など、注文がない利用中テーブルを一定時間後に自動で空席へ戻します。"
          icon={Store}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-black text-gray-700">
                注文がない場合の自動退席時間
              </label>

              <select
                value={noOrderAutoVacateMinutes}
                onChange={(event) => setNoOrderAutoVacateMinutes(Number(event.target.value || 0))}
                className="h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-800 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
              >
                <option value={0}>自動退席しない</option>
                <option value={10}>10分後</option>
                <option value={15}>15分後</option>
                <option value={20}>20分後</option>
                <option value={30}>30分後</option>
                <option value={45}>45分後</option>
                <option value={60}>60分後</option>
                <option value={90}>90分後</option>
                <option value={120}>120分後</option>
              </select>

              <p className="mt-2 text-xs font-bold leading-relaxed text-gray-400">
                対象は「利用中」かつ「まだ注文が一度も入っていない」テーブルだけです。注文済みのテーブルや会計前の伝票は自動退席しません。
              </p>
            </div>
          </div>
        </SettingSection>

</form>

      {deletingKitchen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md animate-in zoom-in-95 rounded-[2.5rem] bg-white p-10 text-center shadow-2xl duration-200">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>

            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">キッチンを削除しますか？</h3>
            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">「{deletingKitchen.name}」</span> を削除します。
              <br />
              このキッチンに紐づいていたメニューの設定に影響が出る場合があります。
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={confirmDeleteKitchen}
                className="w-full rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600 active:scale-95"
              >
                削除する
              </button>
              <button
                type="button"
                onClick={() => setDeletingKitchen(null)}
                className="w-full rounded-2xl py-4 font-bold text-gray-400 transition-colors hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      {deletingCookingCategory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md animate-in zoom-in-95 rounded-[2.5rem] bg-white p-10 text-center shadow-2xl duration-200">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>

            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">
              調理分類を削除しますか？
            </h3>

            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">
                「{deletingCookingCategory.name}」
              </span>
              を削除します。
              <br />
              保存すると、メニュー設定の分類選択にも反映されます。
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={confirmDeleteCookingCategory}
                className="w-full rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600 active:scale-95"
              >
                削除する
              </button>

              <button
                type="button"
                onClick={() => setDeletingCookingCategory(null)}
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

export default BasicSettings;
