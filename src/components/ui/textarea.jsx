import * as React from "react"

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ')
}

const Textarea = React.forwardRef((props, ref) => {
  const { className, ...otherProps } = props

  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:border-navy-500 focus-visible:shadow-md transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:ring-offset-slate-950 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800 dark:focus-visible:border-navy-400 dark:focus-visible:ring-navy-400", 
        className
      )}
      ref={ref}
      {...otherProps}
    />
  )
})

Textarea.displayName = "Textarea"

export { Textarea }