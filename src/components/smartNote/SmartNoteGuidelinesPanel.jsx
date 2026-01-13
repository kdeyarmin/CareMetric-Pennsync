import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, BookOpen, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const CLINICAL_GUIDELINES = {
  skilled_nursing: {
    CHF: {
      checklist: [
        'Assess peripheral edema and jugular venous pressure',
        'Monitor daily weights (2+ lb gain = notify physician)',
        'Document fluid intake and output',
        'Assess breath sounds for crackles',
        'Review medication adherence (diuretics, ACE inhibitors)',
        'Educate on low-sodium diet (< 2g/day)',
      ],
      bestPractices: [
        'Use standardized heart failure assessment scale',
        'Ensure orthopnea and PND assessment',
        'Document baseline functional status',
        'Include exercise tolerance level',
      ],
      complianceItems: [
        'Medicare requires documented signs/symptoms of decompensation',
        'Must include specific vital signs',
        'Care plan adjustments must be documented',
      ]
    },
    COPD: {
      checklist: [
        'Assess respiratory rate and breath sounds',
        'Note oxygen saturation and supplemental oxygen needs',
        'Document cough and sputum characteristics',
        'Assess for pursed-lip breathing technique',
        'Review inhaler technique and medication compliance',
        'Assess for signs of exacerbation',
      ],
      bestPractices: [
        'Document baseline COPD severity',
        'Include dyspnea rating (0-10 scale)',
        'Note activity tolerance changes',
        'Document smoking status/cessation efforts',
      ],
      complianceItems: [
        'Skilled nursing must justify need for continued services',
        'Document measurable progress toward goals',
        'Include frequency of visits in plan of care',
      ]
    },
    Diabetes: {
      checklist: [
        'Check feet for skin integrity and ulceration',
        'Assess glucose monitoring compliance',
        'Review medication adherence and timing',
        'Document recent glucose readings if available',
        'Assess dietary compliance with ADA diet',
        'Screen for signs of infection or complications',
      ],
      bestPractices: [
        'Document HbA1c if recently obtained',
        'Include patient education provided',
        'Note vision and sensory exam findings',
        'Assess for neuropathy symptoms',
      ],
      complianceItems: [
        'Require documented evidence of skilled intervention',
        'Must show progression toward independence',
        'Document diabetes self-management education (DSME)',
      ]
    },
  },
  routine_visit: {
    DEFAULT: {
      checklist: [
        'Document vital signs (at minimum: BP, HR, RR, Temp)',
        'Include patient/caregiver request/complaint',
        'Document assessment findings',
        'Note any changes from previous visit',
        'Include interventions performed',
        'Document patient response to care',
      ],
      bestPractices: [
        'Use objective descriptions (avoid vague terms)',
        'Include specific numbers for measurements',
        'Document time-sensitive information',
        'Note any patient education provided',
      ],
      complianceItems: [
        'All visits must have documentation of skilled nursing service',
        'Document medical necessity clearly',
        'Include any reportable events or changes',
      ]
    }
  },
  admission: {
    DEFAULT: {
      checklist: [
        'Complete comprehensive health history',
        'Document all past medical conditions',
        'List current medications with dosages',
        'Include allergy and adverse reaction information',
        'Perform complete physical assessment',
        'Document baseline functional status',
        'Include social/environmental assessment',
        'Identify applicable diagnoses from referral',
      ],
      bestPractices: [
        'Use organized assessment format',
        'Include safety risk assessments',
        'Document cognitive/mental status',
        'Include psychosocial factors affecting care',
        'Note communication abilities and preferences',
      ],
      complianceItems: [
        'Admission assessment required within 48 hours for Medicare',
        'Must document medical necessity for home health services',
        'Require specific demographic and insurance information',
        'Document start of care date and time',
      ]
    }
  },
  recertification: {
    DEFAULT: {
      checklist: [
        'Document progress toward established goals',
        'Reassess current functional status',
        'Review medication effectiveness',
        'Include current vital signs and observations',
        'Document any barriers to progress',
        'Assess appropriateness of continued skilled services',
        'Update care goals if needed',
      ],
      bestPractices: [
        'Compare current status to previous certification',
        'Include objective measurements of progress',
        'Document patient motivation and compliance',
        'Note any environmental changes',
      ],
      complianceItems: [
        'Medicare recertification required every 60 days',
        'Must justify continued need for skilled nursing',
        'Document measurable functional improvement or plateau',
        'Include updated physician orders if changed',
      ]
    }
  },
  discharge: {
    DEFAULT: {
      checklist: [
        'Document reason for discharge',
        'Summarize patient status at discharge',
        'Document final vital signs',
        'Include discharge medications',
        'Document equipment sent home',
        'Note follow-up appointments/instructions',
        'Include patient/caregiver education provided',
      ],
      bestPractices: [
        'Summarize progress during episode',
        'Document achievement of care goals',
        'Include any unmet goals and reasons',
        'Note referrals to other services',
        'Document patient/caregiver understanding',
      ],
      complianceItems: [
        'Medicare requires discharge summaries',
        'Must include final assessment',
        'Document disposition and follow-up plan',
        'Include discontinuation of services reason',
      ]
    }
  }
};

export default function SmartNoteGuidelinesPanel({ visitType = '', diagnosis = '', noteContent = '' }) {
  const [expandedSections, setExpandedSections] = useState({
    checklist: true,
    practices: false,
    compliance: false,
  });

  const getGuidelinesForVisit = () => {
    const visitGuidelines = CLINICAL_GUIDELINES[visitType];
    if (!visitGuidelines) return null;

    // Try to get diagnosis-specific guidelines
    if (diagnosis && visitGuidelines[diagnosis]) {
      return visitGuidelines[diagnosis];
    }

    // Fall back to DEFAULT
    if (visitGuidelines.DEFAULT) {
      return visitGuidelines.DEFAULT;
    }

    // For other visit types, find DEFAULT
    return Object.values(visitGuidelines)[0];
  };

  const guidelines = getGuidelinesForVisit();

  if (!guidelines) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-6">
          <p className="text-sm text-amber-800">
            Guidelines not available for {visitType}
          </p>
        </CardContent>
      </Card>
    );
  }

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const Section = ({ title, items, icon: Icon, section, color }) => (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => toggleSection(section)}
        className="w-full flex items-start justify-between p-3 hover:bg-gray-50"
      >
        <div className="flex items-start gap-2 flex-1 text-left">
          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
          <div>
            <p className="font-semibold text-sm text-gray-900">{title}</p>
            <p className="text-xs text-gray-600">{items.length} items</p>
          </div>
        </div>
        {expandedSections[section] ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {expandedSections[section] && (
        <div className="px-3 pb-3 space-y-2 bg-gray-50/50">
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-2 items-start text-xs">
              <span className="text-gray-400 flex-shrink-0">•</span>
              <span className="text-gray-700 flex-1">{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="w-5 h-5 text-blue-600" />
          Clinical Guidelines
        </CardTitle>
        <p className="text-xs text-gray-600 mt-2">
          {visitType.replace(/_/g, ' ')} {diagnosis ? `- ${diagnosis}` : ''}
        </p>
      </CardHeader>

      <CardContent className="space-y-2">
        <Section
          title="Assessment Checklist"
          items={guidelines.checklist}
          icon={CheckCircle2}
          section="checklist"
          color="text-blue-600"
        />

        <Section
          title="Best Practices"
          items={guidelines.bestPractices}
          icon={BookOpen}
          section="practices"
          color="text-green-600"
        />

        <Section
          title="Compliance Requirements"
          items={guidelines.complianceItems}
          icon={AlertCircle}
          section="compliance"
          color="text-red-600"
        />

        {noteContent && (
          <div className="pt-2 border-t mt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Quick Actions:</p>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs gap-1"
              onClick={() => copyToClipboard(noteContent)}
            >
              <Copy className="w-3 h-3" />
              Copy Note
            </Button>
          </div>
        )}

        <div className="pt-2 border-t mt-3 text-xs text-gray-600 space-y-1">
          <p className="font-semibold mb-1">💡 Tips:</p>
          <p>• Review all checklist items before finalizing your note</p>
          <p>• Ensure compliance requirements are documented</p>
        </div>
      </CardContent>
    </Card>
  );
}