import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = ({ variant = "default", size = "default", className } = {}) => {
    const baseStyles = "inline-flex items-center justify-center text-center rounded-lg text-sm font-semibold leading-none transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-navy-500 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:shrink-0"

    const variants = {
      default: "app-primary-button shadow-md hover:shadow-md",
      destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow-md dark:bg-red-500 dark:hover:bg-red-400",
      outline: "border border-slate-400 bg-white text-slate-900 shadow-sm hover:border-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
      ghost: "text-slate-800 hover:bg-slate-200 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white",
      secondary: "border border-slate-300 bg-slate-200 text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-300 hover:text-slate-950 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600",
      link: "text-navy-600 underline-offset-4 hover:underline hover:text-navy-700 dark:text-navy-300 dark:hover:text-navy-200",
      gold: "bg-gold-400 text-navy-900 shadow-sm hover:bg-gold-500 hover:shadow-md dark:bg-gold-300 dark:hover:bg-gold-200 dark:text-slate-950",
    }

    const sizes = {
      default: "h-10 px-4",
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