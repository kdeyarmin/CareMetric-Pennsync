// Vitest setup shared by all component/integration tests.
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so the jsdom document stays clean.
afterEach(() => cleanup());

// jsdom does not implement matchMedia; several components (theme, responsive
// helpers) call it. Provide a no-op so they can render under test.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
