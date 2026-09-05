import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = process.cwd();

function fileTransfer({ files = true, advertisesFiles = files } = {}) {
  return {
    clearData: vi.fn(),
    files: files ? [new File(['protected'], 'clinical.pdf')] : [],
    items: {
      clear: vi.fn(),
      length: advertisesFiles ? 1 : 0,
      ...(advertisesFiles ? { 0: { kind: 'file' } } : {}),
      [Symbol.iterator]: function* items() {
        if (advertisesFiles) yield this[0];
      },
    },
    types: advertisesFiles ? ['Files'] : ['text/plain'],
  };
}

function dragEvent(type, dataTransfer, { relatedTarget } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  if (relatedTarget !== undefined) {
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  }
  return event;
}

function dropZone(tagName = 'div') {
  const element = document.createElement(tagName);
  element.setAttribute('data-authority-file-drop-zone', '');
  return element;
}

describe('authority-bound native file drops', () => {
  let removeGuard;
  let openTenantSdkRealm;
  let poisonTenantSdkRealm;
  let rotateBrowserAuthorityEpoch;

  beforeEach(async () => {
    vi.resetModules();
    ({ rotateBrowserAuthorityEpoch } = await import('@/lib/browserAuthorityEpoch'));
    ({ openTenantSdkRealm, poisonTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate'));
    const { installAuthorityBoundFileDropGuard } = await import(
      '@/lib/authorityBoundFileDrops'
    );
    removeGuard = installAuthorityBoundFileDropGuard(document);
  });

  afterEach(() => {
    removeGuard?.();
    poisonTenantSdkRealm();
    document.body.replaceChildren();
  });

  it('allows a file drop only for the exact realm in which it entered', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const enterTransfer = fileTransfer({ files: false, advertisesFiles: true });
    const dropTransfer = fileTransfer();

    target.dispatchEvent(dragEvent('dragenter', enterTransfer));
    const allowed = target.dispatchEvent(dragEvent('drop', dropTransfer));

    expect(allowed).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(dropTransfer.items.clear).not.toHaveBeenCalled();
  });

  it('captures an OS drag while its file list is protected until drop', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const enterTransfer = fileTransfer({ files: false, advertisesFiles: true });
    const dropTransfer = fileTransfer();

    target.dispatchEvent(dragEvent('dragenter', enterTransfer));
    const allowed = target.dispatchEvent(dragEvent('drop', dropTransfer));

    expect(allowed).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('blocks file drag entry without an open tenant realm before target listeners', () => {
    const target = dropZone();
    const enterHandler = vi.fn();
    const dropHandler = vi.fn();
    target.addEventListener('dragenter', enterHandler);
    target.addEventListener('drop', dropHandler);
    document.body.appendChild(target);
    const enterTransfer = fileTransfer({ files: false, advertisesFiles: true });
    const dropTransfer = fileTransfer();

    const entered = target.dispatchEvent(dragEvent('dragenter', enterTransfer));
    const dropped = target.dispatchEvent(dragEvent('drop', dropTransfer));

    expect(entered).toBe(false);
    expect(dropped).toBe(false);
    expect(enterHandler).not.toHaveBeenCalled();
    expect(dropHandler).not.toHaveBeenCalled();
  });

  it('blocks and clears an unleased file drop before target listeners', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const transfer = fileTransfer();

    const allowed = target.dispatchEvent(dragEvent('drop', transfer));

    expect(allowed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(transfer.items.clear).toHaveBeenCalledTimes(1);
    expect(transfer.clearData).toHaveBeenCalledTimes(1);
  });

  it('blocks a queued file drop synchronously after a cross-tab epoch rotation', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const enterTransfer = fileTransfer();
    const dropTransfer = fileTransfer();

    target.dispatchEvent(dragEvent('dragenter', enterTransfer));
    rotateBrowserAuthorityEpoch();
    const allowed = target.dispatchEvent(dragEvent('drop', dropTransfer));

    expect(allowed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(dropTransfer.items.clear).toHaveBeenCalled();
    expect(dropTransfer.clearData).toHaveBeenCalled();
  });

  it('captures dragstart before file metadata is populated and rejects it after closure', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const startTransfer = fileTransfer({ files: false });
    const dropTransfer = fileTransfer();

    target.dispatchEvent(dragEvent('dragstart', startTransfer));
    poisonTenantSdkRealm();
    const allowed = target.dispatchEvent(dragEvent('drop', dropTransfer));

    expect(allowed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('consumes an authorized file-drag lease after one drop', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const enterTransfer = fileTransfer();
    const firstDropTransfer = fileTransfer();
    const secondDropTransfer = fileTransfer();

    target.dispatchEvent(dragEvent('dragenter', enterTransfer));
    const first = target.dispatchEvent(dragEvent('drop', firstDropTransfer));
    const second = target.dispatchEvent(dragEvent('drop', secondDropTransfer));

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retains one lease while a file drag moves between nested document targets', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const child = document.createElement('span');
    const handler = vi.fn();
    target.appendChild(child);
    target.addEventListener('drop', handler);
    document.body.appendChild(target);

    target.dispatchEvent(dragEvent('dragenter', fileTransfer()));
    child.dispatchEvent(dragEvent('dragenter', fileTransfer()));
    // Older WebKit reports null even for an in-document parent/child move.
    child.dispatchEvent(dragEvent('dragleave', fileTransfer(), { relatedTarget: null }));
    const allowed = target.dispatchEvent(dragEvent('drop', fileTransfer()));

    expect(allowed).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('expires a cancelled OS drag when it truly leaves the document', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);

    target.dispatchEvent(dragEvent('dragenter', fileTransfer()));
    target.dispatchEvent(dragEvent('dragleave', fileTransfer(), { relatedTarget: null }));
    const allowed = target.dispatchEvent(dragEvent('drop', fileTransfer()));

    expect(allowed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('latches an orphan file dragover denied instead of authorizing it late', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);

    const over = target.dispatchEvent(dragEvent('dragover', fileTransfer()));
    const entered = target.dispatchEvent(dragEvent('dragenter', fileTransfer()));
    const dropped = target.dispatchEvent(dragEvent('drop', fileTransfer()));

    expect(over).toBe(false);
    expect(entered).toBe(false);
    expect(dropped).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('expires a dragstart session if a later listener cancels the gesture', async () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    target.addEventListener('dragstart', (event) => event.preventDefault());
    target.addEventListener('drop', handler);
    document.body.appendChild(target);

    target.dispatchEvent(dragEvent('dragstart', fileTransfer({ files: false })));
    await Promise.resolve();
    const dropped = target.dispatchEvent(dragEvent('drop', fileTransfer()));

    expect(dropped).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('blocks the current drop if a later capture listener closes authority', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = dropZone();
    const handler = vi.fn();
    const closeDuringDispatch = () => poisonTenantSdkRealm();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    target.dispatchEvent(dragEvent('dragenter', fileTransfer()));
    document.addEventListener('drop', closeDuringDispatch, true);

    let dropped;
    try {
      dropped = target.dispatchEvent(dragEvent('drop', fileTransfer()));
    } finally {
      document.removeEventListener('drop', closeDuringDispatch, true);
    }

    expect(dropped).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('blocks native file navigation outside a marked drop zone', () => {
    expect(openTenantSdkRealm('authority-a')).toBe(true);
    const target = document.createElement('div');
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);

    const entered = target.dispatchEvent(dragEvent('dragenter', fileTransfer()));
    const dropped = target.dispatchEvent(dragEvent('drop', fileTransfer()));

    expect(entered).toBe(false);
    expect(dropped).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not interfere with non-file application drags outside a tenant realm', () => {
    const target = document.createElement('div');
    const handler = vi.fn();
    target.addEventListener('drop', handler);
    document.body.appendChild(target);
    const transfer = fileTransfer({ files: false });

    target.dispatchEvent(dragEvent('dragstart', transfer));
    const allowed = target.dispatchEvent(dragEvent('drop', transfer));

    expect(allowed).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(transfer.clearData).not.toHaveBeenCalled();
  });

  it('installs before React and covers every protected drag-and-drop surface', () => {
    const main = readFileSync(join(repoRoot, 'src/main.jsx'), 'utf8');
    const installIndex = main.lastIndexOf('installDocumentAuthorityGuards()');
    const appImportIndex = main.indexOf("import('@/App.jsx')");

    expect(installIndex).toBeGreaterThan(-1);
    expect(main).toMatch(/const installs = \[[\s\S]*installAuthorityBoundFileDropGuard/);
    expect(appImportIndex).toBeGreaterThan(installIndex);

    for (const relativePath of [
      'src/components/documents/DocumentIngestionUploader.jsx',
      'src/components/adr/AdrLetterAnalyzer.jsx',
      'src/components/adr/AdrPacketVerifier.jsx',
      'src/components/referral/ReferralPDFSummarizer.jsx',
    ]) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      expect(source).toMatch(/onDrop=\{handleDrop\}/);
      expect(source).toContain('data-authority-file-drop-zone');
    }
  });
});
