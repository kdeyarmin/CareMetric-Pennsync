import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Brain, FileText, Target, CheckCircle2, Play, 
  Clock, Sparkles, AlertCircle, Mic, Users, 
  BookOpen, Shield, Zap, ChevronRight, Video,
  TrendingUp, Award, Bell
} from "lucide-react";

export const publicPage = true;

export default function HowToGuide() {
  const [activeGuide, setActiveGuide] = useState(null);

  const guides = [
    {
      id: "smart-notes",
      title: "Document a Visit with AI Smart Notes",
      icon: Brain,
      color: "blue",
      difficulty: "Beginner",
      time: "5 minutes",
      steps: [
        {
          title: "Select Patient & Visit Type",
          description: "Choose your patient from the dropdown or select 'Anonymous' for practice mode. Select the visit type (skilled nursing, admission, etc.).",
          tips: [
            "Use Anonymous mode when practicing or for confidential scenarios",
            "Visit type affects AI recommendations and compliance checks",
            "Patient history auto-loads for better AI context"
          ],
          screenshot: null
        },
        {
          title: "Enter Vital Signs",
          description: "Quickly input vital signs using the form or voice dictation. AI validates ranges and flags abnormals.",
          tips: [
            "Use voice: 'blood pressure 120 over 80'",
            "Yellow/red highlights indicate concerning values",
            "Previous vitals shown for comparison"
          ],
          screenshot: null
        },
        {
          title: "Document Your Rough Notes",
          description: "Type or dictate your observations, assessments, and interventions. Don't worry about perfect formatting - AI handles that.",
          tips: [
            "Be specific: 'lungs clear bilaterally' not 'lungs ok'",
            "Include skilled interventions performed",
            "Note patient/caregiver responses to teaching",
            "Mention homebound status indicators"
          ],
          screenshot: null
        },
        {
          title: "Click 'Enhance with AI'",
          description: "AI transforms your rough notes into Medicare-compliant clinical documentation with proper structure, terminology, and required elements.",
          tips: [
            "Takes 5-15 seconds depending on note length",
            "AI adds missing compliance elements automatically",
            "Original rough note is preserved for reference"
          ],
          screenshot: null
        },
        {
          title: "Review & Edit Enhanced Note",
          description: "Review the AI-enhanced note. Make any adjustments needed. AI provides compliance score and suggestions.",
          tips: [
            "Aim for 90%+ compliance score",
            "Apply one-click fixes for flagged issues",
            "Edit directly in enhanced note field",
            "Re-enhance if you make major changes"
          ],
          screenshot: null
        },
        {
          title: "Copy or Save",
          description: "Copy the note to paste into your EHR, or save directly to patient chart in CareMetric.",
          tips: [
            "Anonymous mode: can only copy, not save",
            "Saved notes link to patient history",
            "Generate care plans after saving",
            "Family updates can be auto-generated"
          ],
          screenshot: null
        }
      ],
      page: "SmartNoteAssistant"
    },
    {
      id: "voice-dictation",
      title: "Use Voice Dictation for Hands-Free Documentation",
      icon: Mic,
      color: "purple",
      difficulty: "Beginner",
      time: "3 minutes",
      steps: [
        {
          title: "Click the Voice Button",
          description: "Look for the microphone icon and click to start voice dictation. Browser will ask for microphone permission first time.",
          tips: [
            "Grant microphone permission when prompted",
            "Use in quiet environment for best results",
            "Works on mobile and desktop"
          ],
          screenshot: null
        },
        {
          title: "Speak Your Notes Naturally",
          description: "Speak as you normally would document. AI transcribes with medical terminology recognition.",
          tips: [
            "Speak clearly at normal pace",
            "Pause briefly between sentences",
            "Medical terms are recognized automatically",
            "Say 'period' for punctuation"
          ],
          screenshot: null
        },
        {
          title: "Use Voice Commands",
          description: "Speed up workflow with commands like 'enhance note', 'save note', 'copy note', 'clear note'.",
          tips: [
            "Commands work while dictating is active",
            "Say commands clearly and wait for confirmation",
            "'enhance note' triggers AI immediately"
          ],
          screenshot: null
        },
        {
          title: "Dictate Vital Signs",
          description: "Say 'blood pressure 120 over 80' and AI fills the BP field automatically.",
          tips: [
            "Works for all vital signs",
            "Say numbers naturally: 'ninety-eight point six'",
            "Corrections: just say correct value again"
          ],
          screenshot: null
        }
      ],
      page: "SmartNoteAssistant"
    },
    {
      id: "care-plans",
      title: "Generate AI Care Plans from Visit Notes",
      icon: Target,
      color: "green",
      difficulty: "Intermediate",
      time: "5 minutes",
      steps: [
        {
          title: "Enhance Your Visit Note",
          description: "Complete and enhance your visit documentation first. The more detailed your note, the better the care plan suggestions.",
          tips: [
            "Include complete assessment findings",
            "Document current problems and challenges",
            "Note patient goals and preferences"
          ],
          screenshot: null
        },
        {
          title: "Click 'Suggest Care Plans'",
          description: "After enhancing, a prominent button appears to generate care plans from your note.",
          tips: [
            "Button only shows for saved patients (not Anonymous)",
            "AI analyzes complete note for clinical needs",
            "Takes 10-20 seconds to generate"
          ],
          screenshot: null
        },
        {
          title: "Review AI-Generated Plans",
          description: "AI presents 3-5 evidence-based care plans with problems, SMART goals, and skilled interventions.",
          tips: [
            "Plans based on actual documented findings",
            "Avoids duplicating existing care plans",
            "Includes baseline measurements and target dates"
          ],
          screenshot: null
        },
        {
          title: "Customize & Select Plans",
          description: "Edit any plan details to match patient-specific needs. Check boxes for plans you want to create.",
          tips: [
            "Adjust goals to be patient-specific",
            "Modify interventions for individual needs",
            "Set realistic target dates",
            "Select all applicable plans"
          ],
          screenshot: null
        },
        {
          title: "Create Care Plans",
          description: "Click 'Create Selected Plans' to add them to the patient's chart.",
          tips: [
            "Plans immediately visible on patient details",
            "Track progress in Care Plan Management",
            "Can generate more plans anytime"
          ],
          screenshot: null
        }
      ],
      page: "SmartNoteAssistant"
    },
    {
      id: "compliance-checking",
      title: "Ensure Medicare Compliance",
      icon: Shield,
      color: "red",
      difficulty: "Intermediate",
      time: "4 minutes",
      steps: [
        {
          title: "Watch Real-Time Warnings",
          description: "As you type, AI monitors for missing required elements and shows yellow/red warnings.",
          tips: [
            "Address red (critical) warnings immediately",
            "Yellow warnings are important but less urgent",
            "Learn which elements you commonly miss"
          ],
          screenshot: null
        },
        {
          title: "Review Compliance Score",
          description: "After enhancement, check your compliance score (aim for 90%+). See breakdown by element.",
          tips: [
            "Score reflects 42 CFR 484 requirements",
            "Drill into specific categories",
            "Track your improvement over time"
          ],
          screenshot: null
        },
        {
          title: "Apply One-Click Fixes",
          description: "Click 'Add' on individual suggestions or 'Fix All' to apply all compliance fixes at once.",
          tips: [
            "Review each suggestion before applying",
            "Customize added text if needed",
            "Don't over-rely - maintain accuracy"
          ],
          screenshot: null
        },
        {
          title: "Use Compliance Assistant",
          description: "Expand the Compliance Insights panel for detailed element-by-element analysis.",
          tips: [
            "See what's missing vs. present",
            "Get specific suggestions for improvement",
            "Use as learning tool"
          ],
          screenshot: null
        }
      ],
      page: "SmartNoteAssistant"
    },
    {
      id: "patient-alerts",
      title: "Monitor Patient Alerts & Risks",
      icon: Bell,
      color: "orange",
      difficulty: "Intermediate",
      time: "5 minutes",
      steps: [
        {
          title: "Check Dashboard Alerts",
          description: "View active patient alerts on your dashboard, prioritized by urgency and risk level.",
          tips: [
            "Red alerts are critical - review immediately",
            "AI generates alerts from visit data automatically",
            "Click alert to see full details"
          ],
          screenshot: null
        },
        {
          title: "Review Alert Details",
          description: "Click an alert to see risk factors, contributing data, and AI recommendations.",
          tips: [
            "Review data sources used for prediction",
            "Understand why alert was triggered",
            "Check recommended actions"
          ],
          screenshot: null
        },
        {
          title: "Take Action",
          description: "Acknowledge alert, create tasks, update care plans, or escalate as needed.",
          tips: [
            "Don't dismiss critical alerts without action",
            "Document alert findings in next visit note",
            "Create follow-up tasks for monitoring"
          ],
          screenshot: null
        },
        {
          title: "Track Resolution",
          description: "Monitor alert status and resolution progress. AI updates predictions as new data arrives.",
          tips: [
            "Resolution should show in documentation",
            "Interventions prevent alert recurrence",
            "Use alerts to inform care planning"
          ],
          screenshot: null
        }
      ],
      page: "PatientAlerts"
    },
    {
      id: "training-hub",
      title: "Access Personalized Training",
      icon: BookOpen,
      color: "indigo",
      difficulty: "Beginner",
      time: "10-20 minutes",
      steps: [
        {
          title: "View Your Training Dashboard",
          description: "AI analyzes your documentation patterns and identifies skill gaps automatically.",
          tips: [
            "Critical recommendations show first",
            "Progress tracked over time",
            "Based on your actual documentation"
          ],
          screenshot: null
        },
        {
          title: "Complete Recommended Modules",
          description: "Click on a training recommendation to start. Interactive lessons with real-world scenarios.",
          tips: [
            "Start with critical priority items",
            "Apply learning to next visit immediately",
            "Track your quiz scores"
          ],
          screenshot: null
        },
        {
          title: "Take Interactive Quizzes",
          description: "Test your knowledge with scenario-based questions. Get immediate feedback and explanations.",
          tips: [
            "Read each scenario carefully",
            "Explanations teach concepts",
            "Retake to improve scores"
          ],
          screenshot: null
        },
        {
          title: "Practice with Simulations",
          description: "Hands-on practice with realistic patient scenarios. Document visits in safe environment.",
          tips: [
            "Use Anonymous mode for practice",
            "Get feedback on documentation",
            "Build confidence before real visits"
          ],
          screenshot: null
        }
      ],
      page: "StaffTrainingHub"
    }
  ];

  const quickTips = [
    {
      title: "Maximize AI Accuracy",
      icon: Sparkles,
      tips: [
        "Save complete patient information for better context",
        "Be specific in observations - avoid vague terms",
        "Document skilled interventions clearly",
        "Include patient responses to teaching",
        "Use medical terminology you'd normally use"
      ]
    },
    {
      title: "Save Time Daily",
      icon: Clock,
      tips: [
        "Use voice dictation for hands-free notes",
        "Create custom phrases for common findings",
        "Enable offline mode before leaving office",
        "Use one-click compliance fixes",
        "Favorite frequently used pages/patients"
      ]
    },
    {
      title: "Improve Compliance",
      icon: Shield,
      tips: [
        "Review real-time warnings as you type",
        "Aim for 90%+ compliance scores",
        "Apply suggested fixes before submitting",
        "Learn from flagged elements",
        "Track your improvement trends"
      ]
    }
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">How-To Guide</h1>
        <p className="text-xl text-gray-600">Step-by-step instructions for key features</p>
      </div>

      {/* Quick Tips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {quickTips.map((section, idx) => (
          <Card key={idx} className="border-2 border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <section.icon className="w-5 h-5 text-indigo-600" />
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {section.tips.map((tip, tipIdx) => (
                  <li key={tipIdx} className="text-sm text-gray-700 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Guide Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {guides.map((guide) => (
          <Card 
            key={guide.id} 
            className={`border-2 cursor-pointer hover:shadow-lg transition-all ${
              activeGuide?.id === guide.id ? `border-${guide.color}-500` : 'border-gray-200'
            }`}
            onClick={() => setActiveGuide(guide)}
          >
            <CardHeader>
              <div className={`w-12 h-12 bg-${guide.color}-100 rounded-lg flex items-center justify-center mb-3`}>
                <guide.icon className={`w-6 h-6 text-${guide.color}-600`} />
              </div>
              <CardTitle className="text-lg mb-2">{guide.title}</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {guide.difficulty}
                </Badge>
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {guide.time}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Button 
                className={`w-full bg-${guide.color}-600 hover:bg-${guide.color}-700`}
                onClick={() => setActiveGuide(guide)}
              >
                <Play className="w-4 h-4 mr-2" />
                Start Guide
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active Guide Detail */}
      {activeGuide && (
        <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-blue-50">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className={`w-16 h-16 bg-${activeGuide.color}-100 rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <activeGuide.icon className={`w-8 h-8 text-${activeGuide.color}-600`} />
                </div>
                <div>
                  <CardTitle className="text-2xl mb-2">{activeGuide.title}</CardTitle>
                  <div className="flex gap-2 flex-wrap">
                    <Badge className={`bg-${activeGuide.color}-600 text-white`}>
                      {activeGuide.difficulty}
                    </Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {activeGuide.time}
                    </Badge>
                    <Badge variant="outline">
                      {activeGuide.steps.length} Steps
                    </Badge>
                  </div>
                </div>
              </div>
              <Link to={createPageUrl(activeGuide.page)}>
                <Button>
                  Try It Now
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {activeGuide.steps.map((step, idx) => (
              <div key={idx} className="bg-white rounded-lg p-6 border-2 border-gray-200">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 bg-${activeGuide.color}-600 text-white rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{step.title}</h3>
                    <p className="text-gray-700 mb-4">{step.description}</p>
                    
                    {step.tips.length > 0 && (
                      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                        <div className="flex items-start gap-2 mb-2">
                          <Zap className="w-5 h-5 text-blue-600 flex-shrink-0" />
                          <h4 className="font-semibold text-blue-900">Pro Tips:</h4>
                        </div>
                        <ul className="space-y-1">
                          {step.tips.map((tip, tipIdx) => (
                            <li key={tipIdx} className="text-sm text-blue-900 flex items-start gap-2">
                              <span className="text-blue-600 font-bold">•</span>
                              <span>{tip}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <AlertDescription className="text-green-900">
                <strong>Success!</strong> You've completed the guide. Practice makes perfect - try it on your next visit!
              </AlertDescription>
            </Alert>

            <div className="flex justify-center">
              <Link to={createPageUrl(activeGuide.page)}>
                <Button size="lg" className={`bg-${activeGuide.color}-600 hover:bg-${activeGuide.color}-700`}>
                  <Play className="w-5 h-5 mr-2" />
                  Try {activeGuide.title} Now
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}