import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { manageAgencyMembership } from "@/functions/manageAgencyMembership";
import { isSuperAdmin, isSuperAdminEmail } from "@/lib/superAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Loader2 } from "lucide-react";

/**
 * Agency access — the one place the platform owner gives a person a clinical
 * workspace.
 *
 * An account alone opens nothing: every clinical screen requires an ACTIVE
 * AgencyMembership, and only the protected platform owner may create one
 * (`manageAgencyMembership` refuses `provision` to anyone else, and refuses to
 * give the owner a membership at all). Until this panel there was no screen
 * that called that function, so staff the owner invited stopped at "No clinical
 * workspace was opened" with no way in.
 *
 * Every rule stays in the function — role set, owner identity, agency status,
 * deactivated targets, version checks. This panel only sends the request and
 * shows the answer inline, because the tenant-safe toast wrapper replaces
 * caller text with a generic line.
 */
export const TENANT_ROLE_OPTIONS = Object.freeze([
  { value: "agency_admin", label: "Agency administrator" },
  { value: "manager", label: "Manager" },
  { value: "clinician", label: "Clinician (nurse / therapist)" },
  { value: "office_staff", label: "Office staff" },
  { value: "social_worker", label: "Social worker" },
  { value: "spiritual_care", label: "Spiritual care" },
]);

// The invitation records a staff discipline (`staff_role`, applied to the User
// by onUserSignup); the membership needs a tenant role. This only pre-selects
// the dropdown, and the owner still chooses before granting.
const STAFF_ROLE_TO_TENANT_ROLE = Object.freeze({
  nurse: "clinician",
  office_staff: "office_staff",
  social_worker: "social_worker",
  spiritual_care: "spiritual_care",
});

export function suggestedTenantRole(user) {
  return STAFF_ROLE_TO_TENANT_ROLE[user?.staff_role] || "clinician";
}

const STATUS_TONE = {
  active: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  suspended: "bg-orange-100 text-orange-800",
  revoked: "bg-slate-200 text-slate-700",
  none: "bg-slate-100 text-slate-600",
};

const REASON = "Access managed by the platform owner in User Management";

function membershipOf(response) {
  return response?.data?.membership ?? response?.membership ?? null;
}

function errorText(error) {
  const status = error?.status ?? error?.response?.status;
  const message = error?.data?.error || error?.response?.data?.error || error?.message;
  return status ? `${message || "Request failed"} (${status})` : (message || "Request failed");
}

async function inspect(agencyId, user) {
  try {
    const response = await manageAgencyMembership({
      action: "inspect",
      agency_id: agencyId,
      target_user_id: user.id,
      target_user_email: String(user.email || "").trim().toLowerCase(),
    });
    return membershipOf(response);
  } catch (error) {
    if ((error?.status ?? error?.response?.status) === 404) return null;
    throw error;
  }
}

function AccessRow({ agencyId, user, onChanged }) {
  const email = String(user.email || "").trim().toLowerCase();
  const { data: membership, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["agencyMembership", agencyId, user.id],
    queryFn: () => inspect(agencyId, user),
    enabled: Boolean(agencyId && user.id && email),
  });
  const [role, setRole] = useState(() => suggestedTenantRole(user));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (membership?.tenant_role) setRole(membership.tenant_role);
  }, [membership?.tenant_role]);

  const run = async (steps, done) => {
    setBusy(true);
    setMessage(null);
    try {
      let current = membership;
      for (const step of steps) {
        const response = await manageAgencyMembership(step(current));
        current = membershipOf(response) ?? current;
      }
      setMessage({ tone: "ok", text: done });
      await refetch();
      onChanged?.();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  const base = { agency_id: agencyId, target_user_id: user.id, target_user_email: email };
  const transition = (action, extra = {}) => (current) => ({
    ...base, action, reason: REASON, expected_version: current.version, ...extra,
  });

  const status = membership?.status ?? "none";
  const deactivated = user.is_active === false;

  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{user.full_name || email}</p>
        <p className="truncate text-xs text-slate-500">{email}</p>
        {message && (
          <p role="status" className={`mt-1 text-xs ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>
            {message.text}
          </p>
        )}
        {loadError && <p role="status" className="mt-1 text-xs text-red-700">{errorText(loadError)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Loading access" />
        ) : (
          <Badge className={STATUS_TONE[status] || STATUS_TONE.none}>
            {status === "none" ? "No access" : status}
          </Badge>
        )}
        {deactivated ? (
          <span className="text-xs text-slate-500">Account deactivated</span>
        ) : (
          <>
            <Select value={role} onValueChange={setRole} disabled={busy || status === "revoked"}>
              <SelectTrigger className="h-10 w-56" aria-label={`Role for ${email}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TENANT_ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {status === "none" && (
              <Button
                size="sm"
                disabled={busy || isLoading}
                onClick={() => run([
                  () => ({ ...base, action: "provision", reason: REASON, tenant_role: role }),
                  transition("activate"),
                ], "Access granted.")}
              >
                Grant access
              </Button>
            )}
            {(status === "pending" || status === "suspended") && (
              <Button size="sm" disabled={busy} onClick={() => run([transition("activate")], "Access activated.")}>
                Activate
              </Button>
            )}
            {status === "active" && role !== membership.tenant_role && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run([transition("change_role", { tenant_role: role })], "Role updated.")}
              >
                Save role
              </Button>
            )}
            {status === "active" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run([transition("suspend")], "Access suspended.")}>
                Suspend
              </Button>
            )}
            {(status === "active" || status === "suspended" || status === "pending") && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run([transition("revoke")], "Access revoked.")}>
                Revoke
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export default function AgencyAccessPanel({ currentUser, users = [] }) {
  const queryClient = useQueryClient();
  const owner = isSuperAdmin(currentUser);
  const { data: agencies = [], isLoading } = useQuery({
    queryKey: ["agencyAccessAgencies"],
    queryFn: () => base44.entities.Agency.list("-created_date", 50),
    enabled: owner,
  });
  const usable = useMemo(
    () => agencies.filter((agency) => agency?.status === "active" || agency?.status === "trial"),
    [agencies],
  );
  const [agencyId, setAgencyId] = useState("");
  useEffect(() => {
    if (!agencyId && usable[0]?.id) setAgencyId(usable[0].id);
  }, [agencyId, usable]);

  // The owner cannot hold a membership (the function refuses), so the owner's
  // own row would only ever show an error.
  const staff = useMemo(
    () => users.filter((user) => user?.id && user?.email && !isSuperAdminEmail(user.email)),
    [users],
  );

  if (!owner) return null;

  return (
    <Card className="mb-4 sm:mb-6 modern-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-5 w-5 text-navy-600" aria-hidden />
          Agency access
        </CardTitle>
        <p className="text-sm text-slate-600">
          An account opens nothing on its own. Invite the person with <strong>Add user</strong> below,
          then give them a role here so they can open the agency&apos;s clinical workspace.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading agencies" />
        ) : usable.length === 0 ? (
          <p className="text-sm text-slate-600">No active agency exists yet.</p>
        ) : (
          <>
            {usable.length > 1 && (
              <Select value={agencyId} onValueChange={setAgencyId}>
                <SelectTrigger className="mb-3 h-10 w-full sm:w-80" aria-label="Agency">
                  <SelectValue placeholder="Choose an agency" />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((agency) => (
                    <SelectItem key={agency.id} value={agency.id}>{agency.agency_name || agency.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {usable.length === 1 && (
              <p className="mb-2 text-sm font-medium text-slate-800">{usable[0].agency_name || "Your agency"}</p>
            )}
            {staff.length === 0 ? (
              <p className="text-sm text-slate-600">No staff accounts yet. Use <strong>Add user</strong> to invite someone.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {staff.map((user) => (
                  <AccessRow
                    key={`${agencyId}:${user.id}`}
                    agencyId={agencyId}
                    user={user}
                    onChanged={() => queryClient.invalidateQueries({ queryKey: ["allUsersManagement"] })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
