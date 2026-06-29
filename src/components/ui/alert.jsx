import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

const Alert = React.forwardRef((props, ref) => {
  const { className, variant = "default", ...otherProps } = props
  
  const variants = {
    default: "bg-white border-slate-200 shadow-sm",
    destructive: "bg-red-50 border-red-300 text-red-900 shadow-sm",
    success: "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-sm",
    warning: "bg-amber-50 border-amber-300 text-amber-900 shadow-sm",
    info: "bg-navy-50 border-navy-200 text-navy-900 shadow-sm",
  }
  
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "relative w-full rounded-xl border p-4 transition-all duration-200",
        variants[variant],
        className
      )}
      {...otherProps}
    />
  )
})
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef((props, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", props.className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef((props, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", props.className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }