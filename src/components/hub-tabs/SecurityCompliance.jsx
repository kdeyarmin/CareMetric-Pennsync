import React, { useState } from "react";
import { toLocalISODate } from "@/lib/dateLocal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Download,
  FileText,
  Activity,
  Database,
  Key,
  UserCheck,
  Clock,
  Server
} from "lucide-react";
import EncryptionStatusIndicator from "@/components/security/EncryptionStatusIndicator";
import AIAuditAnalyzer from "@/components/security/AIAuditAnalyzer";
import SecurityAuditScheduler from "@/components/security/SecurityAuditScheduler";
import SecurityLogUnavailable from "@/components/security/SecurityLogUnavailable";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";
import VulnerabilityAssessment from "@/components/security/VulnerabilityAssessment";
import { logActivity } from "@/components/utils/activityLogger";
import { useAuth } from "@/lib/AuthContext";
import { isAdminView } from "@/lib/roles";
import { buildSecurityComplianceReport } from "@/lib/securityComplianceReport";

export default function SecurityCompliance() {
  const [selectedTab, setSelectedTab] = useState("overview");
  const { user: currentUser } = useAuth();

  const isAdmin = isAdminView(currentUser);

  React.useEffect(() => {
    if (currentUser) {
      logActivity('view', {
        page: 'SecurityCompliance',
        section: selectedTab
      });
    }
  }, [currentUser, selectedTab]);

  const complianceChecks = [
    {
      name: "Data Encryption",
      status: "compliant",
      description: "All data encrypted at rest (AES-256) and in transit (TLS 1.2+)",
      icon: Lock,
      details: "Base44 platform provides automatic encryption"
    },
    {
      name: "Access Controls",
      status: "compliant",
      description: "Role-based access control (RBAC) implemented",
      icon: UserCheck,
      details: "Admin and user roles with appropriate permissions"
    },
    {
      name: "Audit Trails",
      status: "attention",
      description: "Security event verification unavailable",
      icon: FileText,
      details: "Immutable agency provenance and a tenant-authorized read broker are not yet verified"
    },
    {
      name: "Session Management",
      status: "compliant",
      description: "15-minute automatic timeout for inactive sessions",
      icon: Clock,
      details: "Automatic logout protects against unauthorized access"
    },
    {
      name: "Authentication",
      status: "compliant",
      description: "Secure token-based authentication",
      icon: Key,
      details: "JWT tokens with secure storage"
    },
    {
      name: "Data Integrity",
      status: "compliant",
      description: "All database operations tracked with timestamps",
      icon: Database,
      details: "Created/updated dates and user tracking on all records"
    },
    {
      name: "Secure APIs",
      status: "compliant",
      description: "All API endpoints require authentication",
      icon: Server,
      details: "No public endpoints exposing PHI"
    },
    {
      name: "Backup & Recovery",
      status: "compliant",
      description: "Automated daily backups (platform level)",
      icon: Database,
      details: "Base44 platform handles automated backups"
    }
  ];

  // The list above is a documented control INVENTORY, not a set of measurements.
  // Every entry asserts behaviour this frontend cannot fully probe. The audit
  // trail is explicitly unavailable until its tenant provenance is verified.
  // Every entry was previously hardcoded
  // `status: "compliant"`, so the HIPAA "% Compliant" figure was mathematically
  // pinned at 100% no matter the state of the system — and the checklist below
  // rendered a green "✓ Active" badge without consulting `status` at all.
  // Separate what is verified from what is merely attested, and report both.
  const assessedChecks = complianceChecks.map((check) => (
    check.name === 'Audit Trails'
      ? { ...check, attested: false, evidenceType: 'application_assessment', status: 'attention' }
      : { ...check, attested: true, evidenceType: 'platform_attestation', status: 'attested' }
  ));
  const verifiableChecks = assessedChecks.filter((c) => !c.attested);
  const verifiedCompliant = verifiableChecks.filter((c) => c.status === 'compliant').length;
  const attestedCount = assessedChecks.length - verifiableChecks.length;
  // Reported over the checks that are actually measured, never over the
  // attestations — an unmeasurable control must not inflate a compliance number.
  const complianceScore = verifiableChecks.length
    ? Math.round((verifiedCompliant / verifiableChecks.length) * 100)
    : 0;

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-2 border-red-200">
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
            <p className="text-slate-600">Only administrators can view security and compliance information.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-end">
        <Badge className={`text-lg px-4 py-2 ${complianceScore === 100 ? 'bg-green-600' : 'bg-amber-600'}`}>
          <CheckCircle2 className="w-5 h-5 mr-2" />
          {verifiedCompliant}/{verifiableChecks.length} verified · {attestedCount} attested
        </Badge>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 mb-6 h-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm py-2">Overview</TabsTrigger>
          <TabsTrigger value="security-audit" className="text-xs sm:text-sm py-2">Security Audit</TabsTrigger>
          <TabsTrigger value="vulnerabilities" className="text-xs sm:text-sm py-2">Vulnerabilities</TabsTrigger>
          <TabsTrigger value="encryption" className="text-xs sm:text-sm py-2">Encryption</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs sm:text-sm py-2">Audit Logs</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm py-2">User Activity</TabsTrigger>
          <TabsTrigger value="ai-analysis" className="text-xs sm:text-sm py-2">AI Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Labelled for what it measures: the controls this app can actually
                check, not the platform attestations it cannot. */}
            <StatCard label="Verified Controls" value={`${verifiedCompliant}/${verifiableChecks.length}`} icon={CheckCircle2} tone={complianceScore === 100 ? 'emerald' : 'amber'} />
            <StatCard label="User Activities" value="Unavailable" icon={Activity} tone="amber" />
            <StatCard label="PHI Access" value="Unavailable" icon={Eye} tone="slate" />
            <StatCard label="Critical Events" value="Unavailable" icon={AlertTriangle} tone="amber" />
          </div>

          <Alert className="bg-amber-50 border-amber-300">
            <AlertTriangle className="w-5 h-5 text-amber-700" />
            <AlertDescription className="text-amber-950">
              <p className="font-semibold">Security event metrics unavailable</p>
              <p className="text-sm">
                SecurityLog rows cannot be read here until immutable agency provenance and a tenant-authorized broker are hosted and verified. Missing values do not mean zero events.
              </p>
            </AlertDescription>
          </Alert>

          {/* HIPAA Requirements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                HIPAA Security Rule Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {assessedChecks.map((check, idx) => {
                  const Icon = check.icon;
                  // Drive the styling from the check itself. A hardcoded green
                  // "✓ Active" told an admin every control was confirmed active
                  // even for controls nothing had checked.
                  const ok = check.status === 'compliant';
                  const tone = check.attested
                    ? { box: 'bg-slate-50 border-slate-200', icon: 'text-slate-500', badge: 'bg-slate-500', label: 'Platform attested' }
                    : ok
                      ? { box: 'bg-green-50 border-green-200', icon: 'text-green-600', badge: 'bg-green-600', label: '✓ Verified' }
                      : { box: 'bg-amber-50 border-amber-200', icon: 'text-amber-600', badge: 'bg-amber-600', label: 'Needs attention' };
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 p-4 rounded-lg border ${tone.box}`}
                    >
                      <CheckCircle2 className={`w-5 h-5 mt-0.5 ${tone.icon}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`w-4 h-4 ${tone.icon}`} />
                          <p className="font-semibold text-slate-900 text-sm">{check.name}</p>
                          <Badge className={`${tone.badge} text-xs`}>{tone.label}</Badge>
                        </div>
                        <p className="text-xs text-slate-600 mb-1">{check.description}</p>
                        <p className="text-xs text-slate-500 italic">{check.details}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Compliance Documentation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Compliance Documentation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-900 text-sm">
                  <p className="font-semibold mb-2">HIPAA Security Rule 45 CFR § 164.312</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>§ 164.312(a)(1) - Access Control: Role-based authentication implemented</li>
                    <li>§ 164.312(a)(2)(i) - Unique User Identification: Email-based user identification</li>
                    <li>§ 164.312(a)(2)(iii) - Automatic Logoff: 15-minute session timeout</li>
                    <li>§ 164.312(b) - Audit Controls: Evidence unavailable pending immutable tenant provenance and an authorized read broker</li>
                    <li>§ 164.312(c)(1) - Integrity: Database integrity with timestamps</li>
                    <li>§ 164.312(d) - Authentication: Secure token-based authentication</li>
                    <li>§ 164.312(e)(1) - Transmission Security: TLS 1.2+ encryption</li>
                    <li>§ 164.312(e)(2)(ii) - Encryption: AES-256 at rest, TLS in transit</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    const report = buildSecurityComplianceReport({
                      generatedDate: new Date().toISOString(),
                      complianceScore,
                      assessedChecks,
                    });
                    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `security-report-${toLocalISODate()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Security Report
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setSelectedTab("encryption")}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  View Full Documentation
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security-audit">
          <SecurityAuditScheduler />
        </TabsContent>

        <TabsContent value="vulnerabilities">
          <VulnerabilityAssessment />
        </TabsContent>

        <TabsContent value="encryption">
          <EncryptionStatusIndicator />
          
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Encryption Technical Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Data at Rest</p>
                  <p className="text-sm text-slate-600 mb-2">
                    All patient data stored in the database is encrypted using AES-256 encryption.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• Algorithm: AES-256-GCM</li>
                    <li>• Key Management: Automated key rotation</li>
                    <li>• Storage: Encrypted database volumes</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Data in Transit</p>
                  <p className="text-sm text-slate-600 mb-2">
                    All network communication uses TLS 1.2 or higher encryption.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• Protocol: TLS 1.2+</li>
                    <li>• Cipher Suite: Strong encryption only</li>
                    <li>• Certificate: Valid SSL/TLS certificate</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Authentication</p>
                  <p className="text-sm text-slate-600 mb-2">
                    Secure token-based authentication with JWT tokens.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• Token Type: JWT (JSON Web Tokens)</li>
                    <li>• Storage: Secure HTTP-only cookies</li>
                    <li>• Expiration: Session-based with 15-min timeout</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Access Control</p>
                  <p className="text-sm text-slate-600 mb-2">
                    Role-based access control with audit logging.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• RBAC: Admin and User roles</li>
                    <li>• Audit: Coverage unverified pending a tenant-authorized broker</li>
                    <li>• Session: Automatic timeout on inactivity</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-6">
          <SecurityLogUnavailable />
        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          <UserActivityUnavailable />
        </TabsContent>

        <TabsContent value="ai-analysis">
          <AIAuditAnalyzer />
        </TabsContent>
      </Tabs>
    </div>
  );
}
