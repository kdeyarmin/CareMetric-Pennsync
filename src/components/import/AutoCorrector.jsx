import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wand2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export default function AutoCorrector({ csvData, columnMapping, onCorrectedData }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState(null);

  const autoCorrectData = () => {
    setIsProcessing(true);
    const corrections = {
      dates: 0,
      phones: 0,
      emails: 0,
      enums: 0,
      total: 0
    };

    const correctedRows = csvData.rows.map((row, _rowIdx) => {
      const newRow = [...row];
      
      Object.entries(columnMapping).forEach(([colIndex, fieldKey]) => {
        const value = row[colIndex]?.trim();
        if (!value) return;

        // Auto-correct dates
        if (fieldKey.includes('date') && value) {
          // MM/DD/YYYY to YYYY-MM-DD
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
            const [month, day, year] = value.split('/');
            newRow[colIndex] = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            corrections.dates++;
            corrections.total++;
          }
          // MM-DD-YYYY to YYYY-MM-DD
          else if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
            const [month, day, year] = value.split('-');
            newRow[colIndex] = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            corrections.dates++;
            corrections.total++;
          }
          // M/D/YYYY to YYYY-MM-DD
          else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
            const [month, day, year] = value.split('/');
            newRow[colIndex] = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            corrections.dates++;
            corrections.total++;
          }
        }

        // Auto-correct phone numbers
        if (fieldKey.includes('phone') && value) {
          const cleaned = value.replace(/\D/g, '');
          if (cleaned.length === 10) {
            newRow[colIndex] = cleaned;
            corrections.phones++;
            corrections.total++;
          } else if (cleaned.length === 11 && cleaned[0] === '1') {
            newRow[colIndex] = cleaned.slice(1);
            corrections.phones++;
            corrections.total++;
          }
        }

        // Auto-correct email domains
        if (fieldKey.includes('email') && value && value.includes('@')) {
          const [localPart, domain] = value.split('@');
          const domainCorrections = {
            'gmial.com': 'gmail.com',
            'gmai.com': 'gmail.com',
            'yahooo.com': 'yahoo.com',
            'yaho.com': 'yahoo.com',
            'hotmial.com': 'hotmail.com',
            'outlok.com': 'outlook.com',
            'outloo.com': 'outlook.com'
          };
          
          if (domainCorrections[domain.toLowerCase()]) {
            newRow[colIndex] = `${localPart}@${domainCorrections[domain.toLowerCase()]}`;
            corrections.emails++;
            corrections.total++;
          }
        }

        // Auto-correct enum values
        if (fieldKey === 'care_type') {
          const valueLower = value.toLowerCase();
          if (valueLower.includes('home') || valueLower.includes('health')) {
            newRow[colIndex] = 'home_health';
            corrections.enums++;
            corrections.total++;
          } else if (valueLower.includes('hospice')) {
            newRow[colIndex] = 'hospice';
            corrections.enums++;
            corrections.total++;
          }
        }

        if (fieldKey === 'status') {
          const valueLower = value.toLowerCase();
          if (valueLower.includes('active') || valueLower === 'a') {
            newRow[colIndex] = 'active';
            corrections.enums++;
            corrections.total++;
          } else if (valueLower.includes('discharge')) {
            newRow[colIndex] = 'discharged';
            corrections.enums++;
            corrections.total++;
          } else if (valueLower.includes('hospital')) {
            newRow[colIndex] = 'hospitalized';
            corrections.enums++;
            corrections.total++;
          }
        }
      });

      return newRow;
    });

    setResults(corrections);
    setIsProcessing(false);
    
    if (corrections.total > 0) {
      onCorrectedData({
        headers: csvData.headers,
        rows: correctedRows
      });
    }
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-navy-600" />
          Auto-Correct Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!results ? (
          <>
            <p className="text-sm text-slate-700">
              Automatically fix common data issues before validation:
            </p>
            <ul className="text-sm text-slate-600 space-y-2 ml-4">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span>Convert dates to YYYY-MM-DD format</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span>Format phone numbers (remove spaces, dashes)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span>Fix common email typos</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span>Normalize dropdown values</span>
              </li>
            </ul>
            <Button
              onClick={autoCorrectData}
              disabled={isProcessing}
              className="w-full bg-navy-600 hover:bg-navy-700"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Auto-Correct All Data
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            {results.total > 0 ? (
              <>
                <Alert className="bg-green-50 border-green-300">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    <strong>✅ {results.total} corrections applied!</strong>
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  {results.dates > 0 && (
                    <div className="flex items-center justify-between p-2 bg-white rounded border">
                      <span className="text-sm">Date formats fixed</span>
                      <Badge className="bg-green-600">{results.dates}</Badge>
                    </div>
                  )}
                  {results.phones > 0 && (
                    <div className="flex items-center justify-between p-2 bg-white rounded border">
                      <span className="text-sm">Phone numbers formatted</span>
                      <Badge className="bg-green-600">{results.phones}</Badge>
                    </div>
                  )}
                  {results.emails > 0 && (
                    <div className="flex items-center justify-between p-2 bg-white rounded border">
                      <span className="text-sm">Email typos corrected</span>
                      <Badge className="bg-green-600">{results.emails}</Badge>
                    </div>
                  )}
                  {results.enums > 0 && (
                    <div className="flex items-center justify-between p-2 bg-white rounded border">
                      <span className="text-sm">Values normalized</span>
                      <Badge className="bg-green-600">{results.enums}</Badge>
                    </div>
                  )}
                </div>

                <Alert className="bg-blue-50 border-blue-300">
                  <AlertDescription className="text-xs text-blue-900">
                    💡 Data has been corrected. Click "Validate & Preview Data" to see the improvements!
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <Alert className="bg-blue-50 border-blue-300">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  No automatic corrections needed. Your data looks good!
                </AlertDescription>
              </Alert>
            )}

            <Button
              onClick={() => {
                setResults(null);
              }}
              variant="outline"
              className="w-full"
            >
              Run Again
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}