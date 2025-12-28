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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Use</h1>
          <p className="text-gray-600">Last Updated: December 28, 2024</p>
        </div>

        <Card>
          <CardContent className="p-8 space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing and using CareMetric AI ("the Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to these terms, please do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">2. Description of Service</h2>
              <p>
                CareMetric AI provides AI-powered clinical documentation, compliance monitoring, and care management tools for home health and hospice nurses. The Service is designed to assist healthcare professionals in their documentation and patient care workflows.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">3. User Responsibilities</h2>
              <p className="mb-2">As a user of CareMetric AI, you agree to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide accurate and complete information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Use the Service in compliance with all applicable laws and regulations</li>
                <li>Not share your account with unauthorized users</li>
                <li>Verify all AI-generated content before clinical use</li>
                <li>Comply with HIPAA and other healthcare privacy regulations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">4. Professional Responsibility</h2>
              <p>
                CareMetric AI is a tool to assist healthcare professionals. All clinical decisions and documentation remain the responsibility of the licensed healthcare provider. Users must verify all AI-generated suggestions and content before use in patient care.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">5. Subscription and Payment</h2>
              <p className="mb-2">
                Access to certain features requires a paid subscription. By subscribing, you agree to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Pay all applicable subscription fees</li>
                <li>Automatic renewal unless cancelled before the renewal date</li>
                <li>Subscription fees are non-refundable except as required by law</li>
                <li>Pricing may change with 30 days notice</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">6. Data Ownership and Usage</h2>
              <p>
                You retain ownership of all data you input into the Service. We use your data solely to provide and improve the Service. See our Privacy Policy for detailed information about data handling.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">7. Intellectual Property</h2>
              <p>
                The Service, including all software, algorithms, and content, is owned by CareMetric AI and is protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works without explicit permission.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">8. Limitation of Liability</h2>
              <p>
                CareMetric AI provides the Service "as is" without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the Service. Our total liability shall not exceed the amount you paid for the Service in the 12 months preceding the claim.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">9. Termination</h2>
              <p>
                We reserve the right to suspend or terminate your access to the Service at any time for violation of these terms or for any other reason. Upon termination, you must cease all use of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">10. Changes to Terms</h2>
              <p>
                We may modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the modified terms. We will notify users of material changes via email or in-app notification.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">11. Contact Information</h2>
              <p>
                For questions about these terms, please contact us at:<br />
                <strong>Email:</strong> legal@caremetricai.com<br />
                <strong>Address:</strong> CareMetric AI, Inc.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}