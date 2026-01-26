import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Users, Clock, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function MobileQuickActions() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const actions = [
    { 
      icon: FileText, 
      label: "New Note", 
      color: "bg-blue-600",
      action: () => navigate(createPageUrl("SmartNoteAssistant"))
    },
    { 
      icon: Users, 
      label: "Add Patient", 
      color: "bg-green-600",
      action: () => navigate(createPageUrl("Patients"))
    },
    { 
      icon: Clock, 
      label: "New Task", 
      color: "bg-purple-600",
      action: () => navigate(createPageUrl("Tasks"))
    }
  ];

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-black/40 z-[9996]"
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="lg:hidden fixed right-4 bottom-20 z-[9997]">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 20 }}
              className="flex flex-col gap-3 mb-3"
            >
              {actions.map((item, index) => {
                const Icon = item.icon;
                return (
                  <motion.button
                    key={item.label}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => {
                      item.action();
                      setIsOpen(false);
                    }}
                    className={`${item.color} text-white rounded-full px-4 py-3 shadow-lg flex items-center gap-3 min-w-[140px] touch-target active:scale-95 transition-transform`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium text-sm">{item.label}</span>
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`${
            isOpen ? "bg-slate-600" : "bg-blue-600"
          } text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg active:scale-95 transition-all touch-target`}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        </button>
      </div>
    </>
  );
}