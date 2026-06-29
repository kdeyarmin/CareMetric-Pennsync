import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

const Progress = React.forwardRef((props, ref) => {
  const { className, value = 0, ...otherProps } = props

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
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
})
Progress.displayName = "Progress"

export { Progress }
export default Progress