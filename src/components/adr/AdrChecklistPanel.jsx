import { Printer, ShieldAlert, CalendarClock, Info } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AICaveat from "@/components/ui/AICaveat";
import { groupChecklistByCategory } from "./adrRequirements";
import { buildChecklistPrintHtml } from "./adrChecklistPrint";

const severityBadge = (severity) => {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-700 border border-red-200";
    case "high":
      return "bg-amber-100 text-amber-700 border border-amber-200";
    default:
      return "bg-blue-50 text-blue-700 border border-blue-200";
  }
};

const sourceLabel = (source) => {
  switch (source) {
    case "cms_baseline":
      return "CMS baseline";
    case "letter":
      return "Letter only";
    default:
      return "Requested in letter";
  }
};

/**
 * Read-only view of the case's requirement checklist with a print action.
 * The printed sheet is what office staff work from while pulling records.
 */
export default function AdrChecklistPanel({ adrCase }) {
  const checklist = adrCase?.checklist || [];
  const groups = groupChecklistByCategory(checklist);
  const analysis = adrCase?.letter_analysis || {};

  const handlePrint = () => {
    const html = buildChecklistPrintHtml({ caseMeta: adrCase, groups });
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Unable to open the print view. Please allow pop-ups for this site.");
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  if (checklist.length === 0) {
    return (
      <Alert className="bg-slate-50 border-slate-200">
        <Info className="w-4 h-4 text-slate-500" />
        <AlertDescription className="text-slate-600">
          No checklist yet — analyze the ADR letter first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Required documentation ({checklist.length} items)</h3>
          <AICaveat label="Checklist derived from the letter by AI + CMS baseline — verify against the actual letter" />
        </div>
        <Button onClick={handlePrint} variant="outline" className="min-h-[44px] w-full sm:w-auto">
          <Printer className="w-4 h-4 mr-2" />
          Print checklist
        </Button>
      </div>

      {adrCase?.response_due_date && (
        <Alert className="bg-red-50 border-red-300">
          <CalendarClock className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-900 font-medium">
            Response due {adrCase.response_due_date}. Documentation not received by the deadline is treated as missing
            and the claim is denied.
          </AlertDescription>
        </Alert>
      )}

      {(analysis.special_instructions || []).length > 0 && (
        <Alert className="bg-amber-50 border-amber-300">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900">
            <span className="font-semibold">Contractor instructions from the letter:</span>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {analysis.special_instructions.map((instruction, i) => (
                <li key={i}>{instruction}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {(analysis.unclear_fields || []).length > 0 && (
        <Alert className="bg-amber-50 border-amber-300">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900">
            Hard to read on the letter — verify manually: {analysis.unclear_fields.join(", ")}
          </AlertDescription>
        </Alert>
      )}

      {groups.map((group) => (
        <Card key={group.category}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-semibold text-navy-700">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.items.map((item) => (
              <div key={`${item.id}_${item.seq}`} className="border border-slate-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{item.title}</span>
                  <Badge className={severityBadge(item.severity)}>{item.severity}</Badge>
                  <Badge variant="outline" className="text-slate-500">
                    {sourceLabel(item.source)}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {item.citation}
                  {item.when && item.when !== "always" ? ` · Applies: ${item.when}` : ""}
                </p>
                {item.letter_text && (
                  <p className="text-sm text-slate-600 mt-1 italic">
                    Letter wording: &ldquo;{item.letter_text}&rdquo;
                    {item.letter_details ? ` — ${item.letter_details}` : ""}
                  </p>
                )}
                <p className="text-sm text-slate-700 mt-1">{item.what_to_include}</p>
                {(item.verification_points || []).length > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    <span className="font-semibold">Reviewer will check:</span>
                    <ul className="list-disc pl-5 mt-0.5 space-y-0.5">
                      {item.verification_points.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
