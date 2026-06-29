import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";

export default function OnboardingChecklist({ user, credentials = [] }) {
  const steps = useMemo(() => {
    const userCreds = credentials.filter(c => c.user_id === user?.email);
    
    return [
      {
        label: 'Complete Profile',
        completed: user?.phone && user?.care_scope && user?.credential_type,
        link: '/UserSettings',
        action: 'Update Profile'
      },
      {
        label: 'Upload Nursing License',
        completed: userCreds.some(c => c.item_type === 'license'),
        link: '/PersonnelFile',
        action: 'Upload License'
      },
      {
        label: 'Upload Professional Liability Insurance',
        completed: userCreds.some(c => c.item_type === 'insurance'),
        link: '/PersonnelFile',
        action: 'Upload Insurance'
      },
      // NOTE: an "Onboarding Training" step was here hardcoded completed:false, so
      // a fully-onboarded user maxed out at 3/4 (75%) and the card — which dismisses
      // only when completedCount === steps.length — never went away. Removed until
      // training completion can actually be queried (TrainingAssignment), so the
      // checklist reflects only steps it can really measure and can reach 100%.
    ];
  }, [user, credentials]);

  const completedCount = steps.filter(s => s.completed).length;
  const progressPercent = (completedCount / steps.length * 100).toFixed(0);

  if (completedCount === steps.length) {
    return null; // Don't show if everything is complete
  }

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Complete Your Onboarding</CardTitle>
          <span className="text-sm font-semibold text-indigo-600">{completedCount}/{steps.length}</span>
        </div>
        <Progress value={parseInt(progressPercent)} className="mt-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg">
              <div className="flex items-center gap-3">
                {step.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                ) : (
                  <Circle className="h-5 w-5 text-slate-300 flex-shrink-0" />
                )}
                <span className={`text-sm font-medium ${step.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                  {step.label}
                </span>
              </div>
              {!step.completed && (
                <Link to={step.link}>
                  <Button size="sm" variant="outline" className="gap-2">
                    {step.action} <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}