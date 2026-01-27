import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronLeft, Zap, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const tourSteps = [
  {
    id: 'dashboard',
    title: 'Welcome to Your Dashboard',
    description: 'Your command center for managing patients, creating notes, and tracking progress.',
    features: ['Patient overview', 'Quick stats', 'Recent activity'],
    icon: '📊'
  },
  {
    id: 'smartnotes',
    title: 'Smart Note Assistant',
    description: 'AI-powered clinical documentation that helps you write better notes faster.',
    features: ['Voice dictation', 'Auto-suggestions', 'Compliance checking'],
    icon: '🧠'
  },
  {
    id: 'patients',
    title: 'Patient Management',
    description: 'Centralized patient records with complete history and care plans.',
    features: ['Patient profiles', 'Visit history', 'Care plans', 'Education materials'],
    icon: '👥'
  },
  {
    id: 'documents',
    title: 'Document Center',
    description: 'Generate professional documents with AI-powered templates.',
    features: ['Templates', 'Auto-population', 'PDF export', 'E-signatures'],
    icon: '📄'
  },
  {
    id: 'compliance',
    title: 'Compliance Tools',
    description: 'Stay compliant with automated checking and real-time guidance.',
    features: ['Real-time monitoring', 'Training modules', 'Audit reports'],
    icon: '✅'
  },
  {
    id: 'analytics',
    title: 'Analytics & Insights',
    description: 'Track your performance with comprehensive analytics.',
    features: ['Usage stats', 'Performance metrics', 'Improvement suggestions'],
    icon: '📈'
  }
];

export default function GuidedFeatureTour({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const step = tourSteps[currentStep];

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-white to-blue-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              <span className="text-4xl">{step.icon}</span>
              <div>
                <h2 className="text-2xl font-bold">{step.title}</h2>
                <p className="text-sm text-gray-600 font-normal mt-1">
                  Step {currentStep + 1} of {tourSteps.length}
                </p>
              </div>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <motion.div
              className="bg-blue-600 h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${((currentStep + 1) / tourSteps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Step Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-gray-700 text-lg">{step.description}</p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex gap-2 mb-3">
                  <Zap className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-900 text-sm">Key Features:</p>
                    <ul className="mt-2 space-y-2">
                      {step.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-sm text-blue-800">
                          <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              onClick={handlePrev}
              disabled={currentStep === 0}
              variant="outline"
              className="gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>

            <div className="flex gap-1">
              {tourSteps.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentStep(idx)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    idx === currentStep ? 'bg-blue-600 w-6' : 'bg-gray-300'
                  }`}
                  title={`Go to step ${idx + 1}`}
                />
              ))}
            </div>

            <Button
              onClick={handleNext}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
            >
              {currentStep === tourSteps.length - 1 ? 'Complete' : 'Next'}
              {currentStep < tourSteps.length - 1 && <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>

          <div className="text-center p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">
              You can access this tour anytime from your settings.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}