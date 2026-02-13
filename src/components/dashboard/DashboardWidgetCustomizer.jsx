import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Settings, GripVertical, X, Save } from "lucide-react";

const ALL_WIDGETS = [
  { id: "stats", label: "Quick Stats", defaultEnabled: true },
  { id: "timeSavings", label: "Time Savings", defaultEnabled: true },
  { id: "secondaryStats", label: "Care Plans & Alerts", defaultEnabled: true },
  { id: "quickActions", label: "Quick Actions", defaultEnabled: true },
  { id: "highRisk", label: "High Risk Patients", defaultEnabled: true },
  { id: "tasks", label: "Recent Tasks", defaultEnabled: true },
  { id: "compliance", label: "Compliance Alerts", defaultEnabled: true },
  { id: "patientAlerts", label: "Patient Alerts", defaultEnabled: true },
  { id: "announcements", label: "Announcements", defaultEnabled: true },
];

const STORAGE_KEY = "caremetric_dashboard_widgets";

function getDefaultWidgets() {
  return ALL_WIDGETS.map((w, i) => ({ id: w.id, enabled: w.defaultEnabled, order: i }));
}

export function useDashboardWidgets() {
  const [widgets, setWidgets] = React.useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return getDefaultWidgets();
  });

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }, [widgets]);

  const isVisible = (id) => {
    const w = widgets.find(w => w.id === id);
    return w ? w.enabled : true;
  };

  const getOrder = () => [...widgets].sort((a, b) => a.order - b.order).map(w => w.id);

  return { widgets, setWidgets, isVisible, getOrder };
}

export default function DashboardWidgetCustomizer({ widgets, setWidgets, onClose }) {
  const [localWidgets, setLocalWidgets] = React.useState(widgets);

  const toggleWidget = (id) => {
    setLocalWidgets(prev =>
      prev.map(w => w.id === id ? { ...w, enabled: !w.enabled } : w)
    );
  };

  const moveUp = (id) => {
    setLocalWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id);
      if (idx <= 0) return prev;
      const copy = [...prev];
      [copy[idx - 1].order, copy[idx].order] = [copy[idx].order, copy[idx - 1].order];
      [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
      return copy;
    });
  };

  const moveDown = (id) => {
    setLocalWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id);
      if (idx >= prev.length - 1) return prev;
      const copy = [...prev];
      [copy[idx + 1].order, copy[idx].order] = [copy[idx].order, copy[idx + 1].order];
      [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
      return copy;
    });
  };

  const handleSave = () => {
    setWidgets(localWidgets);
    onClose();
  };

  const sorted = [...localWidgets].sort((a, b) => a.order - b.order);
  const labelMap = Object.fromEntries(ALL_WIDGETS.map(w => [w.id, w.label]));

  return (
    <Card className="border-blue-300 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Customize Dashboard
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map((w, idx) => (
          <div key={w.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(w.id)} disabled={idx === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs">▲</button>
              <button onClick={() => moveDown(w.id)} disabled={idx === sorted.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs">▼</button>
            </div>
            <GripVertical className="h-4 w-4 text-slate-300" />
            <span className="flex-1 text-sm">{labelMap[w.id] || w.id}</span>
            <Switch checked={w.enabled} onCheckedChange={() => toggleWidget(w.id)} />
          </div>
        ))}
        <Button onClick={handleSave} className="w-full mt-3" size="sm">
          <Save className="h-4 w-4 mr-2" /> Save Layout
        </Button>
      </CardContent>
    </Card>
  );
}