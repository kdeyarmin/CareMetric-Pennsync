import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, AlertTriangle, CheckCircle2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { debounce } from "lodash";

export default function RealTimeComplianceMonitor({ 
  content, 
  documentType,
  patientId,
  onScoreChange 
}) {
  const [score, setScore] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [criticalIssues, setCriticalIssues] = useState([]);
  const [expanded, setExpanded] = useState(false);

  // Debounced compliance check
  const checkCompliance = useCallback(
    debounce(async (text) => {
      if (!text || text.length < 100) {
        setScore(null);
        return;
      }

      setIsChecking(true);
      try {
        const response = await base44.functions.invoke('automatedComplianceCheck', {
          document_content: text,
          document_type: documentType,
          patient_id: patientId
        });

        const data = response?.data;
        if (data?.success) {
          const complianceScore = data.compliance_result.overall_compliance_score;
          setScore(complianceScore);
          onScoreChange?.(complianceScore);
          
          const critical = (data.compliance_result.issues || []).filter(
            i => i.severity === 'critical' || i.severity === 'high'
          );
          setCriticalIssues(critical);
        }
      } catch (error) {
        console.error('Real-time compliance check failed:', error);
      } finally {
        setIsChecking(false);
      }
    }, 2000),
    [documentType, patientId]
  );

  useEffect(() => {
    if (content) {
      checkCompliance(content);
    }
  }, [content, checkCompliance]);

  if (!content || content.length < 100) {
    return null;
  }

  return (
    <Card className={`border-2 ${
      score === null ? 'border-gray-200' :
      score >= 90 ? 'border-green-300 bg-green-50' :
      score >= 70 ? 'border-yellow-300 bg-yellow-50' :
      'border-red-300 bg-red-50'
    }`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isChecking ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            ) : score === null ? (
              <Shield className="w-5 h-5 text-gray-400" />
            ) : score >= 90 ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : score >= 70 ? (
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            )}
            
            <div>
              <p className="text-sm font-medium text-gray-700">
                {isChecking ? 'Checking compliance...' : 'Compliance Score'}
              </p>
              {score !== null && !isChecking && (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-2xl font-bold">{score}%</p>
                  {criticalIssues.length > 0 && (
                    <Badge className="bg-red-600">
                      {criticalIssues.length} critical
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          {criticalIssues.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          )}
        </div>

        {/* Critical Issues Summary */}
        {expanded && criticalIssues.length > 0 && (
          <div className="mt-4 pt-4 border-t space-y-2">
            {criticalIssues.map((issue, idx) => (
              <div key={idx} className="p-3 bg-white rounded border border-red-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{issue.rule_name}</p>
                    <p className="text-xs text-gray-600 mt-1">{issue.issue_description}</p>
                    <p className="text-xs text-gray-700 mt-2 font-medium">
                      → {issue.corrective_action}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}