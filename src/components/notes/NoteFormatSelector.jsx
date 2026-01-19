import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { FileText, Brain, MessageSquare, Stethoscope } from "lucide-react";

const NOTE_FORMATS = {
  soap: {
    name: "SOAP",
    description: "Subjective, Objective, Assessment, Plan",
    icon: FileText,
    sections: ["Subjective", "Objective", "Assessment", "Plan"],
    bestFor: ["Primary Care", "Internal Medicine", "Family Medicine"]
  },
  dap: {
    name: "DAP",
    description: "Data, Assessment, Plan",
    icon: Brain,
    sections: ["Data", "Assessment", "Plan"],
    bestFor: ["Psychiatry", "Psychology", "Behavioral Health"]
  },
  narrative: {
    name: "Narrative",
    description: "Free-form chronological narrative",
    icon: MessageSquare,
    sections: ["Chief Complaint", "History of Present Illness", "Clinical Findings", "Plan"],
    bestFor: ["Emergency Medicine", "Urgent Care"]
  },
  home_health: {
    name: "Home Health",
    description: "Home health/hospice focused format",
    icon: Stethoscope,
    sections: ["Visit Type", "Patient Status", "Vital Signs", "Systems Assessment", "Interventions", "Response to Care", "Plan of Care"],
    bestFor: ["Home Health", "Hospice", "Skilled Nursing"]
  },
  custom: {
    name: "Custom",
    description: "Build your own format",
    icon: FileText,
    sections: [],
    bestFor: ["All Specialties"]
  }
};

const SPECIALTY_DEFAULTS = {
  "Psychiatry": "dap",
  "Psychology": "dap",
  "Behavioral Health": "dap",
  "Emergency Medicine": "narrative",
  "Urgent Care": "narrative",
  "Home Health": "home_health",
  "Hospice": "home_health",
  "Primary Care": "soap",
  "Internal Medicine": "soap",
  "Family Medicine": "soap"
};

export default function NoteFormatSelector({ 
  selectedFormat, 
  onFormatChange, 
  specialty,
  showDescription = true,
  compact = false 
}) {
  const defaultFormat = specialty ? SPECIALTY_DEFAULTS[specialty] || "soap" : "soap";
  const currentFormat = selectedFormat || defaultFormat;

  if (compact) {
    return (
      <div className="space-y-2">
        <Label>Note Format</Label>
        <Select value={currentFormat} onValueChange={onFormatChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(NOTE_FORMATS).map(([key, format]) => (
              <SelectItem key={key} value={key}>
                {format.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const format = NOTE_FORMATS[currentFormat];
  const Icon = format?.icon || FileText;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Note Format</Label>
        <Select value={currentFormat} onValueChange={onFormatChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(NOTE_FORMATS).map(([key, format]) => {
              const FormatIcon = format.icon;
              return (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    <FormatIcon className="w-4 h-4" />
                    <span>{format.name}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {showDescription && format && (
        <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="space-y-2">
              <div>
                <p className="font-medium text-blue-900 dark:text-blue-100">{format.name}</p>
                <p className="text-sm text-blue-700 dark:text-blue-300">{format.description}</p>
              </div>
              
              {format.sections.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200 mb-1">Sections:</p>
                  <div className="flex flex-wrap gap-1">
                    {format.sections.map((section) => (
                      <span 
                        key={section} 
                        className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded"
                      >
                        {section}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Best for: {format.bestFor.join(", ")}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export { NOTE_FORMATS, SPECIALTY_DEFAULTS };