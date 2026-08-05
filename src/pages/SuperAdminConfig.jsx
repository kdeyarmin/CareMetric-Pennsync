import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, Crown, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import TelnyxSecretPanel from "@/components/admin/TelnyxSecretPanel";
import TelnyxSetupProgress from "@/components/admin/TelnyxSetupProgress";
import IntegrationsHealthPanel from "@/components/admin/IntegrationsHealthPanel";
import PhoneProvisioningPanel from "@/components/admin/PhoneProvisioningPanel";
import A2PCompliancePanel from "@/components/admin/A2PCompliancePanel";
import ConsentLedgerPanel from "@/components/admin/ConsentLedgerPanel";
import SetupStage from "@/components/admin/SetupStage";
import { SETUP_STAGES, stageStatus, stageIdForAnchor, defaultExpandedStageIds } from "@/components/admin/setupStages";
import { isSuperAdmin, isSuperAdminEmail, SUPER_ADMIN_EMAIL } from "@/lib/superAdmin";

/**
 * SuperAdminConfig — the single, easy-to-use control panel for the platform
 * super admin. It does three things:
 *   1. Confirms / self-heals the super admin account (ensureSuperAdmin).
 *   2. Manages the Telnyx credentials (TelnyxSecretPanel).
 *   3. Surfaces the full Telnyx provisioning + health surface (PhoneProvisioningPanel),
 *      so number assignment, agency settings, webhooks, and the live test all
 *      live behind one page.
 *
 * It's reachable only by admins at the router level; this component additionally
 * narrows access to the super admin and self-promotes the owner on first visit.
 */
export default function SuperAdminConfig() {
  const queryClient = useQueryClient();

  // Integration steps published by the progress card, and which stages are open.
  const [steps, setSteps] = useState([]);
  const [stepsMeta, setStepsMeta] = useState({ ready: false, secretStatus: null });
  const [expanded, setExpanded] = useState(null); // null = not yet auto-decided

  const handleStepsChange = useCallback((nextSteps, meta) => {
    setSteps(nextSteps);
    setStepsMeta({ ready: Boolean(meta?.ready), secretStatus: meta?.secretStatus ?? null });
  }, []);

  // Open the unfinished stages once — but only once the underlying queries have
  // SETTLED. The checklist is non-empty from the first render, derived from
  // still-loading data where every step looks unfinished; freezing on that would
  // open every stage on an already-configured install and never correct itself.
  // Still one-shot after that: re-deriving on every change would slam a stage
  // shut under the admin the moment their edit satisfied its last check.
  useEffect(() => {
    if (expanded === null && stepsMeta.ready && steps.length > 0) {
      setExpanded(defaultExpandedStageIds(steps, stepsMeta.secretStatus));
    }
  }, [steps, stepsMeta, expanded]);

  const openStages = expanded ?? SETUP_STAGES.map((s) => s.id);

  const toggleStage = useCallback((id) => {
    setExpanded((prev) => {
      const current = prev ?? SETUP_STAGES.map((s) => s.id);
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
  }, []);

  // A "Go" button in the checklist targets an anchor that may sit inside a
  // collapsed stage. Expand the owner first, then scroll on the next frame once
  // the panel is visible and has a layout position.
  const navigateToAnchor = useCallback((anchor) => {
    const stageId = stageIdForAnchor(anchor);
    if (stageId) {
      setExpanded((prev) => {
        const current = prev ?? SETUP_STAGES.map((s) => s.id);
        return current.includes(stageId) ? current : [...current, stageId];
      });
    }
    requestAnimationFrame(() => {
      const el = typeof document === "undefined" ? null : document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const { data: currentUser, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const ensure = useMutation({
    mutationFn: () => base44.functions.invoke("ensureSuperAdmin", {}),
    onSuccess: (res) => {
      const data = res?.data || res;
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      if (!data?.already_super_admin) toast.success("Super admin account confirmed");
    },
    onError: (err) => toast.error(err?.message || "Couldn't confirm the super admin account"),
  });

  // Self-bootstrap: the first time the owner lands here, claim/repair their
  // elevated account automatically (idempotent on the backend).
  const ownerNotYetPromoted =
    isSuperAdminEmail(currentUser?.email) && currentUser?.account_type !== "super_admin";
  // Latch on a ref and depend on the stable `mutate`, not the mutation object:
  // react-query returns a new object every render, so depending on `ensure` re-ran
  // this effect continuously — and after a failure isPending and isSuccess are
  // both false, so the guard let it fire again, looping mutate → error toast →
  // re-render → mutate. One attempt per page visit; the manual button retries.
  const { mutate: ensureSuperAdminAccount } = ensure;
  const bootstrapAttempted = useRef(false);
  useEffect(() => {
    if (ownerNotYetPromoted && !bootstrapAttempted.current) {
      bootstrapAttempted.current = true;
      ensureSuperAdminAccount();
    }
  }, [ownerNotYetPromoted, ensureSuperAdminAccount]);

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </PageContainer>
    );
  }

  // Only the super admin (or the designated owner email) may use this page.
  if (!isSuperAdmin(currentUser)) {
    return (
      <PageContainer>
        <AccessDeniedState
          title="Super administrator access required"
          description={`This page is restricted to the platform super administrator. If you believe you should have access, contact ${SUPER_ADMIN_EMAIL}.`}
        />
      </PageContainer>
    );
  }

  const isOwner = isSuperAdminEmail(currentUser?.email);

  return (
    <PageContainer>
      <PageHeader
        title="Super Admin"
        description="Platform-owner controls: Telnyx integration secret and phone provisioning, all in one place."
        icon={Crown}
      />

      <div className="space-y-6">
        {/* Super admin account status / self-heal */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-500" />
                Super Admin Account
              </span>
              <Badge className="bg-amber-100 text-amber-800">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                {currentUser?.account_type === "super_admin" ? "Active" : "Owner"}
              </Badge>
            </CardTitle>
            <CardDescription>
              The platform super admin is <strong>{SUPER_ADMIN_EMAIL}</strong>. This account has full administrative
              access across the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert className="bg-slate-50 border-slate-200">
              <ShieldCheck className="w-4 h-4 text-slate-600" />
              <AlertDescription className="text-slate-700 text-sm">
                Signed in as <strong>{currentUser?.email}</strong> · account type:{" "}
                <span className="font-mono">{currentUser?.account_type || "user"}</span> · role:{" "}
                <span className="font-mono">{currentUser?.role || "user"}</span>
              </AlertDescription>
            </Alert>
            {isOwner && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-500">
                  Re-run this if your account ever loses its elevated permissions.
                </p>
                <Button variant="outline" size="sm" onClick={() => ensure.mutate()} disabled={ensure.isPending}>
                  {ensure.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Confirm super admin
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live health board for every integration (AI, email, telephony, …) */}
        <IntegrationsHealthPanel />

        {/* Guided setup command center — progress + "what's next", links below */}
        <TelnyxSetupProgress onStepsChange={handleStepsChange} onNavigate={navigateToAnchor} />

        {/* The panels below are grouped into collapsible stages so a finished
            setup collapses to a short page instead of stacking every panel at
            full height. Status per stage is derived from the same steps the
            checklist above computes (see setupStages.js). */}
        {SETUP_STAGES.map((stage, i) => (
          <SetupStage
            key={stage.id}
            index={i + 1}
            title={stage.title}
            description={stage.description}
            status={stageStatus(stage, steps, stepsMeta.secretStatus)}
            expanded={openStages.includes(stage.id)}
            onToggle={() => toggleStage(stage.id)}
          >
            {stage.id === "connect" && (
              <div id="telnyx-secret" className="scroll-mt-24">
                <TelnyxSecretPanel />
              </div>
            )}
            {stage.id === "numbers" && <PhoneProvisioningPanel />}
            {stage.id === "compliance" && (
              <>
                <div id="a2p-compliance" className="scroll-mt-24">
                  <A2PCompliancePanel />
                </div>
                <div id="consent-ledger" className="scroll-mt-24">
                  <ConsentLedgerPanel />
                </div>
              </>
            )}
          </SetupStage>
        ))}
      </div>
    </PageContainer>
  );
}