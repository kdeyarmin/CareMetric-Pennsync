import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Zap, Copy, Trash2 } from "lucide-react";

const DEFAULT_TEMPLATES = {
  "routine_visit": {
    "CHF": [
      "Patient reports compliance with diuretics. Denies orthopnea or paroxysmal nocturnal dyspnea.",
      "Lung sounds clear bilaterally. No peripheral edema noted. Weight stable compared to last visit.",
      "Patient verbalized understanding of fluid restriction and sodium-limited diet."
    ],
    "COPD": [
      "Patient using rescue inhaler as prescribed. Denies increased shortness of breath or wheezing.",
      "Oxygen saturation adequate on current supplemental oxygen regimen.",
      "Breathing techniques reviewed and reinforced during visit."
    ],
    "Diabetes": [
      "Patient reports taking medications as prescribed. Blood glucose logs reviewed.",
      "Feet examined; no areas of breakdown or concerning changes noted.",
      "Dietary compliance discussed. Patient able to demonstrate proper medication administration."
    ]
  },
  "recertification": {
    "CHF": [
      "Significant improvement in exercise tolerance since admission. Baseline dyspnea on exertion now minimal with ADL participation.",
      "Weight stability maintained at [current weight] kg, compared to admission weight of [admission weight] kg.",
      "Patient independently managing diuretics and demonstrating understanding of fluid/sodium restrictions."
    ],
    "COPD": [
      "Oxygen requirements decreased from admission level. Current O2 sat maintained at [O2] on [oxygen source].",
      "Functional capacity improved; patient now performing ADLs without assistance vs. requiring moderate assist on admission.",
      "Ongoing skilled nursing monitoring for infection prevention and respiratory status changes remains medically necessary."
    ]
  },
  "discharge": {
    "CHF": [
      "On admission [date], patient presented with uncontrolled CHF requiring skilled nursing intervention. At discharge, patient demonstrates stable vital signs, appropriate diuretic response, and independent self-management.",
      "Patient/caregiver able to verbalize signs/symptoms requiring MD notification and has demonstrated dietary/fluid compliance throughout episode of care.",
      "Goals achieved: symptom management optimization and patient education regarding disease self-management."
    ],
    "Diabetes": [
      "Patient admitted with uncontrolled blood glucose and medication non-compliance. Discharged with stable glucose readings, demonstrated competency in medication administration, and verbalized understanding of dietary modifications.",
      "Skilled nursing services successfully transitioned patient to independent diabetes management with appropriate follow-up care arranged.",
      "Patient and caregiver education completed regarding medication timing, dietary choices, and when to seek medical attention."
    ]
  }
};

export default function ContextualPhraseTemplates({
  visitType,
  diagnosis,
  onInsertPhrase,
  compact = false
}) {
  const [showDialog, setShowDialog] = useState(false);
  const [customTemplates, setCustomTemplates] = useState([]);
  const [newPhrase, setNewPhrase] = useState("");
  const [newDiagnosis, setNewDiagnosis] = useState(diagnosis || "");

  // Get relevant templates based on visit type and diagnosis
  const relevantTemplates = useMemo(() => {
    const templates = [];
    
    // Get default templates
    const visitTemplates = DEFAULT_TEMPLATES[visitType] || {};
    const diagKey = diagnosis?.split("(")[0].trim() || "";
    
    if (visitTemplates[diagKey]) {
      templates.push(...visitTemplates[diagKey].map(t => ({ text: t, source: "default" })));
    }
    
    // Add custom templates
    const customMatches = customTemplates.filter(ct => 
      (!ct.visitType || ct.visitType === visitType) &&
      (!ct.diagnosis || ct.diagnosis === diagKey)
    );
    templates.push(...customMatches.map(ct => ({ text: ct.text, source: "custom", id: ct.id })));
    
    return templates;
  }, [visitType, diagnosis, customTemplates]);

  const handleAddCustomTemplate = () => {
    if (newPhrase.trim()) {
      setCustomTemplates([
        ...customTemplates,
        {
          id: Date.now(),
          text: newPhrase,
          visitType: visitType || "all",
          diagnosis: newDiagnosis || "all"
        }
      ]);
      setNewPhrase("");
      setNewDiagnosis("");
    }
  };

  const handleDeleteTemplate = (id) => {
    setCustomTemplates(customTemplates.filter(t => t.id !== id));
  };

  if (compact && relevantTemplates.length === 0) return null;

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            {compact ? "Quick Phrases" : "Contextual Phrases"}
          </CardTitle>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                <Plus className="w-3 h-3" />
                {compact ? "" : "New"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Custom Phrase Template</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="visit-type" className="text-sm">Visit Type</Label>
                  <Select value={newDiagnosis}>
                    <SelectTrigger>
                      <SelectValue placeholder="All visit types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>All visit types</SelectItem>
                      <SelectItem value="routine_visit">Routine Visit</SelectItem>
                      <SelectItem value="recertification">Recertification</SelectItem>
                      <SelectItem value="discharge">Discharge</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="diagnosis" className="text-sm">Diagnosis (optional)</Label>
                  <Input
                    id="diagnosis"
                    placeholder="e.g., CHF, COPD, Diabetes"
                    value={newDiagnosis}
                    onChange={(e) => setNewDiagnosis(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="phrase" className="text-sm">Phrase Text</Label>
                  <Textarea
                    id="phrase"
                    placeholder="Enter your custom phrase template..."
                    value={newPhrase}
                    onChange={(e) => setNewPhrase(e.target.value)}
                    rows={4}
                  />
                </div>
                <Button onClick={handleAddCustomTemplate} className="w-full">
                  Save Template
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {relevantTemplates.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-3">
            No templates for this visit type & diagnosis. Create one!
          </p>
        ) : (
          <>
            {relevantTemplates.map((template, idx) => (
              <div
                key={template.id || idx}
                className="p-2 bg-white rounded-lg border border-blue-100 group hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-gray-800 flex-1">{template.text}</p>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => onInsertPhrase(template.text)}
                      title="Insert phrase"
                    >
                      <Copy className="w-3 h-3 text-blue-600" />
                    </Button>
                    {template.source === "custom" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleDeleteTemplate(template.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </Button>
                    )}
                  </div>
                </div>
                {template.source === "custom" && (
                  <Badge variant="outline" className="text-xs mt-1">Custom</Badge>
                )}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}