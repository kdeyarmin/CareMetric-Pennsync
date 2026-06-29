import { useState, useCallback } from "react";
import { invokeLLM } from "@/lib/invokeLLM";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  FileText,
  Heart,
  Wind,
  Activity,
  Stethoscope,
  ClipboardList,
  UserPlus,
  RefreshCw,
  LogOut,
  Brain,
  Bone,
  Droplets,
  Eye,
  Scissors,
  Home
} from "lucide-react";
import { toast } from 'sonner';

// Template definitions
const VISIT_TYPE_TEMPLATES = [
  {
    id: 'admission',
    name: 'Admission / Start of Care',
    icon: UserPlus,
    description: 'Comprehensive initial assessment for new patients',
    color: 'bg-blue-500',
    sections: ['demographics', 'medical_history', 'medications', 'allergies', 'functional_status', 'homebound_status', 'safety_assessment', 'care_plan_goals']
  },
  {
    id: 'routine',
    name: 'Routine Visit',
    icon: Stethoscope,
    description: 'Standard skilled nursing visit documentation',
    color: 'bg-green-500',
    sections: ['vital_signs', 'assessment', 'interventions', 'patient_response', 'care_plan_progress', 'next_visit']
  },
  {
    id: 'recertification',
    name: 'Recertification',
    icon: RefreshCw,
    description: 'Comprehensive reassessment for continued care',
    color: 'bg-navy-500',
    sections: ['vital_signs', 'comprehensive_assessment', 'progress_summary', 'continued_need', 'updated_goals', 'physician_orders']
  },
  {
    id: 'discharge',
    name: 'Discharge',
    icon: LogOut,
    description: 'Final visit and care transition documentation',
    color: 'bg-orange-500',
    sections: ['vital_signs', 'goals_met', 'discharge_instructions', 'medication_reconciliation', 'follow_up', 'patient_education']
  },
  {
    id: 'prn',
    name: 'PRN / Urgent Visit',
    icon: Activity,
    description: 'Unscheduled visit for acute concerns',
    color: 'bg-red-500',
    sections: ['reason_for_visit', 'vital_signs', 'focused_assessment', 'interventions', 'physician_notification', 'follow_up_plan']
  },
  {
    id: 'supervisory',
    name: 'Supervisory Visit',
    icon: Eye,
    description: 'RN supervision of aide services',
    color: 'bg-navy-500',
    sections: ['aide_performance', 'care_plan_review', 'patient_satisfaction', 'competency_verification']
  }
];

const CONDITION_TEMPLATES = [
  {
    id: 'chf',
    name: 'CHF / Heart Failure',
    icon: Heart,
    description: 'Congestive heart failure management',
    color: 'bg-red-500',
    focusAreas: ['weight_monitoring', 'edema_assessment', 'cardiac_assessment', 'medication_compliance', 'diet_education', 'activity_tolerance']
  },
  {
    id: 'copd',
    name: 'COPD / Respiratory',
    icon: Wind,
    description: 'Chronic respiratory condition management',
    color: 'bg-blue-500',
    focusAreas: ['respiratory_assessment', 'oxygen_therapy', 'inhaler_technique', 'breathing_exercises', 'exacerbation_signs']
  },
  {
    id: 'diabetes',
    name: 'Diabetes Management',
    icon: Droplets,
    description: 'Diabetic patient care and monitoring',
    color: 'bg-amber-500',
    focusAreas: ['blood_glucose', 'insulin_management', 'foot_assessment', 'diet_compliance', 'hypoglycemia_education']
  },
  {
    id: 'wound_care',
    name: 'Wound Care',
    icon: Scissors,
    description: 'Wound assessment and treatment',
    color: 'bg-gold-500',
    focusAreas: ['wound_measurements', 'wound_bed', 'drainage', 'periwound', 'dressing_change', 'infection_signs']
  },
  {
    id: 'stroke',
    name: 'Stroke / CVA',
    icon: Brain,
    description: 'Post-stroke care and rehabilitation',
    color: 'bg-navy-500',
    focusAreas: ['neurological_assessment', 'mobility', 'speech', 'swallowing', 'fall_prevention', 'caregiver_training']
  },
  {
    id: 'orthopedic',
    name: 'Orthopedic / Joint Replacement',
    icon: Bone,
    description: 'Post-surgical orthopedic care',
    color: 'bg-slate-500',
    focusAreas: ['incision_assessment', 'pain_management', 'mobility', 'pt_exercises', 'dvt_prevention', 'weight_bearing']
  },
  {
    id: 'hospice',
    name: 'Hospice / Palliative',
    icon: Home,
    description: 'Comfort-focused end-of-life care',
    color: 'bg-indigo-500',
    focusAreas: ['symptom_management', 'pain_control', 'psychosocial', 'spiritual', 'caregiver_support', 'comfort_measures']
  },
  {
    id: 'hypertension',
    name: 'Hypertension',
    icon: Activity,
    description: 'Blood pressure management',
    color: 'bg-red-500',
    focusAreas: ['bp_monitoring', 'medication_compliance', 'diet_sodium', 'lifestyle_modifications', 'symptom_recognition']
  }
];

export default function ClinicalTemplateLibrary({ onSelectTemplate, onClose }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState('visit_types');
  const [isGenerating, setIsGenerating] = useState(false);
  const [_selectedTemplate, setSelectedTemplate] = useState(null);

  const filteredVisitTemplates = VISIT_TYPE_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredConditionTemplates = CONDITION_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectTemplate = useCallback(async (template, type) => {
    if (!onSelectTemplate) {
      console.warn('No onSelectTemplate handler provided');
      return;
    }
    
    setSelectedTemplate({ ...template, type });
    setIsGenerating(true);

    try {
      const generatedContent = await generateTemplateContent(template, type);
      onSelectTemplate({
        template,
        type,
        content: generatedContent
      });
    } catch (error) {
      console.error('Error generating template:', error);
      toast.error('Failed to generate template. Please try again.');
    }

    setIsGenerating(false);
  }, [onSelectTemplate]);

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
              <ClipboardList className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle>Clinical Template Library</CardTitle>
              <p className="text-sm text-slate-600">AI-powered documentation templates</p>
            </div>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Loading State */}
        {isGenerating && (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <div className="text-center">
              <p className="text-slate-900 font-semibold">Generating Template...</p>
              <p className="text-sm text-slate-600">AI is creating your documentation template</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        {!isGenerating && (
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="visit_types">Visit Types</TabsTrigger>
              <TabsTrigger value="conditions">Conditions</TabsTrigger>
            </TabsList>

            <TabsContent value="visit_types" className="space-y-3">
              {filteredVisitTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onClick={() => handleSelectTemplate(template, 'visit_type')}
                />
              ))}
            </TabsContent>

            <TabsContent value="conditions" className="space-y-3">
              {filteredConditionTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onClick={() => handleSelectTemplate(template, 'condition')}
                />
              ))}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateCard({ template, onClick }) {
  const Icon = template.icon;
  
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-all"
    >
      <div className={`w-12 h-12 ${template.color} rounded-lg flex items-center justify-center shadow-md`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900">{template.name}</h3>
        <p className="text-sm text-slate-600">{template.description}</p>
        <div className="flex flex-wrap gap-1 mt-2">
          {(template.sections || template.focusAreas)?.slice(0, 4).map((item, idx) => (
            <Badge key={idx} variant="outline" className="text-xs capitalize">
              {item.replace(/_/g, ' ')}
            </Badge>
          ))}
          {(template.sections || template.focusAreas)?.length > 4 && (
            <Badge variant="outline" className="text-xs">
              +{(template.sections || template.focusAreas).length - 4} more
            </Badge>
          )}
        </div>
      </div>
      <FileText className="w-5 h-5 text-slate-400" />
    </div>
  );
}

async function generateTemplateContent(template, type) {
  const prompt = type === 'visit_type' 
    ? generateVisitTypePrompt(template)
    : generateConditionPrompt(template);

  const result = await invokeLLM({
    model: "claude_sonnet_4_6",
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        template_content: { type: "string" },
        required_fields: {
          type: "array",
          items: { type: "string" }
        },
        clinical_prompts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section: { type: "string" },
              prompt: { type: "string" },
              options: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }
  });

  return result;
}

function generateVisitTypePrompt(template) {
  return `You are a clinical documentation specialist creating a Medicare-compliant template for a ${template.name} visit in home health/hospice care.

TEMPLATE TYPE: ${template.name}
DESCRIPTION: ${template.description}
REQUIRED SECTIONS: ${template.sections.join(', ')}

Create a comprehensive, structured clinical documentation template that:
1. Is fully Medicare-compliant
2. Includes all required sections with clear headers (use ** for headers)
3. Has placeholder prompts [in brackets] for clinician input
4. Includes specific clinical assessment criteria
5. Has documentation tips as comments in parentheses

Format the template with:
- Clear section headers
- Bulleted items for assessments
- Specific measurement fields where needed
- Evidence-based assessment criteria
- Space for clinical observations

Also provide:
- List of required fields that must be completed
- Clinical prompts with dropdown options where applicable (e.g., edema grades, pain scales)

Return as JSON with:
- template_content: The full template text
- required_fields: Array of field names that must be completed
- clinical_prompts: Array of {section, prompt, options} for structured data entry`;
}

function generateConditionPrompt(template) {
  return `You are a clinical documentation specialist creating a condition-specific documentation template for ${template.name} in home health/hospice care.

CONDITION: ${template.name}
DESCRIPTION: ${template.description}
FOCUS AREAS: ${template.focusAreas.join(', ')}

Create a comprehensive, condition-specific clinical documentation template that:
1. Is tailored specifically to ${template.name} patients
2. Includes all condition-specific assessments
3. Has Medicare-compliant documentation elements
4. Includes evidence-based care protocols
5. Has clinical decision support prompts

For each focus area, include:
- Specific assessment criteria
- Normal vs abnormal findings
- Red flags to watch for
- Patient education points
- Measurable goals

Format with:
- Clear section headers (use **)
- Condition-specific assessment tools
- Scoring systems where applicable
- Medication management specific to condition
- Patient/caregiver education checklist

Return as JSON with:
- template_content: The full template text
- required_fields: Array of field names that must be completed
- clinical_prompts: Array of {section, prompt, options} for structured data entry`;
}