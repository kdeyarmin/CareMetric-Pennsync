import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Clock,
  Mic,
  FileText,
  Shield,
  Zap,
  TrendingUp,
  Brain,
  Bell,
  Target,
  AlertTriangle,
  Calendar,
  Activity,
  BarChart3,
  RefreshCw,
  ShieldCheck,
  Heart,
  ClipboardList,
  Stethoscope,
  Download,
  GraduationCap,
  DollarSign,
  FileCheck,
  Users,
  LineChart,
  Layers,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  WifiOff,
  Edit,
  Grid3x3
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { toast } from 'sonner';

export default function FeaturesPage() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isGeneratingManual, setIsGeneratingManual] = useState(false);

  const features = [
    {
      category: "Document Management",
      icon: FileText,
      color: "cyan",
      items: [
        {
          name: "Enhanced PDF Template Manager",
          icon: Layers,
          description: "Organize templates by category, version control with history, and powerful search/filter capabilities",
          timeSaved: "5-8 min finding templates",
          impact: "high",
          details: "Categorized templates (consent, assessment, care plan, etc.), version tracking, search by name or description, grid/list view toggle",
          howToUse: "Navigate to Document Management > Template Library. Use category filters and search to find templates. View version history with change notes."
        },
        {
          name: "Quick Document Presets",
          icon: Zap,
          description: "One-click document packages for common workflows (Admission, Consent Packet, Discharge)",
          timeSaved: "3-5 min per package",
          impact: "high",
          details: "Pre-configured document bundles for common scenarios, instant selection of multiple related documents",
          howToUse: "Click 'Create Package' > Select a Quick Preset (Admission Onboarding, Full Consent Packet, etc.) > Review and send."
        },
        {
          name: "Custom PDF Upload",
          icon: FileCheck,
          description: "Upload your own PDF forms to include in document packages alongside system templates",
          timeSaved: "2-3 min per document",
          impact: "medium",
          details: "Drag-and-drop PDF upload, organize custom documents, combine with system templates",
          howToUse: "In document creation, click 'Upload Custom PDF' > Drag file or browse > Add to package with other templates."
        },
        {
          name: "Visual PDF Field Editor",
          icon: Edit,
          description: "Drag-and-drop field placement on PDFs with real-time positioning and multiple field types",
          timeSaved: "10-15 min per template",
          impact: "critical",
          details: "Click to place fields, drag to reposition, support for text, signature, initials, date, checkbox fields, field preview",
          howToUse: "In Template Editor, upload PDF > Click to add fields > Drag fields to position > Configure field properties > Save."
        },
        {
          name: "Conditional Field Logic",
          icon: Sparkles,
          description: "Show/hide fields dynamically based on other field values with visual indicators",
          timeSaved: "Smart forms",
          impact: "high",
          details: "Set conditional rules on fields (if checkbox checked, show text field), visual ⚡ indicator for conditional fields",
          howToUse: "Select a field > Click 'Add Condition' > Set trigger field, operator, and value > Fields show/hide automatically."
        },
        {
          name: "Dynamic Tables",
          icon: Grid3x3,
          description: "Add configurable tables with custom rows and columns to PDF templates",
          timeSaved: "Flexible layouts",
          impact: "medium",
          details: "Drag table element onto PDF, configure row/column count, auto-sizing, supports data entry",
          howToUse: "Select 'Dynamic Table' field type > Set rows and columns > Place on PDF > Table renders with borders."
        },
        {
          name: "Rich Text Formatting",
          icon: FileText,
          description: "Advanced text styling with bold, italic, underline, custom colors, and font sizes",
          timeSaved: "Professional appearance",
          impact: "medium",
          details: "Font sizes 12-24px, 6 color options, bold/italic/underline styling, preview in real-time",
          howToUse: "Select 'Rich Text' field > Choose font size, color, and styling > Place on PDF > Preview formatting."
        }
      ]
    },
    {
      category: "Smart Note Assistant",
      icon: Brain,
      color: "purple",
      items: [
        {
          name: "Unified AI Suggestions (Compliance + Quality)",
          icon: Sparkles,
          description: "Single AI panel that analyzes notes for BOTH Medicare compliance gaps AND quality improvements with one 'Fix All' button",
          timeSaved: "10-15 min/visit",
          impact: "critical",
          details: "Combines compliance checking and quality analysis into one streamlined interface. Identifies missing Medicare elements, vague language, weak flow, and generic descriptions all in one place",
          howToUse: "Type your rough note and watch AI suggestions appear automatically. Review compliance gaps and quality improvements in tabs, then click 'Fix All' to apply everything at once."
        },
        {
          name: "Offline Documentation Mode",
          icon: WifiOff,
          description: "Document visits without internet connection and auto-sync when back online",
          timeSaved: "Eliminates connectivity delays",
          impact: "high",
          details: "Works completely offline for patient visits, stores data locally, automatic sync when connection restored",
          howToUse: "Navigate to Offline Mode, select patient, document visit offline. Data syncs automatically when you're back online."
        },
        {
          name: "AI-Powered Voice Dictation",
          icon: Mic,
          description: "Record clinical observations and AI automatically transcribes, formats, and converts to Medicare-compliant narrative",
          timeSaved: "5-10 min/visit",
          impact: "critical",
          details: "Eliminates typing, auto-formats medical terminology, real-time transcription",
          howToUse: "Click the microphone icon, speak naturally, AI transcribes and formats automatically. Review and enhance with one click."
        },
        {
          name: "Smart Vitals Recognition",
          icon: Activity,
          description: "Speak vital signs naturally and AI extracts and populates fields automatically",
          timeSaved: "2-3 min/visit",
          impact: "high",
          details: "Hands-free structured data entry, natural language processing, auto-converts spoken values",
          howToUse: "Say 'blood pressure 120 over 80' or 'heart rate 72' and AI fills the fields automatically."
        },
        {
        name: "AI Note Enhancement",
        icon: Sparkles,
        description: "One-click transformation of rough notes into polished, Medicare-compliant clinical documentation",
        timeSaved: "10-15 min/visit",
          impact: "critical",
          details: "Adds required sections, improves clarity, ensures compliance, maintains clinical accuracy",
          howToUse: "Type or dictate rough notes, click 'Enhance with AI', review the polished result."
        },
        {
          name: "Smart Auto-Complete",
          icon: Zap,
          description: "Type trigger words like 'lungs', 'heart', 'wound' and get instant phrase suggestions specific to diagnosis",
          timeSaved: "2-5 min/visit",
          impact: "high",
          details: "Diagnosis-aware suggestions, common medical phrases, context-based completions",
          howToUse: "Start typing clinical terms and select from auto-complete suggestions that appear."
        },
        {
          name: "Clinical Decision Support",
          icon: Stethoscope,
          description: "Real-time clinical analysis with drug interactions, risk detection, and evidence-based recommendations",
          timeSaved: "5-10 min/visit",
          impact: "critical",
          details: "Drug safety alerts, vital sign analysis, diagnosis-specific guidance",
          howToUse: "System automatically analyzes patient data and displays alerts and recommendations as you document."
        },
        {
          name: "Patient History AI Summary",
          icon: FileText,
          description: "AI automatically generates concise summary of patient's medical history, recent visits, and care plan status",
          timeSaved: "3-5 min prep",
          impact: "high",
          details: "Clinical trajectory, vital patterns, alerts, narrative introduction ready to paste",
          howToUse: "Select patient and AI summary appears automatically. Click 'Copy Narrative' to use in documentation."
        },
        {
          name: "Automated Task Generation",
          icon: ClipboardList,
          description: "AI identifies follow-up tasks from documentation and creates them automatically",
          timeSaved: "3-5 min/visit",
          impact: "high",
          details: "Extracts action items, assigns priorities, suggests due dates",
          howToUse: "After enhancing note, click 'Generate Tasks' to auto-create follow-up items."
        },
        {
          name: "Medicare Guidelines Integration",
          icon: BookOpen,
          description: "AI retrieves relevant Medicare guidelines and integrates them into compliance suggestions",
          timeSaved: "5-8 min/visit",
          impact: "high",
          details: "Real-time guideline retrieval, context-aware suggestions, CMS manual references",
          howToUse: "Guidelines automatically inform AI suggestions. Click guideline links in compliance issues for full details."
        }
      ]
    },
    {
      category: "OASIS Analyzer",
      icon: BarChart3,
      color: "indigo",
      items: [
        {
          name: "PDF Upload & Data Extraction",
          icon: FileCheck,
          description: "Upload OASIS PDFs and AI automatically extracts all data with intelligent patient matching",
          timeSaved: "20-30 min/OASIS",
          impact: "critical",
          details: "Fuzzy matching, confidence scoring, dispute resolution workflow",
          howToUse: "Upload OASIS PDF, AI extracts data and matches to patient, confirm or dispute match."
        },
        {
          name: "PDGM Revenue Analysis",
          icon: DollarSign,
          description: "Complete PDGM grouping analysis with payment calculation and optimization opportunities",
          timeSaved: "15-20 min/OASIS",
          impact: "critical",
          details: "Clinical group, functional level, comorbidity analysis, case-mix calculation",
          howToUse: "After OASIS upload, view automated PDGM analysis with payment breakdown and optimization tips."
        },
        {
          name: "Documentation Quality Scoring",
          icon: Target,
          description: "AI scores OASIS accuracy, completeness, and compliance with detailed issue identification",
          timeSaved: "10-15 min/OASIS",
          impact: "critical",
          details: "Accuracy score, completeness score, compliance flags, specific improvement suggestions",
          howToUse: "Review quality scores in analysis results, click issues for detailed explanations and fixes."
        },
        {
          name: "Revenue Optimization Recommendations",
          icon: TrendingUp,
          description: "Identify missed revenue opportunities with specific M-item corrections and PDGM impact analysis",
          timeSaved: "Increases reimbursement",
          impact: "critical",
          details: "Rescore opportunities, documentation gaps, projected payment increases",
          howToUse: "Review revenue tips section, implement suggested M-item changes, see projected payment impact."
        },
        {
          name: "Clinical Pathway Triggering",
          icon: Layers,
          description: "Automatically identifies relevant clinical pathways based on diagnosis and functional status",
          timeSaved: "5-10 min/admission",
          impact: "high",
          details: "Evidence-based documentation prompts, rescore opportunities, recommended tasks",
          howToUse: "System auto-identifies pathways, review documentation prompts and create recommended tasks."
        },
        {
          name: "Predictive Revenue Forecasting",
          icon: LineChart,
          description: "AI forecasts financial impact of documentation improvements with multiple scenarios",
          timeSaved: "Strategic planning",
          impact: "high",
          details: "Quick wins, comprehensive optimization, 12-month trajectory, breakeven analysis",
          howToUse: "View forecaster section for baseline vs optimized payment scenarios and implementation roadmap."
        }
      ]
    },
    {
      category: "Clinical Pathways",
      icon: Target,
      color: "cyan",
      items: [
        {
          name: "Diagnosis-Based Pathway Triggers",
          icon: Layers,
          description: "Automatic pathway activation based on diagnosis codes, keywords, and clinical conditions",
          timeSaved: "8-12 min/admission",
          impact: "critical",
          details: "Condition-specific assessments, documentation prompts, rescore opportunities",
          howToUse: "Pathways trigger automatically on patient admission based on diagnosis. Review and implement recommendations."
        },
        {
          name: "Documentation Prompts",
          icon: FileText,
          description: "Condition-specific prompts ensure comprehensive documentation of all relevant clinical factors",
          timeSaved: "5-8 min/visit",
          impact: "high",
          details: "M-item-specific guidance, priority flagging, evidence-based assessments",
          howToUse: "Review pathway documentation prompts during visits to ensure complete clinical capture."
        },
        {
          name: "Automated Task Creation",
          icon: CheckCircle2,
          description: "Generate pathway-specific tasks for care coordination, safety, and follow-up",
          timeSaved: "3-5 min/pathway",
          impact: "high",
          details: "Priority-based task assignment, due date recommendations, care team coordination",
          howToUse: "Click 'Create Tasks' from triggered pathway to auto-generate all recommended follow-up items."
        },
        {
          name: "Pathway Management",
          icon: BookOpen,
          description: "Admin interface to create, edit, and manage evidence-based clinical pathways",
          timeSaved: "Standardizes care",
          impact: "high",
          details: "Customizable triggers, documentation templates, rescore opportunity library",
          howToUse: "Admins: Navigate to Clinical Pathway Manager to create and customize pathways for your agency."
        }
      ]
    },
    {
      category: "Workflow & Notifications",
      icon: Sparkles,
      color: "teal",
      items: [
        {
          name: "Real-Time Notification Center",
          icon: Bell,
          description: "Centralized notification hub in header showing unread messages, active alerts, and pending tasks",
          timeSaved: "3-5 min/day",
          impact: "high",
          details: "Live notifications with quick access to messages, patient alerts, and assigned tasks. Auto-refreshes every minute",
          howToUse: "Click bell icon in header to view all notifications. Click any notification to navigate directly to relevant page."
        },
        {
          name: "My Workflow Dashboard",
          icon: Target,
          description: "Personalized nurse workflow with today's visits, pending tasks, and priority alerts",
          timeSaved: "5-10 min/day",
          impact: "critical",
          details: "Daily schedule, task list, patient alerts, training recommendations, all in one view",
          howToUse: "Start your day at My Workflow page to see priorities. Check off tasks as you complete them."
        },
        {
          name: "Smart Task Assignment",
          icon: ClipboardList,
          description: "AI automatically generates and assigns tasks based on documentation and patient needs",
          timeSaved: "3-5 min/visit",
          impact: "high",
          details: "Extracts action items from notes, assigns due dates, routes to appropriate team members",
          howToUse: "Tasks auto-generate after note enhancement. Review and assign in task management panel."
        }
      ]
    },
    {
      category: "Patient Alerts & Monitoring",
      icon: Bell,
      color: "orange",
      items: [
        {
          name: "Proactive Risk Detection",
          icon: Bell,
          description: "AI monitors patient data for deterioration patterns and generates predictive alerts",
          timeSaved: "Prevents hospitalizations",
          impact: "critical",
          details: "Vital trend analysis, clinical pattern recognition, risk scoring, recommended interventions",
          howToUse: "Review Patient Alerts dashboard daily. Click alerts for detailed risk analysis and action items."
        },
        {
          name: "Multi-Factor Risk Scoring",
          icon: Activity,
          description: "Comprehensive risk assessment based on vitals, functional status, medications, and comorbidities",
          timeSaved: "Early intervention",
          impact: "critical",
          details: "Fall risk, readmission risk, infection risk, medication risk, symptom escalation",
          howToUse: "System auto-calculates risk scores. Review contributing factors and recommended actions for high-risk patients."
        },
        {
          name: "Alert Workflow Management",
          icon: Target,
          description: "Assign, acknowledge, and track resolution of patient alerts with team coordination",
          timeSaved: "3-5 min/alert",
          impact: "high",
          details: "Assignment workflow, status tracking, resolution documentation, team notifications",
          howToUse: "Click alerts to assign to team members, document actions taken, mark as resolved."
        }
      ]
    },
    {
      category: "Training & Education",
      icon: GraduationCap,
      color: "green",
      items: [
        {
          name: "AI Personalized Training Engine",
          icon: Brain,
          description: "Advanced AI analyzes your documentation patterns and recommends specific training to improve quality and compliance",
          timeSaved: "Targeted improvement",
          impact: "critical",
          details: "Real-time deficit detection, personalized micro-lessons, scenario-based learning, competency tracking",
          howToUse: "System automatically analyzes your notes and recommends training. Complete micro-lessons in My Workflow."
        },
        {
          name: "Personalized Training Plans",
          icon: Target,
          description: "AI generates custom learning paths based on individual nurse performance and documentation gaps",
          timeSaved: "Targeted improvement",
          impact: "high",
          details: "Skill gap analysis, prioritized modules, progress tracking, micro-learning",
          howToUse: "Go to Training Hub, view your personalized learning path, complete recommended modules."
        },
        {
          name: "Interactive Scenarios",
          icon: Brain,
          description: "Practice with realistic patient cases and receive AI feedback on clinical decisions",
          timeSaved: "Builds competency",
          impact: "high",
          details: "Multiple scenario types, real-time feedback, performance scoring",
          howToUse: "Select a scenario from Training Hub, respond to clinical situations, review AI feedback."
        },
        {
          name: "Documentation Practice",
          icon: FileText,
          description: "Hands-on practice with documentation scenarios and instant AI quality feedback",
          timeSaved: "Improves quality",
          impact: "medium",
          details: "Real-world cases, compliance checking, quality scoring",
          howToUse: "Complete documentation practice scenarios to improve skills before real visits."
        },
        {
          name: "Training Recommendations",
          icon: Lightbulb,
          description: "Auto-assign training based on documentation review and compliance audit findings",
          timeSaved: "Proactive learning",
          impact: "high",
          details: "Triggered by errors, competency-based, tracks completion",
          howToUse: "System automatically recommends training when documentation gaps are identified."
        }
      ]
    },
    {
      category: "Compliance & Analytics",
      icon: Shield,
      color: "red",
      items: [
        {
          name: "Automated Compliance Auditing",
          icon: ShieldCheck,
          description: "AI audits all documentation against Medicare CoPs, state regulations, and agency policies",
          timeSaved: "15-20 min/audit",
          impact: "critical",
          details: "Rule-based checking, severity scoring, corrective action suggestions",
          howToUse: "Navigate to Compliance Dashboard to review audit results and address flagged issues."
        },
        {
          name: "User Activity Tracking",
          icon: Users,
          description: "Comprehensive logging of all user actions for audit trail and performance monitoring",
          timeSaved: "Regulatory compliance",
          impact: "critical",
          details: "HIPAA audit trail, login tracking, note enhancement stats, action-specific metrics",
          howToUse: "Admins: View User Activity Log for detailed action history and compliance reporting."
        },
        {
          name: "Regulatory Updates",
          icon: BookOpen,
          description: "AI monitors and alerts on CMS, Medicare, and state regulatory changes",
          timeSaved: "15-20 min/week",
          impact: "high",
          details: "Automated scanning, compliance impact analysis, training recommendations",
          howToUse: "Review Regulatory Compliance page for pending updates and required actions."
        },
        {
          name: "Performance Analytics",
          icon: BarChart3,
          description: "Comprehensive dashboards for nurse performance, documentation quality, and outcomes",
          timeSaved: "Strategic insight",
          impact: "high",
          details: "Quality metrics, time savings, compliance rates, trend analysis",
          howToUse: "Admins: Access Analytics Dashboard for agency-wide performance insights and reporting."
        }
      ]
    },
    {
      category: "Patient & Care Management",
      icon: Heart,
      color: "pink",
      items: [
        {
          name: "Care Plan Auto-Generation",
          icon: Target,
          description: "AI generates evidence-based care plans based on diagnosis and patient data",
          timeSaved: "8-12 min/admission",
          impact: "critical",
          details: "Problem, goal, intervention generation, measurable outcomes, evidence-based",
          howToUse: "Navigate to patient, click 'Generate Care Plan', review and create suggested plans."
        },
        {
          name: "Automatic Care Plan Triggers",
          icon: Layers,
          description: "Admin-configured automatic care plan creation based on diagnosis or medication",
          timeSaved: "8-12 min/admission",
          impact: "critical",
          details: "Standardized evidence-based care, ensures consistency across agency",
          howToUse: "Admins: Configure triggers in Automatic Care Plans. Staff: Plans auto-generate on admission."
        },
        {
          name: "Incident Reporting",
          icon: AlertTriangle,
          description: "Guided incident reporting with AI-generated comprehensive reports",
          timeSaved: "8-12 min/incident",
          impact: "critical",
          details: "Fall, hospitalization, med error templates, automatic notifications",
          howToUse: "Click incident type button, complete guided form, AI generates detailed report."
        },
        {
          name: "Patient History Summarization",
          icon: FileText,
          description: "AI generates concise summaries of patient history and recent activity",
          timeSaved: "3-5 min prep",
          impact: "high",
          details: "Recent visits, active problems, medications, care plan status",
          howToUse: "View patient context card in Smart Note Assistant for auto-generated summary."
        }
      ]
    }
  ];

  const generateFeaturesPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const _featuresList = features.map(cat => ({
        category: cat.category,
        items: cat.items.map(f => ({
          name: f.name,
          description: f.description,
          timeSaved: f.timeSaved,
          impact: f.impact,
          howToUse: f.howToUse,
          details: f.details
        }))
      }));

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Penn Sync Features Guide</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; color: #333; line-height: 1.6; }
    h1 { color: #264491; text-align: center; border-bottom: 3px solid #264491; padding-bottom: 10px; }
    .logo-header { text-align: center; margin-bottom: 20px; }
    .logo-header img { width: 100px; height: 100px; margin-bottom: 10px; }
    h2 { color: #264491; margin-top: 30px; border-left: 4px solid #264491; padding-left: 10px; }
    h3 { color: #1F2937; margin-top: 20px; }
    .feature { background: #F9FAFB; border-radius: 8px; padding: 15px; margin: 15px 0; border: 1px solid #E5E7EB; page-break-inside: avoid; }
    .feature-name { font-weight: bold; font-size: 16px; color: #1F2937; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px; }
    .critical { background: #FEE2E2; color: #DC2626; }
    .high { background: #FED7AA; color: #EA580C; }
    .medium { background: #DBEAFE; color: #264491; }
    .time-saved { color: #059669; font-weight: bold; }
    .how-to { background: #EFF6FF; padding: 10px; border-radius: 6px; margin-top: 10px; font-size: 13px; }
    .section { page-break-inside: avoid; }
    .toc { background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .toc-item { margin: 5px 0; }
    .header-info { text-align: center; color: #6B7280; margin-bottom: 30px; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #E5E7EB; color: #6B7280; }
    .impact-summary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; margin: 30px 0; text-align: center; }
    .impact-stat { display: inline-block; margin: 15px 20px; }
    .impact-stat-value { font-size: 32px; font-weight: bold; }
    .impact-stat-label { font-size: 14px; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="logo-header">
    <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png" alt="Penn Sync Logo" />
  </div>
  <h1>Penn Sync Features Guide</h1>
  <p class="header-info">AI-Powered Home Health Documentation & OASIS Analytics<br>Generated: ${new Date().toLocaleDateString()}</p>
  
  <div class="impact-summary">
    <h2 style="color: white; margin-top: 0;">The Penn Sync Impact</h2>
    <p style="opacity: 0.95; font-size: 16px; margin-bottom: 20px;">Revolutionizing home health documentation with AI-powered efficiency</p>
    <div class="impact-stat">
      <div class="impact-stat-value">20+</div>
      <div class="impact-stat-label">Minutes Saved Per Visit</div>
    </div>
    <div class="impact-stat">
      <div class="impact-stat-value">8+</div>
      <div class="impact-stat-label">Hours Saved Per Week</div>
    </div>
    <div class="impact-stat">
      <div class="impact-stat-value">100%</div>
      <div class="impact-stat-label">Medicare Compliant</div>
    </div>
  </div>

  <div class="toc">
    <h3>📑 Table of Contents</h3>
    ${features.map((cat, idx) => `<div class="toc-item">${idx + 1}. ${cat.category} (${cat.items.length} features)</div>`).join('')}
  </div>

  ${features.map((category, catIdx) => `
    <div class="section">
      <h2>${catIdx + 1}. ${category.category}</h2>
      ${category.items.map((feature, idx) => `
        <div class="feature">
          <div class="feature-name">
            ${catIdx + 1}.${idx + 1} ${feature.name}
            <span class="badge ${feature.impact}">${feature.impact.toUpperCase()}</span>
          </div>
          <p>${feature.description}</p>
          <p class="time-saved">⏱️ Time Saved: ${feature.timeSaved}</p>
          <p><strong>Details:</strong> ${feature.details}</p>
          <div class="how-to">
            <strong>📋 How to Use:</strong><br>
            ${feature.howToUse}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('')}

  <div class="footer">
    <p><strong>© Penn Sync - AI-Powered Home Health Documentation</strong></p>
    <p>For support, contact your administrator</p>
    <p style="font-size: 12px; margin-top: 10px;">This guide reflects the current system capabilities as of ${new Date().toLocaleDateString()}</p>
  </div>
</body>
</html>`;

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Please allow pop-ups to generate the guide.');
        setIsGeneratingPDF(false);
        return;
      }
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };

    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Error generating guide. Please try again.');
    }
    setIsGeneratingPDF(false);
  };

  const generateUserManual = async () => {
    setIsGeneratingManual(true);
    try {
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Penn Sync User Manual</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; color: #333; line-height: 1.6; }
    h1 { color: #264491; text-align: center; border-bottom: 3px solid #264491; padding-bottom: 10px; page-break-after: avoid; }
    .logo-header { text-align: center; margin-bottom: 20px; page-break-inside: avoid; }
    .logo-header img { width: 100px; height: 100px; margin-bottom: 10px; }
    h2 { color: #264491; margin-top: 30px; border-left: 4px solid #264491; padding-left: 10px; page-break-after: avoid; }
    h3 { color: #1F2937; margin-top: 20px; page-break-after: avoid; }
    h4 { color: #4B5563; margin-top: 15px; }
    .section { page-break-inside: avoid; margin-bottom: 30px; }
    .step { background: #F9FAFB; border-left: 4px solid #3557b0; padding: 15px; margin: 10px 0; border-radius: 4px; }
    .step-number { display: inline-block; background: #3557b0; color: white; width: 24px; height: 24px; border-radius: 50%; text-align: center; line-height: 24px; font-weight: bold; margin-right: 8px; }
    .tip { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px; margin: 10px 0; border-radius: 4px; }
    .tip-icon { color: #F59E0B; font-weight: bold; }
    .warning { background: #FEE2E2; border-left: 4px solid #DC2626; padding: 12px; margin: 10px 0; border-radius: 4px; }
    .warning-icon { color: #DC2626; font-weight: bold; }
    .toc { background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; page-break-inside: avoid; }
    .toc-item { margin: 5px 0; padding-left: 20px; }
    .toc-section { font-weight: bold; margin-top: 15px; margin-bottom: 5px; color: #1F2937; }
    .header-info { text-align: center; color: #6B7280; margin-bottom: 30px; }
    .role-badge { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; margin-right: 8px; }
    .nurse-badge { background: #DBEAFE; color: #1E40AF; }
    .admin-badge { background: #FEE2E2; color: #991B1B; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #E5E7EB; color: #6B7280; page-break-before: always; }
    .quick-ref { background: #EFF6FF; padding: 15px; border-radius: 8px; margin: 20px 0; page-break-inside: avoid; }
    .quick-ref-title { font-weight: bold; color: #1E40AF; margin-bottom: 10px; }
    .screenshot-note { font-style: italic; color: #6B7280; font-size: 12px; margin-top: 5px; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <div class="logo-header">
    <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png" alt="Penn Sync Logo" />
  </div>
  <h1>Penn Sync User Manual</h1>
  <p class="header-info">Complete Guide for Nurses and Administrators<br>Generated: ${new Date().toLocaleDateString()}</p>
  
  <div class="toc">
    <h3>📑 Table of Contents</h3>
    
    <div class="toc-section">Part 1: Nurse User Guide</div>
    <div class="toc-item">1. Getting Started</div>
    <div class="toc-item">2. Smart Note Assistant</div>
    <div class="toc-item">3. OASIS Documentation</div>
    <div class="toc-item">4. Patient Care Management</div>
    <div class="toc-item">5. Incident Reporting</div>
    <div class="toc-item">6. Training & Development</div>
    
    <div class="toc-section">Part 2: Administrator User Guide</div>
    <div class="toc-item">7. System Administration</div>
    <div class="toc-item">8. Clinical Pathway Management</div>
    <div class="toc-item">9. Compliance & Monitoring</div>
    <div class="toc-item">10. Analytics & Reporting</div>
    <div class="toc-item">11. User Management</div>
  </div>

  <!-- PART 1: NURSE GUIDE -->
  <div class="page-break"></div>
  <h1 style="background: #DBEAFE; padding: 20px; border-radius: 8px;">Part 1: Nurse User Guide</h1>
  <p style="font-size: 16px; color: #1E40AF; font-weight: bold;">This section covers all features available to nurses for daily documentation and patient care.</p>

  <div class="section">
    <h2>1. Getting Started</h2>
    
    <h3>1.1 Logging In</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to the Penn Sync login page
    </div>
    <div class="step">
      <span class="step-number">2</span>Enter your email address and password
    </div>
    <div class="step">
      <span class="step-number">3</span>Click "Sign In"
    </div>
    <div class="tip">
      <span class="tip-icon">💡 TIP:</span> Your login activity is automatically tracked for security and compliance purposes. You'll see a timestamp of your last login on the dashboard.
    </div>

    <h3>1.2 Dashboard Overview</h3>
    <p>After logging in, you'll see the main dashboard with:</p>
    <ul>
      <li><strong>Navigation Menu:</strong> Access all features from the left sidebar</li>
      <li><strong>Patient Alerts:</strong> Critical patient issues requiring immediate attention</li>
      <li><strong>Today's Schedule:</strong> Your assigned visits for the day</li>
      <li><strong>Pending Tasks:</strong> Follow-up items and care plan tasks</li>
    </ul>
  </div>

  <div class="section">
    <h2>2. Smart Note Assistant</h2>
    <p><span class="role-badge nurse-badge">NURSE</span>Your primary tool for visit documentation</p>

    <h3>2.1 Starting a New Note</h3>
    <div class="step">
      <span class="step-number">1</span>Click <strong>"Smart Notes"</strong> in the left navigation menu
    </div>
    <div class="step">
      <span class="step-number">2</span>Select the patient from the dropdown or search by name
    </div>
    <div class="step">
      <span class="step-number">3</span>Click <strong>"Start New Note"</strong>
    </div>
    <div class="step">
      <span class="step-number">4</span>Select visit type (Skilled Nursing, Admission, Recertification, etc.)
    </div>

    <h3>2.2 Using Voice Dictation</h3>
    <div class="step">
      <span class="step-number">1</span>Click the microphone icon in the rough notes section
    </div>
    <div class="step">
      <span class="step-number">2</span>Speak naturally - describe what you observed during the visit
    </div>
    <div class="step">
      <span class="step-number">3</span>AI will transcribe your speech in real-time
    </div>
    <div class="step">
      <span class="step-number">4</span>Click the microphone again to stop recording
    </div>
    <div class="tip">
      <span class="tip-icon">💡 TIP:</span> Speak clearly and use medical terminology naturally. The AI understands clinical language and will format it properly.
    </div>

    <h3>2.3 Voice Vitals Entry</h3>
    <div class="step">
      <span class="step-number">1</span>Click the vitals microphone icon in the vitals section
    </div>
    <div class="step">
      <span class="step-number">2</span>Say vital signs naturally: "Blood pressure 120 over 80"
    </div>
    <div class="step">
      <span class="step-number">3</span>AI automatically fills the corresponding fields
    </div>
    <div class="step">
      <span class="step-number">4</span>Verify all values are correct
    </div>
    <p class="screenshot-note">Example phrases: "heart rate 72", "temperature ninety-eight point six", "oxygen saturation 96 on room air"</p>

    <h3>2.4 Enhancing Notes with AI</h3>
    <div class="step">
      <span class="step-number">1</span>After completing your rough note (typed or dictated), review the content
    </div>
    <div class="step">
      <span class="step-number">2</span>Click the <strong>"Enhance with AI"</strong> button
    </div>
    <div class="step">
      <span class="step-number">3</span>AI will transform your rough note into a polished, Medicare-compliant narrative
    </div>
    <div class="step">
      <span class="step-number">4</span>Review the enhanced note in the preview panel
    </div>
    <div class="step">
      <span class="step-number">5</span>Make any necessary edits
    </div>
    <div class="warning">
      <span class="warning-icon">⚠️ IMPORTANT:</span> Always review AI-enhanced content for accuracy. You are responsible for the final documentation.
    </div>

    <h3>2.5 Using AI Suggestions (Compliance + Quality)</h3>
    <p>NEW! The system now provides unified suggestions for both compliance and quality in one panel.</p>
    <div class="step">
      <span class="step-number">1</span>As you type, AI analyzes your note automatically
    </div>
    <div class="step">
      <span class="step-number">2</span>View the "AI Suggestions" card that shows compliance gaps and quality improvements
    </div>
    <div class="step">
      <span class="step-number">3</span>Click tabs to filter by: All, Compliance, or Quality
    </div>
    <div class="step">
      <span class="step-number">4</span>Click <strong>"Fix All"</strong> to apply all suggestions at once (both compliance additions and quality replacements)
    </div>
    <div class="step">
      <span class="step-number">5</span>Or click individual <strong>"+"</strong> buttons to apply suggestions one at a time
    </div>
    <div class="tip">
      <span class="tip-icon">💡 TIP:</span> The unified panel combines compliance checking and quality improvements, reducing clutter and making it easier to enhance your documentation. Aim for 85%+ overall score before enhancing.</div>

    <h3>2.6 Copying to EHR</h3>
    <div class="step">
      <span class="step-number">1</span>Once your note reaches 85%+ compliance, it's ready to copy
    </div>
    <div class="step">
      <span class="step-number">2</span>Click <strong>"Copy to EHR"</strong> button
    </div>
    <div class="step">
      <span class="step-number">3</span>Note is copied to your clipboard
    </div>
    <div class="step">
      <span class="step-number">4</span>Paste into your agency's EHR system
    </div>
  </div>

  <div class="section">
    <h2>3. OASIS Documentation</h2>
    <p><span class="role-badge nurse-badge">NURSE</span>For SOC, ROC, and Discharge OASIS assessments</p>

    <h3>3.1 Uploading OASIS PDF</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"OASIS Analyzer"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Click <strong>"Upload OASIS PDF"</strong>
    </div>
    <div class="step">
      <span class="step-number">3</span>Select your completed OASIS PDF file
    </div>
    <div class="step">
      <span class="step-number">4</span>AI extracts all data and matches to patient
    </div>
    <div class="step">
      <span class="step-number">5</span>Confirm or dispute the patient match
    </div>

    <h3>3.2 Reviewing PDGM Analysis</h3>
    <div class="step">
      <span class="step-number">1</span>After upload, view the automated PDGM analysis
    </div>
    <div class="step">
      <span class="step-number">2</span>Review clinical grouping, functional level, and comorbidity adjustments
    </div>
    <div class="step">
      <span class="step-number">3</span>Check projected payment amount
    </div>
    <div class="step">
      <span class="step-number">4</span>Review flagged documentation issues
    </div>

    <h3>3.3 Revenue Optimization Tips</h3>
    <div class="step">
      <span class="step-number">1</span>Scroll to "Revenue Optimization Opportunities"
    </div>
    <div class="step">
      <span class="step-number">2</span>Review suggested M-item changes
    </div>
    <div class="step">
      <span class="step-number">3</span>Each tip shows potential payment increase
    </div>
    <div class="step">
      <span class="step-number">4</span>Implement clinically appropriate suggestions
    </div>
    <div class="warning">
      <span class="warning-icon">⚠️ IMPORTANT:</span> Only implement suggestions that accurately reflect the patient's clinical condition. Never inflate scores.
    </div>
  </div>

  <div class="section">
    <h2>4. Patient Care Management</h2>
    <p><span class="role-badge nurse-badge">NURSE</span>Managing patient records, care plans, and tasks</p>

    <h3>4.1 Viewing Patient Records</h3>
    <div class="step">
      <span class="step-number">1</span>Click <strong>"Patients"</strong> in the navigation menu
    </div>
    <div class="step">
      <span class="step-number">2</span>Search or browse patient list
    </div>
    <div class="step">
      <span class="step-number">3</span>Click patient name to view details
    </div>

    <h3>4.2 Care Plan Management</h3>
    <div class="step">
      <span class="step-number">1</span>On patient details page, scroll to <strong>"Care Plans"</strong> section
    </div>
    <div class="step">
      <span class="step-number">2</span>View active care plans with goals and interventions
    </div>
    <div class="step">
      <span class="step-number">3</span>Click <strong>"Update Progress"</strong> to document goal achievement
    </div>
    <div class="step">
      <span class="step-number">4</span>Mark goals as "Met", "In Progress", or "Not Met"
    </div>

    <h3>4.3 Task Management</h3>
    <div class="step">
      <span class="step-number">1</span>View your assigned tasks on the Dashboard
    </div>
    <div class="step">
      <span class="step-number">2</span>Click a task to view details
    </div>
    <div class="step">
      <span class="step-number">3</span>Complete the required action
    </div>
    <div class="step">
      <span class="step-number">4</span>Click <strong>"Mark Complete"</strong> and add completion notes
    </div>
  </div>

  <div class="section">
    <h2>5. Incident Reporting</h2>
    <p><span class="role-badge nurse-badge">NURSE</span>Quick reporting for falls, hospitalizations, and medication errors</p>

    <h3>5.1 Reporting an Incident</h3>
    <div class="step">
      <span class="step-number">1</span>During visit documentation, click the incident type button (Fall, Hospitalization, Med Error)
    </div>
    <div class="step">
      <span class="step-number">2</span>Complete the guided incident form with all required details
    </div>
    <div class="step">
      <span class="step-number">3</span>AI generates a comprehensive incident report
    </div>
    <div class="step">
      <span class="step-number">4</span>Review and click <strong>"Submit Report"</strong>
    </div>
    <div class="step">
      <span class="step-number">5</span>Appropriate notifications are sent automatically
    </div>
    <div class="tip">
      <span class="tip-icon">💡 TIP:</span> Report incidents as soon as possible. The system tracks reporting time for compliance.
    </div>
  </div>

  <div class="section">
    <h2>6. Training & Development</h2>
    <p><span class="role-badge nurse-badge">NURSE</span>Personalized learning and skill development</p>

    <h3>6.1 Viewing Your Learning Path</h3>
    <div class="step">
      <span class="step-number">1</span>Click <strong>"Training Hub"</strong> in navigation
    </div>
    <div class="step">
      <span class="step-number">2</span>View your personalized learning path
    </div>
    <div class="step">
      <span class="step-number">3</span>Complete recommended modules in order
    </div>

    <h3>6.2 Completing Training Scenarios</h3>
    <div class="step">
      <span class="step-number">1</span>Select a scenario from the Training Hub
    </div>
    <div class="step">
      <span class="step-number">2</span>Read the patient case
    </div>
    <div class="step">
      <span class="step-number">3</span>Respond to each clinical question
    </div>
    <div class="step">
      <span class="step-number">4</span>Receive AI feedback on your responses
    </div>
    <div class="step">
      <span class="step-number">5</span>Review learning points and best practices
    </div>
  </div>

  <!-- PART 2: ADMIN GUIDE -->
  <div class="page-break"></div>
  <h1 style="background: #FEE2E2; padding: 20px; border-radius: 8px;">Part 2: Administrator User Guide</h1>
  <p style="font-size: 16px; color: #991B1B; font-weight: bold;">This section covers administrative features for system configuration, monitoring, and reporting.</p>

  <div class="section">
    <h2>7. System Administration</h2>
    <p><span class="role-badge admin-badge">ADMIN</span>Overall system management and configuration</p>

    <h3>7.1 Accessing Admin Dashboard</h3>
    <div class="step">
      <span class="step-number">1</span>Click <strong>"Admin Dashboard"</strong> in the navigation menu (admin users only)
    </div>
    <div class="step">
      <span class="step-number">2</span>View system-wide statistics and recent activity
    </div>

    <h3>7.2 Agency Settings Configuration</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"Agency Settings"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Configure agency information:
      <ul>
        <li>Agency name and contact information</li>
        <li>Average episodes per year (for PDGM forecasting)</li>
        <li>Wage index (for payment calculations)</li>
        <li>Default visit types and care types</li>
      </ul>
    </div>
    <div class="step">
      <span class="step-number">3</span>Click <strong>"Save Settings"</strong>
    </div>
  </div>

  <div class="section">
    <h2>8. Clinical Pathway Management</h2>
    <p><span class="role-badge admin-badge">ADMIN</span>Create and manage evidence-based clinical pathways</p>

    <h3>8.1 Creating a New Pathway</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"Clinical Pathway Manager"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Click <strong>"Create New Pathway"</strong>
    </div>
    <div class="step">
      <span class="step-number">3</span>Enter pathway details:
      <ul>
        <li>Pathway name (e.g., "CHF Management Protocol")</li>
        <li>Description</li>
        <li>Priority level (Critical, High, Medium, Low)</li>
      </ul>
    </div>
    <div class="step">
      <span class="step-number">4</span>Configure trigger conditions:
      <ul>
        <li>Diagnosis codes or keywords</li>
        <li>Functional score thresholds</li>
        <li>Comorbidity presence</li>
      </ul>
    </div>
    <div class="step">
      <span class="step-number">5</span>Add documentation prompts with affected M-items
    </div>
    <div class="step">
      <span class="step-number">6</span>Configure rescore opportunities
    </div>
    <div class="step">
      <span class="step-number">7</span>Add recommended tasks
    </div>
    <div class="step">
      <span class="step-number">8</span>Click <strong>"Save Pathway"</strong>
    </div>

    <h3>8.2 Managing Existing Pathways</h3>
    <div class="step">
      <span class="step-number">1</span>View all pathways in the Clinical Pathway Manager
    </div>
    <div class="step">
      <span class="step-number">2</span>Click <strong>"Edit"</strong> to modify a pathway
    </div>
    <div class="step">
      <span class="step-number">3</span>Click <strong>"Duplicate"</strong> to create a similar pathway
    </div>
    <div class="step">
      <span class="step-number">4</span>Toggle <strong>"Active"</strong> status to enable/disable pathways
    </div>
  </div>

  <div class="section">
    <h2>9. Compliance & Monitoring</h2>
    <p><span class="role-badge admin-badge">ADMIN</span>Monitor compliance and audit documentation quality</p>

    <h3>9.1 Reviewing User Activity</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"User Activity Log"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Review login activity, note enhancements, and system usage
    </div>
    <div class="step">
      <span class="step-number">3</span>Use filters to focus on specific users, actions, or date ranges
    </div>
    <div class="step">
      <span class="step-number">4</span>Export activity logs for audits
    </div>

    <h3>9.2 Compliance Auditing</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"Compliance Dashboard"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Review compliance audit results by nurse
    </div>
    <div class="step">
      <span class="step-number">3</span>Click individual audits to see detailed findings
    </div>
    <div class="step">
      <span class="step-number">4</span>Assign training to nurses with low compliance scores
    </div>

    <h3>9.3 OASIS Auditing</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"OASIS Audit Dashboard"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Review all uploaded OASIS assessments
    </div>
    <div class="step">
      <span class="step-number">3</span>Filter by nurse, quality score, or date range
    </div>
    <div class="step">
      <span class="step-number">4</span>Click assessments to review detailed analysis
    </div>
    <div class="step">
      <span class="step-number">5</span>Mark assessments for detailed audit review
    </div>
  </div>

  <div class="section">
    <h2>10. Analytics & Reporting</h2>
    <p><span class="role-badge admin-badge">ADMIN</span>System-wide analytics and performance metrics</p>

    <h3>10.1 Analytics Dashboard</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"Analytics Dashboard"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>View key metrics:
      <ul>
        <li>Total notes enhanced</li>
        <li>Average time savings per visit</li>
        <li>Compliance score trends</li>
        <li>OASIS quality metrics</li>
      </ul>
    </div>
    <div class="step">
      <span class="step-number">3</span>Use date range filters to analyze trends
    </div>
    <div class="step">
      <span class="step-number">4</span>Export reports for leadership
    </div>

    <h3>10.2 Nurse Performance Dashboard</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to <strong>"Nurse Performance Dashboard"</strong>
    </div>
    <div class="step">
      <span class="step-number">2</span>Review individual nurse metrics
    </div>
    <div class="step">
      <span class="step-number">3</span>Identify top performers and training needs
    </div>
    <div class="step">
      <span class="step-number">4</span>Track improvement over time
    </div>
  </div>

  <div class="section">
    <h2>11. User Management</h2>
    <p><span class="role-badge admin-badge">ADMIN</span>Managing staff access and permissions</p>

    <h3>11.1 Inviting New Users</h3>
    <div class="step">
      <span class="step-number">1</span>Users must be invited through the Base44 platform
    </div>
    <div class="step">
      <span class="step-number">2</span>Contact your system administrator to invite new nurses
    </div>
    <div class="step">
      <span class="step-number">3</span>Users receive an email invitation
    </div>
    <div class="step">
      <span class="step-number">4</span>Upon signup, users appear in your agency automatically
    </div>

    <h3>11.2 Managing User Roles</h3>
    <div class="step">
      <span class="step-number">1</span>Navigate to Admin Dashboard
    </div>
    <div class="step">
      <span class="step-number">2</span>View user list with current roles
    </div>
    <div class="step">
      <span class="step-number">3</span>Contact Base44 support to modify user roles (admin vs user)
    </div>
  </div>

  <!-- QUICK REFERENCE SECTION -->
  <div class="page-break"></div>
  <h2>Quick Reference Guide</h2>

  <div class="quick-ref">
    <div class="quick-ref-title">🎤 Voice Commands for Nurses</div>
    <p><strong>"Insert cardiovascular"</strong> - Adds cardiovascular assessment section</p>
    <p><strong>"Insert respiratory"</strong> - Adds respiratory assessment section</p>
    <p><strong>"Add homebound status"</strong> - Adds homebound justification</p>
    <p><strong>"Add skilled need"</strong> - Adds skilled nursing necessity documentation</p>
    <p><strong>"Save documentation"</strong> - Saves current note</p>
  </div>

  <div class="quick-ref">
    <div class="quick-ref-title">⌨️ Text Expanders</div>
    <p><strong>wnl</strong> → within normal limits</p>
    <p><strong>nka</strong> → no known allergies</p>
    <p><strong>sob</strong> → shortness of breath</p>
    <p><strong>adl</strong> → activities of daily living</p>
    <p><strong>pt</strong> → patient</p>
  </div>

  <div class="quick-ref">
    <div class="quick-ref-title">📊 Compliance Score Guidelines</div>
    <p><strong>85-100%</strong> - Ready to copy to EHR (green)</p>
    <p><strong>70-84%</strong> - Review and add suggested fixes (yellow)</p>
    <p><strong>Below 70%</strong> - Needs significant improvement (red)</p>
  </div>

  <div class="quick-ref">
    <div class="quick-ref-title">🚨 When to Contact Support</div>
    <p>• System not responding or errors</p>
    <p>• Cannot access patient records</p>
    <p>• AI enhancement producing inaccurate results</p>
    <p>• OASIS upload failing</p>
    <p>• Questions about features or functionality</p>
  </div>

  <div class="footer">
    <h3>Need Help?</h3>
    <p><strong>Technical Support:</strong> Contact your system administrator</p>
    <p><strong>Training Questions:</strong> Reach out to your clinical supervisor</p>
    <p><strong>Feature Requests:</strong> Submit through your administrator</p>
    <br>
    <p style="font-size: 12px;">© Penn Sync - AI-Powered Home Health Documentation</p>
    <p style="font-size: 12px;">User Manual Version 1.0 - ${new Date().toLocaleDateString()}</p>
  </div>
</body>
</html>`;

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Please allow pop-ups to generate the manual.');
        setIsGeneratingManual(false);
        return;
      }
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };

    } catch (error) {
      console.error('Error generating user manual:', error);
      toast.error('Error generating manual. Please try again.');
    }
    setIsGeneratingManual(false);
  };

  // Realistic time savings calculation based on 20 min per note + other features
  const totalTimeSavedPerVisit = 20; // AI note enhancement + voice dictation + other features
  const visitsPerWeek = 25; // Average for a full-time home health nurse
  const weeksPerMonth = 4;
  const monthsPerYear = 12;
  
  const totalTimeSavedPerWeek = totalTimeSavedPerVisit * visitsPerWeek; // 500 min = ~8.3 hours
  const totalTimeSavedPerMonth = totalTimeSavedPerWeek * weeksPerMonth; // 2000 min = ~33 hours
  const totalTimeSavedPerYear = totalTimeSavedPerMonth * monthsPerYear; // 24000 min = 400 hours

  const filteredFeatures = selectedCategory === "all" 
    ? features 
    : features.filter(cat => cat.category.toLowerCase().includes(selectedCategory.toLowerCase()));

  // Soft, ringed icon-chip tints (the same premium chip language as StatCard),
  // keyed by the category's named color.
  const getCategoryColor = (color) => {
    const colors = {
      purple: "bg-violet-50 text-violet-700 ring-violet-100",
      blue: "bg-navy-50 text-navy-700 ring-navy-100",
      indigo: "bg-navy-50 text-navy-700 ring-navy-100",
      green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      cyan: "bg-sky-50 text-sky-700 ring-sky-100",
      orange: "bg-amber-50 text-amber-700 ring-amber-100",
      red: "bg-rose-50 text-rose-700 ring-rose-100",
      pink: "bg-gold-100 text-gold-700 ring-gold-200",
      gray: "bg-slate-100 text-slate-600 ring-slate-200"
    };
    return colors[color] || "bg-slate-100 text-slate-600 ring-slate-200";
  };

  const getImpactBadge = (impact) => {
    const styles = {
      critical: "destructive",
      high: "warning",
      medium: "info",
      low: "secondary"
    };
    return styles[impact] || "info";
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Zap}
        eyebrow="PennSync"
        title="Penn Sync Features"
        description="AI-powered home health documentation, OASIS analytics, and clinical decision support"
        favoritePage="Features"
        actions={
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
            <Button
              onClick={generateFeaturesPDF}
              disabled={isGeneratingPDF}
              className="min-h-[44px] w-full sm:w-auto"
            >
              {isGeneratingPDF ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Download className="w-4 h-4 mr-2" /> Features Guide</>
              )}
            </Button>

            <Button
              onClick={generateUserManual}
              disabled={isGeneratingManual}
              variant="outline"
              className="min-h-[44px] w-full sm:w-auto"
            >
              {isGeneratingManual ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><BookOpen className="w-4 h-4 mr-2" /> User Manual</>
              )}
            </Button>
          </div>
        }
      />
        
        {/* Time Saved Hero Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-4xl mx-auto mb-4 sm:mb-6 md:mb-8">
          <Card>
            <CardContent className="p-3 sm:p-4 md:p-6 text-center">
              <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-navy-600 mx-auto mb-1 sm:mb-2" />
              <p className="text-2xl sm:text-3xl font-bold text-slate-900">{totalTimeSavedPerVisit}</p>
              <p className="text-xs sm:text-sm text-slate-600">min saved per visit</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-3 sm:p-4 md:p-6 text-center">
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 mx-auto mb-1 sm:mb-2" />
              <p className="text-2xl sm:text-3xl font-bold text-slate-900">{Math.round(totalTimeSavedPerWeek / 60)}</p>
              <p className="text-xs sm:text-sm text-slate-600">hours saved per week</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-3 sm:p-4 md:p-6 text-center">
              <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-navy-600 mx-auto mb-1 sm:mb-2" />
              <p className="text-2xl sm:text-3xl font-bold text-slate-900">{Math.round(totalTimeSavedPerMonth / 60)}</p>
              <p className="text-xs sm:text-sm text-slate-600">hours saved per month</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-3 sm:p-4 md:p-6 text-center">
              <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-gold-600 mx-auto mb-1 sm:mb-2" />
              <p className="text-2xl sm:text-3xl font-bold text-slate-900">{Math.round(totalTimeSavedPerYear / 60 / 24)}</p>
              <p className="text-xs sm:text-sm text-slate-600">days saved per year</p>
            </CardContent>
          </Card>
        </div>

      {/* Category Filter */}
      <div className="mb-4 sm:mb-6 md:mb-8">
        <div className="flex flex-wrap gap-2 justify-center">
          <Button
            variant={selectedCategory === "all" ? "default" : "outline"}
            onClick={() => setSelectedCategory("all")}
            className="gap-2 min-h-[44px]"
          >
            All Features
          </Button>
          {features.map((category) => (
            <Button
              key={category.category}
              variant={selectedCategory === category.category.toLowerCase() ? "default" : "outline"}
              onClick={() => setSelectedCategory(category.category.toLowerCase())}
              className="gap-2 min-h-[44px]"
            >
              <category.icon className="w-4 h-4" />
              <span className="text-xs sm:text-sm">{category.category}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Features Grid */}
      <div className="space-y-6 sm:space-y-8">
        {filteredFeatures.map((category) => {
          const CategoryIcon = category.icon;
          return (
            <div key={category.category}>
              <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                <div className={`w-10 h-10 sm:w-12 sm:h-12 ${getCategoryColor(category.color)} ring-1 ring-inset rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <CategoryIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{category.category}</h2>
                  <p className="text-xs sm:text-sm text-slate-600">{category.items.length} feature{category.items.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {category.items.map((feature) => {
                  const FeatureIcon = feature.icon;
                  return (
                    <Card key={feature.name} className="hover:shadow-lg transition-all duration-200">
                      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-100 ring-1 ring-inset ring-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FeatureIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700" />
                          </div>
                          <div className="flex gap-1">
                            <Badge variant={getImpactBadge(feature.impact)} className="text-xs capitalize">
                              {feature.impact}
                            </Badge>
                          </div>
                        </div>
                        <CardTitle className="text-base sm:text-lg">{feature.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 sm:p-4 md:p-6 pt-0 space-y-2 sm:space-y-3">
                        <p className="text-sm text-slate-600">{feature.description}</p>
                        
                        <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-200">
                          <Clock className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-semibold text-emerald-900">
                            Saves: {feature.timeSaved}
                          </span>
                        </div>
                        
                        <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
                          <p className="text-xs font-semibold text-blue-800 mb-1">How to Use:</p>
                          <p className="text-xs text-blue-700">{feature.howToUse}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Impact Summary */}
      <div className="mt-6 sm:mt-8 md:mt-12 rounded-xl bg-navy-900 text-white p-4 sm:p-6 md:p-8">
          <div className="text-center">
            <Sparkles className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-white opacity-90" />
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 sm:mb-3">The Penn Sync Impact</h2>
            <p className="text-base sm:text-lg md:text-xl text-navy-100 mb-4 sm:mb-6">
              Save over <strong>{Math.round(totalTimeSavedPerYear / 60)} hours per year</strong> per nurse
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 md:gap-6 max-w-3xl mx-auto">
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 sm:p-4">
                <Heart className="w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2 text-gold-200" />
                <p className="font-semibold text-sm sm:text-base md:text-lg">More Patient Time</p>
                <p className="text-xs sm:text-sm text-navy-100">Less paperwork, more care</p>
              </div>
              
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 sm:p-4">
                <Shield className="w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2 text-emerald-200" />
                <p className="font-semibold text-sm sm:text-base md:text-lg">100% Compliant</p>
                <p className="text-xs sm:text-sm text-navy-100">Medicare requirements guaranteed</p>
              </div>
              
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 sm:p-4">
                <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2 text-orange-200" />
                <p className="font-semibold text-sm sm:text-base md:text-lg">Better Outcomes</p>
                <p className="text-xs sm:text-sm text-navy-100">Early detection & intervention</p>
              </div>
            </div>
          </div>
      </div>
    </PageContainer>
  );
}