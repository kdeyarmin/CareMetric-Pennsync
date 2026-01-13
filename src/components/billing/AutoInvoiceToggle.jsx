import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Info, Zap } from "lucide-react";
import { toast } from "sonner";

export default function AutoInvoiceToggle() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: settings } = useQuery({
    queryKey: ["agencySettings"],
    queryFn: async () => {
      const result = await base44.entities.AgencySettings.list('created_date', 1);
      return result[0] || null;
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (autoInvoice) => {
      if (settings?.id) {
        return base44.entities.AgencySettings.update(settings.id, {
          auto_generate_invoices: autoInvoice
        });
      } else {
        return base44.entities.AgencySettings.create({
          auto_generate_invoices: autoInvoice
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agencySettings"] });
      toast.success("Auto-invoice settings updated");
    }
  });

  const handleToggle = (checked) => {
    updateSettingsMutation.mutate(checked);
  };

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="w-5 h-5 text-blue-600" />
          Automated Billing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="auto-invoice" className="text-base font-medium">
              Auto-Generate Invoices
            </Label>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Automatically create invoices when visits are completed
            </p>
          </div>
          <Switch
            id="auto-invoice"
            checked={settings?.auto_generate_invoices || false}
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg flex gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900 dark:text-blue-100">
            <p className="font-medium mb-1">How it works:</p>
            <ul className="space-y-1 text-blue-800 dark:text-blue-200">
              <li>• AI analyzes completed visits and suggests appropriate billing codes</li>
              <li>• Draft invoices are created automatically in your billing system</li>
              <li>• Review and approve before sending to patients</li>
              <li>• Saves time and ensures accurate coding</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}