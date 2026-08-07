import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchCallerFaxRetryConfig } from "@/lib/agencySettings";

/**
 * FaxRetryConfigPanel — admin editor for the FaxRetryConfig entity that drives
 * outbound-fax auto-retry (used by autoRetryFailedFaxes, the status webhook,
 * pollFaxStatuses, and manual retryFailedFax). Writes the caller's agency row
 * (or the single legacy unscoped row) — never global newest across tenants.
 * Defaults mirror the entity schema and faxRetry.js: 3 retries, 15-minute base
 * delay, exponential backoff.
 */
const DEFAULTS = { max_retries: 3, retry_delay_minutes: 15, auto_retry_enabled: true, notify_on_final_failure: true };

export default function FaxRetryConfigPanel() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const agencyKey = currentUser?.agency_name || null;
  const { data: config = null, isLoading } = useQuery({
    queryKey: ["fax-retry-config", agencyKey],
    queryFn: () => fetchCallerFaxRetryConfig(agencyKey),
    enabled: !!currentUser,
    initialData: null,
  });

  const [form, setForm] = useState(DEFAULTS);
  // Seed the form from the saved row once it loads (or keep defaults when none).
  useEffect(() => {
    if (config) {
      setForm({
        max_retries: config.max_retries ?? DEFAULTS.max_retries,
        retry_delay_minutes: config.retry_delay_minutes ?? DEFAULTS.retry_delay_minutes,
        auto_retry_enabled: config.auto_retry_enabled !== false,
        notify_on_final_failure: config.notify_on_final_failure !== false,
      });
    } else {
      setForm(DEFAULTS);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: (payload) =>
      config?.id
        ? base44.entities.FaxRetryConfig.update(config.id, payload)
        : base44.entities.FaxRetryConfig.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fax-retry-config"] });
      toast.success("Fax retry settings saved");
    },
    onError: (err) => toast.error(err?.message || "Failed to save fax retry settings"),
  });

  const maxRetries = Number(form.max_retries);
  const delay = Number(form.retry_delay_minutes);
  const maxRetriesValid = Number.isInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 10;
  const delayValid = Number.isFinite(delay) && delay >= 1 && delay <= 360;
  const canSave = maxRetriesValid && delayValid && !save.isPending && !!currentUser;

  const handleSave = () => {
    const agency = String(currentUser?.agency_name || "").trim();
    save.mutate({
      max_retries: maxRetries,
      retry_delay_minutes: delay,
      auto_retry_enabled: form.auto_retry_enabled,
      notify_on_final_failure: form.notify_on_final_failure,
      is_active: true,
      ...(agency ? { agency_name: agency } : {}),
    });
  };

  if (isLoading || !currentUser) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-indigo-600" />
          Fax Auto-Retry
        </CardTitle>
        <CardDescription>
          How the app re-sends a fax that Telnyx reports as failed. Applies to automatic retries and the
          manual &ldquo;Retry&rdquo; button. Busy / no-answer failures are treated as temporary; hard rejections
          (bad number, blocked) are never retried.
          {agencyKey ? ` Scoped to ${agencyKey}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div className="flex-1 pr-4">
            <Label className="text-sm font-semibold">Automatic retry</Label>
            <p className="text-xs text-slate-600 mt-0.5">
              When off, a failed fax is left for a manual retry instead of being re-sent automatically.
            </p>
          </div>
          <Switch
            checked={form.auto_retry_enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, auto_retry_enabled: v }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-medium text-slate-600">Max retry attempts</Label>
            <Input
              type="number"
              min={0}
              max={10}
              value={form.max_retries}
              onChange={(e) => setForm((f) => ({ ...f, max_retries: e.target.value }))}
              className={`mt-1 ${maxRetriesValid ? "" : "border-red-400 focus-visible:ring-red-400"}`}
            />
            <p className="mt-1 text-[11px] text-slate-500">0&ndash;10. How many times to re-send before giving up.</p>
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-600">Base delay (minutes)</Label>
            <Input
              type="number"
              min={1}
              max={360}
              value={form.retry_delay_minutes}
              onChange={(e) => setForm((f) => ({ ...f, retry_delay_minutes: e.target.value }))}
              className={`mt-1 ${delayValid ? "" : "border-red-400 focus-visible:ring-red-400"}`}
            />
            <p className="mt-1 text-[11px] text-slate-500">1&ndash;360. Base wait before the first retry; later attempts back off.</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div className="flex-1 pr-4">
            <Label className="text-sm font-semibold">Notify on final failure</Label>
            <p className="text-xs text-slate-600 mt-0.5">
              Email the sender once retries are exhausted.
            </p>
          </div>
          <Switch
            checked={form.notify_on_final_failure}
            onCheckedChange={(v) => setForm((f) => ({ ...f, notify_on_final_failure: v }))}
          />
        </div>

        <Button onClick={handleSave} disabled={!canSave} className="w-full sm:w-auto">
          {save.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save retry settings
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
