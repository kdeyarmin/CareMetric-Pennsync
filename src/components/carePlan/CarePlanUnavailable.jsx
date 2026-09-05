import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const CARE_PLAN_UNAVAILABLE_MESSAGE =
  'Care-plan lists, creation, editing, deletion, automatic rules, AI suggestions, and patient-chart care-plan history are unavailable until purpose-bound tenant brokers and an audited legacy-row migration are hosted and verified. No patient or care-plan record was loaded. This unavailable state must not be interpreted as an empty care plan, a completed goal, or zero activity.';

export default function CarePlanUnavailable({
  title = 'Care plans unavailable',
  message = CARE_PLAN_UNAVAILABLE_MESSAGE,
}) {
  return (
    <Alert
      className="border-amber-300 bg-amber-50 text-amber-950"
      data-care-plan-unavailable="true"
    >
      <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
