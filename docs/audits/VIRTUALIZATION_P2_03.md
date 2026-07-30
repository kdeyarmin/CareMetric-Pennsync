# P2-03 Large-list virtualization

## What shipped

| Piece | Path |
|---|---|
| Threshold / enable helper | `src/lib/virtualListConfig.js` |
| Hook | `src/hooks/useVirtualList.js` |
| UI | `src/components/ui/VirtualList.jsx` |
| Mobile Patients roster | `src/pages/Patients.jsx` |
| Offline cached patients | `src/pages/OfflineMode.jsx` |
| Desktop patients | still uses page controls (`PaginatedPatientList` + pure `paginateRows`) |

## Dependency

`@tanstack/react-virtual` is installed via GitHub Actions workflow
`Install virtualization deps (no local machine)` so no laptop is required.

## Behavior

- Lists with **< 40** items render normally (no virtualizer overhead).
- Lists with **≥ 40** items only mount visible rows (+ overscan).
- Does **not** reduce Base44 fetch size — still subject to `ALL_ROWS` / `2000` ceilings until server-side paging exists.

## Install (browser only)

Actions → **Install virtualization deps** → Run workflow on `wire-p1-pure-helpers`
(if the auto-push trigger did not already land the lockfile commit).
