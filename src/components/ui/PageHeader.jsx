import { isValidElement } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useIsEmbedded } from "@/components/ui/embeddedPage";
import { cn } from "@/lib/utils";

export default function PageHeader({
  icon: IconProp,
  // Solid navy fill (not a gradient): custom-palette gradient color-stop
  // utilities like `from-navy-600`/`to-navy-800` are not reliably generated
  // under this app's Tailwind setup, which rendered the icon box transparent
  // and the white icon invisible. A solid background renders consistently.
  iconColor = "bg-navy-700",
  iconClassName,
  eyebrow,
  title,
  description,
  badges = [],
  actions,
  // NOTE: call sites may still pass a `favoritePage` prop. Page favoriting was
  // removed, so it is intentionally not read here and simply ignored.
  className,
  children,
}) {
  const embedded = useIsEmbedded();

  // When this page is embedded inside a hub (which renders its own header),
  // suppress the duplicate hero. Still render any actions/children so embedded
  // sections keep their controls.
  if (embedded) {
    if (!actions && !children) return null;
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {actions && (
          <div className="flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            {actions}
          </div>
        )}
        {children}
      </div>
    );
  }
  // `icon` may be a component *reference* or an already-built element.
  // Don't gate on `typeof === "function"`: lucide-react icons (and any
  // forwardRef/memo component) are objects, not functions, so that check
  // sent them down the "render as-is" path and React threw
  // "Objects are not valid as a React child ({$$typeof, render})".
  // Render already-built elements as-is; instantiate everything else.
  const iconEl = IconProp && (
    isValidElement(IconProp)
      ? IconProp
      : <IconProp className={cn("w-6 h-6", iconClassName)} aria-hidden="true" />
  );

  return (
    <Card className={cn("relative overflow-hidden border border-slate-200/80 bg-gradient-to-br from-white via-white to-navy-50/60 shadow-sm before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-gradient-to-r before:from-navy-600 before:via-navy-500 before:to-gold-400", className)}>
      {/* Decorative brand glow — purely cosmetic, sits behind the content. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-navy-200/40 via-navy-100/25 to-gold-100/30 blur-3xl"
      />
      <CardContent className="relative p-5 sm:p-6 md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {iconEl ? (
              <div className="mb-3 flex items-center gap-3.5">
                <div className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-md ring-1 ring-inset ring-white/15", iconColor)}>
                  {iconEl}
                </div>
                <div className="min-w-0">
                  {eyebrow && (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-600">
                      {eyebrow}
                    </p>
                  )}
                  <h1 className="truncate text-2xl font-bold text-slate-900 sm:text-3xl tracking-tight">{title}</h1>
                </div>
              </div>
            ) : (
              <>
                {eyebrow && (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-600">
                    {eyebrow}
                  </p>
                )}
                <h1 className="mb-3 text-2xl font-bold text-slate-900 sm:text-3xl tracking-tight">{title}</h1>
              </>
            )}

            {description && <p className="max-w-2xl text-sm text-slate-600 sm:text-base">{description}</p>}

            {badges.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {badges.map((badge, index) => (
                  <Badge
                    key={index}
                    className={badge.className ?? "bg-blue-100 text-blue-800 hover:bg-blue-100"}
                  >
                    {badge.label}
                  </Badge>
                ))}
              </div>
            )}

            {children}
          </div>

          {actions && (
            <div className="flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
              {actions}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}