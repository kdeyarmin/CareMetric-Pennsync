import React, { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  CheckCircle2,
  TrendingUp,
  Brain,
  FileText,
  Users,
  Shield,
  Pill,
  Calendar,
  Bell,
  Target,
  Sparkles,
  Heart,
  Award,
  Zap,
  BarChart3,
  BookOpen,
  Stethoscope,
  ClipboardCheck,
  MessageSquare,
  WifiOff
} from "lucide-react";
import { motion } from "framer-motion";

export const publicPage = true;

export default function About() {
  useEffect(() => {
    console.log('=== WEBKIT DEBUG FROM ABOUT PAGE ===');
    console.log('window.webkit:', window.webkit);
    console.log('window.webkit.messageHandlers:', window.webkit?.messageHandlers);
    
    if (window.webkit?.messageHandlers) {
      const handlers = Object.getOwnPropertyNames(window.webkit.messageHandlers);
      console.log('Available message handlers:', handlers);
      
      // Try each handler
      handlers.forEach(name => {
        console.log(`Handler "${name}":`, window.webkit.messageHandlers[name]);
      });
    }
    console.log('=====================================');
  }, []);

  const keyBenefits = [
    {
      icon: Clock,
      title: "Save 2-3 Hours Daily",
      description: "AI-powered documentation automation reduces charting time by 70%, giving you more time for patient care.",
      color: "from-blue-500 to-cyan-500"
    },
    {
      icon: CheckCircle2,
      title: "99% Medicare Compliance",
      description: "Real-time compliance checking ensures every note meets 42 CFR 484 requirements, protecting your agency from audits.",
      color: "from-green-500 to-emerald-500"
    },
    {
      icon: TrendingUp,
      title: "Better Patient Outcomes",
      description: "Predictive analytics identify risks early, enabling proactive interventions that reduce hospitalizations by 30%.",
      color: "from-purple-500 to-pink-500"
    }
  ];

  const features = [
    {
      category: "Smart Documentation",
      icon: FileText,
      color: "bg-blue-600",
      items: [
        { name: "AI Note Enhancement", time: "Saves 30-45 min per visit", description: "Transform rough notes into Medicare-compliant documentation instantly" },
        { name: "Voice Dictation", time: "Saves 15-20 min per visit", description: "Hands-free documentation with medical terminology recognition" },
        { name: "Real-Time Compliance Checking", time: "Prevents denials", description: "Live feedback on documentation quality and completeness" },
        { name: "Auto-Generated Visit Notes", time: "Saves 20-30 min", description: "AI drafts comprehensive notes from vital signs and observations" },
        { name: "Smart Templates", time: "Saves 10-15 min", description: "Visit type-specific templates that adapt to patient needs" },
        { name: "Referral Processing", time: "Saves 15-20 min", description: "Extract patient data from PDFs automatically" }
      ]
    },
    {
      category: "Clinical Intelligence",
      icon: Brain,
      color: "bg-purple-600",
      items: [
        { name: "Medication Management", time: "Prevents errors", description: "AI analyzes interactions, contraindications, and dosing errors" },
        { name: "Risk Stratification", time: "Early detection", description: "Identify high-risk patients before emergencies occur" },
        { name: "Care Gap Analysis", time: "Improves outcomes", description: "Proactively identifies missing interventions" },
        { name: "Clinical Decision Support", time: "Real-time guidance", description: "Evidence-based recommendations during patient care" },
        { name: "Deterioration Prediction", time: "Prevents hospitalizations", description: "AI predicts patient decline 24-48 hours in advance" },
        { name: "Wound Care Tracking", time: "Better healing", description: "Track progress and suggest evidence-based interventions" }
      ]
    },
    {
      category: "Care Planning",
      icon: Target,
      color: "bg-green-600",
      items: [
        { name: "AI Care Plan Generation", time: "Saves 20-30 min", description: "Automatically create evidence-based care plans" },
        { name: "Goal Tracking", time: "Improves outcomes", description: "Monitor patient progress toward measurable goals" },
        { name: "Automatic Care Plans", time: "Saves 15-20 min", description: "Trigger care plans based on diagnosis or medications" },
        { name: "Care Plan Evolution", time: "Adapts to needs", description: "AI suggests updates based on patient progress" }
      ]
    },
    {
      category: "Patient Safety",
      icon: Shield,
      color: "bg-red-600",
      items: [
        { name: "Incident Reporting", time: "Saves 10-15 min", description: "Guided incident reporting with AI analysis" },
        { name: "Patient Alerts", time: "Proactive monitoring", description: "Real-time alerts for critical changes" },
        { name: "Medication Reconciliation", time: "Prevents errors", description: "Automated med rec with interaction checking" },
        { name: "Fall Risk Assessment", time: "Reduces falls", description: "Dynamic fall risk scoring with interventions" }
      ]
    },
    {
      category: "Task Management",
      icon: Calendar,
      color: "bg-orange-600",
      items: [
        { name: "Smart Prioritization", time: "Saves 15-20 min daily", description: "AI ranks tasks by urgency and patient needs" },
        { name: "Auto-Task Generation", time: "Never miss follow-ups", description: "Generate tasks from visit notes automatically" },
        { name: "Route Optimization", time: "Saves 30-45 min driving", description: "AI optimizes your daily schedule and routes" },
        { name: "Task Notifications", time: "Stay on track", description: "Intelligent reminders for overdue or critical tasks" }
      ]
    },
    {
      category: "Education & Training",
      icon: BookOpen,
      color: "bg-indigo-600",
      items: [
        { name: "Personalized Training", time: "Close skill gaps", description: "AI identifies learning needs from documentation" },
        { name: "Patient Education Generator", time: "Saves 10-15 min", description: "Create custom education materials instantly" },
        { name: "Interactive Quizzes", time: "Improve knowledge", description: "Scenario-based learning with immediate feedback" },
        { name: "Guidelines Library", time: "Quick reference", description: "Medicare CoP and clinical guidelines at your fingertips" }
      ]
    },
    {
      category: "Compliance & Quality",
      icon: Award,
      color: "bg-yellow-600",
      items: [
        { name: "Medicare Compliance Dashboard", time: "Track performance", description: "Personal compliance scores and improvement areas" },
        { name: "Automated Auditing", time: "Catch errors early", description: "AI audits every note before submission" },
        { name: "Regulatory Updates", time: "Stay current", description: "Automatic alerts for CMS regulation changes" },
        { name: "Quality Metrics", time: "Measure impact", description: "Track documentation quality and patient outcomes" }
      ]
    },
    {
      category: "Communication",
      icon: MessageSquare,
      color: "bg-cyan-600",
      items: [
        { name: "Family Updates", time: "Saves 10-15 min", description: "AI generates warm, clear family communications" },
        { name: "Care Coordination", time: "Better teamwork", description: "Share updates with physicians and team members" },
        { name: "AI Chat Assistant", time: "Instant answers", description: "24/7 clinical and documentation support" }
      ]
    },
    {
      category: "Mobile & Offline",
      icon: WifiOff,
      color: "bg-teal-600",
      items: [
        { name: "Offline Mode", time: "Work anywhere", description: "Document visits without internet connection" },
        { name: "Mobile Optimization", time: "Use on-the-go", description: "Full functionality on phones and tablets" },
        { name: "Voice Commands", time: "Hands-free operation", description: "Control the app with your voice" }
      ]
    }
  ];

  const timeMetrics = [
    { label: "Average Daily Time Saved", value: "2-3 hours", icon: Clock, color: "text-blue-600" },
    { label: "Documentation Time Reduction", value: "70%", icon: Zap, color: "text-green-600" },
    { label: "Compliance Score Improvement", value: "+15-25%", icon: TrendingUp, color: "text-purple-600" },
    { label: "Hospitalization Reduction", value: "30%", icon: Heart, color: "text-red-600" }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4 md:p-8 w-full max-w-full overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full max-w-full overflow-x-hidden min-w-0">
        {/* Hero Section */}
        <div className="text-center space-y-3 sm:space-y-4 py-6 sm:py-8">
          <div className="flex justify-center mb-3 sm:mb-4">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
              alt="CareMetric AI Logo"
              className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain"
            />
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 px-4">
            CareMetric AI
          </h1>
          <p className="text-lg sm:text-xl md:text-2xl lg:text-3xl text-blue-600 font-semibold px-4">
            AI-Powered Clinical Documentation & Care Management
          </p>
          <p className="text-sm sm:text-base md:text-lg text-gray-600 max-w-3xl mx-auto px-4">
            Empowering home health nurses with artificial intelligence to deliver better patient care, 
            reduce documentation burden, and ensure Medicare compliance—all while saving 2-3 hours every day.
          </p>
        </div>

        {/* Key Benefits */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {keyBenefits.map((benefit, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.2 }}
              whileHover={{ y: -8 }}
            >
              <Card className="border-2 border-gray-200 dark:border-gray-700 hover:shadow-2xl transition-all duration-300 hover-lift h-full">
              <CardContent className="p-4 sm:p-6">
                <div className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br ${benefit.color} flex items-center justify-center mb-3 sm:mb-4 shadow-lg`}>
                  <benefit.icon className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-white" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">{benefit.title}</h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">{benefit.description}</p>
              </CardContent>
            </Card>
            </motion.div>
          ))}
        </div>

        {/* Time Savings Metrics */}
        <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-xl sm:text-2xl text-center">Proven Impact on Your Practice</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {timeMetrics.map((metric, idx) => (
                <div key={idx} className="text-center">
                  <metric.icon className={`w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 mx-auto mb-2 ${metric.color}`} />
                  <p className={`text-2xl sm:text-3xl font-bold ${metric.color}`}>{metric.value}</p>
                  <p className="text-xs sm:text-sm text-gray-600 mt-1">{metric.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Features by Category */}
        <div className="space-y-4 sm:space-y-6">
          <div className="text-center mb-6 sm:mb-8 px-4">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">Complete Feature Set</h2>
            <p className="text-base sm:text-lg text-gray-600">Everything you need to excel in home health nursing</p>
          </div>

          {features.map((category, idx) => (
            <Card key={idx} className="border-2 border-gray-200">
              <CardHeader className={`${category.color} text-white p-4 sm:p-6`}>
                <CardTitle className="text-lg sm:text-xl md:text-2xl flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <category.icon className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 flex-shrink-0" />
                    <span>{category.category}</span>
                  </div>
                  <Badge className="bg-white/20 text-white sm:ml-auto">
                    {category.items.length} Features
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {category.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex gap-2 sm:gap-3 p-3 sm:p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 flex-shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2 mb-1">
                          <h4 className="font-semibold text-sm sm:text-base text-gray-900 break-words">{item.name}</h4>
                          <Badge variant="outline" className="text-xs whitespace-nowrap flex-shrink-0">
                            {item.time}
                          </Badge>
                        </div>
                        <p className="text-xs sm:text-sm text-gray-600">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* How It Helps */}
        <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-2xl sm:text-3xl text-center text-purple-900 px-4">
              How CareMetric AI Transforms Your Practice
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              <div className="text-center space-y-2 sm:space-y-3 px-4">
                <div className="w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 mx-auto bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center shadow-lg">
                  <Clock className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-gray-900">Less Documentation Time</h3>
                <p className="text-sm sm:text-base text-gray-600">
                  AI converts voice notes to Medicare-compliant documentation in seconds, reducing documentation time by 70%. 
                  Spend less time charting, more time caring. Typical nurses save 2-3 hours per day.
                </p>
              </div>

              <div className="text-center space-y-2 sm:space-y-3 px-4">
                <div className="w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 mx-auto bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                  <CheckCircle2 className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-gray-900">Higher Accuracy</h3>
                <p className="text-sm sm:text-base text-gray-600">
                  Real-time compliance checking ensures every note meets requirements. 
                  AI catches errors before submission, preventing costly denials and improving quality scores by 15-25%.
                </p>
              </div>

              <div className="text-center space-y-2 sm:space-y-3 px-4">
                <div className="w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg">
                  <Heart className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white" />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-gray-900">Better Patient Outcomes</h3>
                <p className="text-sm sm:text-base text-gray-600">
                  Predictive analytics identify risks before they escalate. 
                  AI-driven care plans and alerts help you intervene early, reducing hospitalizations by up to 30%.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Built for Nurses */}
        <Card className="border-2 border-blue-300 bg-white">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-2xl sm:text-3xl text-center px-4">Built By Nurses, For Nurses</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="prose max-w-none text-gray-700 space-y-3 sm:space-y-4">
              <p className="text-base sm:text-lg text-center px-4">
                CareMetric AI understands the challenges you face every day: overwhelming documentation requirements, 
                complex regulations, time pressures, and the constant juggling of patient care with administrative tasks.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
                <div className="space-y-2 sm:space-y-3 px-4">
                  <h4 className="text-lg sm:text-xl font-bold text-blue-900 flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 sm:w-6 sm:h-6" />
                    Clinical Excellence
                  </h4>
                  <ul className="space-y-1 sm:space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Evidence-based recommendations at point of care</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Comprehensive medication management with interaction checking</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Risk prediction for proactive intervention</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Integrated clinical decision support</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-2 sm:space-y-3 px-4">
                  <h4 className="text-lg sm:text-xl font-bold text-blue-900 flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6" />
                    Documentation Made Easy
                  </h4>
                  <ul className="space-y-1 sm:space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Voice-to-text with medical terminology understanding</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Automatic compliance checking against 42 CFR 484</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>Smart templates that adapt to patient conditions</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>One-click note enhancement to meet all requirements</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="bg-gradient-to-r from-blue-100 to-purple-100 p-4 sm:p-6 rounded-lg mt-4 sm:mt-6 text-center">
                <p className="text-base sm:text-lg font-semibold text-gray-900 px-4">
                  "CareMetric AI gave me my evenings back. I used to spend 2-3 hours every night finishing documentation. 
                  Now I'm done before I leave my last patient's home."
                </p>
                <p className="text-xs sm:text-sm text-gray-600 mt-2">— Home Health Nurse User</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Technology Section */}
        <Card className="border-2 border-indigo-300 bg-gradient-to-r from-indigo-50 to-blue-50">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-2xl sm:text-3xl text-center px-4">Powered by Advanced AI Technology</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2 sm:space-y-3 px-4">
                <Brain className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-600" />
                <h4 className="text-lg sm:text-xl font-bold text-gray-900">Natural Language Processing</h4>
                <p className="text-sm sm:text-base text-gray-600">
                  Our AI understands medical terminology, clinical context, and documentation requirements. 
                  It can read your rough notes, understand what you mean, and generate compliant documentation automatically.
                </p>
              </div>

              <div className="space-y-2 sm:space-y-3 px-4">
                <BarChart3 className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-600" />
                <h4 className="text-lg sm:text-xl font-bold text-gray-900">Predictive Analytics</h4>
                <p className="text-sm sm:text-base text-gray-600">
                  Machine learning models analyze patient data to predict risks, suggest interventions, 
                  and identify care gaps before they become problems. Stay ahead of patient needs.
                </p>
              </div>

              <div className="space-y-2 sm:space-y-3 px-4">
                <Shield className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-600" />
                <h4 className="text-lg sm:text-xl font-bold text-gray-900">HIPAA Compliant & Secure</h4>
                <p className="text-sm sm:text-base text-gray-600">
                  Bank-level encryption, secure data storage, and full HIPAA compliance. 
                  Your patient data is protected with the highest security standards.
                </p>
              </div>

              <div className="space-y-2 sm:space-y-3 px-4">
                <Zap className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-600" />
                <h4 className="text-lg sm:text-xl font-bold text-gray-900">Continuous Learning</h4>
                <p className="text-sm sm:text-base text-gray-600">
                  Our AI learns from the latest Medicare guidelines, clinical best practices, 
                  and your documentation patterns to provide increasingly personalized assistance.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Legal Documents Section */}
        <div className="space-y-4 sm:space-y-6">
          <div className="text-center mb-6 sm:mb-8 px-4">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">Legal & Compliance</h2>
            <p className="text-base sm:text-lg text-gray-600">Our commitment to security, privacy, and compliance</p>
          </div>

          {/* Terms of Use */}
          <Card className="border-2 border-gray-200">
            <CardHeader className="bg-blue-600 text-white p-4 sm:p-6">
              <CardTitle className="text-xl sm:text-2xl flex items-center gap-2 sm:gap-3">
                <FileText className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" />
                <span className="break-words">Terms of Use</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              <p className="text-sm text-gray-500 mb-4">
                <strong>Effective Date:</strong> December 27, 2025 | <strong>Last Updated:</strong> December 27, 2025
              </p>
              
              <div className="prose max-w-none text-gray-700 space-y-3">
                <p>These Terms of Use constitute a legally binding agreement between you and CareMetric AI, LLC governing your use of the CareMetric AI platform and services.</p>
                
                <p>CareMetric AI provides artificial intelligence tools to assist healthcare professionals in drafting and enhancing clinical documentation. The Service is intended to support efficiency only and does not replace professional clinical judgment.</p>
                
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-4">
                  <p className="font-semibold text-yellow-800">Important Acknowledgments:</p>
                  <ul className="list-disc ml-6 mt-2 space-y-1 text-yellow-900">
                    <li>The Service uses artificial intelligence and outputs may contain errors, omissions, or inaccuracies</li>
                    <li>You accept all risks associated with reliance on AI-generated content</li>
                    <li>Every AI-generated note must be personally reviewed, edited, and approved by you before submission</li>
                    <li>You remain solely responsible for all documentation</li>
                  </ul>
                </div>
                
                <p>The Service does not provide medical, legal, or billing advice and is not a medical device.</p>
                
                <p>You agree to comply with all applicable laws including HIPAA, HITECH, and state regulations.</p>
                
                <p>If Protected Health Information (PHI) is used, a Business Associate Agreement must be executed prior to use.</p>
                
                <p className="font-semibold">Disclaimers & Limitations:</p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>The Service is provided 'as is' without warranties</li>
                  <li>CareMetric AI disclaims all implied warranties</li>
                  <li>CareMetric AI shall not be liable for indirect or consequential damages</li>
                  <li>Liability is limited to fees paid in the prior 12 months</li>
                </ul>
                
                <p>You agree to indemnify CareMetric AI for claims arising from your use of the Service.</p>
                
                <p className="text-sm text-gray-600 mt-4">
                  <strong>Contact:</strong> support@caremetricai.com
                </p>
              </div>
              
              <div className="pt-4 border-t">
                <a 
                  href="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/3e29f0f2b_CareMetric_AI_Terms_of_Use1.pdf" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Download Full Terms of Use (PDF)
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Business Associate Agreement */}
          <Card className="border-2 border-gray-200">
            <CardHeader className="bg-purple-600 text-white p-4 sm:p-6">
              <CardTitle className="text-xl sm:text-2xl flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                <Shield className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" />
                <span className="break-words">Business Associate Agreement (BAA)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              <p className="text-sm text-gray-500 mb-4">
                <strong>Effective Date:</strong> December 27, 2025
              </p>
              
              <div className="prose max-w-none text-gray-700 space-y-3">
                <p>This Business Associate Agreement (BAA) is entered into between CareMetric AI, LLC and the Covered Entity.</p>
                
                <p>This BAA is intended to comply with HIPAA and HITECH requirements regarding the protection of Protected Health Information (PHI).</p>
                
                <p className="font-semibold">Key Commitments:</p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>Business Associate agrees to use and disclose PHI only as permitted by this Agreement or as required by law</li>
                  <li>Implement appropriate safeguards to prevent use or disclosure of PHI other than as permitted</li>
                  <li>Report to Covered Entity any use or disclosure of PHI not provided for by this Agreement, including breaches of unsecured PHI</li>
                  <li>Ensure that any subcontractors agree to the same restrictions and conditions</li>
                  <li>Make PHI available for access and amendment as required by HIPAA</li>
                  <li>Make internal practices available to the Secretary of HHS upon request</li>
                  <li>Upon termination, return or destroy all PHI if feasible</li>
                </ul>
                
                <div className="bg-green-50 border-l-4 border-green-400 p-4 my-4">
                  <p className="font-semibold text-green-800">HIPAA Compliance Commitment</p>
                  <p className="text-green-900 mt-2">
                    CareMetric AI is committed to maintaining the highest standards of data protection and HIPAA compliance. 
                    We implement administrative, physical, and technical safeguards to protect all Protected Health Information.
                  </p>
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <a 
                  href="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/66f812e1a_CareMetric_AI_BAA.pdf" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 font-medium flex items-center gap-2"
                >
                  <Shield className="w-4 h-4" />
                  Download Full BAA (PDF)
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Privacy Policy */}
          <Card className="border-2 border-gray-200">
            <CardHeader className="bg-green-600 text-white p-4 sm:p-6">
              <CardTitle className="text-xl sm:text-2xl flex items-center gap-2 sm:gap-3">
                <Users className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" />
                <span className="break-words">Privacy Policy</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              <p className="text-sm text-gray-500 mb-4">
                <strong>Effective Date:</strong> December 27, 2025 | <strong>Last Updated:</strong> December 27, 2025
              </p>
              
              <div className="prose max-w-none text-gray-700 space-y-3">
                <p>This Privacy Policy describes how CareMetric AI, LLC collects, uses, and protects your information.</p>
                
                <p className="font-semibold">Information Collection & Use:</p>
                <ul className="list-disc ml-6 space-y-2">
                  <li>We collect information you provide directly, including account details and any data entered into the Service</li>
                  <li>If PHI is submitted under a valid BAA, we use it solely to provide the Service and as permitted by law</li>
                  <li>We implement administrative, physical, and technical safeguards to protect data</li>
                </ul>
                
                <p className="font-semibold">Your Privacy Rights:</p>
                <ul className="list-disc ml-6 space-y-2">
                  <li><strong>No Sale of Data:</strong> We do not sell your personal information</li>
                  <li><strong>Limited Sharing:</strong> We may share information with service providers who assist in operating the Service, subject to confidentiality obligations</li>
                  <li><strong>Access & Control:</strong> You may request access, correction, or deletion of your information where permitted by law</li>
                  <li><strong>Data Retention:</strong> We retain information only as long as necessary to provide the Service or comply with legal obligations</li>
                </ul>
                
                <div className="bg-blue-50 border-l-4 border-blue-400 p-4 my-4">
                  <p className="font-semibold text-blue-800">Your Data, Your Control</p>
                  <p className="text-blue-900 mt-2">
                    We are committed to transparency and giving you control over your data. 
                    Contact us anytime to exercise your privacy rights or ask questions about how we handle your information.
                  </p>
                </div>
                
                <p>We may update this Privacy Policy from time to time. Continued use constitutes acceptance.</p>
                
                <p className="text-sm text-gray-600 mt-4">
                  <strong>Contact:</strong> support@caremetricai.com for privacy questions
                </p>
              </div>
              
              <div className="pt-4 border-t">
                <a 
                  href="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/739d2eba9_CareMetric_AI_Privacy_Policy.pdf" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-green-600 hover:text-green-800 font-medium flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Download Full Privacy Policy (PDF)
                </a>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer CTA */}
        <div className="text-center py-8 sm:py-12 space-y-3 sm:space-y-4 px-4">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900">
            Ready to Transform Your Practice?
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
            Join thousands of home health nurses who have reclaimed their time and improved patient care with CareMetric AI.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 pt-3 sm:pt-4">
            <Badge className="bg-blue-600 text-white text-sm sm:text-base md:text-lg px-4 sm:px-6 py-2">
              2-3 Hours Saved Daily
            </Badge>
            <Badge className="bg-green-600 text-white text-sm sm:text-base md:text-lg px-4 sm:px-6 py-2">
              99% Compliance Rate
            </Badge>
            <Badge className="bg-purple-600 text-white text-sm sm:text-base md:text-lg px-4 sm:px-6 py-2">
              30% Fewer Hospitalizations
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}