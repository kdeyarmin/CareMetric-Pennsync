import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, Sparkles, Mic, Users, FileText, Target, 
  Bell, Shield, GraduationCap, Activity, Search,
  CheckCircle2, Zap, TrendingUp, Clock, BookOpen,
  AlertTriangle, MessageCircle, Lightbulb
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export const publicPage = true;

export default function Features() {
  const [searchTerm, setSearchTerm] = useState("");

  const features = [
    {
      category: "Smart Documentation",
      icon: Brain,
      color: "blue",
      items: [
        {
          name: "Smart Note Assistant",
          icon: Sparkles,
          description: "Transform rough notes into Medicare-compliant clinical narratives in seconds",
          howTo: [
            "1. Select your patient and visit type",
            "2. Enter vital signs quickly",
            "3. Type or dictate your rough notes",
            "4. Click 'Enhance with AI' for instant transformation",
            "5. Review, copy, and paste into your EHR"
          ],
          bestPractices: [
            "Include specific observations, not vague terms",
            "Mention skilled interventions performed",
            "Document patient response to teaching",
            "Note homebound status indicators",
            "Save detailed patient info for better AI recommendations"
          ],
          page: "SmartNoteAssistant"
        },
        {
          name: "Voice Dictation",
          icon: Mic,
          description: "Hands-free documentation with advanced voice commands and multi-language support",
          howTo: [
            "1. Click the 'Voice' button to start",
            "2. Speak naturally - AI transcribes automatically",
            "3. Use voice commands: 'enhance note', 'save note', 'copy note'",
            "4. Dictate vitals: 'blood pressure 120 over 80'",
            "5. Switch languages for multilingual patients"
          ],
          bestPractices: [
            "Speak clearly and at normal pace",
            "Use medical abbreviations you normally write",
            "Pause briefly between sentences",
            "Use commands for quick actions",
            "Review transcription before enhancing"
          ],
          page: "SmartNoteAssistant"
        },
        {
          name: "Custom Quick Phrases",
          icon: Zap,
          description: "Create reusable phrases for common assessments and save time on repetitive documentation",
          howTo: [
            "1. Go to Smart Notes sidebar → Knowledge tab",
            "2. Click 'Add Phrase' in Custom Phrases section",
            "3. Enter trigger word (e.g., 'lungs')",
            "4. Type full phrase to insert",
            "5. Click saved phrase anytime to insert"
          ],
          bestPractices: [
            "Create phrases for common findings",
            "Use short, memorable triggers",
            "Include full assessment language",
            "Update phrases based on feedback",
            "Share useful phrases with team"
          ],
          page: "SmartNoteAssistant"
        },
        {
          name: "One-Click Compliance Fixes",
          icon: CheckCircle2,
          description: "AI identifies missing Medicare elements and suggests ready-to-insert text",
          howTo: [
            "1. After enhancing your note, review compliance warnings",
            "2. Click 'Add' on individual suggestions",
            "3. Or click 'Fix All' to apply all at once",
            "4. Review added content for accuracy",
            "5. Proceed with confidence"
          ],
          bestPractices: [
            "Review each suggestion before applying",
            "Customize added text if needed",
            "Learn which elements you commonly miss",
            "Use as teaching tool for compliance",
            "Don't over-rely - ensure accuracy"
          ],
          page: "SmartNoteAssistant"
        },
        {
          name: "Real-Time Compliance Warnings",
          icon: AlertTriangle,
          description: "Get proactive alerts while typing if critical elements are missing",
          howTo: [
            "1. Start typing your rough note",
            "2. After 50 characters, AI monitors for gaps",
            "3. Yellow/red alerts appear for missing elements",
            "4. Click 'Add' to insert suggested text",
            "5. Dismiss if not applicable"
          ],
          bestPractices: [
            "Address critical warnings immediately",
            "Use as real-time learning tool",
            "Understand why each element is required",
            "Don't wait until enhancement to fix gaps",
            "Build compliance habits over time"
          ],
          page: "SmartNoteAssistant"
        },
        {
          name: "Anonymous Mode",
          icon: Shield,
          description: "Enhance notes without saving patient data - perfect for practice or confidential scenarios",
          howTo: [
            "1. Select 'Anonymous' as patient option",
            "2. Enter visit details and notes normally",
            "3. Click 'Enhance with AI' for transformation",
            "4. Copy enhanced note to use elsewhere",
            "5. No patient data is saved or stored"
          ],
          bestPractices: [
            "Use for practice and training",
            "Perfect for sensitive scenarios",
            "Great for testing new features",
            "Review capabilities before real use",
            "Safe environment for learning"
          ],
          page: "SmartNoteAssistant"
        }
      ]
    },
    {
      category: "Patient Management",
      icon: Users,
      color: "green",
      items: [
        {
          name: "Patient Dashboard",
          icon: Users,
          description: "Centralized view of all patient information, history, and AI-powered insights",
          howTo: [
            "1. Click on any patient from the list",
            "2. View comprehensive medical history",
            "3. Review AI-generated summaries and alerts",
            "4. Access care plans, visits, and documents",
            "5. Use quick actions for common tasks"
          ],
          bestPractices: [
            "Keep patient info up-to-date",
            "Review AI alerts before each visit",
            "Document allergies prominently",
            "Update medications after each visit",
            "Use favorite feature for frequent patients"
          ],
          page: "Patients"
        },
        {
          name: "AI Patient Analyzer",
          icon: Brain,
          description: "Comprehensive AI analysis of patient risks, trends, and care recommendations",
          howTo: [
            "1. Open patient details page",
            "2. Scroll to AI Patient Analyzer section",
            "3. Click 'Analyze' for instant insights",
            "4. Review risk scores and predictions",
            "5. Act on high-priority recommendations"
          ],
          bestPractices: [
            "Run analysis after significant changes",
            "Review before recertification visits",
            "Share insights with care team",
            "Use to justify continued care needs",
            "Track trend changes over time"
          ],
          page: "PatientDetails"
        },
        {
          name: "Patient Alerts & Risk Detection",
          icon: Bell,
          description: "AI-powered early warning system for deterioration, readmission risk, and safety concerns",
          howTo: [
            "1. AI automatically generates alerts from visit data",
            "2. View alerts on patient dashboard",
            "3. Click alert to see details and recommendations",
            "4. Acknowledge or create tasks from alerts",
            "5. Track resolution progress"
          ],
          bestPractices: [
            "Review alerts daily before visits",
            "Don't dismiss critical alerts without action",
            "Document alert findings in visit notes",
            "Escalate high-risk situations promptly",
            "Use alerts to inform care plan updates"
          ],
          page: "PatientAlerts"
        }
      ]
    },
    {
      category: "Care Planning",
      icon: Target,
      color: "purple",
      items: [
        {
          name: "AI Care Plan Generator",
          icon: Target,
          description: "Automatically generate evidence-based care plans from diagnoses and visit notes",
          howTo: [
            "1. Document patient visit normally",
            "2. AI suggests care plans based on diagnosis",
            "3. Review suggested problems, goals, and interventions",
            "4. Customize as needed",
            "5. Click 'Create' to add to patient chart"
          ],
          bestPractices: [
            "Review suggestions against clinical judgment",
            "Set realistic, measurable goals",
            "Include patient/family input",
            "Update care plans after each visit",
            "Document progress toward goals"
          ],
          page: "CarePlanManagement"
        },
        {
          name: "Care Plan Gap Analyzer",
          icon: AlertTriangle,
          description: "Identifies missing care plan elements based on diagnosis and guidelines",
          howTo: [
            "1. Open patient details page",
            "2. View Care Plan Gap Analyzer section",
            "3. Review identified gaps",
            "4. Click suggested care plans to add",
            "5. Track gap resolution over time"
          ],
          bestPractices: [
            "Run after new diagnosis documented",
            "Address high-priority gaps first",
            "Use as audit preparation tool",
            "Educate yourself on why gaps exist",
            "Create comprehensive care coverage"
          ],
          page: "PatientDetails"
        },
        {
          name: "AI Care Plans from Notes",
          icon: Sparkles,
          description: "Generate accurate care plans directly from your enhanced clinical notes",
          howTo: [
            "1. Enhance your visit note normally",
            "2. Click 'Suggest Care Plans' button",
            "3. AI analyzes complete note for needs",
            "4. Review generated care plans",
            "5. Select and create plans with one click"
          ],
          bestPractices: [
            "Use after documenting complete assessments",
            "Review AI suggestions against clinical judgment",
            "Customize goals to be patient-specific",
            "Generate after significant status changes",
            "Creates plans based on actual documented needs"
          ],
          page: "SmartNoteAssistant"
        }
      ]
    },
    {
      category: "Compliance & Quality",
      icon: Shield,
      color: "red",
      items: [
        {
          name: "Medicare Compliance Checker",
          icon: Shield,
          description: "Real-time compliance scoring with specific element tracking and improvement suggestions",
          howTo: [
            "1. Available automatically after note enhancement",
            "2. View compliance score and breakdown",
            "3. Review flagged missing elements",
            "4. Apply suggested fixes with one click",
            "5. Track compliance trends over time"
          ],
          bestPractices: [
            "Aim for 90%+ compliance scores",
            "Learn from flagged elements",
            "Review compliance before submitting",
            "Use as training tool for improvement",
            "Document all required elements first time"
          ],
          page: "MedicareComplianceDashboard"
        },
        {
          name: "Clinical Note Reviewer",
          icon: FileText,
          description: "AI audits notes for completeness, accuracy, billing optimization, and clarity",
          howTo: [
            "1. After enhancing note, expand Note Review section",
            "2. Click 'Review Note' for detailed analysis",
            "3. Review scores by category",
            "4. Apply improvement suggestions",
            "5. Re-review if major changes made"
          ],
          bestPractices: [
            "Review high-value visits thoroughly",
            "Focus on billing optimization tips",
            "Learn from accuracy feedback",
            "Use clarity suggestions for readability",
            "Track improvement in review scores"
          ],
          page: "SmartNoteAssistant"
        }
      ]
    },
    {
      category: "Training & Education",
      icon: GraduationCap,
      color: "orange",
      items: [
        {
          name: "Personalized Training Hub",
          icon: GraduationCap,
          description: "AI identifies your documentation gaps and recommends targeted micro-learning",
          howTo: [
            "1. AI analyzes your note patterns automatically",
            "2. View recommended training in Training Hub",
            "3. Complete interactive modules and quizzes",
            "4. Track your progress and scores",
            "5. Apply learning immediately to practice"
          ],
          bestPractices: [
            "Complete critical recommendations first",
            "Practice new skills on next visit",
            "Review training before complex cases",
            "Track certification expiration dates",
            "Share valuable modules with peers"
          ],
          page: "StaffTrainingHub"
        },
        {
          name: "Guidelines Library",
          icon: BookOpen,
          description: "Searchable Medicare and clinical guidelines with AI-powered contextual retrieval",
          howTo: [
            "1. Search by diagnosis or topic",
            "2. AI suggests relevant guidelines automatically",
            "3. Read summary or full guideline",
            "4. Insert guideline text into notes",
            "5. Bookmark frequently used guidelines"
          ],
          bestPractices: [
            "Review guidelines before complex visits",
            "Use to support clinical decisions",
            "Stay updated on regulatory changes",
            "Reference in documentation when applicable",
            "Share key guidelines with team"
          ],
          page: "MedicareGuidelinesLibrary"
        }
      ]
    },
    {
      category: "Productivity Tools",
      icon: Zap,
      color: "indigo",
      items: [
        {
          name: "Intelligent Task Prioritization",
          icon: Activity,
          description: "AI prioritizes your tasks based on urgency, patient risk, and clinical importance",
          howTo: [
            "1. Tasks auto-generate from visit notes and alerts",
            "2. View prioritized task list on dashboard",
            "3. AI explains priority reasoning",
            "4. Complete tasks and mark done",
            "5. Track task completion trends"
          ],
          bestPractices: [
            "Review tasks at start of day",
            "Address high-priority items first",
            "Set realistic due dates",
            "Use task notes to track actions",
            "Create recurring tasks for routine follow-ups"
          ],
          page: "Dashboard"
        },
        {
          name: "Smart Route Optimizer",
          icon: TrendingUp,
          description: "AI optimizes your daily visit schedule based on location, priority, and patient needs",
          howTo: [
            "1. View today's scheduled visits",
            "2. Click 'Optimize Route'",
            "3. AI suggests optimal visit order",
            "4. Review drive times and priorities",
            "5. Follow optimized schedule"
          ],
          bestPractices: [
            "Run optimizer each morning",
            "Consider traffic patterns",
            "Group nearby patients together",
            "Build buffer time for complex visits",
            "Provide feedback to improve AI"
          ],
          page: "Dashboard"
        },
        {
          name: "Offline Mode",
          icon: Activity,
          description: "Document visits without internet - auto-syncs when back online",
          howTo: [
            "1. App automatically detects offline status",
            "2. Continue documenting visits normally",
            "3. Data saves locally on your device",
            "4. When online, data auto-syncs to cloud",
            "5. See sync status in bottom corner"
          ],
          bestPractices: [
            "Sync before leaving office",
            "Check offline indicator regularly",
            "Don't close browser until synced",
            "Keep critical patients cached",
            "Test offline mode before field use"
          ],
          page: "OfflineMode"
        }
      ]
    }
  ];

  const allFeatures = features.flatMap(cat => 
    cat.items.map(item => ({ ...item, category: cat.category, categoryColor: cat.color }))
  );

  const filteredFeatures = searchTerm
    ? allFeatures.filter(f => 
        f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.category.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : null;

  return (
    <div className="p-3 sm:p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Features Guide</h1>
        <p className="text-sm sm:text-base text-gray-600">Learn how to use CareMetric AI to streamline your nursing practice</p>
      </div>

      {/* Search */}
      <div className="mb-4 sm:mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
          <Input
            placeholder="Search features..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 sm:pl-10 h-11 sm:h-12 text-sm sm:text-base"
          />
        </div>
      </div>

      {/* Search Results */}
      {filteredFeatures && (
        <div className="space-y-4 mb-6">
          <p className="text-sm text-gray-600">{filteredFeatures.length} feature{filteredFeatures.length !== 1 ? 's' : ''} found</p>
          {filteredFeatures.map((feature, idx) => (
            <FeatureCard key={idx} feature={feature} />
          ))}
        </div>
      )}

      {/* Feature Categories */}
      {!filteredFeatures && (
        <Tabs defaultValue={features[0].category} className="space-y-4 sm:space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-5 h-auto gap-1 sm:gap-2">
            {features.map((cat) => (
              <TabsTrigger key={cat.category} value={cat.category} className="gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm">
                <cat.icon className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden md:inline">{cat.category}</span>
                <span className="md:hidden truncate">{cat.category.split(' ')[0]}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {features.map((category) => (
            <TabsContent key={category.category} value={category.category} className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                {category.items.map((feature, idx) => (
                  <FeatureCard key={idx} feature={{ ...feature, categoryColor: category.color }} />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Quick Tips Card */}
      <Card className="mt-6 sm:mt-8 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
            Quick Tips for Success
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-indigo-900">🎯 For Best AI Results:</h4>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• Save detailed patient information</li>
                <li>• Include specific observations, not vague terms</li>
                <li>• Document skilled interventions clearly</li>
                <li>• Note patient responses to teaching</li>
                <li>• Be consistent with your documentation style</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-indigo-900">⚡ Time-Saving Shortcuts:</h4>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• Use voice dictation for hands-free notes</li>
                <li>• Create custom phrases for common findings</li>
                <li>• Favorite frequently visited pages/patients</li>
                <li>• Enable offline mode for field documentation</li>
                <li>• Use one-click compliance fixes</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureCard({ feature }) {
  const [expanded, setExpanded] = useState(false);
  
  const colorMap = {
    blue: "from-blue-50 to-blue-100 border-blue-300",
    green: "from-green-50 to-green-100 border-green-300",
    purple: "from-purple-50 to-purple-100 border-purple-300",
    red: "from-red-50 to-red-100 border-red-300",
    orange: "from-orange-50 to-orange-100 border-orange-300",
    indigo: "from-indigo-50 to-indigo-100 border-indigo-300"
  };

  const iconColorMap = {
    blue: "text-blue-600",
    green: "text-green-600",
    purple: "text-purple-600",
    red: "text-red-600",
    orange: "text-orange-600",
    indigo: "text-indigo-600"
  };

  return (
    <Card className={`border-2 bg-gradient-to-r ${colorMap[feature.categoryColor] || colorMap.blue}`}>
      <CardHeader className="pb-3 p-3 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <div className="flex items-start gap-2 sm:gap-3 flex-1 w-full min-w-0">
            <div className={`p-1.5 sm:p-2 bg-white rounded-lg shadow flex-shrink-0`}>
              <feature.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${iconColorMap[feature.categoryColor] || iconColorMap.blue}`} />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base sm:text-lg mb-1 break-words">{feature.name}</CardTitle>
              <p className="text-xs sm:text-sm text-gray-700">{feature.description}</p>
              {feature.category && (
                <Badge variant="outline" className="mt-2 text-xs">
                  {feature.category}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto sm:flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded(!expanded)}
              className="flex-1 sm:flex-none min-h-[36px] text-xs sm:text-sm"
            >
              {expanded ? 'Hide' : 'Learn More'}
            </Button>
            {feature.page && (
              <Link to={createPageUrl(feature.page)} className="flex-1 sm:flex-none">
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 w-full min-h-[36px] text-xs sm:text-sm">
                  Try It
                </Button>
              </Link>
            )}
          </div>
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent className="pt-0 p-3 sm:p-6 space-y-3 sm:space-y-4 border-t bg-white/50">
          <div>
            <h4 className="font-semibold text-xs sm:text-sm flex items-center gap-2 mb-2 text-gray-900">
              <CheckCircle2 className="w-3 h-3 sm:w-4 sm:h-4 text-green-600 flex-shrink-0" />
              How to Use
            </h4>
            <ol className="space-y-1">
              {feature.howTo.map((step, idx) => (
                <li key={idx} className="text-xs sm:text-sm text-gray-700 pl-2">{step}</li>
              ))}
            </ol>
          </div>
          
          <div>
            <h4 className="font-semibold text-xs sm:text-sm flex items-center gap-2 mb-2 text-gray-900">
              <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600 flex-shrink-0" />
              Best Practices
            </h4>
            <ul className="space-y-1">
              {feature.bestPractices.map((practice, idx) => (
                <li key={idx} className="text-xs sm:text-sm text-gray-700 flex items-start gap-2">
                  <span className="text-purple-600 font-bold flex-shrink-0">•</span>
                  <span>{practice}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}