import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LearningPlanForm({ plan, onSuccess }) {
  const currentYear = new Date().getFullYear();

  const [formData, setFormData] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    year: plan?.year || currentYear,
    business_line_scope: plan?.business_line_scope || 'all',
    plan_type: plan?.plan_type || 'annual',
    start_date: plan?.start_date || '',
    end_date: plan?.end_date || '',
    global_due_date: plan?.global_due_date || '',
    active: plan?.active !== undefined ? plan.active : true,
  });

  const createMutation = useMutation({
    mutationFn: () => plan
      ? base44.entities.LearningPlan.update(plan.id, formData)
      : base44.entities.LearningPlan.create(formData),
    onSuccess,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Plan Name *</Label>
        <Input
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., 2026 Annual Training Plan"
        />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Plan description"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Year *</Label>
          <Input
            type="number"
            required
            value={formData.year}
            onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) })}
          />
        </div>

        <div>
          <Label>Plan Type *</Label>
          <Select value={formData.plan_type} onValueChange={(value) => setFormData({ ...formData, plan_type: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="annual">Annual</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Business Line Scope *</Label>
          <Select value={formData.business_line_scope} onValueChange={(value) => setFormData({ ...formData, business_line_scope: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="home_health">Home Health</SelectItem>
              <SelectItem value="hospice">Hospice</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.active}
            onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
          />
          <span className="text-sm">Active</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Start Date</Label>
          <Input
            type="date"
            value={formData.start_date}
            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
          />
        </div>

        <div>
          <Label>End Date</Label>
          <Input
            type="date"
            value={formData.end_date}
            onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label>Global Due Date</Label>
        <Input
          type="date"
          value={formData.global_due_date}
          onChange={(e) => setFormData({ ...formData, global_due_date: e.target.value })}
        />
        <p className="text-xs text-slate-500 mt-1">Default due date for all courses in this plan</p>
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Saving...' : plan ? 'Update Plan' : 'Create Plan'}
        </Button>
      </div>
    </form>
  );
}