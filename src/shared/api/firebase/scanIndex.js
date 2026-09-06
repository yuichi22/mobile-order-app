import { collection, deleteField, doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './client';

// 軽量バーコード索引（POSスキャンの即時照合用）。
//
// 背景: POSレジは商品マスタ(30,891件/72.5MB規模)を購読しない設計のため、
// スキャンのたびに Firestore を引いており、WebChannel が黙り込む店舗Wi-Fi環境で
// 「2品目以降が次のスキャンまで表示されない」等の不調が出ていた。
// カート行の生成に必要な項目だけを stores/{storeId}/scanIndex/bucket_* の
// マップ型ドキュメント(48分割)に持ち、レジ起動時に購読して
// メモリ照合(0ms・チャネル非依存)にする。
//
// 鮮度の設計:
// - 画面からの商品保存時に該当エントリだけ差分更新(価格改定は約1秒でレジに届く)
// - CSV一括取込・スクリプト等の経路は buildScanIndex スクリプト/夜間再構築で治癒
// - 在庫数(inventoryQuantity)は会計のたびには更新しない(表示用途のみ。
//   在庫制限 POS_ENFORCE_STOCK_LIMIT は現在無効)。ズレは再構築で解消
// - 索引未ヒット時は従来のクエリへフォールバックするので、ズレても「読めない」にはならない

export const SCAN_INDEX_COLLECTION = 'scanIndex';
// ⚠この分割数は functions/buildScanIndex.mjs と必ず一致させること。
// 変更したら全店舗で再構築が必要(旧バケットは再構築スクリプトが掃除する)。
// 48分割の根拠: 実測でdev大規模店(32,456件)が12分割だと1バケット1.1MB超(上限1MB)。
// 48なら約300KB/バケットで、商品が倍増しても余裕がある。
export const SCAN_INDEX_BUCKET_COUNT = 48;

// カート行(addPosProductToCart)と buildResolvedPosProduct が消費する項目に限定する。
// 増やすときはドキュメントサイズ(1MB上限/バケット)への影響を確認すること。
const ENTRY_FIELDS = [
  'barcode', 'sku', 'productCode', 'name',
  'price', 'priceTaxIncluded', 'taxRate',
  'categoryId', 'categoryName', 'categoryGroupId', 'categoryGroupName',
  'salesAreaId', 'salesAreaName', 'brandId', 'brandName',
  'costTaxExcluded', 'costTaxIncluded', 'supplierCostRate',
  'inventoryQuantity', 'quantity', 'inventoryUnmanaged'
];

// productId 基準のハッシュでバケットを固定する。
// ⚠バーコード基準にすると、バーコードを打ち直した時に所属バケットが変わり
//   旧エントリの消し忘れ(二重ヒット)が起きるため、不変のIDを使う。
export const scanIndexBucketId = (productId) => {
  let h = 5381;
  const s = String(productId);
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `bucket_${h % SCAN_INDEX_BUCKET_COUNT}`;
};

export const buildScanIndexEntry = (product) => {
  if (!product || product.isArchived === true || product.isActive === false) return null;
  const entry = {};
  ENTRY_FIELDS.forEach((key) => {
    const value = product[key];
    if (value !== undefined && value !== null && value !== '') entry[key] = value;
  });
  return entry;
};

const bucketRef = (storeId, productId) => (
  doc(db, 'stores', storeId, SCAN_INDEX_COLLECTION, scanIndexBucketId(productId))
);

// 商品保存後に呼ぶ差分更新。保存済みドキュメントを読み直して索引に反映する
// (保存ペイロードではなくDBの実体を正とし、部分更新による欠落を防ぐ)。
// 失敗しても商品保存自体は成功扱い(索引は再構築で治癒するため、呼び出し側で握りつぶし可)。
export const upsertScanIndexForProduct = async (storeId, productId) => {
  const productSnap = await getDoc(doc(db, 'stores', storeId, 'products', productId));
  const entry = productSnap.exists() ? buildScanIndexEntry({ id: productId, ...productSnap.data() }) : null;
  const ref = bucketRef(storeId, productId);
  if (entry) {
    await setDoc(ref, { entries: { [productId]: entry } }, { merge: true });
  } else {
    // 削除・アーカイブ・無効化はエントリごと消す(存在しないバケットdocなら何もしない)
    await updateDoc(ref, { [`entries.${productId}`]: deleteField() }).catch(() => {});
  }
};

// レジ起動時の購読。全バケットを購読し、コード(小文字)→[商品,...] のMapを組み直して渡す。
// 30,891件でもMap構築は数十msで、スナップショットは保存時にしか飛ばない。
export const subscribeScanIndex = (storeId, onUpdate) => {
  const buckets = new Map(); // bucketId -> entries
  const rebuild = () => {
    const byCode = new Map();
    buckets.forEach((entries) => {
      Object.entries(entries || {}).forEach(([productId, entry]) => {
        const product = { id: productId, ...entry };
        ['barcode', 'sku', 'productCode'].forEach((field) => {
          const code = String(entry?.[field] ?? '').trim().toLowerCase();
          if (!code) return;
          const list = byCode.get(code);
          if (list) list.push(product); else byCode.set(code, [product]);
        });
      });
    });
    onUpdate(byCode);
  };
  const unsubscribe = onSnapshot(
    collection(db, 'stores', storeId, SCAN_INDEX_COLLECTION),
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') buckets.delete(change.doc.id);
        else buckets.set(change.doc.id, change.doc.data()?.entries || {});
      });
      rebuild();
    },
    (error) => {
      // 索引が読めなくても従来経路で動く。復旧は再購読(レジ開き直し)に任せる。
      console.warn('[scanIndex] 購読エラー(従来のクエリ照合で継続):', error);
      onUpdate(null);
    }
  );
  return unsubscribe;
};

// ---- アプリ寿命の共有索引 ----
// レジ画面(PosMain)は会計画面との行き来のたびにアンマウントされるため、
// 画面ごとに購読すると毎回索引(HAUSで約12.5MB)を捨てて取り直すことになり、
// 「戻った直後の最初のスキャンだけ間がある」が会計のたびに再発していた(2026-09-06 実機報告)。
// 購読は storeId ごとに1本だけ張り、一度開始したらアプリを閉じるまで維持する。
// 画面側は attachScanIndex で相乗りするだけ(デタッチしても購読は温存)。
// 維持コストはリスナー1本のみ(スナップショットは商品保存時にしか飛ばない)。
const sharedIndexes = new Map(); // storeId -> { byCode, listeners }

export const attachScanIndex = (storeId, onUpdate) => {
  let shared = sharedIndexes.get(storeId);
  if (!shared) {
    shared = { byCode: null, listeners: new Set() };
    sharedIndexes.set(storeId, shared);
    subscribeScanIndex(storeId, (byCode) => {
      shared.byCode = byCode;
      shared.listeners.forEach((listener) => listener(byCode));
    });
  }
  shared.listeners.add(onUpdate);
  // 既に索引を持っていれば即座に渡す(再マウント直後から一瞬スキャンにする要)。
  if (shared.byCode) onUpdate(shared.byCode);
  return () => { shared.listeners.delete(onUpdate); };
};
