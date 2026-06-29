import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Stethoscope, BookOpen, DollarSign, CheckCircle2, Info } from "lucide-react";

/**
 * ClinicalAlertsPanel — renders the clinical decision-support alerts produced by
 * `buildClinicalAlerts` (see oasisScrubberData.jsx). Extracted from OASISScrubber,
 * which rendered the same `alerts` data in two cosmetic variants:
 *
 *   - "compact"  — the small preview shown inside the extracted-indicators section.
 *   - "expanded" — the full card shown in the "Indicators" tab.
 *
 * Purely presentational. `onViewReference` is invoked when the user clicks the
 * per-alert "Details" / "View CMS Guidance" button (the parent uses it to switch
 * to the CMS reference tab). Renders nothing when there are no alerts.
 *
 * @param {{ alerts?: Array, variant?: 'compact'|'expanded', onViewReference?: () => void }} props
 */
export default function ClinicalAlertsPanel({ alerts, variant = "expanded", onViewReference }) {
  if (!alerts?.length) return null;

  if (variant === "compact") {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-navy-50 p-3 rounded-lg border border-blue-300">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-blue-900 flex items-center gap-2">
            <Stethoscope className="w-4 h-4" />
            Clinical Decision Support
          </h4>
          <Badge variant="outline" className="text-xs bg-white">
            {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className="space-y-2">
          {alerts.map((alert, idx) => (
            <div key={idx} className={`bg-white p-2 rounded border ${
              alert.severity === 'high' ? 'border-red-300' : 'border-blue-200'
            }`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs font-semibold text-slate-900">{alert.title}</p>
                <Badge className={`${
                  alert.severity === 'high' ? 'bg-red-500' : 'bg-blue-500'
                } text-white text-xs flex-shrink-0`}>
                  {alert.severity}
                </Badge>
              </div>
              <p className="text-xs text-slate-700 mb-2">{alert.guideline}</p>
              <div className="flex flex-wrap gap-1 mb-1">
                {alert.actions.slice(0, 3).map((action, i) => (
                  <Badge key={i} variant="outline" className="text-xs bg-blue-50">✓ {action}</Badge>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
                <p className="text-xs text-slate-500">
                  <strong>CMS:</strong> {alert.cmsReference}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onViewReference}
                  className="h-5 text-xs text-blue-600 hover:text-blue-800"
                >
                  <BookOpen className="w-3 h-3 mr-1" />
                  Details
                </Button>
              </div>
              {alert.revenueNote && (
                <div className="mt-2 bg-green-50 p-2 rounded border border-green-200">
                  <p className="text-xs text-green-800">
                    <DollarSign className="w-3 h-3 inline mr-1" />
                    <strong>PDGM:</strong> {alert.revenueNote}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="border-blue-300 bg-gradient-to-r from-blue-50 to-navy-50">
      <CardHeader className="py-3 bg-blue-100">
        <CardTitle className="text-sm flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-blue-700" />
          AI Clinical Decision Support ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-3">
          {alerts.map((alert, idx) => (
            <div key={idx} className="bg-white p-3 rounded-lg border-2 border-blue-200">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    alert.severity === 'high' ? 'bg-red-500' : 'bg-blue-500'
                  }`} />
                  <h5 className="font-bold text-slate-900">{alert.title}</h5>
                </div>
                <Badge className={`${
                  alert.severity === 'high' ? 'bg-red-500' : 'bg-blue-500'
                } text-white text-xs`}>
                  {alert.severity} priority
                </Badge>
              </div>

              <div className="bg-blue-50 p-3 rounded border border-blue-200 mb-2">
                <p className="text-xs font-semibold text-blue-900 mb-1">📋 Evidence-Based Guideline:</p>
                <p className="text-sm text-blue-800">{alert.guideline}</p>
              </div>

              <div className="mb-2">
                <p className="text-xs font-semibold text-slate-700 mb-1">Recommended Actions:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {alert.actions.map((action, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs text-slate-700">
                      <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" />
                      {action}
                    </div>
                  ))}
                </div>
              </div>

              {alert.revenueNote && (
                <div className="bg-green-50 p-2 rounded border border-green-200 mb-2">
                  <p className="text-xs text-green-800">
                    <DollarSign className="w-3 h-3 inline mr-1" />
                    <strong>PDGM Impact:</strong> {alert.revenueNote}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <p className="text-xs text-slate-500">
                  <strong>CMS Reference:</strong> {alert.cmsReference}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onViewReference}
                  className="h-6 text-xs"
                >
                  <BookOpen className="w-3 h-3 mr-1" />
                  View CMS Guidance
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Alert className="mt-3 bg-navy-50 border-navy-200">
          <Info className="w-4 h-4 text-navy-600" />
          <AlertDescription className="text-navy-900 text-xs">
            These evidence-based alerts are triggered by clinical indicators detected in your documentation.
            Following these guidelines improves patient outcomes, strengthens OASIS defensibility, and optimizes reimbursement.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
