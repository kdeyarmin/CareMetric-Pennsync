# Page layout standard

Every routed page in `src/pages` follows one structure so the whole app reads as
a single, consistent product. Two components enforce it:

- **`@/components/ui/PageContainer`** — the page shell. One content width
  (`max-w-7xl`), centered, with a `space-y-6` rhythm between top-level sections.
- **`@/components/ui/PageHeader`** — the page header. A subtle gradient card with
  an icon tile, an uppercase **eyebrow** (the page's section), a **title**, an
  optional **description**, optional **badges**/**actions**, and a favorite star.

## The canonical page

```jsx
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { Users } from 'lucide-react';

export default function Example() {
  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Patient Care"
        title="Patients"
        description="Search, filter, and manage your patient roster."
        actions={<Button>…</Button>}   // optional header buttons
      />
      {/* page sections */}
    </PageContainer>
  );
}
```

## Rules

1. **Never** wrap a page in `min-h-screen`, a background (`bg-*`,
   `bg-gradient-*`), or outer padding (`p-6`, `p-4 md:p-8`, …). The Layout's
   `<main>` already supplies the padding and the slate background. Pages that add
   their own produce double gutters and mismatched widths.
2. **One width.** Use `PageContainer` (`max-w-7xl`). Do not hand-pick
   `max-w-4xl/5xl/6xl` per page. Constrain a narrow form *inside* a card instead.
3. **One header.** Use `PageHeader`, not a hand-rolled `<h1>` block or a
   full-bleed colored banner. The `icon` + `eyebrow` come from the page's entry
   in `src/lib/nav.manifest.js` so the header matches the sidebar and
   breadcrumbs. Header buttons go in the `actions` prop.
4. **Icon tile** stays the default gradient — don't override `iconColor` per
   page, so every header shares one accent.

## Buttons & links

All action buttons use the shared `@/components/ui/button` variants — `default`
(navy), `destructive` (red), `outline`, `ghost`, `secondary`, `link`, `gold` —
with no ad-hoc color overrides. In particular:

1. **No off-palette fills.** Don't override a button with `bg-green-*`,
   `bg-emerald-*`, `bg-orange-*`, `bg-amber-*`, or gradients. Approve/confirm/
   save actions are `default` navy; danger actions are `destructive`. Status is
   communicated by badges, icons, and surrounding context — not button color.
2. **No hand-rolled buttons for CTAs.** A raw `<button>` is fine as an
   invisible click target (list rows, tab triggers); a visible call-to-action
   uses `<Button>` so radius, typography, and focus rings stay uniform.
3. **Semantic exceptions** (intentional, keep): telephony call/answer actions
   stay green (universal phone-UI convention); icon-only state pairs (e.g.
   enable/disable toggles, inline save/cancel) and icon buttons inside colored
   status callouts may match their context.
4. **Inline text links** follow the Button `link` variant recipe:
   navy text (`text-blue-600`/`text-navy-600`), hover darkens one step to
   `-700`, underline (static or on hover) for inline links. External links use
   `target="_blank" rel="noopener noreferrer"`.

## Adoption & intentional exceptions

`PageHeader` is adopted by every routed content page. A small set of pages
deliberately do **not** render the standard hero — these are by design, not a
pending rollout, and should be left as-is:

- **`JoinTelehealth`, `SignerPortal`** — public, pre-login pages that render
  outside the Layout; they keep their own centered, full-height shell.
- **`AIComplianceInServices`** — a thin router that delegates to children
  (`AIComplianceInServicesHub`, `MyTrainingDashboard`) which each render their
  own standard header; adding a header here would duplicate it.
- **`CarePlanBuilder`** — a full-screen editor (`h-[calc(100vh-4rem)]`) with a
  custom inline toolbar (editable plan name + patient selector). A hero card
  would break the full-height layout.
- **`SmartNoteAssistant`** — renders a bespoke, workflow-aware `SmartNoteHeader`
  (inside `HideWhenEmbedded`) carrying `careScope/step/activeTab` controls the
  generic header can't express.

`DuplicatePatients.spec.jsx` is a test file, not a page. Everything else uses
`PageHeader`.
