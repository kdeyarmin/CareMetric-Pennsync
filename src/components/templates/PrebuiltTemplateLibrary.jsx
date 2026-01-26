import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileText, Copy, Download, Eye, Filter, Search } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

const PREBUILT_TEMPLATES = [
  {
    id: 'sn-admission',
    template_name: "Skilled Nursing Admission Visit",
    description: "Comprehensive admission assessment for new patients",
    category: "skilled_nursing",
    visit_type: "admission",
    content: `SKILLED NURSING ADMISSION VISIT NOTE

Date: {{visit_date}}
Patient: {{patient_name}}
DOB: {{date_of_birth}}
MRN: {{medical_record_number}}

REASON FOR HOME HEALTH:
{{reason_for_referral}}

HOMEBOUND STATUS DOCUMENTATION:
Patient is homebound due to: {{homebound_reason}}
Requires: {{assistance_required}}
Unable to leave home without: {{transportation_assistance}}

VITAL SIGNS:
Temperature: {{temperature}}°F
Blood Pressure: {{bp_systolic}}/{{bp_diastolic}} mmHg
Heart Rate: {{heart_rate}} bpm
Respiratory Rate: {{respiratory_rate}} per minute
O2 Saturation: {{oxygen_saturation}}%
Pain Level: {{pain_level}}/10
Weight: {{weight}} lbs

CURRENT MEDICATIONS:
{{current_medications}}

ALLERGIES:
{{allergies}}

PHYSICAL ASSESSMENT:
General Appearance: {{general_appearance}}
Cardiovascular: {{cardiovascular_findings}}
Respiratory: {{respiratory_findings}}
Neurological: {{neurological_findings}}
Skin/Wounds: {{skin_assessment}}
Mobility: {{mobility_assessment}}

SKILLED INTERVENTION PROVIDED:
{{skilled_interventions}}

PATIENT/CAREGIVER EDUCATION:
{{education_provided}}

PLAN OF CARE:
{{plan_of_care}}

RN Signature: {{nurse_signature}}
Date/Time: {{datetime}}`,
    required_elements: [
      "Homebound status verification",
      "Vital signs documentation",
      "Medication reconciliation",
      "Skilled intervention justification",
      "Patient education provided",
      "Plan of care established"
    ],
    tags: ["admission", "skilled nursing", "assessment", "medicare"],
    is_system_template: true
  },
  {
    id: 'sn-routine',
    template_name: "Skilled Nursing Routine Visit",
    description: "Standard skilled nursing visit documentation",
    category: "skilled_nursing",
    visit_type: "routine",
    content: `SKILLED NURSING VISIT NOTE

Date: {{visit_date}}
Time: {{visit_time}}
Patient: {{patient_name}}

VISIT FOCUS:
{{visit_focus}}

VITAL SIGNS:
BP: {{bp_systolic}}/{{bp_diastolic}} | HR: {{heart_rate}} | RR: {{respiratory_rate}} | Temp: {{temperature}}°F | O2 Sat: {{oxygen_saturation}}% | Pain: {{pain_level}}/10

ASSESSMENT:
Patient presents as: {{patient_presentation}}
{{assessment_findings}}

SKILLED INTERVENTION:
{{skilled_interventions_performed}}

PATIENT RESPONSE:
{{patient_response}}

MEDICATION REVIEW:
{{medication_compliance_assessment}}
Changes: {{medication_changes}}

PATIENT/CAREGIVER EDUCATION:
Educated on: {{education_topics}}
Understanding demonstrated: {{comprehension_level}}

PLAN:
{{next_visit_plan}}
Frequency: {{visit_frequency}}

RN Signature: {{nurse_signature}}`,
    required_elements: [
      "Vital signs",
      "Assessment findings",
      "Skilled intervention documentation",
      "Patient response to treatment",
      "Education provided",
      "Plan for next visit"
    ],
    tags: ["routine", "skilled nursing", "medicare compliant"],
    is_system_template: true
  },
  {
    id: 'oasis-admission',
    template_name: "OASIS-E Admission Assessment",
    description: "Comprehensive OASIS-E admission documentation template",
    category: "oasis",
    visit_type: "admission",
    content: `OASIS-E ADMISSION ASSESSMENT

(M0010) CMS Certification Number: {{cms_certification_number}}
(M0014) Branch State: {{branch_state}}
(M0016) Branch ID: {{branch_id}}
(M0018) National Provider Identifier (NPI): {{npi}}

PATIENT DEMOGRAPHICS:
(M0020) Patient ID: {{patient_id}}
(M0030) Start of Care Date: {{soc_date}}
(M0040) Patient Name: {{patient_name}}
(M0050) Patient State of Residence: {{patient_state}}
(M0060) Patient ZIP Code: {{patient_zip}}
(M0063) Medicare Number: {{medicare_number}}
(M0065) Medicaid Number: {{medicaid_number}}
(M0066) Birth Date: {{date_of_birth}}
(M0069) Gender: {{gender}}

PAYMENT SOURCES:
(M0150) Current Payment Sources: {{payment_sources}}

INPATIENT FACILITIES:
(M1000) From which setting was patient discharged: {{dc_facility_setting}}
(M1005) Inpatient Discharge Date: {{dc_date}}
(M1010) List Inpatient Diagnoses: {{inpatient_diagnoses}}
(M1011) Inpatient Procedures: {{inpatient_procedures}}

DIAGNOSES:
(M1021) Primary Diagnosis: {{primary_diagnosis_icd10}}
(M1023) Other Diagnoses:
  {{secondary_diagnoses}}

LIVING ARRANGEMENTS:
(M1100) Patient Living Situation: {{living_situation}}
(M1610) When Confused: {{cognitive_confusion_frequency}}
(M1620) When Anxious: {{anxiety_frequency}}

SENSORY STATUS:
(M1200) Vision: {{vision_status}}
(M1242) Hearing: {{hearing_status}}

SKIN:
(M1306) Unhealed Pressure Ulcer: {{pressure_ulcer_present}}
(M1307) Oldest Stage 2 Pressure Ulcer: {{stage_2_present}}
(M1308) Current Number of Unhealed Pressure Ulcers:
  Stage 2: {{stage_2_count}}
  Stage 3: {{stage_3_count}}
  Stage 4: {{stage_4_count}}
(M1322) Current Number of Stasis Ulcers: {{stasis_ulcer_count}}
(M1324) Stasis Ulcer Status: {{stasis_status}}
(M1330) Surgical Wounds: {{surgical_wound_present}}
(M1332) Surgical Wound Status: {{surgical_wound_status}}

FUNCTIONAL ABILITIES:
(M1800) Grooming: {{grooming_level}}
(M1810) Current Ability to Dress Upper Body: {{dress_upper_body}}
(M1820) Current Ability to Dress Lower Body: {{dress_lower_body}}
(M1830) Bathing: {{bathing_level}}
(M1840) Toilet Transferring: {{toilet_transfer}}
(M1845) Toileting Hygiene: {{toileting_hygiene}}
(M1850) Transferring: {{transfer_level}}
(M1860) Ambulation/Locomotion: {{ambulation_level}}
(M1870) Feeding or Eating: {{feeding_level}}

MEDICATIONS:
(M2001) Drug Regimen Review: {{drug_regimen_review}}
(M2003) Medication Follow-up: {{medication_followup}}
(M2010) High-Risk Drug Classes: {{high_risk_drugs}}
(M2020) Management of Oral Medications: {{oral_med_management}}
(M2030) Management of Injectable Medications: {{injectable_management}}

CARE MANAGEMENT:
(M2102) Care Type: {{care_type}}
(M2200) Therapy Need: {{therapy_need}}

SIGNATURE:
Clinician: {{clinician_name}}
Date: {{assessment_date}}`,
    required_elements: [
      "Complete patient demographics",
      "Payment source verification",
      "Primary and secondary diagnoses (ICD-10)",
      "Living arrangements and safety",
      "Complete functional assessment (ADLs)",
      "Medication management assessment",
      "Skin integrity assessment",
      "Cognitive and behavioral assessment"
    ],
    tags: ["oasis", "assessment", "admission", "medicare", "cms"],
    is_system_template: true
  },
  {
    id: 'care-plan-chf',
    template_name: "Care Plan: Congestive Heart Failure",
    description: "Evidence-based care plan for CHF management",
    category: "care_plan",
    content: `CARE PLAN - CONGESTIVE HEART FAILURE

Patient: {{patient_name}}
Date Initiated: {{plan_start_date}}

PROBLEM #1: Fluid Volume Excess
Related to: Decreased cardiac output and sodium/fluid retention

GOAL:
Patient will maintain optimal fluid balance as evidenced by:
- Weight within {{target_weight_min}}-{{target_weight_max}} lbs
- Clear lung sounds
- Absence of peripheral edema
- Vital signs within normal limits
Target Date: {{goal_target_date}}

INTERVENTIONS:
1. Monitor daily weights (report gain of >2 lbs in 1 day or >5 lbs in 1 week)
2. Assess for signs of fluid overload: edema, dyspnea, orthopnea, weight gain
3. Monitor vital signs, especially BP and respiratory status
4. Educate on sodium restriction (<2000mg/day)
5. Educate on fluid restriction if ordered ({{fluid_restriction}})
6. Monitor medication compliance (diuretics, ACE inhibitors, beta blockers)
7. Teach patient to monitor symptoms and when to call physician
8. Review dietary choices and assist with meal planning

PROBLEM #2: Activity Intolerance
Related to: Decreased cardiac output and fatigue

GOAL:
Patient will demonstrate improved activity tolerance as evidenced by:
- Ability to perform ADLs with minimal shortness of breath
- Reports decreased fatigue
- Ambulates {{ambulation_goal}} without dyspnea
Target Date: {{goal_target_date_2}}

INTERVENTIONS:
1. Assess activity tolerance and functional capacity
2. Monitor vital signs before and after activity
3. Educate on energy conservation techniques
4. Develop progressive activity plan
5. Encourage alternating rest and activity periods
6. Monitor oxygen saturation during activities
7. Coordinate with PT if indicated

PROBLEM #3: Knowledge Deficit
Related to: Disease process and self-management

GOAL:
Patient/caregiver will verbalize understanding of:
- CHF disease process
- Medication regimen and purpose
- Dietary restrictions
- Warning signs requiring physician notification
- When to call 911
Target Date: {{education_goal_date}}

INTERVENTIONS:
1. Assess current knowledge level and learning needs
2. Provide CHF education materials
3. Review all medications: purpose, dose, frequency, side effects
4. Teach warning signs: increased SOB, chest pain, weight gain, edema
5. Provide written emergency contact information
6. Use teach-back method to verify understanding
7. Involve caregiver in all education

Clinician: {{clinician_name}}
Date: {{plan_date}}`,
    required_elements: [
      "Nursing diagnosis",
      "Measurable goals with target dates",
      "Evidence-based interventions",
      "Patient education plan",
      "Evaluation criteria"
    ],
    tags: ["care plan", "chf", "heart failure", "chronic disease"],
    is_system_template: true
  },
  {
    id: 'discharge-summary',
    template_name: "Discharge Summary",
    description: "Comprehensive patient discharge documentation",
    category: "discharge",
    visit_type: "discharge",
    content: `DISCHARGE SUMMARY

Patient: {{patient_name}}
MRN: {{medical_record_number}}
Admission Date: {{admission_date}}
Discharge Date: {{discharge_date}}
Length of Service: {{length_of_service}} days

DISCHARGE DISPOSITION:
Discharged to: {{discharge_to}}
Reason for Discharge: {{discharge_reason}}

DIAGNOSES AT DISCHARGE:
Primary: {{primary_diagnosis}}
Secondary: {{secondary_diagnoses}}

SUMMARY OF CARE:
{{care_summary}}

Total Visits Completed:
- Skilled Nursing: {{sn_visit_count}}
- Physical Therapy: {{pt_visit_count}}
- Occupational Therapy: {{ot_visit_count}}
- Speech Therapy: {{st_visit_count}}
- Social Work: {{msw_visit_count}}

GOALS ACHIEVED:
{{goals_met}}

GOALS NOT MET:
{{goals_not_met}}
Reason: {{goals_not_met_reason}}

FUNCTIONAL STATUS AT DISCHARGE:
Ambulation: {{discharge_ambulation_status}}
ADL Independence: {{discharge_adl_status}}
IADL Independence: {{discharge_iadl_status}}
Cognitive Status: {{discharge_cognitive_status}}

DISCHARGE MEDICATIONS:
{{discharge_medications}}

DISCHARGE INSTRUCTIONS:
{{discharge_instructions}}

FOLLOW-UP CARE:
Physician Follow-up: {{physician_followup}}
Outpatient Services: {{outpatient_services}}
DME Needs: {{dme_requirements}}

PATIENT/CAREGIVER EDUCATION:
{{discharge_education}}

PATIENT UNDERSTANDING:
Patient/caregiver verbalized understanding of:
- Discharge instructions: {{understands_instructions}}
- Medication regimen: {{understands_medications}}
- Warning signs to report: {{understands_warning_signs}}
- Follow-up appointments: {{understands_followup}}

EQUIPMENT/SUPPLIES PROVIDED:
{{equipment_provided}}

COMMUNICATION:
Physician notified of discharge: {{physician_notified}}
Date/Time: {{physician_notification_datetime}}
Referrals sent to: {{referrals_sent}}

Clinician Name: {{clinician_name}}
Signature: {{signature}}
Date: {{signature_date}}`,
    required_elements: [
      "Admission and discharge dates",
      "Discharge disposition and reason",
      "Goals met/not met with rationale",
      "Functional status at discharge",
      "Discharge medications",
      "Patient education and comprehension verification",
      "Follow-up care arrangements",
      "Physician notification"
    ],
    tags: ["discharge", "summary", "medicare", "transition of care"],
    is_system_template: true
  },
  {
    id: 'wound-care',
    template_name: "Skilled Wound Care Visit",
    description: "Detailed wound assessment and treatment documentation",
    category: "skilled_nursing",
    visit_type: "routine",
    content: `SKILLED WOUND CARE VISIT NOTE

Date: {{visit_date}}
Patient: {{patient_name}}

WOUND ASSESSMENT:
Location: {{wound_location}}
Type: {{wound_type}}
Onset Date: {{wound_onset_date}}

Size:
- Length: {{wound_length}} cm
- Width: {{wound_width}} cm  
- Depth: {{wound_depth}} cm

Wound Bed:
- Tissue Type: {{tissue_type}}
- % Granulation: {{granulation_percent}}%
- % Slough: {{slough_percent}}%
- % Eschar: {{eschar_percent}}%
- % Necrotic: {{necrotic_percent}}%

Exudate:
- Amount: {{exudate_amount}}
- Type: {{exudate_type}}
- Color: {{exudate_color}}
- Odor: {{odor_present}}

Wound Edges: {{wound_edges}}
Periwound Skin: {{periwound_condition}}
Pain Level: {{wound_pain}}/10

Signs of Infection: {{infection_signs}}

SKILLED INTERVENTION:
1. Cleansed wound with {{cleansing_solution}}
2. Applied: {{dressing_type}}
3. Secured with: {{securing_method}}
4. {{additional_interventions}}

PATIENT RESPONSE:
{{patient_response_to_treatment}}

PROGRESS TOWARD HEALING:
{{healing_progress}}

PATIENT/CAREGIVER EDUCATION:
{{wound_care_education}}

PLAN:
Continue current treatment regimen
Next wound measurement: {{next_measurement_date}}
Contact physician if: {{physician_notification_criteria}}

RN Signature: {{nurse_signature}}`,
    required_elements: [
      "Complete wound measurements (L x W x D)",
      "Wound bed tissue types with percentages",
      "Exudate description",
      "Signs of infection assessment",
      "Skilled intervention performed",
      "Patient response to treatment",
      "Progress toward healing",
      "Education provided"
    ],
    tags: ["wound care", "skilled nursing", "assessment", "treatment"],
    is_system_template: true
  },
  {
    id: 'pt-eval',
    template_name: "Physical Therapy Initial Evaluation",
    description: "PT initial evaluation and plan of care",
    category: "physical_therapy",
    visit_type: "admission",
    content: `PHYSICAL THERAPY INITIAL EVALUATION

Date: {{eval_date}}
Patient: {{patient_name}}
Referral Diagnosis: {{referral_diagnosis}}

HISTORY:
Chief Complaint: {{chief_complaint}}
Mechanism of Injury/Onset: {{onset_mechanism}}
Prior Level of Function: {{prior_function_level}}
Current Functional Limitations: {{current_limitations}}

HOMEBOUND STATUS:
{{homebound_justification}}

MEDICATIONS AFFECTING THERAPY:
{{relevant_medications}}

OBJECTIVE ASSESSMENT:

Posture: {{posture_assessment}}
Gait: {{gait_assessment}}
Assistive Device: {{assistive_device}}

Range of Motion:
{{rom_measurements}}

Strength (0-5 scale):
{{strength_measurements}}

Balance:
Berg Balance Scale: {{berg_score}}/56
Tinetti: {{tinetti_score}}
Single Leg Stance: {{single_leg_time}} seconds

Transfers:
Bed Mobility: {{bed_mobility_level}}
Sit to Stand: {{sit_to_stand_level}}
Transfers: {{transfer_level}}

Functional Mobility:
Ambulation Distance: {{ambulation_distance}}
Stairs: {{stair_climbing_ability}}

Special Tests:
{{special_tests_performed}}

ASSESSMENT/CLINICAL IMPRESSION:
{{clinical_impression}}
Rehabilitation Potential: {{rehab_potential}}

GOALS (within {{goal_timeframe}}):
1. {{goal_1}}
2. {{goal_2}}
3. {{goal_3}}

PLAN OF CARE:
Frequency: {{visit_frequency}}
Duration: {{treatment_duration}}
Treatment Approach:
{{treatment_interventions}}

PT Signature: {{therapist_signature}}
Date: {{signature_date}}`,
    required_elements: [
      "Prior level of function",
      "Objective measurements (ROM, strength, balance)",
      "Functional limitations",
      "Rehabilitation potential",
      "Measurable functional goals",
      "Treatment plan with frequency",
      "Homebound status"
    ],
    tags: ["physical therapy", "evaluation", "functional assessment"],
    is_system_template: true
  },
  {
    id: 'care-plan-diabetes',
    template_name: "Care Plan: Diabetes Management",
    description: "Comprehensive diabetes management care plan",
    category: "care_plan",
    content: `CARE PLAN - DIABETES MANAGEMENT

Patient: {{patient_name}}
Type: {{diabetes_type}}
Date: {{plan_date}}

PROBLEM #1: Unstable Blood Glucose Levels
Related to: {{blood_sugar_factors}}

GOAL:
Patient will maintain blood glucose levels between {{target_range_low}}-{{target_range_high}} mg/dL
HbA1c: <{{target_a1c}}%
Target Date: {{goal_date}}

INTERVENTIONS:
1. Monitor blood glucose levels {{bg_frequency}}
2. Assess for hypo/hyperglycemia symptoms
3. Review glucose log and identify patterns
4. Educate on proper testing technique
5. Coordinate with physician for medication adjustments
6. Teach sick-day management
7. Assess medication compliance

PROBLEM #2: Knowledge Deficit - Diabetes Self-Management

GOAL:
Patient will demonstrate proper diabetes self-care as evidenced by:
- Correct glucose testing technique
- Appropriate insulin administration (if applicable)
- Proper foot care
- Recognition of hypo/hyperglycemia symptoms
Target Date: {{education_goal_date}}

INTERVENTIONS:
1. Assess current knowledge and learning barriers
2. Provide diabetes education materials
3. Demonstrate and supervise glucose testing
4. Teach insulin administration technique (if applicable)
5. Educate on nutrition and carbohydrate counting
6. Teach foot inspection and care
7. Provide emergency contact numbers
8. Use teach-back method to verify understanding

PROBLEM #3: Risk for Impaired Skin Integrity

GOAL:
Patient will maintain intact skin as evidenced by:
- No new skin breakdown
- Healing of existing lesions
- Demonstrates proper foot care
Target Date: {{skin_goal_date}}

INTERVENTIONS:
1. Perform comprehensive foot assessment each visit
2. Assess for areas of pressure, redness, breakdown
3. Educate on daily foot inspection
4. Teach proper foot hygiene and nail care
5. Assess footwear for proper fit
6. Monitor circulation and sensation
7. Coordinate podiatry referral if needed

Clinician: {{clinician_name}}
Next Review: {{next_review_date}}`,
    required_elements: [
      "Blood glucose management plan",
      "Patient education goals and methods",
      "Foot care and skin integrity monitoring",
      "Medication management",
      "Dietary education"
    ],
    tags: ["care plan", "diabetes", "chronic disease", "patient education"],
    is_system_template: true
  }
];

export default function PrebuiltTemplateLibrary({ onUseTemplate }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const filteredTemplates = useMemo(() => {
    return PREBUILT_TEMPLATES.filter(template => {
      const matchesSearch = !searchTerm || 
        template.template_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCategory = selectedCategory === "all" || template.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory]);

  const handleUseTemplate = async (template) => {
    try {
      await base44.entities.DocumentTemplate.create({
        template_name: `${template.template_name} (Copy)`,
        description: template.description,
        category: template.category,
        visit_type: template.visit_type,
        content: template.content,
        required_elements: template.required_elements,
        tags: template.tags,
        is_system_template: false
      });
      toast.success("Template added to your library!");
      onUseTemplate?.();
    } catch (error) {
      toast.error("Failed to save template: " + error.message);
    }
  };

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content);
    toast.success("Template content copied!");
  };

  const categoryColors = {
    skilled_nursing: "bg-blue-100 text-blue-800 border-blue-200",
    physical_therapy: "bg-green-100 text-green-800 border-green-200",
    occupational_therapy: "bg-purple-100 text-purple-800 border-purple-200",
    speech_therapy: "bg-pink-100 text-pink-800 border-pink-200",
    social_work: "bg-yellow-100 text-yellow-800 border-yellow-200",
    care_plan: "bg-indigo-100 text-indigo-800 border-indigo-200",
    oasis: "bg-orange-100 text-orange-800 border-orange-200",
    discharge: "bg-red-100 text-red-800 border-red-200",
    admission: "bg-teal-100 text-teal-800 border-teal-200"
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Pre-built Template Library
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="w-48">
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                  <SelectItem value="physical_therapy">Physical Therapy</SelectItem>
                  <SelectItem value="care_plan">Care Plans</SelectItem>
                  <SelectItem value="oasis">OASIS</SelectItem>
                  <SelectItem value="discharge">Discharge</SelectItem>
                  <SelectItem value="admission">Admission</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-sm text-gray-600">
            Showing {filteredTemplates.length} of {PREBUILT_TEMPLATES.length} templates
          </div>
        </CardContent>
      </Card>

      {/* Templates Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {filteredTemplates.map((template) => (
          <Card key={template.id} className="hover:shadow-lg transition-all">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    {template.template_name}
                  </CardTitle>
                  <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge className={categoryColors[template.category] || "bg-gray-100"}>
                  {template.category.replace(/_/g, ' ')}
                </Badge>
                {template.visit_type && (
                  <Badge variant="outline">{template.visit_type}</Badge>
                )}
                {template.required_elements && (
                  <Badge variant="outline">
                    {template.required_elements.length} required elements
                  </Badge>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPreviewTemplate(template);
                    setPreviewOpen(true);
                  }}
                  className="flex-1"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleUseTemplate(template)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Use Template
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredTemplates.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No templates match your search criteria</p>
          </CardContent>
        </Card>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {previewTemplate?.template_name}
            </DialogTitle>
            <DialogDescription>
              {previewTemplate?.description}
            </DialogDescription>
          </DialogHeader>

          {previewTemplate && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge className={categoryColors[previewTemplate.category]}>
                  {previewTemplate.category.replace(/_/g, ' ')}
                </Badge>
                {previewTemplate.visit_type && (
                  <Badge variant="outline">{previewTemplate.visit_type}</Badge>
                )}
              </div>

              <div>
                <Label className="text-sm font-semibold">Template Content:</Label>
                <div className="mt-2 p-4 bg-gray-50 rounded-lg border max-h-96 overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap font-mono">{previewTemplate.content}</pre>
                </div>
              </div>

              {previewTemplate.required_elements && previewTemplate.required_elements.length > 0 && (
                <div>
                  <Label className="text-sm font-semibold">Required Elements:</Label>
                  <ul className="mt-2 space-y-1">
                    {previewTemplate.required_elements.map((elem, idx) => (
                      <li key={idx} className="text-sm flex items-start gap-2">
                        <span className="text-green-600">✓</span>
                        {elem}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={() => handleCopy(previewTemplate.content)}
                  variant="outline"
                  className="flex-1"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Content
                </Button>
                <Button
                  onClick={() => {
                    handleUseTemplate(previewTemplate);
                    setPreviewOpen(false);
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Add to My Templates
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}