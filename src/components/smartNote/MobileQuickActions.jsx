import React from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Save, Mic, CheckCircle2, Wand2 } from "lucide-react";
import { motion } from "framer-motion";

export default function MobileQuickActions({
  currentStep,
  isProcessing,
  isSaving,
  copied,
  isListening,
  hasComplianceIssues,
  onEnhance,
  onCopy,
  onSave,
  onVoice,
  onFixCompliance
}) {
  // Only show relevant actions based on step
  const actions = [];

  if (currentStep === 'notes' || currentStep === 'vitals') {
    actions.push({
      label: 'Voice',
      icon: Mic,
      onClick: onVoice,
      active: isListening,
      color: 'bg-purple-600'
    });
  }

  if (currentStep === 'notes' && !isProcessing) {
    if (hasComplianceIssues) {
      actions.push({
        label: 'Fix Issues',
        icon: Wand2,
        onClick: onFixCompliance,
        color: 'bg-orange-600',
        pulse: true
      });
    }
    actions.push({
      label: 'Enhance',
      icon: Sparkles,
      onClick: onEnhance,
      color: 'bg-indigo-600'
    });
  }

  if (currentStep === 'review' || currentStep === 'enhance') {
    actions.push({
      label: copied ? 'Copied!' : 'Copy',
      icon: copied ? CheckCircle2 : Copy,
      onClick: onCopy,
      color: copied ? 'bg-green-600' : 'bg-blue-600'
    });
    actions.push({
      label: isSaving ? 'Saving...' : 'Save',
      icon: Save,
      onClick: onSave,
      disabled: isSaving,
      color: 'bg-green-600'
    });
  }

  if (actions.length === 0) return null;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t-2 border-gray-200 shadow-2xl p-3 safe-bottom">
      <div className="flex gap-2 justify-center max-w-lg mx-auto">
        {actions.map((action, idx) => (
          <motion.div
            key={idx}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: idx * 0.1 }}
            className="flex-1"
          >
            <Button
              onClick={action.onClick}
              disabled={action.disabled || isProcessing}
              className={`w-full ${action.color} hover:opacity-90 text-white touch-target ${
                action.pulse ? 'animate-pulse' : ''
              } ${action.active ? 'ring-4 ring-purple-300' : ''}`}
              size="lg"
            >
              <action.icon className="w-5 h-5 mr-2" />
              {action.label}
            </Button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}