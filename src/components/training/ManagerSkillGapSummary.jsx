import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, BarChart3, Target, Users } from "lucide-react";

const cards = [
  { key: "teamSize", label: "Team Members", icon: Users, color: "text-blue-600" },
  { key: "attemptCount", label: "Assessments", icon: BarChart3, color: "text-indigo-600" },
  { key: "averageScore", label: "Average Score", icon: Target, color: "text-emerald-600", suffix: "%" },
  { key: "followUpCount", label: "Need Follow-Up", icon: AlertTriangle, color: "text-red-600" },
];

export default function ManagerSkillGapSummary({ stats }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.key} className="border-0 shadow-sm bg-white">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                  <p className="text-3xl font-bold text-slate-900 mt-2">{stats[card.key] ?? 0}{card.suffix || ""}</p>
                </div>
                <Icon className={`w-6 h-6 ${card.color}`} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}