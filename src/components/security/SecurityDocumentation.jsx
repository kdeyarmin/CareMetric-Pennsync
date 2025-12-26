import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  Lock,
  Eye,
  Database,
  FileText,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";

export default function SecurityDocumentation() {
  return (
    <div className="space-y-6">
      <Card className="border-2 border-indigo-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-600" />
            CareMetric AI Security & HIPAA Compliance Documentation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-700">
            This document outlines the security measures and HIPAA compliance safeguards implemented in CareMetric AI.
          </p>
        </CardContent>
      </Card>

      <ScrollArea className="h-[700px]">
        <div className="space-y-6 pr-4">
          {/* Administrative Safeguards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Administrative Safeguards
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Security Management Process</h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• Risk analysis conducted through automated security audits</li>
                  <li>• Risk management through role-based access controls</li>
                  <li>• Regular security audit capabilities built into the system</li>
                  <li>• Information system activity review via audit logs</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Assigned Security Responsibility</h4>
                <p className="text-sm text-gray-700">
                  System administrators are designated as security officials with access to security audit tools and user management.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Workforce Security</h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• Authorization and supervision through role-based system</li>
                  <li>• Workforce clearance procedures via invitation-only access</li>
                  <li>• Termination procedures: Immediate access revocation capability</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Information Access Management</h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• Access authorization through role assignment</li>
                  <li>• Access establishment and modification via admin controls</li>
                  <li>• Minimum necessary access enforced through RLS policies</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Security Awareness and Training</h4>
                <Alert className="bg-yellow-50 border-yellow-300">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                  <AlertDescription className="text-sm text-yellow-900">
                    <strong>Required:</strong> Organizations must provide HIPAA security awareness training to all users annually.
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>

          {/* Physical Safeguards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="w-5 h-5 text-green-600" />
                Physical Safeguards
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Facility Access Controls</h4>
                <p className="text-sm text-gray-700">
                  Infrastructure managed by Supabase/Base44 with enterprise-grade physical security:
                </p>
                <ul className="text-sm text-gray-700 space-y-1 ml-4 mt-2">
                  <li>• SOC 2 Type II certified data centers</li>
                  <li>• 24/7 physical security monitoring</li>
                  <li>• Biometric access controls</li>
                  <li>• Video surveillance</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Workstation Security</h4>
                <Alert className="bg-blue-50 border-blue-300">
                  <AlertDescription className="text-sm text-blue-900">
                    <strong>User Responsibility:</strong> Users should enable device-level encryption and use secure, password-protected devices.
                  </AlertDescription>
                </Alert>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Device and Media Controls</h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• Data retention policies configurable per user</li>
                  <li>• Secure disposal through data deletion features</li>
                  <li>• Media re-use through secure overwrite</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Technical Safeguards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-600" />
                Technical Safeguards
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Access Control
                </h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• <strong>Unique User Identification:</strong> Each user has unique credentials</li>
                  <li>• <strong>Emergency Access:</strong> Admin role provides emergency access capabilities</li>
                  <li>• <strong>Automatic Logoff:</strong> Session timeout enforced by platform</li>
                  <li>• <strong>Encryption:</strong> All data encrypted in transit (HTTPS/TLS) and at rest (AES-256)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Audit Controls
                </h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• <strong>Activity Logging:</strong> UserActivity entity tracks all user actions</li>
                  <li>• <strong>Security Logging:</strong> SecurityLog entity tracks security events</li>
                  <li>• <strong>Audit Trail:</strong> All entities include created_by, created_date, updated_date</li>
                  <li>• <strong>Immutable Logs:</strong> Logs cannot be modified after creation</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Integrity Controls
                </h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• <strong>Row Level Security (RLS):</strong> Database-level access policies</li>
                  <li>• <strong>Data Validation:</strong> Input validation prevents data corruption</li>
                  <li>• <strong>Checksums:</strong> Platform ensures data integrity</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Transmission Security
                </h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• <strong>Encryption:</strong> TLS 1.2+ for all data transmission</li>
                  <li>• <strong>Network Segmentation:</strong> Managed by platform infrastructure</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Data Protection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="w-5 h-5 text-orange-600" />
                PHI Protection Measures
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Row Level Security (RLS) Policies</h4>
                <div className="bg-gray-50 p-3 rounded text-sm">
                  <p className="font-semibold mb-2">Entities with RLS:</p>
                  <ul className="space-y-1 ml-4">
                    <li>• <Badge variant="outline">Patient</Badge> - No restrictions (nurse-specific data isolation)</li>
                    <li>• <Badge variant="outline">Visit</Badge> - Users see only their visits or admin-level access</li>
                    <li>• <Badge variant="outline">Incident</Badge> - Users see only their incidents or admin-level access</li>
                    <li>• <Badge variant="outline">SecurityLog</Badge> - Admin-only read/write</li>
                    <li>• <Badge variant="outline">UserActivity</Badge> - Admin-only read</li>
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Minimum Necessary Standard</h4>
                <p className="text-sm text-gray-700">
                  Users only access PHI necessary for their job function. RLS policies ensure:
                </p>
                <ul className="text-sm text-gray-700 space-y-1 ml-4 mt-2">
                  <li>• Nurses see only their assigned patients</li>
                  <li>• Admins can access all data for supervision and audit purposes</li>
                  <li>• Automated queries use service role only when necessary</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Data Retention</h4>
                <ul className="text-sm text-gray-700 space-y-1 ml-4">
                  <li>• Users can configure data retention preferences in Settings</li>
                  <li>• Options: Keep indefinitely or delete on logout</li>
                  <li>• Admins should establish organizational retention policies</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Business Associate Agreement */}
          <Card className="border-2 border-yellow-300 bg-yellow-50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-yellow-900">
                <AlertTriangle className="w-5 h-5" />
                Business Associate Agreement (BAA) - REQUIRED
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Alert className="bg-white border-yellow-400">
                <AlertDescription className="text-sm">
                  <strong>CRITICAL:</strong> Before using CareMetric AI with production PHI, you MUST:
                  <ul className="mt-2 space-y-1 ml-4">
                    <li>1. Sign a Business Associate Agreement (BAA) with Base44/Supabase</li>
                    <li>2. Ensure your organization has appropriate HIPAA policies and procedures</li>
                    <li>3. Complete HIPAA training for all users</li>
                    <li>4. Implement breach notification procedures</li>
                    <li>5. Conduct regular risk assessments</li>
                  </ul>
                  <p className="mt-3 font-semibold">
                    Contact Base44 support to initiate BAA execution.
                  </p>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Security Best Practices */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Security Best Practices for Users</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-gray-700 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>Strong Passwords:</strong> Use unique, complex passwords. Enable password manager if available.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>Device Security:</strong> Enable device encryption, use screen locks, and keep devices updated.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>Logout:</strong> Always log out when finished, especially on shared devices.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>Offline Data:</strong> Use offline mode only on encrypted devices. Clear cache regularly.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>Report Issues:</strong> Immediately report any security concerns or potential breaches.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>No Screenshots:</strong> Avoid taking screenshots of PHI. Use built-in export features.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span><strong>Secure Networks:</strong> Use VPN on public WiFi. Avoid accessing PHI on unsecured networks.</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Incident Response */}
          <Card className="border-2 border-red-300">
            <CardHeader>
              <CardTitle className="text-lg text-red-900">Breach Notification & Incident Response</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 mb-3">
                In the event of a suspected or confirmed security breach:
              </p>
              <ol className="text-sm text-gray-700 space-y-2 ml-4">
                <li>1. <strong>Immediate Action:</strong> Contain the breach - revoke access if necessary</li>
                <li>2. <strong>Document:</strong> Record details of the incident in SecurityLog</li>
                <li>3. <strong>Notify:</strong> Alert designated security official immediately</li>
                <li>4. <strong>Investigate:</strong> Review audit logs to determine scope of breach</li>
                <li>5. <strong>Remediate:</strong> Implement corrective actions to prevent recurrence</li>
                <li>6. <strong>Report:</strong> Notify affected individuals and HHS if required (within 60 days)</li>
              </ol>
              <Alert className="mt-4 bg-red-50 border-red-300">
                <AlertDescription className="text-sm text-red-900">
                  Organizations must have documented breach notification procedures compliant with 45 CFR §§ 164.400-414.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}