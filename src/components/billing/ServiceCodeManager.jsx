import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function ServiceCodeManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    default_price: "",
    billing_category: "evaluation_management",
    is_active: true,
    requires_authorization: false
  });

  const { data: serviceCodes, refetch } = useQuery({
    queryKey: ["serviceCodes"],
    queryFn: () => base44.entities.ServiceCode.list(),
    initialData: []
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.ServiceCode.create({
        ...formData,
        default_price: parseFloat(formData.default_price)
      });
      setFormData({
        code: "",
        name: "",
        description: "",
        default_price: "",
        billing_category: "evaluation_management",
        is_active: true,
        requires_authorization: false
      });
      setDialogOpen(false);
      refetch();
    } catch (error) {
      alert('Error creating service code: ' + error.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Service Codes</h2>
        <Button onClick={() => setDialogOpen(true)}>Add Service Code</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {serviceCodes.map(code => (
          <Card key={code.id}>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <p className="font-bold text-lg">{code.code}</p>
                <p className="font-semibold text-sm">{code.name}</p>
                <p className="text-sm text-gray-600">{code.description}</p>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-semibold">${code.default_price.toFixed(2)}</span>
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    {code.billing_category}
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
            <DialogTitle>Add Service Code</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Service Code</Label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g., 99203"
                required
              />
            </div>

            <div>
              <Label>Service Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Office Visit"
                required
              />
            </div>

            <div>
              <Label>Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Detailed description"
              />
            </div>

            <div>
              <Label>Default Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.default_price}
                onChange={(e) => setFormData({ ...formData, default_price: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <Label>Billing Category</Label>
              <Select value={formData.billing_category} onValueChange={(value) => setFormData({ ...formData, billing_category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="evaluation_management">Evaluation & Management</SelectItem>
                  <SelectItem value="therapy">Therapy</SelectItem>
                  <SelectItem value="procedure">Procedure</SelectItem>
                  <SelectItem value="nursing">Nursing</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Create Service Code</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}