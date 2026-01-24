import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Building2, Mail, Loader2, CheckCircle, Copy } from "lucide-react";

export default function EnterpriseSetupPanel({ agencySettings, onSetupComplete }) {
  const [managerEmail, setManagerEmail] = useState(agencySettings?.agency_manager_email || "");
  const [officeName, setOfficeName] = useState(agencySettings?.office_name || "");
  const [setting, setSetting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState(agencySettings?.agency_code || null);

  const handleSetup = async () => {
    if (!managerEmail || !officeName) {
      toast.error('Please fill in all fields');
      return;
    }

    setSetting(true);
    try {
      const { setupEnterpriseAgency } = await import('@/functions/setupEnterpriseAgency');
      const result = await setupEnterpriseAgency({
        agency_manager_email: managerEmail,
        office_name: officeName
      });

      setGeneratedCode(result.data.agency_code);
      toast.success('Enterprise setup complete! Email sent to manager.');
      
      if (onSetupComplete) {
        onSetupComplete(result.data);
      }
    } catch (error) {
      console.error('Error setting up enterprise:', error);
      toast.error('Failed to setup enterprise');
    } finally {
      setSetting(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    toast.success('Agency code copied to clipboard');
  };

  const isAlreadyEnterprise = agencySettings?.is_enterprise;

  return (
    <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-blue-600" />
          Enterprise Setup
        </CardTitle>
        <CardDescription>
          Configure your agency as an enterprise organization
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAlreadyEnterprise ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="office-name">Agency Name</Label>
              <Input
                id="office-name"
                value={officeName}
                onChange={(e) => setOfficeName(e.target.value)}
                placeholder="e.g., ABC Home Health"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manager-email">Agency Manager Email</Label>
              <Input
                id="manager-email"
                type="email"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                placeholder="manager@agency.com"
              />
              <p className="text-xs text-slate-500">
                We'll send the agency code to this email
              </p>
            </div>

            <Button 
              onClick={handleSetup} 
              disabled={setting}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {setting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Setting Up...
                </>
              ) : (
                <>
                  <Building2 className="w-4 h-4 mr-2" />
                  Setup Enterprise
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900 dark:text-green-100">
                Enterprise features are active for <strong>{agencySettings.office_name}</strong>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Agency Code</Label>
              <div className="flex gap-2">
                <Input
                  value={generatedCode || agencySettings.agency_code}
                  readOnly
                  className="font-mono text-lg font-bold"
                />
                <Button 
                  onClick={copyCode}
                  variant="outline"
                  size="icon"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Share this code with providers to link them to your agency
              </p>
            </div>

            <div className="space-y-2">
              <Label>Manager Email</Label>
              <Input
                value={agencySettings.agency_manager_email}
                readOnly
                className="bg-slate-100 dark:bg-slate-800"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}