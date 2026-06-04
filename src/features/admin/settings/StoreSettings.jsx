import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckSquare,
  ChevronRight,
  Clock,
  Layout,
  LogOut,
  Percent,
  QrCode,
  ScanLine,
  Store,
  Tag,
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
import ProductMasterSettings from '../../products/components/ProductMasterSettings';

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
  { id: 'menu', mode: 'order', label: 'メニュー設定', icon: Utensils, desc: '商品と表示内容の編集' },
  { id: 'category', mode: 'order', label: 'カテゴリー設定', icon: Tag, desc: 'メニューカテゴリの追加と並び順' },
  {
    id: 'crossSell',
    mode: 'order',
    label: 'クロスセル設定',
    icon: Sparkles,
    desc: 'セットドリンクやデザートの提案導線を設定します'
  },
  { id: 'qrcode', mode: 'order', label: 'QRコード発行', icon: QrCode, desc: 'テーブルに貼るQRコードを発行' },
  { id: 'time', mode: 'order', label: '時間帯設定', icon: Clock, desc: '提供時間帯と営業時間の設定' },
  { id: 'layout', mode: 'order', label: 'テーブル設定', icon: Layout, desc: 'テーブルIDと配置の編集' },
  { id: 'discount', mode: 'order', label: '割引設定', icon: Percent, desc: '割引ルールの追加' },

  { id: 'products', mode: 'pos', label: '商品マスター', icon: Package, desc: '物販商品・カテゴリー・ブランド・仕入先' },

  { id: 'staff', mode: 'shared', label: 'スタッフ招待', icon: Users, desc: 'スタッフの招待と確認' },
  { id: 'basic', mode: 'shared', label: '基本設定', icon: Store, desc: '店舗名や連絡先などの基本情報' }
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

export const StoreSettings = ({ storeId, initialSettingsMode = 'order' }) => {
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

  const availableMenuItems = useMemo(
    () => SETTINGS_MENU_ITEMS.filter((item) => (
      canAccessSettingsSection(normalizedRole, item.id)
      && (item.mode === settingsMode || item.mode === 'shared')
    )),
    [normalizedRole, settingsMode]
  );

  const activeSubTab = availableMenuItems.some((item) => item.id === subTab)
    ? subTab
    : availableMenuItems[0]?.id;

  const activeSettingsModeMeta = SETTINGS_MODE_ITEMS.find((item) => item.id === settingsMode) || SETTINGS_MODE_ITEMS[0];
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

  const isOwnerGuideModalOpen = useMemo(() => {
    if (!isOwner || !storeId || ownerGuideDismissed || ownerSetupSteps.length === 0 || ownerSetupDataLoading) {
      return false;
    }

    return ownerSetupSteps.some((step) => !step.isComplete);
  }, [isOwner, ownerGuideDismissed, ownerSetupDataLoading, ownerSetupSteps, storeId]);

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

      <aside className="flex h-full w-72 flex-shrink-0 flex-col bg-slate-900 text-white shadow-2xl">
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

          <div className="mb-3 px-2">
            <span className="text-[10px] font-black tracking-widest text-slate-500">{activeSettingsModeMeta.title}</span>
            <div className="mt-1 text-xs font-bold text-slate-600">{activeSettingsModeMeta.desc}</div>
          </div>

          {availableMenuItems.map((item) => {
            const isActive = activeSubTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSubTab(item.id)}
                className={`group relative flex w-full items-center gap-4 rounded-2xl px-4 py-4 transition-all duration-300 ${
                  isActive ? settingsActiveClassName : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                <span className="flex-1 text-left text-sm font-bold">{item.label}</span>
                {isActive && <ChevronRight size={16} className="animate-pulse text-white/50" />}
              </button>
            );
          })}
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
          {isOwner && !ownerSetupDataLoading && ownerSetupSteps.some((step) => !step.isComplete) && (
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
              brands={productMaster.brands}
              suppliers={productMaster.suppliers}
              loading={productMaster.loading}
              onSaveProduct={productMaster.saveProduct}
              onDeleteProduct={productMaster.deleteProduct}
              onSaveCategory={productMaster.saveCategory}
              onDeleteCategory={productMaster.deleteCategory}
              onSaveCategoryGroup={productMaster.saveCategoryGroup}
              onDeleteCategoryGroup={productMaster.deleteCategoryGroup}
              onSaveBrand={productMaster.saveBrand}
              onDeleteBrand={productMaster.deleteBrand}
              onSaveSupplier={productMaster.saveSupplier}
              onDeleteSupplier={productMaster.deleteSupplier}
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
