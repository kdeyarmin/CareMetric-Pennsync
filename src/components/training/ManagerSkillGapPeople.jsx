import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ManagerSkillGapPeople({ people = [], missedTopics = [] }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employees needing support</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {people.length === 0 ? (
            <div className="text-sm text-slate-500">No employees currently flagged for follow-up.</div>
          ) : (
            people.map((person) => (
              <div key={person.email} className="rounded-2xl border p-4 bg-white">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{person.name}</h3>
                    <p className="text-sm text-slate-500">{person.roleLabel}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Avg {person.averageScore}%</Badge>
                    <Badge className={person.failedAttempts > 0 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>{person.failedAttempts} failed</Badge>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most missed topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {missedTopics.length === 0 ? (
            <div className="text-sm text-slate-500">No missed-topic trends available yet.</div>
          ) : (
            missedTopics.map((topic, index) => (
              <div key={`${topic.prompt}-${index}`} className="rounded-2xl border p-4 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{topic.prompt}</p>
                    <p className="text-sm text-slate-500 mt-1">{topic.category} • missed {topic.missCount} time{topic.missCount === 1 ? "" : "s"}</p>
                  </div>
                  <Badge variant="outline">{topic.missRate}% miss rate</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}