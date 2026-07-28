import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound, Save, Eye, EyeOff, Loader2, CheckCircle2, XCircle, ShieldCheck, Info, Wand2 } from "lucide-react";
import { toast } from "sonner";

/**
 * TelnyxSecretPanel — the heart of the super admin config page: a required
 * Telnyx API key (password with reveal toggle) plus an optional "Advanced"
 * section for the webhook public key and the messaging / voice / fax connection
 * ids. Saving them stores the credentials backend-only (via saveTelnyxSecret)
 * so SMS, voice, fax, and webhook verification all work without anyone touching
 * the Base44 dashboard. The raw API key is never read back — the panel only ever
 * shows whether it's set and the last 4 characters.
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
    onError: (err) => toast.error(err?.message || "Failed to save the Telnyx API key"),
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
   * discovered, or the lookup failed) keeps the original free-text input, so the
   * manual path never disappears.
   */
  const renderResourceField = (label, resource, value, setValue, placeholder) => {
    const items = resource?.status === "ok" ? resource.items : null;
    return (
      <div>
        <Label className="text-xs font-medium text-slate-600">{label}</Label>
        {items?.length ? (
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
        {resource?.status === "fail" && (
          <p className="mt-1 text-xs text-amber-700">{resource.detail} Enter the id manually.</p>
        )}
        {resource?.status === "ok" && !items?.length && (
          <p className="mt-1 text-xs text-slate-500">None found in this Telnyx account.</p>
        )}
      </div>
    );
  };

  const configured = status?.configured;
  const sourceLabel = status?.source === "config" ? "in-app config" : null;

  // API key must start with "KEY" and be at least 16 chars.
  const keyTrimmed = apiKey.trim();
  const keyValid = keyTrimmed.toUpperCase().startsWith("KEY") && keyTrimmed.length >= 16;
  const advancedProvided =
    showAdvanced &&
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
    if (showAdvanced) {
      // Only include advanced fields the admin actually typed — an omitted field
      // is left unchanged on the backend (an explicit "" would clear it).
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
          <p className="text-xs text-slate-500 mt-1">
            Starts with <code className="bg-slate-100 px-1 rounded">KEY</code>. Min 16 characters. Create one
            in your Telnyx Portal → Auth → API Keys. Used to authenticate every SMS, voice, fax, and webhook call.
          </p>
        </div>

        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            {showAdvanced ? "Hide" : "Advanced:"} webhook public key & connection ids (optional)
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-3">
              <div>
                <Label className="text-xs font-medium text-slate-600">Webhook public key (Ed25519)</Label>
                <Input
                  type="text"
                  placeholder="Base64 Ed25519 public key — leave blank to keep the current setting"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  autoComplete="off"
                  className="mt-1"
                />
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
                "Messaging profile id",
                discovered?.messaging_profiles,
                messagingProfileId,
                setMessagingProfileId,
                "Optional — leave blank to keep the current setting",
              )}
              {renderResourceField(
                "Voice (Call Control) connection id",
                discovered?.voice_connections,
                voiceConnectionId,
                setVoiceConnectionId,
                "Optional — leave blank to keep the current setting",
              )}
              {renderResourceField(
                "Fax connection id",
                discovered?.fax_connections,
                faxConnectionId,
                setFaxConnectionId,
                "Optional — leave blank to keep the current setting",
              )}
              <p className="text-xs text-slate-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                The webhook public key lets the app verify inbound Telnyx webhook signatures. The
                messaging / voice / fax connection ids route each channel. Any field you leave blank is
                left unchanged when you save.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
