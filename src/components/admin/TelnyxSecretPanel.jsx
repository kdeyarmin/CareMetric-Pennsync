import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, Save, Eye, EyeOff, Loader2, CheckCircle2, XCircle, ShieldCheck, Info } from "lucide-react";
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

  const configured = status?.configured;
  const sourceLabel =
    status?.source === "env" ? "Base44 dashboard env" : status?.source === "config" ? "in-app config" : null;

  // API key must start with "KEY" and be at least 16 chars.
  const keyTrimmed = apiKey.trim();
  const keyValid = keyTrimmed.toUpperCase().startsWith("KEY") && keyTrimmed.length >= 16;
  const canSave = keyValid;

  const handleSave = () => {
    const payload = { api_key: keyTrimmed };
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
              <div>
                <Label className="text-xs font-medium text-slate-600">Messaging profile id</Label>
                <Input
                  type="text"
                  placeholder="Optional — leave blank to keep the current setting"
                  value={messagingProfileId}
                  onChange={(e) => setMessagingProfileId(e.target.value)}
                  autoComplete="off"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600">Voice (Call Control) connection id</Label>
                <Input
                  type="text"
                  placeholder="Optional — leave blank to keep the current setting"
                  value={voiceConnectionId}
                  onChange={(e) => setVoiceConnectionId(e.target.value)}
                  autoComplete="off"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600">Fax connection id</Label>
                <Input
                  type="text"
                  placeholder="Optional — leave blank to keep the current setting"
                  value={faxConnectionId}
                  onChange={(e) => setFaxConnectionId(e.target.value)}
                  autoComplete="off"
                  className="mt-1"
                />
              </div>
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
