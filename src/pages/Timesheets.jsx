import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey, loadAgencyRoster } from '@/lib/agencyRoster';
import { filterRowsByStaffAgency, filterUsersByCallerAgency } from '@/lib/agencyScope';
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { isAdminView } from "@/lib/roles";

import MyTimesheetForm from "@/components/timesheet/MyTimesheetForm";
import MyTimesheetsList from "@/components/timesheet/MyTimesheetsList";
import TimesheetApprovalsQueue from "@/components/timesheet/TimesheetApprovalsQueue";
import PayrollExportPanel from "@/components/timesheet/PayrollExportPanel";
import PayrollReports from "@/components/timesheet/PayrollReports";
import PayrollSetupPanel from "@/components/timesheet/PayrollSetupPanel";
import VisitPointConfigCard from "@/components/timesheet/VisitPointConfigCard";
import { toNumber, resolvedServiceType, employeeEarnsPoints } from "@/components/timesheet/timesheetUtils";

export default function Timesheets() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  // Match the app's role model: facility admins (role 'admin' or agency_admin
  // account type) and the super admin all see the admin workflow.
  const isAdmin = isAdminView(currentUser);
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
  // Facility admins with an agency additionally filter client-side — Timesheet
  // RLS is bare role:admin and would otherwise show other tenants' rows.
  const { data: teamTimesheets = [] } = useQuery({
    queryKey: ["timesheets", "team", currentUser?.email, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const rows = await base44.entities.Timesheet.list("-pay_period_start", 2000);
      return filterRowsByStaffAgency(
        rows, await loadAgencyRoster(), currentUser, (t) => t.employee_email,
      );
    },
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
  // The current user's admin-set company + points eligibility drive their view.
  const myServiceType = resolvedServiceType(myProfile, currentUser);
  const myEarnsPoints = employeeEarnsPoints(myProfile, myServiceType);

  // Facility visit-type point values — readable by everyone so the nurse form can
  // preview total points; only admins can edit them (server-enforced).
  const { data: visitPointConfig = null } = useQuery({
    queryKey: ["visit-point-config", currentUser?.agency_name || null],
    queryFn: async () => {
      const agency = String(currentUser?.agency_name || "").trim();
      let rows = [];
      if (agency) {
        rows = await base44.entities.VisitPointConfig
          .filter({ agency_name: agency }, "-updated_date", 10)
          .catch(() => []);
      }
      if (!rows?.length) {
        // Legacy unscoped rows: only for platform callers (no agency). When the
        // caller has an agency, never apply another tenant's empty-agency config.
        if (!agency) {
          const all = await base44.entities.VisitPointConfig.list("-updated_date", 5);
          if ((all || []).length <= 1) rows = all || [];
        }
      }
      return (rows || []).find((c) => c.active !== false) || (rows || [])[0] || null;
    },
    initialData: null,
    enabled: !!currentUser?.email,
  });

  // Candidate approvers for the timesheet form (admins + flagged managers).
  const { data: approvers = [] } = useQuery({
    queryKey: ["timesheets", "approvers", currentUser?.email, agencyQueryKey(currentUser)],
    queryFn: async () => {
      try {
        const users = await base44.entities.User.list("full_name", 500);
        const { filterUsersByCallerAgency } = await import("@/lib/agencyScope");
        // Nurses with an agency only see same-agency approvers (backend enforces too).
        const scoped = filterUsersByCallerAgency(users, currentUser);
        return scoped
          .filter((u) =>
            u.email
            && (u.role === "admin" || u.account_type === "agency_admin" || u.is_manager === true),
          )
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
    queryKey: ["timesheets", "employees", agencyQueryKey(currentUser)],
    queryFn: async () => {
      try {
        const users = await base44.entities.User.list("full_name", 500);
        return filterUsersByCallerAgency(users, currentUser)
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
    queryKey: ["payroll-profiles", agencyQueryKey(currentUser)],
    queryFn: async () => {
      const rows = await base44.entities.EmployeePayrollProfile.list("-updated_date", 1000);
      return filterRowsByStaffAgency(
        rows, await loadAgencyRoster(), currentUser, (p) => p.employee_email,
      );
    },
    initialData: [],
    enabled: !!currentUser?.email && isAdmin,
  });

  // Roster with each employee's ADMIN-SET service line applied (profile overrides
  // the user record) — drives payroll coverage/reports.
  const employeesEffective = useMemo(() => {
    const byEmail = new Map(payrollProfiles.map((p) => [p.employee_email, p]));
    return employees.map((e) => ({ ...e, service_type: byEmail.get(e.email)?.service_type || e.service_type }));
  }, [employees, payrollProfiles]);

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
              visitPointConfig={visitPointConfig}
              employeeServiceType={myServiceType}
              employeeEarnsPoints={myEarnsPoints}
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
              <PayrollExportPanel timesheets={teamTimesheets} employees={employeesEffective} />
            </TabsContent>
            <TabsContent value="reports">
              <PayrollReports timesheets={teamTimesheets} />
            </TabsContent>
            <TabsContent value="setup" className="space-y-6">
              <VisitPointConfigCard config={visitPointConfig} />
              <PayrollSetupPanel employees={employees} profiles={payrollProfiles} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </PageContainer>
  );
}
