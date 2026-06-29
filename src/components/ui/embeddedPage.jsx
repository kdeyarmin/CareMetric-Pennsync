import { createContext, useContext } from "react";

/**
 * Embedded-page context.
 *
 * Several "hub" pages (e.g. My Learning, Compliance Center, OASIS Center) render
 * their own PageHeader and then embed other full page components inside tabs.
 * Those embedded pages also render a PageHeader/hero of their own, which stacks a
 * second header under the hub's header. Wrapping the embedded region in
 * <EmbeddedPage> flips this context to `true` so PageHeader (and any custom hero)
 * can suppress the duplicate header while still rendering its actions/content.
 */
const EmbeddedPageContext = createContext(false);

export function useIsEmbedded() {
  return useContext(EmbeddedPageContext);
}

/**
 * Renders its children only when the page is NOT embedded inside a hub. Use this
 * to wrap a page's own top-level header/hero so it disappears when the page is
 * rendered inside a hub tab (which already shows the hub header), while still
 * showing normally on the page's standalone route.
 */
export function HideWhenEmbedded({ children }) {
  return useIsEmbedded() ? null : children;
}

export default function EmbeddedPage({ children }) {
  return (
    <EmbeddedPageContext.Provider value={true}>
      {children}
    </EmbeddedPageContext.Provider>
  );
}
