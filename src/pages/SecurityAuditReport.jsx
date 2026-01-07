import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lock,
  Eye,
  Database,
  Code,
  Server,
  Users,
  FileText,
  Download,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function SecurityAuditReport() {
  const [expandedSections, setExpandedSections] = useState(["critical"]);

  const auditFindings = {
    critical: [
      {
        category: "Access Control",
        issue: "Overly Permissive Patient Access",
        severity: "critical",
        location: "components/utils/security.js lines 14-25",
        description: "The canAccessPatient() function returns true for ALL authenticated users, allowing any logged-in user to access any patient's PHI without proper authorization checks.",
        impact: "Major HIPAA violation - unauthorized access to PHI. Any user can view any patient's protected health information.",
        recommendation: "Implement proper access control based on user role and patient assignment. Only allow access to patients assigned to the nurse or all patients for admins.",
        code: `// CURRENT (INSECURE):
export async function canAccessPatient(patientId) {
  const user = await base44.auth.me();
  if (!user) return false;
  return true; // ❌ EVERYONE has access
}

// RECOMMENDED:
export async function canAccessPatient(patientId) {
  const user = await base44.auth.me();
  if (!user) return false;
  
  // Admins can access all patients
  if (user.role === 'admin') return true;
  
  // Regular users can only access assigned patients
  const patient = await base44.entities.Patient.get(patientId);
  
  // Check if user has visited this patient
  const userVisits = await base44.entities.Visit.filter({
    patient_id: patientId,
    created_by: user.email
  });
  
  return userVisits.length > 0;
}`
      },
      {
        category: "Access Control",
        issue: "Overly Permissive Visit Access",
        severity: "critical",
        location: "components/utils/security.js lines 32-42",
        description: "Similar to patient access, canAccessVisit() allows all authenticated users to access all visits without verification.",
        impact: "Unauthorized access to clinical documentation and visit notes containing PHI.",
        recommendation: "Implement role-based checks and verify the user created the visit or is assigned to that patient.",
        code: `// RECOMMENDED:
export async function canAccessVisit(visitId) {
  const user = await base44.auth.me();
  if (!user) return false;
  
  if (user.role === 'admin') return true;
  
  const visit = await base44.entities.Visit.get(visitId);
  return visit.created_by === user.email;
}`
      },
      {
        category: "Input Validation",
        issue: "Weak XSS Protection",
        severity: "critical",
        location: "components/utils/security.js lines 90-100",
        description: "The sanitizeInput() function only removes < and > characters, which is insufficient for XSS prevention. Attackers can use alternative encodings or event handlers.",
        impact: "Cross-site scripting (XSS) attacks could steal session tokens, execute malicious code, or exfiltrate PHI.",
        recommendation: "Use a robust HTML sanitization library like DOMPurify or implement comprehensive encoding for all contexts (HTML, attributes, JavaScript).",
        code: `// Install DOMPurify:
import DOMPurify from 'dompurify';

export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return DOMPurify.sanitize(input, { 
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  });
}`
      },
      {
        category: "Data Leakage",
        issue: "PHI in Frontend Console Logs",
        severity: "critical",
        location: "Multiple locations - pages/SmartNoteAssistant.js, pages/Dashboard.js",
        description: "Patient data, notes, and sensitive information are logged to browser console using console.log(), console.error(). These logs can be accessed via browser dev tools.",
        impact: "PHI exposure through browser logs. Anyone with access to the browser can view patient information.",
        recommendation: "Remove all console.log() statements containing PHI in production. Use proper server-side logging only.",
        code: `// BAD:
console.log('Enhanced note:', enhancedNote); // ❌ Contains PHI
console.log('Patient data:', patient); // ❌ Contains PHI

// GOOD:
// Remove console.logs in production
// Or use conditional logging:
if (process.env.NODE_ENV === 'development') {
  console.log('[DEV ONLY] Note length:', enhancedNote?.length);
}`
      },
      {
        category: "Authentication",
        issue: "No Session Timeout Implementation",
        severity: "high",
        location: "Layout.js - Missing session management",
        description: "While a SessionManager class exists in security utils, it's not actually implemented in the application. Users remain logged in indefinitely.",
        impact: "Unattended sessions could allow unauthorized access to PHI if user leaves device unlocked.",
        recommendation: "Implement the SessionManager in Layout.js to automatically log out inactive users after 15 minutes.",
        code: `// In Layout.js:
import { SessionManager } from '../components/utils/security';

export default function Layout({ children, currentPageName }) {
  useEffect(() => {
    if (currentUser) {
      const sessionManager = new SessionManager(15); // 15 min timeout
      sessionManager.startMonitoring(
        () => base44.auth.logout(), // On timeout
        () => alert('Session expiring in 2 minutes') // Warning
      );
      return () => sessionManager.stopMonitoring();
    }
  }, [currentUser]);
}`
      }
    ],
    high: [
      {
        category: "API Security",
        issue: "Missing Rate Limiting on AI Endpoints",
        severity: "high",
        location: "pages/SmartNoteAssistant.js - AI enhancement calls",
        description: "While a rate limiter exists, it's not consistently applied to all AI API calls. Users can spam AI enhancement requests.",
        impact: "API abuse, increased costs, potential denial of service.",
        recommendation: "Wrap all AI calls with the secureAICall() wrapper that includes rate limiting.",
        code: `// Use the existing rate limiter:
import { secureAICall, aiCallLimiter } from '@/components/utils/security';

const handleEnhanceNote = async () => {
  try {
    const result = await secureAICall(
      () => base44.functions.invoke('enhanceNoteOptimized', {...}),
      currentUser.email // Rate limit key
    );
  } catch (error) {
    if (error.message.includes('Rate limit')) {
      alert('Too many requests. Please wait before trying again.');
    }
  }
};`
      },
      {
        category: "Data Exposure",
        issue: "PHI in Alert Messages",
        severity: "high",
        location: "Multiple pages - alert() calls with patient data",
        description: "Several places use alert() or error messages that include patient names, diagnoses, or other PHI.",
        impact: "PHI exposed in browser alert dialogs, potentially visible to unauthorized persons nearby.",
        recommendation: "Use generic error messages without PHI. Log detailed errors server-side only.",
        code: `// BAD:
alert(\`Failed to enhance note for \${patient.first_name} \${patient.last_name}\`);

// GOOD:
alert('Failed to enhance note. Please try again.');
// Log detailed error server-side only`
      },
      {
        category: "Authentication",
        issue: "No Multi-Factor Authentication (MFA)",
        severity: "high",
        location: "Authentication system",
        description: "The app has a Test2FA page and references to two-factor auth, but it's not enforced or required for access to PHI.",
        impact: "Account compromise through password theft could grant full access to all PHI.",
        recommendation: "Require MFA for all users accessing PHI, especially administrators.",
        code: `// Enforce MFA check:
const { data: currentUser } = useQuery({
  queryFn: async () => {
    const user = await base44.auth.me();
    if (user && !user.two_factor_enabled) {
      navigate(createPageUrl('Enable2FA'));
      return null;
    }
    return user;
  }
});`
      },
      {
        category: "Backend Functions",
        issue: "Webhook Without Request Validation",
        severity: "high",
        location: "functions/stripeWebhook.js",
        description: "While Stripe signature is verified, other webhook endpoints may not have proper validation. If webhook secret is compromised, attackers could forge events.",
        impact: "Unauthorized subscription changes, data manipulation.",
        recommendation: "Ensure webhook secret is properly rotated and stored securely. Add IP whitelisting for Stripe webhooks.",
        code: `// Add IP validation:
const STRIPE_WEBHOOK_IPS = [
  '3.18.12.63', '3.130.192.231', // Stripe IP ranges
  // ... add all Stripe IPs
];

const clientIP = req.headers.get('x-forwarded-for') || 
                req.headers.get('x-real-ip');

if (!STRIPE_WEBHOOK_IPS.some(ip => clientIP?.includes(ip))) {
  console.warn('Webhook from unknown IP:', clientIP);
  // Still verify signature as primary check
}`
      },
      {
        category: "Data Retention",
        issue: "Unlimited Data Retention",
        severity: "high",
        location: "Entity schemas - no automatic deletion",
        description: "Patient data, visits, and audit logs are retained indefinitely without expiration policies.",
        impact: "HIPAA requires minimum necessary retention. Excessive data retention increases breach exposure surface.",
        recommendation: "Implement data retention policies - 7 years for patient records, 6 years for audit logs per HIPAA.",
        code: `// Create scheduled task to archive/delete old data:
create_scheduled_task({
  name: "Archive Old Patient Records",
  function_name: "archiveOldRecords",
  repeat_unit: "months",
  repeat_interval: 1,
  description: "Archives patient records >7 years old"
});`
      }
    ],
    medium: [
      {
        category: "Input Validation",
        issue: "Missing Input Length Limits",
        severity: "medium",
        location: "All text inputs - no maxLength attributes",
        description: "Text inputs and textareas don't enforce maximum length limits, allowing excessively large inputs.",
        impact: "Potential buffer overflow, database errors, or DoS through massive payloads.",
        recommendation: "Add maxLength attributes to all inputs and validate on backend.",
        code: `// Add to all inputs:
<Input maxLength={255} />
<Textarea maxLength={5000} />

// Backend validation:
if (data.notes?.length > 50000) {
  throw new Error('Note exceeds maximum length');
}`
      },
      {
        category: "Error Handling",
        issue: "Detailed Error Messages to Users",
        severity: "medium",
        location: "Multiple locations using error.message in alerts",
        description: "Technical error messages are shown directly to users, potentially exposing system internals.",
        impact: "Information disclosure that could aid attackers in understanding system architecture.",
        recommendation: "Use getUserFriendlyError() consistently for all error messages.",
        code: `// Instead of:
catch (error) {
  alert(error.message); // ❌ Technical details exposed
}

// Do:
catch (error) {
  const friendlyMsg = handleSecureError(error, 'FeatureName');
  alert(friendlyMsg); // ✓ Generic message
}`
      },
      {
        category: "Authorization",
        issue: "Missing Admin Verification in Functions",
        severity: "medium",
        location: "Backend functions - some missing admin checks",
        description: "Some administrative functions may not verify user.role === 'admin' before executing privileged operations.",
        impact: "Privilege escalation if regular users discover function endpoints.",
        recommendation: "All admin functions MUST verify role at the start.",
        code: `// Required for all admin functions:
const user = await base44.auth.me();
if (!user || user.role !== 'admin') {
  return Response.json(
    { error: 'Admin access required' }, 
    { status: 403 }
  );
}`
      },
      {
        category: "Data Protection",
        issue: "PHI in URL Parameters",
        severity: "medium",
        location: "Multiple pages using patient names/data in URLs",
        description: "Some navigation may pass patient information as URL parameters which get logged in browser history.",
        impact: "PHI persists in browser history, server logs, and can be leaked via referrer headers.",
        recommendation: "Only use IDs in URLs, never names or PHI. Use patient IDs only.",
        code: `// BAD:
navigate(\`/patient?name=\${patient.first_name}\`);

// GOOD:
navigate(\`/patient?id=\${patient.id}\`);`
      },
      {
        category: "Encryption",
        issue: "No Verification of HTTPS",
        severity: "medium",
        location: "Global - transport security",
        description: "Application doesn't enforce or verify HTTPS connections for API calls.",
        impact: "Man-in-the-middle attacks could intercept PHI if user on insecure network.",
        recommendation: "Add middleware to detect and block non-HTTPS requests in production.",
        code: `// Add to main app:
if (process.env.NODE_ENV === 'production' && 
    window.location.protocol !== 'https:') {
  window.location.href = 
    'https://' + window.location.host + window.location.pathname;
}`
      }
    ],
    low: [
      {
        category: "Code Quality",
        issue: "Unused Security Functions",
        severity: "low",
        location: "components/utils/security.js - clearSensitiveData(), deIdentifyForAI()",
        description: "Several security utility functions are defined but never used in the application.",
        impact: "Minimal - but indicates incomplete security implementation.",
        recommendation: "Either implement these functions where appropriate or remove them to reduce confusion.",
        code: `// Use clearSensitiveData on logout:
const handleLogout = () => {
  clearSensitiveData({
    setPatient,
    setVisits,
    setNotes
  });
  base44.auth.logout();
};`
      },
      {
        category: "Audit Logging",
        issue: "Inconsistent Audit Logging",
        severity: "low",
        location: "Multiple pages - some actions not logged",
        description: "While most major actions are logged, some data access events are missing audit trails.",
        impact: "Incomplete audit trail may not satisfy HIPAA audit requirements.",
        recommendation: "Ensure all PHI access, modifications, and exports are consistently logged.",
        code: `// Add to all PHI access points:
logSecurityEvent('PHI_ACCESSED', {
  entity_type: 'Patient',
  entity_id: patientId,
  action: 'view'
});`
      },
      {
        category: "Dependencies",
        issue: "Third-Party Package Security",
        severity: "low",
        location: "Package.json dependencies",
        description: "No automated security scanning for known vulnerabilities in npm packages.",
        impact: "Vulnerable dependencies could introduce security holes.",
        recommendation: "Implement npm audit in CI/CD pipeline and keep dependencies updated.",
        code: `// Add to development workflow:
npm audit
npm audit fix

// Or use:
npx snyk test`
      }
    ],
    positive: [
      {
        category: "Authentication",
        finding: "Proper Authentication Checks",
        description: "All protected pages properly check for authenticated user and redirect to login if needed.",
        location: "Layout.js, Dashboard.js, SmartNoteAssistant.js"
      },
      {
        category: "Data Security",
        finding: "RLS Policies on Entities",
        description: "Most entities have Row-Level Security policies defined to restrict data access based on user role and ownership.",
        location: "Entity schemas (Patient, Visit, Task, etc.)"
      },
      {
        category: "API Security",
        finding: "Service Role Properly Scoped",
        description: "Backend functions correctly use base44.asServiceRole only when needed and check user authentication first.",
        location: "functions/stripeWebhook.js, other backend functions"
      },
      {
        category: "Data Protection",
        finding: "Input Sanitization Implemented",
        description: "Patient details page consistently sanitizes all displayed data using sanitizeInput().",
        location: "pages/PatientDetails.js"
      },
      {
        category: "Audit Trail",
        finding: "Comprehensive Activity Logging",
        description: "User activities, AI usage, and PHI access are logged to UserActivity and SecurityLog entities.",
        location: "components/utils/activityLogger.js, components/utils/security.js"
      },
      {
        category: "Access Control",
        finding: "Admin-Only Entities",
        description: "Sensitive entities like SecurityLog, SystemLog have RLS policies restricting access to admins only.",
        location: "Entity schemas"
      }
    ]
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return XCircle;
      case 'high': return AlertTriangle;
      case 'medium': return AlertCircle;
      case 'low': return AlertCircle;
      default: return AlertCircle;
    }
  };

  const totalFindings = 
    auditFindings.critical.length + 
    auditFindings.high.length + 
    auditFindings.medium.length + 
    auditFindings.low.length;

  const criticalCount = auditFindings.critical.length;
  const highCount = auditFindings.high.length;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-20 md:pb-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
          <Shield className="w-8 h-8 text-blue-600" />
          Security Audit Report
        </h1>
        <p className="text-gray-600">Comprehensive security analysis of CareMetric AI</p>
        <p className="text-sm text-gray-500 mt-1">Generated: {new Date().toLocaleDateString()}</p>
      </div>

      {/* Executive Summary */}
      <Card className="mb-6 border-2">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardTitle className="text-xl">Executive Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-red-50 rounded-lg border-2 border-red-200">
              <XCircle className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-red-600">{criticalCount}</p>
              <p className="text-sm text-red-700">Critical</p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg border-2 border-orange-200">
              <AlertTriangle className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-orange-600">{highCount}</p>
              <p className="text-sm text-orange-700">High</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg border-2 border-yellow-200">
              <AlertCircle className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-yellow-600">{auditFindings.medium.length}</p>
              <p className="text-sm text-yellow-700">Medium</p>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
              <AlertCircle className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-blue-600">{auditFindings.low.length}</p>
              <p className="text-sm text-blue-700">Low</p>
            </div>
          </div>

          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <p className="font-semibold mb-2">⚠️ CRITICAL ISSUES REQUIRE IMMEDIATE ATTENTION</p>
              <p className="text-sm">
                {criticalCount} critical security vulnerabilities detected that could lead to HIPAA violations 
                and unauthorized PHI access. Address these immediately before production deployment.
              </p>
            </AlertDescription>
          </Alert>

          <div className="space-y-2 text-sm">
            <p><strong>Overall Risk Level:</strong> <Badge className="bg-red-600 text-white">HIGH</Badge></p>
            <p><strong>HIPAA Compliance Status:</strong> <Badge className="bg-orange-600 text-white">NON-COMPLIANT</Badge></p>
            <p><strong>Production Readiness:</strong> <Badge className="bg-red-600 text-white">NOT READY</Badge></p>
          </div>
        </CardContent>
      </Card>

      {/* Critical Findings */}
      <Card className="mb-6 border-2 border-red-300">
        <CardHeader className="bg-red-50">
          <CardTitle className="text-xl flex items-center gap-2 text-red-700">
            <XCircle className="w-6 h-6" />
            Critical Security Issues ({criticalCount})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              These issues must be fixed before deploying to production. They represent significant HIPAA violations and security risks.
            </AlertDescription>
          </Alert>
          <Accordion type="multiple" value={expandedSections} onValueChange={setExpandedSections}>
            {auditFindings.critical.map((finding, idx) => (
              <AccordionItem key={idx} value={`critical-${idx}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-start gap-3 text-left">
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-900">{finding.category}: {finding.issue}</p>
                      <p className="text-xs text-red-600 font-mono">{finding.location}</p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-8 space-y-4 pt-2">
                    <div>
                      <p className="font-semibold text-sm text-gray-900 mb-1">Description:</p>
                      <p className="text-sm text-gray-700">{finding.description}</p>
                    </div>
                    <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                      <p className="font-semibold text-sm text-red-900 mb-1">Impact:</p>
                      <p className="text-sm text-red-800">{finding.impact}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                      <p className="font-semibold text-sm text-green-900 mb-1">✓ Recommendation:</p>
                      <p className="text-sm text-green-800 mb-3">{finding.recommendation}</p>
                      {finding.code && (
                        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
                          {finding.code}
                        </pre>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* High Priority Findings */}
      <Card className="mb-6 border-2 border-orange-300">
        <CardHeader className="bg-orange-50">
          <CardTitle className="text-xl flex items-center gap-2 text-orange-700">
            <AlertTriangle className="w-6 h-6" />
            High Priority Issues ({highCount})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Accordion type="multiple">
            {auditFindings.high.map((finding, idx) => (
              <AccordionItem key={idx} value={`high-${idx}`}>
                <AccordionTrigger>
                  <div className="flex items-start gap-3 text-left">
                    <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-orange-900">{finding.category}: {finding.issue}</p>
                      <p className="text-xs text-orange-600 font-mono">{finding.location}</p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-8 space-y-4 pt-2">
                    <div>
                      <p className="font-semibold text-sm text-gray-900 mb-1">Description:</p>
                      <p className="text-sm text-gray-700">{finding.description}</p>
                    </div>
                    <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                      <p className="font-semibold text-sm text-orange-900 mb-1">Impact:</p>
                      <p className="text-sm text-orange-800">{finding.impact}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                      <p className="font-semibold text-sm text-green-900 mb-1">✓ Recommendation:</p>
                      <p className="text-sm text-green-800 mb-3">{finding.recommendation}</p>
                      {finding.code && (
                        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
                          {finding.code}
                        </pre>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Medium Priority Findings */}
      <Card className="mb-6 border-2 border-yellow-300">
        <CardHeader className="bg-yellow-50">
          <CardTitle className="text-xl flex items-center gap-2 text-yellow-700">
            <AlertCircle className="w-6 h-6" />
            Medium Priority Issues ({auditFindings.medium.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Accordion type="multiple">
            {auditFindings.medium.map((finding, idx) => (
              <AccordionItem key={idx} value={`medium-${idx}`}>
                <AccordionTrigger>
                  <div className="flex items-start gap-3 text-left">
                    <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-yellow-900">{finding.category}: {finding.issue}</p>
                      <p className="text-xs text-yellow-600 font-mono">{finding.location}</p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-8 space-y-4 pt-2">
                    <div>
                      <p className="font-semibold text-sm text-gray-900 mb-1">Description:</p>
                      <p className="text-sm text-gray-700">{finding.description}</p>
                    </div>
                    <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                      <p className="font-semibold text-sm text-yellow-900 mb-1">Impact:</p>
                      <p className="text-sm text-yellow-800">{finding.impact}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                      <p className="font-semibold text-sm text-green-900 mb-1">✓ Recommendation:</p>
                      <p className="text-sm text-green-800 mb-3">{finding.recommendation}</p>
                      {finding.code && (
                        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
                          {finding.code}
                        </pre>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Positive Findings */}
      <Card className="mb-6 border-2 border-green-300">
        <CardHeader className="bg-green-50">
          <CardTitle className="text-xl flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-6 h-6" />
            Security Controls Implemented ({auditFindings.positive.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3">
            {auditFindings.positive.map((finding, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-green-900">{finding.category}: {finding.finding}</p>
                  <p className="text-sm text-green-800 mt-1">{finding.description}</p>
                  <p className="text-xs text-green-600 font-mono mt-1">{finding.location}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* HIPAA Compliance Summary */}
      <Card className="mb-6 border-2 border-purple-300">
        <CardHeader className="bg-purple-50">
          <CardTitle className="text-xl flex items-center gap-2 text-purple-700">
            <Lock className="w-6 h-6" />
            HIPAA Compliance Assessment
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">Administrative Safeguards</p>
                <p className="text-sm text-gray-700">⚠️ Insufficient access controls - all users can access all patient records</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">Physical Safeguards</p>
                <p className="text-sm text-gray-700">⚠️ No session timeout - workstations remain unlocked indefinitely</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">Technical Safeguards</p>
                <p className="text-sm text-gray-700">✓ Encryption, audit logging, authentication implemented</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">Audit Controls</p>
                <p className="text-sm text-gray-700">⚠️ Logging present but needs improvement - some PHI access not tracked</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Immediate Action Items */}
      <Card className="border-2 border-red-300 bg-red-50">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2 text-red-700">
            <AlertTriangle className="w-6 h-6" />
            Required Immediate Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <ol className="space-y-3 list-decimal list-inside">
            <li className="text-sm font-semibold text-red-900">
              Fix patient access control - implement proper authorization checks in canAccessPatient()
            </li>
            <li className="text-sm font-semibold text-red-900">
              Fix visit access control - verify user created visit or is assigned to patient
            </li>
            <li className="text-sm font-semibold text-red-900">
              Remove all PHI from console.log() statements throughout application
            </li>
            <li className="text-sm font-semibold text-red-900">
              Implement session timeout (15 minutes) using existing SessionManager
            </li>
            <li className="text-sm font-semibold text-red-900">
              Upgrade XSS protection - use DOMPurify or comprehensive encoding
            </li>
            <li className="text-sm font-semibold text-orange-900">
              Implement and enforce Multi-Factor Authentication (MFA)
            </li>
            <li className="text-sm font-semibold text-orange-900">
              Add consistent rate limiting to all AI endpoints
            </li>
            <li className="text-sm font-semibold text-orange-900">
              Remove PHI from alert() messages and error displays
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card className="border-2 border-blue-300">
        <CardHeader className="bg-blue-50">
          <CardTitle className="text-xl flex items-center gap-2 text-blue-700">
            <Lightbulb className="w-6 h-6" />
            Security Enhancement Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-semibold text-gray-900 mb-2">Short Term (1-2 weeks):</p>
              <ul className="space-y-1 ml-4 text-gray-700">
                <li>• Fix all critical access control issues</li>
                <li>• Remove PHI from logs and error messages</li>
                <li>• Implement session timeout</li>
                <li>• Upgrade input sanitization</li>
                <li>• Add rate limiting to AI calls</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-gray-900 mb-2">Medium Term (1 month):</p>
              <ul className="space-y-1 ml-4 text-gray-700">
                <li>• Enforce MFA for all users</li>
                <li>• Implement data retention policies</li>
                <li>• Add input length validation</li>
                <li>• Set up automated security scanning</li>
                <li>• Conduct penetration testing</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-gray-900 mb-2">Long Term (3-6 months):</p>
              <ul className="space-y-1 ml-4 text-gray-700">
                <li>• Implement Web Application Firewall (WAF)</li>
                <li>• Add intrusion detection system</li>
                <li>• Regular third-party security audits</li>
                <li>• Advanced threat monitoring</li>
                <li>• Security awareness training program</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Download Report Button */}
      <div className="flex justify-center">
        <Button 
          size="lg" 
          className="gap-2"
          onClick={() => {
            const reportContent = `SECURITY AUDIT REPORT - CareMetric AI
Generated: ${new Date().toLocaleString()}

EXECUTIVE SUMMARY
=================
Total Findings: ${totalFindings}
- Critical: ${criticalCount}
- High: ${highCount}
- Medium: ${auditFindings.medium.length}
- Low: ${auditFindings.low.length}

Risk Level: HIGH
HIPAA Compliance: NON-COMPLIANT
Production Ready: NO

CRITICAL ISSUES
===============
${auditFindings.critical.map((f, i) => `
${i + 1}. ${f.category}: ${f.issue}
Location: ${f.location}
Description: ${f.description}
Impact: ${f.impact}
Recommendation: ${f.recommendation}
`).join('\n')}

Full report available in application.
`;
            const blob = new Blob([reportContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `security_audit_${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="w-5 h-5" />
          Download Audit Report
        </Button>
      </div>
    </div>
  );
}