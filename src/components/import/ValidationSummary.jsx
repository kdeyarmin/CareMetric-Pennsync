import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  TrendingUp,
  FileText
} from "lucide-react";

export default function ValidationSummary({ validationErrors, validRecords, totalRows }) {
  // Normalize once: these props can be undefined before the import data loads.
  const safeErrors = validationErrors || [];
  const safeRecords = validRecords || [];

  // Categorize errors by severity
  const criticalErrors = (safeErrors).flatMap(e =>
    (e.errors || []).filter(err => err.includes('required') || err.includes('Invalid') || err.includes('cannot'))
  ).length;

  const warnings = (safeErrors || []).flatMap(e =>
    (e.errors || []).filter(err => err.includes('recommended') || err.includes('unusual') || err.includes('verify'))
  ).length;

  const infoMessages = (safeErrors || []).flatMap(e =>
    (e.errors || []).filter(err => err.includes('minor') || err.includes('ensure'))
  ).length;

  // Field-level error breakdown
  const errorsByField = {};
  safeErrors.forEach(record => {
    record.errors?.forEach(error => {
      const field = extractFieldFromError(error);
      errorsByField[field] = (errorsByField[field] || 0) + 1;
    });
  });

  const topErrorFields = Object.entries(errorsByField)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const validationRate = totalRows > 0 ? Math.round((safeRecords.length / totalRows) * 100) : 0;
  const _errorRate = totalRows > 0 ? Math.round((safeErrors.length / totalRows) * 100) : 0;

  return (
    <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Validation Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-4 bg-white rounded-lg border-2 border-green-200">
            <CheckCircle2 className="w-6 h-6 text-green-600 mb-2" />
            <p className="text-2xl font-bold text-green-700">{safeRecords.length}</p>
            <p className="text-xs text-slate-600">Valid</p>
          </div>

          <div className="p-4 bg-white rounded-lg border-2 border-red-200">
            <XCircle className="w-6 h-6 text-red-600 mb-2" />
            <p className="text-2xl font-bold text-red-700">{criticalErrors}</p>
            <p className="text-xs text-slate-600">Critical</p>
          </div>

          <div className="p-4 bg-white rounded-lg border-2 border-yellow-200">
            <AlertTriangle className="w-6 h-6 text-yellow-600 mb-2" />
            <p className="text-2xl font-bold text-yellow-700">{warnings}</p>
            <p className="text-xs text-slate-600">Warnings</p>
          </div>

          <div className="p-4 bg-white rounded-lg border-2 border-blue-200">
            <Info className="w-6 h-6 text-blue-600 mb-2" />
            <p className="text-2xl font-bold text-blue-700">{infoMessages}</p>
            <p className="text-xs text-slate-600">Info</p>
          </div>
        </div>

        {/* Validation Rate */}
        <div className="bg-white rounded-lg p-4 border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Validation Success Rate</span>
            <span className="text-lg font-bold text-green-600">{validationRate}%</span>
          </div>
          <Progress value={validationRate} className="h-3" />
          <p className="text-xs text-slate-500 mt-1">
            {safeRecords.length} of {totalRows} rows passed validation
          </p>
        </div>

        {/* Top Error Fields */}
        {topErrorFields.length > 0 && (
          <div className="bg-white rounded-lg p-4 border">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              Most Common Issues
            </h4>
            <div className="space-y-2">
              {topErrorFields.map(([field, count]) => (
                <div key={field} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700 capitalize">
                    {field.replace(/_/g, ' ')}
                  </span>
                  <Badge variant="outline" className="bg-red-50">
                    {count} error{count !== 1 ? 's' : ''}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Severity Breakdown */}
        <Alert className="bg-gradient-to-r from-blue-50 to-navy-50 border-blue-200">
          <FileText className="w-4 h-4 text-blue-600" />
          <AlertDescription>
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-blue-900">Validation Breakdown:</p>
              {criticalErrors > 0 && (
                <p className="text-red-700">
                  • <strong>{criticalErrors}</strong> critical error{criticalErrors !== 1 ? 's' : ''} must be fixed before import
                </p>
              )}
              {warnings > 0 && (
                <p className="text-yellow-700">
                  • <strong>{warnings}</strong> warning{warnings !== 1 ? 's' : ''} can be reviewed and overridden
                </p>
              )}
              {infoMessages > 0 && (
                <p className="text-blue-700">
                  • <strong>{infoMessages}</strong> informational message{infoMessages !== 1 ? 's' : ''} for your awareness
                </p>
              )}
              {safeRecords.length > 0 && (
                <p className="text-green-700 font-semibold mt-2">
                  ✓ {safeRecords.length} record{safeRecords.length !== 1 ? 's' : ''} ready for import
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function extractFieldFromError(error) {
  const fieldPatterns = [
    { pattern: /first.?name/i, field: 'first_name' },
    { pattern: /last.?name/i, field: 'last_name' },
    { pattern: /date.?of.?birth|dob/i, field: 'date_of_birth' },
    { pattern: /phone/i, field: 'phone' },
    { pattern: /email/i, field: 'email' },
    { pattern: /medical.?record/i, field: 'medical_record_number' },
    { pattern: /emergency.?contact/i, field: 'emergency_contact' },
    { pattern: /admission/i, field: 'admission_date' },
    { pattern: /diagnosis/i, field: 'diagnosis' },
    { pattern: /vital/i, field: 'vitals' },
    { pattern: /medication/i, field: 'medications' },
  ];

  for (const { pattern, field } of fieldPatterns) {
    if (pattern.test(error)) {
      return field;
    }
  }

  return 'other';
}