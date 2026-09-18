import { describe, it, expect } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';

describe('finite independent app adapter', () => {
  it('preserves default backend and rejects foreign targets, secret keys and unbound actors before I/O', () => {
    expect(readIndependentStagingConfig({})).toBeNull();
    for (const replacement of [
      { VITE_PENNSYNC_BACKEND: 'typo' }, { VITE_PENNSYNC_STAGING_PROJECT_URL: 'https://foreign.supabase.co' },
      { VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY: 'sb_secret_forbidden' }, { VITE_PENNSYNC_STAGING_ACTORS: '{}' },
    ]) expect(() => readIndependentStagingConfig({ ...stagingEnv, ...replacement })).toThrow();
  });
  it('projects exact legacy authority and synthetic names without clinical/profile claims or generic operations', async () => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    expect(await adapter.authority.me()).toEqual({ id: '6aac58fe36c13a1c49ba7cf8', email: stagingEmails[0] });
    const listed = await adapter.authority.listMyTenantMemberships();
    expect(listed.data.memberships[0].tenant_role).toBe('agency_admin');
    const input = { agency_id: 'agency-a', mode: 'page', purpose: 'roster', sort: 'id_asc', page_size: 50, cursor: null };
    const page = await adapter.raw.functions.invoke('listAuthorizedPatients', input);
    expect(page.data.patients).toEqual([{ id: 'patient-0', first_name: 'Synthetic', last_name: 'Patient A1' }]);
    const count = fixture.requests.length;
    await expect(adapter.raw.functions.invoke('createAuthorizedPatient', {})).rejects.toThrow('STAGING_OPERATION_UNAVAILABLE');
    await expect(adapter.raw.functions.invoke('listAuthorizedPatients', { ...input, purpose: 'patient_management' })).rejects.toThrow();
    expect(fixture.requests).toHaveLength(count);
    expect(adapter.raw.entities).toEqual({});
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
  it('requires live authority, rejects changed cursor scope, and fences delayed results on terminal cleanup', async () => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    await expect(adapter.authority.getMyTenantContext({ agency_id: 'agency-b' })).rejects.toMatchObject({ status: 403 });
    const input = { agency_id: 'agency-a', mode: 'page', purpose: 'roster', sort: 'id_asc', page_size: 50,
      cursor: { after_id: 'patient-0', membership_version: 999 } };
    await expect(adapter.raw.functions.invoke('listAuthorizedPatients', input)).rejects.toThrow('STAGING_PATIENT_CURSOR_CHANGED');
    fixture.beforeReturn = () => adapter.raw.cleanup();
    await expect(adapter.raw.functions.invoke('listAuthorizedPatients', { ...input, cursor: null })).rejects.toThrow();
    expect(adapter.auth.hasSession()).toBe(false);
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
  it('a replaced login catch cannot revoke the newer session on the same actor client', async () => {
    const fixture = stagingFixture();
    let entered, release, held = false;
    const arrival = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), {
      fetchImpl: async (url, options) => {
        const response = await fixture.fetch(url, options);
        if (!held && url.endsWith('/user')) { held = true; entered(); await gate; }
        return response;
      },
    });
    const first = adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password').catch(error => error.code);
    await arrival;
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    release(); expect(await first).toBe('STALE_AUTHORITY_SESSION');
    expect(adapter.auth.hasSession()).toBe(true); expect(fixture.live.size).toBe(1);
    expect((await adapter.authority.me()).email).toBe(stagingEmails[0]);
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
  it('retains failed cleanup in the actor pool and retries it before a different login', async () => {
    const fixture = stagingFixture();
    let failCleanup = true;
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), {
      fetchImpl: (url, options) => {
        if (url.endsWith('/logout?scope=local') && failCleanup) {
          failCleanup = false;
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return fixture.fetch(url, options);
      },
    });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    await expect(adapter.auth.signOut()).rejects.toMatchObject({ code: 'AUTHORITY_SESSION_CLEANUP_FAILED' });
    expect(adapter.auth.hasSession()).toBe(false); expect(fixture.live.size).toBe(1);
    await expect(adapter.authority.me()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await adapter.auth.signIn(stagingEmails[3], 'Synthetic-accepted-password');
    expect(fixture.live.size).toBe(1);
    expect((await adapter.authority.me()).email).toBe(stagingEmails[3]);
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
});
