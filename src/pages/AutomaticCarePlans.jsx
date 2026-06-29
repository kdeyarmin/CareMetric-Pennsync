import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import LoadingState from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Zap,
  Plus,
  Edit,
  Trash2,
  Target,
  Pill,
  Activity,
  Shield,
  X,
  XCircle, // Added XCircle import
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";

export default function AutomaticCarePlans() {

  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showDialog, setShowDialog] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState(null);
  const [interventionInput, setInterventionInput] = useState("");
  
  const [formData, setFormData] = useState({
    trigger_type: "diagnosis",
    trigger_value: "",
    care_type: "both",
    problem: "",
    goal: "",
    interventions: [],
    frequency: "Each visit",
    priority: "medium",
    baseline_measurement: "",
    days_until_target: 60,
    is_active: true
  });

  // Check if user is admin
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  // Fetch all automatic care plan triggers
  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ['automaticCarePlanTriggers'],
    queryFn: () => base44.entities.AutomaticCarePlanTrigger.list('-created_date'),
    initialData: [],
    enabled: isAdmin,
  });

  // Create trigger mutation
  const createTriggerMutation = useMutation({
    mutationFn: (data) => base44.entities.AutomaticCarePlanTrigger.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automaticCarePlanTriggers'] });
      resetForm();
      setShowDialog(false);
    },
  });

  // Update trigger mutation
  const updateTriggerMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AutomaticCarePlanTrigger.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automaticCarePlanTriggers'] });
      resetForm();
      setShowDialog(false);
      setEditingTrigger(null);
    },
  });

  // Delete trigger mutation
  const deleteTriggerMutation = useMutation({
    mutationFn: (id) => base44.entities.AutomaticCarePlanTrigger.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automaticCarePlanTriggers'] });
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => 
      base44.entities.AutomaticCarePlanTrigger.update(id, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automaticCarePlanTriggers'] });
    },
  });

  const resetForm = () => {
    setFormData({
      trigger_type: "diagnosis",
      trigger_value: "",
      care_type: "both",
      problem: "",
      goal: "",
      interventions: [],
      frequency: "Each visit",
      priority: "medium",
      baseline_measurement: "",
      days_until_target: 60,
      is_active: true
    });
    setInterventionInput("");
  };

  const handleAddIntervention = () => {
    if (interventionInput.trim()) {
      setFormData(prev => ({
        ...prev,
        interventions: [...prev.interventions, interventionInput.trim()]
      }));
      setInterventionInput("");
    }
  };

  const handleRemoveIntervention = (index) => {
    setFormData(prev => ({
      ...prev,
      interventions: prev.interventions.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (formData.interventions.length === 0) {
      toast.error("Please add at least one intervention");
      return;
    }

    if (editingTrigger) {
      updateTriggerMutation.mutate({
        id: editingTrigger.id,
        data: formData
      });
    } else {
      createTriggerMutation.mutate(formData);
    }
  };

  const handleEdit = (trigger) => {
    setEditingTrigger(trigger);
    setFormData({
      trigger_type: trigger.trigger_type,
      trigger_value: trigger.trigger_value,
      care_type: trigger.care_type,
      problem: trigger.problem,
      goal: trigger.goal,
      interventions: trigger.interventions || [],
      frequency: trigger.frequency,
      priority: trigger.priority,
      baseline_measurement: trigger.baseline_measurement || "",
      days_until_target: trigger.days_until_target || 60,
      is_active: trigger.is_active
    });
    setShowDialog(true);
  };

  const handleDelete = async (id) => {
    if (await confirm({ title: "Delete trigger?", description: "Are you sure you want to delete this automatic care plan trigger?", confirmText: "Delete", destructive: true })) {
      deleteTriggerMutation.mutate(id);
    }
  };

  const handleToggleActive = (id, currentStatus) => {
    toggleActiveMutation.mutate({ id, isActive: !currentStatus });
  };

  const getTriggerIcon = (type) => {
    return type === 'diagnosis' ? <Activity className="w-4 h-4" /> : <Pill className="w-4 h-4" />;
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getCareTypeColor = (careType) => {
    switch (careType) {
      case 'home_health': return 'bg-blue-100 text-blue-800';
      case 'hospice': return 'bg-navy-100 text-navy-800';
      case 'both': return 'bg-emerald-100 text-emerald-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <p className="font-semibold mb-2">Access Denied</p>
            <p>You do not have administrator privileges to manage automatic care plans.</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Zap}
        eyebrow="Patient Care"
        title="Automatic Care Plans"
        description="Set up care plans that trigger automatically based on diagnosis or medication"
        favoritePage="AutomaticCarePlans"
      />

      <Alert className="mb-4 sm:mb-6 bg-blue-50 border-blue-200">
        <Shield className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <p className="font-semibold mb-2">How Automatic Care Plans Work:</p>
          <ul className="list-disc ml-5 space-y-1 text-sm">
            <li>When a patient has a matching diagnosis or is taking a matching medication, the system will automatically suggest the corresponding care plan</li>
            <li>The AI Care Plan Generator will include these automatic triggers in its suggestions</li>
            <li>Nurses can review and accept these suggestions during visit documentation</li>
            <li>Ensures consistent, evidence-based care planning across all patients</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <CardTitle className="text-base sm:text-lg">Automatic Care Plan Triggers ({triggers.length})</CardTitle>
            <Button
              onClick={() => {
                resetForm();
                setEditingTrigger(null);
                setShowDialog(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto min-h-[44px]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Trigger
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState label="Loading triggers..." className="py-8" />
          ) : triggers.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No automatic care plan triggers"
              description="Create a trigger to automatically generate care plans from clinical signals."
              action={
                <Button onClick={() => setShowDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Trigger
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sm:text-sm">Status</TableHead>
                    <TableHead className="text-xs sm:text-sm">Trigger</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden md:table-cell">Care Type</TableHead>
                    <TableHead className="text-xs sm:text-sm">Problem</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Goal</TableHead>
                    <TableHead className="text-xs sm:text-sm hidden md:table-cell">Priority</TableHead>
                    <TableHead className="text-xs sm:text-sm">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triggers.map((trigger) => (
                    <TableRow key={trigger.id}>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleActive(trigger.id, trigger.is_active)}
                          className={`min-h-[44px] ${trigger.is_active ? "text-emerald-600" : "text-slate-400"}`}
                        >
                          {trigger.is_active ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : (
                            <XCircle className="w-5 h-5" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm">
                        <div className="flex items-center gap-2">
                          {getTriggerIcon(trigger.trigger_type)}
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 truncate">{trigger.trigger_value}</p>
                            <p className="text-xs text-slate-500 capitalize">{trigger.trigger_type}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge className={`${getCareTypeColor(trigger.care_type)} text-xs`}>
                          {trigger.care_type === 'home_health' ? 'HH' :
                           trigger.care_type === 'hospice' ? 'Hospice' : 'Both'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm">
                        <p className="font-medium text-slate-900 max-w-[150px] sm:max-w-xs truncate">
                          {trigger.problem}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm hidden lg:table-cell">
                        <p className="text-slate-600 max-w-xs truncate">
                          {trigger.goal}
                        </p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge className={`${getPriorityColor(trigger.priority)} text-xs`}>
                          {trigger.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 sm:gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(trigger)}
                            className="min-h-[44px] w-10 sm:w-auto p-0 sm:px-3"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(trigger.id)}
                            className="text-red-600 hover:text-red-700 min-h-[44px] w-10 sm:w-auto p-0 sm:px-3"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => {
        setShowDialog(open);
        if (!open) {
          resetForm();
          setEditingTrigger(null);
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTrigger ? 'Edit' : 'Create'} Automatic Care Plan Trigger
            </DialogTitle>
            <DialogDescription>
              Set up a care plan that will automatically be suggested when a patient has this diagnosis or medication.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Trigger Type *</Label>
                <Select
                  value={formData.trigger_type}
                  onValueChange={(value) => setFormData({...formData, trigger_type: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diagnosis">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4" />
                        <span>Diagnosis</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="medication">
                      <div className="flex items-center gap-2">
                        <Pill className="w-4 h-4" />
                        <span>Medication</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>
                  {formData.trigger_type === 'diagnosis' ? 'Diagnosis' : 'Medication Name'} *
                </Label>
                <Input
                  required
                  placeholder={formData.trigger_type === 'diagnosis' ? 'e.g., CHF, COPD, Diabetes' : 'e.g., Warfarin, Insulin'}
                  value={formData.trigger_value}
                  onChange={(e) => setFormData({...formData, trigger_value: e.target.value})}
                />
              </div>
            </div>

            <div>
              <Label>Care Type *</Label>
              <Select
                value={formData.care_type}
                onValueChange={(value) => setFormData({...formData, care_type: value})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home_health">Home Health Only</SelectItem>
                  <SelectItem value="hospice">Hospice Only</SelectItem>
                  <SelectItem value="both">Both Home Health & Hospice</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Problem/Nursing Diagnosis *</Label>
              <Input
                required
                placeholder="e.g., Risk for Bleeding related to anticoagulation therapy"
                value={formData.problem}
                onChange={(e) => setFormData({...formData, problem: e.target.value})}
              />
            </div>

            <div>
              <Label>Goal (SMART) *</Label>
              <Textarea
                required
                placeholder="e.g., Patient will maintain INR between 2-3 with no signs of bleeding throughout care episode"
                value={formData.goal}
                onChange={(e) => setFormData({...formData, goal: e.target.value})}
                rows={2}
              />
            </div>

            <div>
              <Label>Baseline Measurement</Label>
              <Input
                placeholder="e.g., Current INR: [to be documented]"
                value={formData.baseline_measurement}
                onChange={(e) => setFormData({...formData, baseline_measurement: e.target.value})}
              />
            </div>

            <div>
              <Label>Interventions * (add at least one)</Label>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Type intervention and press Add"
                  value={interventionInput}
                  onChange={(e) => setInterventionInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddIntervention();
                    }
                  }}
                />
                <Button type="button" onClick={handleAddIntervention} variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {formData.interventions.map((intervention, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                    <span className="flex-1 text-sm">{intervention}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveIntervention(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label>Frequency</Label>
                <Input
                  placeholder="e.g., Each visit"
                  value={formData.frequency}
                  onChange={(e) => setFormData({...formData, frequency: e.target.value})}
                />
              </div>

              <div>
                <Label>Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) => setFormData({...formData, priority: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High Priority</SelectItem>
                    <SelectItem value="medium">Medium Priority</SelectItem>
                    <SelectItem value="low">Low Priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Days Until Target</Label>
                <Input
                  type="number"
                  value={formData.days_until_target}
                  onChange={(e) => setFormData({...formData, days_until_target: parseInt(e.target.value)})}
                />
              </div>
            </div>
          </form>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false);
                resetForm();
                setEditingTrigger(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Target className="w-4 h-4 mr-2" />
              {editingTrigger ? 'Update' : 'Create'} Trigger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}