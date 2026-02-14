import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CollapsibleMobileSection({ 
  title, icon: Icon, children, defaultOpen = false, badge, className = "" 
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={`overflow-hidden ${className}`}>
      <button 
        onClick={() => setOpen(!open)}
        className="w-full text-left"
      >
        <CardHeader className="p-3 sm:p-4 flex flex-row items-center justify-between space-y-0 cursor-pointer active:bg-slate-50 dark:active:bg-slate-800 transition-colors">
          <CardTitle className="text-xs sm:text-sm font-semibold flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-blue-600 flex-shrink-0" />}
            {title}
            {badge && <span className="ml-1">{badge}</span>}
          </CardTitle>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </motion.div>
        </CardHeader>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <CardContent className="p-3 sm:p-4 pt-0">
              {children}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}