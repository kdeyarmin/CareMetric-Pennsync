import { cn } from "@/lib/utils";
import { useIsEmbedded } from "@/components/ui/embeddedPage";

/**
 * PageContainer — the single, app-wide page shell.
 *
 * Every routed page renders its content inside one of these so the whole app
 * shares one content width, one horizontal centering rule, and one vertical
 * rhythm. The surrounding Layout (<main>) already provides the page padding and
 * the slate background gradient, so pages must NOT add their own `min-h-screen`,
 * background, or outer `p-*` padding — doing so creates double gutters and
 * mismatched widths from page to page.
 *
 * Usage:
 *   <PageContainer>
 *     <PageHeader ... />
 *     ...sections...
 *   </PageContainer>
 *
 * The `space-y-6` here is the canonical gap between a page's top-level sections
 * (header → content → cards), which is why PageHeader itself carries no bottom
 * margin.
 */
export default function PageContainer({ children, className }) {
  const embedded = useIsEmbedded();

  // When embedded inside a hub page, the hub already provides the page width and
  // centering — re-applying them here would nest the constraints. Keep only the
  // vertical rhythm so the embedded sections stack cleanly under the hub header.
  if (embedded) {
    return <div className={cn("space-y-6", className)}>{children}</div>;
  }

  return (
    <div className={cn("mx-auto w-full max-w-7xl space-y-6", className)}>
      {children}
    </div>
  );
}
