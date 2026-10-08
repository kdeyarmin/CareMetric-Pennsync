import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { canViewFinancials } from "@/lib/permissions";

/**
 * FinancialGate — renders its children only for administrator-level users (see
 * canViewFinancials). It is FAIL-CLOSED: while the current user is still
 * loading, and for every non-admin (e.g. a nurse/clinician), nothing is
 * rendered.
 *
 * The app no longer shows any revenue, PDGM-payment or reimbursement figure
 * (those features were removed). The gate survives as the shared fail-closed
 * administrator check for admin-only tools that sit on NURSE-VISIBLE surfaces,
 * such as the OASIS Analyzer's batch tab and the documentation-gap admin panel.
 * It reads the shared ['currentUser'] query that the app already caches
 * app-wide, so wrapping many blocks is cheap (React Query dedupes by key).
 *
 *   <FinancialGate>
 *     <AdminOnlyPanel ... />
 *   </FinancialGate>
 *
 * Pass `fallback` to render a placeholder for non-financial users; the default
 * is to render nothing.
 *
 * NOTE: this is a client-side visibility control for UX. For sensitive data the
 * server (Base44 functions / RLS) remains the real boundary — see canViewFinancials.
 */
export default function FinancialGate({ children, fallback = null }) {
  const { data: currentUser, isPending } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  // While the user is still resolving, render nothing — NOT the fallback — so an
  // admin never briefly sees a "restricted" placeholder on first load/refetch.
  // Still fail-closed: financial children never render before the user is known
  // to be authorized.
  if (isPending) return null;

  return canViewFinancials(currentUser) ? <>{children}</> : fallback;
}
