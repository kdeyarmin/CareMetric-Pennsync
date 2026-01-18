import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Lightbulb } from "lucide-react";

export default function OnboardingTooltip({ 
  title, 
  description, 
  position = 'bottom',
  onNext,
  onSkip,
  stepNumber,
  totalSteps
}) {
  const positionClasses = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2'
  };

  return (
    <div className={`absolute ${positionClasses[position]} z-[9999] w-80 animate-in fade-in slide-in-from-top-2`}>
      <Card className="border-2 border-blue-500 shadow-xl">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <Lightbulb className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900">{title}</h4>
                <p className="text-xs text-gray-500">Step {stepNumber} of {totalSteps}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSkip}
              className="h-6 w-6"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <p className="text-sm text-gray-700 mb-4">{description}</p>

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={onSkip}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Skip tour
            </button>
            <Button
              onClick={onNext}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              {stepNumber === totalSteps ? 'Finish' : 'Next'}
            </Button>
          </div>

          {/* Arrow pointer */}
          <div 
            className={`absolute w-3 h-3 bg-white border-2 border-blue-500 transform rotate-45 ${
              position === 'bottom' ? '-top-2 left-8' :
              position === 'top' ? '-bottom-2 left-8' :
              position === 'right' ? '-left-2 top-6' :
              '-right-2 top-6'
            }`}
          />
        </CardContent>
      </Card>
    </div>
  );
}