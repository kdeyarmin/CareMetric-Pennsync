import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, MessageSquare, Phone, FileText, HelpCircle, Book } from "lucide-react";

export const publicPage = true;

export default function Support() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4 py-8">
          <h1 className="text-5xl font-bold text-gray-900">Support Center</h1>
          <p className="text-xl text-gray-600">
            We're here to help you get the most out of CareMetric AI
          </p>
        </div>

        {/* Contact Methods */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-2 border-gray-200 hover:shadow-xl transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <Mail className="w-8 h-8 text-blue-600" />
                Email Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Send us a detailed message and we'll respond within 24 hours
              </p>
              <a 
                href="mailto:support@caremetricai.com"
                className="text-blue-600 hover:text-blue-800 font-semibold"
              >
                support@caremetricai.com
              </a>
            </CardContent>
          </Card>

          <Card className="border-2 border-gray-200 hover:shadow-xl transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <Phone className="w-8 h-8 text-green-600" />
                Phone Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Speak directly with our support team
              </p>
              <p className="text-green-600 font-semibold text-lg">
                Available soon
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Mon-Fri, 9am-5pm EST
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-gray-200 hover:shadow-xl transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <MessageSquare className="w-8 h-8 text-purple-600" />
                Live Chat
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Get instant help from our AI assistant
              </p>
              <p className="text-purple-600 font-semibold">
                Available in-app
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Click the chat icon in the app
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Help Topics */}
        <Card className="border-2 border-indigo-300">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-3">
              <HelpCircle className="w-8 h-8 text-indigo-600" />
              Quick Help Topics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Getting Started
                </h3>
                <ul className="ml-7 space-y-1 text-gray-600">
                  <li>• Creating your first patient record</li>
                  <li>• Using Smart Notes</li>
                  <li>• Voice dictation setup</li>
                  <li>• Mobile app usage</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Book className="w-5 h-5 text-green-600" />
                  Documentation
                </h3>
                <ul className="ml-7 space-y-1 text-gray-600">
                  <li>• Medicare compliance requirements</li>
                  <li>• Visit documentation best practices</li>
                  <li>• Care plan management</li>
                  <li>• OASIS integration</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-purple-600" />
                  Account & Billing
                </h3>
                <ul className="ml-7 space-y-1 text-gray-600">
                  <li>• Subscription management</li>
                  <li>• Payment methods</li>
                  <li>• Cancellation policy</li>
                  <li>• Refund requests</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Mail className="w-5 h-5 text-red-600" />
                  Technical Issues
                </h3>
                <ul className="ml-7 space-y-1 text-gray-600">
                  <li>• Login problems</li>
                  <li>• Sync issues</li>
                  <li>• Performance optimization</li>
                  <li>• Bug reports</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Response Time */}
        <Card className="bg-blue-50 border-2 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="bg-blue-600 rounded-full p-3">
                <MessageSquare className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Expected Response Times</h3>
                <p className="text-gray-700 mt-1">
                  <strong>Email:</strong> Within 24 hours (weekdays) • 
                  <strong className="ml-2">In-App Chat:</strong> Instant AI assistance
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  For urgent technical issues affecting patient care, please mark your email as "URGENT"
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Additional Resources */}
        <Card className="border-2 border-gray-200">
          <CardHeader>
            <CardTitle className="text-2xl">Additional Resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <a 
                href="mailto:support@caremetricai.com?subject=Feature%20Request"
                className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <MessageSquare className="w-6 h-6 text-indigo-600" />
                <div>
                  <div className="font-semibold text-gray-900">Feature Requests</div>
                  <div className="text-sm text-gray-600">Suggest new features</div>
                </div>
              </a>

              <a 
                href="mailto:support@caremetricai.com?subject=Bug%20Report"
                className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <FileText className="w-6 h-6 text-red-600" />
                <div>
                  <div className="font-semibold text-gray-900">Report a Bug</div>
                  <div className="text-sm text-gray-600">Help us improve</div>
                </div>
              </a>

              <a 
                href="mailto:sales@caremetricai.com"
                className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Mail className="w-6 h-6 text-green-600" />
                <div>
                  <div className="font-semibold text-gray-900">Sales Inquiries</div>
                  <div className="text-sm text-gray-600">Agency or team plans</div>
                </div>
              </a>

              <a 
                href="mailto:support@caremetricai.com?subject=Training%20Request"
                className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Book className="w-6 h-6 text-blue-600" />
                <div>
                  <div className="font-semibold text-gray-900">Training & Onboarding</div>
                  <div className="text-sm text-gray-600">Schedule a demo</div>
                </div>
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-gray-600 py-6">
          <p>For HIPAA-related questions or security concerns, please email: <a href="mailto:security@caremetricai.com" className="text-blue-600 hover:underline">security@caremetricai.com</a></p>
        </div>
      </div>
    </div>
  );
}