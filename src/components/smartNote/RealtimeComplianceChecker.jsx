import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { AlertCircle, CheckCircle2, AlertTriangle, Shield, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RealtimeComplianceChecker({ noteContent, providerType, visitType, onComplianceUpdate }) {
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [complianceScore, setComplianceScore] = useState(null);
  const [checking, setChecking] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState(null);

  // Debounced compliance check
  useEffect(() => {
    const timer = setTimeout(() => {
      if (noteContent && noteContent.length > 100 && providerType && visitType) {
        checkComplianceRealtime();
      }
    }, 2000); // Check after user stops typing for 2 seconds

    return () => clearTimeout(timer);
  }, [noteContent, providerType, visitType]);

  const checkComplianceRealtime = async () => {
    if (!noteContent || noteContent.length < 100) return;
    
    setChecking(true);
    try {
      const response = await base44.functions.invoke('checkRealtimeCompliance', {
        note_content: noteContent,
        provider_type: providerType,
        visit_type: visitType,
        check_type: 'hipaa_basic'
      });

      const result = response.data || response;
      setComplianceScore(result.compliance_score);
      setComplianceIssues(result.issues || []);
      setLastCheckTime(new Date());
      
      onComplianceUpdate?.({
        score: result.compliance_score,
        issues: result.issues || [],
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error checking compliance:', error);
    } finally {
      setChecking(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <AlertCircle className="w-4 h-4" />;
      case 'medium':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Shield className="w-4 h-4" />;
    }
  };

  if (complianceScore === null) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-green-200 bg-gradient-to-r from-green-50 to-blue-50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <CardTitle className="text-sm">HIPAA Compliance Check</CardTitle>
            </div>
            
            <div className="flex items-center gap-2">
              {checking && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
              <Badge
                className={`font-semibold text-xs ${
                  complianceScore >= 85
                    ? 'bg-green-600 text-white'
                    : complianceScore >= 70
                    ? 'bg-yellow-600 text-white'
                    : 'bg-red-600 text-white'
                }`}
              >
                {complianceScore}%
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Compliance Score Bar */}
          <div className="space-y-1">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <motion.div
                className={`h-full rounded-full ${
                  complianceScore >= 85
                    ? 'bg-green-600'
                    : complianceScore >= 70
                    ? 'bg-yellow-600'
                    : 'bg-red-600'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${complianceScore}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>Compliance Level</span>
              <span>
                {complianceScore >= 85 ? '✓ Compliant' : complianceScore >= 70 ? '⚠ Review' : '✕ Issues Found'}
              </span>
            </div>
          </div>

          {/* Issues List */}
          {complianceIssues.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-700">Issues Found:</h4>
              <AnimatePresence>
                {complianceIssues.slice(0, 3).map((issue, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className={`p-2.5 rounded border flex items-start gap-2 text-xs ${getSeverityColor(issue.severity)}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getSeverityIcon(issue.severity)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{issue.title}</p>
                      <p className="opacity-90 text-xs mt-0.5">{issue.description}</p>
                      {issue.example && (
                        <p className="opacity-75 text-xs mt-1 italic">
                          Example: "{issue.example.substring(0, 40)}..."
                        </p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {complianceIssues.length > 3 && (
                <p className="text-xs text-gray-600 text-center pt-2">
                  +{complianceIssues.length - 3} more issue(s)
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-green-800 bg-green-100 p-2.5 rounded">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Note appears HIPAA compliant</span>
            </div>
          )}

          {lastCheckTime && (
            <div className="text-xs text-gray-500 text-center pt-2">
              Last checked: {lastCheckTime.toLocaleTimeString()}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}