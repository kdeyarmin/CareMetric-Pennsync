import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export default function ManagerSkillGapAreas({ areas = [] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skill gap analysis by training area</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {areas.length === 0 ? (
          <div className="text-sm text-slate-500">No completed assessments yet for this team.</div>
        ) : (
          areas.map((area) => (
            <div key={area.name} className="rounded-2xl border p-4 bg-white">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-semibold text-slate-900">{area.name}</h3>
                  <p className="text-sm text-slate-500">{area.courseCount} module{area.courseCount === 1 ? "" : "s"} • {area.attemptCount} assessment{area.attemptCount === 1 ? "" : "s"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Avg {area.averageScore}%</Badge>
                  <Badge className={area.failureRate >= 35 ? "bg-red-100 text-red-800" : area.failureRate >= 20 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
                    {area.failureRate}% fail rate
                  </Badge>
                </div>
              </div>
              <Progress value={area.averageScore} className="h-2" />
              {area.topIssue && <p className="text-sm text-slate-600 mt-3">Top issue: {area.topIssue}</p>}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}