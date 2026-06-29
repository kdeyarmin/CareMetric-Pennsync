import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Lock,
  CheckCircle2,
  Cloud,
  Database,
  Key,
  FileText,
  Server,
  Info
} from "lucide-react";

/**
 * Encryption Status Indicator
 * Shows real-time encryption status for HIPAA compliance
 */
export default function EncryptionStatusIndicator() {
  const isHTTPS = window.location.protocol === 'https:';
  const hasLocalStorage = typeof localStorage !== 'undefined';
  const hasSecureContext = window.isSecureContext;

  // Two kinds of items:
  //  - 'verified': directly observable in the browser at runtime (real check).
  //  - 'asserted': handled by the hosting platform and NOT independently verified
  //    here. We label these honestly rather than presenting them as passed checks.
  const securityChecks = [
    {
      name: 'TLS/HTTPS Encryption',
      description: 'This page is loaded over an encrypted HTTPS connection.',
      status: isHTTPS,
      kind: 'verified',
      icon: Cloud,
      critical: true
    },
    {
      name: 'Secure Context',
      description: 'Browser reports a secure context for cryptographic operations.',
      status: hasSecureContext,
      kind: 'verified',
      icon: Shield,
      critical: true
    },
    {
      name: 'Database Encryption at Rest',
      description: 'Platform asserts stored data is encrypted with AES-256. Not independently verified by this indicator.',
      status: true,
      kind: 'asserted',
      icon: Database,
      critical: true
    },
    {
      name: 'Secure Local Storage',
      description: 'Browser storage is available for offline PHI handling.',
      status: hasLocalStorage,
      kind: 'verified',
      icon: FileText,
      critical: false
    },
    {
      name: 'API Authentication',
      description: 'Platform asserts all API calls use secure token-based authentication. Not independently verified by this indicator.',
      status: true,
      kind: 'asserted',
      icon: Key,
      critical: true
    },
    {
      name: 'Backend Encryption',
      description: 'Platform asserts server-side encryption for data processing. Not independently verified by this indicator.',
      status: true,
      kind: 'asserted',
      icon: Server,
      critical: true
    }
  ];

  // Only the directly-observable (verified) checks drive the pass/fail banner.
  const verifiedChecks = securityChecks.filter(check => check.kind === 'verified');
  const allCriticalVerifiedPassing = verifiedChecks
    .filter(check => check.critical)
    .every(check => check.status);

  const verifiedPassing = verifiedChecks.filter(check => check.status).length;
  const verifiedPercentage = verifiedChecks.length > 0
    ? Math.round((verifiedPassing / verifiedChecks.length) * 100)
    : 0;

  return (
    <Card className={`border-2 ${allCriticalVerifiedPassing ? 'border-green-300' : 'border-red-300'}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="w-5 h-5 text-blue-600" />
            Encryption & Security Status
          </CardTitle>
          <Badge className={allCriticalVerifiedPassing ? 'bg-green-600' : 'bg-red-600'}>
            {verifiedPercentage}% browser-verified
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!allCriticalVerifiedPassing && (
          <Alert className="bg-red-50 border-red-300">
            <AlertDescription className="text-red-900">
              <p className="font-semibold">⚠️ Critical Security Requirements Not Met</p>
              <p className="text-sm">Some critical security features are disabled or unavailable.</p>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {securityChecks.map((check, idx) => {
            const Icon = check.icon;
            const isAsserted = check.kind === 'asserted';
            // Asserted items get a neutral (slate) treatment so they are not
            // mistaken for an independently verified pass.
            const containerClass = isAsserted
              ? 'bg-slate-50 border-slate-200'
              : check.status
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200';
            return (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg border ${containerClass}`}
              >
                <div className={`mt-0.5 ${isAsserted ? 'text-slate-500' : check.status ? 'text-green-600' : 'text-red-600'}`}>
                  {isAsserted ? (
                    <Info className="w-5 h-5" />
                  ) : check.status ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-slate-900 text-sm">{check.name}</p>
                    {check.critical && (
                      <Badge variant="outline" className="text-xs">Critical</Badge>
                    )}
                    {isAsserted ? (
                      <Badge variant="outline" className="text-xs bg-slate-100">Platform-asserted</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-blue-50">Browser-verified</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">{check.description}</p>
                </div>
                <Icon className={`w-5 h-5 ${isAsserted ? 'text-slate-400' : check.status ? 'text-green-500' : 'text-slate-400'}`} />
              </div>
            );
          })}
        </div>

        {allCriticalVerifiedPassing && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              <p className="font-semibold">✓ Browser-verifiable controls active</p>
              <p className="text-sm">
                The controls observable from this browser (HTTPS, secure context) are active.
                Items marked "Platform-asserted" are handled by the hosting platform and are
                not independently verified here.
              </p>
            </AlertDescription>
          </Alert>
        )}

        <div className="pt-3 border-t">
          <p className="text-xs text-slate-500">
            <strong>Platform-asserted standards:</strong> AES-256 (at rest), TLS 1.2+ (in transit).
            These are stated by the hosting platform, not independently verified by this indicator.
          </p>
          <p className="text-xs text-slate-500">
            <strong>Relevant rule:</strong> HIPAA Security Rule 45 CFR § 164.312(a)(2)(iv) & § 164.312(e)(1)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}