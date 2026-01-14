import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function MessageTemplateManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    template_type: "appointment_reminder",
    trigger_event: "appointment_scheduled",
    subject_line: "",
    message_body: "",
    sms_body: "",
    delivery_method: "email",
    delay_hours: 0,
    include_attachments: false,
    personalize_with_ai: false,
    is_active: true
  });

  const { data: templates, refetch } = useQuery({
    queryKey: ["messageTemplates"],
    queryFn: () => base44.entities.MessageTemplate.list(),
    initialData: []
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.MessageTemplate.create(formData);
      setFormData({
        name: "",
        template_type: "appointment_reminder",
        trigger_event: "appointment_scheduled",
        subject_line: "",
        message_body: "",
        sms_body: "",
        delivery_method: "email",
        delay_hours: 0,
        include_attachments: false,
        personalize_with_ai: false,
        is_active: true
      });
      setDialogOpen(false);
      refetch();
    } catch (error) {
      alert('Error creating template: ' + error.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Message Templates</h2>
        <Button onClick={() => setDialogOpen(true)}>Create Template</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map(template => (
          <Card key={template.id}>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <p className="font-bold text-lg">{template.name}</p>
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">{template.template_type}</span>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">{template.delivery_method}</span>
                  {template.personalize_with_ai && (
                    <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">AI Personalized</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 line-clamp-2">{template.message_body}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-96 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Message Template</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Appointment Reminder 24h"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Template Type</Label>
                <Select value={formData.template_type} onValueChange={(value) => setFormData({ ...formData, template_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="appointment_reminder">Appointment Reminder</SelectItem>
                    <SelectItem value="follow_up">Follow-up</SelectItem>
                    <SelectItem value="educational">Educational</SelectItem>
                    <SelectItem value="general_inquiry">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Trigger Event</Label>
                <Select value={formData.trigger_event} onValueChange={(value) => setFormData({ ...formData, trigger_event: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="appointment_scheduled">Appointment Scheduled</SelectItem>
                    <SelectItem value="appointment_24h_before">24h Before Appointment</SelectItem>
                    <SelectItem value="visit_completed">Visit Completed</SelectItem>
                    <SelectItem value="diagnosis_given">Diagnosis Given</SelectItem>
                    <SelectItem value="manual">Manual Trigger</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Subject Line</Label>
              <Input
                value={formData.subject_line}
                onChange={(e) => setFormData({ ...formData, subject_line: e.target.value })}
                placeholder="Use {{patient_name}}, {{appointment_date}} as placeholders"
              />
            </div>

            <div>
              <Label>Email Message Body</Label>
              <Textarea
                value={formData.message_body}
                onChange={(e) => setFormData({ ...formData, message_body: e.target.value })}
                placeholder="Message with placeholders"
                rows={4}
                required
              />
            </div>

            <div>
              <Label>SMS Message Body (Optional)</Label>
              <Textarea
                value={formData.sms_body}
                onChange={(e) => setFormData({ ...formData, sms_body: e.target.value })}
                placeholder="SMS version (keep short)"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Delivery Method</Label>
                <Select value={formData.delivery_method} onValueChange={(value) => setFormData({ ...formData, delivery_method: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Delay (hours)</Label>
                <Input
                  type="number"
                  value={formData.delay_hours}
                  onChange={(e) => setFormData({ ...formData, delay_hours: parseInt(e.target.value) })}
                  min="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.personalize_with_ai}
                  onCheckedChange={(checked) => setFormData({ ...formData, personalize_with_ai: checked })}
                />
                <Label>Personalize with AI</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={formData.include_attachments}
                  onCheckedChange={(checked) => setFormData({ ...formData, include_attachments: checked })}
                />
                <Label>Include Attachments</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Create Template</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}