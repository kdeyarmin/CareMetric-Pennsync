// Thin wrapper around <Outlet />. Under the persistent-layout-route pattern
// the Layout stays mounted across navigations — only the Outlet content swaps.
// Previously this used AnimatePresence mode="wait" + a keyed div, which
// deadlocked navigation (the exit animation ran on already-replaced content
// and the new page never mounted). The keyed div was also removed because it
// forced a full unmount/remount of the Outlet on every route change, causing a
// brief empty flash before the new page rendered. Letting the Outlet stay
// mounted and swap its own content is the smoothest and most reliable path.
export default function PageTransition({ children }) {
  return <>{children}</>;
}