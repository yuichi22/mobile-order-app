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
import { collection, onSnapshot, query, where } from 'firebase/firestore';
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
  }
};


const CsvImportStepCard = ({
  number,
  title,
  description,
  status = '準備中',
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
      <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-black text-blue-600">
        {status}
      </span>
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

const CsvImportWorkflowPanel = ({
  productMaster,
  onSaved
}) => (
  <div className="space-y-5">
    <div className="rounded-[2rem] border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-400">CSV Import Workflow</p>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">CSV取込の順番</h2>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-relaxed text-slate-500">
        商品CSVを正しく紐づけるために、先に補助マスターを登録します。推奨順は、仕入先 → ブランド → カテゴリーグループ/カテゴリー → 商品です。
      </p>
    </div>

    <CsvImportStepCard
      number="01"
      title="仕入先CSV取込"
      description="スマレジや既存台帳の仕入先情報を、Akuto POSの仕入先マスターへ取り込みます。"
      status="実装済み"
    >
      <MasterCsvImportPanel
        type="suppliers"
        suppliers={productMaster?.suppliers || []}
        brands={productMaster?.brands || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        onSaveSupplier={productMaster?.saveSupplier}
        onSaveBrand={productMaster?.saveBrand}
        onSaveCategory={productMaster?.saveCategory}
        onSaveCategoryGroup={productMaster?.saveCategoryGroup}
        onSaved={onSaved}
      />
    </CsvImportStepCard>

    <CsvImportStepCard
      number="02"
      title="ブランドCSV取込"
      description="ブランド情報をAkuto POSのブランドマスターへ取り込みます。仕入先ID/仕入先名があれば既存仕入先に紐づけます。"
      status="実装済み"
    >
      <MasterCsvImportPanel
        type="brands"
        suppliers={productMaster?.suppliers || []}
        brands={productMaster?.brands || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        onSaveSupplier={productMaster?.saveSupplier}
        onSaveBrand={productMaster?.saveBrand}
        onSaveCategory={productMaster?.saveCategory}
        onSaveCategoryGroup={productMaster?.saveCategoryGroup}
        onSaved={onSaved}
      />
    </CsvImportStepCard>

    <CsvImportStepCard
      number="03"
      title="カテゴリー / カテゴリーグループCSV取込"
      description="スマレジの部門・部門グループを、Akuto POSのカテゴリー・カテゴリーグループとして取り込みます。"
      status="実装済み"
    >
      <MasterCsvImportPanel
        type="categories"
        suppliers={productMaster?.suppliers || []}
        brands={productMaster?.brands || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        onSaveSupplier={productMaster?.saveSupplier}
        onSaveBrand={productMaster?.saveBrand}
        onSaveCategory={productMaster?.saveCategory}
        onSaveCategoryGroup={productMaster?.saveCategoryGroup}
        onSaved={onSaved}
      />
    </CsvImportStepCard>

    <CsvImportStepCard
      number="04"
      title="商品CSV取込"
      description="補助マスター登録後に商品を取り込みます。仕入先・ブランド・カテゴリーは名前一致でID紐づけします。"
      status="実装済み"
    >
      <ProductCsvImportPanel
        products={productMaster?.products || []}
        productCategories={productMaster?.productCategories || []}
        productCategoryGroups={productMaster?.productCategoryGroups || []}
        brands={productMaster?.brands || []}
        suppliers={productMaster?.suppliers || []}
        onSaveProduct={productMaster?.saveProduct}
        onSaveProductGroup={productMaster?.saveProductGroup}
        onSaved={onSaved}
      />
    </CsvImportStepCard>
  </div>
);


const PosDummyTabbedPage = ({ item, productMaster, onSaved }) => {
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
            productMaster={productMaster}
            onSaved={onSaved}
          />
        );
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
            { id: 'color', label: 'カラー' },
          ]}
          onSave={(payload) => {
            const matchedCategory = (productMaster?.productCategories || []).find((category) => category.id === payload.categoryId);
            const matchedGroup = (productMaster?.productCategoryGroups || []).find((group) => group.id === matchedCategory?.groupId);
            return productMaster?.saveSubCategory?.({
              ...payload,
              categoryName: matchedCategory?.name || payload.categoryName || '',
              categoryGroupId: matchedCategory?.groupId || payload.categoryGroupId || '',
              categoryGroupName: matchedGroup?.name || payload.categoryGroupName || '',
              groupId: matchedCategory?.groupId || payload.groupId || '',
              groupName: matchedGroup?.name || payload.groupName || '',
              subCategoryName: payload.name || payload.subCategoryName || ''
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

export const StoreSettings = ({
  storeId,
  initialSettingsMode = 'order',
  posProductKeyword = '',
  onPosProductKeywordChange,
  onPosSettingsSubTabChange
}) => {
  const { logout, role, currentUser, profileName } = useAuth();
  const { settings, updateSettings, loading: settingsLoading } = useStoreSettings(storeId);
  const {
    settings: businessSettings,
    updateSettings: updateBusinessSettings,
    loading: businessLoading
  } = useBusinessSettings(storeId);
  const { menuItems, loading: menuLoading, updateMenu, deleteMenu } = useMenuData(storeId);
  const productMaster = useProductMasterData(storeId);
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
              onSaveBrand={productMaster.saveBrand}
              onDeleteBrand={productMaster.deleteBrand}
              onSaveSupplier={productMaster.saveSupplier}
              onDeleteSupplier={productMaster.deleteSupplier}
              onSaved={showSaveComplete}
              externalKeyword={posProductKeyword}
              onExternalKeywordChange={onPosProductKeywordChange}
              shopifySettings={productMaster?.shopifySettings}
              onSaveShopifySettings={productMaster?.saveShopifySettings}
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
