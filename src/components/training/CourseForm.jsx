import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function CourseForm({ course, onSuccess }) {
  const [formData, setFormData] = useState(course || {
    title: '',
    description: '',
    category: 'compliance',
    status: 'draft',
    estimated_minutes: 60,
    passing_score: 80,
    is_mandatory: false,
    enable_certificate: true,
  });

  const createMutation = useMutation({
    mutationFn: () => course
      ? base44.entities.TrainingCourse.update(course.id, formData)
      : base44.entities.TrainingCourse.create(formData),
    onSuccess,
    onError: (error) => {
      console.error('Course save error:', error);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
      <div>
        <Label className="text-sm font-semibold">Course Title *</Label>
        <Input
          required
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Enter course title"
          className="h-11 mt-1"
        />
      </div>

      <div>
        <Label className="text-sm font-semibold">Description</Label>
        <Textarea
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Course description"
          rows={3}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Category *</Label>
          <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="compliance">Compliance</SelectItem>
              <SelectItem value="clinical">Clinical</SelectItem>
              <SelectItem value="safety">Safety</SelectItem>
              <SelectItem value="documentation">Documentation</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="leadership">Leadership</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm font-semibold">Status *</Label>
          <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Estimated Minutes *</Label>
          <Input
            type="number"
            required
            min="1"
            max="600"
            value={formData.estimated_minutes}
            onChange={(e) => setFormData({ ...formData, estimated_minutes: Math.max(1, parseInt(e.target.value) || 1) })}
            className="h-11 mt-1"
          />
        </div>

        <div>
          <Label className="text-sm font-semibold">Passing Score % *</Label>
          <Input
            type="number"
            required
            min="0"
            max="100"
            value={formData.passing_score}
            onChange={(e) => setFormData({ ...formData, passing_score: parseInt(e.target.value) })}
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.is_mandatory}
            onChange={(e) => setFormData({ ...formData, is_mandatory: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Mandatory Course</span>
        </label>

        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.enable_certificate}
            onChange={(e) => setFormData({ ...formData, enable_certificate: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Issue Certificate</span>
        </label>
      </div>

      {createMutation.isError && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            Failed to save course. Please check your inputs and try again.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={createMutation.isPending} className="btn-primary w-full sm:w-auto">
          {createMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : (
            course ? 'Update Course' : 'Create Course'
          )}
        </Button>
      </div>
    </form>
  );
}
