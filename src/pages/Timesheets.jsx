import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

import MyTimesheetForm from "@/components/timesheet/MyTimesheetForm";
import MyTimesheetsList from "@/components/timesheet/MyTimesheetsList";
import TimesheetApprovalsQueue from "@/components/timesheet/TimesheetApprovalsQueue";
import PayrollExportPanel from "@/components/timesheet/PayrollExportPanel";
import PayrollReports from "@/components/timesheet/PayrollReports";
import PayrollSetupPanel from "@/components/timesheet/PayrollSetupPanel";
import { toNumber } from "@/components/timesheet/timesheetUtils";

export default function Timesheets() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === "admin";
  const isApprover = isAdmin || currentUser?.is_manager === true;

  const [editing, setEditing] = useState(null);

  // The current user's own timesheets.
  const { data: myTimesheets = [] } = useQuery({
    queryKey: ["timesheets", "mine", currentUser?.email],
    queryFn: () =>
      base44.entities.Timesheet.filter({ employee_email: currentUser.email }, "-pay_period_start", 200),
    initialData: [],
    enabled: !!currentUser?.email,
  });

  // Timesheets this user can review/oversee (RLS scopes: admins all, managers
  // their reports' + their own). Used for approvals, payroll, and reports.
  const { data: teamTimesheets = [] } = useQuery({
    queryKey: ["timesheets", "team", currentUser?.email],
    queryFn: () => base44.entities.Timesheet.list("-pay_period_start", 2000),
    initialData: [],
    enabled: !!currentUser?.email && isApprover,
  });

  // The user's APPROVED time off — drives the auto-PTO preview on the form.
  const { data: approvedTimeOff = [] } = useQuery({
    queryKey: ["timesheets", "my-approved-pto", currentUser?.email],
    queryFn: () =>
      base44.entities.TimeOffRequest.filter(
        { employee_email: currentUser.email, status: "approved" },
        "-start_date",
        200
      ),
    initialData: [],
    enabled: !!currentUser?.email,
  });

  // The current user's own payroll profile — drives the standing phone
  // reimbursement note on the form.
  const { data: myProfile = null } = useQuery({
    queryKey: ["payroll-profiles", "mine", currentUser?.email],
    queryFn: async () => {
      const rows = await base44.entities.EmployeePayrollProfile.filter({ employee_email: currentUser.email });
      return (rows || []).find((p) => p.active !== false) || (rows || [])[0] || null;
    },
    initialData: null,
    enabled: !!currentUser?.email,
  });
  const myPhoneReimbursement = toNumber(myProfile?.phone_reimbursement);

  // Candidate approvers for the timesheet form (admins + flagged managers).
  const { data: approvers = [] } = useQuery({
    queryKey: ["timesheets", "approvers", currentUser?.email],
    queryFn: async () => {
      try {
        const users = await base44.entities.User.list("full_name", 500);
        return users
          .filter((u) => u.email && (u.role === "admin" || u.is_manager === true))
          .filter((u) => u.email !== currentUser?.email)
          .map((u) => ({ email: u.email, name: u.full_name || u.email, role: u.role }));
      } catch {
        return [];
      }
    },
    initialData: [],
    enabled: !!currentUser?.email,
  });

  // Clinical staff roster (admin) — expected submitters for coverage + the
  // phone-reimbursement setup list.
  const { data: employees = [] } = useQuery({
    queryKey: ["timesheets", "employees"],
    queryFn: async () => {
      try {
        const users = await base44.entities.User.list("full_name", 500);
        return users
          .filter((u) => u.email && u.role === "user" && u.is_active !== false)
          .map((u) => ({
            email: u.email,
            name: u.full_name || u.email,
            service_type: u.service_type || "home_health",
            is_active: u.is_active !== false,
          }));
      } catch {
        return [];
      }
    },
    initialData: [],
    enabled: !!currentUser?.email && isAdmin,
  });

  // All standing payroll profiles (admin) — for the setup panel.
  const { data: payrollProfiles = [] } = useQuery({
    queryKey: ["payroll-profiles"],
    queryFn: () => base44.entities.EmployeePayrollProfile.list("-updated_date", 1000),
    initialData: [],
    enabled: !!currentUser?.email && isAdmin,
  });

  // Timesheets this user can act on (exclude their own — no self-approval).
  const reviewable = useMemo(
    () => teamTimesheets.filter((t) => t.employee_email !== currentUser?.email),
    [teamTimesheets, currentUser?.email]
  );

  const pendingCount = reviewable.filter((t) => t.status === "submitted").length;

  const listCols = isAdmin ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : isApprover ? "grid-cols-2" : "grid-cols-1";

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardList}
        eyebrow="Tools"
        title="Timesheets"
        description={`Submit your pay-period timesheet${
          isApprover ? ", approve your team's timesheets, and export payroll for the accountant" : " and track its approval"
        }.`}
        favoritePage="Timesheets"
      />

      <Tabs defaultValue="mine" className="space-y-6">
        <TabsList className={`grid w-full ${listCols}`}>
          <TabsTrigger value="mine" className="min-h-[44px]">
            My Timesheet
          </TabsTrigger>
          {isApprover && (
            <TabsTrigger value="approvals" className="min-h-[44px] relative">
              Approvals
              {pendingCount > 0 && (
                <Badge className="ml-2 bg-amber-500 text-white h-5 min-w-[20px] px-1.5">{pendingCount}</Badge>
              )}
            </TabsTrigger>
          )}
          {isAdmin && (
            <>
              <TabsTrigger value="payroll" className="min-h-[44px]">
                Payroll Export
              </TabsTrigger>
              <TabsTrigger value="reports" className="min-h-[44px]">
                Reports
              </TabsTrigger>
              <TabsTrigger value="setup" className="min-h-[44px]">
                Payroll Setup
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="mine" className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 items-start">
            <MyTimesheetForm
              currentUser={currentUser}
              approvers={approvers}
              defaultManagerEmail={currentUser?.manager_email || ""}
              approvedTimeOff={approvedTimeOff}
              phoneReimbursement={myPhoneReimbursement}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
            />
            <MyTimesheetsList timesheets={myTimesheets} onEdit={setEditing} />
          </div>
        </TabsContent>

        {isApprover && (
          <TabsContent value="approvals">
            <TimesheetApprovalsQueue timesheets={reviewable} />
          </TabsContent>
        )}

        {isAdmin && (
          <>
            <TabsContent value="payroll">
              <PayrollExportPanel timesheets={teamTimesheets} employees={employees} />
            </TabsContent>
            <TabsContent value="reports">
              <PayrollReports timesheets={teamTimesheets} />
            </TabsContent>
            <TabsContent value="setup">
              <PayrollSetupPanel employees={employees} profiles={payrollProfiles} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </PageContainer>
  );
}
