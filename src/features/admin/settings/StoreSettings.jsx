import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Boxes,
  Building2,
  CheckSquare,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  Layout,
  Link,
  LogOut,
  PackageCheck,
  Percent,
  QrCode,
  ScanLine,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  Truck,
  Users,
  Sparkles,
  Utensils,
  Package,
  ShoppingBag
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where, getDocs, orderBy, limit, startAfter, getCountFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { getActiveRegisterContext, syncActiveRegisterName } from '../../pos/utils/registerContext';

import { useAuth } from '../../../app/providers/useAuth';
import { db } from '../../../shared/api/firebase/client';
import NotificationToast from '../../../shared/components/feedback/NotificationToast';
import SaveCompleteOverlay from '../../../shared/components/feedback/SaveCompleteOverlay';
import {
  canAccessSettingsSection,
  normalizeUserRole,
  USER_ROLES
} from '../../../shared/utils/roles';
import { safeStorage } from '../../../shared/utils/storage';
import {
  useBusinessSettings,
  useCategoryData,
  useCookingCategoryData,
  useDiscountData,
  useFloorLayout,
  useMenuData,
  usePeriodData,
  useProductMasterData,
  useStoreSettings
} from '../../store/hooks';

import BasicSettings from './components/BasicSettings';
import BusinessSettings from './components/BusinessSettings';
import CategorySettings from './components/CategorySettings';
import DiscountSettings from './components/DiscountSettings';
import FloorMapSettings from './components/floor-map/FloorMapSettings';
import MenuSettings from './components/MenuSettings';
import OwnerSetupGuide from './components/OwnerSetupGuide';
import PeriodSettings from './components/PeriodSettings';
import QRGenerator from './components/QRGenerator';
import StaffInviteSettings from './components/StaffInviteSettings';
import CrossSellSettings from './components/CrossSellSettings';
import ProductMasterSettings, {
  ShopifySettingsPanel,
  SimpleMasterPanel,
  blankBrand,
  blankCategory,
  blankGroup,
  blankSupplier
} from '../../products/components/ProductMasterSettings';
import ProductCsvImportPanel from '../../products/components/ProductCsvImportPanel';
import MasterCsvImportPanel from '../../products/components/MasterCsvImportPanel';

const SETTINGS_MODE_ITEMS = [
  {
    id: 'order',
    label: 'ORDER',
    title: 'ORDER設定',
    desc: 'モバイルオーダー・飲食メニュー',
    icon: Utensils
  },
  {
    id: 'pos',
    label: 'POS',
    title: 'POS設定',
    desc: '物販レジ・商品マスター',
    icon: ShoppingBag
  }
];

const SETTINGS_MENU_ITEMS = [
  { id: 'menu', mode: 'order', group: 'メニュー管理', label: 'メニュー設定', icon: Utensils, desc: '商品と表示内容の編集' },
  { id: 'category', mode: 'order', group: 'メニュー管理', label: 'カテゴリー設定', icon: Tag, desc: 'メニューカテゴリの追加と並び順' },
  {
    id: 'crossSell',
    mode: 'order',
    group: '販売促進',
    label: 'クロスセル設定',
    icon: Sparkles,
    desc: 'セットドリンクやデザートの提案導線を設定します'
  },
  { id: 'qrcode', mode: 'order', group: '店舗運用', label: 'QRコード発行', icon: QrCode, desc: 'テーブルに貼るQRコードを発行' },
  { id: 'time', mode: 'order', group: '店舗運用', label: '時間帯設定', icon: Clock, desc: '提供時間帯と営業時間の設定' },
  { id: 'layout', mode: 'order', group: '店舗運用', label: 'テーブル設定', icon: Layout, desc: 'テーブルIDと配置の編集' },
  { id: 'discount', mode: 'order', group: '会計設定', label: '割引設定', icon: Percent, desc: '割引ルールの追加' },

  { id: 'products', mode: 'pos', group: null, label: '商品マスター', icon: Package, desc: '在庫数確認・在庫調整・入庫登録を1画面で行います' },
  { id: 'purchaseManagement', mode: 'pos', group: null, label: '発注管理', icon: ShoppingCart, desc: '仕入先別発注確認と発注履歴を管理します' },
  { id: 'productManagement', mode: 'pos', group: null, label: '商品管理', icon: Boxes, desc: 'カテゴリー・カテゴリーグループ・ブランド・仕入先を管理します' },
  { id: 'inventoryManagement', mode: 'pos', group: null, label: '在庫管理', icon: Archive, desc: '在高確認・長期在庫・棚卸を管理します' },
  { id: 'shopifyIntegration', mode: 'pos', group: null, label: 'EC連携', icon: Link, desc: 'Shopify / STORES / BASE / 楽天 / Amazon商品・在庫との連携を設定します' },
  { id: 'csvImportExport', mode: 'pos', group: null, label: 'CSV入出力', icon: FileSpreadsheet, desc: 'CSVで商品・在庫・仕入先データを入出力します' },

  { id: 'staff', mode: 'shared', group: '共通', label: 'スタッフ招待', icon: Users, desc: 'スタッフの招待と確認' },
  { id: 'taxPrice', mode: 'shared', group: '共通', label: '税・価格設定', icon: Percent, desc: '税率・税抜価格基準・Shopify価格同期方式' },
  { id: 'basic', mode: 'shared', group: '共通', label: '基本設定', icon: Store, desc: '店舗名・レジ設定・部門設定などの基本情報' }
];

const getDefaultSettingsSubTab = (role) => {
  const normalizedRole = normalizeUserRole(role);

  if (normalizedRole === USER_ROLES.OWNER) return 'menu';
  if (normalizedRole === USER_ROLES.MANAGER) return 'qrcode';
  return null;
};

const buildOwnerSetupSteps = ({
  settings,
  businessSettings,
  categories,
  menuItems,
  tableCount,
  layoutItems,
  periods,
  discounts,
  memberCount
}) => [
  {
    id: 'basic',
    label: '基本設定',
    desc: '店舗名を設定すると、表示や案内の内容が自然になります。',
    isRequired: true,
    isComplete: Boolean(String(settings?.name || '').trim()),
    icon: CheckSquare
  },
  {
    id: 'business',
    label: '営業時間',
    desc: '営業時間とラストオーダーを決めて、お客様画面の表示を整えます。',
    isRequired: false,
    isComplete: Boolean(businessSettings?.updatedAt),
    icon: Clock
  },
  {
    id: 'category',
    label: 'カテゴリ',
    desc: '商品が見やすく並ぶように、まずはカテゴリを登録します。',
    isRequired: true,
    isComplete: categories.length > 0,
    icon: Tag
  },
  {
    id: 'menu',
    label: 'メニュー',
    desc: '最低でも1品登録すると、注文導線の確認がしやすくなります。',
    isRequired: true,
    isComplete: menuItems.length > 0,
    icon: Utensils
  },
  {
    id: 'qrcode',
    label: 'QRコード発行',
    desc: 'テーブルに貼るQRコードを発行すると、お客様がそのまま注文を始められます。',
    isRequired: true,
    isComplete: tableCount > 0,
    icon: ScanLine
  },
  {
    id: 'layout',
    label: 'レイアウト',
    desc: 'テーブル配置を整えると、レジ画面で客席状況が把握しやすくなります。',
    isRequired: false,
    isComplete: layoutItems.length > 0,
    icon: Layout
  },
  {
    id: 'period',
    label: '提供時間帯',
    desc: 'モーニングやディナーなど、時間帯ごとの提供設定に使えます。',
    isRequired: false,
    isComplete: periods.length > 0,
    icon: Clock
  },
  {
    id: 'discount',
    label: '割引',
    desc: 'ランチ割や会計時の値引きルールを追加できます。',
    isRequired: false,
    isComplete: discounts.length > 0,
    icon: Percent
  },
  {
    id: 'staff',
    label: 'スタッフ招待',
    desc: '必要に応じて、マネージャーやスタッフを招待して運用を始められます。',
    isRequired: false,
    isComplete: memberCount > 1,
    icon: Users
  }
];

const groupSettingsMenuItems = (items) => {
  const groups = [];

  items.forEach((item) => {
    const groupName = item.group || 'その他';
    let group = groups.find((current) => current.name === groupName);

    if (!group) {
      group = { name: groupName, items: [] };
      groups.push(group);
    }

    group.items.push(item);
  });

  return groups;
};

const POS_DUMMY_PAGES = {
  purchaseManagement: {
    title: '発注管理',
    eyebrow: 'Purchase Management',
    description: '仕入先別の発注確認と発注履歴を管理する画面です。',
    tabs: [
      { id: 'supplierPurchaseCheck', label: '仕入先別発注確認', description: '仕入先ごとに必要な発注候補を確認します。' },
      { id: 'purchaseHistory', label: '発注履歴', description: '過去の発注内容、ステータス、入庫状況を確認します。' }
    ]
  },
  productManagement: {
    title: '商品管理',
    eyebrow: 'Product Management',
    description: '商品マスターから分離した補助マスターを管理する画面です。',
    tabs: [
      { id: 'categoryGroups', label: 'カテゴリーグループ', description: 'カテゴリーを束ねる大分類をここで管理します。売場との紐付け前に登録します。' },
      { id: 'salesAreas', label: '売場', description: '店頭の売場分類を管理します。カテゴリーグループと紐付けることで、商品登録時の候補を絞り込めます。' },
      { id: 'categories', label: 'カテゴリー', description: '商品マスターで使う商品カテゴリーをここで管理します。' },
      { id: 'subCategories', label: 'サブカテゴリー', description: 'Shopifyメニューの3階層目にあたるサブカテゴリーを管理します。' },
      { id: 'brands', label: 'ブランド', description: '商品に紐づくブランド情報をここで管理します。' },
      { id: 'suppliers', label: '仕入先', description: '発注や入庫で使う仕入先情報をここで管理します。' }
    ]
  },
  inventoryManagement: {
    title: '在庫管理',
    eyebrow: 'Inventory Management',
    description: '在庫状況、長期在庫、棚卸を確認・管理する画面です。',
    tabs: [
      { id: 'stockValue', label: '在高確認', description: '現在庫数と在庫金額を確認します。' },
      { id: 'longTermStock', label: '長期在庫', description: '一定期間動きのない商品を確認します。' },
      { id: 'stockTaking', label: '棚卸', description: '棚卸入力と差異確認を行います。' }
    ]
  },
  shopifyIntegration: { title: 'EC連携',
    description: 'Shopifyを中心に、STORES / BASE / 楽天 / Amazon など外部ECとの連携設定を管理します。',
    icon: ShoppingBag,
    tabs: [
      { id: 'shopify', label: 'Shopify' },
      { id: 'stores', label: 'STORES' },
      { id: 'base', label: 'BASE' },
      { id: 'rakuten', label: '楽天' },
      { id: 'amazon', label: 'Amazon' }
    ]
  },
  csvImportExport: {
    title: 'CSV入出力',
    eyebrow: 'CSV Import / Export',
    description: '商品・在庫・仕入先などをCSVで一括登録・出力する画面です。',
    tabs: [
      { id: 'csvImport', label: 'CSV取込', description: 'CSVファイルからデータを一括登録します。' },
      { id: 'csvExport', label: 'CSV出力', description: '登録済みデータをCSVで出力します。' },
      { id: 'templates', label: 'テンプレート', description: '取込用CSVテンプレートを確認します。' }
    ]
  },
  taxPrice: {
    title: '税・価格設定',
    eyebrow: 'Tax / Price Settings',
    description: '消費税率、税抜価格基準、Shopifyへ同期する価格方式を管理します。',
    tabs: []
  }
};


const CsvImportStepCard = ({
  number,
  title,
  description,
  status = '',
  children
}) => (
  <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-5">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-sm font-black text-white shadow-lg shadow-blue-500/20">
          {number}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-black tracking-tight text-slate-900">{title}</h3>
          <p className="mt-1 text-sm font-bold leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>
      {status ? (
      <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-600">
        {status}
      </span>
      ) : null}
    </div>
    <div className="p-5">
      {children || (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm font-bold leading-relaxed text-slate-400">
          この取込ロジックは次フェーズで実装します。先に読み込むCSVの雛形を確認してから、ヘッダー対応・プレビュー・保存処理を追加します。
        </div>
      )}
    </div>
  </section>
);


const EcIntegrationComingSoonPanel = ({ title }) => (
  <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Coming Soon</p>
      <h3 className="mt-2 text-xl font-black text-slate-900">{title}連携</h3>
      <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
        このEC連携は今後の拡張用タブです。まずはShopify連携を完成させてから、同じproductGroup / SKU構造を使って順番に対応します。
      </p>
    </div>
  </section>
);

const EcIntegrationPanel = ({
  activeTab,
  productMaster,
  onSaved
}) => {
  if (activeTab === 'shopify') {
    return (
      <ShopifySettingsPanel
        settings={productMaster?.shopifySettings}
        onSave={productMaster?.saveShopifySettings}
        onSaved={onSaved}
      />
    );
  }

  const labels = {
    stores: 'STORES',
    base: 'BASE',
    rakuten: '楽天',
    amazon: 'Amazon'
  };

  return <EcIntegrationComingSoonPanel title={labels[activeTab] || 'EC'} />;
};



const DEFAULT_TAX_PRICE_SETTINGS = {
  priceBase: 'taxExcluded',
  defaultTaxRate: 10,
  reducedTaxRate: 8,
  roundingMode: 'floor',
  categoryTaxMode: 'categoryDefault',
  productTaxOverrideEnabled: true,
  shopifyPriceSyncMode: 'taxIncluded',
  taxRates: [
    {
      id: 'standard',
      label: '標準税率',
      rate: 10,
      description: '物販・店内飲食など通常税率の商品に使用します。',
      isActive: true,
      isDefault: true
    },
    {
      id: 'reduced',
      label: '軽減税率',
      rate: 8,
      description: '食品・テイクアウトなど軽減税率対象の商品に使用します。',
      isActive: true,
      isDefault: false
    },
    {
      id: 'taxFree',
      label: '非課税 / 対象外',
      rate: 0,
      description: '非課税・対象外・調整用の商品に使用します。',
      isActive: true,
      isDefault: false
    }
  ]
};

const mergeTaxPriceSettings = (source = {}) => {
  const baseTaxRates = DEFAULT_TAX_PRICE_SETTINGS.taxRates.map((defaultRate) => {
    const current = Array.isArray(source.taxRates)
      ? source.taxRates.find((rate) => rate.id === defaultRate.id)
      : null;

    return {
      ...defaultRate,
      ...(current || {}),
      rate: Number.isFinite(Number(current?.rate)) ? Number(current.rate) : defaultRate.rate,
      isActive: current?.isActive === false ? false : true,
      isDefault: Boolean(current?.isDefault ?? defaultRate.isDefault)
    };
  });

  const defaultTaxRate = Number.isFinite(Number(source.defaultTaxRate))
    ? Number(source.defaultTaxRate)
    : DEFAULT_TAX_PRICE_SETTINGS.defaultTaxRate;

  return {
    ...DEFAULT_TAX_PRICE_SETTINGS,
    ...source,
    priceBase: source.priceBase === 'taxIncluded' ? 'taxIncluded' : 'taxExcluded',
    defaultTaxRate,
    reducedTaxRate: Number.isFinite(Number(source.reducedTaxRate))
      ? Number(source.reducedTaxRate)
      : DEFAULT_TAX_PRICE_SETTINGS.reducedTaxRate,
    roundingMode: ['floor', 'round', 'ceil'].includes(source.roundingMode)
      ? source.roundingMode
      : DEFAULT_TAX_PRICE_SETTINGS.roundingMode,
    categoryTaxMode: source.categoryTaxMode === 'productOnly' ? 'productOnly' : 'categoryDefault',
    productTaxOverrideEnabled: source.productTaxOverrideEnabled !== false,
    shopifyPriceSyncMode: source.shopifyPriceSyncMode === 'taxExcluded' ? 'taxExcluded' : 'taxIncluded',
    taxRates: baseTaxRates.map((rate) => ({
      ...rate,
      isDefault: Number(rate.rate) === defaultTaxRate
    }))
  };
};

const TaxPriceSettings = ({ storeId, onSaved }) => {
  const [settings, setSettings] = useState(() => mergeTaxPriceSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!storeId) {
      setSettings(mergeTaxPriceSettings());
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const taxPriceRef = doc(db, 'stores', storeId, 'settings', 'taxPrice');

    return onSnapshot(
      taxPriceRef,
      (snapshot) => {
        setSettings(mergeTaxPriceSettings(snapshot.exists() ? snapshot.data() : {}));
        setLoading(false);
      },
      (error) => {
        console.error('[tax price settings subscription error]', error);
        setSettings(mergeTaxPriceSettings());
        setLoading(false);
      }
    );
  }, [storeId]);

  const updateSetting = (key, value) => {
    setSettings((current) => mergeTaxPriceSettings({
      ...current,
      [key]: value
    }));
  };

  const updateTaxRate = (taxRateId, patch) => {
    setSettings((current) => mergeTaxPriceSettings({
      ...current,
      taxRates: current.taxRates.map((taxRate) => (
        taxRate.id === taxRateId ? { ...taxRate, ...patch } : taxRate
      ))
    }));
  };

  const handleSave = async () => {
    if (!storeId) return;

    setSaving(true);

    try {
      const normalized = mergeTaxPriceSettings(settings);
      await setDoc(
        doc(db, 'stores', storeId, 'settings', 'taxPrice'),
        {
          ...normalized,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      if (typeof onSaved === 'function') {
        onSaved('税・価格設定を保存しました。');
      }
    } catch (error) {
      console.error('[tax price settings save error]', error);
      window.alert(`税・価格設定の保存に失敗しました。\n${error?.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="rounded-3xl border border-slate-100 bg-slate-50 px-5 py-8 text-center">
          <p className="text-sm font-black text-slate-500">税・価格設定を読み込み中...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Tax / Price</p>
            <h3 className="mt-2 text-2xl font-black text-slate-900">税・価格設定</h3>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
              Akuto POSの商品価格は税抜を基準にします。税率はカテゴリー側で初期値を持たせ、商品ごとに必要な場合だけ上書きできる設計にします。
              Shopifyへ同期する価格は、税込・税抜のどちらで送るかをここで固定します。
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-500">Price Base</p>
            <h4 className="mt-2 text-lg font-black text-slate-900">商品価格の基準</h4>
            <div className="mt-4 rounded-2xl border-2 border-blue-300 bg-white p-4">
              <p className="text-base font-black text-blue-700">税抜価格</p>
              <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                CSV取込・商品マスター・原価計算は税抜を基準にします。
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Default Tax</p>
            <h4 className="mt-2 text-lg font-black text-slate-900">標準の税率</h4>
            <select
              value={String(settings.defaultTaxRate)}
              onChange={(event) => updateSetting('defaultTaxRate', Number(event.target.value))}
              className="mt-4 h-12 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-400"
            >
              <option value="10">10% 標準税率</option>
              <option value="8">8% 軽減税率</option>
              <option value="0">0% 非課税 / 対象外</option>
            </select>
            <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">
              カテゴリーに税率がない場合の初期値です。
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Rounding</p>
            <h4 className="mt-2 text-lg font-black text-slate-900">消費税端数処理</h4>
            <select
              value={settings.roundingMode}
              onChange={(event) => updateSetting('roundingMode', event.target.value)}
              className="mt-4 h-12 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-400"
            >
              <option value="floor">切り捨て</option>
              <option value="round">四捨五入</option>
              <option value="ceil">切り上げ</option>
            </select>
            <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">
              税抜価格から税込価格を計算する時に使用します。
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Tax Rates</p>
          <h3 className="mt-2 text-xl font-black text-slate-900">使用する税率</h3>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
            酒税などの個別税は現時点では商品価格に含めて扱い、消費税率としては 10% / 8% / 0% の3系統で運用します。
          </p>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {settings.taxRates.map((taxRate) => (
            <div key={taxRate.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-slate-900">{taxRate.label}</p>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">{taxRate.description}</p>
                </div>
                {taxRate.isDefault ? (
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-600">標準</span>
                ) : null}
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-black text-slate-500">税率</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    value={taxRate.rate}
                    min="0"
                    max="100"
                    step="0.1"
                    onChange={(event) => updateTaxRate(taxRate.id, { rate: Number(event.target.value) })}
                    className="h-12 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-400"
                  />
                  <span className="text-sm font-black text-slate-500">%</span>
                </div>
              </label>

              <button
                type="button"
                onClick={() => updateTaxRate(taxRate.id, { isActive: !taxRate.isActive })}
                className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-black transition ${
                  taxRate.isActive
                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                {taxRate.isActive ? '使用する' : '使用しない'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Shopify Price Sync</p>
          <h3 className="mt-2 text-xl font-black text-slate-900">Shopifyへ同期する価格</h3>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
            Akuto POS側は税抜価格を正として保持し、Shopifyに送る時だけ税込または税抜に変換します。この設定だけではShopifyへの書き込みは行いません。
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[
            {
              id: 'taxIncluded',
              title: '税込価格で同期',
              description: 'EC表示価格を税込に揃えたい場合。日本国内向けのShopify運用ではこちらを標準にします。'
            },
            {
              id: 'taxExcluded',
              title: '税抜価格で同期',
              description: 'Shopify側で税計算・税込表示を制御する場合。外部EC側の設定確認が必要です。'
            }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateSetting('shopifyPriceSyncMode', option.id)}
              className={`rounded-3xl border-2 p-5 text-left transition ${
                settings.shopifyPriceSyncMode === option.id
                  ? 'border-blue-400 bg-blue-50 shadow-lg shadow-blue-500/10'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
              }`}
            >
              <p className="text-base font-black text-slate-900">{option.title}</p>
              <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-black text-amber-900">次フェーズ</p>
        <p className="mt-1 text-sm font-bold leading-relaxed text-amber-800">
          カテゴリー階層にデフォルト税率を持たせ、商品CSV取込時は「商品CSVの税率」→「カテゴリー税率」→「この画面の標準税率」の順に決定します。
        </p>
      </div>
    </section>
  );
};


const CSV_TEMPLATE_DEFINITIONS = [
  {
    id: 'suppliers',
    title: '仕入先CSVテンプレート',
    description: '仕入先マスターを登録・更新するためのCSVです。',
    filename: 'akuto-suppliers-template',
    columns: [
      { key: 'supplierId', label: '仕入先ID' },
      { key: 'name', label: '仕入先名' },
      { key: 'contactName', label: '担当者' },
      { key: 'tel', label: '電話番号' },
      { key: 'fax', label: 'FAX番号' },
      { key: 'email', label: 'メールアドレス' },
      { key: 'address', label: '住所' },
      { key: 'backorderValidDays', label: '受注残有効日数' },
      { key: 'orderListPrice', label: '発注上代' },
      { key: 'defaultCostRate', label: '掛率' },
      { key: 'note', label: 'メモ' }
    ],
    sampleRows: [
      {
        supplierId: 'SUP-001',
        name: 'サンプル仕入先',
        contactName: '山田太郎',
        tel: '0852-00-0000',
        fax: '0852-00-0001',
        email: 'sample@example.com',
        address: '島根県松江市',
        backorderValidDays: '30',
        orderListPrice: '1000',
        defaultCostRate: '60',
        note: 'サンプル'
      }
    ]
  },
  {
    id: 'brands',
    title: 'ブランドCSVテンプレート',
    description: 'ブランドマスターを登録・更新し、仕入先IDまたは仕入先名で仕入先に紐づけます。',
    filename: 'akuto-brands-template',
    columns: [
      { key: 'brandId', label: 'ブランドID' },
      { key: 'name', label: 'ブランド名' },
      { key: 'stocktakingTypeCode', label: '棚卸区分コード' },
      { key: 'supplierId', label: '仕入先ID' },
      { key: 'supplierName', label: '仕入先名' },
      { key: 'note', label: 'メモ' }
    ],
    sampleRows: [
      {
        brandId: 'BR-001',
        name: 'サンプルブランド',
        stocktakingTypeCode: '',
        supplierId: 'SUP-001',
        supplierName: 'サンプル仕入先',
        note: 'サンプル'
      }
    ]
  },
  {
    id: 'categories',
    title: 'カテゴリー階層CSVテンプレート',
    description: 'カテゴリーグループ・カテゴリー・サブカテゴリーを1本で登録・更新するためのCSVです。',
    filename: 'akuto-categories-template',
    columns: [
      { key: 'categoryGroupId', label: 'カテゴリーグループID' },
      { key: 'categoryGroupName', label: 'カテゴリーグループ名' },
      { key: 'categoryId', label: 'カテゴリーID' },
      { key: 'categoryName', label: 'カテゴリー名' },
      { key: 'subCategoryId', label: 'サブカテゴリーID' },
      { key: 'subCategoryName', label: 'サブカテゴリー名' },
      { key: 'sortOrder', label: '並び順' },
      { key: 'note', label: 'メモ' }
    ],
    sampleRows: [
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-001',
        categoryName: '食器',
        subCategoryId: 'SUBCAT-001',
        subCategoryName: 'プレート',
        sortOrder: '10',
        note: '生活雑貨 > 食器 > プレート'
      },
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-001',
        categoryName: '食器',
        subCategoryId: 'SUBCAT-002',
        subCategoryName: 'ボウル',
        sortOrder: '20',
        note: '生活雑貨 > 食器 > ボウル'
      },
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-001',
        categoryName: '食器',
        subCategoryId: 'SUBCAT-003',
        subCategoryName: 'カップ',
        sortOrder: '30',
        note: '生活雑貨 > 食器 > カップ'
      },
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-002',
        categoryName: 'キッチン',
        subCategoryId: 'SUBCAT-004',
        subCategoryName: '調理道具',
        sortOrder: '40',
        note: '生活雑貨 > キッチン > 調理道具'
      },
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-002',
        categoryName: 'キッチン',
        subCategoryId: 'SUBCAT-005',
        subCategoryName: '保存容器',
        sortOrder: '50',
        note: '生活雑貨 > キッチン > 保存容器'
      },
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-003',
        categoryName: 'インテリア',
        subCategoryId: 'SUBCAT-006',
        subCategoryName: '花器',
        sortOrder: '60',
        note: '生活雑貨 > インテリア > 花器'
      },
      {
        categoryGroupId: 'CG-001',
        categoryGroupName: '生活雑貨',
        categoryId: 'CAT-003',
        categoryName: 'インテリア',
        subCategoryId: 'SUBCAT-007',
        subCategoryName: '照明',
        sortOrder: '70',
        note: '生活雑貨 > インテリア > 照明'
      },
      {
        categoryGroupId: 'CG-002',
        categoryGroupName: 'アパレル',
        categoryId: 'CAT-004',
        categoryName: 'トップス',
        subCategoryId: 'SUBCAT-008',
        subCategoryName: 'シャツ',
        sortOrder: '80',
        note: 'アパレル > トップス > シャツ'
      },
      {
        categoryGroupId: 'CG-002',
        categoryGroupName: 'アパレル',
        categoryId: 'CAT-004',
        categoryName: 'トップス',
        subCategoryId: 'SUBCAT-009',
        subCategoryName: 'ニット',
        sortOrder: '90',
        note: 'アパレル > トップス > ニット'
      },
      {
        categoryGroupId: 'CG-002',
        categoryGroupName: 'アパレル',
        categoryId: 'CAT-005',
        categoryName: 'ボトムス',
        subCategoryId: 'SUBCAT-010',
        subCategoryName: 'パンツ',
        sortOrder: '100',
        note: 'アパレル > ボトムス > パンツ'
      },
      {
        categoryGroupId: 'CG-002',
        categoryGroupName: 'アパレル',
        categoryId: 'CAT-005',
        categoryName: 'ボトムス',
        subCategoryId: 'SUBCAT-011',
        subCategoryName: 'スカート',
        sortOrder: '110',
        note: 'アパレル > ボトムス > スカート'
      },
      {
        categoryGroupId: 'CG-002',
        categoryGroupName: 'アパレル',
        categoryId: 'CAT-006',
        categoryName: '服飾小物',
        subCategoryId: 'SUBCAT-012',
        subCategoryName: '帽子',
        sortOrder: '120',
        note: 'アパレル > 服飾小物 > 帽子'
      },
      {
        categoryGroupId: 'CG-002',
        categoryGroupName: 'アパレル',
        categoryId: 'CAT-006',
        categoryName: '服飾小物',
        subCategoryId: 'SUBCAT-013',
        subCategoryName: 'バッグ',
        sortOrder: '130',
        note: 'アパレル > 服飾小物 > バッグ'
      },
      {
        categoryGroupId: 'CG-003',
        categoryGroupName: 'アウトドア',
        categoryId: 'CAT-007',
        categoryName: 'キャンプ用品',
        subCategoryId: 'SUBCAT-014',
        subCategoryName: 'テーブル',
        sortOrder: '140',
        note: 'アウトドア > キャンプ用品 > テーブル'
      },
      {
        categoryGroupId: 'CG-003',
        categoryGroupName: 'アウトドア',
        categoryId: 'CAT-007',
        categoryName: 'キャンプ用品',
        subCategoryId: 'SUBCAT-015',
        subCategoryName: 'チェア',
        sortOrder: '150',
        note: 'アウトドア > キャンプ用品 > チェア'
      },
      {
        categoryGroupId: 'CG-003',
        categoryGroupName: 'アウトドア',
        categoryId: 'CAT-008',
        categoryName: 'ボトル',
        subCategoryId: 'SUBCAT-016',
        subCategoryName: '水筒',
        sortOrder: '160',
        note: 'アウトドア > ボトル > 水筒'
      },
      {
        categoryGroupId: 'CG-003',
        categoryGroupName: 'アウトドア',
        categoryId: 'CAT-008',
        categoryName: 'ボトル',
        subCategoryId: 'SUBCAT-017',
        subCategoryName: 'タンブラー',
        sortOrder: '170',
        note: 'アウトドア > ボトル > タンブラー'
      },
      {
        categoryGroupId: 'CG-004',
        categoryGroupName: '食品',
        categoryId: 'CAT-009',
        categoryName: 'ドリンク',
        subCategoryId: 'SUBCAT-018',
        subCategoryName: 'ジュース',
        sortOrder: '180',
        note: '食品 > ドリンク > ジュース'
      },
      {
        categoryGroupId: 'CG-004',
        categoryGroupName: '食品',
        categoryId: 'CAT-009',
        categoryName: 'ドリンク',
        subCategoryId: 'SUBCAT-019',
        subCategoryName: 'コーヒー',
        sortOrder: '190',
        note: '食品 > ドリンク > コーヒー'
      },
      {
        categoryGroupId: 'CG-004',
        categoryGroupName: '食品',
        categoryId: 'CAT-010',
        categoryName: 'お菓子',
        subCategoryId: 'SUBCAT-020',
        subCategoryName: 'チョコレート',
        sortOrder: '200',
        note: '食品 > お菓子 > チョコレート'
      }
    ]
  },
  {
    id: 'products',
    title: '商品CSVテンプレート',
    description: '商品マスターを登録・更新するためのCSVです。バーコード一致は既存更新し、未登録の商品は新規追加します。',
    filename: 'akuto-products-template',
    columns: [
      { key: 'barcode', label: 'バーコード' },
      { key: 'productCode', label: '品番' },
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: '商品名' },
      { key: 'size', label: 'サイズ' },
      { key: 'color', label: 'カラー' },
      { key: 'categoryGroupName', label: 'カテゴリーグループ名' },
      { key: 'categoryName', label: 'カテゴリー名' },
      { key: 'subCategoryName', label: 'サブカテゴリー名' },
      { key: 'brandName', label: 'ブランド名' },
      { key: 'supplierName', label: '仕入先名' },
      { key: 'costPrice', label: '原価' },
      { key: 'priceTaxExcluded', label: '売価（税抜）' },
      { key: 'priceTaxIncluded', label: '売価（税込・参考）' },
      { key: 'taxRate', label: '税率' },
      { key: 'stockQuantity', label: '在庫数' },
      { key: 'unit', label: '単位' },
      { key: 'note', label: 'メモ' },
      { key: 'isActive', label: '有効' }
    ],
    sampleRows: [
      {
        barcode: '4900000000001',
        productCode: 'AKUTO-SAMPLE-001',
        sku: 'AKUTO-SAMPLE-001',
        name: 'サンプル商品',
        size: 'M',
        color: 'WHITE',
        categoryGroupName: '生活雑貨',
        categoryName: '食器',
        subCategoryName: 'プレート',
        brandName: 'サンプルブランド',
        supplierName: 'サンプル仕入先',
        costPrice: '600',
        priceTaxExcluded: '1000',

        priceTaxIncluded: '',
        taxRate: '10',
        stockQuantity: '10',
        unit: '点',
        note: 'サンプル',
        isActive: 'TRUE'
      }
    ]
  }
];


const CSV_TEMPLATE_SAMPLE_ROW_COUNT = 20;

const padTemplateSampleIndex = (index, width = 3) => String(index + 1).padStart(width, '0');

const replaceTrailingTemplateNumber = (value, index, width = 3) => {
  const source = String(value || '');
  const suffix = padTemplateSampleIndex(index, width);
  if (!source) return source;
  if (/\d+$/.test(source)) {
    return source.replace(/\d+$/, suffix);
  }
  return `${source}-${suffix}`;
};

const buildTemplateSampleValue = (key, value, index) => {
  if (index === 0 || value === null || value === undefined || value === '') {
    return value;
  }

  const source = String(value);
  const suffix = padTemplateSampleIndex(index);

  if (key === 'barcode') {
    return `49000000${String(index + 1).padStart(5, '0')}`;
  }

  if ([
    'supplierId',
    'brandId',
    'categoryGroupId',
    'categoryId',
    'subCategoryId',
    'productCode',
    'sku'
  ].includes(key)) {
    return replaceTrailingTemplateNumber(source, index);
  }

  if ([
    'name',
    'supplierName',
    'brandName',
    'categoryGroupName',
    'categoryName',
    'subCategoryName'
  ].includes(key)) {
    return `${source} ${suffix}`;
  }

  if (key === 'sortOrder') {
    const base = Number(source);
    return Number.isFinite(base) ? String(base + index * 10) : String((index + 1) * 10);
  }

  if (key === 'stockQuantity') {
    const base = Number(source);
    return Number.isFinite(base) ? String(base + index) : String(index + 1);
  }

  if (key === 'note') {
    return `${source} ${suffix}`;
  }

  return value;
};

const expandTemplateSampleRows = (template) => {
  const sampleRows = Array.isArray(template?.sampleRows) ? template.sampleRows : [];
  const columns = Array.isArray(template?.columns) ? template.columns : [];
  if (!sampleRows.length || !columns.length) return sampleRows;
  if (sampleRows.length >= CSV_TEMPLATE_SAMPLE_ROW_COUNT) {
    return sampleRows.slice(0, CSV_TEMPLATE_SAMPLE_ROW_COUNT);
  }

  return Array.from({ length: CSV_TEMPLATE_SAMPLE_ROW_COUNT }, (_, index) => {
    const baseRow = sampleRows[index % sampleRows.length] || {};
    return columns.reduce((row, column) => {
      row[column.key] = buildTemplateSampleValue(column.key, baseRow[column.key], index);
      return row;
    }, {});
  });
};

const escapeTemplateCsvValue = (value) => {
  const normalized = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
};

const buildTemplateCsvText = (template, withSampleRows = false) => {
  const header = template.columns.map((column) => escapeTemplateCsvValue(column.label)).join(',');
  const sampleRows = withSampleRows ? expandTemplateSampleRows(template) : [];
  const rows = sampleRows.map((row) => (
    template.columns.map((column) => escapeTemplateCsvValue(row[column.key])).join(',')
  ));
  return [header, ...rows].join('\n');
};

const downloadCsvTemplate = (template, withSampleRows = false) => {
  const csvText = buildTemplateCsvText(template, withSampleRows);
  const blob = new Blob(['\ufeff', csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${template.filename}${withSampleRows ? '-sample' : ''}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const CsvTemplateWorkflowPanel = () => (
  <div className="space-y-4">
    <div className="rounded-[2rem] border border-blue-100 bg-blue-50 px-5 py-4">
      <p className="text-sm font-black text-blue-700">CSVテンプレート</p>
      <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
        取込用CSVのヘッダーをダウンロードできます。初回作成時はサンプル付き、実運用では空テンプレートを使ってください。
      </p>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {CSV_TEMPLATE_DEFINITIONS.map((template) => (
        <div key={template.id} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-black text-slate-900">{template.title}</h4>
              <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">{template.description}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {template.id === 'products' && (
              <>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">新規追加・既存更新</span>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">バーコード優先</span>
              </>
            )}
            {template.id !== 'products' && (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">新規のみ追加 / 新規追加・既存更新</span>
            )}
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-xs font-black text-slate-500">列項目</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-400">
              {template.columns.map((column) => column.label).join(' / ')}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadCsvTemplate(template, false)}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-slate-700"
            >
              空テンプレート
            </button>
            <button
              type="button"
              onClick={() => downloadCsvTemplate(template, true)}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-500"
            >
              サンプル付き
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);


const CsvImportWorkflowPanel = ({
  storeId,
  productMaster,
  defaultTaxRate = 10,
  onSaved
}) => (
  <div className="space-y-5">
    <div className="rounded-[2rem] border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-400">CSV Import Workflow</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">CSV取込の順番</h2>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
        商品CSVを正しく紐づけるために、先に補助マスターを登録します。推奨順は、仕入先 → ブランド → カテゴリーグループ/カテゴリー/サブカテゴリー → 商品です。
      </p>
    </div>

    <CsvImportStepCard
      number="01"
      title="仕入先CSV取込"
      description="既存台帳の仕入先情報を、Akuto POSの仕入先マスターへ取り込みます。"
    >
      <MasterCsvImportPanel
        type="suppliers"
        suppliers={productMaster?.suppliers || []}
        brands={productMaster?.brands || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        productSubCategories={productMaster?.productSubCategories || []}
        onSaveSupplier={productMaster?.saveSupplier}
        onSaveBrand={productMaster?.saveBrand}
        onSaveCategory={productMaster?.saveCategory}
        onSaveCategoryGroup={productMaster?.saveCategoryGroup}
        onSaveSubCategory={productMaster?.saveSubCategory}
        onSaved={onSaved}
      />
    </CsvImportStepCard>

    <CsvImportStepCard
      number="02"
      title="ブランドCSV取込"
      description="ブランド情報をAkuto POSのブランドマスターへ取り込みます。仕入先ID/仕入先名があれば既存仕入先に紐づけます。"
    >
      <MasterCsvImportPanel
        type="brands"
        suppliers={productMaster?.suppliers || []}
        brands={productMaster?.brands || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        productSubCategories={productMaster?.productSubCategories || []}
        onSaveSupplier={productMaster?.saveSupplier}
        onSaveBrand={productMaster?.saveBrand}
        onSaveCategory={productMaster?.saveCategory}
        onSaveCategoryGroup={productMaster?.saveCategoryGroup}
        onSaveSubCategory={productMaster?.saveSubCategory}
        onSaved={onSaved}
      />
    </CsvImportStepCard>

    <CsvImportStepCard
      number="03"
      title="カテゴリー階層CSV取込"
      description="カテゴリーグループ・カテゴリー・サブカテゴリーを1本のCSVで取り込みます。"
    >
      <MasterCsvImportPanel
        type="categories"
        suppliers={productMaster?.suppliers || []}
        brands={productMaster?.brands || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        productSubCategories={productMaster?.productSubCategories || []}
        onSaveSupplier={productMaster?.saveSupplier}
        onSaveBrand={productMaster?.saveBrand}
        onSaveCategory={productMaster?.saveCategory}
        onSaveCategoryGroup={productMaster?.saveCategoryGroup}
        onSaveSubCategory={productMaster?.saveSubCategory}
        onSaved={onSaved}
      />
    </CsvImportStepCard>

    <CsvImportStepCard
      number="04"
      title="商品CSV取込"
      description="補助マスター登録後に商品を取り込みます。バーコード一致は既存更新し、未登録の商品は新規追加します。"
    >
      <div data-ui-id="PRODUCT_CSV_FIXED_MODE_CARD_NOTICE" className="mb-4 flex flex-wrap items-center gap-2 text-xs font-black text-blue-700">
        <span className="rounded-full bg-white px-2 py-1 shadow-sm">取込モード：新規追加・既存更新</span>
        <span className="rounded-full bg-white px-2 py-1 shadow-sm">判定キー：バーコード優先</span>
      </div>
      <ProductCsvImportPanel
        storeId={storeId}
        products={productMaster?.products || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        productSubCategories={productMaster?.productSubCategories || []}
        defaultTaxRate={defaultTaxRate}
        brands={productMaster?.brands || []}
        suppliers={productMaster?.suppliers || []}
        onSaveProduct={productMaster?.saveProduct}
        onSaveProductGroup={productMaster?.saveProductGroup}
        onSaved={onSaved}
        productSalesAreas={productMaster?.productSalesAreas || []}
      />
    </CsvImportStepCard>
  </div>
);


const PosDummyTabbedPage = ({ item, productMaster, storeId, onSaved }) => {
  const page = POS_DUMMY_PAGES[item?.id] || {
    title: item?.label || '準備中',
    eyebrow: 'Coming Soon',
    description: item?.desc || 'この管理画面は準備中です。',
    tabs: [
      { id: 'overview', label: '概要', description: 'この画面は準備中です。' }
    ]
  };
  const Icon = item?.icon || Package;
  const [activeDummyTab, setActiveDummyTab] = useState(page.tabs[0]?.id || 'overview');
  const activeTab = page.tabs.find((tab) => tab.id === activeDummyTab) || page.tabs[0];

  const renderProductManagementPanel = () => {
    if (item?.id === 'shopifyIntegration' || item?.id === 'ecIntegration') {
      return (
        <EcIntegrationPanel
          activeTab={activeDummyTab || 'shopify'}
          productMaster={productMaster}
          onSaved={onSaved}
        />
      );
    }

    if (item?.id === 'csvImportExport') {
      const activeCsvTab = activeDummyTab || 'csvImport';

      if (activeCsvTab === 'csvImport') {
        return (
          <CsvImportWorkflowPanel
            storeId={storeId}
            productMaster={productMaster}
            defaultTaxRate={taxPriceSettingsForProducts.defaultTaxRate}
            onSaved={onSaved}
          />
        );
      }

      if (activeCsvTab === 'csvExport') {
        return (
          <CsvExportWorkflowPanel
            storeId={storeId}
            productMaster={productMaster}
          />
        );
      }

      if (activeCsvTab === 'templates') {
        return <CsvTemplateWorkflowPanel />;
      }

      return null;
    }

    if (item?.id !== 'productManagement') return null;

    if (activeDummyTab === 'categories') {
      return (
        <SimpleMasterPanel
          key="product-categories-panel"
          label="カテゴリー"
          blank={blankCategory}
          items={productMaster?.productCategories || []}
          productCategoryGroups={productMaster?.productCategoryGroups || []}
          productSubCategories={productMaster?.productSubCategories || []}
          onSaveCategoryGroup={productMaster?.saveCategoryGroup}
          fields={[
            { id: 'name', label: 'カテゴリー名' },
            { id: 'groupId', label: 'カテゴリーグループ', type: 'categoryGroupSelect' },
          ]}
          onSave={productMaster?.saveCategory}
          onDelete={productMaster?.deleteCategory}
          onSaved={onSaved}
        />
      );
    }

    if (activeDummyTab === 'subCategories') {
      return (
        <SimpleMasterPanel
          key="product-sub-categories-panel"
          label="サブカテゴリー"
          blank={blankCategory}
          items={productMaster?.productSubCategories || []}
          productCategories={productMaster?.productCategories || []}
          productCategoryGroups={productMaster?.productCategoryGroups || []}
          fields={[
            { id: 'name', label: 'サブカテゴリー名' },
            { id: 'categoryId', label: '親カテゴリー', type: 'categorySelect' },
            { id: 'sortOrder', label: '並び順', type: 'number' },
          ]}
          onSave={(payload) => {
            const { color, categoryColor, subCategoryColor, ...cleanSubCategoryPayload } = payload;
            const matchedCategory = (productMaster?.productCategories || []).find((category) => category.id === cleanSubCategoryPayload.categoryId);
            const matchedGroup = (productMaster?.productCategoryGroups || []).find((group) => group.id === matchedCategory?.groupId);
            return productMaster?.saveSubCategory?.({
              ...cleanSubCategoryPayload,
              categoryName: matchedCategory?.name || cleanSubCategoryPayload.categoryName || '',
              categoryGroupId: matchedCategory?.groupId || cleanSubCategoryPayload.categoryGroupId || '',
              categoryGroupName: matchedGroup?.name || cleanSubCategoryPayload.categoryGroupName || '',
              groupId: matchedCategory?.groupId || cleanSubCategoryPayload.groupId || '',
              groupName: matchedGroup?.name || cleanSubCategoryPayload.groupName || '',
              subCategoryName: cleanSubCategoryPayload.name || cleanSubCategoryPayload.subCategoryName || ''
            });
          }}
          onDelete={productMaster?.deleteSubCategory}
          onSaved={onSaved}
        />
      );
    }

    if (activeDummyTab === 'salesAreas') {
      return (
        <SimpleMasterPanel
          key="product-sales-areas-panel"
          label="売場"
          blank={blankCategory}
          items={productMaster?.productSalesAreas || []}
          productCategoryGroups={productMaster?.productCategoryGroups || []}
          fields={[
            { id: 'name', label: '売場名' },
            { id: 'displayName', label: '表示名' },
            { id: 'sortOrder', label: '並び順', type: 'number' },
            { id: 'color', label: 'カラー' },
            { id: 'allowedCategoryGroupNames', label: '紐付けカテゴリーグループ', type: 'categoryGroupMultiSelect' },
          ]}
          onSave={(payload) =>
            productMaster?.saveSalesArea?.({
              ...payload,
              displayName: payload.displayName || payload.name || ''
            })
          }
          onDelete={productMaster?.deleteSalesArea}
          onSaved={onSaved}
        />
      );
    }

    if (activeDummyTab === 'categoryGroups') {
      return (
        <SimpleMasterPanel
          key="product-category-groups-panel"
          label="カテゴリーグループ"
          blank={blankGroup}
          items={productMaster?.productCategoryGroups || []}
          productCategories={productMaster?.productCategories || []}
          productSubCategories={productMaster?.productSubCategories || []}
          fields={[
            { id: 'name', label: 'グループ名' },
          ]}
          onSave={productMaster?.saveCategoryGroup}
          onDelete={productMaster?.deleteCategoryGroup}
          onSaved={onSaved}
        />
      );
    }

    if (activeDummyTab === 'brands') {
      return (
        <SimpleMasterPanel
          key="product-brands-panel"
          label="ブランド"
          blank={blankBrand}
          items={productMaster?.brands || []}
          suppliers={productMaster?.suppliers || []}
          onSaveSupplier={productMaster?.saveSupplier}
          fields={[
            { id: 'name', label: 'ブランド名' },
            { id: 'supplierId', label: '仕入先', type: 'supplierSelect' },
            {
              id: 'effectiveCostRate',
              label: '適用掛け率 %',
              type: 'effectiveCostRateDisplay',
              helpText: '固有掛け率が未設定の場合は、仕入先の標準掛け率を使用します。'
            },
            {
              id: 'defaultCostRate',
              label: '固有掛け率 %',
              type: 'number',
              helpText: '仕入先の標準掛け率と異なる場合だけ入力してください。未設定の場合は仕入先の標準掛け率を使用します。'
            },
            { id: 'stocktakingTypeCode', label: '棚卸区分コード' },
            { id: 'note', label: 'ブランドプロフィール', type: 'textarea', rows: 8 }
          ]}
          onSave={productMaster?.saveBrand}
          onDelete={productMaster?.deleteBrand}
          onSaved={onSaved}
        />
      );
    }

    if (activeDummyTab === 'suppliers') {
      return (
        <SimpleMasterPanel
          key="product-suppliers-panel"
          label="仕入先"
          blank={blankSupplier}
          items={productMaster?.suppliers || []}
          fields={[
            { id: 'name', label: '仕入先名' },
            { id: 'contactName', label: '担当者' },
            { id: 'tel', label: '電話番号' },
            { id: 'email', label: 'メール' },
            { id: 'address', label: '住所' },
            {
              id: 'defaultCostRate',
              label: '標準掛け率 %',
              type: 'number',
              helpText: 'この仕入先でよく使う基本掛け率を入力してください。ブランド側に固有掛け率がある場合は、そちらを優先します。'
            },
            {
              id: 'paymentTerms',
              label: '支払いサイト',
              type: 'select',
              placeholder: '支払いサイトを選択',
              options: [
                { value: '月末締め翌月末払い', label: '月末締め翌月末払い' },
                { value: 'COD', label: 'COD' }
              ]
            }
          ]}
          onSave={productMaster?.saveSupplier}
          onDelete={productMaster?.deleteSupplier}
          onSaved={onSaved}
        />
      );
    }

    return null;
  };

  const productManagementPanel = renderProductManagementPanel();

  useEffect(() => {
    setActiveDummyTab(page.tabs[0]?.id || 'overview');
  }, [item?.id]);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-30 rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm shadow-slate-200/50">
        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-blue-50 text-blue-600">
            <Icon size={30} strokeWidth={2.5} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-400">
              {page.eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
              {page.title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
              {page.description}
            </p>
          </div>

          {item?.id !== 'csvImportExport' && (
            <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-600">
              ダミー
            </span>
          )}
        </div>
      </div>

      <div className="sticky top-[8.5rem] z-30 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
        <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1.5">
          {page.tabs.map((tab) => {
            const isActive = activeTab?.id === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveDummyTab(tab.id)}
                className={`rounded-xl px-4 py-3 text-sm font-black transition-all ${
                  isActive
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {productManagementPanel || (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-7">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              {activeTab?.label}
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
              {activeTab?.label}
            </h2>
            <p className="mt-3 text-sm font-bold leading-relaxed text-slate-500">
              {activeTab?.description}
            </p>
            <p className="mt-5 text-xs font-bold text-slate-400">
              ここは次フェーズで実データに接続します。現時点ではタブ切り替え確認用のダミー画面です。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const TimeSettings = ({
  periods,
  menuItems,
  onSavePeriods,
  periodLoading,
  businessSettings,
  updateBusinessSettings,
  onSaved
}) => {
  const [activeTimeTab, setActiveTimeTab] = useState('period');

  const tabs = [
    {
      id: 'period',
      label: '提供時間帯',
      description: 'ランチ・ディナー・カフェタイムなど、商品表示に使う時間帯を管理します。'
    },
    {
      id: 'business',
      label: '営業時間',
      description: '店舗全体の注文受付時間、定休日、ラストオーダーを管理します。'
    }
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-orange-100 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">
            Time Settings
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-gray-900">
            時間帯設定
          </h2>
          <p className="mt-1 text-sm font-bold leading-relaxed text-gray-400">
            提供時間帯と営業時間をまとめて管理します。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">
          {tabs.map((tab) => {
            const active = activeTimeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTimeTab(tab.id)}
                className={`rounded-xl px-4 py-3 text-left transition-all ${
                  active
                    ? 'bg-white text-orange-600 shadow-sm'
                    : 'text-gray-400 hover:bg-white/60 hover:text-gray-600'
                }`}
              >
                <div className="text-sm font-black">
                  {tab.label}
                </div>
                <div className="mt-1 hidden text-[11px] font-bold leading-relaxed opacity-70 md:block">
                  {tab.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeTimeTab === 'period' ? (
        <PeriodSettings
          periods={periods || []}
          menuItems={menuItems || []}
          loading={periodLoading}
          onSave={onSavePeriods}
          onSaved={onSaved}
        />
      ) : (
        <BusinessSettings
          settings={businessSettings}
          onSave={updateBusinessSettings}
          onSaved={onSaved}
        />
      )}
    </div>
  );
};


const csvEscapeForExport = (value) => {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const downloadCsvFile = (filename, headers, rows) => {
  const csvRows = [
    headers.map((header) => csvEscapeForExport(header)).join(','),
    ...rows.map((row) => headers.map((header) => csvEscapeForExport(row[header])).join(','))
  ];
  const blob = new Blob([`\uFEFF${csvRows.join('\n')}\n`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const normalizeExportId = (value) => (
  String(value ?? '').trim().replace(/\.00$/, '')
);

const CSV_EXPORT_PAGE_SIZE = 500;

const fetchAllStoreCollectionRows = async ({
  storeId,
  collectionName,
  orderField = 'name',
  pageSize = CSV_EXPORT_PAGE_SIZE
}) => {
  const normalizedStoreId = String(storeId || '').trim();
  if (!normalizedStoreId || !collectionName) return [];

  const collectionRef = collection(db, 'stores', normalizedStoreId, collectionName);
  const rows = [];
  let lastSnapshot = null;

  for (;;) {
    const pageQuery = lastSnapshot
      ? query(collectionRef, orderBy(orderField), startAfter(lastSnapshot), limit(pageSize))
      : query(collectionRef, orderBy(orderField), limit(pageSize));

    const snapshot = await getDocs(pageQuery);
    rows.push(...snapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data()
    })));

    if (snapshot.size < pageSize) break;
    lastSnapshot = snapshot.docs[snapshot.docs.length - 1];

    if (!lastSnapshot) break;
  }

  return rows;
};

const toExportBoolean = (value) => (value === false ? 'FALSE' : 'TRUE');

const formatDateStamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes())
  ].join('');
};

const buildSupplierExportRows = (suppliers = []) => suppliers
  .map((supplier) => ({
    supplierId: normalizeExportId(supplier.smaregiSupplierId || supplier.supplierSmaregiId || supplier.supplierExternalId || supplier.externalSupplierId),
    name: supplier.name || supplier.supplierName || '',
    kana: supplier.kana || '',
    contactName: supplier.contactName || '',
    tel: supplier.tel || supplier.phone || '',
    email: supplier.email || '',
    paymentTerms: supplier.paymentTerms || '',
    note: supplier.note || '',
    isActive: toExportBoolean(supplier.isActive)
  }))
  .filter((row) => row.name)
  .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

const buildBrandExportRows = (brands = [], suppliers = []) => {
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  return brands
    .map((brand) => {
      const supplier = suppliersById.get(brand.supplierId || '') || null;
      return {
        brandId: normalizeExportId(brand.brandExternalId || brand.smaregiBrandId || brand.brandCode || brand.id),
        brandCode: normalizeExportId(brand.brandCode || brand.smaregiBrandId || brand.brandExternalId),
        brandName: brand.name || brand.brandName || '',
        kana: brand.kana || '',
        note: brand.note || '',
        isActive: toExportBoolean(brand.isActive),
        supplierId: normalizeExportId(brand.supplierSmaregiId || supplier?.smaregiSupplierId || supplier?.supplierSmaregiId || brand.supplierId),
        supplierName: brand.supplierName || supplier?.name || supplier?.supplierName || ''
      };
    })
    .filter((row) => row.brandName)
    .sort((a, b) => a.brandName.localeCompare(b.brandName, 'ja'));
};

const buildCategoryGroupExportRows = (categoryGroups = []) => categoryGroups
  .map((group) => ({
    categoryGroupId: group.groupExternalId || group.smaregiCategoryGroupId || group.categoryGroupCode || group.id || '',
    categoryGroupName: group.name || group.groupName || group.categoryGroupName || '',
    displayOrder: group.displayOrder ?? group.order ?? '',
    note: group.note || '',
    isActive: toExportBoolean(group.isActive)
  }))
  .filter((row) => row.categoryGroupName)
  .sort((a, b) => String(a.displayOrder || '').localeCompare(String(b.displayOrder || ''), 'ja') || a.categoryGroupName.localeCompare(b.categoryGroupName, 'ja'));

const buildCategoryExportRows = (categories = [], categoryGroups = [], subCategories = []) => {
  const groupsById = new Map(categoryGroups.map((group) => [group.id, group]));
  const subCategoriesByCategoryId = new Map();

  (subCategories || []).forEach((subCategory) => {
    const categoryId = subCategory.categoryId || '';
    if (!categoryId) return;
    if (!subCategoriesByCategoryId.has(categoryId)) subCategoriesByCategoryId.set(categoryId, []);
    subCategoriesByCategoryId.get(categoryId).push(subCategory);
  });

  const rows = [];

  (categories || []).forEach((category) => {
    const group = groupsById.get(category.groupId || category.categoryGroupId || '') || null;
    const matchedSubCategories = subCategoriesByCategoryId.get(category.id) || [];

    const baseRow = {
      categoryGroupId: category.categoryGroupExternalId || group?.groupExternalId || group?.smaregiCategoryGroupId || group?.categoryGroupCode || category.groupId || category.categoryGroupId || '',
      categoryGroupName: category.categoryGroupName || group?.name || group?.groupName || group?.categoryGroupName || '',
      categoryId: category.categoryExternalId || category.smaregiCategoryId || category.categoryCode || category.id || '',
      categoryName: category.name || category.categoryName || '',
      displayOrder: category.displayOrder ?? category.order ?? '',
      note: category.note || '',
      isActive: toExportBoolean(category.isActive)
    };

    if (!matchedSubCategories.length) {
      rows.push({
        ...baseRow,
        subCategoryId: '',
        subCategoryName: ''
      });
      return;
    }

    matchedSubCategories.forEach((subCategory) => {
      rows.push({
        ...baseRow,
        subCategoryId: subCategory.subCategoryExternalId || subCategory.smaregiSubCategoryId || subCategory.subCategoryCode || subCategory.id || '',
        subCategoryName: subCategory.name || subCategory.subCategoryName || '',
        displayOrder: subCategory.displayOrder ?? subCategory.sortOrder ?? baseRow.displayOrder,
        note: subCategory.note || baseRow.note,
        isActive: toExportBoolean(subCategory.isActive)
      });
    });
  });

  return rows
    .filter((row) => row.categoryName || row.subCategoryName)
    .sort((a, b) => (
      a.categoryGroupName.localeCompare(b.categoryGroupName, 'ja') ||
      a.categoryName.localeCompare(b.categoryName, 'ja') ||
      a.subCategoryName.localeCompare(b.subCategoryName, 'ja')
    ));
};


const calculateCsvTaxIncludedPrice = (priceTaxExcluded, taxRate = 10) => {
  const excluded = Number(priceTaxExcluded);
  if (!Number.isFinite(excluded)) return '';

  const rate = Number(taxRate);
  const normalizedRate = Number.isFinite(rate) ? Math.max(rate, 0) : 10;

  return Math.floor(excluded * (100 + normalizedRate) / 100);
};

const buildProductExportRows = ({
  products = [],
  productGroups = [],
  brands = [],
  suppliers = [],
  categories = [],
  categoryGroups = [],
  subCategories = []
}) => {
  const groupsById = new Map(productGroups.map((group) => [group.id, group]));
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const categoryGroupsById = new Map(categoryGroups.map((group) => [group.id, group]));
  const subCategoriesById = new Map(subCategories.map((subCategory) => [subCategory.id, subCategory]));

  return products
    .map((product) => {
      const group = groupsById.get(product.groupId || product.productGroupId || '') || null;
      const brand = brandsById.get(product.brandId || group?.brandId || '') || null;
      const productSupplier = suppliersById.get(product.supplierId || '') || null;
      const brandSupplier = suppliersById.get(brand?.supplierId || '') || null;
      const category = categoriesById.get(product.categoryId || group?.categoryId || '') || null;
      const subCategory = subCategoriesById.get(product.subCategoryId || group?.subCategoryId || '') || null;
      const categoryGroup = categoryGroupsById.get(product.categoryGroupId || group?.categoryGroupId || category?.groupId || category?.categoryGroupId || subCategory?.categoryGroupId || subCategory?.groupId || '') || null;

      const supplierName = product.supplierName
        || productSupplier?.name
        || productSupplier?.supplierName
        || brand?.supplierName
        || brandSupplier?.name
        || brandSupplier?.supplierName
        || '';

      return {
        productGroupId: group?.groupExternalId || group?.productGroupExternalId || group?.groupCode || group?.id || product.groupId || product.productGroupId || '',
        productGroupName: group?.name || group?.groupName || product.productGroupName || '',
        productCode: product.productCode || product.code || '',
        sku: product.sku || '',
        barcode: product.barcode || '',
        productName: product.name || product.productName || '',
        name: product.name || product.productName || '',
        brandName: product.brandName || group?.brandName || brand?.name || brand?.brandName || '',
        supplierName,
        categoryGroupId: product.categoryGroupId || group?.categoryGroupId || categoryGroup?.id || '',
        categoryGroupName: product.categoryGroupName || group?.categoryGroupName || categoryGroup?.name || categoryGroup?.groupName || '',
        categoryId: product.categoryId || group?.categoryId || category?.id || '',
        categoryName: product.categoryName || group?.categoryName || category?.name || category?.categoryName || '',
        subCategoryId: product.subCategoryId || group?.subCategoryId || subCategory?.id || '',
        subCategoryName: product.subCategoryName || group?.subCategoryName || subCategory?.name || subCategory?.subCategoryName || '',
        salesAreaId: product.salesAreaId || group?.salesAreaId || '',
        salesAreaName: product.salesAreaName || group?.salesAreaName || '',
        colorName: product.colorName || product.color || '',
        size: product.size || product.sizeName || '',
        priceTaxExcluded: product.priceTaxExcluded ?? product.price ?? product.salesPrice ?? '',
        priceTaxIncluded: product.priceTaxIncluded ?? calculateCsvTaxIncludedPrice(
          product.priceTaxExcluded ?? product.price ?? product.salesPrice ?? '',
          product.taxRate ?? product.tax ?? 10
        ),
        taxRate: product.taxRate ?? product.tax ?? '',
        inventoryQuantity: product.inventoryQuantity ?? product.stockQuantity ?? product.stock ?? '',
        shopifyCreateEnabled: product.shopifyCreateEnabled === true || group?.shopifyCreateEnabled === true ? 'TRUE' : 'FALSE'
      };
    })
    .filter((row) => row.productName || row.productCode || row.barcode)
    .sort((a, b) => a.productGroupName.localeCompare(b.productGroupName, 'ja') || a.productName.localeCompare(b.productName, 'ja'));
};



const CsvExportWorkflowPanel = ({ storeId, productMaster }) => {
  const suppliers = productMaster?.suppliers || [];
  const brands = productMaster?.brands || [];
  const productCategories = productMaster?.productCategories || [];
  const productCategoryGroups = productMaster?.productCategoryGroups || [];
  const productSubCategories = productMaster?.productSubCategories || [];
  const products = productMaster?.products || [];
  const productGroups = productMaster?.productGroups || [];
  const [productCsvExporting, setProductCsvExporting] = useState(false);
  const [productCsvTotalCount, setProductCsvTotalCount] = useState(null);
  const [productCsvCountLoading, setProductCsvCountLoading] = useState(false);

  useEffect(() => {
    const normalizedStoreId = String(storeId || '').trim();

    if (!normalizedStoreId) {
      setProductCsvTotalCount(null);
      setProductCsvCountLoading(false);
      return undefined;
    }

    let cancelled = false;

    const loadProductCsvTotalCount = async () => {
      setProductCsvCountLoading(true);

      try {
        const countSnapshot = await getCountFromServer(
          collection(db, 'stores', normalizedStoreId, 'products')
        );

        if (!cancelled) {
          setProductCsvTotalCount(countSnapshot.data().count || 0);
        }
      } catch (error) {
        console.error('[CsvExportWorkflowPanel] product count fetch failed', error);
        if (!cancelled) {
          setProductCsvTotalCount(null);
        }
      } finally {
        if (!cancelled) {
          setProductCsvCountLoading(false);
        }
      }
    };

    loadProductCsvTotalCount();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const handleExportSupplierCsv = () => {
    downloadCsvFile(
      `akuto-suppliers-export-${formatDateStamp()}.csv`,
      ['supplierId', 'name', 'kana', 'contactName', 'tel', 'email', 'paymentTerms', 'note', 'isActive'],
      buildSupplierExportRows(suppliers)
    );
  };

  const handleExportBrandCsv = () => {
    downloadCsvFile(
      `akuto-brands-export-${formatDateStamp()}.csv`,
      ['brandId', 'brandCode', 'brandName', 'kana', 'note', 'isActive', 'supplierId', 'supplierName'],
      buildBrandExportRows(brands, suppliers)
    );
  };


  const handleExportCategoryCsv = () => {
    downloadCsvFile(
      `akuto-categories-export-${formatDateStamp()}.csv`,
      ['categoryGroupId', 'categoryGroupName', 'categoryId', 'categoryName', 'subCategoryId', 'subCategoryName', 'displayOrder', 'note', 'isActive'],
      buildCategoryExportRows(productCategories, productCategoryGroups, productSubCategories)
    );
  };

  const handleExportProductCsv = async () => {
    if (productCsvExporting) return;

    setProductCsvExporting(true);

    try {
      const [allProducts, allProductGroups] = await Promise.all([
        fetchAllStoreCollectionRows({
          storeId,
          collectionName: 'products',
          orderField: 'name'
        }),
        fetchAllStoreCollectionRows({
          storeId,
          collectionName: 'productGroups',
          orderField: 'name'
        })
      ]);

      downloadCsvFile(
        `akuto-products-export-${formatDateStamp()}.csv`,
        [
          'productGroupId',
          'productGroupName',
          'productCode',
          'sku',
          'barcode',
          'productName',
          'name',
          'brandName',
          'supplierName',
          'categoryGroupId',
          'categoryGroupName',
          'categoryId',
          'categoryName',
          'subCategoryId',
          'subCategoryName',
          'salesAreaId',
          'salesAreaName',
          'colorName',
          'size',
          'priceTaxExcluded',
          'priceTaxIncluded',
          'taxRate',
          'inventoryQuantity',
          'shopifyCreateEnabled'
        ],
        buildProductExportRows({
          products: allProducts.length ? allProducts : products,
          productGroups: allProductGroups.length ? allProductGroups : productGroups,
          brands,
          suppliers,
          categories: productCategories,
          categoryGroups: productCategoryGroups,
          subCategories: productSubCategories
        })
      );
    } catch (error) {
      console.error('[CsvExportWorkflowPanel] product CSV export failed', error);
      window.alert('商品CSV出力に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setProductCsvExporting(false);
    }
  };

  const exportCards = [
    {
      id: 'suppliers',
      title: '仕入先CSV出力',
      description: '仕入先CSV取込と同じ項目で出力します。',
      meta: 'supplierId / name',
      count: suppliers.length,
      onClick: handleExportSupplierCsv
    },
    {
      id: 'brands',
      title: 'ブランドCSV出力',
      description: 'ブランドCSV取込と同じ項目で出力します。仕入先紐付け列を含みます。',
      meta: 'supplierId / supplierName',
      count: brands.length,
      onClick: handleExportBrandCsv
    },
    {
      id: 'categories',
      title: 'カテゴリー階層CSV出力',
      description: 'カテゴリーグループ・カテゴリー・サブカテゴリーを1本のCSVで出力します。',
      meta: 'categoryGroupName / categoryName / subCategoryName',
      count: productCategories.length + productSubCategories.length,
      onClick: handleExportCategoryCsv
    },
    {
      id: 'products',
      title: '商品CSV出力',
      description: '商品CSV取込と同じ項目で出力します。商品側仕入先が空の場合はブランド仕入先名を補完します。',
      meta: 'barcode / brandName / supplierName',
      count: productCsvTotalCount ?? products.length,
      countLoading: productCsvCountLoading,
      countLabel: '出力対象',
      onClick: handleExportProductCsv,
      primary: true
    }
  ];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-400">CSV Export</p>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">CSV出力</h2>
        <p className="text-sm leading-relaxed text-slate-500">
          取込と同じ項目で現在のマスターをCSV出力します。カテゴリー階層CSVはカテゴリーグループ・カテゴリー・サブカテゴリーを1本にまとめ、商品CSVは仕入先が商品側に無い場合にブランド側の仕入先名を補完します。
        </p>
      </div>

      <div data-csv-export-panel className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {exportCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={card.onClick}
            disabled={card.id === 'products' && productCsvExporting}
            className={[
              'rounded-2xl border p-4 text-left transition',
              card.primary
                ? 'border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            ].join(' ')}
          >
            <div className={card.primary ? 'text-sm font-black text-blue-700' : 'text-sm font-black text-slate-800'}>
              {card.id === 'products' && productCsvExporting ? '商品CSV出力中...' : card.title}
            </div>
            <div className={card.primary ? 'mt-1 text-xs text-blue-500' : 'mt-1 text-xs text-slate-400'}>
              {card.meta}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">{card.description}</p>
            <div className="mt-3 text-xs font-bold text-slate-400">
              {card.countLoading
                ? `${card.countLabel || '現在'} 読み込み中...`
                : `${card.countLabel || '現在'} ${Number(card.count || 0).toLocaleString()} 件`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};


export const StoreSettings = ({
  storeId,
  initialSettingsMode = 'order',
  posProductKeyword = '',
  onPosProductKeywordChange,
  onPosSettingsSubTabChange
}) => {
  const { logout, role, currentUser, profileName } = useAuth();
  const { settings, updateSettings, loading: settingsLoading } = useStoreSettings(storeId);
  const [taxPriceSettingsForProducts, setTaxPriceSettingsForProducts] = useState(() => mergeTaxPriceSettings());
  const {
    settings: businessSettings,
    updateSettings: updateBusinessSettings,
    loading: businessLoading
  } = useBusinessSettings(storeId);
  const { menuItems, loading: menuLoading, updateMenu, deleteMenu } = useMenuData(storeId);
  const productMaster = useProductMasterData(storeId);
  useEffect(() => {
    if (!storeId) {
      setTaxPriceSettingsForProducts(mergeTaxPriceSettings());
      return undefined;
    }

    const taxPriceRef = doc(db, 'stores', storeId, 'settings', 'taxPrice');

    return onSnapshot(
      taxPriceRef,
      (snapshot) => {
        setTaxPriceSettingsForProducts(mergeTaxPriceSettings(snapshot.exists() ? snapshot.data() : {}));
      },
      (error) => {
        console.error('[tax price settings for product master subscription error]', error);
        setTaxPriceSettingsForProducts(mergeTaxPriceSettings());
      }
    );
  }, [storeId]);

  const { discounts, loading: discountsLoading, saveDiscount, deleteDiscount } = useDiscountData(storeId);
  const { layoutItems, saveLayout, loading: layoutLoading } = useFloorLayout(storeId);
  const { categories, loading: categoryLoading, updateCategories } = useCategoryData(storeId);
  const { periods, loading: periodLoading, updatePeriods } = usePeriodData(storeId);
  const {
    cookingCategories,
    loading: cookingCategoryLoading,
    updateCookingCategories
  } = useCookingCategoryData(storeId);

  const [settingsMode, setSettingsMode] = useState(initialSettingsMode === 'pos' ? 'pos' : 'order');
  const [activeRegisterContext, setActiveRegisterContextState] = useState(() => getActiveRegisterContext(storeId, settings?.registers, settings?.departments));

  useEffect(() => {
    setSettingsMode(initialSettingsMode === 'pos' ? 'pos' : 'order');
  }, [initialSettingsMode]);

  useEffect(() => {
    setActiveRegisterContextState(syncActiveRegisterName(storeId, settings?.registers, settings?.departments));
  }, [storeId, settings?.registers, settings?.departments]);

  const [subTab, setSubTab] = useState(() => getDefaultSettingsSubTab(role) || 'menu');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [saveCompleteVisible, setSaveCompleteVisible] = useState(false);

  const showSaveComplete = () => {
    setSaveCompleteVisible(true);
    window.setTimeout(() => {
      setSaveCompleteVisible(false);
    }, 1100);
  };

  const [tableCount, setTableCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [ownerGuideDismissedOverride, setOwnerGuideDismissedOverride] = useState(false);

  const normalizedRole = normalizeUserRole(role);
  const isOwner = normalizedRole === USER_ROLES.OWNER;
  const ownerSetupDataLoading =
    settingsLoading ||
    businessLoading ||
    menuLoading ||
    discountsLoading ||
    categoryLoading ||
    periodLoading ||
    layoutLoading ||
    cookingCategoryLoading ||
    productMaster.loading;

  const ownerGuideDismissed = useMemo(
    () =>
      ownerGuideDismissedOverride ||
      (Boolean(storeId) &&
        isOwner &&
        safeStorage.getItem(`owner-setup-guide-dismissed:${storeId}`) === '1'),
    [isOwner, ownerGuideDismissedOverride, storeId]
  );

  useEffect(() => {
    if (!storeId || !isOwner) return undefined;

    const tablesUnsubscribe = onSnapshot(collection(db, 'stores', storeId, 'tables'), (snapshot) => {
      const generatedCount = snapshot.docs.filter((tableDoc) =>
        Boolean(tableDoc.data()?.tableTokenHash)
      ).length;
      setTableCount(generatedCount);
    });

    const membersUnsubscribe = onSnapshot(
      query(collection(db, 'users'), where('storeId', '==', storeId)),
      (snapshot) => setMemberCount(snapshot.size)
    );

    return () => {
      tablesUnsubscribe();
      membersUnsubscribe();
    };
  }, [isOwner, storeId]);

  const isKitchenOnlySettingsItem = (item) => {
    const id = String(item?.id || '').toLowerCase();
    const label = String(item?.label || '');
    const desc = String(item?.desc || '');
    return id.includes('kitchen') || label.includes('キッチン') || desc.includes('キッチン');
  };

  const availableMenuItems = useMemo(
    () => SETTINGS_MENU_ITEMS.filter((item) => (
      canAccessSettingsSection(normalizedRole, item.id)
      && !(settingsMode === 'pos' && isKitchenOnlySettingsItem(item))
      && (item.mode === settingsMode || item.mode === 'shared')
    )),
    [normalizedRole, settingsMode]
  );

  const groupedMenuItems = useMemo(
    () => groupSettingsMenuItems(availableMenuItems),
    [availableMenuItems]
  );

  const activeSubTab = availableMenuItems.some((item) => item.id === subTab)
    ? subTab
    : availableMenuItems[0]?.id;

  useEffect(() => {
    if (typeof onPosSettingsSubTabChange !== 'function') return;
    onPosSettingsSubTabChange(settingsMode === 'pos' ? activeSubTab : null);
  }, [activeSubTab, onPosSettingsSubTabChange, settingsMode]);

  const activeSettingsModeMeta = SETTINGS_MODE_ITEMS.find((item) => item.id === settingsMode) || SETTINGS_MODE_ITEMS[0];
  const activeMenuItem = availableMenuItems.find((item) => item.id === activeSubTab);
  const settingsActiveClassName = settingsMode === 'pos'
    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
    : 'bg-orange-500 text-white shadow-lg shadow-orange-500/20';
  const settingsActiveTextClassName = settingsMode === 'pos'
    ? 'text-blue-400'
    : 'text-orange-400';

  useEffect(() => {
    if (!activeSubTab && availableMenuItems[0]?.id) {
      setSubTab(availableMenuItems[0].id);
    }
  }, [activeSubTab, availableMenuItems]);

  const ownerSetupSteps = useMemo(() => {
    if (!isOwner) return [];

    return buildOwnerSetupSteps({
      settings,
      businessSettings,
      categories,
      menuItems,
      tableCount,
      layoutItems,
      periods,
      discounts,
      memberCount
    });
  }, [
    businessSettings,
    categories,
    discounts,
    isOwner,
    layoutItems,
    memberCount,
    menuItems,
    periods,
    settings,
    tableCount
  ]);

  const shouldShowOwnerSetupGuide = settingsMode === 'order';

  const isOwnerGuideModalOpen = useMemo(() => {
    if (
      !shouldShowOwnerSetupGuide ||
      !isOwner ||
      !storeId ||
      ownerGuideDismissed ||
      ownerSetupSteps.length === 0 ||
      ownerSetupDataLoading
    ) {
      return false;
    }

    return ownerSetupSteps.some((step) => !step.isComplete);
  }, [
    isOwner,
    ownerGuideDismissed,
    ownerSetupDataLoading,
    ownerSetupSteps,
    shouldShowOwnerSetupGuide,
    storeId
  ]);

  const handleOwnerGuideClose = () => {
    if (storeId) safeStorage.setItem(`owner-setup-guide-dismissed:${storeId}`, '1');
    setOwnerGuideDismissedOverride(true);
  };

  const handleOwnerGuideSelect = (nextTab) => {
    setSubTab(nextTab === 'business' || nextTab === 'period' ? 'time' : nextTab);
    handleOwnerGuideClose();
  };

  return (
    <div className="fixed inset-0 z-0 flex bg-gray-50 font-sans text-gray-800">
      <SaveCompleteOverlay show={saveCompleteVisible} />

      {toast.show && (
        <NotificationToast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast((current) => ({ ...current, show: false }))}
        />
      )}

      <aside className="flex h-full w-64 flex-shrink-0 flex-col bg-slate-900 text-white shadow-2xl">
        <div className="h-[1.8cm] w-full flex-shrink-0 bg-slate-900" />

        <nav className="scrollbar-none flex-1 space-y-2 overflow-y-auto border-t border-slate-800/50 px-4 py-5">
          <div className="mb-4 rounded-[1.35rem] border border-slate-800 bg-slate-950/40 p-4">
            <div className="text-[10px] font-black tracking-widest text-slate-500">使用レジ</div>
            <div className="mt-2 truncate text-lg font-black tracking-tight text-white">
              {activeRegisterContext?.name || 'レジ1'}
            </div>
            <div className="mt-1 text-[10px] font-bold leading-relaxed text-slate-500">
              基本設定で変更できます。
            </div>
          </div>

          {false && settingsMode === 'pos' && (
            <div className="mb-3 px-2">
              <span className="text-[10px] font-black tracking-widest text-slate-500">{activeSettingsModeMeta.title}</span>
              <div className="mt-1 text-xs font-bold text-slate-600">{activeSettingsModeMeta.desc}</div>
            </div>
          )}

          {settingsMode === 'order' ? (
            availableMenuItems.map((item) => {
              const isActive = activeSubTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSubTab(item.id)}
                  className={`group relative flex w-full items-center gap-4 rounded-2xl px-4 py-4 transition-all duration-300 ${
                    isActive ? settingsActiveClassName : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                  title={item.desc}
                >
                  <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="flex-1 text-left text-sm font-bold">{item.label}</span>
                  {isActive && <ChevronRight size={16} className="animate-pulse text-white/50" />}
                </button>
              );
            })
          ) : (
            availableMenuItems.map((item) => {
              const isActive = activeSubTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSubTab(item.id)}
                  className={`group relative flex w-full items-center gap-4 rounded-2xl px-4 py-4 transition-all duration-300 ${
                    isActive ? settingsActiveClassName : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                  title={item.desc}
                >
                  <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="flex-1 text-left text-sm font-bold">{item.label}</span>
                  {isActive && <ChevronRight size={16} className="animate-pulse text-white/50" />}
                </button>
              );
            })
          )}
        </nav>

        <div className="mt-auto flex-shrink-0 border-t border-slate-800/50 bg-slate-900 p-4">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="group flex w-full items-center gap-3 rounded-2xl border border-transparent px-4 py-4 text-slate-400 transition-all duration-300 hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut size={20} className="transition-transform group-hover:-translate-x-1" />
            <span className="text-sm font-bold">ログアウト</span>
          </button>
        </div>
      </aside>

      <main className="h-full flex-1 overflow-y-auto scroll-smooth bg-gray-50/50">
        <div className="h-[2cm] w-full flex-shrink-0" />

        <div className={`${activeSubTab === 'products' ? 'w-full max-w-none' : 'max-w-[1400px]'} p-8 pb-32 lg:p-12`}>
          {shouldShowOwnerSetupGuide && isOwner && !ownerSetupDataLoading && ownerSetupSteps.some((step) => !step.isComplete) && (
            <OwnerSetupGuide
              ownerName={profileName}
              steps={ownerSetupSteps}
              onSelectStep={handleOwnerGuideSelect}
              isModalOpen={isOwnerGuideModalOpen}
              onCloseModal={handleOwnerGuideClose}
            />
          )}

          {activeSubTab === 'taxPrice' && canAccessSettingsSection(normalizedRole, 'basic') && (
            <TaxPriceSettings
              storeId={storeId}
              onSaved={showSaveComplete}
            />
          )}

          {activeSubTab === 'basic' && canAccessSettingsSection(normalizedRole, 'basic') && (
            <BasicSettings
              settings={settings}
              onSave={updateSettings}
              onSaved={showSaveComplete}
              storeId={storeId}
              cookingCategories={cookingCategories}
              onSaveCookingCategories={updateCookingCategories}
            />
          )}

          {activeSubTab === 'time' && (
            canAccessSettingsSection(normalizedRole, 'business')
            || canAccessSettingsSection(normalizedRole, 'period')
          ) && (
            <TimeSettings
              periods={periods || []}
              menuItems={menuItems || []}
              periodLoading={periodLoading}
              onSavePeriods={updatePeriods}
              businessSettings={businessSettings}
              updateBusinessSettings={updateBusinessSettings}
              onSaved={showSaveComplete}
            />
          )}

          {activeSubTab === 'category' && canAccessSettingsSection(normalizedRole, 'category') && (
          <CategorySettings
            categories={categories || []}
            menuItems={menuItems || []}
            loading={categoryLoading}
            onSave={updateCategories}
            onSaved={showSaveComplete}
          />
          )}

          {activeSubTab === 'crossSell' && canAccessSettingsSection(normalizedRole, 'crossSell') && (
          <CrossSellSettings
            storeId={storeId}
            categories={categories || []}
            menuItems={menuItems || []}
            onSaved={showSaveComplete}
          />
          )}

          {activeSubTab === 'products' && canAccessSettingsSection(normalizedRole, 'products') && (
            <ProductMasterSettings
              storeId={storeId}
              products={productMaster.products}
              productCategories={productMaster.productCategories}
              productCategoryGroups={productMaster.productCategoryGroups}
              productSubCategories={productMaster.productSubCategories || []}
              productSalesAreas={productMaster.productSalesAreas || []}
              brands={productMaster.brands}
              suppliers={productMaster.suppliers}
              loading={productMaster.loading}
              onSaveProduct={productMaster.saveProduct}
              onDeleteProduct={productMaster.deleteProduct}
              onCreateShopifyDraftProduct={productMaster.createShopifyDraftProduct}
              onUpdateShopifyProduct={productMaster.updateShopifyProduct}
              onSaveCategory={productMaster.saveCategory}
              onDeleteCategory={productMaster.deleteCategory}
              onSaveCategoryGroup={productMaster.saveCategoryGroup}
              onDeleteCategoryGroup={productMaster.deleteCategoryGroup}
              onSaveSubCategory={productMaster.saveSubCategory}
              onDeleteSubCategory={productMaster.deleteSubCategory}
              onSaveBrand={productMaster.saveBrand}
              onDeleteBrand={productMaster.deleteBrand}
              onSaveSupplier={productMaster.saveSupplier}
              onDeleteSupplier={productMaster.deleteSupplier}
              onSaved={showSaveComplete}
              externalKeyword={posProductKeyword}
              onExternalKeywordChange={onPosProductKeywordChange}
              shopifySettings={productMaster?.shopifySettings}
              onSaveShopifySettings={productMaster?.saveShopifySettings}
              defaultTaxRate={taxPriceSettingsForProducts.defaultTaxRate}
            />
          )}

          {settingsMode === 'pos'
            && activeSubTab !== 'products'
            && activeMenuItem
            && activeMenuItem.mode === 'pos'
            && !isKitchenOnlySettingsItem(activeMenuItem)
            && canAccessSettingsSection(normalizedRole, activeMenuItem.id) && (
              <PosDummyTabbedPage
                item={activeMenuItem}
                productMaster={productMaster}
                storeId={storeId}
                onSaved={showSaveComplete}
              />
            )}



          {activeSubTab === 'menu' && canAccessSettingsSection(normalizedRole, 'menu') && (
            <MenuSettings
              menuItems={menuItems || []}
              kitchens={settings?.kitchens || []}
              basicSettings={settings}
              cookingCategories={cookingCategories}
              loading={menuLoading}
              onSave={updateMenu}
              onDelete={deleteMenu}
              storeId={storeId}
              onSaved={showSaveComplete}
            />
          )}

          {activeSubTab === 'discount' && canAccessSettingsSection(normalizedRole, 'discount') && (
            <DiscountSettings
              discounts={discounts}
              loading={discountsLoading}
              onSave={saveDiscount}
              onDelete={deleteDiscount}
              onSaved={showSaveComplete}
            />
          )}

          {activeSubTab === 'staff' && canAccessSettingsSection(normalizedRole, 'staff') && (
            <StaffInviteSettings storeId={storeId} ownerUser={currentUser} />
          )}

          {activeSubTab === 'layout' && canAccessSettingsSection(normalizedRole, 'layout') && (
            <div className="flex h-[calc(100vh-11rem)] min-h-[640px] w-full flex-col">
              <FloorMapSettings layoutItems={layoutItems} onSave={saveLayout} />
            </div>
          )}

          {activeSubTab === 'qrcode' && canAccessSettingsSection(normalizedRole, 'qrcode') && (
            <QRGenerator storeId={storeId} />
          )}
        </div>
      </main>

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] bg-white p-10 text-center shadow-2xl animate-in zoom-in-95">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertCircle size={40} className="text-red-500" />
            </div>
            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">ログアウトしますか？</h3>
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

export default StoreSettings;
