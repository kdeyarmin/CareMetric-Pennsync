import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realm = vi.hoisted(() => {
  let controller;
  let current;
  let lease;

  class StaleTenantSdkOperationError extends Error {
    constructor() {
      super('expired');
      this.code = 'STALE_TENANT_SDK_OPERATION';
    }
  }

  return {
    abort() {
      current = false;
      controller.abort();
    },
    assert(candidate) {
      if (candidate !== lease || !current || controller.signal.aborted) {
        throw new StaleTenantSdkOperationError();
      }
      return candidate;
    },
    capture: vi.fn(() => lease),
    getSignal: vi.fn((candidate) => {
      if (candidate !== lease) throw new StaleTenantSdkOperationError();
      return controller.signal;
    }),
    isCurrent: vi.fn((candidate) => (
      candidate === lease && current && !controller.signal.aborted
    )),
    lease: () => lease,
    reset() {
      controller = new AbortController();
      current = true;
      lease = Object.freeze({});
      this.capture.mockClear();
      this.getSignal.mockClear();
      this.isCurrent.mockClear();
    },
    StaleTenantSdkOperationError,
  };
});

vi.mock('@/lib/tenantSdkRealmGate', () => ({
  assertTenantSdkRealmLeaseCurrent: realm.assert,
  captureTenantSdkRealmLease: realm.capture,
  getTenantSdkRealmAbortSignal: realm.getSignal,
  isTenantSdkRealmLeaseCurrent: realm.isCurrent,
  StaleTenantSdkOperationError: realm.StaleTenantSdkOperationError,
}));

import {
  createAuthorityBoundMediaOperation,
  detachAuthorityBoundMediaTree,
  loadAuthorityBoundImage,
  readAuthorityBoundDataUrl,
} from './authorityBoundMediaProcessing';

class MockFileReader {
  static EMPTY = 0;
  static LOADING = 1;
  static DONE = 2;
  static instances = [];

  constructor() {
    this.abort = vi.fn(() => { this.readyState = MockFileReader.DONE; });
    this.error = null;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
    this.readyState = MockFileReader.EMPTY;
    this.result = null;
    MockFileReader.instances.push(this);
  }

  readAsDataURL() {
    this.readyState = MockFileReader.LOADING;
  }
}

class MockImage {
  static instances = [];

  constructor() {
    this.height = 200;
    this.onload = null;
    this.onerror = null;
    this.width = 100;
    this._src = '';
    MockImage.instances.push(this);
  }

  get src() { return this._src; }
  set src(value) { this._src = value; }

  removeAttribute(name) {
    if (name === 'src') this._src = '';
  }
}

describe('authority-bound native media processing', () => {
  beforeEach(() => {
    realm.reset();
    MockFileReader.instances = [];
    MockImage.instances = [];
    vi.stubGlobal('FileReader', MockFileReader);
    vi.stubGlobal('Image', MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('makes disposal terminal and runs every registered teardown once', () => {
    const operation = createAuthorityBoundMediaOperation();
    const first = vi.fn();
    const second = vi.fn();
    operation.addTeardown(first);
    operation.addTeardown(second);

    realm.abort();
    operation.dispose();

    expect(operation.isCurrent()).toBe(false);
    expect(operation.signal.aborted).toBe(true);
    let staleError;
    try { operation.assertCurrent(); } catch (error) { staleError = error; }
    expect(staleError).toMatchObject({ code: 'STALE_TENANT_SDK_OPERATION' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending FileReader and drops its queued native callbacks', async () => {
    const operation = createAuthorityBoundMediaOperation();
    const pending = readAuthorityBoundDataUrl(operation, new Blob(['fax']));
    const reader = MockFileReader.instances[0];
    const queuedLoad = reader.onload;

    realm.abort();

    await expect(pending).rejects.toMatchObject({ code: 'STALE_TENANT_SDK_OPERATION' });
    expect(reader.abort).toHaveBeenCalledTimes(1);
    expect(reader.onload).toBeNull();
    expect(reader.onerror).toBeNull();
    expect(reader.onabort).toBeNull();
    expect(() => queuedLoad()).not.toThrow();
  });

  it('detaches a pending Image source and rejects a queued load after abort', async () => {
    const operation = createAuthorityBoundMediaOperation();
    const pending = loadAuthorityBoundImage(operation, 'data:image/jpeg;base64,PHI');
    const image = MockImage.instances[0];
    const queuedLoad = image.onload;

    realm.abort();

    await expect(pending).rejects.toMatchObject({ code: 'STALE_TENANT_SDK_OPERATION' });
    expect(image.src).toBe('');
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(() => queuedLoad()).not.toThrow();
  });

  it('rechecks successful FileReader and Image callbacks and clears retained sources', async () => {
    const operation = createAuthorityBoundMediaOperation();
    const dataUrlPromise = readAuthorityBoundDataUrl(operation, new Blob(['fax']));
    const reader = MockFileReader.instances[0];
    reader.result = 'data:image/jpeg;base64,ZmF4';
    reader.readyState = MockFileReader.DONE;
    reader.onload();
    await expect(dataUrlPromise).resolves.toBe('data:image/jpeg;base64,ZmF4');

    const imagePromise = loadAuthorityBoundImage(operation, reader.result);
    const image = MockImage.instances[0];
    image.onload();
    await expect(imagePromise).resolves.toBe(image);

    operation.dispose();
    expect(image.src).toBe('');
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });

  it('synchronously strips native image, canvas, video, and PiP resources', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="data:image/jpeg;base64,PHI"><canvas width="20" height="10"></canvas><video src="https://media.test/phi.mp4"><source src="https://media.test/phi.mp4"></video>';
    const image = root.querySelector('img');
    const canvas = root.querySelector('canvas');
    const video = root.querySelector('video');
    video.onended = vi.fn();
    video.pause = vi.fn();
    video.load = vi.fn();
    Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: {} });
    const exitPictureInPicture = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      value: video,
    });
    Object.defineProperty(document, 'exitPictureInPicture', {
      configurable: true,
      value: exitPictureInPicture,
    });

    detachAuthorityBoundMediaTree(root);
    await Promise.resolve();

    expect(image).not.toHaveAttribute('src');
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(video.onended).toBeNull();
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(video).not.toHaveAttribute('src');
    expect(video.querySelector('source')).not.toHaveAttribute('src');
    expect(exitPictureInPicture).toHaveBeenCalledTimes(1);
  });
});
