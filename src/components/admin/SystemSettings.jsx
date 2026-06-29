import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Settings, Info } from "lucide-react";
import AnnouncementManager from "@/components/admin/AnnouncementManager";
import AIConfigurationManager from "@/components/admin/AIConfigurationManager";
import PhoneProvisioningPanel from "@/components/admin/PhoneProvisioningPanel";
import PhoneAnalyticsPanel from "@/components/admin/PhoneAnalyticsPanel";
import FaxReceivingToggle from "@/components/admin/FaxReceivingToggle";

export default function SystemSettingsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            System Configuration
          </CardTitle>
          <CardDescription>
            Manage agency-wide settings, announcements, and AI configurations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="w-4 h-4" />
            <AlertDescription>
              System settings are configured through the Base44 dashboard. 
              Visit the dashboard to manage app secrets, integrations, and deployment settings.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <PhoneProvisioningPanel />
      <PhoneAnalyticsPanel />
      <FaxReceivingToggle />
      <AnnouncementManager />
      <AIConfigurationManager />
    </div>
  );
}