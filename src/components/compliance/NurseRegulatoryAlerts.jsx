import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bell,
  CheckCircle2,
  AlertCircle,
  GraduationCap,
  ChevronDown,
  ChevronUp,
  Calendar
} from "lucide-react";
import { differenceInDays } from "date-fns";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { formatEastern } from "@/components/utils/timezone";
import { ALL_ROWS } from '@/lib/queryLimits';

const acknowledgedUpdatesKey = (nurseEmail) => (
  typeof nurseEmail === 'string' && nurseEmail.trim()
    ? `acknowledged_updates_${nurseEmail}`
    : null
);

export function parseAcknowledgedUpdates(saved) {
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id) => typeof id === 'string' && id.length > 0))]
      : [];
  } catch {
    return [];
  }
}

function readAcknowledgedUpdates(nurseEmail) {
  try {
    const key = acknowledgedUpdatesKey(nurseEmail);
    return key ? parseAcknowledgedUpdates(localStorage.getItem(key)) : [];
  } catch {
    return [];
  }
}

export default function NurseRegulatoryAlerts({ nurseEmail, compact = false }) {
  const [expanded, setExpanded] = useState(!compact);
  const [acknowledgmentState, setAcknowledgmentState] = useState(() => ({
    owner: nurseEmail,
    ids: readAcknowledgedUpdates(nurseEmail),
  }));
  const acknowledgedUpdates = acknowledgmentState.owner === nurseEmail
    ? acknowledgmentState.ids
    : [];

  // This component can remain mounted while the authenticated user changes.
  // Re-scope local preferences instead of showing the previous nurse's state.
  useEffect(() => {
    setAcknowledgmentState({
      owner: nurseEmail,
      ids: readAcknowledgedUpdates(nurseEmail),
    });
  }, [nurseEmail]);

  const {
    data: updates = [],
    isPending: updatesPending,
    isError: updatesFailed,
  } = useQuery({
    queryKey: ['implementedRegUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.filter({ 
      status: { $in: ['approved', 'implemented'] }
    }, '-effective_date', ALL_ROWS),
  });

  // Filter to recent and unacknowledged updates
  const relevantUpdates = (updates || []).filter(u => {
    const daysSinceImplemented = differenceInDays(new Date(), new Date(u.reviewed_at || u.created_date));
    return daysSinceImplemented <= 30 && !acknowledgedUpdates.includes(u.id);
  });

  const handleAcknowledge = (updateId) => {
    if (typeof updateId !== 'string' || !updateId || acknowledgedUpdates.includes(updateId)) return;
    const newAcknowledged = [...acknowledgedUpdates, updateId];
    setAcknowledgmentState({ owner: nurseEmail, ids: newAcknowledged });
    try {
      const key = acknowledgedUpdatesKey(nurseEmail);
      if (key) localStorage.setItem(key, JSON.stringify(newAcknowledged));
    } catch { /* no-op */ }
  };

  const getImpactColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      default: return 'bg-blue-500 text-white';
    }
  };

  if (!updatesPending && !updatesFailed && relevantUpdates.length === 0 && compact) {
    return null;
  }

  if (compact) {
    return (
      <Alert className="bg-indigo-50 border-indigo-200">
        {updatesFailed
          ? <AlertCircle className="w-4 h-4 text-red-600" />
          : <Bell className="w-4 h-4 text-indigo-600" />}
        <AlertDescription className="text-indigo-900">
          {updatesPending ? (
            <span className="font-semibold">Checking for regulatory updates…</span>
          ) : updatesFailed ? (
            <span className="font-semibold">Regulatory updates could not be loaded. Please try again.</span>
          ) : (
            <>
              <span className="font-semibold">{relevantUpdates.length} New Regulation Update(s)</span>
              <span className="ml-2">requiring your attention.</span>
              <Link to={createPageUrl("ComplianceCenter")} className="ml-2 text-indigo-700 underline hover:text-indigo-800">
                Review Now →
              </Link>
            </>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50 p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between px-6 py-3 text-left"
          aria-expanded={expanded}
          aria-controls="regulatory-updates-content"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="w-4 h-4 text-indigo-600" />
            Regulatory Updates
            {relevantUpdates.length > 0 && (
              <Badge className="bg-red-500 text-white ml-2">
                {relevantUpdates.length} New
              </Badge>
            )}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </CardHeader>

      {expanded && (
        <CardContent id="regulatory-updates-content" className="p-4 space-y-3">
          {updatesPending ? (
            <p className="py-4 text-center text-sm text-slate-600" role="status">
              Checking for regulatory updates…
            </p>
          ) : updatesFailed ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Regulatory updates could not be loaded. Refresh the page to try again.
              </AlertDescription>
            </Alert>
          ) : relevantUpdates.length === 0 ? (
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
                    aria-label={`Acknowledge ${update.title || 'regulatory update'}`}
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
                      Effective: {update.effective_date ? formatEastern(update.effective_date, 'MMM d, yyyy') : 'Now'}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          {!updatesPending && !updatesFailed && relevantUpdates.length > 0 && (
            <p className="text-xs text-slate-500 text-center">
              ✓ Check to acknowledge you've reviewed each update
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
