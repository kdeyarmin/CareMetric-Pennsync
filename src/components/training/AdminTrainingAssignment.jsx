import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Loader2, CheckCircle, Calendar } from "lucide-react";

export default function AdminTrainingAssignment({ commonIssues }) {
  const queryClient = useQueryClient();
  const [selectedModules, setSelectedModules] = useState([]);
  const [selectedProviders, setSelectedProviders] = useState([]);
  const [dueInDays, setDueInDays] = useState("14");

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.filter({ is_active: true })
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['allProviders'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role !== 'admin');
    }
  });

  const assignTrainingMutation = useMutation({
    mutationFn: async ({ moduleIds, providerEmails, dueDate }) => {
      const assignments = [];
      
      for (const moduleId of moduleIds) {
        for (const email of providerEmails) {
          assignments.push({
            nurse_email: email,
            training_module_id: moduleId,
            status: 'assigned',
            due_date: dueDate
          });
        }
      }

      await base44.entities.TrainingCompletion.bulkCreate(assignments);
      
      // Send notification emails
      for (const email of providerEmails) {
        try {
          await base44.integrations.Core.SendEmail({
            to: email,
            subject: 'New Training Assigned',
            body: `
<h2>New Training Assignment</h2>
<p>You have been assigned ${moduleIds.length} new training module(s).</p>
<p><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString()}</p>
<p>Please visit the Training Hub to complete your assigned modules.</p>
<p>Best regards,<br>CareMetric AI Training Team</p>
            `
          });
        } catch (e) {
          console.error('Error sending email:', e);
        }
      }

      return assignments;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainingCompletions'] });
      toast.success('Training assigned successfully!');
      setSelectedModules([]);
      setSelectedProviders([]);
    },
    onError: () => {
      toast.error('Failed to assign training');
    }
  });

  const handleAssign = () => {
    if (selectedModules.length === 0) {
      toast.error('Select at least one training module');
      return;
    }
    if (selectedProviders.length === 0) {
      toast.error('Select at least one provider');
      return;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + parseInt(dueInDays));

    assignTrainingMutation.mutate({
      moduleIds: selectedModules,
      providerEmails: selectedProviders,
      dueDate: dueDate.toISOString().split('T')[0]
    });
  };

  const toggleModule = (moduleId) => {
    setSelectedModules(prev =>
      prev.includes(moduleId) ? prev.filter(id => id !== moduleId) : [...prev, moduleId]
    );
  };

  const toggleProvider = (email) => {
    setSelectedProviders(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  const selectAll = (type) => {
    if (type === 'providers') {
      setSelectedProviders(providers.map(p => p.email));
    } else {
      setSelectedModules(trainingModules.map(m => m.id));
    }
  };

  // Get suggested modules based on common issues
  const suggestedModules = trainingModules.filter(module => {
    return commonIssues?.some(issue => 
      module.title.toLowerCase().includes(issue.issue.toLowerCase()) ||
      module.related_diagnoses?.some(d => d.toLowerCase().includes(issue.issue.toLowerCase()))
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          Assign Training
        </CardTitle>
        <CardDescription>
          Assign training modules to providers based on identified needs
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {suggestedModules.length > 0 && (
          <Alert className="bg-blue-50 border-blue-200">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              {suggestedModules.length} training module(s) recommended based on common issues
            </AlertDescription>
          </Alert>
        )}

        {/* Training Modules Selection */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold">Select Training Modules</Label>
            <Button variant="ghost" size="sm" onClick={() => selectAll('modules')}>
              Select All
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto border rounded-lg p-3 space-y-2">
            {trainingModules.map(module => (
              <div key={module.id} className="flex items-start space-x-2 p-2 hover:bg-slate-50 rounded">
                <Checkbox
                  id={module.id}
                  checked={selectedModules.includes(module.id)}
                  onCheckedChange={() => toggleModule(module.id)}
                />
                <label htmlFor={module.id} className="flex-1 cursor-pointer">
                  <p className="font-medium text-sm text-slate-900">
                    {module.title}
                    {suggestedModules.includes(module) && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{module.category} • {module.duration_minutes} min</p>
                </label>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">{selectedModules.length} module(s) selected</p>
        </div>

        {/* Provider Selection */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold">Assign To Providers</Label>
            <Button variant="ghost" size="sm" onClick={() => selectAll('providers')}>
              Select All
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto border rounded-lg p-3 space-y-2">
            {providers.map(provider => (
              <div key={provider.email} className="flex items-center space-x-2 p-2 hover:bg-slate-50 rounded">
                <Checkbox
                  id={provider.email}
                  checked={selectedProviders.includes(provider.email)}
                  onCheckedChange={() => toggleProvider(provider.email)}
                />
                <label htmlFor={provider.email} className="flex-1 cursor-pointer">
                  <p className="font-medium text-sm text-slate-900">{provider.full_name}</p>
                  <p className="text-xs text-slate-500">{provider.credential_type}</p>
                </label>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">{selectedProviders.length} provider(s) selected</p>
        </div>

        {/* Due Date */}
        <div>
          <Label htmlFor="due_in_days" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Due Date
          </Label>
          <Select value={dueInDays} onValueChange={setDueInDays}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days from now</SelectItem>
              <SelectItem value="14">14 days from now</SelectItem>
              <SelectItem value="30">30 days from now</SelectItem>
              <SelectItem value="60">60 days from now</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Assign Button */}
        <Button 
          onClick={handleAssign}
          disabled={assignTrainingMutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {assignTrainingMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Assigning...
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4 mr-2" />
              Assign Training ({selectedProviders.length} providers, {selectedModules.length} modules)
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}