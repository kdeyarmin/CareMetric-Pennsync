import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

// Clamp any incoming value to a renderable 0-100 percent.
//
// A non-finite value (`undefined` from a score the record never carried, or the
// `NaN` produced by `count / total` when total is 0) used to flow straight into
// the width string. `width: "NaN%"` is invalid CSS, so the CSSOM drops the
// declaration, the bar falls back to `width: auto` — and a block-level div
// inside the relative track fills it completely. A MISSING score therefore
// rendered as a 100% bar: a patient with no risk score looked maximally at
// risk, an unscored quality metric looked perfect. Fail to empty instead.
function clampPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

const Progress = React.forwardRef((props, ref) => {
  const { className, value = 0, ...otherProps } = props
  const percent = clampPercent(value)

  return (
    <div
      ref={ref}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-slate-200",
        className
      )}
      {...otherProps}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-navy-600 to-navy-500 transition-all duration-500 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
})
Progress.displayName = "Progress"

export { Progress, clampPercent }
export default Progress