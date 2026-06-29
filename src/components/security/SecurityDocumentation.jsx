import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Lock,
  Eye,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Server,
  Database,
  Cloud
} from "lucide-react";

/**
 * Security Documentation Component
 * Provides transparency about security measures and compliance
 */
export default function SecurityDocumentation() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            Penn Sync Security Architecture
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Encryption at Rest */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Lock className="w-5 h-5 text-green-600" />
              Encryption at Rest
              <Badge className="bg-green-500">Active</Badge>
            </h3>
            <Alert className="bg-green-50 border-green-200">
              <AlertDescription className="text-green-900">
                <p className="font-semibold mb-2">✓ Enterprise-Grade Encryption</p>
                <p className="mb-2">All patient data (PHI) is encrypted at rest using the Penn Sync platform's AES-256 encryption.</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Patient records</li>
                  <li>Visit documentation</li>
                  <li>Clinical notes and narratives</li>
                  <li>Vital signs data</li>
                  <li>Audit logs</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* Encryption in Transit */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-600" />
              Encryption in Transit
              <Badge className="bg-blue-500">Active</Badge>
            </h3>
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-900">
                <p className="font-semibold mb-2">✓ TLS/HTTPS Protection</p>
                <p className="mb-2">All data transmitted between your browser and Penn Sync servers is encrypted using TLS 1.2+</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>API calls are HTTPS-only</li>
                  <li>File uploads are encrypted in transit</li>
                  <li>Authentication tokens are secure</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* Access Control */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Eye className="w-5 h-5 text-navy-600" />
              Row-Level Security (RLS)
              <Badge className="bg-navy-500">Active</Badge>
            </h3>
            <Alert className="bg-navy-50 border-navy-200">
              <AlertDescription className="text-navy-900">
                <p className="font-semibold mb-2">✓ Granular Access Control</p>
                <p className="mb-2">Users can only access data they created or are assigned to:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Nurses can only view their own patients and visits</li>
                  <li>Administrators have full access for oversight</li>
                  <li>Patient records isolated between users</li>
                  <li>Visit documentation restricted to creator</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* Audit Logging */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              Comprehensive Audit Logging
              <Badge className="bg-orange-500">Active</Badge>
            </h3>
            <Alert className="bg-orange-50 border-orange-200">
              <AlertDescription className="text-orange-900">
                <p className="font-semibold mb-2">✓ Complete Audit Trail</p>
                <p className="mb-2">All security-relevant actions are logged:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Patient record access and modifications</li>
                  <li>Visit documentation creation and updates</li>
                  <li>Failed access attempts</li>
                  <li>Data exports and email sends</li>
                  <li>AI API calls for documentation</li>
                  <li>User login and logout events</li>
                  <li>Session timeouts</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* Session Management */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-600" />
              Session Management
              <Badge className="bg-indigo-500">Active</Badge>
            </h3>
            <Alert className="bg-indigo-50 border-indigo-200">
              <AlertDescription className="text-indigo-900">
                <p className="font-semibold mb-2">✓ Automatic Timeout Protection</p>
                <p className="mb-2">Sessions automatically expire to protect PHI:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>15-minute inactivity timeout</li>
                  <li>2-minute warning before expiration</li>
                  <li>Sensitive data cleared on logout</li>
                  <li>Session activity monitoring</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* Input Sanitization */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-navy-600" />
              Input Validation & Sanitization
              <Badge className="bg-navy-500">Active</Badge>
            </h3>
            <Alert className="bg-navy-50 border-navy-200">
              <AlertDescription className="text-navy-900">
                <p className="font-semibold mb-2">✓ XSS Protection</p>
                <p className="mb-2">All user input is sanitized before storage:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Removal of malicious scripts</li>
                  <li>Email and phone validation</li>
                  <li>File upload validation (type, size, extension)</li>
                  <li>SQL injection prevention via parameterized queries</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* AI Security */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Database className="w-5 h-5 text-gold-600" />
              AI Integration Security
              <Badge className="bg-gold-500">Active</Badge>
            </h3>
            <Alert className="bg-gold-50 border-gold-200">
              <AlertDescription className="text-gold-900">
                <p className="font-semibold mb-2">✓ Secure AI Processing</p>
                <p className="mb-2">AI-powered features include security controls:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Rate limiting (20 calls per minute per user)</li>
                  <li>All AI calls are logged for audit</li>
                  <li>PHI sent to HIPAA-compliant AI services</li>
                  <li>Business Associate Agreement (BAA) in place</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* HIPAA Compliance */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-600" />
              HIPAA Compliance Status
            </h3>
            <Alert className="bg-gradient-to-r from-red-50 to-gold-50 border-red-200">
              <AlertDescription className="text-red-900">
                <p className="font-semibold mb-3">Penn Sync HIPAA Security Rule Compliance:</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Encryption at Rest</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Encryption in Transit</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Access Controls</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Audit Logging</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Session Management</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Input Validation</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Role-Based Access</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Rate Limiting</span>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          </div>

          {/* Data Retention */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Data Retention & Backup</h3>
            <Alert>
              <AlertDescription className="text-slate-700">
                <p className="mb-2">Penn Sync maintains secure backups and follows healthcare data retention requirements:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Automated encrypted backups</li>
                  <li>7-year data retention (HIPAA compliance)</li>
                  <li>Disaster recovery procedures</li>
                  <li>Backup encryption matches production standards</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>

          {/* User Responsibilities */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              User Responsibilities
            </h3>
            <Alert className="bg-yellow-50 border-yellow-300">
              <AlertDescription className="text-yellow-900">
                <p className="font-semibold mb-2">⚠️ To maintain security, users must:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Use strong, unique passwords</li>
                  <li>Never share login credentials</li>
                  <li>Log out when leaving workstation</li>
                  <li>Report suspicious activity immediately</li>
                  <li>Complete required security training</li>
                  <li>Use secure networks (avoid public WiFi for PHI access)</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}