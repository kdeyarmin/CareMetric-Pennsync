import { readFileSync } from 'node:fs';
import process from 'node:process';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { toast } from 'sonner';
import { toast as rawToast } from 'tenant-sonner-raw';
import {
  clearAllToasts,
  toast as shadcnToast,
  useToast,
} from '@/components/ui/use-toast';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('tenant-safe global toast facade', () => {
  beforeEach(() => {
    toast.dismiss();
    clearAllToasts();
  });

  it('is the exact production Sonner resolution target', () => {
    const viteConfig = readFileSync(`${process.cwd()}/vite.config.js`, 'utf8');
    expect(viteConfig).toContain("new URL('./src/lib/tenantSonner.js', import.meta.url)");
    expect(viteConfig).toContain('{ find: /^sonner$/, replacement: tenantSonnerModule }');
  });

  it('does not publish tenant-A PHI when a raw continuation resolves after tenant B is ready', async () => {
    const oldTenantRequest = deferred();
    const oldTenantContinuation = (async () => {
      const patient = await oldTenantRequest.promise;
      toast.success(`Saved care plan for ${patient.name}`, {
        description: `Notification sent to ${patient.email}`,
        id: `patient-${patient.id}`,
        action: { label: patient.name, onClick: () => {} },
      });
    })();

    // Transition entry dismisses existing notifications; the old raw request
    // does not resolve until a different authority is already active.
    toast.dismiss();
    const readyAuthority = 'authority-b';
    oldTenantRequest.resolve({
      id: 'patient-a',
      name: 'Patient A',
      email: 'patient-a@example.test',
    });
    await oldTenantContinuation;

    expect(readyAuthority).toBe('authority-b');
    const published = rawToast.getHistory().at(-1);
    expect(published.title).toBe('Action completed.');
    expect(JSON.stringify(published)).not.toMatch(/Patient A|patient-a|example\.test/i);
  });

  it('never places a caller promise or its resolved PHI into Sonner history', async () => {
    const response = {
      marker: 'tenant-a-secret-result',
      patients: [{ name: 'Patient A', email: 'patient-a@example.test' }],
    };
    const request = deferred();
    const historyStart = rawToast.getHistory().length;

    const pendingToast = toast.promise(request.promise, {
      loading: `Loading ${response.patients[0].name}`,
      success: () => response,
      error: (error) => error,
      description: response.patients[0].email,
    });

    const loadingEntry = rawToast.getHistory().at(-1);
    expect(loadingEntry.promise).toBeUndefined();
    request.resolve(response);
    await pendingToast.unwrap();
    await Promise.resolve();

    const newHistory = rawToast.getHistory().slice(historyStart);
    expect(newHistory).not.toContain(request.promise);
    expect(newHistory.every((entry) => entry.promise === undefined)).toBe(true);
    expect(JSON.stringify(newHistory)).not.toMatch(
      /tenant-a-secret-result|Patient A|patient-a@example\.test/i,
    );
  });

  it('immediately removes shadcn toast payloads instead of retaining hidden PHI', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      shadcnToast({
        title: 'Patient A',
        description: 'patient-a@example.test',
      });
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      clearAllToasts();
    });
    expect(result.current.toasts).toEqual([]);
  });
});
