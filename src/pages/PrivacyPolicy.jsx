import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-gray-600">Last Updated: December 28, 2024</p>
        </div>

        <Card>
          <CardContent className="p-8 space-y-6 text-gray-700">
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">1. Introduction</h2>
              <p>
                CareMetric AI ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our service. This policy complies with HIPAA regulations and applicable data protection laws.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">2. Information We Collect</h2>
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Account Information</h3>
                  <p>Name, email address, phone number, professional credentials, and login credentials.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Patient Health Information (PHI)</h3>
                  <p>Clinical notes, patient demographics, vital signs, care plans, and other health-related data you input into the system.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Usage Data</h3>
                  <p>Log data, device information, IP addresses, and interaction with our service.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Payment Information</h3>
                  <p>Payment card details and billing information (processed securely through Stripe or Apple).</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">3. How We Use Your Information</h2>
              <p className="mb-2">We use collected information to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide and maintain the Service</li>
                <li>Process your transactions and subscriptions</li>
                <li>Generate AI-powered documentation and clinical insights</li>
                <li>Improve our algorithms and service features</li>
                <li>Send administrative communications</li>
                <li>Ensure compliance with healthcare regulations</li>
                <li>Detect and prevent fraud or security issues</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">4. HIPAA Compliance</h2>
              <p>
                CareMetric AI is HIPAA compliant. We act as a Business Associate and have implemented appropriate administrative, physical, and technical safeguards to protect Protected Health Information (PHI). We enter into Business Associate Agreements (BAA) with covered entities as required.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">5. Data Sharing and Disclosure</h2>
              <p className="mb-2">We do not sell your personal information. We may share information with:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Service Providers:</strong> Third-party vendors who assist in operating our service (e.g., cloud hosting, payment processing)</li>
                <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
                <li><strong>With Your Consent:</strong> When you explicitly authorize sharing</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">6. Data Security</h2>
              <p className="mb-2">We implement industry-standard security measures including:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Encryption of data in transit and at rest</li>
                <li>Access controls and authentication</li>
                <li>Regular security audits and monitoring</li>
                <li>Secure data centers with physical security</li>
                <li>Employee training on privacy and security</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">7. Data Retention</h2>
              <p>
                We retain your information for as long as your account is active or as needed to provide services. PHI is retained according to legal requirements and your organization's policies. You may request deletion of your data at any time, subject to legal obligations.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">8. Your Rights</h2>
              <p className="mb-2">You have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Access your personal information</li>
                <li>Correct inaccurate data</li>
                <li>Request deletion of your data</li>
                <li>Export your data</li>
                <li>Opt-out of marketing communications</li>
                <li>Lodge a complaint with a supervisory authority</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">9. Children's Privacy</h2>
              <p>
                Our Service is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">10. International Data Transfers</h2>
              <p>
                Your information may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place for such transfers.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">11. Changes to Privacy Policy</h2>
              <p>
                We may update this Privacy Policy periodically. We will notify you of material changes via email or in-app notification. Continued use after changes constitutes acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">12. Contact Us</h2>
              <p>
                For privacy-related questions or to exercise your rights, contact us at:<br />
                <strong>Email:</strong> privacy@caremetricai.com<br />
                <strong>Privacy Officer:</strong> CareMetric AI, Inc.<br />
                <strong>Address:</strong> [Your Business Address]
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}