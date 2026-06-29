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
// no hard-coded owner email, and super-admin is determined by account_type.

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

test("isSuperAdmin keys off account_type (no email fallback when unconfigured)", () => {
  assert.equal(isSuperAdmin({ email: "other@x.com", account_type: "super_admin" }), true);
  // No email override when SUPER_ADMIN_EMAIL is unset.
  assert.equal(isSuperAdmin({ email: "kdeyarmin@comcast.net", account_type: "user" }), false);
  assert.equal(isSuperAdmin(null), false);
  assert.equal(isSuperAdmin(undefined), false);
});

test("isSuperAdmin is false for everyone else", () => {
  assert.equal(isSuperAdmin({ email: "other@x.com", account_type: "agency_admin" }), false);
  assert.equal(isSuperAdmin({ email: "other@x.com", role: "admin" }), false);
});

test("isAdminLike covers admin role and admin account types (no email fallback when unconfigured)", () => {
  assert.equal(isAdminLike({ role: "admin" }), true);
  assert.equal(isAdminLike({ account_type: "agency_admin" }), true);
  assert.equal(isAdminLike({ account_type: "super_admin" }), true);
  // The previously-special owner email is NOT admin-like without an explicit role / account_type.
  assert.equal(isAdminLike({ email: "kdeyarmin@comcast.net", role: "user", account_type: "user" }), false);
  assert.equal(isAdminLike({ email: "nurse@x.com", role: "user", account_type: "user" }), false);
  assert.equal(isAdminLike(null), false);
});
