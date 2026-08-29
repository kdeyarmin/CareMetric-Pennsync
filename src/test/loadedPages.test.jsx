/**
 * Loaded-state page smoke test.
 *
 * navPages.test.jsx proves every routed page mounts against an SDK that answers
 * every read with `[]` — i.e. its EMPTY state. This file covers the other half:
 * the same pages mounted against POPULATED data (rows synthesized from the real
 * entity schemas — see entityFixtures.js), with async state flushed and every
 * tab selected so lazily-mounted tab panels render too.
 *
 * That is where the render crashes actually live: a field the schema declares as
 * an object interpolated into JSX, a null deref inside a row map, a `.toFixed()`
 * on a value the record didn't carry, a tab body nobody mounts until it is
 * selected. None of those can fire against an empty list, which is why the
 * empty-state smoke test cannot replace this one.
 *
 * Like navPages.test.jsx it asserts nothing about behavior — render() and act()
 * throw on a crash, and that is the whole contract. The page list is derived
 * from ROUTES, so new pages are covered automatically.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { ROUTES } from "@/routes";

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
  globalThis.DOMMatrix ||= class DOMMatrix { constructor() {} };
});

// ── base44 SDK answering every read with schema-shaped rows ──
vi.mock("@/api/base44Client", async () => {
  const { rowsFor, functionResponseFor, TEST_USER } = await import("./entityFixtures.js");

  const entities = new Proxy({}, {
    get: (_t, entity) => {
      if (typeof entity !== "string") return undefined;
      return new Proxy({}, {
        get: (_t2, method) => {
          if (method === "then") return undefined; // never look like a thenable
          if (method === "get") return async () => rowsFor(entity)[0];
          if (method === "create" || method === "update") {
            return async (a, b) => ({ ...rowsFor(entity)[0], ...(b || a || {}) });
          }
          if (method === "delete") return async () => ({});
          return async () => rowsFor(entity); // filter / list / bulk* → rows
        },
      });
    },
  });
  const functions = new Proxy({}, {
    get: (_t, name) => async () => ({ data: functionResponseFor(String(name)) }),
  });
  const integrations = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => ({}) }) });

  return {
    base44: {
      entities,
      functions,
      integrations,
      analytics: { track: () => {}, cleanup: () => {} },
      auth: {
        me: async () => TEST_USER,
        list: async () => rowsFor("User"),
        updateMyUserData: async () => ({}),
        updateMe: async () => ({}),
      },
    },
  };
});

// Some deep components read auth from context rather than base44 directly.
vi.mock("@/lib/AuthContext", async () => {
  const { TEST_USER } = await import("./entityFixtures.js");
  return {
    AuthProvider: ({ children }) => children,
    useAuth: () => ({
      user: TEST_USER,
      isAuthenticated: true,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: {},
      navigateToLogin: () => {},
    }),
  };
});

const pageModules = import.meta.glob("../pages/*.jsx");
const importerFor = (name) => pageModules[`../pages/${name}.jsx`];
const routePages = [...new Set(ROUTES.map((route) => route.name))];

// Long enough for a mounted page's queries to resolve and re-render; short
// enough that 77 pages stay well inside the file's budget.
const SETTLE_MS = 60;
// Guard against a page whose tab list keeps growing as panels mount.
const MAX_TABS = 40;

// Pages that resolve their subject from `?id=` and render an empty shell without
// one. They get a SECOND pass with an id the fixtures actually mint. The id is
// deliberately not applied to every page: several hubs also read `id` and switch
// to a narrower single-subject mode that renders less than their plain listing.
const ID_PARAM_PAGES = ["PatientDetails", "PatientAlerts", "ReferralFollowUp"];
const SUBJECT_ID = "Patient-0";

function Providers({ children, search = "" }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MemoryRouter initialEntries={[`/${search}`]}>
      <QueryClientProvider client={queryClient}>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, SETTLE_MS); }); });

// The selected tab's panel, once Radix has switched to it.
const activePanel = () => document.querySelector('[role="tabpanel"][data-state="active"]');

// Keep settling while the active panel is still showing a loading state — that is
// a lazy() chunk resolving or its first read landing, and the crash we are hunting
// lives in what renders AFTER it. Bounded so a panel whose spinner never clears
// (a query gated on data this harness doesn't provide) can't stall the run.
async function settleActivePanel(maxRounds = 6) {
  for (let round = 0; round < maxRounds; round += 1) {
    await settle();
    const panel = activePanel();
    if (panel && !panel.querySelector('[role="status"]')) return;
  }
}

async function mountAndDrive(page, search) {
  const importer = importerFor(page);
  expect(importer, `no module ../pages/${page}.jsx`).toBeTruthy();

  let mod;
  await act(async () => { mod = await importer(); });
  const Page = mod.default;
  expect(Page, `${page}.jsx has no default export`).toBeTruthy();

  let unmount;
  await act(async () => {
    ({ unmount } = render(
      <Providers search={search}>
        <Page />
      </Providers>,
    ));
  });

  // Two passes: the first resolves the page's own reads, the second the reads a
  // child fires once that data lands.
  await settle();
  await settle();

  // Select every tab so panels that only mount when selected are rendered. Radix
  // Tabs switches on mousedown (a bare .click() does nothing), and the panel
  // behind it is usually lazy() — so wait for it to stop loading before moving
  // on. Identity is the trigger's id (Radix assigns one per value); the list is
  // re-read every round because selecting a tab can reveal nested tabs.
  const selected = new Set();
  for (let round = 0; round < MAX_TABS; round += 1) {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const next = tabs.find((tab) => !selected.has(tab.id || tab.textContent));
    if (!next) break;
    selected.add(next.id || next.textContent);
    await act(async () => { fireEvent.mouseDown(next, { button: 0, ctrlKey: false }); });
    await settleActivePanel();
  }

  unmount();
}

describe("routed pages render with populated data", () => {
  it.each(routePages)("%s", async (page) => {
    await mountAndDrive(page, "");
  });

  // The detail pages again, with the subject id they key off: their loaded state
  // is a different render path from the "nothing selected" shell above.
  it.each(ID_PARAM_PAGES)("%s (?id=)", async (page) => {
    await mountAndDrive(page, `?id=${SUBJECT_ID}`);
  });
});
