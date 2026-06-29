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

  const isEnabled = setting?.fax_receiving_enabled ?? true;

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
              {isEnabled ? "Fax Receiving Active" : "Fax Receiving Disabled"}
            </Label>
            <p className="text-sm text-slate-600 mt-1">
              {isEnabled 
                ? "Your agency is currently accepting incoming faxes" 
                : "Incoming faxes will be rejected until re-enabled"}
            </p>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={updateMutation.isPending}
          />
        </div>

        {!isEnabled && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>Note:</strong> While disabled, incoming faxes will not be processed. 
              Existing scheduled and outbound faxes will continue to work normally.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}