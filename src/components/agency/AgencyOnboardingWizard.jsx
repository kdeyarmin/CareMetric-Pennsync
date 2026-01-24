import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CreditCard, Users, CheckCircle, ArrowRight, Settings } from "lucide-react";

export default function AgencyOnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [agencyData, setAgencyData] = useState({
    agency_name: "",
    admin_email: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    billing_address: "",
    max_users: 10,
    price_per_user: 29.99,
    billing_cycle: "monthly",
    auto_billing_enabled: true,
    initial_users: [],
    custom_compliance_rules: "",
    custom_documentation_style: ""
  });

  const [userEmail, setUserEmail] = useState("");

  const createAgencyMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('createAgencyWithStripe', data);
      return response.data || response;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Agency created successfully!');
        onComplete && onComplete(data.agency);
      } else {
        toast.error(data.error || 'Failed to create agency');
      }
    }
  });

  const addUser = () => {
    if (userEmail && !agencyData.initial_users.includes(userEmail)) {
      setAgencyData({
        ...agencyData,
        initial_users: [...agencyData.initial_users, userEmail]
      });
      setUserEmail("");
    }
  };

  const removeUser = (email) => {
    setAgencyData({
      ...agencyData,
      initial_users: agencyData.initial_users.filter(e => e !== email)
    });
  };

  const handleSubmit = () => {
    createAgencyMutation.mutate(agencyData);
  };

  const canProceed = () => {
    if (step === 1) return agencyData.agency_name && agencyData.admin_email;
    if (step === 2) return agencyData.contact_email;
    return true;
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Progress Indicator */}
      <div className="flex items-center justify-between mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center flex-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
              s <= step ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'
            }`}>
              {s < step ? <CheckCircle className="w-5 h-5" /> : s}
            </div>
            {s < 4 && <div className={`flex-1 h-1 mx-2 ${s < step ? 'bg-blue-600' : 'bg-slate-200'}`}></div>}
          </div>
        ))}
      </div>

      {/* Step 1: Agency Info */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Agency Information
            </CardTitle>
            <CardDescription>Basic information about your agency</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Agency Name *</Label>
              <Input
                value={agencyData.agency_name}
                onChange={(e) => setAgencyData({ ...agencyData, agency_name: e.target.value })}
                placeholder="e.g., Metro Home Health"
              />
            </div>
            <div>
              <Label>Agency Admin Email *</Label>
              <Input
                type="email"
                value={agencyData.admin_email}
                onChange={(e) => setAgencyData({ ...agencyData, admin_email: e.target.value })}
                placeholder="admin@agency.com"
              />
              <p className="text-xs text-slate-500 mt-1">This person will have access to the Agency Dashboard</p>
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input
                value={agencyData.contact_name}
                onChange={(e) => setAgencyData({ ...agencyData, contact_name: e.target.value })}
                placeholder="John Doe"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Billing Setup */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-600" />
              Billing Configuration
            </CardTitle>
            <CardDescription>Configure pricing and billing details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Billing Contact Email *</Label>
              <Input
                type="email"
                value={agencyData.contact_email}
                onChange={(e) => setAgencyData({ ...agencyData, contact_email: e.target.value })}
                placeholder="billing@agency.com"
              />
            </div>
            <div>
              <Label>Billing Contact Phone</Label>
              <Input
                value={agencyData.contact_phone}
                onChange={(e) => setAgencyData({ ...agencyData, contact_phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <Label>Billing Address</Label>
              <Textarea
                value={agencyData.billing_address}
                onChange={(e) => setAgencyData({ ...agencyData, billing_address: e.target.value })}
                placeholder="123 Main St, City, State ZIP"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Max Users</Label>
                <Input
                  type="number"
                  value={agencyData.max_users}
                  onChange={(e) => setAgencyData({ ...agencyData, max_users: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label>Price Per User/Month ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={agencyData.price_per_user}
                  onChange={(e) => setAgencyData({ ...agencyData, price_per_user: parseFloat(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <Label>Billing Cycle</Label>
              <Select value={agencyData.billing_cycle} onValueChange={(v) => setAgencyData({ ...agencyData, billing_cycle: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly (10% discount)</SelectItem>
                  <SelectItem value="annually">Annually (20% discount)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Initial Users */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Add Initial Users (Optional)
            </CardTitle>
            <CardDescription>Invite users to join your agency</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="user@example.com"
                onKeyPress={(e) => e.key === 'Enter' && addUser()}
              />
              <Button onClick={addUser} type="button">Add</Button>
            </div>
            <div className="space-y-2">
              {agencyData.initial_users.map((email) => (
                <div key={email} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                  <span className="text-sm">{email}</span>
                  <Button size="sm" variant="ghost" onClick={() => removeUser(email)}>Remove</Button>
                </div>
              ))}
              {agencyData.initial_users.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">No users added yet. You can add them later.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Agency Settings */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              Agency Settings
            </CardTitle>
            <CardDescription>Configure compliance and documentation preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Custom Compliance Rules (Optional)</Label>
              <Textarea
                value={agencyData.custom_compliance_rules}
                onChange={(e) => setAgencyData({ ...agencyData, custom_compliance_rules: e.target.value })}
                placeholder="e.g., All notes must include fall risk assessment, Medication reconciliation required on every visit"
                rows={4}
              />
            </div>
            <div>
              <Label>Documentation Style Preferences (Optional)</Label>
              <Textarea
                value={agencyData.custom_documentation_style}
                onChange={(e) => setAgencyData({ ...agencyData, custom_documentation_style: e.target.value })}
                placeholder="e.g., Use narrative style, Prefer bullet points for assessments, Include specific terminology"
                rows={4}
              />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">🎉 Almost Done!</h4>
              <p className="text-sm text-blue-800">
                Click "Complete Setup" to create your agency. You'll receive a unique agency code that your users can use to join.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <Button
          variant="outline"
          onClick={() => setStep(step - 1)}
          disabled={step === 1}
        >
          Previous
        </Button>
        {step < 4 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Next Step
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={createAgencyMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {createAgencyMutation.isPending ? 'Creating...' : 'Complete Setup'}
            <CheckCircle className="w-4 h-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}