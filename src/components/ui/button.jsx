import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

const buttonVariants = ({ variant = "default", size = "default", className } = {}) => {
    const baseStyles = "inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-navy-500 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]"

    const variants = {
      default: "bg-navy-600 text-white shadow-sm hover:bg-navy-700 hover:shadow-md",
      destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow-md",
      outline: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-400 hover:text-navy-700",
      ghost: "text-slate-700 hover:bg-slate-100 hover:text-navy-800",
      secondary: "bg-slate-100 text-slate-800 border border-slate-200 shadow-sm hover:bg-slate-200 hover:text-slate-900",
      link: "text-navy-600 underline-offset-4 hover:underline hover:text-navy-700",
      gold: "bg-gold-400 text-navy-900 shadow-sm hover:bg-gold-500 hover:shadow-md",
    }

    const sizes = {
      default: "h-10 px-4 py-2",
      sm: "h-9 rounded-md px-3",
      lg: "h-11 rounded-md px-8",
      icon: "h-10 w-10",
    }

    return cn(baseStyles, variants[variant || "default"], sizes[size || "default"], className)
  }

const Button = React.forwardRef((props, ref) => {
    if (!props) return null;
    const { className, variant = "default", size = "default", asChild = false, ...otherProps } = props

    const classes = buttonVariants({ variant, size, className })

    if (asChild && otherProps.children && React.isValidElement(otherProps.children)) {
      // Destructure `children` out of the forwarded props: otherwise spreading
      // `...otherProps` passes the child element back in as its own children,
      // replacing its label (e.g. <Button asChild><Link>Label</Link></Button>
      // would render the Link inside itself instead of "Label").
      const { children: childElement, ...rest } = otherProps
      return React.cloneElement(childElement, {
        className: cn(classes, childElement.props?.className),
        ref,
        ...rest,
      })
    }

    return <button ref={ref} className={classes} {...otherProps} />
  })

Button.displayName = "Button"

export { Button, buttonVariants }