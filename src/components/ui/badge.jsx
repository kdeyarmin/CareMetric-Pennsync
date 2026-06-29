import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

const Badge = React.forwardRef((props, ref) => {
  const { className, variant = "default", ...otherProps } = props
  
  const variants = {
    default: "bg-navy-600 text-white hover:bg-navy-700 shadow-sm",
    secondary: "bg-slate-200 text-slate-900 hover:bg-slate-300 shadow-sm",
    destructive: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    outline: "text-slate-900 border border-slate-300 hover:bg-slate-50",
    gold: "bg-gold-100 text-gold-700 border border-gold-300 hover:bg-gold-200",
    // Soft, professional status chips (semantic, consistent across the app).
    success: "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200",
    warning: "bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200",
    info: "bg-navy-100 text-navy-800 border border-navy-200 hover:bg-navy-200",
  }
  
  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all duration-200",
        variants[variant],
        className
      )}
      {...otherProps}
    />
  )
})

Badge.displayName = "Badge"

export { Badge }