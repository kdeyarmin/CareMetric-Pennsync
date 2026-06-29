import { useEffect } from "react";
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
import TelnyxSecretPanel from "@/components/admin/TelnyxSecretPanel";
import TelnyxSetupProgress from "@/components/admin/TelnyxSetupProgress";
import PhoneProvisioningPanel from "@/components/admin/PhoneProvisioningPanel";
import A2PCompliancePanel from "@/components/admin/A2PCompliancePanel";
import ConsentLedgerPanel from "@/components/admin/ConsentLedgerPanel";
import { isSuperAdmin, isSuperAdminEmail, SUPER_ADMIN_EMAIL } from "@/lib/superAdmin";

/**
 * SuperAdminConfig — the single, easy-to-use control panel for the platform
 * super admin (kdeyarmin@comcast.net). It does three things:
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
  useEffect(() => {
    if (ownerNotYetPromoted && !ensure.isPending && !ensure.isSuccess) {
      ensure.mutate();
    }
  }, [ownerNotYetPromoted, ensure]);

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
        <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
          <ShieldCheck className="w-10 h-10 text-slate-300 mb-3" />
          <h1 className="text-2xl font-bold text-slate-900">Super administrator access required</h1>
          <p className="mt-2 max-w-md text-slate-600">
            This page is restricted to the platform super administrator. If you believe you should have access,
            contact {SUPER_ADMIN_EMAIL}.
          </p>
        </div>
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

        {/* Guided setup command center — progress + "what's next", links below */}
        <TelnyxSetupProgress />

        {/* Telnyx API key */}
        <div id="telnyx-secret" className="scroll-mt-24">
          <TelnyxSecretPanel />
        </div>

        {/* Telnyx provisioning + health + agency settings */}
        <PhoneProvisioningPanel />

        {/* A2P 10DLC registration status + SMS consent ledger (compliance) */}
        <div id="a2p-compliance" className="scroll-mt-24">
          <A2PCompliancePanel />
        </div>
        <div id="consent-ledger" className="scroll-mt-24">
          <ConsentLedgerPanel />
        </div>
      </div>
    </PageContainer>
  );
}
