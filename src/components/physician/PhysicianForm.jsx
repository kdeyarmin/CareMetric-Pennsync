import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

export default function PhysicianForm({ physician, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    full_name: physician?.full_name || '',
    credentials: physician?.credentials || '',
    specialty: physician?.specialty || '',
    subspecialty: physician?.subspecialty || '',
    practice_name: physician?.practice_name || '',
    office_address: physician?.office_address || '',
    office_city: physician?.office_city || '',
    office_state: physician?.office_state || '',
    office_zip: physician?.office_zip || '',
    phone_number: physician?.phone_number || '',
    fax_number: physician?.fax_number || '',
    email: physician?.email || '',
    npi_number: physician?.npi_number || '',
    accepts_home_health: physician?.accepts_home_health ?? true,
    accepts_hospice: physician?.accepts_hospice ?? false,
    preferred_contact_method: physician?.preferred_contact_method || 'fax',
    office_hours: physician?.office_hours || '',
    notes: physician?.notes || '',
    tags: physician?.tags || [],
    is_active: physician?.is_active ?? true,
  });

  const [tagInput, setTagInput] = useState('');

  const saveMutation = useMutation({
    mutationFn: (data) => {
      if (physician) {
        return base44.entities.Physician.update(physician.id, data);
      }
      return base44.entities.Physician.create(data);
    },
    onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['physicians'] });
    toast.success(physician ? 'Provider updated' : 'Provider added to directory');
    onClose();
    },
    onError: (error) => {
      toast.error('Failed to save: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.full_name.trim()) {
      return toast.error('Provider name is required');
    }
    if (!formData.fax_number.trim()) {
      return toast.error('Fax number is required');
    }
    saveMutation.mutate(formData);
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const removeTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-1 sm:col-span-1">
          <Label className="text-sm font-semibold">Full Name *</Label>
          <Input
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            placeholder="Jane Smith"
            className="h-11 mt-1"
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <Label className="text-sm font-semibold">Credentials</Label>
          <Input
            value={formData.credentials}
            onChange={(e) => setFormData({ ...formData, credentials: e.target.value })}
            placeholder="MD, DO, NP, PA"
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Specialty</Label>
          <Input
            value={formData.specialty}
            onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
            placeholder="Family Medicine, Cardiology"
            className="h-11 mt-1"
          />
        </div>
        <div>
          <Label className="text-sm font-semibold">Subspecialty</Label>
          <Input
            value={formData.subspecialty}
            onChange={(e) => setFormData({ ...formData, subspecialty: e.target.value })}
            placeholder="e.g., Interventional Cardiology"
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div>
        <Label className="text-sm font-semibold">Practice / Organization</Label>
        <Input
          value={formData.practice_name}
          onChange={(e) => setFormData({ ...formData, practice_name: e.target.value })}
          placeholder="City Medical Group"
          className="h-11 mt-1"
        />
      </div>

      <div>
        <Label className="text-sm font-semibold">Office Address</Label>
        <Input
          value={formData.office_address}
          onChange={(e) => setFormData({ ...formData, office_address: e.target.value })}
          placeholder="123 Main Street"
          className="h-11 mt-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className="text-sm font-semibold">City</Label>
          <Input
            value={formData.office_city}
            onChange={(e) => setFormData({ ...formData, office_city: e.target.value })}
            className="h-11 mt-1"
          />
        </div>
        <div>
          <Label className="text-sm font-semibold">State</Label>
          <Input
            value={formData.office_state}
            onChange={(e) => setFormData({ ...formData, office_state: e.target.value })}
            placeholder="CA"
            className="h-11 mt-1"
          />
        </div>
        <div>
          <Label className="text-sm font-semibold">ZIP</Label>
          <Input
            value={formData.office_zip}
            onChange={(e) => setFormData({ ...formData, office_zip: e.target.value })}
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Phone Number</Label>
          <Input
            type="tel"
            value={formData.phone_number}
            onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
            placeholder="+1234567890"
            className="h-11 mt-1"
          />
        </div>
        <div>
          <Label className="text-sm font-semibold">Fax Number</Label>
          <Input
            type="tel"
            value={formData.fax_number}
            onChange={(e) => setFormData({ ...formData, fax_number: e.target.value })}
            placeholder="+1234567890"
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Email</Label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="provider@example.com"
            className="h-11 mt-1"
          />
        </div>
        <div>
          <Label className="text-sm font-semibold">NPI Number</Label>
          <Input
            value={formData.npi_number}
            onChange={(e) => setFormData({ ...formData, npi_number: e.target.value })}
            placeholder="1234567890"
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Preferred Contact Method</Label>
          <Select value={formData.preferred_contact_method} onValueChange={(value) => setFormData({ ...formData, preferred_contact_method: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="fax">Fax</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="portal">Portal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm font-semibold">Office Hours</Label>
          <Input
            value={formData.office_hours}
            onChange={(e) => setFormData({ ...formData, office_hours: e.target.value })}
            placeholder="Mon-Fri 9AM-5PM"
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.accepts_home_health}
            onChange={(e) => setFormData({ ...formData, accepts_home_health: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Accepts Home Health</span>
        </label>
        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.accepts_hospice}
            onChange={(e) => setFormData({ ...formData, accepts_hospice: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Accepts Hospice</span>
        </label>
      </div>

      <div>
        <Label className="text-sm font-semibold">Tags</Label>
        <div className="flex gap-2 mb-2 mt-1">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Add tag (e.g., preferred, wound specialist)"
            className="h-11"
          />
          <Button type="button" onClick={addTag} variant="outline" className="min-h-[44px]">Add</Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {formData.tags.map((tag, idx) => (
            <Badge key={idx} variant="outline" className="gap-1">
              {tag}
              <X className="w-3 h-3 cursor-pointer" onClick={() => removeTag(tag)} />
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm font-semibold">Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes about this provider..."
          rows={3}
          className="mt-1"
        />
      </div>

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose} className="min-h-[44px]">
          Cancel
        </Button>
        <Button type="submit" disabled={saveMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 min-h-[44px]">
          {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {physician ? 'Update' : 'Add'} Provider
        </Button>
      </div>
    </form>
  );
}