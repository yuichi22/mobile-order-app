// 日計の部門集計を「商品カテゴリーの所属部門」基準で行うためのユーティリティ。
//
// 判別ルール:
//  - 取引アイテムの categoryId が商品マスター(productCategories)に存在する
//    → 物販品。カテゴリー(または所属グループ)に departmentId があればそれ、
//      無ければ既定で物販(pos部門)。
//  - 商品マスターに存在しない categoryId（＝メニュー品）
//    → 飲食(order部門)。
//
// これにより、物販レジ(レジ4)で会計した飲食メニューも飲食部門に集計され、
// 「会計したレジの部門に丸ごと入る」問題が解消する。締め処理(実際に集金した金額)は
// 別途レジ単位で行うため、ここでの部門分割は表示・部門別集計の用途に限る。

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const getItemLineTotal = (item = {}) => {
  const direct = item.totalPrice ?? item.salesTaxIncludedAmount ?? item.taxIncludedAmount;
  if (direct !== undefined && direct !== null && Number.isFinite(Number(direct))) {
    return Number(direct);
  }
  return num(item.unitPrice) * Math.max(num(item.quantity), 0);
};

// departments(店舗設定) から pos/order の代表部門を解決する。
const resolveDepartmentPair = (departments = []) => {
  const list = Array.isArray(departments) ? departments : [];
  const retail = list.find((d) => d?.registerMode === 'pos') || { id: 'retail', name: '物販' };
  const restaurant = list.find((d) => d?.registerMode === 'order') || { id: 'restaurant', name: '飲食' };
  return { retail, restaurant };
};

// アイテム→部門 {id,name} を返す解決関数を生成する。
export const buildItemDepartmentResolver = ({
  productCategories = [],
  productCategoryGroups = [],
  departments = []
} = {}) => {
  const catMap = new Map();
  (productCategories || []).forEach((c) => {
    if (c?.id) catMap.set(String(c.id), c);
  });
  const groupMap = new Map();
  (productCategoryGroups || []).forEach((g) => {
    if (g?.id) groupMap.set(String(g.id), g);
  });
  const deptMap = new Map();
  (departments || []).forEach((d) => {
    if (d?.id) deptMap.set(String(d.id), d);
  });

  const { retail, restaurant } = resolveDepartmentPair(departments);

  const toDept = (dept) => ({
    id: String(dept?.id || ''),
    name: String(dept?.name || dept?.departmentName || dept?.id || '部門')
  });

  return (item = {}, fallbackDepartment = null) => {
    const categoryId = String(item.categoryId || item.category || '').trim();

    // categoryId が無い（POS手打ち品など）は、会計レジの部門へフォールバック。
    if (!categoryId) {
      return fallbackDepartment ? toDept(fallbackDepartment) : toDept(retail);
    }

    const category = catMap.get(categoryId);
    if (category) {
      // 物販品。カテゴリー or グループの departmentId を尊重し、無ければ物販。
      const groupId = String(category.groupId || category.categoryGroupId || '').trim();
      const group = groupId ? groupMap.get(groupId) : null;
      const explicitDeptId = String(category.departmentId || group?.departmentId || '').trim();
      if (explicitDeptId && deptMap.has(explicitDeptId)) {
        return toDept(deptMap.get(explicitDeptId));
      }
      return toDept(retail);
    }

    // 商品マスターに無い categoryId＝メニュー品→飲食。
    return toDept(restaurant);
  };
};

const scaleTaxSummary = (taxSummary, ratio) => {
  if (!taxSummary || typeof taxSummary !== 'object') return taxSummary;
  const scaled = { ...taxSummary };
  [
    'reducedTaxIncluded', 'reducedTaxExcluded', 'reducedTaxAmount',
    'standardTaxIncluded', 'standardTaxExcluded', 'standardTaxAmount'
  ].forEach((key) => {
    if (taxSummary[key] !== undefined) scaled[key] = num(taxSummary[key]) * ratio;
  });
  return scaled;
};

const scaleTaxBreakdown = (taxBreakdown, ratio) => {
  if (!taxBreakdown || typeof taxBreakdown !== 'object') return taxBreakdown;
  const scaled = {};
  ['reduced', 'standard'].forEach((bracket) => {
    const entry = taxBreakdown[bracket];
    if (entry) {
      scaled[bracket] = {
        ...entry,
        sales: num(entry.sales) * ratio,
        baseAmount: num(entry.baseAmount) * ratio,
        tax: num(entry.tax) * ratio
      };
    }
  });
  return scaled;
};

// 1取引を、アイテムの所属部門ごとのスライス(取引形)に分割する。
// 取引レベルの金額(totalAmount/税/値引)は、アイテム税込合計の比率で按分する。
// 按分の端数で合計がずれないよう、最大スライスに差分を寄せる。
export const splitTransactionByDepartment = (transaction = {}, resolveItemDepartment) => {
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  if (items.length === 0 || typeof resolveItemDepartment !== 'function') {
    return [transaction];
  }

  // categoryId 不明アイテムのフォールバック先＝会計レジの部門。
  const fallbackDepartment = transaction.departmentId
    ? { id: transaction.departmentId, name: transaction.departmentName || transaction.departmentId }
    : null;

  const groups = new Map(); // deptId -> { dept, items[], itemTotal }
  items.forEach((item) => {
    const dept = resolveItemDepartment(item, fallbackDepartment) || { id: 'unassigned', name: '部門未設定' };
    const key = dept.id || 'unassigned';
    if (!groups.has(key)) groups.set(key, { dept, items: [], itemTotal: 0 });
    const bucket = groups.get(key);
    bucket.items.push(item);
    bucket.itemTotal += getItemLineTotal(item);
  });

  if (groups.size === 1) {
    const only = [...groups.values()][0];
    return [{
      ...transaction,
      departmentId: only.dept.id,
      departmentName: only.dept.name
    }];
  }

  const totalItemAmount = [...groups.values()].reduce((sum, g) => sum + g.itemTotal, 0);
  const transactionTotal = num(transaction.totalAmount);
  const entries = [...groups.values()];

  let allocated = 0;
  const slices = entries.map((group, index) => {
    const ratio = totalItemAmount > 0 ? group.itemTotal / totalItemAmount : 1 / entries.length;
    let sliceTotal;
    if (index === entries.length - 1) {
      // 端数は最後のスライスに寄せて合計一致を担保。
      sliceTotal = transactionTotal - allocated;
    } else {
      sliceTotal = Math.round(transactionTotal * ratio);
      allocated += sliceTotal;
    }

    const slice = {
      ...transaction,
      items: group.items,
      departmentId: group.dept.id,
      departmentName: group.dept.name,
      totalAmount: sliceTotal,
      settlementAdjustmentTotal: num(transaction.settlementAdjustmentTotal) * ratio,
      taxSummary: scaleTaxSummary(transaction.taxSummary, ratio),
      taxBreakdown: scaleTaxBreakdown(transaction.taxBreakdown, ratio)
    };

    // 来客数・顧客IDは1取引につき1回だけ数えるため、先頭スライス以外では無効化する。
    if (index > 0) {
      slice.registerMode = '';
      slice.salesChannel = '';
      slice.guestCount = 0;
      slice.numberOfGuests = 0;
      slice.partySize = 0;
      slice.customerCount = 0;
      slice.customerIds = [];
      slice.customerSummaries = [];
      // 時間帯別売上の二重計上を避ける（金額はtotalAmountの按分で別途反映）。
      slice.orderAnalyticsRecords = [];
    }

    return slice;
  });

  return slices;
};

// 取引配列を部門スライス配列に展開する。
export const splitTransactionsByDepartment = (transactions = [], resolveItemDepartment) => {
  if (typeof resolveItemDepartment !== 'function') return transactions;
  const out = [];
  (transactions || []).forEach((transaction) => {
    splitTransactionByDepartment(transaction, resolveItemDepartment).forEach((slice) => out.push(slice));
  });
  return out;
};
