import { Card, CardContent } from "@/components/ui/card";

const items = [
  ["totalAssigned", "Total Assigned"],
  ["dueSoon", "Due Soon"],
  ["overdue", "Overdue"],
  ["completed", "Completed"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["annualCompliancePercentage", "Compliance %"],
];

export default function AnnualMandatoryStats({ stats = {} }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
      {items.map(([key, label]) => (
        <Card key={key}>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="text-3xl font-bold text-slate-900 mt-2">{stats[key] ?? 0}{key === 'annualCompliancePercentage' ? '%' : ''}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}