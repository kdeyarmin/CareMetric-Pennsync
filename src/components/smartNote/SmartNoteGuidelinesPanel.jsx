import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import ProviderFocusChecklist from "./ProviderFocusChecklist";

const PROVIDER_TYPE_SPECIFIC_GUIDANCE = {
  MD: {
    note_focus: "Physician notes emphasize diagnostic reasoning, medical decision-making, and justification for orders/referrals. Include comprehensive HPI, ROS, physical exam findings, and assessment/plan, correlating with CPT/ICD-10 coding.",
    required_elements_additions: [
      "Medical Decision Making (MDM) documented",
      "Justification for orders/referrals",
      "Correlation of assessment/plan with CPT/ICD-10 codes"
    ]
  },
  NP: {
    note_focus: "Nurse Practitioner notes blend medical and nursing models, emphasizing holistic patient care, health promotion, and disease prevention. Include comprehensive assessment, diagnostic reasoning, treatment plan, and patient education with psychosocial factors.",
    required_elements_additions: [
      "Health promotion/disease prevention strategies",
      "Detailed patient education plan",
      "Psychosocial assessment and interventions",
      "Patient/family understanding and compliance documented"
    ]
  },
  RN: {
    note_focus: "Registered Nurse notes focus on skilled nursing interventions, patient responses, care plan adherence, and assessment of physical/mental/functional status. Emphasize patient education, safety, and coordination of care.",
    required_elements_additions: [
      "Detailed skilled nursing interventions",
      "Patient's response to interventions",
      "Coordination of care with other disciplines"
    ]
  },
  PT: {
    note_focus: "Physical Therapy notes focus on functional assessments, mobility, therapeutic exercises, and progress towards rehabilitation goals. Document objective measures, treatment interventions, and patient's tolerance/progress.",
    required_elements_additions: [
      "Objective functional measurements",
      "Therapeutic exercise details",
      "Progress toward physical therapy goals"
    ]
  },
  OT: {
    note_focus: "Occupational Therapy notes focus on ADL/IADL assessments, adaptive strategies, and progress towards occupational goals. Document interventions to improve daily living skills, patient safety, and use of adaptive equipment.",
    required_elements_additions: [
      "ADL/IADL assessment and interventions",
      "Adaptive equipment training",
      "Progress toward occupational therapy goals"
    ]
  },
  ST: {
    note_focus: "Speech-Language Pathology notes focus on communication, swallowing, and cognitive assessments/interventions. Document objective findings, treatment techniques, and patient progress in these areas.",
    required_elements_additions: [
      "Communication/swallowing assessment",
      "Cognitive function assessment and interventions",
      "Progress toward speech-language pathology goals"
    ]
  },
  MSW: {
    note_focus: "Medical Social Worker notes focus on psychosocial assessments, emotional support, resource allocation, and discharge planning. Document patient/family coping, financial/housing needs, and referrals.",
    required_elements_additions: [
      "Psychosocial assessment and support",
      "Resource allocation and referrals",
      "Discharge planning and support"
    ]
  }
};

const VISIT_TYPE_REQUIREMENTS = {
  admission: {
    required_elements: [
      "Homebound status verification",
      "Skilled nursing need justification",
      "Comprehensive assessment (physical, mental, functional)",
      "Medications list and review",
      "Allergies documented",
      "Prior medical/surgical history",
      "Baseline vital signs",
      "Functional status assessment",
      "Living situation and support system",
      "Initial care plan with goals",
      "Patient/family education documented"
    ],
    regulatory_references: [
      "42 CFR 484.55 - Nursing Services",
      "42 CFR 484.60 - Medical Record",
      "OASIS-E Comprehensiveness"
    ],
    estimated_time: "30-45 minutes"
  },
  routine_visit: {
    required_elements: [
      "Vital signs (temperature, BP, HR, O2 sat)",
      "Patient response to care/interventions",
      "Assessment of current status",
      "Interventions performed",
      "Patient/caregiver education",
      "Care plan adherence",
      "Any changes in condition",
      "Safety assessment"
    ],
    regulatory_references: [
      "42 CFR 484.55 - Skilled Nursing Standards",
      "CMS Home Health Services Guidelines"
    ],
    estimated_time: "15-25 minutes"
  },
  recertification: {
    required_elements: [
      "Physician recertification signature",
      "Updated assessment of patient status",
      "Progress toward goals",
      "Changes since last recertification",
      "Updated OASIS assessment",
      "Modified care plan if needed",
      "Homebound status re-verification",
      "Skilled need validation"
    ],
    regulatory_references: [
      "42 CFR 484.55 - Recertification Requirements",
      "OASIS-E Recertification Timeline"
    ],
    estimated_time: "20-30 minutes"
  },
  discharge: {
    required_elements: [
      "Reason for discharge",
      "Final assessment summary",
      "Status of goals achieved/not achieved",
      "Patient discharge disposition",
      "Discharge instructions provided",
      "Patient education summary",
      "Follow-up care recommendations",
      "Equipment/supplies status",
      "Physician notification documented"
    ],
    regulatory_references: [
      "42 CFR 484.60 - Discharge Planning",
      "CMS Discharge Documentation Standards"
    ],
    estimated_time: "20-30 minutes"
  },
  prn: {
    required_elements: [
      "Reason for urgent visit",
      "Assessment findings",
      "Actions taken",
      "Patient response",
      "Physician notification (if applicable)",
      "Follow-up plan"
    ],
    regulatory_references: [
      "42 CFR 484.55 - As-Needed Visit Standards"
    ],
    estimated_time: "10-20 minutes"
  }
};

const COMPLIANCE_REQUIREMENTS = [
  {
    category: "Medicare CoPs",
    items: [
      { rule: "Homebound Verification", description: "Patient must be unable to leave home safely" },
      { rule: "Skilled Nursing Need", description: "Services must require RN/LPN skill level" },
      { rule: "Physician Order", description: "Home health services must be physician-ordered" },
      { rule: "Frequency Justification", description: "Visit frequency must match clinical need" }
    ]
  },
  {
    category: "Documentation Standards",
    items: [
      { rule: "Legible/Clear", description: "All entries must be clear and professional" },
      { rule: "Timely Entry", description: "Notes must be documented within 24 hours of visit" },
      { rule: "Complete Information", description: "All required fields must be completed" },
      { rule: "Patient-Specific", description: "Documentation must reflect individual patient status" }
    ]
  },
  {
    category: "Clinical Content",
    items: [
      { rule: "Assessment Present", description: "Must document current patient status" },
      { rule: "Interventions Documented", description: "All nursing actions must be recorded" },
      { rule: "Patient Response", description: "Must document how patient responded to care" },
      { rule: "Safety Addressed", description: "Must address any safety concerns/interventions" }
    ]
  }
];

export default function SmartNoteGuidelinesPanel({
  visitType = "routine_visit",
  providerType = "RN",
  diagnosis = "",
  noteContent = "",
  onSectionSelect = null
}) {
  const [checkedItems, setCheckedItems] = useState({});

  const requirements = useMemo(() => {
    const baseRequirements = VISIT_TYPE_REQUIREMENTS[visitType] || VISIT_TYPE_REQUIREMENTS.routine_visit;
    const providerSpecific = PROVIDER_TYPE_SPECIFIC_GUIDANCE[providerType];

    if (providerSpecific) {
      return {
        ...baseRequirements,
        required_elements: [...baseRequirements.required_elements, ...(providerSpecific.required_elements_additions || [])],
        note_focus: providerSpecific.note_focus
      };
    }
    return baseRequirements;
  }, [visitType, providerType]);

  const toggleCheck = (item) => {
    setCheckedItems(prev => ({
      ...prev,
      [item]: !prev[item]
    }));
  };

  const completenessScore = useMemo(() => {
    const checkedCount = Object.values(checkedItems).filter(Boolean).length;
    return Math.round((checkedCount / requirements.required_elements.length) * 100);
  }, [checkedItems, requirements]);

  return (
    <Card className="w-full border-green-200 bg-green-50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">Documentation Guidelines</CardTitle>
          <Badge variant={completenessScore >= 80 ? "default" : "secondary"} className="text-xs">
            {completenessScore}% Complete
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="checklist" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-8">
            <TabsTrigger value="checklist" className="text-xs">Checklist</TabsTrigger>
            <TabsTrigger value="compliance" className="text-xs">Compliance</TabsTrigger>
            <TabsTrigger value="guidelines" className="text-xs">Guidelines</TabsTrigger>
            <TabsTrigger value="provider" className="text-xs">Provider Focus</TabsTrigger>
          </TabsList>

          {/* Checklist Tab */}
          <TabsContent value="checklist" className="space-y-2 mt-3">
            <div className="bg-white p-2 rounded border mb-2">
              <p className="text-xs font-semibold text-gray-900 mb-1">
                {visitType.replace(/_/g, " ").toUpperCase()} Requirements
              </p>
              <p className="text-xs text-gray-600">{requirements.estimated_time} estimated</p>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {requirements.required_elements.map((element, idx) => (
                <div key={idx} className="flex items-start gap-2 bg-white p-2 rounded border">
                  <Checkbox
                    checked={checkedItems[element] || false}
                    onCheckedChange={() => toggleCheck(element)}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-gray-700 flex-1">{element}</span>
                  {checkedItems[element] && (
                    <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>

            <div className="bg-blue-50 p-2 rounded border border-blue-200 mt-2">
              <p className="text-xs font-semibold text-blue-900 mb-1">Regulatory References</p>
              <ul className="space-y-0.5">
                {requirements.regulatory_references.map((ref, idx) => (
                  <li key={idx} className="text-xs text-blue-800">• {ref}</li>
                ))}
              </ul>
            </div>
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="space-y-2 mt-3">
            {COMPLIANCE_REQUIREMENTS.map((section, sidx) => (
              <div key={sidx} className="bg-white p-2 rounded border">
                <p className="text-xs font-semibold text-gray-900 mb-1">{section.category}</p>
                <div className="space-y-1">
                  {section.items.map((item, idx) => (
                    <div key={idx} className="text-xs border-t pt-1">
                      <p className="font-medium text-gray-800">{item.rule}</p>
                      <p className="text-gray-600 text-[11px]">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>

          {/* Guidelines Tab */}
          <TabsContent value="guidelines" className="space-y-2 mt-3">
            <div className="bg-white p-2 rounded border">
              <div className="flex items-start gap-2 mb-1">
                <Clock className="w-3 h-3 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-gray-900">Document Timely</p>
                  <p className="text-xs text-gray-600">Complete notes within 24 hours of visit for regulatory compliance</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-2 rounded border">
              <div className="flex items-start gap-2 mb-1">
                <AlertCircle className="w-3 h-3 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-gray-900">Be Patient-Specific</p>
                  <p className="text-xs text-gray-600">Avoid generic language; document actual findings and observations unique to this patient</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-2 rounded border">
              <div className="flex items-start gap-2 mb-1">
                <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-gray-900">Show Skilled Need</p>
                  <p className="text-xs text-gray-600">Clearly document the clinical skill required and why this patient needs skilled services</p>
                </div>
              </div>
            </div>

            {diagnosis && (
              <div className="bg-blue-50 p-2 rounded border border-blue-200">
                <p className="text-xs font-semibold text-blue-900 mb-1">Diagnosis-Specific Focus</p>
                <p className="text-xs text-blue-800">
                  For <strong>{diagnosis}</strong>: Ensure documentation addresses disease-specific assessments, interventions aligned with condition management, and response to therapy.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Provider Specific Tab */}
          <TabsContent value="provider" className="space-y-2 mt-3">
            {requirements.note_focus && (
              <div className="bg-white p-2 rounded border border-slate-200">
                <p className="text-xs font-semibold text-slate-900 mb-1">{providerType.toUpperCase()} Note Focus</p>
                <p className="text-xs text-slate-700 leading-relaxed">{requirements.note_focus}</p>
              </div>
            )}

            <ProviderFocusChecklist
              providerType={providerType}
              visitType={visitType}
              noteContent={noteContent}
              onSectionClick={onSectionSelect}
            />
          </TabsContent>
        </Tabs>

        {completenessScore < 80 && (
          <div className="mt-3 bg-amber-50 p-2 rounded border border-amber-200">
            <p className="text-xs font-semibold text-amber-900">⚠️ Completeness Alert</p>
            <p className="text-xs text-amber-800">
              {100 - completenessScore} elements remaining. Review checklist to ensure all required documentation is included.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}