import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { savePayrollProfile } from "@/functions/savePayrollProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UsersRound, Search, Check, Info } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_TYPES, toNumber } from "./timesheetUtils";

/**
 * Admin panel to configure each employee for payroll: their company/service line
 * (home health or hospice — which sets their timesheet view and payroll report),
 * whether they're paid by visit points (home-health field staff only; office and
 * all hospice staff are hourly), and a standing per-pay phone reimbursement.
 * No pay rates here — points and reimbursements only.
 */
export default function PayrollSetupPanel({ employees = [], profiles = [] }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState({}); // email -> { phone_reimbursement, active }

  const profileByEmail = useMemo(() => {
    const map = new Map();
    for (const p of profiles) map.set(p.employee_email, p);
    return map;
  }, [profiles]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...employees]
      .filter((e) => !q || (e.name || e.email || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }, [employees, query]);

  const save = useMutation({
    mutationFn: async (employee) => {
      const edit = edits[employee.email] || {};
      const profile = profileByEmail.get(employee.email);
      const service_type =
        edit.service_type ?? profile?.service_type ?? employee.service_type ?? "home_health";
      const earns_points =
        service_type === "home_health" && (edit.earns_points ?? profile?.earns_points === true) === true;
      const payload = {
        employee_email: employee.email,
        service_type,
        earns_points,
        phone_reimbursement: toNumber(edit.phone_reimbursement ?? profile?.phone_reimbursement ?? 0),
        active: edit.active ?? (profile ? profile.active !== false : true),
      };
      const result = await savePayrollProfile(payload);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_data, employee) => {
      toast.success(`Saved payroll setup for ${employee.name || employee.email}.`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[employee.email];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["payroll-profiles"] });
    },
    onError: (err) => toast.error(err?.response?.data?.error || err?.message || "Could not save."),
  });

  const valueFor = (email, field, fallback) =>
    edits[email]?.[field] !== undefined ? edits[email][field] : fallback;

  const setEdit = (email, patch) =>
    setEdits((prev) => ({ ...prev, [email]: { ...prev[email], ...patch } }));

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UsersRound className="w-5 h-5 text-slate-600" />
            Employee Payroll Setup
          </CardTitle>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              className="pl-8 h-9 w-[220px]"
              placeholder="Search employees…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Alert className="bg-blue-50 border-blue-200 mb-4">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            Set each employee's company (home health or hospice), whether they're paid by visit points
            (home-health field staff only — office and hospice staff are hourly), and a standing per-pay phone
            reimbursement. These drive the employee's timesheet view and payroll report. No pay rates here.
          </AlertDescription>
        </Alert>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No employees match your search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="py-2 px-3 font-medium">Company / service line</th>
                  <th className="py-2 px-3 font-medium">Paid by points</th>
                  <th className="py-2 px-3 font-medium">Phone reimb. / pay ($)</th>
                  <th className="py-2 px-3 font-medium">Applied</th>
                  <th className="py-2 pl-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const profile = profileByEmail.get(e.email);
                  const serviceType = valueFor(
                    e.email,
                    "service_type",
                    profile?.service_type || e.service_type || "home_health"
                  );
                  const earnsPoints =
                    serviceType === "home_health" &&
                    valueFor(e.email, "earns_points", profile?.earns_points === true) === true;
                  const amount = valueFor(e.email, "phone_reimbursement", profile?.phone_reimbursement ?? "");
                  const active = valueFor(e.email, "active", profile ? profile.active !== false : true);
                  const dirty = !!edits[e.email];
                  return (
                    <tr key={e.email} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-900">{e.name || e.email}</div>
                        <div className="text-xs text-slate-400">{e.email}</div>
                      </td>
                      <td className="py-2 px-3">
                        <Select
                          value={serviceType}
                          onValueChange={(v) =>
                            setEdit(e.email, { service_type: v, ...(v === "hospice" ? { earns_points: false } : {}) })
                          }
                        >
                          <SelectTrigger className="h-9 w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SERVICE_TYPES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 px-3">
                        <Checkbox
                          checked={earnsPoints}
                          disabled={serviceType !== "home_health"}
                          onCheckedChange={(checked) => setEdit(e.email, { earns_points: checked === true })}
                          aria-label="Paid by points"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className="h-9 w-28"
                          placeholder="0.00"
                          value={amount}
                          onChange={(ev) => setEdit(e.email, { phone_reimbursement: ev.target.value })}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Checkbox
                          checked={active === true}
                          onCheckedChange={(checked) => setEdit(e.email, { active: checked === true })}
                          aria-label="Applied"
                        />
                      </td>
                      <td className="py-2 pl-3">
                        <Button
                          size="sm"
                          variant={dirty ? "default" : "outline"}
                          disabled={save.isPending}
                          onClick={() => save.mutate(e)}
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
