import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Building2, DollarSign, MapPin, Save, CheckCircle2, AlertCircle, Settings } from "lucide-react";
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

  // Form state
  const [formData, setFormData] = useState({
    office_name: '',
    office_address: '',
    office_zip_code: '',
    wage_index: 1.0,
    avg_staff_hourly_rate: 45,
    training_cost_per_hour: 35,
    documentation_time_per_episode: 0.5,
    audit_staff_hourly_rate: 50,
    avg_episodes_per_year: 50
  });

  // Update form when settings load
  useEffect(() => {
    if (settings) {
      setFormData({
        office_name: settings.office_name || '',
        office_address: settings.office_address || '',
        office_zip_code: settings.office_zip_code || '',
        wage_index: settings.wage_index || 1.0,
        avg_staff_hourly_rate: settings.avg_staff_hourly_rate || 45,
        training_cost_per_hour: settings.training_cost_per_hour || 35,
        documentation_time_per_episode: settings.documentation_time_per_episode || 0.5,
        audit_staff_hourly_rate: settings.audit_staff_hourly_rate || 50,
        avg_episodes_per_year: settings.avg_episodes_per_year || 50
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
    // Numeric fields are stored as raw strings while editing so that 0 and
    // partial decimals (e.g. a sub-1.0 wage index typed as "0.85") are not
    // clobbered per keystroke. Coerce and apply defaults only at save time.
    const toNum = (v, def) => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? def : n;
    };
    saveMutation.mutate({
      ...formData,
      wage_index: toNum(formData.wage_index, 1.0),
      avg_staff_hourly_rate: toNum(formData.avg_staff_hourly_rate, 45),
      training_cost_per_hour: toNum(formData.training_cost_per_hour, 35),
      documentation_time_per_episode: toNum(formData.documentation_time_per_episode, 0.5),
      audit_staff_hourly_rate: toNum(formData.audit_staff_hourly_rate, 50),
      avg_episodes_per_year: toNum(formData.avg_episodes_per_year, 50),
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
        description="Configure agency-wide settings, validation rules, and cost analysis"
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
            </CardContent>
          </Card>

          {/* PDGM Location Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600" />
                PDGM Location Settings
              </CardTitle>
              <CardDescription>
                These settings affect PDGM revenue calculations for all patients
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="office_zip_code">Office ZIP Code</Label>
                <Input
                  id="office_zip_code"
                  type="text"
                  placeholder="e.g., 19104"
                  value={formData.office_zip_code}
                  onChange={(e) => handleChange('office_zip_code', e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Used to determine the wage index for your geographic area
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wage_index">
                  CMS Wage Index
                  <span className="text-xs text-slate-500 ml-2">(Default: 1.0 = National Average)</span>
                </Label>
                <Input
                  id="wage_index"
                  type="number"
                  step="0.0001"
                  placeholder="1.0000"
                  value={formData.wage_index}
                  onChange={(e) => handleChange('wage_index', e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Find your wage index at{' '}
                  <a 
                    href="https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health/home-health-pps-wage-index" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    CMS.gov
                  </a>
                </p>
              </div>
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-800 text-xs">
                  <strong>Note:</strong> The wage index adjusts PDGM base payment rates based on local labor costs. 
                  A wage index above 1.0 increases payments, while below 1.0 decreases them.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Cost Analysis Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                Cost Analysis Settings
              </CardTitle>
              <CardDescription>
                Used for ROI calculations and financial impact analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="avg_staff_hourly_rate">Average Staff Hourly Rate ($)</Label>
                  <Input
                    id="avg_staff_hourly_rate"
                    type="number"
                    step="0.01"
                    value={formData.avg_staff_hourly_rate}
                    onChange={(e) => handleChange('avg_staff_hourly_rate', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="training_cost_per_hour">Training Cost Per Hour ($)</Label>
                  <Input
                    id="training_cost_per_hour"
                    type="number"
                    step="0.01"
                    value={formData.training_cost_per_hour}
                    onChange={(e) => handleChange('training_cost_per_hour', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="documentation_time_per_episode">Documentation Time Per Episode (hours)</Label>
                  <Input
                    id="documentation_time_per_episode"
                    type="number"
                    step="0.1"
                    value={formData.documentation_time_per_episode}
                    onChange={(e) => handleChange('documentation_time_per_episode', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="audit_staff_hourly_rate">Audit Staff Hourly Rate ($)</Label>
                  <Input
                    id="audit_staff_hourly_rate"
                    type="number"
                    step="0.01"
                    value={formData.audit_staff_hourly_rate}
                    onChange={(e) => handleChange('audit_staff_hourly_rate', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="avg_episodes_per_year">Avg Similar Episodes Per Year</Label>
                  <Input
                    id="avg_episodes_per_year"
                    type="number"
                    value={formData.avg_episodes_per_year}
                    onChange={(e) => handleChange('avg_episodes_per_year', e.target.value)}
                  />
                </div>
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
