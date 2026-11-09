import test from "node:test";
import assert from "node:assert/strict";
import {
  coreLoginAccessError,
  coreLoginUrl,
  isTicketFormat,
  parseCoreLoginBody,
  pickStoreAdmin,
  ticketDocId,
  ticketError,
} from "./coreLoginLogic.js";

test("Core の本文を整える（メールは小文字、app は order か pos）", () => {
  assert.deepEqual(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", email: " A@B.jp ", app: "order" }), {
    tenantId: "t1",
    spaceId: "s1",
    email: "a@b.jp",
    app: "order",
    asSpaceAdmin: false,
    posStoreId: null,
  });
  assert.equal(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", email: "a@b.jp" }).app, "pos");
  assert.equal(parseCoreLoginBody({ tenantId: "t/1", spaceId: "s1", email: "a@b.jp" }), null);
  assert.equal(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", email: "nope" }), null);
  assert.equal(parseCoreLoginBody(null), null);
});

test("管理者扱いはメールが無くてもよい（true のときだけ）", () => {
  const r = parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", asSpaceAdmin: true, posStoreId: "store_a" });
  assert.equal(r.email, null);
  assert.equal(r.asSpaceAdmin, true);
  assert.equal(r.posStoreId, "store_a");
  assert.equal(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", asSpaceAdmin: "true" }), null);
  assert.equal(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", asSpaceAdmin: true, posStoreId: "../x" }).posStoreId, null);
});

test("店舗の管理者は owner の最初の人、いなければ manager", () => {
  assert.equal(
    pickStoreAdmin([
      { uid: "s", role: "staff", createdAtMs: 1 },
      { uid: "o2", role: "owner", createdAtMs: 20 },
      { uid: "o1", role: "owner", createdAtMs: 10 },
    ]),
    "o1"
  );
  assert.equal(pickStoreAdmin([{ uid: "m", role: "manager", createdAtMs: 1 }, { uid: "s", role: "staff", createdAtMs: 0 }]), "m");
  assert.equal(pickStoreAdmin([{ uid: "o", role: "owner", createdAtMs: 1, disabled: true }]), null);
  assert.equal(pickStoreAdmin([{ uid: "s", role: "staff", createdAtMs: 1 }]), null);
});

test("その拠点の店舗のスタッフだけ入れる", () => {
  const ok = { disabled: false, profile: { role: "staff", storeId: "store_a" }, linkedStoreIds: ["store_a"] };
  assert.equal(coreLoginAccessError(ok), null);
  assert.equal(coreLoginAccessError({ ...ok, profile: { role: "owner", storeId: "store_a" } }), null);
  assert.equal(coreLoginAccessError({ ...ok, linkedStoreIds: ["store_b"] }), "other-store");
  assert.equal(coreLoginAccessError({ ...ok, linkedStoreIds: [] }), "other-store");
  assert.equal(coreLoginAccessError({ ...ok, profile: null }), "no-profile");
  assert.equal(coreLoginAccessError({ ...ok, profile: { role: "customer", storeId: "store_a" } }), "no-role");
  assert.equal(coreLoginAccessError({ ...ok, disabled: true }), "disabled");
});

test("入場券の状態", () => {
  const now = 1_000_000;
  assert.equal(ticketError({ used: false, expiresAtMs: now + 1 }, now), null);
  assert.equal(ticketError(null, now), "not-found");
  assert.equal(ticketError({ used: true, expiresAtMs: now + 1 }, now), "used");
  assert.equal(ticketError({ used: false, expiresAtMs: now }, now), "expired");
});

test("入場券の形・保存先・URL", () => {
  assert.equal(isTicketFormat("a".repeat(43)), true);
  assert.equal(isTicketFormat("short"), false);
  assert.match(ticketDocId("x".repeat(43)), /^[0-9a-f]{64}$/);
  assert.equal(
    coreLoginUrl("https://pos.example.app", { app: "pos", tenantId: "t1", spaceId: "s1" }, "abc"),
    "https://pos.example.app/sso?app=pos&tenantId=t1&spaceId=s1#ticket=abc"
  );
});
