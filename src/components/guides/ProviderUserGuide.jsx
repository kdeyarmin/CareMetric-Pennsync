import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Download, BookOpen, Video, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function ProviderUserGuide() {
  const [expandedSections, setExpandedSections] = useState({});
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const generatePDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const response = await base44.functions.invoke('generateUserGuidePDF', {});
      
      // Create blob and download
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'CareMetric-AI-User-Guide.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      toast.success('User guide PDF downloaded');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const providerGuides = {
    RN: {
      name: "Registered Nurse (RN)",
      color: "blue",
      features: [
        {
          category: "Smart Documentation",
          items: [
            {
              title: "Smart Notes Assistant",
              description: "AI-powered clinical documentation with real-time Medicare compliance scoring",
              howTo: [
                "Navigate to Smart Notes from the main menu",
                "Select your patient from the search",
                "Choose visit type and enter vital signs",
                "Dictate or type your clinical note",
                "Review AI suggestions for compliance",
                "Use one-click fixes for missing requirements",
                "Export as PDF or send to physician"
              ]
            },
            {
              title: "Medical Scribe",
              description: "Voice-to-text transcription with automatic clinical formatting",
              howTo: [
                "Open Medical Scribe feature",
                "Click microphone icon to start recording",
                "Speak naturally about your visit",
                "AI automatically formats into SOAP format",
                "Review and edit generated note",
                "Save to patient chart"
              ]
            },
            {
              title: "Real-Time Compliance Scoring",
              description: "Live 0-100 compliance score as you document",
              howTo: [
                "Open any documentation screen",
                "Watch the compliance score update in real-time",
                "Click on red/yellow items to see what's missing",
                "Use 'Quick Fix' buttons to add required elements",
                "Aim for 90+ score before finalizing"
              ]
            }
          ]
        },
        {
          category: "Clinical Decision Support",
          items: [
            {
              title: "Differential Diagnosis Suggester",
              description: "AI analyzes symptoms and suggests possible diagnoses",
              howTo: [
                "Enter patient symptoms and assessment",
                "Click 'Analyze' to get differential diagnoses",
                "Review suggested diagnoses with evidence",
                "Select applicable diagnoses for documentation",
                "Review contraindications and red flags"
              ]
            },
            {
              title: "Medication Cross-Checker",
              description: "Automatic drug interaction and allergy checking",
              howTo: [
                "Enter patient medications",
                "System automatically checks for interactions",
                "Review warnings and contraindications",
                "Check dosage appropriateness for age/condition",
                "Document medication reconciliation"
              ]
            },
            {
              title: "Adverse Event Predictor",
              description: "Predicts risk of adverse events based on patient data",
              howTo: [
                "System analyzes patient vitals, meds, and conditions",
                "Review risk scores for falls, hospitalizations, etc.",
                "Implement suggested interventions",
                "Document preventive measures taken"
              ]
            }
          ]
        },
        {
          category: "Care Planning",
          items: [
            {
              title: "AI Care Plan Generator",
              description: "Automatically creates evidence-based care plans",
              howTo: [
                "Navigate to Care Plans tab",
                "Select patient and diagnosis",
                "Click 'Generate AI Care Plan'",
                "Review suggested problems, goals, interventions",
                "Customize as needed",
                "Save and assign to patient"
              ]
            },
            {
              title: "Automated Task Generation",
              description: "Creates follow-up tasks based on clinical findings",
              howTo: [
                "Complete patient assessment",
                "System suggests relevant tasks automatically",
                "Review and approve suggested tasks",
                "Assign to yourself or team members",
                "Set priority and due dates"
              ]
            }
          ]
        },
        {
          category: "OASIS & Medicare Compliance",
          items: [
            {
              title: "OASIS Documentation Assistant",
              description: "Guides through OASIS assessment with validation",
              howTo: [
                "Start OASIS assessment from patient chart",
                "Follow guided workflow for each section",
                "AI suggests answers based on clinical notes",
                "Real-time validation of responses",
                "Review accuracy score before submission",
                "Export for HAVEN submission"
              ]
            },
            {
              title: "Medicare Coverage Determination",
              description: "Analyzes if visit meets Medicare coverage criteria",
              howTo: [
                "Complete visit documentation",
                "Click 'Analyze Coverage'",
                "Review coverage determination (Covered/Questionable/Not Covered)",
                "View denial risk assessment",
                "Use auto-generated skilled need justification",
                "Insert justification language into notes"
              ]
            },
            {
              title: "Homebound Status Documentation",
              description: "Ensures proper homebound justification",
              howTo: [
                "Document patient mobility limitations",
                "Click 'Generate Homebound Justification'",
                "Review AI-generated language",
                "Customize specific details",
                "Insert into visit note"
              ]
            }
          ]
        },
        {
          category: "Telehealth",
          items: [
            {
              title: "Telehealth Visits",
              description: "HIPAA-compliant video visits with AI support",
              howTo: [
                "Schedule appointment from Telehealth Dashboard",
                "Send invitation link to patient",
                "Start video call at appointment time",
                "Use AI transcription during call",
                "Share educational materials via screen share",
                "Auto-generate visit summary after call"
              ]
            },
            {
              title: "AI Symptom Checker",
              description: "Guided symptom assessment during telehealth calls",
              howTo: [
                "During telehealth visit, open Symptom Checker",
                "Follow AI-guided questions",
                "System documents responses automatically",
                "Receive clinical decision support",
                "Generate triage recommendation"
              ]
            }
          ]
        }
      ]
    },
    LPN: {
      name: "Licensed Practical Nurse (LPN)",
      color: "green",
      features: [
        {
          category: "Documentation",
          items: [
            {
              title: "Visit Documentation",
              description: "Streamlined documentation for routine visits",
              howTo: [
                "Select patient from My Patients",
                "Choose visit type",
                "Enter vital signs",
                "Document observations and interventions",
                "Review compliance checklist",
                "Submit for RN review if needed"
              ]
            },
            {
              title: "Medication Administration",
              description: "Document medication administration and education",
              howTo: [
                "Access patient medication list",
                "Confirm medications with patient",
                "Document administration time and route",
                "Record patient response",
                "Note any side effects or concerns"
              ]
            }
          ]
        },
        {
          category: "Patient Education",
          items: [
            {
              title: "Education Material Generator",
              description: "Creates patient-friendly education materials",
              howTo: [
                "Select diagnosis or topic",
                "Click 'Generate Education Material'",
                "Review and customize content",
                "Print or email to patient",
                "Document education provided"
              ]
            }
          ]
        }
      ]
    },
    PT: {
      name: "Physical Therapist (PT)",
      color: "orange",
      features: [
        {
          category: "Assessment & Documentation",
          items: [
            {
              title: "Functional Assessment",
              description: "Comprehensive mobility and ADL assessment",
              howTo: [
                "Navigate to PT Assessment",
                "Complete functional status evaluation",
                "Document baseline measurements",
                "Set functional goals with patient",
                "Generate treatment plan"
              ]
            },
            {
              title: "Progress Notes",
              description: "Track patient progress toward goals",
              howTo: [
                "Select patient and treatment session",
                "Document exercises performed",
                "Record patient response and tolerance",
                "Measure progress toward goals",
                "Adjust treatment plan as needed"
              ]
            }
          ]
        },
        {
          category: "Treatment Planning",
          items: [
            {
              title: "Exercise Program Generator",
              description: "Creates personalized exercise programs",
              howTo: [
                "Enter patient condition and goals",
                "Select exercise categories",
                "Review AI-suggested exercises",
                "Customize frequency and intensity",
                "Print home exercise program for patient"
              ]
            }
          ]
        }
      ]
    },
    OT: {
      name: "Occupational Therapist (OT)",
      color: "purple",
      features: [
        {
          category: "ADL Assessment",
          items: [
            {
              title: "Activities of Daily Living Evaluation",
              description: "Comprehensive ADL assessment and documentation",
              howTo: [
                "Open OT Assessment module",
                "Evaluate patient independence in ADLs",
                "Document adaptive equipment needs",
                "Assess home safety",
                "Create intervention plan"
              ]
            }
          ]
        }
      ]
    },
    ST: {
      name: "Speech Therapist (ST)",
      color: "pink",
      features: [
        {
          category: "Speech & Swallowing",
          items: [
            {
              title: "Swallow Assessment",
              description: "Document dysphagia evaluation and recommendations",
              howTo: [
                "Complete swallow screening",
                "Document signs and symptoms",
                "Recommend diet texture modifications",
                "Create swallow therapy plan",
                "Educate patient and caregivers"
              ]
            }
          ]
        }
      ]
    },
    MSW: {
      name: "Medical Social Worker (MSW)",
      color: "teal",
      features: [
        {
          category: "Psychosocial Assessment",
          items: [
            {
              title: "Social Assessment",
              description: "Comprehensive psychosocial evaluation",
              howTo: [
                "Navigate to Social Work Assessment",
                "Evaluate living situation and support system",
                "Screen for depression and anxiety",
                "Identify resource needs",
                "Document barriers to care",
                "Connect to community resources"
              ]
            },
            {
              title: "Resource Coordination",
              description: "Connect patients to community resources",
              howTo: [
                "Identify patient needs",
                "Search resource database",
                "Provide referrals to community services",
                "Follow up on referral outcomes",
                "Document coordination efforts"
              ]
            }
          ]
        }
      ]
    },
    MD: {
      name: "Physician (MD/DO)",
      color: "indigo",
      features: [
        {
          category: "Orders & Supervision",
          items: [
            {
              title: "Order Management",
              description: "Create and sign orders for home health services",
              howTo: [
                "Review patient assessment",
                "Create service orders (skilled nursing, therapy, etc.)",
                "Specify frequency and duration",
                "Sign orders electronically",
                "Review and approve care plans"
              ]
            },
            {
              title: "Clinical Review",
              description: "Review team documentation and provide guidance",
              howTo: [
                "Access patient chart",
                "Review visit notes from clinical team",
                "Provide feedback and guidance",
                "Adjust orders as needed",
                "Sign and approve documentation"
              ]
            }
          ]
        }
      ]
    }
  };

  const FeatureCard = ({ item, isExpanded, onToggle }) => (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 text-left hover:bg-gray-50 flex items-start justify-between"
      >
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900 mb-1">{item.title}</h4>
          <p className="text-sm text-gray-600">{item.description}</p>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" />
        )}
      </button>
      {isExpanded && (
        <div className="p-4 bg-gray-50 border-t">
          <h5 className="text-sm font-semibold text-gray-900 mb-2">How to Use:</h5>
          <ol className="space-y-2">
            {item.howTo.map((step, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-gray-700">
                <span className="font-semibold text-blue-600">{idx + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Provider User Guide</h1>
          <p className="text-gray-600 mt-1">Comprehensive guide to CareMetric AI features by provider type</p>
        </div>
        <Button
          onClick={generatePDF}
          disabled={isGeneratingPDF}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Download className="w-4 h-4 mr-2" />
          {isGeneratingPDF ? 'Generating...' : 'Download PDF Guide'}
        </Button>
      </div>

      <Tabs defaultValue="RN" className="w-full">
        <TabsList className="grid w-full grid-cols-7 mb-6">
          {Object.entries(providerGuides).map(([key, guide]) => (
            <TabsTrigger key={key} value={key}>
              {key}
            </TabsTrigger>
          ))}
        </TabsList>

        {Object.entries(providerGuides).map(([key, guide]) => (
          <TabsContent key={key} value={key} className="space-y-6">
            <Card className={`border-${guide.color}-200 bg-${guide.color}-50`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  {guide.name} Features
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  Below are all features available to {guide.name} providers with step-by-step instructions.
                </p>
              </CardContent>
            </Card>

            {guide.features.map((category, catIdx) => (
              <Card key={catIdx}>
                <CardHeader>
                  <CardTitle className="text-lg">{category.category}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {category.items.map((item, itemIdx) => {
                    const sectionKey = `${key}-${catIdx}-${itemIdx}`;
                    return (
                      <FeatureCard
                        key={itemIdx}
                        item={item}
                        isExpanded={expandedSections[sectionKey]}
                        onToggle={() => toggleSection(sectionKey)}
                      />
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}