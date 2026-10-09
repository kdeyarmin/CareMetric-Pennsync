import { getTrustedTenantContext, isAdminView } from '@/lib/roles';

/**
 * Whether the OASIS Center should SHOW its agency-lead tools (supervisor
 * sign-off, the audit queue, agency analytics) to this user.
 *
 * Built from the validated, in-memory tenant context the auth layer bound —
 * never from a self-editable profile field — and mirroring the OASIS record
 * broker's own rule: the platform owner, or an active agency_admin or manager
 * membership. This is a visibility control only; the broker refuses a
 * non-lead's request on its own authority whatever the screen shows.
 */
export function isOasisLeadView(user) {
  if (isAdminView(user)) return true;
  const context = getTrustedTenantContext(user);
  return context?.membership_status === 'active'
    && context.is_platform_owner === false
    && context.tenant_role === 'manager';
}

/**
 * Whether this user may change OASIS automation rules: the built-in admin role,
 * which auth.updateMe cannot grant — the same rule the broker applies.
 */
export function isOasisPlatformOwnerView(user) {
  return user?.role === 'admin';
}
