import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield, FileText, Target, Sparkles, CheckCircle2, Brain
} from "lucide-react";

export const publicPage = true;

export default function About() {
  const coreFeatures = [
    {
      icon: Shield,
      title: "AI Compliance Review",
      description: "Paste any healthcare note and get instant compliance review against Medicare, Medicaid, and payer requirements. Works for all provider types.",
      color: "from-blue-500 to-cyan-500"
    },

    {
      icon: FileText,
      title: "Medical Scribe",
      description: "Record entire patient interactions and AI converts them into compliant clinical notes. No more documenting during visits.",
      color: "from-purple-500 to-pink-500"
    },
    {
      icon: Target,
      title: "Auto Care Plans & Billing Codes",
      description: "AI generates evidence-based care plans for nurses and suggests appropriate billing codes (CPT/ICD-10) for providers.",
      color: "from-orange-500 to-red-500"
    }
  ];

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Hero */}
        <div className="text-center space-y-4">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
            alt="CareMetric AI"
            className="w-24 h-24 mx-auto object-contain"
          />
          <h1 className="text-5xl font-bold text-gray-900">CareMetric AI</h1>
          <p className="text-2xl text-blue-600 font-semibold">
            AI-Powered Compliance Review for Healthcare Documentation
          </p>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Any healthcare provider can paste their notes for instant compliance review. 
            Plus telehealth, medical scribe, and automated care planning/billing code suggestions.
          </p>
        </div>

        {/* Core Features */}
        <div className="grid md:grid-cols-2 gap-6">
          {coreFeatures.map((feature, idx) => (
            <Card key={idx} className="border-2 hover:shadow-xl transition-all">
              <CardHeader>
                <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4`}>
                  <feature.icon className="w-8 h-8 text-white" />
                </div>
                <CardTitle className="text-2xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Who It's For */}
        <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
          <CardHeader>
            <CardTitle className="text-3xl text-center">Who Is This For?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center space-y-3">
                <Brain className="w-12 h-12 text-purple-600 mx-auto" />
                <h3 className="text-xl font-bold">All Healthcare Providers</h3>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• Physicians (MD, DO)</li>
                  <li>• Nurse Practitioners (NP)</li>
                  <li>• Physician Assistants (PA)</li>
                  <li>• Registered Nurses (RN)</li>
                  <li>• Licensed Practical Nurses (LPN)</li>
                </ul>
              </div>
              <div className="text-center space-y-3">
                <Sparkles className="w-12 h-12 text-blue-600 mx-auto" />
                <h3 className="text-xl font-bold">Therapy Providers</h3>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• Physical Therapists (PT)</li>
                  <li>• Occupational Therapists (OT)</li>
                  <li>• Speech Therapists (ST)</li>
                  <li>• Chiropractors</li>
                </ul>
              </div>
              <div className="text-center space-y-3">
               <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
               <h3 className="text-xl font-bold">Other Disciplines</h3>
               <ul className="text-sm text-gray-700 space-y-1">
                 <li>• Medical Social Workers (MSW)</li>
                 <li>• Home Health Providers</li>
                 <li>• Hospice Providers</li>
                 <li>• Private Practice Clinicians</li>
               </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How It Works */}
        <Card className="border-2 border-blue-300">
          <CardHeader>
            <CardTitle className="text-3xl text-center">How It Works</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xl">1</div>
                <div>
                  <h3 className="text-xl font-bold mb-2">Paste Your Note</h3>
                  <p className="text-gray-600">Copy and paste any clinical note from your EHR - works with any format or system.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xl">2</div>
                <div>
                  <h3 className="text-xl font-bold mb-2">AI Reviews for Compliance</h3>
                  <p className="text-gray-600">AI analyzes against Medicare, Medicaid, and payer requirements. Get a compliance score and see what's missing.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xl">3</div>
                <div>
                  <h3 className="text-xl font-bold mb-2">Apply Fixes & Copy Back</h3>
                  <p className="text-gray-600">Use one-click fixes or enhance the full note. Copy the compliant version back to your EHR.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* HIPAA & Security */}
        <Card className="border-2 border-green-300 bg-green-50">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Shield className="w-6 h-6 text-green-600" />
              HIPAA Compliant & Secure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span>Bank-level encryption for all data</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span>Full HIPAA compliance with Business Associate Agreement</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span>Secure data storage with regular audits</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span>No data shared with third parties</span>
            </div>
          </CardContent>
        </Card>

        {/* Legal Documents */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Terms of Use</CardTitle>
            </CardHeader>
            <CardContent>
              <a 
                href="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/3e29f0f2b_CareMetric_AI_Terms_of_Use1.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Download PDF
              </a>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Business Associate Agreement</CardTitle>
            </CardHeader>
            <CardContent>
              <a 
                href="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/66f812e1a_CareMetric_AI_BAA.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Download PDF
              </a>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Privacy Policy</CardTitle>
            </CardHeader>
            <CardContent>
              <a 
                href="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/739d2eba9_CareMetric_AI_Privacy_Policy.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Download PDF
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}