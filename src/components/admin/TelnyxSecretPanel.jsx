import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound, Save, Eye, EyeOff, Loader2, CheckCircle2, XCircle, ShieldCheck, Info, Wand2, MapPin, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * Plain-language guide for every Telnyx credential this app needs: EXACTLY what
 * each value is called in the Telnyx portal and where to find it, so a super
 * admin can locate and paste each one without guessing. Rendered inline under
 * each field by <FieldHelp>. (Telnyx occasionally renames portal sections; the
 * `also` line lists older names so the guidance still lands.)
 */
export const TELNYX_GUIDE = {
  api_key: {
    telnyxName: "API Key (V2 / Mission Control key)",
    location: "Telnyx Portal → Account → Keys & Credentials → API Keys tab → Create API Key (or copy an existing one)",
    also: "Older portals: Auth → Auth V2 → API Keys.",
    powers: "Authenticates every SMS, voice, fax and webhook call.",
    format: "Starts with KEY, at least 16 characters.",
  },
  public_key: {
    telnyxName: "Public Key (webhook signing key — Ed25519)",
    location: "Telnyx Portal → Account → Keys & Credentials → API Keys tab → the \u201CPublic Key\u201D shown near the top of that page",
    also: "It is your account-wide key Telnyx uses to sign webhooks — not the API key.",
    powers: "Verifies the signature on inbound Telnyx webhooks (delivery status, inbound texts, call and fax events).",
    format: "A base64 string. It does NOT start with KEY.",
    critical: "Required: without it every inbound webhook is rejected, so delivery statuses, inbound texts and inbound calls stop working.",
  },
  messaging_profile_id: {
    telnyxName: "Messaging Profile — its ID",
    location: "Telnyx Portal → Messaging → Messaging Profiles → open your profile → copy the ID shown beside its name",
    powers: "Routes outbound SMS/MMS and STOP/START opt-out handling; attached to each number when you buy it.",
    format: "A UUID (e.g. 40017… -…-…).",
    capability: "Texting",
  },
  voice_connection_id: {
    telnyxName: "Call Control Application — its App ID (a.k.a. Connection ID)",
    location: "Telnyx Portal → Voice → Programmable Voice → Applications → open your Call Control app → copy the App ID",
    also: "In the Voice API Applications list this is the \u201CCall Control\u201D type; the App ID is the connection id.",
    powers: "Inbound patient calls and masked click-to-call (the nurse-to-patient bridge).",
    format: "A long numeric id.",
    capability: "Voice",
  },
  fax_connection_id: {
    telnyxName: "Programmable Fax Application — its App ID (a.k.a. Connection ID)",
    location: "Telnyx Portal → Fax → Programmable Fax → Fax Applications → open your app → copy the App ID",
    powers: "Sending and receiving faxes, and buying/provisioning your outbound fax line.",
    format: "A long numeric id.",
    capability: "Fax",
  },
};

/** Inline "what is this / where do I find it in Telnyx" help block. */
function FieldHelp({ guide }) {
  if (!guide) return null;
  return (
    <div className="mt-1.5 rounded-md bg-slate-50 border border-slate-200 p-2 space-y-1 text-[11px] leading-relaxed text-slate-600">
      <p><span className="font-semibold text-slate-700">In Telnyx:</span> {guide.telnyxName}</p>
      <p className="flex items-start gap-1">
        <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-indigo-500" />
        <span><span className="font-semibold text-slate-700">Find it:</span> {guide.location}</span>
      </p>
      {guide.also && <p className="text-slate-500">{guide.also}</p>}
      {guide.powers && <p><span className="font-semibold text-slate-700">Powers:</span> {guide.powers}</p>}
      {guide.format && <p><span className="font-semibold text-slate-700">Looks like:</span> {guide.format}</p>}
      {guide.critical && (
        <p className="flex items-start gap-1 text-amber-700">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>{guide.critical}</span>
        </p>
      )}
    </div>
  );
}

/** Small "Set / Not set" badge driven by the getTelnyxSecretStatus flags. */
function SetBadge({ set }) {
  return set ? (
    <Badge className="bg-green-100 text-green-800 text-[10px]">
      <CheckCircle2 className="w-3 h-3 mr-1" /> Set
    </Badge>
  ) : (
    <Badge variant="outline" className="text-slate-500 text-[10px]">Not set</Badge>
  );
}

/**
 * TelnyxSecretPanel — the heart of the super admin config page. It walks the
 * super admin through EVERY Telnyx value the app needs — the API key, the
 * webhook public key, and the messaging / voice / fax connection ids — each with
 * plain-language help naming exactly what it is called in the Telnyx portal and
 * where to find it (see TELNYX_GUIDE). Values save backend-only (via
 * saveTelnyxSecret) so SMS, voice, fax and webhook verification all work without
 * anyone touching the Base44 dashboard. The raw API key is never read back — the
 * panel only shows whether each value is set (and the key's last 4 characters).
 */
export default function TelnyxSecretPanel() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [messagingProfileId, setMessagingProfileId] = useState("");
  const [voiceConnectionId, setVoiceConnectionId] = useState("");
  const [faxConnectionId, setFaxConnectionId] = useState("");
  // Resource lists fetched from the admin's own Telnyx account, so the three
  // connection ids become a pick-from-a-list instead of a copy-paste from the
  // Telnyx portal. Null until discovery has run.
  const [discovered, setDiscovered] = useState(null);
  // Per-field override of picker-vs-text-input, keyed by field. Undefined means
  // "decide automatically"; an explicit true/false is the admin's own choice and
  // always wins. See renderResourceField for why the escape hatch has to exist.
  const [manualEntry, setManualEntry] = useState({});

  const { data: status, isLoading } = useQuery({
    queryKey: ["telnyx-secret-status"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getTelnyxSecretStatus", {});
      return res?.data || res;
    },
    refetchOnWindowFocus: false,
  });

  const save = useMutation({
    mutationFn: (payload) => base44.functions.invoke("saveTelnyxSecret", payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["telnyx-secret-status"] });
      setApiKey("");
      setPublicKey("");
      setMessagingProfileId("");
      setVoiceConnectionId("");
      setFaxConnectionId("");
      // A payload without an api_key is an advanced-fields-only update.
      toast.success(variables?.api_key ? "Telnyx API key saved" : "Telnyx settings updated");
    },
    // Surface the backend's own reason. err.message from the SDK's axios client is
    // "Request failed with status code 4xx", which rendered every actionable
    // rejection — invalid key format, "Set your Telnyx API key first.", the
    // super-admin-only 403 — as an opaque status code, so a save that failed for a
    // fixable reason looked like an unexplained one.
    onError: (err) =>
      toast.error(
        err?.response?.data?.error || err?.data?.error || err?.message || "Failed to save the Telnyx API key",
      ),
  });

  const discover = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke("discoverTelnyxResources", {});
      return res?.data || res;
    },
    onSuccess: (data) => {
      const resources = data?.resources || {};
      setDiscovered(resources);
      setShowAdvanced(true);
      // Re-running discovery is an explicit "look again", so let each field
      // re-decide picker-vs-manual from the new result. Otherwise a truncated or
      // failed first run would pin fields to manual entry forever, even once a
      // later run returns the complete list.
      setManualEntry({});

      // Auto-select the obvious case: exactly one of a resource type and nothing
      // configured yet. With several, the admin picks — we never silently
      // overwrite a value they already chose.
      const autoFill = (resource, current, configuredId, setter) => {
        const items = resource?.items || [];
        if (items.length === 1 && !current && !configuredId) setter(items[0].id);
      };
      const current = data?.current || {};
      autoFill(resources.messaging_profiles, messagingProfileId, current.messaging_profile_id, setMessagingProfileId);
      autoFill(resources.voice_connections, voiceConnectionId, current.voice_connection_id, setVoiceConnectionId);
      autoFill(resources.fax_connections, faxConnectionId, current.fax_connection_id, setFaxConnectionId);

      const failed = Object.values(resources).filter((r) => r?.status === "fail");
      if (failed.length) {
        toast.warning(`Found what we could — ${failed[0].detail}`);
      } else {
        const total = Object.values(resources).reduce((n, r) => n + (r?.items?.length || 0), 0);
        toast.success(total ? `Found ${total} Telnyx resource${total === 1 ? "" : "s"}` : "No resources found in this Telnyx account");
      }
    },
    onError: (err) => toast.error(err?.message || "Could not reach Telnyx to discover resources"),
  });

  /**
   * A discovered resource renders as a picker; anything else (not yet
   * discovered, or the lookup failed) keeps the original free-text input.
   *
   * The picker must never be the ONLY way to set a value. A list can be
   * incomplete — discovery pages to a bound and reports `truncated`, an API key
   * can be scoped to a subset of the account, and a value configured earlier (or
   * from another account) may simply not appear. Swapping the input for a picker
   * in those cases would leave the id neither selectable NOR enterable, which is
   * strictly worse than the copy-paste field this was meant to replace. So:
   * every picker carries a manual-entry toggle, and a value that isn't in the
   * list opens in manual mode by default so the admin can see it at all.
   */
  const renderResourceField = (fieldKey, label, resource, value, setValue, placeholder, { configuredFlag } = {}) => {
    const items = resource?.status === "ok" ? resource.items : null;
    const unlisted = Boolean(value) && Boolean(items) && !items.some((i) => i.id === value);
    const manual = manualEntry[fieldKey] ?? (unlisted || Boolean(resource?.truncated));
    const showPicker = Boolean(items?.length) && !manual;
    const setManual = (next) => setManualEntry((prev) => ({ ...prev, [fieldKey]: next }));
    const guide = TELNYX_GUIDE[fieldKey];

    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
            {label}
            {guide?.capability && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                Needed for {guide.capability}
              </span>
            )}
          </Label>
          {configuredFlag !== undefined && <SetBadge set={configuredFlag} />}
        </div>
        {showPicker ? (
          <Select value={value || undefined} onValueChange={setValue}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Leave unchanged, or pick one" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} — {item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            className="mt-1"
          />
        )}
        {resource?.truncated && (
          <p className="mt-1 text-xs text-amber-700">
            {resource.detail} This Telnyx account has more than the lookup returns.
          </p>
        )}
        {unlisted && (
          <p className="mt-1 text-xs text-slate-500">
            The id currently entered isn&apos;t in the discovered list — keeping it as typed.
          </p>
        )}
        {resource?.status === "fail" && (
          <p className="mt-1 text-xs text-amber-700">{resource.detail} Enter the id manually.</p>
        )}
        {resource?.status === "ok" && !items?.length && (
          <p className="mt-1 text-xs text-slate-500">None found in this Telnyx account.</p>
        )}
        {Boolean(items?.length) && (
          <button
            type="button"
            className="mt-1 text-xs text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
            onClick={() => setManual(!manual)}
          >
            {manual ? "Choose from the discovered list" : "Enter an id manually instead"}
          </button>
        )}
        <FieldHelp guide={guide} />
      </div>
    );
  };

  const configured = status?.configured;
  const sourceLabel = status?.source === "config" ? "in-app config" : null;

  // Which of the connection/webhook values are still missing once a key exists.
  const missingConnections =
    Boolean(configured) &&
    !(status?.public_key_configured &&
      status?.messaging_profile_configured &&
      status?.voice_connection_configured &&
      status?.fax_connection_configured);

  // Auto-open the connections section when there's work left to do, unless the
  // admin has explicitly toggled it themselves (their choice always wins).
  const advancedTouched = useRef(false);
  useEffect(() => {
    if (!advancedTouched.current && missingConnections) setShowAdvanced(true);
  }, [missingConnections]);
  const toggleAdvanced = () => {
    advancedTouched.current = true;
    setShowAdvanced((v) => !v);
  };

  // API key must start with "KEY" and be at least 16 chars.
  const keyTrimmed = apiKey.trim();
  const keyValid = keyTrimmed.toUpperCase().startsWith("KEY") && keyTrimmed.length >= 16;
  // Whether the admin typed any advanced value — deliberately NOT gated on
  // showAdvanced. That flag is a disclosure toggle, not a data-scoping decision:
  // typing connection ids and then collapsing the section used to discard them
  // while the toast still said "Telnyx settings updated", so the API key landed
  // and fax_connection_id did not — and outbound fax then failed with "Telnyx fax
  // credentials not configured", which is exactly the symptom that got blamed on
  // the missing TELNYX_* env path.
  const advancedProvided =
    Boolean(publicKey.trim() || messagingProfileId.trim() || voiceConnectionId.trim() || faxConnectionId.trim());
  // Allow saving either a valid key, or an advanced-fields-only update when the
  // key field is left blank (the key is already configured and never shown again).
  // A non-empty but invalid key still blocks save so a mistyped key isn't dropped.
  const canSave = keyValid || (keyTrimmed === "" && advancedProvided);

  const handleSave = () => {
    const payload = {};
    // Include the API key only when it's valid; a blank key means "keep the
    // existing one" and the backend does an advanced-fields-only update.
    if (keyValid) payload.api_key = keyTrimmed;
    {
      // Send every advanced field the admin actually typed, whether or not the
      // section happens to be expanded right now (see advancedProvided above).
      // An omitted field is left unchanged on the backend (an explicit "" would
      // clear it).
      if (publicKey.trim()) payload.public_key = publicKey.trim();
      if (messagingProfileId.trim()) payload.messaging_profile_id = messagingProfileId.trim();
      if (voiceConnectionId.trim()) payload.voice_connection_id = voiceConnectionId.trim();
      if (faxConnectionId.trim()) payload.fax_connection_id = faxConnectionId.trim();
    }
    save.mutate(payload);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-600" />
            Telnyx Credentials
          </span>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : configured ? (
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Configured{status?.api_key_last_four ? ` ••••${status.api_key_last_four}` : ""}
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-800">
              <XCircle className="w-3.5 h-3.5 mr-1" /> Not configured
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Your Telnyx API key powers SMS, voice, fax, and inbound webhook verification.
          It's stored securely on the backend and is never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configured && (
          <Alert className="bg-green-50 border-green-200">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 text-sm">
              Telnyx API key is active (source: {sourceLabel}).
              {status?.updated_by_email ? ` Last set by ${status.updated_by_email}` : ""}
              {status?.updated_at
                ? `${status?.updated_by_email ? " on" : " Last set"} ${new Date(status.updated_at).toLocaleDateString()}.`
                : status?.updated_by_email
                  ? "."
                  : ""}{" "}
              Enter a new key below to rotate it.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <Label className="text-sm font-medium">API key</Label>
          <div className="flex gap-2 mt-1">
            <div className="relative flex-1">
              <Input
                type={revealKey ? "text" : "password"}
                placeholder={configured ? "Enter a new API key to rotate…" : "KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                aria-label={revealKey ? "Hide API key" : "Show API key"}
                aria-pressed={revealKey}
              >
                {revealKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button
              onClick={handleSave}
              disabled={save.isPending || !canSave}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save
            </Button>
          </div>
          <FieldHelp guide={TELNYX_GUIDE.api_key} />
        </div>

        <div className="border-t pt-3">
          <button
            type="button"
            onClick={toggleAdvanced}
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-slate-700 hover:text-indigo-700"
          >
            <span>Webhook key &amp; channel connections {missingConnections ? "— needed for voice, fax &amp; inbound" : ""}</span>
            <span className="text-indigo-600">{showAdvanced ? "Hide" : "Show"}</span>
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                These tell the app which Telnyx resources to use. Each value below names exactly what it is
                called in the Telnyx portal and where to find it. Anything you leave blank keeps its current
                setting when you save.
              </p>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    Webhook public key (Ed25519)
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Required for inbound</span>
                  </Label>
                  {status && <SetBadge set={status?.public_key_configured} />}
                </div>
                <Input
                  type="text"
                  placeholder="Base64 Ed25519 public key — leave blank to keep the current setting"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  autoComplete="off"
                  className="mt-1"
                />
                <FieldHelp guide={TELNYX_GUIDE.public_key} />
              </div>
              {/* One click replaces three copy-pastes from the Telnyx portal.
                  Only offered once a key is stored — discovery authenticates
                  with the saved key, which the browser never sees. */}
              {configured && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-indigo-100 bg-indigo-50/60 p-2.5">
                  <p className="text-xs text-slate-600">
                    Look these up from your Telnyx account instead of pasting them.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => discover.mutate()}
                    disabled={discover.isPending}
                  >
                    {discover.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {discovered ? "Refresh" : "Find my resources"}
                  </Button>
                </div>
              )}
              {renderResourceField(
                "messaging_profile_id",
                "Messaging profile ID",
                discovered?.messaging_profiles,
                messagingProfileId,
                setMessagingProfileId,
                "Leave blank to keep the current setting",
                { configuredFlag: status?.messaging_profile_configured },
              )}
              {renderResourceField(
                "voice_connection_id",
                "Voice (Call Control) connection ID",
                discovered?.voice_connections,
                voiceConnectionId,
                setVoiceConnectionId,
                "Leave blank to keep the current setting",
                { configuredFlag: status?.voice_connection_configured },
              )}
              {renderResourceField(
                "fax_connection_id",
                "Fax connection ID",
                discovered?.fax_connections,
                faxConnectionId,
                setFaxConnectionId,
                "Leave blank to keep the current setting",
                { configuredFlag: status?.fax_connection_configured },
              )}
              <p className="text-xs text-slate-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Tip: once your API key is saved, use <span className="font-medium">Find my resources</span> above to
                pull these ids straight from your Telnyx account instead of copy-pasting them.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
