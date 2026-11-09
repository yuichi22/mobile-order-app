import test from "node:test";
import assert from "node:assert/strict";
import {
  coreLoginAccessError,
  coreLoginUrl,
  isTicketFormat,
  parseCoreLoginBody,
  ticketDocId,
  ticketError,
} from "./coreLoginLogic.js";

test("Core の本文を整える（メールは小文字、app は order か pos）", () => {
  assert.deepEqual(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", email: " A@B.jp ", app: "order" }), {
    tenantId: "t1",
    spaceId: "s1",
    email: "a@b.jp",
    app: "order",
  });
  assert.equal(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", email: "a@b.jp" }).app, "pos");
  assert.equal(parseCoreLoginBody({ tenantId: "t/1", spaceId: "s1", email: "a@b.jp" }), null);
  assert.equal(parseCoreLoginBody({ tenantId: "t1", spaceId: "s1", email: "nope" }), null);
  assert.equal(parseCoreLoginBody(null), null);
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
