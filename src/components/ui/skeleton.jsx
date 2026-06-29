import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

const Skeleton = React.forwardRef((props, ref) => {
  const { className, ...otherProps } = props
  
  return (
    <div
      ref={ref}
      className={cn(
        // A soft base tint with a light "sheen" band sweeping across — reads as
        // a more premium loading state than a flat pulse. (Reduced-motion users
        // get a static block via the global prefers-reduced-motion guard.)
        "relative isolate overflow-hidden rounded-md bg-slate-200/70 after:absolute after:inset-0 after:-translate-x-full after:animate-sheen after:bg-gradient-to-r after:from-transparent after:via-white/70 after:to-transparent",
        className
      )}
      {...otherProps}
    />
  )
})

Skeleton.displayName = "Skeleton"

export { Skeleton }