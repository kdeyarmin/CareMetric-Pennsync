import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Clock, TrendingUp, Shield, DollarSign, Users, Brain, 
  Zap, CheckCircle, Star, Award, Target, Heart,
  BarChart3, FileCheck, GraduationCap, Sparkles
} from 'lucide-react';

export default function Marketing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-white/[0.05] bg-[size:30px_30px]" />
        <div className="max-w-7xl mx-auto px-6 py-20 relative">
          <div className="text-center mb-12">
            <Badge className="mb-6 bg-white/20 text-white border-white/30 text-lg px-6 py-2">
              <Sparkles className="w-5 h-5 mr-2" />
              AI-Powered Clinical Intelligence
            </Badge>
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
              CareMetric AI
            </h1>
            <p className="text-2xl md:text-3xl text-blue-100 mb-4">
              Reduce Documentation Time by 75%
            </p>
            <p className="text-xl text-blue-200 max-w-3xl mx-auto">
              Revolutionary AI platform that transforms home health and hospice documentation, 
              improves patient outcomes, and ensures compliance - all while saving you hours every day.
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 text-center">
              <div className="text-5xl font-bold text-white mb-2">75%</div>
              <div className="text-blue-100">Less Admin Time</div>
            </div>
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 text-center">
              <div className="text-5xl font-bold text-white mb-2">40%</div>
              <div className="text-blue-100">Fewer Readmissions</div>
            </div>
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 text-center">
              <div className="text-5xl font-bold text-white mb-2">99%</div>
              <div className="text-blue-100">Compliance Rate</div>
            </div>
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20 text-center">
              <div className="text-5xl font-bold text-white mb-2">$25K</div>
              <div className="text-blue-100">Annual Savings/Nurse</div>
            </div>
          </div>
        </div>
      </div>

      {/* The Problem Section */}
      <div className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              The Home Health Documentation Crisis
            </h2>
            <p className="text-xl text-gray-600">
              Nurses spend more time on paperwork than patient care
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <Card className="border-2 border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-900">
                  <Clock className="w-6 h-6" />
                  Time Drain
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-red-600 mb-2">2-3 hours</p>
                <p className="text-gray-700">spent on documentation per day</p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li>• 45-60 min per visit note</li>
                  <li>• Late nights completing charts</li>
                  <li>• Weekend catch-up work</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 border-orange-200 bg-orange-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-900">
                  <Shield className="w-6 h-6" />
                  Compliance Risk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-600 mb-2">$10K+</p>
                <p className="text-gray-700">average cost per denied claim</p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li>• Missing documentation</li>
                  <li>• Insufficient skilled need</li>
                  <li>• OASIS errors</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 border-yellow-200 bg-yellow-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-900">
                  <TrendingUp className="w-6 h-6" />
                  Poor Outcomes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-yellow-600 mb-2">25%</p>
                <p className="text-gray-700">30-day readmission rate</p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li>• Reactive vs. proactive care</li>
                  <li>• Missed risk indicators</li>
                  <li>• Delayed interventions</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* The Solution */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              The CareMetric AI Solution
            </h2>
            <p className="text-xl text-gray-600">
              Transform your practice with intelligent automation
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card className="border-2 border-blue-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-6 h-6 text-blue-600" />
                  Smart Note Assistant
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Voice-to-Note in Seconds</p>
                      <p className="text-sm text-gray-600">Dictate while driving, AI generates complete SOAP notes</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Medicare-Compliant</p>
                      <p className="text-sm text-gray-600">Automatic skilled need justification and terminology</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Real-Time Compliance Checks</p>
                      <p className="text-sm text-gray-600">Catch issues before submission</p>
                    </div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg mt-4">
                    <p className="text-sm font-semibold text-green-900">⏱️ Time Saved:</p>
                    <p className="text-2xl font-bold text-green-600">40-50 min per note</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-purple-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                  Predictive Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Early Risk Detection</p>
                      <p className="text-sm text-gray-600">AI predicts readmission, falls, decline before they happen</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Automated Interventions</p>
                      <p className="text-sm text-gray-600">Pre-filled action plans for high-risk patients</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Proactive Care</p>
                      <p className="text-sm text-gray-600">Shift from reactive to preventive medicine</p>
                    </div>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg mt-4">
                    <p className="text-sm font-semibold text-purple-900">📊 Outcome Improvement:</p>
                    <p className="text-2xl font-bold text-purple-600">40% fewer readmissions</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-green-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCheck className="w-6 h-6 text-green-600" />
                  OASIS Excellence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">AI-Powered Assistance</p>
                      <p className="text-sm text-gray-600">Smart suggestions for M-items based on visit notes</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Error Prevention</p>
                      <p className="text-sm text-gray-600">Catch inconsistencies before submission</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">PDGM Optimization</p>
                      <p className="text-sm text-gray-600">Maximize appropriate reimbursement</p>
                    </div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg mt-4">
                    <p className="text-sm font-semibold text-green-900">✅ Accuracy:</p>
                    <p className="text-2xl font-bold text-green-600">99% first-pass rate</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-indigo-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="w-6 h-6 text-indigo-600" />
                  Patient Education
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Personalized Materials</p>
                      <p className="text-sm text-gray-600">AI generates content specific to each patient</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">6 Languages</p>
                      <p className="text-sm text-gray-600">Reach diverse patient populations</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold">Engagement Tracking</p>
                      <p className="text-sm text-gray-600">Monitor which patients reviewed materials</p>
                    </div>
                  </div>
                  <div className="bg-indigo-50 p-4 rounded-lg mt-4">
                    <p className="text-sm font-semibold text-indigo-900">📈 Engagement:</p>
                    <p className="text-2xl font-bold text-indigo-600">85% completion rate</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ROI Section */}
      <div className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Return on Investment
            </h2>
            <p className="text-xl text-gray-600">
              CareMetric AI pays for itself in the first month
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-6">For Individual Nurses</h3>
              <div className="space-y-4">
                <div className="bg-blue-50 p-6 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-700 font-medium">Time saved per day</span>
                    <span className="text-2xl font-bold text-blue-600">2.5 hours</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-700 font-medium">Overtime reduction</span>
                    <span className="text-2xl font-bold text-green-600">$15,000/yr</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-700 font-medium">More patient visits</span>
                    <span className="text-2xl font-bold text-purple-600">+2 per day</span>
                  </div>
                  <div className="border-t-2 border-blue-200 pt-3 mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-900 font-bold">Total Value</span>
                      <span className="text-3xl font-bold text-blue-600">$25,000/yr</span>
                    </div>
                  </div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm font-semibold text-green-900 mb-2">💡 Better Work-Life Balance</p>
                  <p className="text-sm text-gray-700">No more late nights finishing charts. Get home on time.</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-6">For Agencies</h3>
              <div className="space-y-4">
                <div className="bg-purple-50 p-6 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-700 font-medium">Deny rate improvement</span>
                    <span className="text-2xl font-bold text-purple-600">-50%</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-700 font-medium">Revenue per claim</span>
                    <span className="text-2xl font-bold text-green-600">+$500</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-700 font-medium">Readmission reduction</span>
                    <span className="text-2xl font-bold text-blue-600">-40%</span>
                  </div>
                  <div className="border-t-2 border-purple-200 pt-3 mt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-900 font-bold">Per 10 Nurses</span>
                      <span className="text-3xl font-bold text-purple-600">$250K/yr</span>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm font-semibold text-blue-900 mb-2">🎯 Improved Star Ratings</p>
                  <p className="text-sm text-gray-700">Better outcomes = higher star ratings = more referrals</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Testimonials */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              What Nurses Are Saying
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="bg-white">
              <CardHeader>
                <div className="flex gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <CardTitle className="text-lg">Life-Changing</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 mb-4">
                  "I used to spend 2-3 hours every night finishing notes. Now I'm done before I leave my last visit. 
                  CareMetric AI gave me my evenings back."
                </p>
                <p className="text-sm font-semibold text-gray-900">- Sarah M., RN</p>
                <p className="text-xs text-gray-600">Home Health Nurse, 12 years</p>
              </CardContent>
            </Card>

            <Card className="bg-white">
              <CardHeader>
                <div className="flex gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <CardTitle className="text-lg">Better Patient Care</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 mb-4">
                  "The predictive analytics caught a high readmission risk I would have missed. 
                  We intervened early and kept my patient out of the hospital."
                </p>
                <p className="text-sm font-semibold text-gray-900">- James L., RN BSN</p>
                <p className="text-xs text-gray-600">Clinical Manager</p>
              </CardContent>
            </Card>

            <Card className="bg-white">
              <CardHeader>
                <div className="flex gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <CardTitle className="text-lg">Zero Denials</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 mb-4">
                  "Our deny rate dropped from 8% to less than 1%. The compliance checks catch everything. 
                  Our revenue is up significantly."
                </p>
                <p className="text-sm font-semibold text-gray-900">- Maria G.</p>
                <p className="text-xs text-gray-600">Agency Director</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Ready to Transform Your Practice?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join thousands of nurses who have reclaimed their time and improved patient outcomes
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50 text-lg px-8 py-6">
              Start Free Trial
            </Button>
            <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/10 text-lg px-8 py-6">
              Schedule Demo
            </Button>
          </div>
          <p className="text-sm text-blue-200 mt-6">
            No credit card required • 14-day free trial • Cancel anytime
          </p>
        </div>
      </div>
    </div>
  );
}