import { describe, it, expect, afterEach } from 'vitest';
import { bindTrustedTenantContext, clearTrustedTenantContext } from '@/lib/roles';
import { trustedTenantRequest } from '@/lib/trustedTenantRequest';

/**
 * The tenant every routed call carries.
 *
 * `src/lib/independentStagingAdapter.js` tests `routesPorted` FIRST in its
 * dispatcher, ahead of every special case, so once `VITE_PENNSYNC_API_URL` is
 * set the name `getMyTenantContext` goes to the ported service like any other.
 * `portedCall` refuses a call with no `agency_id`
 * (`STAGING_TENANT_SELECTION_REQUIRED`), and the ported capability has no
 * `agency_id` PARAMETER — it takes the tenant from the request envelope.
 *
 * That works today only because this function is the single source of the
 * options the six revalidation hooks pass, and it names an agency
 * unconditionally: an authority it cannot read becomes `null` rather than
 * options with the agency left out. Returning a request without one would
 * refuse on the routed path while the separate bootstrap seam
 * (`bootstrapMyTenantContext`, which reaches the adapter's `authority` object
 * and never touches the dispatcher) kept working — a dispatcher failure
 * wearing a tenant failure's clothes.
 *
 * So this is the property, pinned: a request either names an agency or is not
 * a request.
 */
const USER = Object.freeze({ id: 'user-1', email: 'nurse@example.test' });

const context = (overrides = {}) => ({
  user_id: 'user-1',
  user_email: 'nurse@example.test',
  membership_id: 'membership-1',
  membership_key: 'agency-1:user-1',
  membership_version: 3,
  agency_id: 'agency-1',
  tenant_role: 'clinician',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-1', name: 'Synthetic Agency', status: 'active' },
  ...overrides,
});

/** Bind the principal the way AuthContext does, and hand back the bound user. */
const bound = (overrides = {}) => bindTrustedTenantContext(USER, context(overrides));

afterEach(() => clearTrustedTenantContext());

describe('trustedTenantRequest', () => {
  it('always names an agency in the options a routed call is built from', () => {
    const request = trustedTenantRequest(bound());
    expect(request).not.toBeNull();
    expect(request.options.agencyId).toBe('agency-1');
  });

  it('carries the membership expectation alongside the agency, never instead of it', () => {
    const { options } = trustedTenantRequest(bound());
    expect(options.expectedMembershipId).toBe('membership-1');
    expect(options.expectedMembershipVersion).toBe(3);
    // The agency is what the adapter lifts into the envelope; an expectation
    // without one would reach `portedCall` and refuse.
    expect(Object.hasOwn(options, 'agencyId')).toBe(true);
  });

  it('refuses rather than returning options with no agency', () => {
    // Whether the binding is rejected or the request is, the observable
    // property is the same and is the one the dispatcher depends on: there is
    // no shape of authority that yields options lacking an agency.
    for (const broken of [{ agency_id: null }, { agency_id: '' }, { agency_id: '   ' }]) {
      expect(trustedTenantRequest(bound(broken))).toBeNull();
    }
  });

  it('refuses a narrowing to an agency the bound authority does not hold', () => {
    expect(trustedTenantRequest(bound(), 'agency-2')).toBeNull();
    // Narrowing to the agency already held is the one accepted form.
    expect(trustedTenantRequest(bound(), 'agency-1')?.options.agencyId).toBe('agency-1');
  });

  it('refuses an unbound principal outright', () => {
    clearTrustedTenantContext();
    expect(trustedTenantRequest(USER)).toBeNull();
  });
});
