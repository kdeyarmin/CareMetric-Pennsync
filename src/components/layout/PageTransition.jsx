// Wraps page content with a keyed container so React cleanly unmounts the
// previous page's component tree on navigation (resetting scroll, local state,
// etc.). The previous AnimatePresence + mode="wait" animation was removed
// because it deadlocks navigation under the persistent-layout-route pattern:
// the Layout (and this component) stay mounted across route changes, so only
// the <Outlet /> content swaps. AnimatePresence mode="wait" holds the
// "exiting" child until its exit animation finishes, but the Outlet already
// rendered the NEW page — so the exit runs on already-replaced content and
// the new page never mounts, making nav links appear to do nothing.
export default function PageTransition({ pageKey, children }) {
  return (
    <div key={pageKey} className="animate-fade-in">
      {children}
    </div>
  );
}