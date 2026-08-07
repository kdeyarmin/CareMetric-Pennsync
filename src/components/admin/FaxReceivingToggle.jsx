import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";

export default function FaxReceivingToggle() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: setting = null, isLoading } = useQuery({
    queryKey: ['agencySettings', currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerAgencySettings } = await import("@/lib/agencySettings");
      return fetchCallerAgencySettings(currentUser?.agency_name);
    },
    enabled: !!currentUser,
  });

  const updateMutation = useMutation({
    mutationFn: ({ settingId, enabled }) => {
      const agencyKey = String(currentUser?.agency_name || "").trim();
      const payload = {
        fax_receiving_enabled: enabled,
        ...(agencyKey ? { agency_code: agencyKey, office_name: agencyKey } : {}),
      };
      if (settingId) {
        return base44.entities.AgencySettings.update(settingId, payload);
      }
      return base44.entities.AgencySettings.create(payload);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agencySettings'] });
      toast.success(
        variables.enabled 
          ? "Fax receiving enabled" 
          : "Fax receiving disabled"
      );
    },
    onError: () => {
      toast.error("Failed to update fax receiving setting");
    }
  });

  const handleToggle = (checked) => {
    updateMutation.mutate({
      settingId: setting?.id,
      enabled: checked
    });
  };

  // The inbound-fax webhook treats an unset flag (or a missing AgencySettings row)
  // as DISABLED and drops the fax, so the toggle must reflect that — defaulting to
  // "Active" here made the card claim faxing was on while faxes were being dropped.
  const isEnabled = !!setting?.fax_receiving_enabled;

  if (isLoading) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isEnabled ? (
            <Phone className="w-5 h-5 text-green-600" />
          ) : (
            <PhoneOff className="w-5 h-5 text-red-600" />
          )}
          Fax Receiving Control
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-lg">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-base font-semibold">
                Receive incoming faxes inside the app
              </Label>
              <span
                className={
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold " +
                  (isEnabled
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-200 text-slate-700")
                }
              >
                {isEnabled ? "ON" : "OFF (recommended)"}
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              {isEnabled
                ? "Turned ON: incoming faxes are pulled into the app, scanned (OCR), and matched to referrals automatically."
                : "Turned OFF: incoming faxes are NOT handled by the app. They go straight to your physical office fax machine, just like before."}
            </p>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={updateMutation.isPending}
          />
        </div>

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Not sure? Leave this OFF.</strong> Off is the normal setting for most agencies:
            incoming faxes and replies go to your office fax machine as usual, and sending faxes
            (including scheduled faxes) keeps working exactly the same. Only turn it ON if you want
            the app to capture and read incoming faxes for you.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
