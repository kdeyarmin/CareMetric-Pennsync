import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import EmptyState from "@/components/ui/empty-state";
import { GraduationCap, Clock, ShieldCheck, AlertTriangle, Award } from "lucide-react";

const fmtHours = (hours) => `${hours} hr${hours === 1 ? "" : "s"}`;

/**
 * Credit-year transcript summary, the way a healthcare LMS reports it: CE credit
 * and clock hours totalled per credit year instead of one lifetime figure, plus
 * progress against the learner's annual in-service hour requirement when one
 * applies (aides, per 42 CFR §484.80(d)).
 *
 * Presentational — the caller passes the result of `buildCeTranscript`.
 */
export default function CeCreditSummary({ transcript, compact = false }) {
  const { years = [], currentYear, totalCeHours = 0, totalTrainingHours = 0, requirement, progress } =
    transcript || {};

  if (years.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No credit earned yet"
        description="Completed courses that issue a certificate will appear here with their CE credit and training hours."
      />
    );
  }

  const thisYear = currentYear?.year ?? years[0].year;
  const ceThisYear = currentYear?.ceHours ?? 0;
  const trainingThisYear = currentYear?.trainingHours ?? 0;

  return (
    <div className="space-y-4">
      <Card className="border-navy-200 bg-navy-50/30">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 bg-navy-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-6 h-6 text-navy-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Continuing education — {thisYear}</h3>
                <p className="text-sm text-slate-600">
                  Credit from your issued certificates. {totalCeHours} CE hr{totalCeHours === 1 ? "" : "s"} and{" "}
                  {fmtHours(totalTrainingHours)} of training on record overall.
                </p>
              </div>
            </div>
            <div className="flex gap-6 flex-shrink-0">
              <div className="text-right">
                <p className="text-3xl font-bold text-navy-600">{ceThisYear}</p>
                <p className="text-xs text-slate-500">CE hours</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-slate-700">{trainingThisYear}</p>
                <p className="text-xs text-slate-500">training hours</p>
              </div>
            </div>
          </div>

          {requirement && progress && (
            <div
              className={`rounded-xl border p-3 ${
                progress.met ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  {progress.met ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  )}
                  {requirement.label}
                </p>
                <p className="text-sm text-slate-700">
                  {progress.completedHours} of {progress.requiredHours} hours
                  {progress.met ? " — requirement met" : ` — ${fmtHours(progress.remainingHours)} remaining`}
                </p>
              </div>
              <Progress value={progress.percent} className="h-2 mt-2" />
              <p className="text-xs text-slate-500 mt-1.5">
                {requirement.description} ({requirement.citation})
              </p>
            </div>
          )}

          {currentYear?.byCategory?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currentYear.byCategory.map((entry) => (
                <Badge key={entry.category} variant="outline" className="capitalize text-xs">
                  {entry.category.replace(/_/g, " ")}: {fmtHours(entry.hours)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!compact && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-slate-800">
              <Award className="w-4 h-4 text-navy-600" /> Credit by year
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">Credit year</th>
                    <th className="py-2 pr-4 font-medium">Courses</th>
                    <th className="py-2 pr-4 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Training hours
                      </span>
                    </th>
                    <th className="py-2 font-medium">CE hours</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((entry) => (
                    <tr key={entry.year} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-semibold text-slate-800">{entry.year}</td>
                      <td className="py-2 pr-4 text-slate-600">{entry.courseCount}</td>
                      <td className="py-2 pr-4 text-slate-600">{entry.trainingHours}</td>
                      <td className="py-2 text-slate-600">{entry.ceHours}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200">
                    <td className="py-2 pr-4 font-semibold text-slate-800">Total</td>
                    <td className="py-2 pr-4 font-semibold text-slate-800">
                      {years.reduce((sum, entry) => sum + entry.courseCount, 0)}
                    </td>
                    <td className="py-2 pr-4 font-semibold text-slate-800">{totalTrainingHours}</td>
                    <td className="py-2 font-semibold text-slate-800">{totalCeHours}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
