import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Brain,
  Sparkles,
  Shield,
  TrendingUp,
  Heart,
  FileText,
  Users,
  Clock,
  Target,
  BookOpen,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Stethoscope,
  Activity,
  Zap } from
"lucide-react";

export default function Homepage() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10" />
        <div className="relative max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-6">
              <img
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/4cdbb3c5a_EB4F3981-36F5-46A4-8E0C-4B53A58EAE88.jpeg"
                alt="CareMetric AI Logo"
                className="w-20 h-20 rounded-2xl shadow-2xl bg-white p-1" />

              <h1 className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                CareMetric AI
              </h1>
            </div>
            <p className="text-2xl md:text-3xl text-gray-700 mb-4 font-semibold">
              Your AI-Powered Clinical Documentation Assistant
            </p>
            <p className="text-lg md:text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
              Revolutionizing home health nursing with intelligent documentation, 
              predictive analytics, and personalized patient education
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {currentUser ?
              <Link to={createPageUrl("Dashboard")}>
                  <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6">
                    Go to Dashboard
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link> :

              <Button
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-6"
                onClick={() => base44.auth.redirectToLogin()}>

                  Get Started
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              }
              <Link to={createPageUrl("Features")}>
                <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-2">
                  Explore Features
                  <Sparkles className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Key Stats */}
      <section className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="border-2 border-blue-200 bg-white/80 backdrop-blur">
            <CardContent className="p-6 text-center">
              <Brain className="w-12 h-12 text-blue-600 mx-auto mb-3" />
              <p className="text-3xl font-bold text-green-600">40%</p>
              <p className="text-sm text-gray-600 mt-2">Smart Documentation</p>
            </CardContent>
          </Card>
          <Card className="border-2 border-green-200 bg-white/80 backdrop-blur">
            <CardContent className="p-6 text-center">
              <Clock className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <p className="text-3xl font-bold text-green-600">70%</p>
              <p className="text-sm text-gray-600 mt-2">Time Saved on Notes</p>
            </CardContent>
          </Card>
          <Card className="border-2 border-purple-200 bg-white/80 backdrop-blur">
            <CardContent className="p-6 text-center">
              <Shield className="w-12 h-12 text-purple-600 mx-auto mb-3" />
              <p className="text-3xl font-bold text-purple-600">100%</p>
              <p className="text-sm text-gray-600 mt-2">Medicare Compliant</p>
            </CardContent>
          </Card>
          <Card className="border-2 border-orange-200 bg-white/80 backdrop-blur">
            <CardContent className="p-6 text-center">
              <TrendingUp className="w-12 h-12 text-orange-600 mx-auto mb-3" />
              <p className="text-3xl font-bold text-orange-600">95%+</p>
              <p className="text-sm text-gray-600 mt-2">Quality Scores</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Core Features */}
      <section className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Everything You Need for Clinical Excellence
          </h2>
          <p className="text-xl text-gray-600">
            Comprehensive tools designed specifically for home health nurses
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Feature Cards */}
          <Card className="border-2 border-blue-200 hover:shadow-xl transition-shadow bg-white">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <Brain className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle className="text-xl">AI Smart Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Transform rough notes into Medicare-compliant documentation in seconds. AI enhances clarity, completeness, and compliance.
              </p>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Real-time compliance checking</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Voice dictation support</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Automated quality scoring</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-purple-200 hover:shadow-xl transition-shadow bg-white">
            <CardHeader>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <Activity className="w-6 h-6 text-purple-600" />
              </div>
              <CardTitle className="text-xl">Patient Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                AI-powered risk prediction and outcome tracking to identify patients who need extra attention.
              </p>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Readmission risk scoring</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Fall prevention tracking</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Outcome trend analysis</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-200 hover:shadow-xl transition-shadow bg-white">
            <CardHeader>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <Target className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle className="text-xl">Care Plan Management</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                AI generates personalized care plans based on diagnosis, patient history, and best practices.
              </p>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Auto-generated interventions</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Progress tracking</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Goal achievement analytics</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-orange-200 hover:shadow-xl transition-shadow bg-white">
            <CardHeader>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
                <BookOpen className="w-6 h-6 text-orange-600" />
              </div>
              <CardTitle className="text-xl">Patient Education</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Generate personalized education materials tailored to each patient's conditions and learning needs.
              </p>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Simplified explanations</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Custom handouts</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Teach-back prompts</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-indigo-200 hover:shadow-xl transition-shadow bg-white">
            <CardHeader>
              <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-3">
                <Shield className="w-6 h-6 text-indigo-600" />
              </div>
              <CardTitle className="text-xl">Compliance Monitoring</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Real-time Medicare compliance checking and proactive regulatory alerts keep you audit-ready.
              </p>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Automated auditing</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Regulatory updates</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Quality scoring</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-pink-200 hover:shadow-xl transition-shadow bg-white">
            <CardHeader>
              <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center mb-3">
                <Stethoscope className="w-6 h-6 text-pink-600" />
              </div>
              <CardTitle className="text-xl">Clinical Decision Support</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                AI analyzes patient data to provide evidence-based recommendations and early warning alerts.
              </p>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Medication interaction alerts</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Deterioration prediction</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>Evidence-based guidance</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-gradient-to-r from-blue-600 to-purple-600 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">
              Why Nurses Love CareMetric AI
            </h2>
            <p className="text-xl text-blue-100">
              Designed by nurses, for nurses
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
              <Clock className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Save Time</h3>
              <p className="text-blue-100">
                Reduce documentation time by up to 70%, giving you more time for patient care
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
              <Zap className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Reduce Stress</h3>
              <p className="text-blue-100">
                Eliminate compliance anxiety with automated checks and real-time guidance
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
              <TrendingUp className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Improve Outcomes</h3>
              <p className="text-blue-100">
                Predictive analytics help prevent adverse events and readmissions
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
              <Heart className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Better Patient Care</h3>
              <p className="text-blue-100">
                Personalized education and care plans improve patient engagement
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
              <BarChart3 className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Data-Driven Insights</h3>
              <p className="text-blue-100">
                Track outcomes, identify trends, and continuously improve care quality
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
              <Users className="w-10 h-10 text-white mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Easy Collaboration</h3>
              <p className="text-blue-100">
                Seamless team coordination and comprehensive patient tracking
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Simple, Powerful, Effective
          </h2>
          <p className="text-xl text-gray-600">
            Get started in minutes, master in days
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
              1
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Document Your Visit</h3>
            <p className="text-gray-600">
              Use voice dictation or type rough notes during or after your patient visit
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-purple-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
              2
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">AI Enhances & Validates</h3>
            <p className="text-gray-600">
              AI transforms your notes into compliant documentation and checks for quality
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-green-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
              3
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Review & Submit</h3>
            <p className="text-gray-600">
              Quick review, make any adjustments, and submit with confidence
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-5xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-purple-50">
          <CardContent className="p-12 text-center">
            <Sparkles className="w-16 h-16 text-purple-600 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Ready to Transform how you document?

            </h2>
            <p className="text-xl text-gray-600 mb-8">
              Join nurses who are saving time, reducing stress, and improving patient outcomes
            </p>
            {currentUser ?
            <Link to={createPageUrl("Dashboard")}>
                <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-12 py-6">
                  Go to Dashboard
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link> :

            <Button
              size="lg"
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-12 py-6"
              onClick={() => base44.auth.redirectToLogin()}>

                Get Started Free
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            }
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/4cdbb3c5a_EB4F3981-36F5-46A4-8E0C-4B53A58EAE88.jpeg"
                  alt="CareMetric AI Logo"
                  className="w-10 h-10 rounded-lg" />

                <span className="text-xl font-bold">CareMetric AI</span>
              </div>
              <p className="text-gray-400">
                Empowering home health nurses with AI-driven clinical intelligence
              </p>
            </div>

            <div>
              <h3 className="font-bold mb-4">Quick Links</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <Link to={createPageUrl("Features")} className="hover:text-white transition-colors">
                    Features
                  </Link>
                </li>
                <li>
                  <Link to={createPageUrl("About")} className="hover:text-white transition-colors">
                    About
                  </Link>
                </li>
                {currentUser &&
                <li>
                    <Link to={createPageUrl("Dashboard")} className="hover:text-white transition-colors">
                      Dashboard
                    </Link>
                  </li>
                }
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-4">Contact</h3>
              <p className="text-gray-400">
                Questions or feedback?<br />
                We'd love to hear from you.
              </p>
            </div>
          </div>

          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2025 CareMetric AI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>);

}