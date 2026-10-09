import { Checkbox } from '@/components/ui/checkbox';

export default function ResponsibilityAcknowledgment({ id, text, checked, disabled, onCheckedChange }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
      <Checkbox
        id={id}
        required
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-labelledby={`${id}-label`}
        className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer"
      />
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="min-h-11 flex-1 cursor-pointer text-sm leading-relaxed text-card-foreground"
      >
        {text}
      </label>
    </li>
  );
}