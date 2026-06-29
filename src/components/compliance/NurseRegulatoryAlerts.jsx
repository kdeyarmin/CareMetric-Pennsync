import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bell,
  CheckCircle2,
  GraduationCap,
  ChevronDown,
  ChevronUp,
  Calendar
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function NurseRegulatoryAlerts({ nurseEmail, compact = false }) {
  const [expanded, setExpanded] = useState(!compact);
  const [acknowledgedUpdates, setAcknowledgedUpdates] = useState(() => {
    try {
      const saved = localStorage.getItem(`acknowledged_updates_${nurseEmail}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const { data: updates = [] } = useQuery({
    queryKey: ['implementedRegUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.filter({ 
      status: { $in: ['approved', 'implemented'] }
    }, '-effective_date'),
  });

  // Filter to recent and unacknowledged updates
  const relevantUpdates = (updates || []).filter(u => {
    const daysSinceImplemented = differenceInDays(new Date(), new Date(u.reviewed_at || u.created_date));
    return daysSinceImplemented <= 30 && !acknowledgedUpdates.includes(u.id);
  });

  const handleAcknowledge = (updateId) => {
    const newAcknowledged = [...acknowledgedUpdates, updateId];
    setAcknowledgedUpdates(newAcknowledged);
    try { localStorage.setItem(`acknowledged_updates_${nurseEmail}`, JSON.stringify(newAcknowledged)); } catch {}
  };

  const getImpactColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      default: return 'bg-blue-500 text-white';
    }
  };

  if (relevantUpdates.length === 0 && compact) {
    return null;
  }

  if (compact) {
    return (
      <Alert className="bg-indigo-50 border-indigo-200">
        <Bell className="w-4 h-4 text-indigo-600" />
        <AlertDescription className="text-indigo-900">
          <span className="font-semibold">{relevantUpdates.length} New Regulation Update(s)</span>
          <span className="ml-2">requiring your attention.</span>
          <Link to={createPageUrl("ComplianceCenter")} className="ml-2 text-indigo-700 underline">
            Review Now →
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-indigo-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-indigo-50 to-navy-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-600" />
            Regulatory Updates
            {relevantUpdates.length > 0 && (
              <Badge className="bg-red-500 text-white ml-2">
                {relevantUpdates.length} New
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-3">
          {relevantUpdates.length === 0 ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
              <p className="text-sm text-slate-600">You're up to date on all regulations!</p>
            </div>
          ) : (
            (relevantUpdates || []).map(update => (
              <div 
                key={update.id}
                className={`p-3 rounded-lg border ${
                  update.impact_level === 'critical' ? 'bg-red-50 border-red-200' :
                  update.impact_level === 'high' ? 'bg-orange-50 border-orange-200' :
                  'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    onCheckedChange={() => handleAcknowledge(update.id)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={getImpactColor(update.impact_level)}>
                        {update.impact_level}
                      </Badge>
                      <span className="font-medium text-sm">{update.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-2">{update.summary}</p>
                    
                    {/* Key Changes */}
                    {update.compliance_check_updates?.length > 0 && (
                      <div className="bg-blue-50 p-2 rounded mb-2">
                        <p className="text-xs font-semibold text-blue-900 mb-1">What Changed:</p>
                        {update.compliance_check_updates.slice(0, 2).map((check, idx) => (
                          <p key={idx} className="text-xs text-blue-800">
                            • <strong>{check.check_name}:</strong> {check.new_requirement}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Required Training */}
                    {update.suggested_training?.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <GraduationCap className="w-3 h-3 text-navy-600" />
                        <span className="text-xs text-navy-700">Training:</span>
                        {update.suggested_training.slice(0, 2).map((t, i) => (
                          <Link 
                            key={i} 
                            to={`${createPageUrl("NurseTraining")}?topic=${encodeURIComponent(t)}`}
                          >
                            <Badge variant="outline" className="text-xs cursor-pointer hover:bg-navy-100">
                              {t}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                      <Calendar className="w-3 h-3" />
                      Effective: {update.effective_date ? format(new Date(update.effective_date), 'MMM d, yyyy') : 'Now'}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          <p className="text-xs text-slate-500 text-center">
            ✓ Check to acknowledge you've reviewed each update
          </p>
        </CardContent>
      )}
    </Card>
  );
}