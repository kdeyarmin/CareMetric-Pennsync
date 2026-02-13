import React, { useState } from "react";
import {
  BookOpen, Home, Users, FileText, Activity, Target, Shield,
  BarChart3, Bell, Settings, Mic, CheckCircle,
  Search, Zap, Clock, Heart, Brain, ClipboardList, Upload,
  MessageSquare, Calendar, TrendingUp, Award, HelpCircle,
  Keyboard, Monitor, Smartphone, Globe
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import DocSection from "@/components/documentation/DocSection";
import DocStep from "@/components/documentation/DocStep";
import DocTip from "@/components/documentation/DocTip";
import GuideDownloadSection from "@/components/documentation/GuideDownloadSection";

const TABLE_OF_CONTENTS = [
  { id: "guides", label: "Downloadable Guides" },
  { id: "getting-started", label: "Getting Started" },
  { id: "dashboard", label: "Dashboard" },
  { id: "patients", label: "Patient Management" },
  { id: "smart-note", label: "Smart Note Assistant" },
  { id: "scribe", label: "Medical Scribe" },
  { id: "care-plans", label: "Care Plans" },
  { id: "oasis", label: "OASIS" },
  { id: "compliance", label: "Compliance" },
  { id: "analytics", label: "Analytics" },
  { id: "alerts", label: "Patient Alerts" },
  { id: "tasks", label: "Task Management" },
  { id: "training", label: "Training Hub" },
  { id: "settings", label: "Settings" },
  { id: "tips", label: "Tips & Best Practices" },
  { id: "faq", label: "FAQ" },
];

export default function Documentation() {
  const [searchQuery, setSearchQuery] = useState("");

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-3 mb-4">
            <BookOpen className="h-8 w-8" />
            <Badge className="bg-white/20 text-white border-white/30">v2.0</Badge>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">CareMetric AI User Manual</h1>
          <p className="text-blue-100 text-lg max-w-2xl">
            Your complete guide to mastering AI-powered clinical documentation, compliance, and patient care management.
          </p>
          <div className="mt-6 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300" />
              <Input
                placeholder="Search the documentation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-blue-200 focus:bg-white/20"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Table of Contents */}
          <aside className="lg:w-64 flex-shrink-0">
            <div className="lg:sticky lg:top-20 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-3 text-sm uppercase tracking-wider">Contents</h3>
              <nav className="space-y-1">
                {TABLE_OF_CONTENTS.filter(item =>
                  !searchQuery || item.label.toLowerCase().includes(searchQuery.toLowerCase())
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className="w-full text-left text-sm px-3 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 space-y-6">

            {/* Downloadable Guides */}
            <div id="guides" className="space-y-3">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Downloadable Guides
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Download our PDF guides for offline reference. Great for printing or sharing with your team.
              </p>
              <GuideDownloadSection />
            </div>

            {/* Getting Started */}
            <div id="getting-started">
              <DocSection icon={Zap} title="Getting Started" description="Everything you need to begin using CareMetric AI" defaultOpen={true}>
                <p className="text-slate-600 dark:text-slate-400 mb-4">Welcome to CareMetric AI! This platform is designed to dramatically reduce your documentation time while improving compliance and patient care quality. Here's how to get started in just a few minutes.</p>

                <DocStep number={1} title="Complete Your Profile">
                  After signing in, navigate to <strong>Settings</strong> from the sidebar. Fill in your professional details including your provider type, credentials, and care scope. This helps the AI tailor documentation to your specific role.
                </DocStep>
                <DocStep number={2} title="Add Your First Patient">
                  Go to the <strong>Patients</strong> page and click <strong>"Add Patient"</strong>. Enter the patient's basic information, diagnoses, and medications. You can also use sample data to explore the platform first.
                </DocStep>
                <DocStep number={3} title="Try the Smart Note Assistant">
                  Navigate to <strong>Smart Note</strong> in the sidebar. Select a patient, choose your visit type, and type or dictate your rough notes. Click <strong>"Enhance Note"</strong> to see the AI transform them into compliant documentation.
                </DocStep>
                <DocStep number={4} title="Explore the Dashboard">
                  Your <strong>Dashboard</strong> provides a comprehensive overview of your patients, tasks, alerts, and compliance status—all in one place.
                </DocStep>

                <DocTip type="tip">
                  Start with the Smart Note Assistant—it's the fastest way to see the power of CareMetric AI. Most users save 20–30 minutes on their very first note.
                </DocTip>
              </DocSection>
            </div>

            {/* Dashboard */}
            <div id="dashboard">
              <DocSection icon={Home} title="Dashboard" description="Your command center for daily operations">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Dashboard is your home base. It provides a real-time snapshot of everything that needs your attention.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Key Features:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Patient Summary</strong> — Total active patients, new admissions, and high-risk cases at a glance</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Task Overview</strong> — Pending, overdue, and completed tasks for the day</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Compliance Alerts</strong> — Open violations and compliance issues needing attention</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Time Saved Widget</strong> — Tracks how much time AI has saved you today, this week, and overall</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Quick Actions</strong> — One-click access to common workflows like creating notes, adding patients, or reviewing alerts</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Announcements</strong> — Important system updates and agency-wide notifications</li>
                </ul>

                <DocTip type="info">
                  The dashboard automatically refreshes. High-risk patients and critical alerts are always shown first so you never miss urgent items.
                </DocTip>
              </DocSection>
            </div>

            {/* Patient Management */}
            <div id="patients">
              <DocSection icon={Users} title="Patient Management" description="Add, manage, and track all your patients">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Patients page is your centralized hub for managing all patient records. CareMetric AI provides comprehensive patient profiles with clinical history, medications, vitals, and more.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Adding a Patient:</h4>
                <DocStep number={1} title="Click 'Add Patient'">
                  Use the button in the top-right corner of the Patients page. A form will open for entering patient information.
                </DocStep>
                <DocStep number={2} title="Fill in Patient Details">
                  Enter demographics, diagnoses, medications, allergies, emergency contacts, and insurance information. Only first and last name are required—you can add more details later.
                </DocStep>
                <DocStep number={3} title="Save and Continue">
                  After saving, you'll be taken to the patient's detail page where you can add visits, care plans, and documentation.
                </DocStep>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-2">Key Capabilities:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Search & Filter</strong> — Find patients instantly by name, diagnosis, or status</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Risk Assessment</strong> — AI-calculated risk scores for each patient</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Visit History</strong> — Complete timeline of all visits and documentation</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Bulk Actions</strong> — Update multiple patients at once</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Referral Upload</strong> — Import patient data from referral documents</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Duplicate Detection</strong> — Automatically finds and merges duplicate records</li>
                </ul>

                <DocTip type="tip">
                  Use the "Quick Add" button to rapidly enter patients with just essential information. You can always complete the full profile later.
                </DocTip>
              </DocSection>
            </div>

            {/* Smart Note Assistant */}
            <div id="smart-note">
              <DocSection icon={FileText} title="Smart Note Assistant" description="AI-powered clinical documentation in seconds">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Smart Note Assistant is the core feature of CareMetric AI. It transforms your rough clinical notes into fully compliant, professional documentation—saving you up to 70% of documentation time.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">How to Create a Smart Note:</h4>
                <DocStep number={1} title="Select Your Patient">
                  Choose the patient from the dropdown at the top of the Smart Note page. Their clinical context is automatically loaded.
                </DocStep>
                <DocStep number={2} title="Choose Visit Type & Diagnosis">
                  Select the visit type (e.g., Skilled Nursing, Admission, Recertification) and enter the relevant diagnosis. This helps the AI tailor the note format.
                </DocStep>
                <DocStep number={3} title="Enter Your Rough Notes">
                  Type or dictate your observations, interventions, and findings. Don't worry about formatting—the AI handles that. You can write in shorthand, bullet points, or full sentences.
                </DocStep>
                <DocStep number={4} title="Click 'Enhance Note'">
                  The AI processes your notes and generates a Medicare-compliant clinical narrative with proper structure, medical terminology, and all required documentation elements.
                </DocStep>
                <DocStep number={5} title="Review & Edit">
                  Review the enhanced note, make any adjustments, and save. The compliance checker runs automatically to flag any missing elements.
                </DocStep>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-2">Built-in Tools:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><Mic className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Voice Dictation</strong> — Speak your notes and let the AI transcribe them</li>
                  <li className="flex gap-2"><Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Real-Time Compliance</strong> — Instant feedback on compliance issues as you type</li>
                  <li className="flex gap-2"><Brain className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>ICD-10 Code Suggestions</strong> — AI-recommended diagnosis codes based on note content</li>
                  <li className="flex gap-2"><Target className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Care Plan Suggestions</strong> — Automated care plan drafts based on your documentation</li>
                  <li className="flex gap-2"><ClipboardList className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Follow-Up Task Generation</strong> — Automatically creates tasks from your clinical notes</li>
                  <li className="flex gap-2"><Heart className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Patient Education</strong> — Generate patient-friendly materials based on the visit</li>
                </ul>

                <DocTip type="tip">
                  The AI learns your writing style over time. The more you use it, the better it gets at matching your preferred documentation format and terminology.
                </DocTip>

                <DocTip type="warning">
                  Always review AI-generated notes before finalizing. While the AI achieves 95%+ accuracy, clinical judgment should always guide the final documentation.
                </DocTip>
              </DocSection>
            </div>

            {/* Medical Scribe */}
            <div id="scribe">
              <DocSection icon={Mic} title="Medical Scribe" description="Voice-to-documentation with AI transcription">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Medical Scribe feature allows you to record your visit verbally and have CareMetric AI convert the recording into a structured, compliant clinical note.</p>

                <DocStep number={1} title="Start a New Recording">
                  Navigate to <strong>Medical Scribe</strong>, select your patient, and click the <strong>Record</strong> button. Speak naturally about your visit observations.
                </DocStep>
                <DocStep number={2} title="Review Transcription">
                  Once you stop recording, the AI transcribes your audio. Review the transcription for accuracy and make corrections if needed.
                </DocStep>
                <DocStep number={3} title="Generate the Note">
                  Click <strong>"Generate Note"</strong> to convert the transcription into a formatted clinical document. The AI structures your verbal notes into proper clinical narrative.
                </DocStep>

                <DocTip type="tip">
                  Speak at a natural pace and mention key clinical terms clearly. The AI is trained on medical terminology and will accurately transcribe most clinical language.
                </DocTip>
              </DocSection>
            </div>

            {/* Care Plans */}
            <div id="care-plans">
              <DocSection icon={Target} title="Care Plan Management" description="Create and track evidence-based care plans">
                <p className="text-slate-600 dark:text-slate-400 mb-4">CareMetric AI helps you build, manage, and monitor individualized care plans with AI assistance. Plans can be generated automatically based on patient diagnoses and medications.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Key Features:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>AI-Generated Plans</strong> — Automatically create care plans from diagnoses and clinical data</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Template Library</strong> — Pre-built templates for common conditions</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Progress Tracking</strong> — Monitor goal achievement with measurable outcomes</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Review Reminders</strong> — Automated reminders when plans need reassessment</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Collaboration</strong> — Share and collaborate on care plans with your team</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Automatic Triggers</strong> — Care plans auto-generate based on specific diagnoses or medications</li>
                </ul>

                <DocTip type="info">
                  Administrators can configure automatic care plan triggers in <strong>Settings → Automatic Care Plans</strong>. When a patient is admitted with a matching diagnosis, the care plan is created automatically.
                </DocTip>
              </DocSection>
            </div>

            {/* OASIS */}
            <div id="oasis">
              <DocSection icon={FileText} title="OASIS Assessment" description="Streamlined OASIS analysis and PDGM optimization">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The OASIS module provides AI-powered analysis of your OASIS assessments, ensuring accuracy, compliance, and optimal PDGM case-mix scoring.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">How to Use:</h4>
                <DocStep number={1} title="Upload Your OASIS Document">
                  Upload a completed OASIS assessment (PDF or image format) using the upload area on the OASIS page.
                </DocStep>
                <DocStep number={2} title="AI Analysis">
                  CareMetric AI scans the document for errors, inconsistencies, and optimization opportunities. It checks every response against CMS guidelines.
                </DocStep>
                <DocStep number={3} title="Review Findings">
                  View detailed findings including error flags, suggested corrections, PDGM impact analysis, and revenue implications.
                </DocStep>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mt-6 mb-2">Key Capabilities:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> PDGM case-mix weight calculation and optimization</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> Multi-report comparison for tracking changes over time</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> Scenario modeling for what-if analysis</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> Automated quality assurance checks</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> Export detailed audit reports</li>
                </ul>
              </DocSection>
            </div>

            {/* Compliance */}
            <div id="compliance">
              <DocSection icon={Shield} title="Compliance Dashboard" description="Monitor and maintain regulatory compliance">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Compliance Dashboard gives you a comprehensive view of your documentation compliance status across all patients and visits.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">What It Monitors:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Medicare Documentation Requirements</strong> — Ensures all required elements are present</li>
                  <li className="flex gap-2"><Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Homebound Status Justification</strong> — Validates homebound status documentation</li>
                  <li className="flex gap-2"><Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Skilled Need Documentation</strong> — Confirms skilled nursing need is properly justified</li>
                  <li className="flex gap-2"><Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Care Plan Alignment</strong> — Checks that visits align with established care plans</li>
                  <li className="flex gap-2"><Shield className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Agency-Specific Rules</strong> — Custom compliance rules set by your agency administrator</li>
                </ul>

                <DocTip type="tip">
                  Set your compliance target in Settings. CareMetric AI will proactively alert you when notes fall below your target score and suggest specific improvements.
                </DocTip>
              </DocSection>
            </div>

            {/* Analytics */}
            <div id="analytics">
              <DocSection icon={BarChart3} title="Analytics Dashboard" description="Track performance and identify trends">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Analytics Dashboard provides data-driven insights into your documentation quality, productivity, compliance rates, and patient outcomes.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Available Reports:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Time Savings Analysis</strong> — How much time AI has saved you daily, weekly, and monthly</li>
                  <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Compliance Trends</strong> — Track your compliance score improvements over time</li>
                  <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Documentation Quality</strong> — Average quality scores and areas for improvement</li>
                  <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>AI Feature Usage</strong> — Which AI features you use most and their impact</li>
                  <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Patient Risk Overview</strong> — Population-level risk metrics and trending alerts</li>
                </ul>

                <DocTip type="info">
                  Analytics data updates in real time. Use the date filters to compare performance across different time periods and identify patterns.
                </DocTip>
              </DocSection>
            </div>

            {/* Patient Alerts */}
            <div id="alerts">
              <DocSection icon={Bell} title="Patient Alerts" description="Proactive AI-powered risk detection">
                <p className="text-slate-600 dark:text-slate-400 mb-4">CareMetric AI continuously analyzes patient data to identify risks before they become emergencies. The Patient Alerts system provides early warnings for deterioration, medication risks, fall risks, and more.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Alert Types:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><Bell className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" /> <strong>Vital Deterioration</strong> — Trending changes in vital signs that indicate concern</li>
                  <li className="flex gap-2"><Bell className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" /> <strong>Medication Risk</strong> — Potential interactions or adherence issues</li>
                  <li className="flex gap-2"><Bell className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" /> <strong>Fall Risk</strong> — Increased fall risk based on assessment data</li>
                  <li className="flex gap-2"><Bell className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Readmission Risk</strong> — Patients at risk for hospital readmission</li>
                  <li className="flex gap-2"><Bell className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" /> <strong>Care Gaps</strong> — Missing assessments, overdue visits, or incomplete documentation</li>
                </ul>

                <DocTip type="warning">
                  Critical alerts require immediate attention. Always review and acknowledge critical and high-severity alerts promptly. You can add resolution notes when addressing each alert.
                </DocTip>
              </DocSection>
            </div>

            {/* Tasks */}
            <div id="tasks">
              <DocSection icon={CheckCircle} title="Task Management" description="Stay organized with smart task tracking">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Task Management system helps you track follow-ups, referrals, orders, and other action items. Tasks can be created manually or generated automatically by AI from your clinical documentation.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Features:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>AI-Generated Tasks</strong> — Automatically created from visit notes (e.g., "Call physician about medication change")</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Priority Levels</strong> — Critical, High, Medium, and Low priority categorization</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Due Dates & Reminders</strong> — Set deadlines and receive notifications</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Recurring Tasks</strong> — Set up daily, weekly, or monthly recurring tasks</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Task Assignment</strong> — Assign tasks to yourself or team members</li>
                  <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" /> <strong>Completion Notes</strong> — Document how each task was resolved</li>
                </ul>

                <DocTip type="tip">
                  After completing a visit note, check the "Follow-Up Tasks" section. The AI will suggest tasks based on your documentation—saving you from forgetting important follow-ups.
                </DocTip>
              </DocSection>
            </div>

            {/* Training */}
            <div id="training">
              <DocSection icon={Award} title="Training Hub" description="Personalized learning and skill development">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Training Hub provides personalized learning modules, compliance training, and skill assessments tailored to your specific needs and performance data.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Available Resources:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><BookOpen className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Training Modules</strong> — Interactive courses on documentation, compliance, and clinical skills</li>
                  <li className="flex gap-2"><BookOpen className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>AI Skill Assessment</strong> — Identify your documentation strengths and areas to improve</li>
                  <li className="flex gap-2"><BookOpen className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Personalized Recommendations</strong> — AI-suggested training based on your actual performance</li>
                  <li className="flex gap-2"><BookOpen className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Compliance Quizzes</strong> — Test your knowledge on Medicare requirements</li>
                  <li className="flex gap-2"><BookOpen className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Progress Tracking</strong> — Monitor your learning journey and earn certifications</li>
                </ul>
              </DocSection>
            </div>

            {/* Settings */}
            <div id="settings">
              <DocSection icon={Settings} title="Settings & Customization" description="Personalize your CareMetric AI experience">
                <p className="text-slate-600 dark:text-slate-400 mb-4">The Settings page lets you customize your CareMetric AI experience to match your workflow preferences and clinical role.</p>

                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Configurable Options:</h4>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                  <li className="flex gap-2"><Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Provider Type & Credentials</strong> — Set your professional role for tailored AI suggestions</li>
                  <li className="flex gap-2"><Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>AI Preferences</strong> — Control note length, tone, and complexity level</li>
                  <li className="flex gap-2"><Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Notification Preferences</strong> — Choose how and when you receive alerts</li>
                  <li className="flex gap-2"><Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Compliance Targets</strong> — Set your minimum acceptable compliance score</li>
                  <li className="flex gap-2"><Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Practice Information</strong> — Configure your practice details for document headers</li>
                  <li className="flex gap-2"><Settings className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" /> <strong>Agency Code</strong> — Join your agency for shared templates and compliance rules</li>
                </ul>

                <DocTip type="info">
                  Setting your provider type (RN, LPN, PT, OT, etc.) in Settings dramatically improves AI output quality because it tailors documentation language and requirements to your specific discipline.
                </DocTip>
              </DocSection>
            </div>

            {/* Tips & Best Practices */}
            <div id="tips">
              <DocSection icon={Zap} title="Tips & Best Practices" description="Get the most out of CareMetric AI">
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                    <h4 className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-2"><Keyboard className="h-4 w-4" /> Be Detailed in Rough Notes</h4>
                    <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">The more detail you include in your rough notes, the better the AI output. Include observations, interventions, patient responses, and teaching provided.</p>
                  </div>

                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                    <h4 className="font-semibold text-green-900 dark:text-green-200 flex items-center gap-2"><Monitor className="h-4 w-4" /> Review Before Finalizing</h4>
                    <p className="text-sm text-green-800 dark:text-green-300 mt-1">Always review AI-enhanced notes for clinical accuracy. While the AI is highly accurate, your professional judgment is essential for the final document.</p>
                  </div>

                  <div className="bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                    <h4 className="font-semibold text-purple-900 dark:text-purple-200 flex items-center gap-2"><Smartphone className="h-4 w-4" /> Use Voice Dictation in the Field</h4>
                    <p className="text-sm text-purple-800 dark:text-purple-300 mt-1">When doing home visits, use voice dictation immediately after the visit while details are fresh. This is the fastest way to capture comprehensive notes.</p>
                  </div>

                  <div className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                    <h4 className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2"><Clock className="h-4 w-4" /> Check Tasks Daily</h4>
                    <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">Start each day by reviewing your task list. AI-generated tasks from your previous visits ensure nothing falls through the cracks.</p>
                  </div>

                  <div className="bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20 rounded-lg p-4 border border-rose-200 dark:border-rose-800">
                    <h4 className="font-semibold text-rose-900 dark:text-rose-200 flex items-center gap-2"><Globe className="h-4 w-4" /> Leverage Patient Education</h4>
                    <p className="text-sm text-rose-800 dark:text-rose-300 mt-1">Use the built-in patient education generator to create condition-specific handouts. This improves patient engagement and satisfies teaching documentation requirements.</p>
                  </div>
                </div>
              </DocSection>
            </div>

            {/* FAQ */}
            <div id="faq">
              <DocSection icon={HelpCircle} title="Frequently Asked Questions" description="Quick answers to common questions">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Is my patient data secure?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Absolutely. CareMetric AI is built with HIPAA compliance at its core. All data is encrypted in transit and at rest, and access is strictly controlled based on user roles and permissions.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Can I use CareMetric AI on my phone?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Yes! CareMetric AI is fully responsive and optimized for mobile devices. You can document visits, record voice notes, and manage tasks from your phone or tablet.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">How accurate is the AI-generated documentation?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Our AI achieves over 95% compliance accuracy. However, we always recommend reviewing the output before finalizing. The AI learns from your edits, improving accuracy over time.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Can multiple clinicians use the same account?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Each clinician should have their own account for proper audit trails and personalized AI learning. Administrators can invite team members through the User Management page.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">What visit types are supported?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">CareMetric AI supports all standard visit types including Skilled Nursing, Admission, Recertification, Discharge, Routine Visits, and PRN visits. Each type has tailored documentation templates.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">How do I get help if I'm stuck?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">You can email our support team at <strong>support@caremetricai.com</strong> anytime. We also offer in-app training modules and personalized onboarding assistance.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Does the AI work offline?</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">CareMetric AI includes offline note capture capabilities. You can draft notes offline, and they will automatically sync and be enhanced once you're back online.</p>
                  </div>
                </div>
              </DocSection>
            </div>

            {/* Support Footer */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-8 text-white text-center">
              <MessageSquare className="h-10 w-10 mx-auto mb-4 opacity-90" />
              <h2 className="text-2xl font-bold mb-2">Need More Help?</h2>
              <p className="text-blue-100 mb-6 max-w-md mx-auto">
                Our support team is always here to assist you. Reach out anytime and we'll help you make the most of CareMetric AI.
              </p>
              <a
                href="mailto:support@caremetricai.com"
                className="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors"
              >
                Contact Support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}