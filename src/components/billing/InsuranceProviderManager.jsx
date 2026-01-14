import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function InsuranceProviderManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    phone: "",
    website: "",
    billing_contact_email: "",
    payer_id: "",
    billing_rules: {
      requires_preauth: false,
      claim_submission_method: "email",
      days_to_pay: 30,
      allowed_services: []
    },
    is_active: true
  });

  const { data: providers, refetch } = useQuery({
    queryKey: ["insuranceProviders"],
    queryFn: () => base44.entities.InsuranceProvider.list(),
    initialData: []
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.InsuranceProvider.create(formData);
      setFormData({
        name: "",
        address: "",
        phone: "",
        website: "",
        billing_contact_email: "",
        payer_id: "",
        billing_rules: {
          requires_preauth: false,
          claim_submission_method: "email",
          days_to_pay: 30,
          allowed_services: []
        },
        is_active: true
      });
      setDialogOpen(false);
      refetch();
    } catch (error) {
      alert('Error creating insurance provider: ' + error.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Insurance Providers</h2>
        <Button onClick={() => setDialogOpen(true)}>Add Insurance Provider</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map(provider => (
          <Card key={provider.id}>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <p className="font-bold text-lg">{provider.name}</p>
                <p className="text-sm text-gray-600">{provider.address}</p>
                <p className="text-sm">{provider.phone}</p>
                <p className="text-sm">{provider.billing_contact_email}</p>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-xs">Payer ID: {provider.payer_id}</span>
                  <span className={`text-xs px-2 py-1 rounded ${provider.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {provider.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Insurance Provider</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <Label>Provider Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Aetna"
                required
              />
            </div>

            <div>
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>

            <div>
              <Label>Phone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div>
              <Label>Billing Contact Email</Label>
              <Input
                type="email"
                value={formData.billing_contact_email}
                onChange={(e) => setFormData({ ...formData, billing_contact_email: e.target.value })}
                required
              />
            </div>

            <div>
              <Label>Payer ID</Label>
              <Input
                value={formData.payer_id}
                onChange={(e) => setFormData({ ...formData, payer_id: e.target.value })}
                required
              />
            </div>

            <div>
              <Label>Claim Submission Method</Label>
              <Select 
                value={formData.billing_rules.claim_submission_method} 
                onValueChange={(value) => setFormData({
                  ...formData,
                  billing_rules: { ...formData.billing_rules, claim_submission_method: value }
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="portal">Portal</SelectItem>
                  <SelectItem value="edi">EDI</SelectItem>
                  <SelectItem value="paper">Paper</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Create Provider</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}