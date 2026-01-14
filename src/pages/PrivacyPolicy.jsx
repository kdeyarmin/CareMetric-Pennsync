import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

export const publicPage = true;

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">CareMetric AI – Privacy Policy</h1>
          <p className="text-gray-600">Version: v1.0 | Document ID: CM-PP-001</p>
          <p className="text-gray-600">Last Updated: January 13, 2026</p>
        </div>

        <Card>
          <CardContent className="p-8 space-y-6 text-gray-700">
            <section>
              <p>
                CareMetric AI collects and processes information in compliance with HIPAA and Pennsylvania law.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Information Collected:</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Account information</li>
                <li>Usage metadata</li>
                <li>PHI as directed by customers</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Security:</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Encryption in transit and at rest</li>
                <li>Access controls</li>
                <li>Audit logging</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Contact:</h2>
              <p>
                <strong>Email:</strong> Info@caremetricai.com
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}