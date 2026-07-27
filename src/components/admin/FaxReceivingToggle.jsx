import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";

export default function FaxReceivingToggle() {
  const queryClient = useQueryClient();

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['agency-settings'],
    queryFn: () => base44.entities.AgencySettings.list('-created_date', 1),
    initialData: []
  });

  const setting = settings[0];

  const updateMutation = useMutation({
    mutationFn: ({ settingId, enabled }) => {
      if (settingId) {
        return base44.entities.AgencySettings.update(settingId, {
          fax_receiving_enabled: enabled
        });
      }
      return base44.entities.AgencySettings.create({
        fax_receiving_enabled: enabled
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agency-settings'] });
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
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
          <div className="flex-1">
            <Label className="text-base font-semibold">
              {isEnabled ? "In-App Fax Receiving Active" : "In-App Fax Receiving Off"}
            </Label>
            <p className="text-sm text-slate-600 mt-1">
              {isEnabled
                ? "Incoming faxes on the outbound line are ingested into the app (OCR + referral matching)"
                : "The app doesn't handle incoming faxes — replies go straight to the office fax machine"}
            </p>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={updateMutation.isPending}
          />
        </div>

        {!isEnabled && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Off is the normal setting:</strong> outbound faxes are presented under the office
              fax number, so replies dial the office machine directly. Any stray fax dialed to the
              outbound line is passed straight through to the office fax. Scheduled and outbound faxes
              work normally.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}