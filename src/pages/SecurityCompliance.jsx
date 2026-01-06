import React from "react";
import SecurityMonitor from "../components/security/SecurityMonitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Lock, Eye, FileText, AlertTriangle, CheckCircle } from "lucide-react";

export default function SecurityCompliance() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Security & HIPAA Compliance
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Monitor security measures and ensure HIPAA compliance
            </p>
          </div>
          <Shield className="w-12 h-12 text-blue-600" />
        </div>

        <SecurityMonitor />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Security Measures
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">End-to-End Encryption</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      All PHI is encrypted using AES-256 encryption at rest and TLS 1.3 in transit
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Row-Level Security</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Database policies ensure users only access authorized patient data
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Session Management</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Automatic timeout after 15 minutes of inactivity per HIPAA requirements
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Secure Authentication</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Multi-factor authentication and secure password policies
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Audit & Compliance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Comprehensive Audit Logs</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      All PHI access, modifications, and exports are logged with timestamps
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Breach Detection</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Automated monitoring for suspicious access patterns and potential breaches
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Data Minimization</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Only necessary PHI is exposed based on user role and purpose
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold">Secure Deletion</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Right to be forgotten with audit trail for all deletions
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              HIPAA Technical Safeguards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold">Access Control (§164.312(a)(1))</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                  <li>Unique user identification</li>
                  <li>Emergency access procedures</li>
                  <li>Automatic logoff</li>
                  <li>Encryption and decryption</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Audit Controls (§164.312(b))</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                  <li>Activity logging and monitoring</li>
                  <li>User access tracking</li>
                  <li>PHI modification records</li>
                  <li>Export audit trail</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Integrity (§164.312(c)(1))</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                  <li>Data integrity validation</li>
                  <li>Unauthorized alteration protection</li>
                  <li>Change tracking</li>
                  <li>Version control</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold">Transmission Security (§164.312(e)(1))</h3>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                  <li>TLS 1.3 encryption</li>
                  <li>Secure API communications</li>
                  <li>Network segmentation</li>
                  <li>Data in transit protection</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}