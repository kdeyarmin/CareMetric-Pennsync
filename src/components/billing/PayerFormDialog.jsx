import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

export default function PayerFormDialog({ open, onOpenChange, payer, onSuccess }) {
  const isEditing = !!payer;
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    payer_name: '',
    payer_id: '',
    payer_type: 'Commercial',
    applicable_provider_types: [],
    contact_info: { phone: '', website: '', provider_portal: '', claims_address: '' },
    general_requirements: [],
    prior_authorization_required: false,
    timely_filing_limit_days: 180,
    electronic_submission_id: '',
    notes: '',
    is_active: true
  });

  const [newRequirement, setNewRequirement] = useState('');
  const [billingCodes, setBillingCodes] = useState([]);
  const [newCode, setNewCode] = useState({
    code: '', code_type: 'CPT', description: '', reimbursement_rate: '', 
    requirements: [], modifier_codes: [], frequency_limitations: ''
  });

  useEffect(() => {
    if (payer) {
      setFormData({
        payer_name: payer.payer_name || '',
        payer_id: payer.payer_id || '',
        payer_type: payer.payer_type || 'Commercial',
        applicable_provider_types: payer.applicable_provider_types || [],
        contact_info: payer.contact_info || { phone: '', website: '', provider_portal: '', claims_address: '' },
        general_requirements: payer.general_requirements || [],
        prior_authorization_required: payer.prior_authorization_required || false,
        timely_filing_limit_days: payer.timely_filing_limit_days || 180,
        electronic_submission_id: payer.electronic_submission_id || '',
        notes: payer.notes || '',
        is_active: payer.is_active !== false
      });
      setBillingCodes(payer.billing_codes || []);
    }
  }, [payer]);

  const providerTypes = ['All', 'RN', 'LPN', 'NP', 'MD', 'DO', 'PA', 'PT', 'OT', 'ST', 'MSW', 'Chiropractor'];

  const toggleProviderType = (type) => {
    setFormData(prev => ({
      ...prev,
      applicable_provider_types: prev.applicable_provider_types.includes(type)
        ? prev.applicable_provider_types.filter(t => t !== type)
        : [...prev.applicable_provider_types, type]
    }));
  };

  const addRequirement = () => {
    if (newRequirement.trim()) {
      setFormData(prev => ({
        ...prev,
        general_requirements: [...prev.general_requirements, newRequirement.trim()]
      }));
      setNewRequirement('');
    }
  };

  const removeRequirement = (index) => {
    setFormData(prev => ({
      ...prev,
      general_requirements: prev.general_requirements.filter((_, i) => i !== index)
    }));
  };

  const addBillingCode = () => {
    if (newCode.code && newCode.description) {
      setBillingCodes([...billingCodes, { ...newCode }]);
      setNewCode({
        code: '', code_type: 'CPT', description: '', reimbursement_rate: '',
        requirements: [], modifier_codes: [], frequency_limitations: ''
      });
    }
  };

  const removeBillingCode = (index) => {
    setBillingCodes(billingCodes.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payerData = {
        ...formData,
        billing_codes: billingCodes
      };

      if (isEditing) {
        await base44.entities.Payer.update(payer.id, payerData);
        toast.success('Payer updated successfully');
      } else {
        await base44.entities.Payer.create(payerData);
        toast.success('Payer created successfully');
      }

      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving payer:', error);
      toast.error('Failed to save payer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Payer' : 'Add New Payer'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update payer information' : 'Add a new insurance payer to the database'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payer Name *</Label>
                <Input
                  value={formData.payer_name}
                  onChange={(e) => setFormData({ ...formData, payer_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Payer ID *</Label>
                <Input
                  value={formData.payer_id}
                  onChange={(e) => setFormData({ ...formData, payer_id: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Payer Type *</Label>
                <Select value={formData.payer_type} onValueChange={(val) => setFormData({ ...formData, payer_type: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Medicare">Medicare</SelectItem>
                    <SelectItem value="Medicaid">Medicaid</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                    <SelectItem value="Managed Care">Managed Care</SelectItem>
                    <SelectItem value="Workers Comp">Workers Comp</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>EDI Payer ID</Label>
                <Input
                  value={formData.electronic_submission_id}
                  onChange={(e) => setFormData({ ...formData, electronic_submission_id: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Provider Types */}
          <div className="space-y-2">
            <Label>Applicable Provider Types *</Label>
            <div className="flex flex-wrap gap-2">
              {providerTypes.map(type => (
                <div key={type} className="flex items-center">
                  <Checkbox
                    checked={formData.applicable_provider_types.includes(type)}
                    onCheckedChange={() => toggleProviderType(type)}
                  />
                  <label className="ml-2 text-sm">{type}</label>
                </div>
              ))}
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Contact Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Phone</Label>
                <Input
                  value={formData.contact_info.phone}
                  onChange={(e) => setFormData({
                    ...formData,
                    contact_info: { ...formData.contact_info, phone: e.target.value }
                  })}
                />
              </div>
              <div>
                <Label>Website</Label>
                <Input
                  value={formData.contact_info.website}
                  onChange={(e) => setFormData({
                    ...formData,
                    contact_info: { ...formData.contact_info, website: e.target.value }
                  })}
                />
              </div>
              <div className="col-span-2">
                <Label>Provider Portal</Label>
                <Input
                  value={formData.contact_info.provider_portal}
                  onChange={(e) => setFormData({
                    ...formData,
                    contact_info: { ...formData.contact_info, provider_portal: e.target.value }
                  })}
                />
              </div>
              <div className="col-span-2">
                <Label>Claims Address</Label>
                <Textarea
                  value={formData.contact_info.claims_address}
                  onChange={(e) => setFormData({
                    ...formData,
                    contact_info: { ...formData.contact_info, claims_address: e.target.value }
                  })}
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* Requirements */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Requirements</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={formData.prior_authorization_required}
                  onCheckedChange={(checked) => setFormData({ ...formData, prior_authorization_required: checked })}
                />
                <Label>Prior Authorization Required</Label>
              </div>
              <div>
                <Label>Timely Filing Limit (days)</Label>
                <Input
                  type="number"
                  value={formData.timely_filing_limit_days}
                  onChange={(e) => setFormData({ ...formData, timely_filing_limit_days: parseInt(e.target.value) })}
                />
              </div>
            </div>
            
            <div>
              <Label>General Requirements</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Add a requirement..."
                  value={newRequirement}
                  onChange={(e) => setNewRequirement(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRequirement())}
                />
                <Button type="button" onClick={addRequirement} size="sm">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.general_requirements.map((req, i) => (
                  <Badge key={i} variant="secondary" className="gap-1">
                    {req}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => removeRequirement(i)} />
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label>Additional Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
            />
          </div>

          {/* Billing Codes Preview */}
          {billingCodes.length > 0 && (
            <div className="space-y-2">
              <Label>Billing Codes ({billingCodes.length})</Label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {billingCodes.map((code, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                    <span><strong>{code.code}</strong> - {code.description}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeBillingCode(i)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                isEditing ? 'Update Payer' : 'Create Payer'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}