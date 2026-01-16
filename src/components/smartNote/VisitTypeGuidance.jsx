import React from "react";
import { Lightbulb } from "lucide-react";

export default function VisitTypeGuidance({ visitType, diagnosis }) {
  const getGuidance = () => {
    const baseGuidance = {
      skilled_nursing: [
        "Document skilled nursing interventions performed",
        "Note patient's response to treatments",
        "Include vital signs and physical assessment findings",
        "Describe wound care or medication administration if applicable",
        "Document education provided to patient/caregiver"
      ],
      admission: [
        "Complete comprehensive assessment of patient's condition",
        "Document baseline vital signs and functional status",
        "List all current medications and allergies",
        "Assess home environment and safety concerns",
        "Establish goals of care with patient/family"
      ],
      recertification: [
        "Review progress toward established goals",
        "Document continued need for skilled services",
        "Update medication list and diagnoses",
        "Reassess functional status and care needs",
        "Include physician orders for continuing care"
      ],
      discharge: [
        "Summarize care provided during episode",
        "Document patient's progress and outcomes",
        "Confirm discharge disposition and follow-up plans",
        "Provide discharge education and written instructions",
        "Note reason for discharge (goals met, hospitalized, etc.)"
      ],
      routine_visit: [
        "Document skilled interventions and treatments",
        "Note changes in patient condition",
        "Record vital signs and assessment findings",
        "Update medication compliance and effectiveness",
        "Document any new concerns or issues"
      ]
    };

    return baseGuidance[visitType] || [];
  };

  const guidance = getGuidance();

  if (guidance.length === 0) return null;

  return (
    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
      <div className="flex items-start gap-2 mb-2">
        <Lightbulb className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            Documentation Tips for {visitType.replace(/_/g, ' ')}:
          </p>
        </div>
      </div>
      <ul className="space-y-1 ml-6">
        {guidance.map((tip, idx) => (
          <li key={idx} className="text-xs text-blue-800 dark:text-blue-200">
            • {tip}
          </li>
        ))}
      </ul>
    </div>
  );
}