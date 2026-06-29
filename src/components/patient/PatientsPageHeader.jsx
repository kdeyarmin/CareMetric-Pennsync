import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Users } from "lucide-react";

export default function PatientsPageHeader({ patientCount, activeCount, onAdd }) {
  return (
    <Card className="border-0 shadow-[0_20px_60px_rgba(15,23,42,0.08)] bg-gradient-to-r from-white via-slate-50 to-blue-50/70 mb-6">
      <CardContent className="p-5 sm:p-6 md:p-7">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-12 w-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Roster workspace</p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Patient Management</h1>
              </div>
            </div>
            <p className="text-sm sm:text-base text-slate-600 max-w-2xl">
              Manage the active roster, review duplicates, and keep imported census data clean and organized.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{patientCount} patients</Badge>
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{activeCount} active</Badge>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <Button onClick={onAdd} className="bg-blue-600 hover:bg-blue-700 min-h-[46px] px-5">
              <Plus className="w-4 h-4 mr-2" />
              Add Patient
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}