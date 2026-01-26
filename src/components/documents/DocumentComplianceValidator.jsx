import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';

export default function DocumentComplianceValidator({ document, complianceData }) {
  const [showDetails, setShowDetails] = useState(false);

  if (!complianceData) return null;

  const { score, issues = [], recommendations = [] } = complianceData;

  const getScoreBadgeColor = () => {
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const getScoreIcon = () => {
    if (score >= 80) return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    return <AlertCircle className="w-5 h-5 text-yellow-600" />;
  };

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {getScoreIcon()}
            Compliance Review
          </CardTitle>
          <Badge className={getScoreBadgeColor()}>{score}/100</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Issues Found */}
        {issues.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Issues Found:</p>
            <ul className="space-y-1">
              {issues.map((issue, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-slate-600">
                  <span className="text-red-500 flex-shrink-0">•</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Recommendations:</p>
            <ul className="space-y-1">
              {recommendations.map((rec, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-slate-600">
                  <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {issues.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm text-green-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Document meets compliance standards
            </p>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full text-sm"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? 'Hide Details' : 'View Details'}
        </Button>
      </CardContent>
    </Card>
  );
}