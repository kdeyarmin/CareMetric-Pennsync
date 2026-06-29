import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

// Segmented-control styling: a clearly-bordered slate track holds the triggers,
// so each inactive trigger reads as a distinct, clickable segment (rather than
// bare text) and the active one lifts out as a white pill with navy text.
const TabsList = React.forwardRef((props, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Button-bar layout: a transparent, wrapping/scrolling row that holds each
      // trigger as its own standalone button (rather than a single boxed track).
      // gap-2 spaces the buttons; flex-wrap lets many tabs wrap to a second row on
      // wide screens, and overflow-x-auto keeps them scrollable on narrow ones.
      "flex max-w-full flex-wrap items-center gap-2 overflow-x-auto scrollbar-hide bg-transparent p-0",
      props.className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

// Professional, theme-consistent BUTTON style for every tab in the app: each
// trigger is a bordered, shadowed white button; the active one fills solid navy
// with white text. The active/inactive colors are applied via INLINE STYLES
// (driven by the data-state attribute Radix sets) because some global CSS in the
// app overrides Tailwind tab backgrounds — inline styles always win, so the
// solid navy active state renders reliably on every page.
const TabsTrigger = React.forwardRef((props, ref) => {
  const innerRef = React.useRef(null)
  const [active, setActive] = React.useState(false)

  React.useImperativeHandle(ref, () => innerRef.current)

  React.useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const sync = () => setActive(el.getAttribute("data-state") === "active")
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ["data-state"] })
    return () => observer.disconnect()
  }, [])

  const { className, style, ...rest } = props

  return (
    <TabsPrimitive.Trigger
      ref={innerRef}
      style={{
        backgroundColor: active ? "#213a76" : "#ffffff",
        color: active ? "#ffffff" : "#334155",
        borderColor: active ? "#213a76" : "#cbd5e1",
        ...style,
      }}
      className={cn(
        "flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm ring-offset-white transition-all [&_svg]:h-4 [&_svg]:w-4 [&_svg]:flex-shrink-0 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...rest}
    />
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef((props, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:ring-offset-2",
      props.className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }