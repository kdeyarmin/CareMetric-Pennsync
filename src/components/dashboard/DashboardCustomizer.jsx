import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Settings, GripVertical, Eye, EyeOff } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function DashboardCustomizer({ _currentUser, widgets, onUpdate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [localWidgets, setLocalWidgets] = useState(widgets);
  const queryClient = useQueryClient();

  const updatePreferencesMutation = useMutation({
    mutationFn: async (preferences) => {
      return await base44.auth.updateMe({ dashboard_preferences: preferences });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      onUpdate?.(localWidgets);
      setIsOpen(false);
    }
  });

  const toggleWidget = (widgetId) => {
    setLocalWidgets(prev =>
      prev.map(w => w.id === widgetId ? { ...w, visible: !w.visible } : w)
    );
  };

  const moveWidget = (widgetId, direction) => {
    setLocalWidgets(prev => {
      const index = prev.findIndex(w => w.id === widgetId);
      if (
        (direction === 'up' && index === 0) ||
        (direction === 'down' && index === prev.length - 1)
      ) {
        return prev;
      }

      const newWidgets = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      [newWidgets[index], newWidgets[targetIndex]] = [newWidgets[targetIndex], newWidgets[index]];
      
      // Update order values
      return newWidgets.map((w, idx) => ({ ...w, order: idx }));
    });
  };

  const handleSave = () => {
    updatePreferencesMutation.mutate({
      widgets: localWidgets.map(w => ({
        id: w.id,
        visible: w.visible,
        order: w.order
      }))
    });
  };

  const handleReset = () => {
    const defaultWidgets = widgets.map((w, idx) => ({
      ...w,
      visible: true,
      order: idx
    }));
    setLocalWidgets(defaultWidgets);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <Settings className="w-4 h-4" />
        Customize Dashboard
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customize Your Dashboard</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Show, hide, and reorder widgets to personalize your dashboard view.
            </p>

            <div className="space-y-2">
              {localWidgets.map((widget, index) => (
                <Card key={widget.id} className={!widget.visible ? 'opacity-50' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="flex flex-col gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => moveWidget(widget.id, 'up')}
                            disabled={index === 0}
                          >
                            <GripVertical className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => moveWidget(widget.id, 'down')}
                            disabled={index === localWidgets.length - 1}
                          >
                            <GripVertical className="w-4 h-4" />
                          </Button>
                        </div>
                        
                        <div className="flex-1">
                          <h4 className="font-semibold text-sm">{widget.title}</h4>
                          <p className="text-xs text-slate-600">{widget.description}</p>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleWidget(widget.id)}
                        className="gap-2"
                      >
                        {widget.visible ? (
                          <>
                            <Eye className="w-4 h-4" />
                            Visible
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-4 h-4" />
                            Hidden
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={handleReset}>
                Reset to Default
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updatePreferencesMutation.isPending}
                >
                  {updatePreferencesMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}