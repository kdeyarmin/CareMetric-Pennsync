import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tantml:react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Calendar, Download, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatEastern } from "../utils/timezone";

export default function ScheduledReportManager() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingReport, setEditingReport] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    report_type: "compliance",
    schedule: {
      frequency: "weekly",
      day_of_week: "Monday",
      time: "09:00"
    },
    recipients: [{ email: "", role: "" }],
    format: "pdf",
    is_active: true
  });

  const queryClient = useQueryClient();

  const { data: reports = [] } = useQuery({
    queryKey: ['scheduledReports'],
    queryFn: () => base44.entities.ScheduledReport.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ScheduledReport.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledReports'] });
      setShowDialog(false);
      resetForm();
      toast.success("Scheduled report created");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ScheduledReport.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledReports'] });
      setShowDialog(false);
      resetForm();
      toast.success("Scheduled report updated");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ScheduledReport.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledReports'] });
      toast.success("Scheduled report deleted");
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      report_type: "compliance",
      schedule: {
        frequency: "weekly",
        day_of_week: "Monday",
        time: "09:00"
      },
      recipients: [{ email: "", role: "" }],
      format: "pdf",
      is_active: true
    });
    setEditingReport(null);
  };

  const handleEdit = (report) => {
    setEditingReport(report);
    setFormData(report);
    setShowDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingReport) {
      updateMutation.mutate({ id: editingReport.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const addRecipient = () => {
    setFormData({
      ...formData,
      recipients: [...formData.recipients, { email: "", role: "" }]
    });
  };

  const updateRecipient = (index, field, value) => {
    const newRecipients = [...formData.recipients];
    newRecipients[index][field] = value;
    setFormData({ ...formData, recipients: newRecipients });
  };

  const removeRecipient = (index) => {
    setFormData({
      ...formData,
      recipients: formData.recipients.filter((_, i) => i !== index)
    });
  };

  const getScheduleDescription = (schedule) => {
    if (schedule.frequency === 'daily') return 'Daily';
    if (schedule.frequency === 'weekly') return `Weekly on ${schedule.day_of_week}`;
    if (schedule.frequency === 'monthly') return `Monthly on day ${schedule.day_of_month}`;
    if (schedule.frequency === 'quarterly') return 'Quarterly';
    return schedule.frequency;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Scheduled Reports</h2>
          <p className="text-gray-600">Automate report generation and distribution</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              New Report
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingReport ? 'Edit Report' : 'Schedule New Report'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Report Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Report Type</Label>
                  <Select value={formData.report_type} onValueChange={(v) => setFormData({ ...formData, report_type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compliance">Compliance</SelectItem>
                      <SelectItem value="performance">Performance</SelectItem>
                      <SelectItem value="analytics">Analytics</SelectItem>
                      <SelectItem value="user_activity">User Activity</SelectItem>
                      <SelectItem value="patient_outcomes">Patient Outcomes</SelectItem>
                      <SelectItem value="financial">Financial</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Format</Label>
                  <Select value={formData.format} onValueChange={(v) => setFormData({ ...formData, format: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="excel">Excel</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-base mb-3 block">Schedule</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Frequency</Label>
                    <Select 
                      value={formData.schedule.frequency} 
                      onValueChange={(v) => setFormData({
                        ...formData,
                        schedule: { ...formData.schedule, frequency: v }
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.schedule.frequency === 'weekly' && (
                    <div>
                      <Label className="text-xs">Day of Week</Label>
                      <Select 
                        value={formData.schedule.day_of_week} 
                        onValueChange={(v) => setFormData({
                          ...formData,
                          schedule: { ...formData.schedule, day_of_week: v }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                            <SelectItem key={day} value={day}>{day}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {formData.schedule.frequency === 'monthly' && (
                    <div>
                      <Label className="text-xs">Day of Month</Label>
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        value={formData.schedule.day_of_month || 1}
                        onChange={(e) => setFormData({
                          ...formData,
                          schedule: { ...formData.schedule, day_of_month: parseInt(e.target.value) }
                        })}
                      />
                    </div>
                  )}

                  <div>
                    <Label className="text-xs">Time</Label>
                    <Input
                      type="time"
                      value={formData.schedule.time}
                      onChange={(e) => setFormData({
                        ...formData,
                        schedule: { ...formData.schedule, time: e.target.value }
                      })}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>Recipients</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addRecipient}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>
                {formData.recipients.map((recipient, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <Input
                      value={recipient.email}
                      onChange={(e) => updateRecipient(index, 'email', e.target.value)}
                      placeholder="email@example.com"
                      className="flex-1"
                    />
                    <Input
                      value={recipient.role}
                      onChange={(e) => updateRecipient(index, 'role', e.target.value)}
                      placeholder="Role (optional)"
                      className="w-40"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeRecipient(index)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingReport ? 'Update' : 'Create'} Report
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {reports.map((report) => (
          <Card key={report.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Calendar className="w-5 h-5 text-green-600" />
                    <h3 className="text-lg font-bold">{report.name}</h3>
                    <Badge variant={report.is_active ? "default" : "secondary"}>
                      {report.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Badge variant="outline">{report.format.toUpperCase()}</Badge>
                  </div>
                  <p className="text-gray-600 mb-3">{report.description}</p>
                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>Type: {report.report_type.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>{getScheduleDescription(report.schedule)} at {report.schedule.time}</span>
                    <span>•</span>
                    <span>{report.recipients?.length || 0} recipients</span>
                    {report.run_count > 0 && (
                      <>
                        <span>•</span>
                        <span>Run {report.run_count}x</span>
                      </>
                    )}
                  </div>
                  {report.next_run && (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">
                        Next run: {formatEastern(new Date(report.next_run), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>
                  )}
                  {report.last_run && (
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <span className="text-gray-500">
                        Last run: {formatEastern(new Date(report.last_run), 'MMM d, yyyy h:mm a')}
                      </span>
                      {report.last_run_status === 'success' && (
                        <Badge className="bg-green-100 text-green-800">Success</Badge>
                      )}
                      {report.last_run_status === 'failed' && (
                        <Badge className="bg-red-100 text-red-800">Failed</Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(report)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Delete this scheduled report?')) {
                        deleteMutation.mutate(report.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}