/**
 * Routed-page render smoke test.
 *
 * Mounts every authenticated route page plus the public capability-token pages
 * with the base44 backend, auth context and
 * the browser APIs jsdom lacks all mocked, and asserts each renders real DOM
 * without throwing. This catches runtime render crashes (null derefs, bad
 * imports, bad initial-state assumptions) that a successful build cannot — the
 * build proves a module *compiles*, this proves the component *mounts*.
 *
 * It deliberately asserts nothing about behavior; the page list is derived from
 * ROUTES so every reachable app page is covered automatically. Redirect targets
 * are also checked so retired links cannot point at PageNotFound.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
// routes.jsx derives ROUTES from nav.manifest.js; import it as the app does so
// this smoke coverage follows the production route table exactly.
import { REDIRECTS, ROUTES } from "@/routes";

// ── Browser APIs jsdom doesn't implement but charts / Radix / mobile helpers use ──
beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  globalThis.ResizeObserver ||= NoopObserver;
  globalThis.IntersectionObserver ||= NoopObserver;
  window.scrollTo ||= () => {};
  Element.prototype.scrollIntoView ||= () => {};
  if (!HTMLCanvasElement.prototype.getContext) HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.crypto ||= {};
  globalThis.crypto.randomUUID ||= () => "00000000-0000-4000-8000-000000000000";
  URL.createObjectURL ||= () => "blob:mock";
  URL.revokeObjectURL ||= () => {};
  // pdfjs-dist (pulled in by the fax PDF annotator) touches DOMMatrix at import.
  globalThis.DOMMatrix ||= class DOMMatrix { constructor() {} };
});

// ── Mock the base44 backend so entity/auth/function calls resolve to empty data ──
vi.mock("@/api/base44Client", () => {
  const arr = async () => [];
  const obj = async () => ({});
  const entityStub = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "then") return undefined; // never look like a thenable
      if (prop === "get" || prop === "create" || prop === "update") return obj;
      return arr; // filter / list / bulk* → []
    },
  });
  const entities = new Proxy({}, { get: () => entityStub });
  const functions = new Proxy({}, { get: () => async () => ({ data: {} }) });
  const integrations = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => ({}) }) });
  return {
    base44: {
      entities,
      functions,
      integrations,
      auth: {
        me: async () => ({ id: "u1", email: "test@example.com", role: "admin", is_approved: true, is_manager: true, full_name: "Test User" }),
        list: arr,
        updateMyUserData: obj,
      },
    },
  };
});

// Some deep components read auth from context rather than base44 directly.
vi.mock("@/lib/AuthContext", () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: { id: "u1", email: "test@example.com", role: "admin", is_approved: true, full_name: "Test User" },
    isAuthenticated: true,
    isLoadingAuth: false,
    isLoadingPublicSettings: false,
    authError: null,
    appPublicSettings: {},
    navigateToLogin: () => {},
  }),
}));

// Lazy importers for every page file, mirroring how src/routes.jsx loads them.
const pageModules = import.meta.glob("../pages/*.jsx");
const importerFor = (name) => pageModules[`../pages/${name}.jsx`];

const publicPages = ["JoinTelehealth", "SignerPortal"];
const routePages = [...new Set([...ROUTES.map((route) => route.name), ...publicPages])];
const routePathNames = new Set(ROUTES.map((route) => `/${route.name}`.toLowerCase()));
const publicPathNames = new Set(["/join", "/signer"]);
const redirectTargetPath = (to) => `/${to.replace(/^\//, "").split("?")[0]}`.toLowerCase();

function Providers({ children }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("routed pages mount without crashing", () => {
  it.each(routePages)("%s", async (page) => {
    const importer = importerFor(page);
    expect(importer, `no module ../pages/${page}.jsx — nav links to an unrouted page`).toBeTruthy();
    let mod;
    await act(async () => {
      mod = await importer();
    });
    const Page = mod.default;
    expect(Page, `${page}.jsx has no default export`).toBeTruthy();

    // The contract is "mounts without throwing": render() throws on a crash,
    // failing the test. A page that shows an empty loading state on first paint
    // (no backing data yet) is fine, so we don't assert on rendered DOM content.
    // (We mount the loading state rather than flushing data to the loaded state
    // because some pages start polling/interval queries that never let an async
    // act() settle — that would hang the suite, not catch more real bugs.)
    const { unmount } = render(
      <Providers>
        <Page />
      </Providers>,
    );
    unmount();
  });

  it("keeps every redirect target routed or public", () => {
    for (const { from, to } of REDIRECTS) {
      const targetPath = redirectTargetPath(to);
      expect(
        routePathNames.has(targetPath) || publicPathNames.has(targetPath),
        `${from} redirects to unrouted target ${to}`,
      ).toBe(true);
    }
  });
});
