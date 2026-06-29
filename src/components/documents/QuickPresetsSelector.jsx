import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";

const QUICK_PRESETS = [
  {
    id: "admission_onboarding",
    name: "Admission Onboarding",
    description: "Complete onboarding package for new admissions",
    documents: ["consent_form", "hipaa_authorization", "patient_info"],
    icon: "📋"
  },
  {
    id: "consent_packet",
    name: "Consent Packet",
    description: "Essential consent and authorization forms",
    documents: ["consent_form", "treatment_consent", "hipaa_authorization"],
    icon: "✍️"
  },
  {
    id: "discharge_package",
    name: "Discharge Package",
    description: "Discharge summary and care instructions",
    documents: ["discharge_summary", "care_instructions", "follow_up_plan"],
    icon: "📤"
  },
  {
    id: "care_plan_review",
    name: "Care Plan Review",
    description: "Care plan with patient/caregiver acknowledgment",
    documents: ["care_plan", "acknowledgment_form"],
    icon: "🎯"
  }
];

export default function QuickPresetsSelector({ onSelectPreset }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Quick Presets</h3>
        <p className="text-sm text-slate-600">Start with a pre-configured package</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {QUICK_PRESETS.map((preset) => (
          <Card
            key={preset.id}
            className="p-4 cursor-pointer hover:shadow-md transition-all hover:border-indigo-300"
            onClick={() => onSelectPreset(preset)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-2xl mb-2">{preset.icon}</div>
                <h4 className="font-semibold text-slate-900 text-sm sm:text-base truncate">
                  {preset.name}
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 line-clamp-2">
                  {preset.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {preset.documents.map((doc) => (
                    <span
                      key={doc}
                      className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded"
                    >
                      {doc.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Button
              className="w-full mt-3 text-xs sm:text-sm"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onSelectPreset(preset);
              }}
            >
              <Plus className="w-3 h-3 mr-1" />
              Use Preset
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}