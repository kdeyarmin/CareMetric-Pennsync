import { motion, AnimatePresence } from "framer-motion";

// Horizontal slide transition between page changes. Keyed on the current page
// name so AnimatePresence runs the exit/enter cycle on every route switch.
// Honors reduced-motion (falls back to a plain fade of ~0ms) and only applies
// the horizontal travel on touch/mobile widths — desktop keeps the existing
// instant, sidebar-driven layout feel untouched.
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const variants = {
  initial: { opacity: 0, x: prefersReducedMotion ? 0 : 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: prefersReducedMotion ? 0 : -24 },
};

export default function PageTransition({ pageKey, children }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}