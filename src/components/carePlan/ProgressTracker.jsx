import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, CheckCircle2, Calendar, User } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function ProgressTracker({ carePlan, patientId }) {
  const queryClient = useQueryClient();
  const [showAddProgress, setShowAddProgress] = useState(false);
  const [newProgress, setNewProgress] = useState({
    measurement_value: "",
    progress_status: "on_track",
    notes: "",
    barriers: "",
    interventions_completed: [],
    next_steps: ""
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: progressHistory = [] } = useQuery({
    queryKey: ['carePlanProgress', carePlan.id],
    queryFn: () => base44.entities.CarePlanProgress.filter(
      { care_plan_id: carePlan.id },
      '-progress_date'
    )
  });

  const addProgressMutation = useMutation({
    mutationFn: (data) => base44.entities.CarePlanProgress.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlanProgress'] });
      queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
      
      // Update care plan progress percentage
      const progressPercentage = calculateProgressPercentage();
      base44.entities.CarePlan.update(carePlan.id, {
        current_measurement: newProgress.measurement_value,
        progress_percentage: progressPercentage
      });
      
      toast.success("Progress recorded");
      setShowAddProgress(false);
      setNewProgress({
        measurement_value: "",
        progress_status: "on_track",
        notes: "",
        barriers: "",
        interventions_completed: [],
        next_steps: ""
      });
    }
  });

  const calculateProgressPercentage = () => {
    if (newProgress.progress_status === "goal_met") return 100;
    if (newProgress.progress_status === "improving") return Math.min((carePlan.progress_percentage || 0) + 15, 90);
    if (newProgress.progress_status === "on_track") return Math.min((carePlan.progress_percentage || 0) + 10, 85);
    if (newProgress.progress_status === "declining") return Math.max((carePlan.progress_percentage || 0) - 10, 10);
    return carePlan.progress_percentage || 25;
  };

  const handleSubmit = () => {
    addProgressMutation.mutate({
      care_plan_id: carePlan.id,
      patient_id: patientId,
      progress_date: new Date().toISOString().split('T')[0],
      documented_by: currentUser?.email,
      provider_type: currentUser?.credential_type || 'RN',
      measurement_value: newProgress.measurement_value,
      progress_status: newProgress.progress_status,
      notes: newProgress.notes,
      barriers: newProgress.barriers ? newProgress.barriers.split('\n').filter(b => b.trim()) : [],
      interventions_completed: newProgress.interventions_completed,
      next_steps: newProgress.next_steps
    });
  };

  const getStatusIcon = (status) => {
    const icons = {
      improving: <TrendingUp className="w-4 h-4 text-green-600" />,
      on_track: <Minus className="w-4 h-4 text-blue-600" />,
      declining: <TrendingDown className="w-4 h-4 text-red-600" />,
      no_change: <Minus className="w-4 h-4 text-gray-600" />,
      goal_met: <CheckCircle2 className="w-4 h-4 text-green-600" />
    };
    return icons[status] || icons.on_track;
  };

  const getStatusColor = (status) => {
    const colors = {
      improving: "bg-green-100 text-green-800",
      on_track: "bg-blue-100 text-blue-800",
      declining: "bg-red-100 text-red-800",
      no_change: "bg-gray-100 text-gray-800",
      goal_met: "bg-green-100 text-green-800"
    };
    return colors[status] || colors.on_track;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Progress Tracking</CardTitle>
          <Button size="sm" onClick={() => setShowAddProgress(!showAddProgress)}>
            {showAddProgress ? "Cancel" : "Record Progress"}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-600">
            <span>Progress toward goal</span>
            <span className="font-semibold">{carePlan.progress_percentage || 0}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${carePlan.progress_percentage || 0}%` }}
            />
          </div>
        </div>

        {/* Add Progress Form */}
        {showAddProgress && (
          <Card className="bg-blue-50 dark:bg-blue-950">
            <CardContent className="p-3 space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1">Measurement Value</label>
                <Input
                  value={newProgress.measurement_value}
                  onChange={(e) => setNewProgress({...newProgress, measurement_value: e.target.value})}
                  placeholder="e.g., Pain level 2/10, Ambulating 50ft"
                  className="h-9 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium block mb-1">Progress Status</label>
                <Select
                  value={newProgress.progress_status}
                  onValueChange={(value) => setNewProgress({...newProgress, progress_status: value})}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="goal_met">Goal Met</SelectItem>
                    <SelectItem value="improving">Improving</SelectItem>
                    <SelectItem value="on_track">On Track</SelectItem>
                    <SelectItem value="no_change">No Change</SelectItem>
                    <SelectItem value="declining">Declining</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1">Progress Notes</label>
                <Textarea
                  value={newProgress.notes}
                  onChange={(e) => setNewProgress({...newProgress, notes: e.target.value})}
                  placeholder="Observations and assessment..."
                  className="text-sm h-20"
                />
              </div>

              <div>
                <label className="text-xs font-medium block mb-1">Barriers (one per line)</label>
                <Textarea
                  value={newProgress.barriers}
                  onChange={(e) => setNewProgress({...newProgress, barriers: e.target.value})}
                  placeholder="Any barriers to progress..."
                  className="text-sm h-16"
                />
              </div>

              <Button onClick={handleSubmit} className="w-full" size="sm">
                Save Progress
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Progress History */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-700">Recent Progress</h4>
          {progressHistory.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No progress recorded yet</p>
          ) : (
            progressHistory.slice(0, 5).map((progress) => (
              <Card key={progress.id} className="bg-gray-50 dark:bg-gray-900">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(progress.progress_status)}
                      <Badge className={`${getStatusColor(progress.progress_status)} text-xs`}>
                        {progress.progress_status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <span className="text-xs text-gray-500">
                      {format(new Date(progress.progress_date), 'MMM d, yyyy')}
                    </span>
                  </div>
                  
                  {progress.measurement_value && (
                    <p className="text-xs mb-1">
                      <strong>Measurement:</strong> {progress.measurement_value}
                    </p>
                  )}
                  
                  {progress.notes && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{progress.notes}</p>
                  )}
                  
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-2">
                    <User className="w-3 h-3" />
                    <span>{progress.provider_type}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}