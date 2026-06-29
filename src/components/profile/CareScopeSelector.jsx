import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Home, Users, CheckCircle2 } from "lucide-react";

const OPTIONS = [
  {
    value: "home_health",
    label: "Home Health Nurse",
    description: "Medicare Part A/B skilled nursing, OASIS assessments, 60-day certification periods, homebound status documentation.",
    icon: Home,
    color: "border-blue-400 bg-blue-50",
    selected: "bg-blue-600 border-blue-600 text-white",
    iconColor: "text-blue-600",
  },
  {
    value: "hospice",
    label: "Hospice Nurse",
    description: "Comfort-focused end-of-life care, IDG/IDT documentation, comfort measures, symptom management, bereavement.",
    icon: Heart,
    color: "border-navy-400 bg-navy-50",
    selected: "bg-navy-600 border-navy-600 text-white",
    iconColor: "text-navy-600",
  },
  {
    value: "both",
    label: "Both Services",
    description: "I provide care for both home health and hospice patients.",
    icon: Users,
    color: "border-indigo-400 bg-indigo-50",
    selected: "bg-indigo-600 border-indigo-600 text-white",
    iconColor: "text-indigo-600",
  },
];

export default function CareScopeSelector({ currentUser, onSaved }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(currentUser?.care_scope || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await base44.auth.updateMe({ care_scope: selected });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      if (onSaved) onSaved(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-2 border-indigo-200 shadow-xl">
      <CardContent className="p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Heart className="w-7 h-7 text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">What type of nurse are you?</h2>
          <p className="text-sm text-slate-500 mt-1">
            This personalizes your documentation, compliance checks, and dashboard to your service line.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selected === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all active:scale-98 ${
                  isSelected ? opt.selected : `${opt.color} hover:shadow-md`
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? "bg-white/20" : "bg-white"} flex-shrink-0`}>
                    <Icon className={`w-4 h-4 ${isSelected ? "text-white" : opt.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm ${isSelected ? "text-white" : "text-slate-900"}`}>{opt.label}</p>
                    <p className={`text-xs mt-0.5 ${isSelected ? "text-white/80" : "text-slate-500"}`}>{opt.description}</p>
                  </div>
                  {isSelected && <CheckCircle2 className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />}
                </div>
              </button>
            );
          })}
        </div>

        <Button
          onClick={handleSave}
          disabled={!selected || saving}
          className="w-full bg-indigo-600 hover:bg-indigo-700 h-12 font-semibold"
        >
          {saving ? "Saving…" : "Save & Continue"}
        </Button>
      </CardContent>
    </Card>
  );
}