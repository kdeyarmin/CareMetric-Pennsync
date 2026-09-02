import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUPER_ADMIN_EMAIL,
  isSuperAdminEmail,
  isSuperAdmin,
  isAdminLike,
} from "./superAdmin.js";

// The email-based super-admin override is OPT-IN via VITE_SUPER_ADMIN_EMAIL.
// These tests run with the env var unset, so they assert the secure default:
// no hard-coded owner email and no self-mutable custom field can grant access.

test("SUPER_ADMIN_EMAIL is empty unless VITE_SUPER_ADMIN_EMAIL is configured", () => {
  assert.equal(SUPER_ADMIN_EMAIL, "");
});

test("isSuperAdminEmail never matches when no owner email is configured", () => {
  assert.equal(isSuperAdminEmail("kdeyarmin@comcast.net"), false);
  assert.equal(isSuperAdminEmail("someone@else.com"), false);
  assert.equal(isSuperAdminEmail(""), false);
  assert.equal(isSuperAdminEmail(null), false);
  assert.equal(isSuperAdminEmail(undefined), false);
});

test("isSuperAdmin fails closed when the configured owner email is absent", () => {
  assert.equal(isSuperAdmin({ email: "other@x.com", role: "admin", account_type: "super_admin" }), false);
  assert.equal(isSuperAdmin({ email: "kdeyarmin@comcast.net", role: "admin" }), false);
  assert.equal(isSuperAdmin(null), false);
  assert.equal(isSuperAdmin(undefined), false);
});

test("isSuperAdmin is false for everyone else", () => {
  assert.equal(isSuperAdmin({ email: "other@x.com", account_type: "agency_admin" }), false);
  assert.equal(isSuperAdmin({ email: "other@x.com", role: "admin" }), false);
});

test("isAdminLike trusts only Base44's protected built-in role", () => {
  assert.equal(isAdminLike({ role: "admin" }), true);
  assert.equal(isAdminLike({ role: "user", account_type: "agency_admin" }), false);
  assert.equal(isAdminLike({ role: "user", account_type: "super_admin" }), false);
  // The configured identity can only become super-admin when it also has the
  // protected role; an email or custom account_type alone never suffices.
  assert.equal(isAdminLike({ email: "kdeyarmin@comcast.net", role: "user", account_type: "user" }), false);
  assert.equal(isAdminLike({ email: "nurse@x.com", role: "user", account_type: "user" }), false);
  assert.equal(isAdminLike(null), false);
});
