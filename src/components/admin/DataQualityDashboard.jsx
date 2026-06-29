import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, Users, FileText, ClipboardCheck } from "lucide-react";

export default function DataQualityDashboard() {
  const { data: patients = [] } = useQuery({
    queryKey: ['all-patients-quality'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['all-users-quality'],
    queryFn: () => base44.entities.User.list('-created_date', 200),
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['recent-visits-quality'],
    queryFn: () => base44.entities.Visit.filter({ status: 'completed' }, '-visit_date', 100),
    initialData: [],
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials-quality'],
    queryFn: () => base44.entities.PersonnelCredential.list('-expiration_date', 500),
    initialData: [],
  });

  const qualityMetrics = useMemo(() => {
    // Patient data quality
    const patientIssues = patients.filter(p => 
      !p.emergency_contact_name || 
      !p.emergency_contact_phone || 
      !p.physician_name || 
      !p.phone
    );

    const patientCompleteness = patients.length > 0 
      ? ((patients.length - patientIssues.length) / patients.length * 100).toFixed(1)
      : 100;

    // User profile quality
    const userIssues = users.filter(u => 
      !u.phone || 
      u.phone === '' || 
      !u.care_scope ||
      !u.credential_type ||
      u.credential_type === ''
    );

    const userCompleteness = users.length > 0
      ? ((users.length - userIssues.length) / users.length * 100).toFixed(1)
      : 100;

    // Visit documentation quality
    const visitIssues = visits.filter(v => 
      !v.nurse_notes || 
      v.nurse_notes.length < 100 ||
      !v.vital_signs ||
      !v.homebound_justification
    );

    const visitCompleteness = visits.length > 0
      ? ((visits.length - visitIssues.length) / visits.length * 100).toFixed(1)
      : 100;

    // Credential tracking. PersonnelCredential is 1-to-many per user (multiple
    // credential types / renewals), so the row count is not the number of users
    // covered — counting unique user_ids prevents >100% coverage and a negative
    // "missing" figure.
    const coveredUsers = new Set(credentials.map(c => c.user_id).filter(Boolean)).size;
    const missingCredentials = Math.max(0, users.length - coveredUsers);
    const credentialCoverage = users.length > 0
      ? ((coveredUsers / users.length) * 100).toFixed(1)
      : 0;

    return {
      patientIssues,
      patientCompleteness,
      userIssues,
      userCompleteness,
      visitIssues,
      visitCompleteness,
      missingCredentials,
      credentialCoverage
    };
  }, [patients, users, visits, credentials]);

  const overallScore = useMemo(() => {
    const scores = [
      parseFloat(qualityMetrics.patientCompleteness),
      parseFloat(qualityMetrics.userCompleteness),
      parseFloat(qualityMetrics.visitCompleteness),
      parseFloat(qualityMetrics.credentialCoverage)
    ];
    return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  }, [qualityMetrics]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Data Quality Dashboard</h2>
          <p className="text-sm text-slate-500">Monitor data completeness and compliance</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-500">Overall Score</p>
          <p className="text-3xl font-bold text-indigo-600">{overallScore}%</p>
        </div>
      </div>

      {parseFloat(overallScore) < 90 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Data quality is below recommended threshold. Review critical issues below.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Patient Records</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{qualityMetrics.patientCompleteness}%</div>
            <Progress value={parseFloat(qualityMetrics.patientCompleteness)} className="mt-2" />
            <p className="text-xs text-slate-500 mt-2">
              {qualityMetrics.patientIssues.length} records missing critical data
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">User Profiles</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{qualityMetrics.userCompleteness}%</div>
            <Progress value={parseFloat(qualityMetrics.userCompleteness)} className="mt-2" />
            <p className="text-xs text-slate-500 mt-2">
              {qualityMetrics.userIssues.length} profiles incomplete
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Visit Documentation</CardTitle>
            <FileText className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{qualityMetrics.visitCompleteness}%</div>
            <Progress value={parseFloat(qualityMetrics.visitCompleteness)} className="mt-2" />
            <p className="text-xs text-slate-500 mt-2">
              {qualityMetrics.visitIssues.length} visits need improvement
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Credential Tracking</CardTitle>
            <ClipboardCheck className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{qualityMetrics.credentialCoverage}%</div>
            <Progress value={parseFloat(qualityMetrics.credentialCoverage)} className="mt-2" />
            <p className="text-xs text-slate-500 mt-2">
              {qualityMetrics.missingCredentials} employees need credential upload
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Patient Record Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {qualityMetrics.patientIssues.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span>All patient records complete</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {qualityMetrics.patientIssues.slice(0, 10).map(patient => (
                  <div key={patient.id} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                    <span className="text-sm font-medium">{patient.first_name} {patient.last_name}</span>
                    <Badge variant="outline" className="text-xs">
                      Missing: {[
                        !patient.emergency_contact_name && 'Emergency Contact',
                        !patient.emergency_contact_phone && 'Emergency Phone',
                        !patient.physician_name && 'Physician',
                        !patient.phone && 'Phone'
                      ].filter(Boolean).join(', ')}
                    </Badge>
                  </div>
                ))}
                {qualityMetrics.patientIssues.length > 10 && (
                  <p className="text-xs text-slate-500 text-center pt-2">
                    +{qualityMetrics.patientIssues.length - 10} more patients
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">User Profile Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {qualityMetrics.userIssues.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span>All user profiles complete</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {qualityMetrics.userIssues.slice(0, 10).map(user => (
                  <div key={user.email} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                    <span className="text-sm font-medium">{user.full_name}</span>
                    <Badge variant="outline" className="text-xs">
                      Missing: {[
                        (!user.phone || user.phone === '') && 'Phone',
                        !user.care_scope && 'Care Scope',
                        (!user.credential_type || user.credential_type === '') && 'Credential'
                      ].filter(Boolean).join(', ')}
                    </Badge>
                  </div>
                ))}
                {qualityMetrics.userIssues.length > 10 && (
                  <p className="text-xs text-slate-500 text-center pt-2">
                    +{qualityMetrics.userIssues.length - 10} more users
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}