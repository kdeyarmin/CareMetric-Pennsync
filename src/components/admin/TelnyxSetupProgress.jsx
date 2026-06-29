import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Circle, AlertTriangle, ArrowRight, Activity, Loader2, Rocket, ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { buildIntegrationSteps, summarizeSteps, summarize } from "@/components/admin/twilioSetup";

/**
 * TelnyxSetupProgress — the at-a-glance "command center" at the top of the
 * super admin page. It answers two questions the scattered cards below can't:
 * "how far along is the Telnyx setup?" and "what should I do next?".
 *
 * It is purely a roll-up + navigation layer: it reuses the SAME react-query keys
 * as the secret panel and the provisioning panel, so it updates automatically as
 * the admin saves credentials, edits settings, or provisions a nurse below — no
 * duplicated state. The readiness math lives in the unit-tested
 * `twilioSetup` helpers; this component only renders it and scrolls to the
 * relevant section when a step's "Go" button is clicked.
 */

const STEP_META = {
  done: { Icon: CheckCircle2, color: "text-green-600" },
  attention: { Icon: AlertTriangle, color: "text-amber-600" },
  todo: { Icon: Circle, color: "text-slate-300" },
};

const KIND_LABEL = { verify: "Recommended", manual: "Manual" };

function scrollToAnchor(anchor) {
  if (typeof document === "undefined" || !anchor) return;
  const el = document.getElementById(anchor);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function StepRow({ step }) {
  const meta = STEP_META[step.status] || STEP_META.todo;
  const { Icon } = meta;
  const kindLabel = KIND_LABEL[step.kind];
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-medium ${step.status === "done" ? "text-slate-500" : "text-slate-900"}`}>
            {step.title}
          </p>
          {kindLabel && (
            <span className="text-[10px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded px-1 py-0.5">
              {kindLabel}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600">{step.detail}</p>
      </div>
      {step.status !== "done" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-indigo-600 hover:text-indigo-700 flex-shrink-0"
          onClick={() => scrollToAnchor(step.anchor)}
        >
          Go <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      )}
    </div>
  );
}

export default function TelnyxSetupProgress() {
  // Shared query keys → this card and the panels below read/write one cache.
  const { data: secretStatus, isLoading: secretLoading } = useQuery({
    queryKey: ["telnyx-secret-status"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getTelnyxSecretStatus", {});
      return res?.data || res;
    },
    refetchOnWindowFocus: false,
  });

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["agency-settings"],
    queryFn: () => base44.entities.AgencySettings.list("-created_date", 1),
    refetchOnWindowFocus: false,
    initialData: [],
  });
  const settings = settingsArr[0];

  const { data: users = [] } = useQuery({
    queryKey: ["phone-users"],
    queryFn: () => base44.entities.User.list("full_name", 200),
    initialData: [],
  });

  const provisioning = useMemo(() => {
    const withWork = users.filter((u) => u.work_phone_number);
    const missingBridgeCell = withWork.filter((u) => !u.personal_cell_e164).length;
    return { total: users.length, withWorkNumber: withWork.length, missingBridgeCell };
  }, [users]);

  // The live test is run from here too, so the verify step can light up green
  // without leaving the command center.
  const [liveResult, setLiveResult] = useState(null);
  const testConnection = useMutation({
    mutationFn: () => base44.functions.invoke("testTelnyxConnection", {}),
    onSuccess: (res) => {
      const data = res?.data || res;
      setLiveResult(data);
      const sev = summarize(data?.checks || []).severity;
      if (sev === "fail") toast.error("Live test found problems — see the steps below.");
      else if (sev === "warn") toast("Live test passed with warnings.");
      else toast.success("Telnyx connection looks healthy.");
    },
    onError: (err) => toast.error(err?.message || "Live connection test failed"),
  });

  const steps = useMemo(
    () => buildIntegrationSteps({ secretStatus, agencySettings: settings, provisioning, liveResult }),
    [secretStatus, settings, provisioning, liveResult],
  );
  const progress = useMemo(() => summarizeSteps(steps), [steps]);

  return (
    <Card id="twilio-overview" className="scroll-mt-24 border-indigo-100">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-indigo-600" />
            Telnyx Integration Setup
          </span>
          {secretLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : progress.ready ? (
            <Badge className="bg-green-100 text-green-800">
              <Rocket className="w-3.5 h-3.5 mr-1" /> Ready to go live
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-800">
              {progress.requiredDone}/{progress.requiredTotal} required steps done
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          A guided checklist of everything needed to run patient texting and masked calling. Work top to
          bottom — each step jumps to the section that completes it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-600">Required setup</span>
            <span className="text-xs font-semibold text-slate-700">{progress.percent}%</span>
          </div>
          <Progress value={progress.percent} className="h-2" />
        </div>

        {/* The single most useful "do this next" callout. */}
        {progress.nextStep ? (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-indigo-100 bg-indigo-50 p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Next step</p>
              <p className="text-sm font-medium text-indigo-900">{progress.nextStep.title}</p>
              <p className="text-xs text-indigo-700">{progress.nextStep.detail}</p>
            </div>
            <Button
              type="button"
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
              onClick={() => scrollToAnchor(progress.nextStep.anchor)}
            >
              Take me there <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            Every step is complete — your Telnyx integration is fully set up and verified.
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {steps.map((step) => <StepRow key={step.id} step={step} />)}
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap border-t pt-3">
          <p className="text-xs text-slate-500">
            Run a read-only health check anytime — it never sends a text or places a call.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => testConnection.mutate()}
            disabled={testConnection.isPending}
          >
            {testConnection.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>
            ) : (
              <><Activity className="w-3.5 h-3.5 mr-1.5" /> Test live connection</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
