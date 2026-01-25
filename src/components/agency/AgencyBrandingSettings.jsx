import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Palette, Upload } from "lucide-react";

export default function AgencyBrandingSettings({ agency }) {
  const queryClient = useQueryClient();
  const [branding, setBranding] = useState({
    logo_url: agency.logo_url || "",
    primary_color: agency.primary_color || "#3b82f6",
    welcome_message: agency.welcome_message || "",
    email_footer: agency.email_footer || ""
  });

  const updateBrandingMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.Agency.update(agency.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myAgency'] });
      toast.success('Branding updated');
    }
  });

  const handleLogoUpload = async (file) => {
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setBranding({ ...branding, logo_url: file_url });
      toast.success('Logo uploaded');
    } catch (error) {
      toast.error('Failed to upload logo');
    }
  };

  const handleSave = () => {
    updateBrandingMutation.mutate(branding);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-blue-600" />
          Agency Branding
        </CardTitle>
        <CardDescription>Customize invitation emails and user experience</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Agency Logo</Label>
          <div className="flex items-center gap-3 mt-2">
            {branding.logo_url && (
              <img src={branding.logo_url} alt="Agency logo" className="w-16 h-16 object-contain rounded border" />
            )}
            <div className="flex-1">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files[0] && handleLogoUpload(e.target.files[0])}
              />
              <p className="text-xs text-slate-500 mt-1">Used in invitation emails</p>
            </div>
          </div>
        </div>

        <div>
          <Label>Primary Brand Color</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={branding.primary_color}
              onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
              className="w-20 h-10"
            />
            <Input
              value={branding.primary_color}
              onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
              placeholder="#3b82f6"
            />
          </div>
        </div>

        <div>
          <Label>Welcome Message for New Users</Label>
          <Textarea
            value={branding.welcome_message}
            onChange={(e) => setBranding({ ...branding, welcome_message: e.target.value })}
            placeholder="Welcome to our team! We're excited to have you join us..."
            rows={3}
          />
        </div>

        <div>
          <Label>Email Footer</Label>
          <Textarea
            value={branding.email_footer}
            onChange={(e) => setBranding({ ...branding, email_footer: e.target.value })}
            placeholder="Questions? Contact us at support@agency.com"
            rows={2}
          />
        </div>

        <Button 
          onClick={handleSave} 
          disabled={updateBrandingMutation.isPending}
          className="w-full"
        >
          {updateBrandingMutation.isPending ? 'Saving...' : 'Save Branding'}
        </Button>
      </CardContent>
    </Card>
  );
}