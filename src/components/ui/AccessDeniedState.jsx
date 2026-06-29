import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AccessDeniedState — the standard early-return screen for a page or section
 * the current user isn't permitted to see (admin-only builders, reports, etc.).
 *
 * Consolidates the slightly-different "Access Denied" / "Admin Access Required"
 * / plain-text "available to admins only" blocks that varied page to page.
 * Pass `title` / `description` to tailor the wording; the icon and layout stay
 * consistent everywhere.
 */
export default function AccessDeniedState({
  title = "Admin Access Required",
  description = "You don't have permission to view this section.",
  icon: Icon = ShieldAlert,
  className,
}) {
  return (
    <div className={cn("max-w-2xl mx-auto p-8 text-center", className)}>
      <Icon className="w-16 h-16 text-slate-300 mx-auto mb-4" strokeWidth={1.5} aria-hidden="true" />
      <h2 className="text-xl font-semibold text-slate-900 mb-2">{title}</h2>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}
