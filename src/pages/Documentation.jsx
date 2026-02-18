import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  BookOpen, Search, FileText, Users, Brain, GraduationCap, 
  Shield, BarChart3, Heart, FileCheck, Download, Sparkles,
  Clock, TrendingUp, CheckCircle, AlertCircle, Lightbulb
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function Documentation() {
  const [searchQuery, setSearchQuery] = useState('');

  const sections = [
    { id: 'getting-started', title: 'Getting Started', icon: BookOpen },
    { id: 'patient-management', title: 'Patient Management', icon: Users },
    { id: 'smart-notes', title: 'Smart Note Assistant', icon: Brain },
    { id: 'predictive-analytics', title: 'Predictive Analytics', icon: TrendingUp },
    { id: 'education-hub', title: 'Patient Education', icon: GraduationCap },
    { id: 'compliance', title: 'Compliance & Documentation', icon: Shield },
    { id: 'oasis', title: 'OASIS Assessment', icon: FileCheck },
    { id: 'care-plans', title: 'Care Plan Management', icon: Heart },
    { id: 'best-practices', title: 'Best Practices', icon: Lightbulb },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">CareMetric AI Documentation</h1>
              <p className="text-gray-600">Complete user guide for home health professionals</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <Input
              placeholder="Search documentation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Clock className="w-8 h-8 text-green-600" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">75%</p>
                  <p className="text-sm text-gray-600">Time Saved</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-blue-600" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">40%</p>
                  <p className="text-sm text-gray-600">Better Outcomes</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Shield className="w-8 h-8 text-purple-600" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">99%</p>
                  <p className="text-sm text-gray-600">Compliance Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-8 h-8 text-indigo-600" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">95%</p>
                  <p className="text-sm text-gray-600">User Satisfaction</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Navigation */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Contents</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-2">
                  {sections.map(section => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      <section.icon className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium">{section.title}</span>
                    </a>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Content Area */}
          <div className="lg:col-span-3 space-y-8">
            {/* Getting Started */}
            <section id="getting-started">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    Getting Started
                  </CardTitle>
                  <CardDescription>Welcome to CareMetric AI - Your intelligent clinical documentation partner</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">What is CareMetric AI?</h3>
                    <p className="text-gray-700 mb-4">
                      CareMetric AI is an advanced clinical documentation and patient management platform designed specifically for home health and hospice agencies. 
                      Our AI-powered tools reduce administrative burden by up to 75% while improving patient outcomes and ensuring regulatory compliance.
                    </p>
                    <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-600">
                      <p className="text-sm font-medium text-blue-900 mb-2">🎯 Key Benefits:</p>
                      <ul className="space-y-2 text-sm text-blue-800">
                        <li>• <strong>Save 2-3 hours per day</strong> on documentation</li>
                        <li>• <strong>Reduce readmissions by 40%</strong> with predictive analytics</li>
                        <li>• <strong>Achieve 99% compliance</strong> with automated checks</li>
                        <li>• <strong>Improve OASIS accuracy</strong> with AI-powered assistance</li>
                      </ul>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Quick Start Guide</h3>
                    <div className="space-y-4">
                      <div className="flex gap-4">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">1</div>
                        <div>
                          <h4 className="font-semibold mb-1">Log In & Set Up Profile</h4>
                          <p className="text-sm text-gray-600">Access your account and complete your provider profile with credentials and specialization.</p>

                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">2</div>
                        <div>
                          <h4 className="font-semibold mb-1">Navigate the Dashboard</h4>
                          <p className="text-sm text-gray-600">View your daily tasks, high-risk patients, and pending alerts at a glance.</p>

                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">3</div>
                        <div>
                          <h4 className="font-semibold mb-1">Add Your First Patient</h4>
                          <p className="text-sm text-gray-600">Click "Add Patient" and enter demographics, diagnoses, and contact information.</p>

                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">4</div>
                        <div>
                          <h4 className="font-semibold mb-1">Document Your First Visit</h4>
                          <p className="text-sm text-gray-600">Use Smart Note Assistant to create compliant clinical documentation in minutes.</p>

                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Patient Management */}
            <section id="patient-management">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Patient Management
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Managing Your Patient Caseload</h3>
                    <p className="text-gray-700 mb-4">
                      CareMetric AI provides a comprehensive patient management system with AI-powered risk stratification, alerts, and insights.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Adding a New Patient</h4>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                      <li>Navigate to <strong>Patients</strong> page from the sidebar</li>
                      <li>Click <strong>"Add Patient"</strong> button (top right)</li>
                      <li>Fill in required fields:
                        <ul className="ml-6 mt-1 space-y-1">
                          <li>- Name, DOB, MRN</li>
                          <li>- Address and contact information</li>
                          <li>- Primary diagnosis and secondary conditions</li>
                          <li>- Insurance/payor information</li>
                          <li>- Emergency contact details</li>
                        </ul>
                      </li>
                      <li>Click <strong>"Save Patient"</strong></li>
                    </ol>

                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Understanding Patient Details Page</h4>
                    <p className="text-sm text-gray-700 mb-3">The Patient Details page is your command center for each patient:</p>
                    <div className="space-y-2">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <p className="font-medium text-sm">📊 Risk Indicators</p>
                        <p className="text-xs text-gray-600">Color-coded alerts show hospitalization risk, fall risk, and other predictive factors</p>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg">
                        <p className="font-medium text-sm">🎯 AI Insights</p>
                        <p className="text-xs text-gray-600">Proactive recommendations for interventions and care plan adjustments</p>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <p className="font-medium text-sm">📋 Quick Actions</p>
                        <p className="text-xs text-gray-600">Schedule visits, generate documents, send education materials</p>
                      </div>
                    </div>

                  </div>

                  <div className="bg-yellow-50 p-4 rounded-lg border-l-4 border-yellow-600">
                    <p className="font-semibold text-sm mb-2">💡 Pro Tip:</p>
                    <p className="text-sm text-gray-700">Use the "Favorite" star icon on frequently visited patients for quick access from the sidebar!</p>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Smart Notes */}
            <section id="smart-notes">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5" />
                    Smart Note Assistant
                  </CardTitle>
                  <CardDescription>AI-powered clinical documentation that saves hours of your time</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Revolutionary Documentation in 3 Steps</h3>
                    <p className="text-gray-700 mb-4">
                      Smart Note Assistant uses advanced AI to generate compliant, comprehensive clinical notes in minutes instead of hours.
                    </p>
                  </div>

                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border-2 border-blue-200">
                    <h4 className="font-bold text-lg mb-4 text-blue-900">⏱️ Time Savings Breakdown</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Traditional Method:</p>
                        <p className="text-2xl font-bold text-gray-900">45-60 min</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">With Smart Note AI:</p>
                        <p className="text-2xl font-bold text-green-600">5-10 min</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-blue-900 mt-4">💰 Annual Savings: $25,000+ per nurse</p>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Step-by-Step Guide</h4>
                    <div className="space-y-4">
                      <div className="border-l-4 border-blue-600 pl-4">
                        <h5 className="font-semibold mb-2">Step 1: Select Patient & Visit Type</h5>
                        <ul className="text-sm text-gray-700 space-y-1">
                          <li>• Choose patient from dropdown</li>
                          <li>• Select visit type (Admission, Routine, Recertification, etc.)</li>
                          <li>• AI automatically loads patient context and history</li>
                        </ul>

                      </div>

                      <div className="border-l-4 border-green-600 pl-4">
                        <h5 className="font-semibold mb-2">Step 2: Document Visit Details</h5>
                        <p className="text-sm text-gray-700 mb-2">Choose your preferred method:</p>
                        <div className="space-y-2">
                          <div className="bg-white p-3 rounded border">
                            <p className="font-medium text-sm">🎤 Voice Dictation (Fastest)</p>
                            <p className="text-xs text-gray-600">Speak naturally - AI transcribes and structures your note</p>
                          </div>
                          <div className="bg-white p-3 rounded border">
                            <p className="font-medium text-sm">⌨️ Quick Bullet Points</p>
                            <p className="text-xs text-gray-600">Type brief notes - AI expands into full documentation</p>
                          </div>
                          <div className="bg-white p-3 rounded border">
                            <p className="font-medium text-sm">📝 Guided Form</p>
                            <p className="text-xs text-gray-600">Fill structured fields - AI ensures nothing is missed</p>
                          </div>
                        </div>

                      </div>

                      <div className="border-l-4 border-purple-600 pl-4">
                        <h5 className="font-semibold mb-2">Step 3: Review & Enhance</h5>
                        <p className="text-sm text-gray-700 mb-2">AI generates complete note with:</p>
                        <ul className="text-sm text-gray-700 space-y-1">
                          <li>✅ SOAP format (Subjective, Objective, Assessment, Plan)</li>
                          <li>✅ Medicare-compliant terminology</li>
                          <li>✅ Skilled need justification</li>
                          <li>✅ ICD-10 code suggestions</li>
                          <li>✅ Compliance checks passed</li>
                        </ul>

                      </div>
                    </div>
                  </div>

                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">🎯 Best Practices</h4>
                    <ul className="text-sm text-gray-700 space-y-2">
                      <li>• <strong>Use voice dictation</strong> while driving between visits to maximize efficiency</li>
                      <li>• <strong>Review AI suggestions</strong> - you can accept, edit, or regenerate any section</li>
                      <li>• <strong>Leverage templates</strong> - create custom templates for frequent visit types</li>
                      <li>• <strong>Let AI learn</strong> - your edits train the system to match your style</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Predictive Analytics */}
            <section id="predictive-analytics">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Predictive Analytics
                  </CardTitle>
                  <CardDescription>AI-powered risk prediction and intervention recommendations</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Proactive Patient Care</h3>
                    <p className="text-gray-700 mb-4">
                      Our predictive analytics engine analyzes patient data to identify risks before they become problems, enabling preventive interventions.
                    </p>
                  </div>

                  <div className="bg-gradient-to-r from-red-50 to-orange-50 p-6 rounded-xl border-2 border-red-200">
                    <h4 className="font-bold text-lg mb-3 text-red-900">📊 Proven Outcomes</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-red-600">-40%</p>
                        <p className="text-sm text-gray-600">Hospital Readmissions</p>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-orange-600">-35%</p>
                        <p className="text-sm text-gray-600">Emergency Visits</p>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-blue-600">+45%</p>
                        <p className="text-sm text-gray-600">Goal Achievement</p>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-green-600">92%</p>
                        <p className="text-sm text-gray-600">Prediction Accuracy</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Risk Categories Monitored</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-4 bg-red-50 rounded-lg border-l-4 border-red-600">
                        <p className="font-semibold text-sm">🏥 Hospital Readmission Risk</p>
                        <p className="text-xs text-gray-600 mt-1">Analyzes 50+ factors to predict 30-day readmission probability</p>
                      </div>
                      <div className="p-4 bg-orange-50 rounded-lg border-l-4 border-orange-600">
                        <p className="font-semibold text-sm">🚨 Fall Risk Assessment</p>
                        <p className="text-xs text-gray-600 mt-1">Evaluates mobility, medications, and environmental factors</p>
                      </div>
                      <div className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-600">
                        <p className="font-semibold text-sm">💊 Medication Issues</p>
                        <p className="text-xs text-gray-600 mt-1">Identifies interactions, non-adherence, and adverse events</p>
                      </div>
                      <div className="p-4 bg-purple-50 rounded-lg border-l-4 border-purple-600">
                        <p className="font-semibold text-sm">📉 Functional Decline</p>
                        <p className="text-xs text-gray-600 mt-1">Monitors ADL changes and mobility trends</p>
                      </div>
                    </div>

                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Automated Intervention Suggestions</h4>
                    <p className="text-sm text-gray-700 mb-3">When high-risk predictions are detected (≥70%), the system automatically generates:</p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-sm">Pre-filled Intervention Plans</p>
                          <p className="text-xs text-gray-600">Evidence-based interventions specific to identified risks</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-sm">Actionable Steps</p>
                          <p className="text-xs text-gray-600">Clear tasks you can assign with one click</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-sm">Care Plan Updates</p>
                          <p className="text-xs text-gray-600">Suggested goals and interventions ready to add</p>
                        </div>
                      </li>
                    </ul>

                  </div>

                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">💡 How to Use Effectively</h4>
                    <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                      <li>Review daily risk alerts on your dashboard</li>
                      <li>Click into high-risk patient profiles</li>
                      <li>Review AI-generated intervention suggestions</li>
                      <li>Confirm, edit, or dismiss each suggestion</li>
                      <li>Track intervention effectiveness over time</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Patient Education Hub */}
            <section id="education-hub">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5" />
                    Patient Education Hub
                  </CardTitle>
                  <CardDescription>Personalized education materials in multiple languages</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Empowering Patients Through Education</h3>
                    <p className="text-gray-700 mb-4">
                      Generate culturally appropriate, easy-to-understand education materials tailored to each patient's conditions, reading level, and preferred language.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-3xl font-bold text-blue-600">6</p>
                      <p className="text-sm text-gray-600">Languages</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <p className="text-3xl font-bold text-green-600">3</p>
                      <p className="text-sm text-gray-600">Reading Levels</p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <p className="text-3xl font-bold text-purple-600">85%</p>
                      <p className="text-sm text-gray-600">Engagement Rate</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Generating Personalized Materials</h4>
                    <ol className="space-y-3 text-sm text-gray-700">
                      <li className="flex items-start gap-3">
                        <span className="font-bold text-blue-600">1.</span>
                        <div>
                          <p className="font-semibold">Navigate to Patient → Education Tab</p>
                          <p className="text-xs text-gray-600">Find the education hub in the patient details page</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="font-bold text-blue-600">2.</span>
                        <div>
                          <p className="font-semibold">Click "Generate New Material"</p>
                          <p className="text-xs text-gray-600">AI analyzes patient's diagnoses and care plan</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="font-bold text-blue-600">3.</span>
                        <div>
                          <p className="font-semibold">Enter Topic & Select Language</p>
                          <p className="text-xs text-gray-600">Choose from English, Spanish, Chinese, Arabic, French, German</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="font-bold text-blue-600">4.</span>
                        <div>
                          <p className="font-semibold">Review & Assign to Patient</p>
                          <p className="text-xs text-gray-600">Material is automatically personalized with patient's conditions</p>
                        </div>
                      </li>
                    </ol>

                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">What's Included in Each Material</h4>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-600 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Personalized Content</p>
                          <p className="text-xs text-gray-600">References patient's specific medications, conditions, and care plan</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-600 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Key Takeaways</p>
                          <p className="text-xs text-gray-600">Bullet-point summary of most important information</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-600 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Warning Signs</p>
                          <p className="text-xs text-gray-600">When to call doctor or seek emergency care</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-600 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Action Items</p>
                          <p className="text-xs text-gray-600">Specific steps patient should take today, this week, this month</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-600 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Teach-Back Questions</p>
                          <p className="text-xs text-gray-600">Questions to verify patient understanding</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">📊 Track Engagement</h4>
                    <p className="text-sm text-gray-700 mb-3">Monitor which patients have:</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Badge className="bg-blue-100 text-blue-800">Viewed</Badge>
                      <Badge className="bg-green-100 text-green-800">Completed</Badge>
                      <Badge className="bg-purple-100 text-purple-800">Rated</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Best Practices */}
            <section id="best-practices">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5" />
                    Best Practices & Tips
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Maximize Your Efficiency</h3>
                    
                    <div className="space-y-4">
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border-l-4 border-blue-600">
                        <h4 className="font-bold mb-2">🚗 Document While Driving</h4>
                        <p className="text-sm text-gray-700">Use voice dictation between visits. By the time you arrive home, your notes are 90% complete.</p>
                      </div>

                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border-l-4 border-green-600">
                        <h4 className="font-bold mb-2">⏰ Check Alerts in the Morning</h4>
                        <p className="text-sm text-gray-700">Review your risk alerts and predictive insights before starting visits to prioritize high-risk patients.</p>
                      </div>

                      <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg border-l-4 border-purple-600">
                        <h4 className="font-bold mb-2">📋 Use Templates</h4>
                        <p className="text-sm text-gray-700">Create custom templates for routine visits. Load, dictate changes, done in 3 minutes.</p>
                      </div>

                      <div className="bg-gradient-to-r from-orange-50 to-red-50 p-4 rounded-lg border-l-4 border-orange-600">
                        <h4 className="font-bold mb-2">🎯 Let AI Learn</h4>
                        <p className="text-sm text-gray-700">Don't over-edit AI suggestions. The system learns your preferences and gets better over time.</p>
                      </div>

                      <div className="bg-gradient-to-r from-yellow-50 to-amber-50 p-4 rounded-lg border-l-4 border-yellow-600">
                        <h4 className="font-bold mb-2">📱 Use Mobile App</h4>
                        <p className="text-sm text-gray-700">CareMetric AI works perfectly on phones and tablets - document from anywhere.</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Compliance Tips</h3>
                    <ul className="space-y-2 text-sm text-gray-700">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span><strong>Always review</strong> AI compliance suggestions before finalizing notes</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span><strong>Use ICD-10 suggester</strong> to ensure accurate coding</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span><strong>Document skilled need</strong> - AI highlights missing justifications</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span><strong>Run OASIS checks</strong> before submission</span>
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Quick Reference */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Reference</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Keyboard Shortcuts</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between p-2 bg-gray-50 rounded">
                        <span>New Patient</span>
                        <Badge variant="outline">Ctrl + N</Badge>
                      </div>
                      <div className="flex justify-between p-2 bg-gray-50 rounded">
                        <span>Search</span>
                        <Badge variant="outline">Ctrl + K</Badge>
                      </div>
                      <div className="flex justify-between p-2 bg-gray-50 rounded">
                        <span>Voice Dictation</span>
                        <Badge variant="outline">Ctrl + D</Badge>
                      </div>
                      <div className="flex justify-between p-2 bg-gray-50 rounded">
                        <span>Save Note</span>
                        <Badge variant="outline">Ctrl + S</Badge>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Support Resources</h4>
                    <div className="space-y-2">
                      <Button variant="outline" className="w-full justify-start">
                        <FileText className="w-4 h-4 mr-2" />
                        Video Tutorials
                      </Button>
                      <Button variant="outline" className="w-full justify-start">
                        <Download className="w-4 h-4 mr-2" />
                        Download User Guide PDF
                      </Button>
                      <Button variant="outline" className="w-full justify-start">
                        <Users className="w-4 h-4 mr-2" />
                        Contact Support
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}