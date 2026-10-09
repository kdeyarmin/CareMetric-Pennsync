import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const AUTHORITY = '["test-user","test-agency","test-membership",1]';

async function freshRealm() {
  vi.resetModules();
  localStorage.clear();
  const gate = await import('./tenantSdkRealmGate');
  const windows = await import('./authorityBoundWindows');
  gate.openTenantSdkRealm(AUTHORITY);
  return { gate, windows };
}

describe('authority-bound auxiliary-window containment', () => {
  // Interceptors installed by a test are removed even when it fails, so a
  // failure cannot leave window.open patched for the tests after it.
  const cleanups = [];

  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('opens nothing until the document interceptor has captured the native opener', async () => {
    const { windows } = await freshRealm();
    const nativeOpen = vi.fn();
    vi.spyOn(window, 'open').mockImplementation(nativeOpen);

    expect(windows.openAuthorityBoundWindow('https://safe.example/file')).toBeNull();
    expect(windows.openAuthorityBoundWindow()).toBeNull();
    expect(windows.requestAuthorityBoundWindow('https://safe.example/file').opened).toBe(false);
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it('opens an external URL severed, with no handle back to the app', async () => {
    const { windows } = await freshRealm();
    const nativeOpen = vi.fn(() => null);
    window.open = nativeOpen;
    cleanups.push(windows.installAuthorityBoundLinkInterceptor());

    const result = windows.requestAuthorityBoundWindow('https://www.cms.gov/oasis');
    expect(result).toEqual({ opened: true, window: null });
    expect(nativeOpen).toHaveBeenCalledWith('https://www.cms.gov/oasis', '_blank', 'noopener,noreferrer');
    expect(windows.openAuthorityBoundWindow('https://www.cms.gov/oasis')).toBeNull();
  });

  it('gives a blank print window a handle and closes it when the tenant lease ends', async () => {
    const { gate, windows } = await freshRealm();
    const child = { close: vi.fn(), document: {} };
    const nativeOpen = vi.fn(() => child);
    window.open = nativeOpen;
    cleanups.push(windows.installAuthorityBoundLinkInterceptor());

    expect(windows.openAuthorityBoundWindow()).toBe(child);
    expect(nativeOpen).toHaveBeenCalledWith('', '_blank');
    expect(child.close).not.toHaveBeenCalled();

    gate.closeTenantSdkRealm();
    expect(child.close).toHaveBeenCalledTimes(1);
    expect(windows.openAuthorityBoundWindow()).toBeNull();
  });

  it('closes every open child on explicit teardown', async () => {
    const { windows } = await freshRealm();
    const first = { close: vi.fn() };
    const second = { close: vi.fn() };
    window.open = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    cleanups.push(windows.installAuthorityBoundLinkInterceptor());

    windows.openAuthorityBoundWindow();
    windows.openAuthorityBoundWindow('/manuals/nurse.pdf');
    windows.closeAuthorityBoundWindows();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('refuses script, data, credentialed and untracked object URLs', async () => {
    const { windows } = await freshRealm();
    const nativeOpen = vi.fn(() => ({ close: vi.fn() }));
    window.open = nativeOpen;
    cleanups.push(windows.installAuthorityBoundLinkInterceptor());

    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'https://user:secret@files.example/doc.pdf',
      `blob:${window.location.origin}/not-created-here`,
      'ftp://files.example/doc.pdf',
    ]) {
      expect(windows.requestAuthorityBoundWindow(url)).toEqual({ opened: false, window: null });
    }
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it('patches direct window.open for the full installed lifetime and restores on cleanup', async () => {
    const { windows } = await freshRealm();
    const nativeOpen = vi.fn();
    window.open = nativeOpen;

    const remove = windows.installAuthorityBoundLinkInterceptor();
    expect(window.open('https://safe.example/file', '_blank')).toBeNull();
    expect(nativeOpen).not.toHaveBeenCalled();

    remove();
    window.open('https://safe.example/file', '_blank');
    expect(nativeOpen).toHaveBeenCalledTimes(1);
  });

  it('disables the native print dialog for the installed document lifetime', async () => {
    const { windows } = await freshRealm();
    const nativePrint = vi.fn();
    window.print = nativePrint;

    const remove = windows.installAuthorityBoundLinkInterceptor();
    expect(window.print()).toBeUndefined();
    expect(nativePrint).not.toHaveBeenCalled();

    remove();
    window.print();
    expect(nativePrint).toHaveBeenCalledTimes(1);
  });

  it('blocks declarative and programmatic blank-target links before app listeners', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const anchor = document.createElement('a');
    anchor.href = 'https://safe.example/document';
    anchor.target = '_blank';
    anchor.textContent = 'Open';
    const clicked = vi.fn();
    anchor.addEventListener('click', clicked);
    document.body.append(anchor);

    expect(anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
      .toBe(false);
    expect(clicked).not.toHaveBeenCalled();

    anchor.click();
    expect(clicked).not.toHaveBeenCalled();
    remove();
  });

  it.each([
    ['middle click', 'auxclick', { button: 1 }],
    ['control click', 'click', { button: 0, ctrlKey: true }],
    ['meta click', 'click', { button: 0, metaKey: true }],
    ['shift click', 'click', { button: 0, shiftKey: true }],
  ])('blocks %s auxiliary navigation without an explicit blank target', async (
    _label,
    type,
    init,
  ) => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const anchor = document.createElement('a');
    anchor.href = '/clinical-record';
    const clicked = vi.fn();
    anchor.addEventListener(type, clicked);
    document.body.append(anchor);

    const allowed = anchor.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    }));
    expect(allowed).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    remove();
  });

  it('blocks detached programmatic downloads after the realm closes', async () => {
    const { gate, windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const anchor = document.createElement('a');
    anchor.href = 'blob:https://example.test/private';
    anchor.download = 'private.pdf';
    const clicked = vi.fn();
    anchor.addEventListener('click', clicked);

    gate.closeTenantSdkRealm();
    anchor.click();
    expect(clicked).not.toHaveBeenCalled();
    remove();
  });

  it('blocks retained same-tab anchors after the staff realm terminally closes', async () => {
    const { gate, windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const anchor = document.createElement('a');
    anchor.href = '/PatientDetails?id=retained-patient';
    anchor.target = '_self';
    const clicked = vi.fn();
    anchor.addEventListener('click', clicked);

    gate.closeTenantSdkRealm();
    anchor.click();

    expect(clicked).not.toHaveBeenCalled();
    remove();
  });

  it('cancels an otherwise allowed activation when authority closes during dispatch', async () => {
    const { gate, windows } = await freshRealm();
    const nativeDispatch = window.EventTarget.prototype.dispatchEvent;
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const anchor = document.createElement('a');
    anchor.href = '#same-document';
    const closeDuringTarget = vi.fn(() => gate.poisonTenantSdkRealm());
    const reachedLateTarget = vi.fn();
    anchor.addEventListener('click', closeDuringTarget);
    anchor.addEventListener('click', reachedLateTarget);
    document.body.append(anchor);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    const allowed = Reflect.apply(nativeDispatch, anchor, [event]);

    expect(allowed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(closeDuringTarget).toHaveBeenCalledTimes(1);
    expect(reachedLateTarget).not.toHaveBeenCalled();
    remove();
  });

  it.each([
    ['target property', (anchor) => { anchor.target = 'late-window'; }],
    ['target attribute', (anchor) => { anchor.setAttribute('target', 'late-window'); }],
    ['target Attr value', (anchor) => {
      anchor.setAttribute('target', '_self');
      anchor.getAttributeNode('target').value = 'late-window';
    }],
    ['untracked blob href', (anchor) => {
      anchor.href = `blob:${window.location.origin}/late-private-viewer`;
    }],
    ['base target', () => {
      const base = document.createElement('base');
      document.head.append(base);
      base.target = 'late-window';
    }],
  ])('cancels activation when a listener creates a late auxiliary %s', async (
    _label,
    mutate,
  ) => {
    const { windows } = await freshRealm();
    const nativeDispatch = window.EventTarget.prototype.dispatchEvent;
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const anchor = document.createElement('a');
    anchor.href = '#same-document';
    anchor.target = '_self';
    const mutateDuringTarget = vi.fn(() => mutate(anchor));
    const reachedLateTarget = vi.fn();
    anchor.addEventListener('click', mutateDuringTarget);
    anchor.addEventListener('click', reachedLateTarget);
    document.body.append(anchor);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    const allowed = Reflect.apply(nativeDispatch, anchor, [event]);

    expect(allowed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(mutateDuringTarget).toHaveBeenCalledTimes(1);
    expect(reachedLateTarget).not.toHaveBeenCalled();
    document.querySelector('base')?.remove();
    remove();
  });

  it.each(['named-report', '_new', '_top', '_parent', ' ', '_self '])(
    'blocks the non-self target %s before application listeners',
    async (target) => {
      const { windows } = await freshRealm();
      const remove = windows.installAuthorityBoundLinkInterceptor();
      const anchor = document.createElement('a');
      anchor.href = '/clinical-record';
      anchor.target = target;
      const clicked = vi.fn();
      anchor.addEventListener('click', clicked);
      document.body.append(anchor);

      anchor.click();

      expect(clicked).not.toHaveBeenCalled();
      remove();
    },
  );

  it('honors an unsafe base target and an explicit self override', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const base = document.createElement('base');
    base.target = 'report-window';
    document.head.append(base);
    const inherited = document.createElement('a');
    inherited.href = '/clinical-record';
    const inheritedClick = vi.fn();
    inherited.addEventListener('click', inheritedClick);
    const self = document.createElement('a');
    self.href = '#same-document';
    self.target = '_self';
    const selfClick = vi.fn((event) => event.preventDefault());
    self.addEventListener('click', selfClick);
    document.body.append(inherited, self);

    inherited.click();
    self.click();

    expect(inheritedClick).not.toHaveBeenCalled();
    expect(selfClick).toHaveBeenCalledTimes(1);
    base.remove();
    remove();
  });

  it('blocks area targets and detached synthetic prototype dispatch', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const area = document.createElement('area');
    area.href = '/patient-photo';
    area.target = 'preview';
    const areaClick = vi.fn();
    area.addEventListener('click', areaClick);

    const allowed = window.EventTarget.prototype.dispatchEvent.call(
      area,
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(allowed).toBe(false);
    expect(areaClick).not.toHaveBeenCalled();
    remove();
  });

  it.each(['contextmenu', 'dragstart'])(
    'blocks the native %s link escape path',
    async (type) => {
      const { windows } = await freshRealm();
      const nativeDispatch = window.EventTarget.prototype.dispatchEvent;
      const remove = windows.installAuthorityBoundLinkInterceptor();
      const anchor = document.createElement('a');
      anchor.href = '/PatientDetails?id=patient-a';
      const reachedApp = vi.fn();
      anchor.addEventListener(type, reachedApp);
      document.body.append(anchor);

      const allowed = Reflect.apply(nativeDispatch, anchor, [
        new MouseEvent(type, { bubbles: true, cancelable: true }),
      ]);

      expect(allowed).toBe(false);
      expect(reachedApp).not.toHaveBeenCalled();
      remove();
    },
  );

  it('uses composedPath to stop an auxiliary link inside an open shadow root', async () => {
    const { windows } = await freshRealm();
    const nativeDispatch = window.EventTarget.prototype.dispatchEvent;
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const anchor = document.createElement('a');
    anchor.href = '/PatientDetails?id=patient-a';
    anchor.target = 'patient-window';
    const reachedApp = vi.fn();
    anchor.addEventListener('click', reachedApp);
    shadow.append(anchor);
    document.body.append(host);

    const allowed = Reflect.apply(nativeDispatch, anchor, [
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    ]);

    expect(allowed).toBe(false);
    expect(reachedApp).not.toHaveBeenCalled();
    remove();
  });

  it('guards closed shadow roots created after install, including cached native click', async () => {
    const { gate, windows } = await freshRealm();
    const cachedNativeClick = window.HTMLElement.prototype.click;
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const blocked = document.createElement('a');
    blocked.href = '/PatientDetails?id=closed-shadow-patient';
    blocked.target = 'patient-window';
    const blockedTarget = vi.fn();
    blocked.addEventListener('click', blockedTarget);
    shadow.append(blocked);
    document.body.append(host);

    Reflect.apply(cachedNativeClick, blocked, []);
    expect(blockedTarget).not.toHaveBeenCalled();

    const sameTab = document.createElement('a');
    sameTab.href = '#same-tab';
    const closeDuringTarget = vi.fn(() => gate.poisonTenantSdkRealm());
    const reachedLateTarget = vi.fn();
    sameTab.addEventListener('click', closeDuringTarget);
    sameTab.addEventListener('click', reachedLateTarget);
    shadow.append(sameTab);

    Reflect.apply(cachedNativeClick, sameTab, []);
    expect(closeDuringTarget).toHaveBeenCalledTimes(1);
    expect(reachedLateTarget).not.toHaveBeenCalled();
    remove();
  });

  it('blocks form, formtarget, requestSubmit, and direct prototype submission routes', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const form = document.createElement('form');
    form.target = 'report-window';
    const button = document.createElement('button');
    button.type = 'submit';
    const buttonClick = vi.fn();
    const submit = vi.fn();
    button.addEventListener('click', buttonClick);
    form.addEventListener('submit', submit);
    form.append(button);
    document.body.append(form);

    button.click();
    form.requestSubmit(button);
    window.HTMLFormElement.prototype.submit.call(form);

    expect(buttonClick).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    form.target = '_self';
    button.setAttribute('formtarget', '_blank');
    button.click();
    expect(buttonClick).not.toHaveBeenCalled();
    remove();
  });

  it('rejects cross-document form prototype calls', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const foreignForm = frame.contentDocument.createElement('form');
    const submitted = vi.fn();
    foreignForm.addEventListener('submit', submitted);

    window.HTMLFormElement.prototype.requestSubmit.call(foreignForm);
    window.HTMLFormElement.prototype.submit.call(foreignForm);

    expect(submitted).not.toHaveBeenCalled();
    frame.remove();
    remove();
  });

  it('blocks base-target form submission even when the form has no target attribute', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();
    const base = document.createElement('base');
    base.target = '_new';
    document.head.append(base);
    const form = document.createElement('form');
    const button = document.createElement('button');
    button.type = 'submit';
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    form.append(button);
    document.body.append(form);

    button.click();

    expect(clicked).not.toHaveBeenCalled();
    base.remove();
    remove();
  });

  it('blocks both legacy document.open auxiliary and retained stream overloads', async () => {
    const { windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();

    expect(document.open('/patient', 'patient-window', 'popup')).toBeNull();
    expect(window.Document.prototype.open.call(
      document,
      '/patient',
      'patient-window',
      'popup',
    )).toBeNull();
    expect(document.open()).toBeNull();
    expect(window.Document.prototype.open.call(document)).toBeNull();
    remove();
  });

  it('tracks object URLs against the exact lease and revokes them on poison', async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const created = `blob:${window.location.origin}/patient-a`;
    const nativeCreate = vi.fn(() => created);
    const nativeRevoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: nativeCreate,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: nativeRevoke,
    });
    let remove;
    try {
      const { gate, windows } = await freshRealm();
      remove = windows.installAuthorityBoundLinkInterceptor();

      expect(URL.createObjectURL(new Blob(['patient-a']))).toBe(created);
      expect(nativeCreate).toHaveBeenCalledTimes(1);

      gate.poisonTenantSdkRealm();

      expect(nativeRevoke).toHaveBeenCalledWith(created);
      expect(() => URL.createObjectURL(new Blob(['patient-b']))).toThrow();
    } finally {
      remove?.();
      if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor);
      else delete URL.createObjectURL;
      if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
      else delete URL.revokeObjectURL;
    }
  });

  it('revokes tracked URLs before restoring native URL methods during teardown', async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const created = `blob:${window.location.origin}/teardown-order`;
    const nativeCreate = vi.fn(() => created);
    let guardedMethodWasStillInstalled = false;
    const nativeRevoke = vi.fn(() => {
      guardedMethodWasStillInstalled = URL.revokeObjectURL !== nativeRevoke;
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: nativeCreate,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: nativeRevoke,
    });
    let remove;
    try {
      const { windows } = await freshRealm();
      remove = windows.installAuthorityBoundLinkInterceptor();
      expect(URL.createObjectURL(new Blob(['protected']))).toBe(created);

      remove();
      remove = null;

      expect(nativeRevoke).toHaveBeenCalledWith(created);
      expect(guardedMethodWasStillInstalled).toBe(true);
      expect(URL.revokeObjectURL).toBe(nativeRevoke);
    } finally {
      remove?.();
      if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor);
      else delete URL.createObjectURL;
      if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
      else delete URL.revokeObjectURL;
    }
  });

  it('terminally poisons the raw document realm on pagehide', async () => {
    const { gate, windows } = await freshRealm();
    const remove = windows.installAuthorityBoundLinkInterceptor();

    window.dispatchEvent(new Event('pagehide'));

    expect(gate.isTenantSdkRealmOpen()).toBe(false);
    expect(gate.openTenantSdkRealm(AUTHORITY)).toBe(false);
    remove();
  });

  it('allows only a tracked explicit blob download while authority is open', async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    let sequence = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => `blob:${window.location.origin}/tracked-${++sequence}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    let remove;
    try {
      const { windows } = await freshRealm();
      remove = windows.installAuthorityBoundLinkInterceptor();
      const tracked = URL.createObjectURL(new Blob(['tracked']));
      const allowed = document.createElement('a');
      allowed.href = tracked;
      allowed.download = 'tracked.pdf';
      const allowedClick = vi.fn((event) => event.preventDefault());
      allowed.addEventListener('click', allowedClick);
      const foreign = document.createElement('a');
      foreign.href = `blob:${window.location.origin}/foreign`;
      foreign.download = 'foreign.pdf';
      const foreignClick = vi.fn();
      foreign.addEventListener('click', foreignClick);

      allowed.click();
      foreign.click();

      expect(allowedClick).toHaveBeenCalledTimes(1);
      expect(foreignClick).not.toHaveBeenCalled();
    } finally {
      remove?.();
      if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor);
      else delete URL.createObjectURL;
      if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
      else delete URL.revokeObjectURL;
    }
  });

  it('rolls back partial prototype patches and poisons the realm when a required patch fails', async () => {
    const { gate, windows } = await freshRealm();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    const originalOpen = frameWindow.open;
    const originalDispatch = frameWindow.EventTarget.prototype.dispatchEvent;
    const originalClick = frameWindow.HTMLElement.prototype.click;
    const originalAttachShadow = frameWindow.Element.prototype.attachShadow;
    class UnpatchableURL extends frameWindow.URL {}
    Object.defineProperty(UnpatchableURL, 'createObjectURL', {
      configurable: false,
      writable: false,
      value: vi.fn(() => 'blob:https://example.test/unpatchable'),
    });
    Object.defineProperty(UnpatchableURL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(frameWindow, 'URL', {
      configurable: true,
      value: UnpatchableURL,
    });

    expect(() => windows.installAuthorityBoundLinkInterceptor(frameDocument)).toThrow(
      /browser authority guard/i,
    );
    expect(frameWindow.open).toBe(originalOpen);
    expect(frameWindow.EventTarget.prototype.dispatchEvent).toBe(originalDispatch);
    expect(frameWindow.HTMLElement.prototype.click).toBe(originalClick);
    expect(frameWindow.Element.prototype.attachShadow).toBe(originalAttachShadow);
    expect(gate.isTenantSdkRealmOpen()).toBe(false);
    frame.remove();
  });

  it('bootstraps App only after the atomic guard set and closes every token realm', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.jsx'), 'utf8');
    const installIndex = main.lastIndexOf('installDocumentAuthorityGuards()');
    const appImportIndex = main.indexOf("import('@/App.jsx')");

    expect(main).not.toMatch(/^import\s+.*App\.jsx/m);
    expect(main.indexOf('currentFrameMayBootstrap()')).toBeLessThan(installIndex);
    expect(main).toContain('window.top === window.self');
    expect(main).not.toContain('import.meta.env.DEV === true');
    expect(installIndex).toBeGreaterThan(-1);
    expect(appImportIndex).toBeGreaterThan(installIndex);
    expect(main).toContain("event.key === 'base44_access_token'");
    expect(main).toContain("event.key === 'base44_pending_access_token'");
    expect(main).toContain("event.key === 'token'");
    expect(main).toContain("event.key === 'base44_app_id'");
    expect(main).toContain("event.key === 'base44_server_url'");
    expect(main).toContain("event.key === 'base44_functions_version'");
    expect(main).toMatch(/poisonTenantSdkRealm\(\)[\s\S]*closePublicCapabilityRealm\(\)[\s\S]*closeAuthorityBoundWindows\(\)/);
    expect(main).toContain('renderSecureBootstrapBlocked()');
    expect(main).not.toMatch(/postMessage\([^\n]*,\s*['"]\*['"]\)/);
  });

  it('leaves each released public bearer to the page that consumes and scrubs it', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.jsx'), 'utf8');
    // Both the signer portal and the provider follow-up portal were released
    // (2026-10-08). Neither bearer is stripped before the app loads: each page
    // reads its token once through its capability lease and scrubs it from the
    // address bar in a layout effect, before anything renders.
    expect(main).not.toMatch(/scrubRetiredPublicTokenBeforeAppImport/);
    expect(main).not.toMatch(/segment !== 'signer'|segment !== 'followup'/);
    for (const page of ['src/pages/SignerPortal.jsx', 'src/pages/ProviderFollowUpPortal.jsx']) {
      const source = readFileSync(join(process.cwd(), page), 'utf8');
      expect(source, page).toMatch(/useLayoutEffect\(\(\) => \{\s*scrubPublicCapabilityParameter\('token'\);/);
      expect(source, page).toMatch(/usePublicCapabilityLease\(\)/);
      expect(source, page).toMatch(/const \[token\] = useState\(initialToken\)/);
    }
  });

  it('limits descendant frames to privacy-enhanced YouTube education and keeps auxiliary links same-tab', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const education = readFileSync(
      join(process.cwd(), 'src/pages/NurseEducationVideos.jsx'),
      'utf8',
    );
    const referral = readFileSync(
      join(process.cwd(), 'src/components/hub-tabs/ReferralAdmissionNote.jsx'),
      'utf8',
    );
    const sameTabLinks = [
      ['src/components/learning/CourseCatalogDetail.jsx', '<a'],
      ['src/components/training/TrainingVideoStudio.jsx', '<a'],
    ];
    // AgencySettings' one auxiliary link was the CMS wage-index link inside the
    // PDGM location card, which went with the PDGM payment features. The page
    // has no anchor left, so it is held to the stricter form: nothing on it may
    // open an auxiliary window at all, by either route.
    const agencySettings = readFileSync(join(process.cwd(), 'src/pages/AgencySettings.jsx'), 'utf8');
    expect(agencySettings).not.toContain('openAuthorityBoundWindow');
    expect(agencySettings).not.toMatch(/target=["']_blank["']/);
    expect(agencySettings).not.toMatch(/window\.open\(/);

    expect(html).toMatch(
      /Content-Security-Policy[^>]+object-src 'none'; base-uri 'none'; frame-src https:\/\/www\.youtube-nocookie\.com; form-action 'self'/,
    );
    expect(education).toContain('https://www.youtube-nocookie.com/embed/');
    expect(education).not.toContain('https://www.youtube.com/embed/');
    expect(referral).not.toMatch(/<iframe\b/i);
    expect(referral).toContain('Continue to Smart Note');

    for (const [path, anchorMarker] of sameTabLinks) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      expect(source).toContain(anchorMarker);
      expect(source).not.toContain('openAuthorityBoundWindow');
    }
  });
});