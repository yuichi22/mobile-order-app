import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  BadgeJapaneseYen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  LockKeyhole,
  Printer,
  ReceiptText,
  TicketPercent,
  Users
} from 'lucide-react';

import { db } from '../../../shared/api/firebase/client';
import { useDailyTransactions } from '../Analytics/hooks/useDailyTransactions';
import {
  buildDailyClosingSummary,
  formatCurrency,
  formatDailyClosingDateKey,
  getPaymentMethodLabel
} from '../Analytics/utils/dailyClosingHelpers';
import DailyClosingCheckModal from './DailyClosingCheckModal';
import { useStoreSettings, usePeriodData } from '../../store/hooks';
import { printDailyClosingReceipt } from './printDailyClosingReceipt';
import { getAvailableRegisters, getActiveRegisterContext, getDepartmentById, getAvailableDepartments } from '../../pos/utils/registerContext';
import { buildItemDepartmentResolver, splitTransactionsByDepartment } from '../Analytics/utils/departmentAttribution';
import { buildItemSalesAreaResolver, buildSalesAreaSales } from '../Analytics/utils/salesAreaSales';

const toDateInputValue = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getJstDateInputValue = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(date);
};

const createDateFromInputValue = (value) => {
  if (!value) return new Date();

  const [year, month, day] = value.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day);
  nextDate.setHours(0, 0, 0, 0);

  return nextDate;
};

const AMOUNT_DISPLAY_STORAGE_KEY = 'dailyClosingAmountDisplayMode';

const getInitialAmountDisplayMode = () => {
  try {
    const savedMode = window.localStorage.getItem(AMOUNT_DISPLAY_STORAGE_KEY);
    return savedMode === 'tax_excluded' ? 'tax_excluded' : 'tax_included';
  } catch {
    return 'tax_included';
  }
};

// 締めデータに金種/カード/QR/クーポンいずれかの実査差額があるか。
// レジボタンや「このレジの売上」枠の色（差額なし=薄緑 / 差額あり=薄赤）判定に使う。
const closingHasDifference = (data) => {
  const cash = data?.cashCheck ? Number(data.cashCheck.difference || 0) : 0;
  const card = data?.externalPaymentCheck ? Number(data.externalPaymentCheck.cardDifference || 0) : 0;
  const qr = data?.externalPaymentCheck ? Number(data.externalPaymentCheck.qrDifference || 0) : 0;
  const coupon = data?.couponCheck ? Number(data.couponCheck.difference || 0) : 0;
  return cash !== 0 || card !== 0 || qr !== 0 || coupon !== 0;
};

// レジボタンの配色。
// 該当レジ(self): 未締め=黒 / 締め済み差額なし=薄緑 / 締め済み差額あり=薄赤。
// 他レジ:        未締め=薄グレー / 締め済み差額なし=薄緑 / 締め済み差額あり=薄赤。
const registerButtonColorClass = ({ closed, hasDifference, isSelf }) => {
  if (!closed) {
    return isSelf
      ? 'bg-gray-900 text-white hover:bg-black'
      : 'bg-slate-100 text-slate-400 hover:bg-slate-200';
  }
  return hasDifference
    ? 'bg-red-50 text-red-700 hover:bg-red-100'
    : 'bg-green-50 text-green-700 hover:bg-green-100';
};

const DailyClosingPanel = ({ storeId, targetDate, setTargetDate }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [closingStatus, setClosingStatus] = useState(null);
  const [closedDailyData, setClosedDailyData] = useState(null);
  const [changeFundAmount, setChangeFundAmount] = useState(0);
  const [isLoadingClosedDaily, setIsLoadingClosedDaily] = useState(false);
  const [isCheckModalOpen, setIsCheckModalOpen] = useState(false);
  const [amountDisplayMode, setAmountDisplayMode] = useState(getInitialAmountDisplayMode);
  // 日計は部門単位で表示。既定=自レジの部門、'all'=全体。
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('all');
  // 同一部門レジの締め状況 {registerId: true}。
  const [registerClosedMap, setRegisterClosedMap] = useState({});
  // 締め済みレジの差額有無 {registerId: hasDifference}。ボタン配色に使う。
  const [registerDiffMap, setRegisterDiffMap] = useState({});
  // 締めツールバーで表示対象に選んでいるレジ。既定=自レジ(activeRegister)。
  // 他レジを選ぶとそのレジの締め内容(サマリ・金種・状況)を閲覧表示する。
  const [selectedRegisterId, setSelectedRegisterId] = useState(null);
  // 選択中レジの締め保存内容(金種・クーポン・カード/QR実績)。締めモーダルの初期値に使う。
  const [selectedRegisterClosing, setSelectedRegisterClosing] = useState(null);
  const [closingReloadKey, setClosingReloadKey] = useState(0);
  // 部門振り分け・売り場集計用の商品カテゴリーマスター。
  const [productCategories, setProductCategories] = useState([]);
  const [productCategoryGroups, setProductCategoryGroups] = useState([]);
  const [productSalesAreas, setProductSalesAreas] = useState([]);

  const dateInputRef = useRef(null);
  const { settings } = useStoreSettings(storeId);

  // 釣り銭準備金はレジ単位で読み込む(activeRegister 定義後の effect で実行)。

  // 部門振り分け用に商品カテゴリー/グループを取得（当日中はほぼ不変なので一度だけ）。
  useEffect(() => {
    let cancelled = false;
    const loadCategoryMaster = async () => {
      if (!storeId) return;
      try {
        const [catSnap, groupSnap, areaSnap] = await Promise.all([
          getDocs(collection(db, 'stores', storeId, 'productCategories')),
          getDocs(collection(db, 'stores', storeId, 'productCategoryGroups')),
          getDocs(collection(db, 'stores', storeId, 'productSalesAreas'))
        ]);
        if (cancelled) return;
        setProductCategories(catSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setProductCategoryGroups(groupSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setProductSalesAreas(areaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to load category master:', error);
      }
    };
    loadCategoryMaster();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const { periods = [] } = usePeriodData(storeId);

  const { transactions, loading } = useDailyTransactions({
    storeId,
    targetDate
  });


  const registerOptions = useMemo(() => {
    return getAvailableRegisters(settings?.registers || [], settings?.departments || []);
  }, [settings?.registers, settings?.departments]);

  // この端末の登録レジ→所属部門。日計は既定でこの部門を表示し、締めはこのレジ単位で行う。
  const activeRegister = useMemo(
    () => getActiveRegisterContext(storeId, settings?.registers, settings?.departments),
    [storeId, settings?.registers, settings?.departments]
  );
  const activeDepartment = useMemo(
    () => getDepartmentById(activeRegister?.departmentId, settings?.departments),
    [activeRegister, settings?.departments]
  );
  const activeMode = activeDepartment?.registerMode || 'order';
  // 同一部門のレジ（締め状況の表示対象）。
  const departmentRegisters = useMemo(
    () => registerOptions.filter((register) => register.departmentId === activeDepartment?.id),
    [registerOptions, activeDepartment]
  );

  // 表示対象レジの正規化: 既定=自レジ。選択が同一部門外/未設定なら自レジへ戻す。
  useEffect(() => {
    const ownId = activeRegister?.id || null;
    setSelectedRegisterId((prev) => {
      if (prev && departmentRegisters.some((register) => register.id === prev)) return prev;
      return ownId;
    });
  }, [activeRegister?.id, departmentRegisters]);

  // 締めサマリ/締めデータ/釣り銭/締めモーダルは「選択中レジ」基準で読み書きする。
  const selectedRegister = useMemo(
    () => departmentRegisters.find((register) => register.id === selectedRegisterId) || activeRegister,
    [departmentRegisters, selectedRegisterId, activeRegister]
  );
  // 選択中レジが自レジ（端末の登録レジ）か。締め実行・修正は自レジの時だけ許可する。
  const isSelectedOwnRegister = (selectedRegister?.id || null) === (activeRegister?.id || null);

  const departmentOptions = useMemo(
    () => getAvailableDepartments(settings?.departments || []),
    [settings?.departments]
  );
  const selectedDepartment = useMemo(
    () => departmentOptions.find((dept) => dept.id === selectedDepartmentId) || null,
    [departmentOptions, selectedDepartmentId]
  );

  // 既定表示を自部門に一度だけ寄せる。
  const didInitDeptFilter = useRef(false);
  useEffect(() => {
    if (didInitDeptFilter.current) return;
    if (!settings?.departments && !settings?.registers) return;
    didInitDeptFilter.current = true;
    setSelectedDepartmentId(activeDepartment?.id || 'all');
  }, [activeDepartment, settings?.departments, settings?.registers]);

  // 釣り銭準備金は「レジ単位」で保持する(settings/dailyClosing の changeFundByRegister)。
  // 旧来は店舗共通の changeFundAmount だったため他レジに引っ張られていた。
  // 自レジの値が未設定なら、移行用に旧共通値を初期値として表示する。
  useEffect(() => {
    let cancelled = false;
    const loadChangeFund = async () => {
      if (!storeId) return;
      try {
        const settingsRef = doc(db, 'stores', storeId, 'settings', 'dailyClosing');
        const settingsSnapshot = await getDoc(settingsRef);
        if (cancelled || !settingsSnapshot.exists()) return;
        const data = settingsSnapshot.data() || {};
        const registerId = String(selectedRegister?.id || '');
        const byRegister = data.changeFundByRegister || {};
        const amount = registerId && byRegister[registerId] !== undefined
          ? Number(byRegister[registerId] || 0)
          : Number(data.changeFundAmount || 0);
        setChangeFundAmount(amount);
      } catch (error) {
        console.error('Failed to load change fund:', error);
      }
    };
    loadChangeFund();
    return () => { cancelled = true; };
  }, [storeId, selectedRegister?.id, closingReloadKey]);

  // 商品カテゴリーの所属部門でアイテム単位に振り分けるリゾルバ。
  const resolveItemDepartment = useMemo(
    () => buildItemDepartmentResolver({
      productCategories,
      productCategoryGroups,
      departments: settings?.departments || []
    }),
    [productCategories, productCategoryGroups, settings?.departments]
  );

  // 取引を部門スライスに展開（混在会計はアイテムごとに部門へ分割）。
  const departmentSlices = useMemo(
    () => splitTransactionsByDepartment(transactions, resolveItemDepartment),
    [transactions, resolveItemDepartment]
  );

  // 売り場別売上(POS物販)用のアイテム→売り場リゾルバ。
  const resolveItemSalesArea = useMemo(
    () => buildItemSalesAreaResolver({
      salesAreas: productSalesAreas,
      productCategories,
      productCategoryGroups
    }),
    [productSalesAreas, productCategories, productCategoryGroups]
  );

  // 表示中の部門で絞り込んだスライス（'all'は全スライス）。
  const filteredTransactions = useMemo(() => {
    if (selectedDepartmentId === 'all') return departmentSlices;
    return departmentSlices.filter((slice) => String(slice?.departmentId || '') === selectedDepartmentId);
  }, [departmentSlices, selectedDepartmentId]);

  // 件数表示用に元取引のユニーク件数を数える（混在会計のスライス重複を除く）。
  const filteredTransactionCount = useMemo(() => {
    const ids = new Set();
    filteredTransactions.forEach((slice, index) => ids.add(slice?.id ?? slice?.transactionId ?? index));
    return ids.size;
  }, [filteredTransactions]);


  const dateKey = useMemo(() => formatDailyClosingDateKey(targetDate), [targetDate]);
  const todayDateValue = useMemo(() => getJstDateInputValue(), []);
  const targetDateValue = useMemo(() => toDateInputValue(targetDate), [targetDate]);
  const isTargetDateToday = targetDateValue === todayDateValue;

  const shiftDailyClosingDate = (days) => {
    const baseValue = targetDateValue || todayDateValue;
    const baseDate = new Date(`${baseValue}T00:00:00+09:00`);
    if (Number.isNaN(baseDate.getTime())) return;

    baseDate.setDate(baseDate.getDate() + days);
    const nextValue = getJstDateInputValue(baseDate);
    if (nextValue > todayDateValue) return;

    setTargetDate(new Date(`${nextValue}T00:00:00+09:00`));
    setClosingStatus(null);
  };

  const summary = useMemo(
    () => buildDailyClosingSummary(filteredTransactions, periods),
    [filteredTransactions, periods]
  );

  // 締めは「選択中レジ」単位。締めモーダル/レジ別締めデータは選択中レジの取引のみで集計する。
  const registerTransactions = useMemo(
    () => transactions.filter((transaction) => String(transaction.registerId || '') === String(selectedRegister?.id || '')),
    [transactions, selectedRegister]
  );
  const registerSummary = useMemo(
    () => buildDailyClosingSummary(registerTransactions, periods),
    [registerTransactions, periods]
  );
  // 既存の日付単位の締め(分析互換)は全日集計で保持する。
  const fullDaySummary = useMemo(
    () => buildDailyClosingSummary(transactions, periods),
    [transactions, periods]
  );

  // レジ別締め状況を読み込む（dailyClosings/{date}/registers/{registerId}）。
  useEffect(() => {
    if (!storeId || !dateKey) {
      setRegisterClosedMap({});
      setRegisterDiffMap({});
      setSelectedRegisterClosing(null);
      return undefined;
    }
    let active = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'stores', storeId, 'dailyClosings', dateKey, 'registers'));
        if (!active) return;
        const map = {};
        const diffMap = {};
        const rid = String(selectedRegister?.id || '');
        let selected = null;
        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          if (data.status === 'closed') {
            map[docSnap.id] = true;
            diffMap[docSnap.id] = closingHasDifference(data);
          }
          if (rid && docSnap.id === rid) selected = { id: docSnap.id, ...data };
        });
        setRegisterClosedMap(map);
        setRegisterDiffMap(diffMap);
        setSelectedRegisterClosing(selected);
      } catch (error) {
        console.error('Failed to load register closings:', error);
        if (active) { setRegisterClosedMap({}); setRegisterDiffMap({}); setSelectedRegisterClosing(null); }
      }
    })();
    return () => { active = false; };
  }, [storeId, dateKey, selectedRegister?.id, closingReloadKey]);

  useEffect(() => {
    if (!storeId || !dateKey) {
      setClosedDailyData(null);
      setClosingStatus(null);
      return undefined;
    }

    let isMounted = true;

    const loadClosedDaily = async () => {
      setIsLoadingClosedDaily(true);

      try {
        const closingRef = doc(db, 'stores', storeId, 'dailyClosings', dateKey);
        const closingSnapshot = await getDoc(closingRef);

        if (!isMounted) return;

        if (closingSnapshot.exists() && closingSnapshot.data()?.status === 'closed') {
          setClosedDailyData({
            id: closingSnapshot.id,
            ...closingSnapshot.data()
          });
          setClosingStatus('closed');
        } else {
          setClosedDailyData(null);
          setClosingStatus(null);
        }
      } catch (error) {
        console.error('Failed to load daily closing:', error);
        if (isMounted) {
          setClosedDailyData(null);
          setClosingStatus(null);
        }
      } finally {
        if (isMounted) {
          setIsLoadingClosedDaily(false);
        }
      }
    };

    loadClosedDaily();

    return () => {
      isMounted = false;
    };
  }, [storeId, dateKey]);

  const averageSpendPerCustomerTaxIncluded = Number(summary?.customerCount || 0) > 0
    ? Math.round(Number(summary?.totalSales || 0) / Number(summary?.customerCount || 0))
    : 0;

  const averageSpendPerCustomerTaxExcluded = Number(summary?.customerCount || 0) > 0
    ? Math.round(Number(summary?.totalSalesTaxExcluded || 0) / Number(summary?.customerCount || 0))
    : 0;

  const isTaxExcludedMain = amountDisplayMode === 'tax_excluded';
  const amountDisplayLabel = isTaxExcludedMain ? '税抜' : '税込';

  const updateAmountDisplayMode = (nextMode) => {
    const normalizedMode = nextMode === 'tax_excluded' ? 'tax_excluded' : 'tax_included';
    setAmountDisplayMode(normalizedMode);

    try {
      window.localStorage.setItem(AMOUNT_DISPLAY_STORAGE_KEY, normalizedMode);
    } catch {
      // localStorage が使えない環境では、その画面内だけの切り替えにする。
    }
  };

  const resolveMainAmount = (taxIncludedAmount, taxExcludedAmount) => (
    isTaxExcludedMain ? taxExcludedAmount : taxIncludedAmount
  );

  const resolveSubAmount = (taxIncludedAmount, taxExcludedAmount) => (
    isTaxExcludedMain
      ? `税込 ${formatCurrency(taxIncludedAmount)}`
      : `税抜 ${formatCurrency(taxExcludedAmount)}`
  );

  const averageSpendPerCustomer = resolveMainAmount(
    averageSpendPerCustomerTaxIncluded,
    averageSpendPerCustomerTaxExcluded
  );

  const paymentMethodList = Array.isArray(summary?.paymentMethodList)
    ? summary.paymentMethodList
    : [];

  const taxBreakdownList = Array.isArray(summary?.taxBreakdownList)
    ? summary.taxBreakdownList
    : [];

  const discountList = Array.isArray(summary?.discountList)
    ? summary.discountList
    : [];

  const promoExpenseList = Array.isArray(summary?.promoExpenseList)
    ? summary.promoExpenseList
    : [];

  const voucherList = Array.isArray(summary?.voucherList)
    ? summary.voucherList
    : [];

  const timeSlotList = Array.isArray(summary?.timeSlotList)
    ? summary.timeSlotList
    : [];
  // POS系部門の表示では時間帯別売上を出さない。
  // POS系部門の表示では時間帯別売上を出さない（全体表示=allでは出す）。
  const showTimeSlot = !(selectedDepartment && selectedDepartment.registerMode === 'pos');
  // 自部門を表示している時だけ締め処理を許可（他部門/全体では非表示）。
  const isOwnDepartmentView = selectedDepartmentId === (activeDepartment?.id || '');

  const categoryList = Array.isArray(summary?.categoryList)
    ? summary.categoryList
    : [];

  // 売り場別売上(POS物販)。表示中の取引から、売り場→カテゴリーグループ内訳で集計。
  const salesAreaList = useMemo(
    () => buildSalesAreaSales(filteredTransactions, resolveItemSalesArea),
    [filteredTransactions, resolveItemSalesArea]
  );

  const departmentList = Array.isArray(summary?.departmentList)
    ? summary.departmentList
    : [];

  const isClosed = closingStatus === 'closed' || closedDailyData?.status === 'closed';
  // 自レジが締め済みか（締め処理ボタンの状態に使用）。
  const isOwnClosed = Boolean(activeRegister?.id && registerClosedMap[activeRegister.id]);
  // 選択中レジが締め済みか（印刷ボタンの表示に使用）。
  const isSelectedClosed = Boolean(selectedRegister?.id && registerClosedMap[selectedRegister.id]);

  // 最上部インジケーター: 選択中レジの売上合計＋支払/区分別内訳と締め差額。
  // 実査差額があるのは現金/カード/QRのみ。値引き/スタンプカード/売掛は金額のみ表示。
  // difference が null = 実査なし（その項目は「—」表示）。0=差額なし、それ以外=差額あり。
  const selectedCashCheck = selectedRegisterClosing?.cashCheck || null;
  const selectedExternalCheck = selectedRegisterClosing?.externalPaymentCheck || null;
  const selectedCouponCheck = selectedRegisterClosing?.couponCheck || null;
  const cashDifference = selectedCashCheck ? Number(selectedCashCheck.difference || 0) : null;
  const cardDifference = selectedExternalCheck ? Number(selectedExternalCheck.cardDifference || 0) : null;
  const qrDifference = selectedExternalCheck ? Number(selectedExternalCheck.qrDifference || 0) : null;
  // クーポン確認の差額は値引き/スタンプカード(販促費)/売掛(金券)をまとめた値。区分別には割れないため全体バッジにのみ反映する。
  const couponDifference = selectedCouponCheck ? Number(selectedCouponCheck.difference || 0) : null;
  // 現金/カード/QR は締めモーダルで常に確認するため常時表示。
  // 値引き/スタンプカード/売掛 はモーダルと同じく「利用があるとき(金額>0)のみ」表示する。
  const registerIndicatorItems = [
    { key: 'cash', label: '現金', amount: Number(registerSummary?.cashSales || 0), difference: cashDifference, always: true },
    { key: 'card', label: 'カード', amount: Number(registerSummary?.cardSales || 0), difference: cardDifference, always: true },
    { key: 'qr', label: 'QR', amount: Number(registerSummary?.qrSales || 0), difference: qrDifference, always: true },
    { key: 'discount', label: '値引き', amount: Number(registerSummary?.discountTotal || 0), difference: null, always: false },
    { key: 'stamp', label: 'スタンプカード', amount: Number(registerSummary?.promoExpenseTotal || 0), difference: null, always: false },
    { key: 'voucher', label: '売掛', amount: Number(registerSummary?.voucherTotal || 0), difference: null, always: false }
  ].filter((item) => item.always || item.amount > 0);
  const registerSalesTotal = Number(registerSummary?.totalSales || 0);
  const hasAnyRegisterDifference = [cashDifference, cardDifference, qrDifference, couponDifference]
    .some((difference) => difference !== null && difference !== 0);
  // 同一部門の他レジ（自レジ以外）。締めツールバーで左側にボタン表示する。
  const otherDepartmentRegisters = departmentRegisters.filter((register) => register.id !== activeRegister?.id);

  const handleDateInputChange = (event) => {
    if (!setTargetDate) return;

    const nextDate = createDateFromInputValue(event.target.value);
    setTargetDate(nextDate);
    setClosingStatus(null);
  };

  const openDatePicker = () => {
    if (!dateInputRef.current) return;

    if (typeof dateInputRef.current.showPicker === 'function') {
      dateInputRef.current.showPicker();
      return;
    }

    dateInputRef.current.click();
  };

  // 印刷は「選択中レジ」の締め内容を出力する（サマリ・各内訳・金種/カード/QR/クーポン実績）。
  const handlePrint = () => {
    printDailyClosingReceipt({
      dateKey,
      summary: registerSummary,
      paymentMethodList: Array.isArray(registerSummary?.paymentMethodList) ? registerSummary.paymentMethodList : [],
      taxBreakdownList: Array.isArray(registerSummary?.taxBreakdownList) ? registerSummary.taxBreakdownList : [],
      discountList: Array.isArray(registerSummary?.discountList) ? registerSummary.discountList : [],
      promoExpenseList: Array.isArray(registerSummary?.promoExpenseList) ? registerSummary.promoExpenseList : [],
      voucherList: Array.isArray(registerSummary?.voucherList) ? registerSummary.voucherList : [],
      timeSlotList: Array.isArray(registerSummary?.timeSlotList) ? registerSummary.timeSlotList : [],
      categoryList: Array.isArray(registerSummary?.categoryList) ? registerSummary.categoryList : [],
      departmentList: Array.isArray(registerSummary?.departmentList) ? registerSummary.departmentList : [],
      closedDailyData: selectedRegisterClosing,
      registerName: selectedRegister?.name || '',
      settings
    });
  };


const handleSaveChangeFundAmount = async (nextAmount) => {
  if (!storeId) return;

  const registerId = String(activeRegister?.id || '');
  if (!registerId) {
    window.alert('使用レジが未設定のため釣り銭準備金を保存できません。基本設定でレジを選択してください。');
    return;
  }

  const normalizedAmount = Math.max(Math.round(Number(nextAmount) || 0), 0);
  const settingsRef = doc(db, 'stores', storeId, 'settings', 'dailyClosing');

  // レジ単位で保存。merge により他レジの値(changeFundByRegister の他キー)は保持される。
  await setDoc(settingsRef, {
    changeFundByRegister: { [registerId]: normalizedAmount },
    updatedAt: serverTimestamp()
  }, { merge: true });

  setChangeFundAmount(normalizedAmount);
};

// レジボタンのクリック: 表示対象レジを切り替えて締め内容モーダルを開く。
// 自レジ=締め実行可、他レジ=閲覧のみ（モーダルは readOnly={!isSelectedOwnRegister} で制御）。
const openRegisterDetail = (register) => {
  // 売上0のレジでも締め状況を記録できるよう、件数では無効化しない。
  if (!storeId || isClosing || loading) return;
  if (register?.id) setSelectedRegisterId(register.id);
  setIsCheckModalOpen(true);
};

const buildClosingPayload = (sum, txns, closingCheck = {}) => ({
  dateKey,
  targetDate: new Date(targetDate || new Date()),
  status: 'closed',

  transactionIds: txns.map((transaction) => transaction.id),
  transactionCount: Number(sum?.transactionCount || 0),
  customerCount: Number(sum?.customerCount || 0),
  itemCount: Number(sum?.itemCount || 0),

  totalSales: Number(sum?.totalSales || 0),

  cashSales: Number(sum?.cashSales || 0),
  cardSales: Number(sum?.cardSales || 0),
  qrSales: Number(sum?.qrSales || 0),
  otherSales: Number(sum?.otherSales || 0),

  discountTotal: Number(sum?.discountTotal || 0),
  promoExpenseTotal: Number(sum?.promoExpenseTotal || 0),
  voucherTotal: Number(sum?.voucherTotal || 0),
  discountCount: Number(sum?.discountCount || 0),
  promoExpenseCount: Number(sum?.promoExpenseCount || 0),
  voucherCount: Number(sum?.voucherCount || 0),
  settlementAdjustmentTotal: Number(sum?.settlementAdjustmentTotal || 0),

  paymentMethods: Array.isArray(sum?.paymentMethodList) ? sum.paymentMethodList : [],
  departments: Array.isArray(sum?.departmentList) ? sum.departmentList : [],
  taxBreakdown: Array.isArray(sum?.taxBreakdownList) ? sum.taxBreakdownList : [],
  discounts: Array.isArray(sum?.discountList) ? sum.discountList : [],
  promoExpenses: Array.isArray(sum?.promoExpenseList) ? sum.promoExpenseList : [],
  vouchers: Array.isArray(sum?.voucherList) ? sum.voucherList : [],
  timeSlots: Array.isArray(sum?.timeSlotList) ? sum.timeSlotList : [],
  categories: Array.isArray(sum?.categoryList) ? sum.categoryList : [],

  cashCheck: closingCheck.cashCheck || null,
  couponCheck: closingCheck.couponCheck || null,
  externalPaymentCheck: closingCheck.externalPaymentCheck || null,
  changeFundAmount: Number(changeFundAmount || 0)
});

const handleCloseDay = async (closingCheck = {}) => {
  if (!storeId || isClosing) return;
  // 締め実行・修正は自レジのみ（他レジ閲覧中は実行不可）。
  if (!isSelectedOwnRegister) {
    window.alert('他のレジの締め処理はこの端末からは実行できません。各レジの端末で締めてください。');
    return;
  }
  const registerId = String(activeRegister?.id || '');
  if (!registerId) {
    window.alert('使用レジが未設定です。基本設定でレジを選択してください。');
    return;
  }

  setIsClosing(true);

  try {
    // レジ単位の締め: dailyClosings/{date}/registers/{registerId}
    const registerClosingRef = doc(db, 'stores', storeId, 'dailyClosings', dateKey, 'registers', registerId);
    const registerSnap = await getDoc(registerClosingRef);
    if (registerSnap.exists() && registerSnap.data()?.status === 'closed') {
      const overwrite = window.confirm(`${activeRegister?.name || 'このレジ'} の締めデータは既にあります。上書きしますか？`);
      if (!overwrite) {
        setIsClosing(false);
        return;
      }
    }

    const registerPayload = {
      ...buildClosingPayload(registerSummary, registerTransactions, closingCheck),
      registerId,
      registerName: activeRegister?.name || registerId,
      departmentId: activeDepartment?.id || '',
      departmentName: activeDepartment?.name || ''
    };
    await setDoc(registerClosingRef, {
      ...registerPayload,
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    // 当日(取引のある)全レジが締め済みかを判定する。
    // 1レジ締めただけで店全体(per-date doc)を closed にすると、未締めレジが残っていても
    // 「締め済みの日」と誤認され分析(useWeeklyTrendBaseDate 等)に影響するため、
    // per-date doc の status='closed' は「全レジ締め完了時のみ」立てる。
    const registersSnap = await getDocs(collection(db, 'stores', storeId, 'dailyClosings', dateKey, 'registers'));
    const closedRegisterIds = new Set();
    registersSnap.forEach((snap) => {
      if (snap.data()?.status === 'closed') closedRegisterIds.add(snap.id);
    });
    closedRegisterIds.add(registerId); // 直前に書いた自レジを確実に含める(読み取り遅延対策)

    // registerId を持つ取引のあるレジが全部締め済みか。registerId 無しの旧取引は対象外。
    const transactingRegisterIds = new Set(
      transactions.map((transaction) => String(transaction.registerId || '')).filter(Boolean)
    );
    const allRegistersClosed = Array.from(transactingRegisterIds).every((rid) => closedRegisterIds.has(rid));
    const legacyStatus = allRegistersClosed ? 'closed' : 'partial';

    // 既存の日付単位(全日集計・分析互換)も更新。status は全レジ締め完了時のみ closed。
    const legacyPayload = {
      ...buildClosingPayload(fullDaySummary, transactions, closingCheck),
      status: legacyStatus
    };
    await setDoc(doc(db, 'stores', storeId, 'dailyClosings', dateKey), {
      ...legacyPayload,
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    setClosedDailyData(legacyStatus === 'closed' ? legacyPayload : null);
    setClosingStatus(legacyStatus === 'closed' ? 'closed' : null);
    setRegisterClosedMap((prev) => ({ ...prev, [registerId]: true }));
    setRegisterDiffMap((prev) => ({ ...prev, [registerId]: closingHasDifference(registerPayload) }));
    setClosingReloadKey((key) => key + 1);
    setIsCheckModalOpen(false);
  } catch (error) {
    console.error('Daily closing failed:', error);
    window.alert(error.message || '締め処理に失敗しました。');
  } finally {
    setIsClosing(false);
  }
};

  return (
    <div className="mt-2 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">

        {/* 1. 部門セレクター（使用レジ／部門切替／表示中件数）。分析画面と同じカード枠。 */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 p-3">
          {/* 使用レジ（固定表示・大きめテキスト） */}
          <div className="rounded-xl bg-slate-900 px-4 py-2 text-base font-black text-white">
            {activeRegister?.name || 'レジ'}
          </div>

          {/* 部門ボタン（配置・名称は固定。自部門は大きく、その他は小さく。選択中は黒） */}
          {departmentOptions.map((dept) => {
            const isSelected = selectedDepartmentId === dept.id;
            const isOwn = dept.id === activeDepartment?.id;
            return (
              <button
                key={dept.id}
                type="button"
                onClick={() => setSelectedDepartmentId(dept.id)}
                className={`rounded-xl font-black transition ${
                  isOwn ? 'px-5 py-2.5 text-sm' : 'px-3 py-2 text-xs'
                } ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                {dept.name}
              </button>
            );
          })}

          {/* 全体（小さくグレー、選択中は黒） */}
          <button
            type="button"
            onClick={() => setSelectedDepartmentId('all')}
            className={`rounded-xl px-3 py-2 text-xs font-black transition ${
              selectedDepartmentId === 'all'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            }`}
          >
            全体
          </button>

          <div className="ml-auto rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
            表示中: {filteredTransactionCount}件 / 全{transactions.length}件
          </div>

          {/* 自部門に戻る（一番右。自部門表示中は非表示） */}
          {!isOwnDepartmentView && (
            <button
              type="button"
              onClick={() => setSelectedDepartmentId(activeDepartment?.id || 'all')}
              className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"
            >
              自部門に戻る
            </button>
          )}
        </div>

        {/* 2. このレジの売上（分析対象期間と同サイズの枠。左=売上内訳、右=日付）。
            枠色: 未締め=オレンジ / 締め済み差額なし=薄緑 / 締め済み差額あり=薄赤。 */}
        <div
          className={`mt-4 flex flex-col gap-3 rounded-2xl border p-4 xl:flex-row xl:items-center xl:justify-between ${
            !isSelectedClosed
              ? 'border-orange-100 bg-orange-50/40'
              : hasAnyRegisterDifference
                ? 'border-red-200 bg-red-50/50'
                : 'border-green-200 bg-green-50/50'
          }`}
        >
          {/* 左: 売上合計＋差額有無＋区分別（モーダルにある項目のみ） */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-2">
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-black text-slate-400">このレジの売上</span>
                <span className="text-lg font-black text-slate-900">
                  {formatCurrency(registerSalesTotal)}
                </span>
              </div>
              {!isSelectedClosed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-500">
                  <LockKeyhole size={12} />
                  未締め
                </span>
              ) : hasAnyRegisterDifference ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-black text-red-600">
                  <AlertTriangle size={12} />
                  差額あり
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-black text-green-700">
                  <CheckCircle2 size={12} />
                  差額なし
                </span>
              )}
            </div>

            {registerIndicatorItems.map((item) => {
              const hasCheck = item.difference !== null;
              const isMatched = hasCheck && item.difference === 0;
              const isMismatched = hasCheck && item.difference !== 0;
              return (
                <div
                  key={item.key}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ${
                    isMismatched
                      ? 'bg-red-50 ring-red-200'
                      : isMatched
                        ? 'bg-green-50 ring-green-100'
                        : 'bg-white ring-slate-100'
                  }`}
                >
                  <div className="flex flex-col leading-tight">
                    <span className="text-[10px] font-black text-slate-400">{item.label}</span>
                    <span className="text-sm font-black text-slate-900">
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                  {isMismatched ? (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-600">
                      <AlertTriangle size={11} />
                      {item.difference > 0 ? '+' : ''}{formatCurrency(item.difference)}
                    </span>
                  ) : isMatched ? (
                    <span className="inline-flex items-center rounded-md bg-green-100 px-1 py-0.5 text-green-600">
                      <CheckCircle2 size={13} />
                    </span>
                  ) : (
                    <span className="text-[10px] font-black text-slate-300">—</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 右: 日付ステッパー（分析画面と同じ白ピル） */}
          <div className="flex shrink-0 items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => shiftDailyClosingDate(-1)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-600"
              aria-label="前の日"
            >
              <ChevronLeft size={20} strokeWidth={3} />
            </button>

            <button
              type="button"
              onClick={openDatePicker}
              className="min-w-[180px] rounded-full bg-white px-6 py-3 text-center text-sm font-black text-gray-900 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-700"
            >
              {dateKey}
            </button>

            <button
              type="button"
              onClick={() => shiftDailyClosingDate(1)}
              disabled={isTargetDateToday}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="次の日"
            >
              <ChevronRight size={20} strokeWidth={3} />
            </button>

            <input
              ref={dateInputRef}
              type="date"
              max={todayDateValue}
              value={toDateInputValue(targetDate)}
              onChange={handleDateInputChange}
              className="sr-only"
            />
          </div>
        </div>

        {/* 3. 各レジのボタン列（右寄せ・分析の印刷ボタン位置）。区切り線でサマリと分離。
            並び: 他のレジ → 該当レジ → 印刷。
            配色: 該当レジ 未締め=黒 / 締め済み差額なし=薄緑 / 差額あり=薄赤。
                  他レジ 未締め=薄グレー / 締め済み差額なし=薄緑 / 差額あり=薄赤。
            サイズで自レジ(大)と他レジ(小)を区別。選択中レジは枠線(ring)でハイライト。 */}
        <div className="mb-5 mt-4 flex flex-wrap items-center justify-end gap-2 border-b border-gray-100 pb-5">
          {isOwnDepartmentView && (
            <>
              {/* 他のレジ（小・クリックで閲覧表示） */}
              {otherDepartmentRegisters.map((register) => {
                const closed = Boolean(registerClosedMap[register.id]);
                const hasDifference = Boolean(registerDiffMap[register.id]);
                const isSelected = selectedRegister?.id === register.id;
                return (
                  <button
                    key={register.id}
                    type="button"
                    onClick={() => openRegisterDetail(register)}
                    disabled={loading || isClosing}
                    className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-black shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      registerButtonColorClass({ closed, hasDifference, isSelf: false })
                    } ${isSelected ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
                  >
                    {closed ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}
                    {register.name}{closed ? '締め済み' : '未締め'}
                  </button>
                );
              })}

              {/* 該当レジ（大・締め処理／修正） */}
              <button
                type="button"
                onClick={() => openRegisterDetail(activeRegister)}
                disabled={loading || isClosing || isLoadingClosedDaily}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  registerButtonColorClass({
                    closed: isOwnClosed,
                    hasDifference: Boolean(activeRegister?.id && registerDiffMap[activeRegister.id]),
                    isSelf: true
                  })
                } ${isSelectedOwnRegister ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
              >
                {isClosing || isLoadingClosedDaily ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : isOwnClosed ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <LockKeyhole size={16} />
                )}
                {activeRegister?.name || 'レジ'}{isOwnClosed ? '締め処理済み・修正' : '締め処理'}
              </button>

              {/* 印刷（選択中レジが締め済みのとき。選択中レジの締め内容を印刷） */}
              {isSelectedClosed && (
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-gray-900 px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-black"
                >
                  <Printer size={17} strokeWidth={2.7} />
                  印刷
                </button>
              )}
            </>
          )}
        </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm font-bold text-gray-400">
          <Loader2 size={18} className="mr-2 animate-spin" />
          読み込み中
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-2xl bg-orange-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-black text-orange-500">
                  売上合計 {amountDisplayLabel}
                </div>
                <div className="flex rounded-full bg-white p-0.5 text-[10px] font-black shadow-sm">
                  <button
                    type="button"
                    onClick={() => updateAmountDisplayMode('tax_excluded')}
                    className={`rounded-full px-2 py-1 transition-colors ${
                      isTaxExcludedMain
                        ? 'bg-orange-500 text-white'
                        : 'text-orange-500'
                    }`}
                  >
                    税抜
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAmountDisplayMode('tax_included')}
                    className={`rounded-full px-2 py-1 transition-colors ${
                      !isTaxExcludedMain
                        ? 'bg-orange-500 text-white'
                        : 'text-orange-500'
                    }`}
                  >
                    税込
                  </button>
                </div>
              </div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {formatCurrency(resolveMainAmount(summary?.totalSales, summary?.totalSalesTaxExcluded))}
              </div>
              <div className="mt-1 text-[11px] font-bold text-orange-500/80">
                {resolveSubAmount(summary?.totalSales, summary?.totalSalesTaxExcluded)}
                <span className="mx-1 text-orange-300">/</span>
                内税 {formatCurrency(summary?.totalTaxAmount)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="flex items-center gap-1 text-xs font-black text-gray-400">
                <Users size={14} />
                来客数
              </div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {Number(summary?.customerCount || 0)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">客単価 {amountDisplayLabel}</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {formatCurrency(averageSpendPerCustomer)}
              </div>
              <div className="mt-1 text-[11px] font-bold text-gray-400">
                {resolveSubAmount(averageSpendPerCustomerTaxIncluded, averageSpendPerCustomerTaxExcluded)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">会計件数</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {Number(summary?.transactionCount || 0)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">販売点数</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {Number(summary?.itemCount || 0)}
              </div>
            </div>



          </div>

          <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-black text-emerald-900">
                粗利・原価
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-emerald-700 shadow-sm">
                原価登録済み {Number(summary?.costConfiguredItemCount || 0)}点
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-xs font-black text-emerald-500">原価設定済み売上 税抜</div>
                <div className="mt-2 text-2xl font-black text-gray-900">
                  {formatCurrency(summary?.costConfiguredSalesTaxExcluded)}
                </div>
                <div className="mt-1 text-[11px] font-bold text-gray-400">
                  税込 {formatCurrency(summary?.costConfiguredSalesTaxIncluded)}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-xs font-black text-gray-400">原価 税抜</div>
                <div className="mt-2 text-2xl font-black text-gray-900">
                  {formatCurrency(summary?.costTaxExcludedTotal)}
                </div>
                <div className="mt-1 text-[11px] font-bold text-gray-400">
                  税込 {formatCurrency(summary?.costTaxIncludedTotal)}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-xs font-black text-emerald-500">粗利 税抜</div>
                <div className="mt-2 text-2xl font-black text-gray-900">
                  {formatCurrency(summary?.grossProfitTaxExcluded)}
                </div>
                <div className="mt-1 text-[11px] font-bold text-gray-400">
                  税込 {formatCurrency(summary?.grossProfitTaxIncluded)}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-xs font-black text-gray-400">粗利率</div>
                <div className="mt-2 text-2xl font-black text-gray-900">
                  {summary?.grossProfitRate === null || summary?.grossProfitRate === undefined
                    ? '-'
                    : `${Number(summary.grossProfitRate || 0).toFixed(1)}%`}
                </div>
              </div>
            </div>

            {Number(summary?.costMissingItemCount || 0) > 0 && (
              <div className="mt-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-amber-800">
                    原価未設定の商品があります
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-amber-700 shadow-sm">
                    未設定 {Number(summary?.costMissingItemCount || 0)}点
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-white px-4 py-3">
                    <div className="text-[11px] font-black text-amber-500">原価未設定売上 税抜</div>
                    <div className="mt-1 text-lg font-black text-gray-900">
                      {formatCurrency(summary?.costMissingSalesTaxExcluded)}
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-gray-400">
                      税込 {formatCurrency(summary?.costMissingSalesTaxIncluded)}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white px-4 py-3">
                    <div className="text-[11px] font-black text-amber-500">未設定売上比率</div>
                    <div className="mt-1 text-lg font-black text-gray-900">
                      {Number(summary?.costMissingSalesRate || 0).toFixed(1)}%
                    </div>
                  </div>

                  <div className="rounded-xl bg-white px-4 py-3">
                    <div className="text-[11px] font-black text-amber-500">入力推奨</div>
                    <div className="mt-1 text-sm font-black leading-relaxed text-amber-800">
                      正確な粗利を見るために、商品の原価入力をしてください。
                    </div>
                  </div>
                </div>
              </div>
            )}

            {Number(summary?.estimatedCostItemCount || 0) > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5">
                <div className="text-xs font-bold text-sky-700">
                  この粗利には、売り場原価率/掛け率で推計した粗利を含みます
                  <span className="ml-1 font-black text-sky-500">（{Number(summary?.estimatedCostItemCount || 0)}点 / 売上 {formatCurrency(summary?.estimatedCostSalesTaxExcluded)}）</span>
                </div>
                <div className="text-sm font-black text-sky-800">
                  推計粗利 {formatCurrency(Number(summary?.estimatedCostSalesTaxExcluded || 0) - Number(summary?.estimatedCostTaxExcluded || 0))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <ReceiptText size={16} />
                支払い方法別
              </div>

              <div className="space-y-2">
                {paymentMethodList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    会計データがありません
                  </div>
                ) : (
                  paymentMethodList.map((entry) => (
                    <div
                      key={entry.method}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-black text-gray-800">
                          {entry.label || getPaymentMethodLabel(entry.method)}
                        </div>
                        <div className="text-[11px] font-bold text-gray-400">
                          {Number(entry.count || 0)}件
                        </div>
                      </div>
                      <div className="text-sm font-black text-gray-900">
                        {formatCurrency(entry.total)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <BadgeJapaneseYen size={16} />
                税率別売上
              </div>

              <div className="space-y-2">
                {taxBreakdownList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    税率別データがありません
                  </div>
                ) : (
                  taxBreakdownList.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-black text-gray-800">
                          {entry.key === 'reduced'
                            ? '軽減税率'
                            : entry.key === 'standard'
                              ? '標準税率'
                              : '税率未設定'}
                          <span className="ml-2 text-xs font-black text-gray-400">
                            {Number(entry.rate || 0)}%
                          </span>
                        </div>
                        <div className="text-sm font-black text-gray-900">
                          {formatCurrency(entry.sales)}
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-gray-400">
                        <span>税抜対象額</span>
                        <span>{formatCurrency(entry.baseAmount)}</span>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-gray-400">
                        <span>内消費税</span>
                        <span>{formatCurrency(entry.tax)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <TicketPercent size={16} />
                割引/金券
              </div>

              <div className="mb-3 rounded-xl bg-orange-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black text-orange-500">
                    売上値引合計
                  </div>
                  <div className="text-[11px] font-black text-orange-500">
                    {Number(summary?.discountCount || 0)}件
                  </div>
                </div>
                <div className="mt-1 text-xl font-black text-gray-900">
                  {formatCurrency(summary?.discountTotal)}
                </div>
              </div>

              <div className="space-y-2">
                {discountList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    売上値引の利用はありません
                  </div>
                ) : (
                  discountList.map((discount) => (
                    <div
                      key={discount.id || discount.name}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-gray-800">
                          {discount.name || '値引き'}
                        </div>
                          <div className="text-[11px] font-bold text-gray-400">
                            {Number(discount.quantity || discount.count || 0)}枚
                            <span className="mx-1 text-gray-300">/</span>
                            {Number(discount.count || 0)}会計
                          </div>
                      </div>

                      <div className="ml-3 shrink-0 text-sm font-black text-gray-900">
                        {formatCurrency(discount.amount)}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black text-emerald-600">販促費合計</div>
                  <div className="text-[11px] font-black text-emerald-600">
                    {Number(summary?.promoExpenseCount || 0)}件
                  </div>
                </div>
                <div className="mt-1 text-xl font-black text-gray-900">
                  {formatCurrency(summary?.promoExpenseTotal)}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {promoExpenseList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    販促費の利用はありません
                  </div>
                ) : (
                  promoExpenseList.map((entry) => (
                    <div key={entry.id || entry.name} className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-emerald-900">{entry.name || '販促費'}</div>
                        <div className="text-[11px] font-bold text-emerald-500">
                          {Number(entry.quantity || entry.count || 0)}枚
                          <span className="mx-1 text-emerald-200">/</span>
                          {Number(entry.count || 0)}会計
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-sm font-black text-emerald-900">{formatCurrency(entry.amount)}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black text-sky-600">金券/売掛合計</div>
                  <div className="text-[11px] font-black text-sky-600">
                    {Number(summary?.voucherCount || 0)}件
                  </div>
                </div>
                <div className="mt-1 text-xl font-black text-gray-900">
                  {formatCurrency(summary?.voucherTotal)}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {voucherList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    金券/売掛の利用はありません
                  </div>
                ) : (
                  voucherList.map((entry) => (
                    <div key={entry.id || entry.name} className="flex items-center justify-between rounded-xl bg-sky-50 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-sky-900">{entry.name || '金券/売掛'}</div>
                        <div className="text-[11px] font-bold text-sky-500">
                          {Number(entry.quantity || entry.count || 0)}枚
                          <span className="mx-1 text-sky-200">/</span>
                          {Number(entry.count || 0)}会計
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-sm font-black text-sky-900">{formatCurrency(entry.amount)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {showTimeSlot && (
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <Clock3 size={16} />
                時間帯別売上
              </div>

              <div className="space-y-2">
                {timeSlotList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    時間帯別データがありません
                  </div>
                ) : (
                  timeSlotList.map((slot) => (
                    <div
                      key={slot.id || slot.name}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-gray-800">
                          {slot.name || '時間帯未設定'}
                        </div>
                        <div className="text-[11px] font-bold text-gray-400">
                          {Number(slot.count || 0)}件
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-sm font-black text-gray-900">
                        {formatCurrency(slot.total)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-gray-100 p-4">
            <div className="mb-3 text-sm font-black text-gray-800">
              部門別売上
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {departmentList.length === 0 ? (
                <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400 md:col-span-2">
                  部門別データがありません
                </div>
              ) : (
                departmentList.map((department) => (
                  <div
                    key={department.id || department.departmentId || department.name}
                    className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-800">
                        {department.name || department.departmentName || '部門未設定'}
                      </div>
                      <div className="text-[11px] font-bold text-gray-400">
                        {Number(department.count || 0)}件
                      </div>
                    </div>
                    <div className="ml-3 shrink-0 text-sm font-black text-gray-900">
                      {formatCurrency(department.total)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-100 p-4">
            <div className="mb-3 text-sm font-black text-gray-800">
              売り場別売上
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {salesAreaList.length === 0 ? (
                <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400 md:col-span-2">
                  売り場別データがありません
                </div>
              ) : (
                salesAreaList.map((area) => (
                  <div
                    key={area.id || area.name}
                    className="rounded-xl bg-gray-50 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-gray-800">
                          {area.name || '売り場未設定'}
                        </div>
                        <div className="text-[11px] font-bold text-gray-400">
                          {Number(area.quantity || 0)}点
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-base font-black text-gray-900">
                        {formatCurrency(area.total)}
                      </div>
                    </div>

                    {Array.isArray(area.groupList) && area.groupList.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-gray-200 pt-3">
                        {area.groupList.map((group) => (
                          <div
                            key={group.id || group.name}
                            className="flex items-center justify-between gap-3 pl-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                              <span className="truncate text-xs font-bold text-gray-600">
                                {group.name || 'グループ未設定'}
                              </span>
                              <span className="shrink-0 text-[10px] font-bold text-gray-400">
                                {Number(group.quantity || 0)}点
                              </span>
                            </div>
                            <span className="shrink-0 text-xs font-black text-gray-700">
                              {formatCurrency(group.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      <DailyClosingCheckModal
        isOpen={isCheckModalOpen}
        dateKey={dateKey}
        registerName={selectedRegister?.name || ''}
        readOnly={!isSelectedOwnRegister}
        summary={registerSummary}
        discountList={Array.isArray(registerSummary?.discountList) ? registerSummary.discountList : []}
        couponUsageList={registerSummary?.couponUsageList || []}
        changeFundAmount={changeFundAmount}
        closedDailyData={selectedRegisterClosing}
        onSaveChangeFundAmount={handleSaveChangeFundAmount}
        isProcessing={isClosing}
        onClose={() => {
          if (!isClosing) setIsCheckModalOpen(false);
        }}
        onConfirm={handleCloseDay}
      />
    </div>
  );
};

export default DailyClosingPanel;