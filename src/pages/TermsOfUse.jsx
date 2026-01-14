import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

export const publicPage = true;

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">CareMetric AI – Terms of Service</h1>
          <p className="text-gray-600">Version: v1.0 | Document ID: CM-TOS-001</p>
          <p className="text-gray-600">Last Updated: January 13, 2026</p>
        </div>

        <Card>
          <CardContent className="p-8 space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">1. Introduction</h2>
              <p>
                These Terms of Service ("Terms") govern access to and use of the CareMetric AI platform 
                ("Service") provided by CareMetric AI, LLC, a Pennsylvania limited liability company ("CareMetric"). 
                By using the Service, you agree to these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">2. Nature of the Service</h2>
              <p>
                CareMetric AI provides assistive documentation and workflow tools only. The Service does not 
                provide medical advice, diagnosis, treatment, or clinical decision-making.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">3. User Responsibilities</h2>
              <p>
                Users remain solely responsible for accuracy, completeness, clinical judgment, and regulatory 
                compliance.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">4. Accounts and Security</h2>
              <p>
                Users must safeguard credentials and promptly report unauthorized access.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">5. Fees and Payment</h2>
              <p>
                Fees are governed by subscription or enterprise agreements.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">6. Intellectual Property</h2>
              <p>
                CareMetric retains all rights to the Service. Users retain ownership of their data subject to the BAA.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">7. Disclaimers</h2>
              <p className="font-semibold">
                THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">8. Limitation of Liability</h2>
              <p>
                CareMetric's liability shall not exceed fees paid in the prior 12 months.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">9. Governing Law</h2>
              <p>
                Pennsylvania law governs these Terms.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}