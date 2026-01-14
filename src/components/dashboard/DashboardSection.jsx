import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function DashboardSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  collapsible = true,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`mb-4 sm:mb-6 ${className}`}>
      {collapsible ? (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg mb-3 transition-colors"
        >
          <div className="flex items-center gap-3">
            {Icon && <Icon className="w-5 h-5 text-gray-700" />}
            <h2 className="font-semibold text-gray-900">{title}</h2>
          </div>
          {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      ) : (
        <div className="flex items-center gap-3 p-4 mb-3">
          {Icon && <Icon className="w-5 h-5 text-gray-700" />}
          <h2 className="font-semibold text-gray-900">{title}</h2>
        </div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}