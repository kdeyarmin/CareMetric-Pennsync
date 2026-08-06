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

`@tanstack/react-virtual` is a normal `package.json` dependency (installed via
`pnpm install`). The one-shot GitHub Actions installer that targeted
`wire-p1-pure-helpers` has been retired.

## Behavior

- Lists with **< 40** items render normally (no virtualizer overhead).
- Lists with **≥ 40** items only mount visible rows (+ overscan).
- Does **not** reduce Base44 fetch size — still subject to `ALL_ROWS` / `2000` ceilings until server-side paging exists.

## Install

```bash
pnpm install --frozen-lockfile
```
