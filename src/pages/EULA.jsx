import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileCheck } from "lucide-react";

export const publicPage = true;

export default function EULA() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileCheck className="w-8 h-8 text-purple-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">End User License Agreement (EULA)</h1>
          <p className="text-gray-600">Last Updated: December 28, 2024</p>
        </div>

        <Card>
          <CardContent className="p-8 space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">1. License Grant</h2>
              <p>
                Subject to your compliance with this Agreement, CareMetric AI grants you a limited, non-exclusive, non-transferable, revocable license to access and use the CareMetric AI application and services for your internal business purposes in accordance with this EULA and our Terms of Use.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">2. Scope of License</h2>
              <p className="mb-2">This license allows you to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Install and use the application on devices you own or control</li>
                <li>Access cloud-based features through your subscription</li>
                <li>Create and store patient documentation</li>
                <li>Utilize AI-powered features for clinical documentation</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">3. License Restrictions</h2>
              <p className="mb-2">You agree NOT to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Copy, modify, or create derivative works of the application</li>
                <li>Reverse engineer, decompile, or disassemble the software</li>
                <li>Remove or alter any proprietary notices or labels</li>
                <li>Rent, lease, lend, sell, or sublicense the application</li>
                <li>Use the application for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to any systems or networks</li>
                <li>Interfere with or disrupt the service or servers</li>
                <li>Share your account credentials with others</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">4. Intellectual Property Rights</h2>
              <p>
                All rights, title, and interest in and to the CareMetric AI application, including all intellectual property rights, remain with CareMetric AI, Inc. This EULA does not grant you any rights to trademarks, service marks, or trade names.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">5. User Content and Data</h2>
              <p>
                You retain ownership of all patient data and content you create using the application. By using the service, you grant us a limited license to process, store, and transmit your content solely to provide the service. We will not use your patient data for any purpose other than providing the service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">6. Updates and Modifications</h2>
              <p>
                We may provide updates, patches, or modifications to the application. These updates may be automatically downloaded and installed. You agree to receive such updates as part of your use of the service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">7. Subscription Terms</h2>
              <p className="mb-2">For subscription-based access:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Subscriptions automatically renew unless cancelled</li>
                <li>Payment is charged at the start of each billing period</li>
                <li>You may cancel at any time through your account settings</li>
                <li>Refunds are subject to our refund policy</li>
                <li>For Apple IAP subscriptions, management is through iOS/macOS Settings</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">8. Medical Disclaimer</h2>
              <p>
                CareMetric AI is a tool to assist healthcare professionals. It does not replace professional medical judgment. All clinical decisions remain the sole responsibility of the licensed healthcare provider. You must verify all AI-generated content before use in patient care.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">9. HIPAA Compliance</h2>
              <p>
                You acknowledge that you are responsible for ensuring your use of the application complies with HIPAA and other applicable healthcare regulations. We provide the tools and safeguards, but proper use is your responsibility.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">10. Warranty Disclaimer</h2>
              <p>
                THE APPLICATION IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APPLICATION WILL BE UNINTERRUPTED, ERROR-FREE, OR COMPLETELY SECURE.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">11. Limitation of Liability</h2>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, CAREMETRIC AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">12. Termination</h2>
              <p>
                This license is effective until terminated. Your rights will terminate automatically without notice if you fail to comply with any term of this EULA. Upon termination, you must cease all use of the application and delete all copies.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">13. Governing Law</h2>
              <p>
                This EULA shall be governed by and construed in accordance with the laws of the United States, without regard to its conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">14. Contact Information</h2>
              <p>
                For questions about this EULA, please contact:<br />
                <strong>Email:</strong> legal@caremetricai.com<br />
                <strong>Company:</strong> CareMetric AI, Inc.
              </p>
            </section>

            <section>
              <p className="text-sm text-gray-600 mt-6 pt-6 border-t">
                By using CareMetric AI, you acknowledge that you have read, understood, and agree to be bound by this End User License Agreement.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}