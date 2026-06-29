import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart3, AlertTriangle, TrendingDown, Lightbulb } from "lucide-react";

export default function ErrorPatternAnalyzer({ validationErrors }) {
  // Analyze error patterns
  const analyzePatterns = () => {
    const patterns = {
      date_format: { count: 0, examples: [], fix: "Convert dates to YYYY-MM-DD format" },
      email_format: { count: 0, examples: [], fix: "Fix email format (e.g., user@domain.com)" },
      phone_format: { count: 0, examples: [], fix: "Use 10-digit format: 5551234567" },
      missing_required: { count: 0, examples: [], fix: "Add required fields (First Name, Last Name)" },
      invalid_enum: { count: 0, examples: [], fix: "Use valid values from dropdown options" },
      data_length: { count: 0, examples: [], fix: "Check field length requirements" }
    };

    validationErrors.forEach(error => {
      error.errors?.forEach(err => {
        const errorMsg = typeof err === 'object' ? err.error : err;
        const field = typeof err === 'object' ? err.field : 'Unknown';
        const value = typeof err === 'object' ? err.value : '';

        if (errorMsg.toLowerCase().includes('date') && errorMsg.toLowerCase().includes('format')) {
          patterns.date_format.count++;
          if (patterns.date_format.examples.length < 3) {
            patterns.date_format.examples.push({ field, value, row: error.row });
          }
        } else if (errorMsg.toLowerCase().includes('email')) {
          patterns.email_format.count++;
          if (patterns.email_format.examples.length < 3) {
            patterns.email_format.examples.push({ field, value, row: error.row });
          }
        } else if (errorMsg.toLowerCase().includes('phone')) {
          patterns.phone_format.count++;
          if (patterns.phone_format.examples.length < 3) {
            patterns.phone_format.examples.push({ field, value, row: error.row });
          }
        } else if (errorMsg.toLowerCase().includes('required')) {
          patterns.missing_required.count++;
          if (patterns.missing_required.examples.length < 3) {
            patterns.missing_required.examples.push({ field, value: 'empty', row: error.row });
          }
        } else if (errorMsg.toLowerCase().includes('invalid value') || errorMsg.toLowerCase().includes('must be one of')) {
          patterns.invalid_enum.count++;
          if (patterns.invalid_enum.examples.length < 3) {
            patterns.invalid_enum.examples.push({ field, value, row: error.row });
          }
        } else {
          patterns.data_length.count++;
          if (patterns.data_length.examples.length < 3) {
            patterns.data_length.examples.push({ field, value, row: error.row });
          }
        }
      });
    });

    return patterns;
  };

  const patterns = analyzePatterns();
  const totalErrors = validationErrors.reduce((sum, err) => sum + (err.errors?.length || 0), 0);
  const sortedPatterns = Object.entries(patterns)
    .filter(([_, data]) => data.count > 0)
    .sort((a, b) => b[1].count - a[1].count);

  return (
    <Card className="border-2 border-orange-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-orange-600" />
          Error Pattern Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-red-50 rounded-lg border border-red-200">
            <p className="text-xs text-red-700 mb-1">Total Errors</p>
            <p className="text-2xl font-bold text-red-900">{totalErrors}</p>
          </div>
          <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
            <p className="text-xs text-orange-700 mb-1">Error Types</p>
            <p className="text-2xl font-bold text-orange-900">{sortedPatterns.length}</p>
          </div>
        </div>

        <div className="space-y-3">
          {sortedPatterns.map(([patternKey, data]) => {
            const percentage = (data.count / totalErrors) * 100;
            const patternLabels = {
              date_format: "Date Format Issues",
              email_format: "Email Format Issues",
              phone_format: "Phone Format Issues",
              missing_required: "Missing Required Fields",
              invalid_enum: "Invalid Option Values",
              data_length: "Other Data Issues"
            };

            return (
              <div key={patternKey} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    <span className="text-sm font-semibold">{patternLabels[patternKey]}</span>
                  </div>
                  <Badge className="bg-orange-100 text-orange-800">
                    {data.count} ({Math.round(percentage)}%)
                  </Badge>
                </div>
                <Progress value={percentage} className="h-2" />
                
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-900 mb-1">Auto-Fix Available:</p>
                      <p className="text-blue-800">{data.fix}</p>
                    </div>
                  </div>
                </div>

                {data.examples.length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs space-y-1">
                    <p className="font-semibold text-slate-700">Examples:</p>
                    {data.examples.map((ex, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-slate-600">
                        <span className="font-mono bg-white px-1 rounded">Row {ex.row}</span>
                        <span>{ex.field}: "{ex.value}"</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {sortedPatterns.length === 0 && (
          <div className="text-center py-6 text-slate-500">
            <TrendingDown className="w-8 h-8 mx-auto mb-2 text-slate-400" />
            <p className="text-sm">No error patterns detected</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}