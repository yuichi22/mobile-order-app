#!/usr/bin/env python3
"""ペット売場(salesarea_007)を HAUS(store_ar2y9) から GROOM HAUS(store_0a558) へ移植する。

前提: mobile-order-prod / Firestore は名前付きDB "main"。認証は gcloud のユーザートークン。
ドキュメントIDは移行元と同じものを使う（商品→ブランド/カテゴリ等の参照をそのまま活かすため）。

使い方（この順に実行する）:
  python3 migrate-pet-salesarea.py backup   # 対象データをJSONへ退避（読み取りのみ）
  python3 migrate-pet-salesarea.py dryrun   # 何を何件書くかを表示（書き込まない）
  python3 migrate-pet-salesarea.py migrate  # GROOMへ投入（HAUS側は一切触らない）
  python3 migrate-pet-salesarea.py verify   # 投入結果を照合
  python3 migrate-pet-salesarea.py delete-src --yes  # HAUSからペット売場を削除（最後）

delete-src は明示的に --yes を付けたときだけ実行する。
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

PROJECT = "mobile-order-prod"
DB = "main"
SRC = "store_ar2y9"   # HAUS
DST = "store_0a558"   # GROOM HAUS
SALES_AREA = "salesarea_007"  # ペット売場

BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DB}/documents"
BACKUP_DIR = os.path.expanduser("~/akuto-migrations/pet-salesarea")

# 店舗固有のため上書きしない設定（Core連携・プラットフォーム権限）
SETTINGS_TO_COPY = [
    "basic", "business", "categories", "cookingCategories", "crossSell",
    "dailyClosing", "layout", "periods", "purchase", "shopify",
    "shopifyEcSync", "taxPrice",
]
SETTINGS_NEVER_COPY = ["coreApps", "coreSales", "platformAccess", "terminal"]

_token = {"value": None, "at": 0}


def token():
    # gcloud のアクセストークンは1時間有効。長い移行の途中で切れないよう50分で取り直す。
    if not _token["value"] or time.time() - _token["at"] > 3000:
        _token["value"] = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]
        ).decode().strip()
        _token["at"] = time.time()
    return _token["value"]


def api(url, method="GET", body=None):
    req = urllib.request.Request(
        url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
    )
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"HTTP {e.code} {method} {url}\n{e.read()[:400].decode()}")
    return None


def query(store, collection, field=None, value=None):
    """コレクションを（必要なら等値条件で）全件取得して生ドキュメントを返す。"""
    q = {"from": [{"collectionId": collection}]}
    if field:
        q["where"] = {"fieldFilter": {
            "field": {"fieldPath": field}, "op": "EQUAL",
            "value": {"stringValue": value}}}
    res = api(f"{BASE}/stores/{store}:runQuery", "POST", {"structuredQuery": q})
    return [r["document"] for r in (res or []) if r.get("document")]


def get_doc(path):
    try:
        return api(f"{BASE}/{path}")
    except SystemExit:
        return None


def doc_id(doc):
    return doc["name"].split("/")[-1]


def commit(writes):
    """Firestoreの上限に合わせて分割コミットする。"""
    done = 0
    for i in range(0, len(writes), 400):
        api(f"{BASE.rsplit('/documents', 1)[0]}/documents:commit", "POST",
            {"writes": writes[i:i + 400]})
        done += len(writes[i:i + 400])
    return done


def collect():
    """移行対象と、それが参照するマスタを集める。"""
    products = query(SRC, "products", "salesAreaId", SALES_AREA)
    groups = query(SRC, "productGroups", "salesAreaId", SALES_AREA)

    def sv(doc, key):
        return doc["fields"].get(key, {}).get("stringValue", "")

    product_ids = {doc_id(p) for p in products}
    brand_ids = {sv(p, "brandId") for p in products} - {""}
    supplier_ids = {sv(p, "supplierId") for p in products} - {""}
    cat_ids = {sv(p, "categoryId") for p in products} - {""}
    catgrp_ids = {sv(p, "categoryGroupId") for p in products} - {""}
    sub_ids = {sv(p, "subCategoryId") for p in products} - {""}

    def pick(collection, ids):
        return [d for d in query(SRC, collection) if doc_id(d) in ids]

    inventory = [d for d in query(SRC, "inventory")
                 if d["fields"].get("productId", {}).get("stringValue") in product_ids]

    sales_area = get_doc(f"stores/{SRC}/productSalesAreas/{SALES_AREA}")
    settings = {}
    for name in SETTINGS_TO_COPY:
        d = get_doc(f"stores/{SRC}/settings/{name}")
        if d:
            settings[name] = d

    return {
        "products": products,
        "productGroups": groups,
        "inventory": inventory,
        "brands": pick("brands", brand_ids),
        "suppliers": pick("suppliers", supplier_ids),
        "productCategories": pick("productCategories", cat_ids),
        "productCategoryGroups": pick("productCategoryGroups", catgrp_ids),
        "productSubCategories": pick("productSubCategories", sub_ids) if sub_ids else [],
        "productSalesAreas": [sales_area] if sales_area else [],
        "settings": settings,
    }


def summarize(data):
    print(f"  商品                      {len(data['products'])} 件")
    print(f"  商品グループ              {len(data['productGroups'])} 件")
    print(f"  在庫(inventory)           {len(data['inventory'])} 件")
    print(f"  ブランド                  {len(data['brands'])} 件")
    print(f"  仕入先                    {len(data['suppliers'])} 件")
    print(f"  カテゴリ                  {len(data['productCategories'])} 件")
    print(f"  カテゴリグループ          {len(data['productCategoryGroups'])} 件")
    print(f"  サブカテゴリ              {len(data['productSubCategories'])} 件")
    print(f"  売り場                    {len(data['productSalesAreas'])} 件")
    print(f"  設定                      {len(data['settings'])} 件 ({', '.join(sorted(data['settings']))})")
    qty = 0
    for d in data["inventory"]:
        v = d["fields"].get("quantity", {})
        try:
            qty += int(v.get("integerValue") or v.get("doubleValue") or 0)
        except (TypeError, ValueError):
            pass
    linked = sum(1 for p in data["products"]
                 if p["fields"].get("shopifyInventoryItemId", {}).get("stringValue"))
    print(f"  （在庫数量の合計 {qty} 点 / Shopify在庫連携済みの商品 {linked} 件）")


def cmd_backup():
    data = collect()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(BACKUP_DIR, f"haus-pet-{stamp}.json")
    # 復元に使えるよう生のFirestore形式のまま保存する
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    # 移行先の事前状態も退避（万一の巻き戻し確認用）
    before = {c: query(DST, c) for c in
              ["products", "productGroups", "inventory", "brands", "suppliers",
               "productCategories", "productCategoryGroups", "productSalesAreas"]}
    with open(os.path.join(BACKUP_DIR, f"groom-before-{stamp}.json"), "w", encoding="utf-8") as f:
        json.dump(before, f, ensure_ascii=False)
    print(f"退避しました: {path}")
    summarize(data)
    print("\n移行先(GROOM)の現在の件数:")
    for k, v in before.items():
        print(f"  {k:<24} {len(v)} 件")
    return data


def build_writes(data):
    writes = []
    for collection in ["productSalesAreas", "productCategoryGroups", "productCategories",
                       "productSubCategories", "brands", "suppliers",
                       "productGroups", "products", "inventory"]:
        for d in data[collection]:
            writes.append({"update": {
                "name": f"projects/{PROJECT}/databases/{DB}/documents/stores/{DST}/{collection}/{doc_id(d)}",
                "fields": d["fields"]}})
    for name, d in data["settings"].items():
        fields = dict(d["fields"])
        if name == "basic":
            # 店名だけは移行先の店舗ドキュメントの値に合わせる（レシートに出るため）。
            # 住所・電話はHAUSの値が入るので、移行後に画面で正しい値へ更新すること。
            store = get_doc(f"stores/{DST}")
            dst_name = (store or {}).get("fields", {}).get("name", {}).get("stringValue", "")
            if dst_name:
                fields["name"] = {"stringValue": dst_name}
        writes.append({"update": {
            "name": f"projects/{PROJECT}/databases/{DB}/documents/stores/{DST}/settings/{name}",
            "fields": fields}})
    return writes


def cmd_dryrun():
    data = collect()
    print("移行対象（読み取り結果）:")
    summarize(data)
    writes = build_writes(data)
    print(f"\n書き込み予定: {len(writes)} 件（{(len(writes) + 399) // 400} 回のコミットに分割）")
    print("※ dryrun では一切書き込みません。")
    existing = query(DST, "products")
    if existing:
        print(f"⚠ 移行先に既に商品が {len(existing)} 件あります。重複投入に注意してください。")


def cmd_migrate():
    data = collect()
    print("移行対象:")
    summarize(data)
    writes = build_writes(data)
    print(f"\nGROOM({DST}) へ {len(writes)} 件書き込みます…")
    n = commit(writes)
    print(f"完了: {n} 件書き込みました。")
    print("※ HAUS側はまだ触っていません。verify で確認してから delete-src を実行してください。")


def cmd_verify():
    src = collect()
    ok = True
    for collection in ["products", "productGroups", "inventory", "brands", "suppliers",
                       "productCategories", "productCategoryGroups", "productSalesAreas"]:
        s = {doc_id(d) for d in src[collection]}
        t = {doc_id(d) for d in query(DST, collection)}
        missing = s - t
        mark = "OK" if not missing else "NG"
        if missing:
            ok = False
        print(f"  {collection:<24} 移行元 {len(s):>5} / 移行先 {len(t):>5}  {mark}"
              + (f"  不足: {len(missing)}件 {list(missing)[:3]}" if missing else ""))
    for name in src["settings"]:
        exists = get_doc(f"stores/{DST}/settings/{name}") is not None
        if not exists:
            ok = False
        print(f"  settings/{name:<16} {'OK' if exists else 'NG（未作成）'}")
    # 参照の整合（移行先で商品のブランド/カテゴリが解決できるか）
    dst_products = query(DST, "products")
    brand_ids = {doc_id(d) for d in query(DST, "brands")}
    cat_ids = {doc_id(d) for d in query(DST, "productCategories")}
    dangling_b = sum(1 for p in dst_products
                     if (p["fields"].get("brandId", {}).get("stringValue") or "") not in brand_ids
                     and p["fields"].get("brandId", {}).get("stringValue"))
    dangling_c = sum(1 for p in dst_products
                     if (p["fields"].get("categoryId", {}).get("stringValue") or "") not in cat_ids
                     and p["fields"].get("categoryId", {}).get("stringValue"))
    print(f"  参照切れ                 ブランド {dangling_b} 件 / カテゴリ {dangling_c} 件")
    if dangling_b or dangling_c:
        ok = False
    print("\n判定:", "問題なし" if ok else "⚠ 不足があります。migrate を再実行してください（冪等）")


def cmd_delete_src(confirmed):
    if not confirmed:
        raise SystemExit("削除は --yes を付けたときだけ実行します。")
    data = collect()
    print("HAUS から削除します:")
    summarize(data)
    # 削除前に、移行先へ確実に入っていることを最終確認する
    dst_ids = {doc_id(d) for d in query(DST, "products")}
    src_ids = {doc_id(d) for d in data["products"]}
    if not src_ids <= dst_ids:
        raise SystemExit(f"中止: 移行先に未投入の商品が {len(src_ids - dst_ids)} 件あります。先に migrate/verify を。")

    writes = []
    for collection in ["products", "productGroups", "inventory"]:
        for d in data[collection]:
            writes.append({"delete":
                f"projects/{PROJECT}/databases/{DB}/documents/stores/{SRC}/{collection}/{doc_id(d)}"})
    # 売り場マスタは過去の売上分析が参照するため削除せず、無効化して一覧から外す
    sa = data["productSalesAreas"][0] if data["productSalesAreas"] else None
    if sa:
        fields = dict(sa["fields"])
        fields["isActive"] = {"booleanValue": False}
        fields["note"] = {"stringValue": "GROOM HAUS(store_0a558)へ移管済み"}
        writes.append({"update": {
            "name": f"projects/{PROJECT}/databases/{DB}/documents/stores/{SRC}/productSalesAreas/{SALES_AREA}",
            "fields": fields}})
    print(f"\n{len(writes)} 件を削除/更新します…")
    n = commit(writes)
    print(f"完了: {n} 件。HAUSのペット売場は無効化し、商品・グループ・在庫を削除しました。")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "backup":
        cmd_backup()
    elif cmd == "dryrun":
        cmd_dryrun()
    elif cmd == "migrate":
        cmd_migrate()
    elif cmd == "verify":
        cmd_verify()
    elif cmd == "delete-src":
        cmd_delete_src("--yes" in sys.argv)
    else:
        print(__doc__)
