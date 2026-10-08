import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Building2, Save, CheckCircle2, AlertCircle, Settings } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CustomValidationRuleManager from "../components/validation/CustomValidationRuleManager";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import AdminOnboardingChecklistStrip from "@/components/admin/AdminOnboardingChecklistStrip";

export default function AgencySettings() {
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch existing settings for THIS agency (never global newest-row).
  const { data: settings, isLoading } = useQuery({
    queryKey: ['agencySettings', currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerAgencySettings } = await import('@/lib/agencySettings');
      return fetchCallerAgencySettings(currentUser?.agency_name);
    },
    enabled: !!currentUser,
  });

  // Form state. Only the office profile is edited here: the PDGM wage-index
  // and cost-analysis (ROI) inputs were removed with the PDGM payment
  // features. A save sends only these fields, so any legacy values already on
  // the row are left untouched rather than overwritten.
  const [formData, setFormData] = useState({
    office_name: '',
    office_address: '',
    office_zip_code: '',
  });

  // Update form when settings load
  useEffect(() => {
    if (settings) {
      setFormData({
        office_name: settings.office_name || '',
        office_address: settings.office_address || '',
        office_zip_code: settings.office_zip_code || '',
      });
    }
  }, [settings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const agencyKey = String(currentUser?.agency_name || '').trim();
      const payload = {
        ...data,
        ...(agencyKey ? { agency_code: agencyKey, office_name: data.office_name || agencyKey } : {}),
      };
      if (settings?.id) {
        return await base44.entities.AgencySettings.update(settings.id, payload);
      }
      return await base44.entities.AgencySettings.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencySettings'] });
      setSuccessMessage('Agency settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate({
      office_name: formData.office_name,
      office_address: formData.office_address,
      office_zip_code: String(formData.office_zip_code || '').trim(),
    });
  };

  if (isLoading) {
    return (
      <LoadingState className="py-24" />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Settings}
        eyebrow="Configuration"
        title="Agency Settings"
        description="Configure agency-wide settings and validation rules"
        favoritePage="AgencySettings"
      />

        <AdminOnboardingChecklistStrip />

        {successMessage && (
          <Alert className="bg-emerald-50 border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <AlertDescription className="text-emerald-800">{successMessage}</AlertDescription>
          </Alert>
        )}

        {saveMutation.isError && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              Failed to save settings. Please try again.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="general" className="space-y-4 sm:space-y-6">
          <TabsList className="grid w-full grid-cols-2 h-auto">
            <TabsTrigger value="general" className="py-2 sm:py-3 text-xs sm:text-sm">General Settings</TabsTrigger>
            <TabsTrigger value="validation" className="py-2 sm:py-3 text-xs sm:text-sm">Validation Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <form onSubmit={handleSubmit} className="space-y-6">
          {/* Office Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                Office Information
              </CardTitle>
              <CardDescription>Basic information about your agency location</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="office_name">Office Name</Label>
                <Input
                  id="office_name"
                  type="text"
                  placeholder="e.g., Main Office"
                  value={formData.office_name}
                  onChange={(e) => handleChange('office_name', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="office_address">Office Address</Label>
                <Input
                  id="office_address"
                  type="text"
                  placeholder="e.g., 123 Main St, City, State"
                  value={formData.office_address}
                  onChange={(e) => handleChange('office_address', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="office_zip_code">Office ZIP Code</Label>
                <Input
                  id="office_zip_code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="e.g., 19104"
                  value={formData.office_zip_code}
                  onChange={(e) => handleChange('office_zip_code', e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  The ZIP code of your main office location. Required to complete the agency profile.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button 
              type="submit" 
              disabled={saveMutation.isPending}
              className="gap-2 min-h-[44px] w-full sm:w-auto"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                <><Save className="w-4 h-4" /> Save Settings</>
              )}
            </Button>
          </div>
        </form>
          </TabsContent>

          <TabsContent value="validation">
            <CustomValidationRuleManager />
          </TabsContent>
        </Tabs>
    </PageContainer>
  );
}