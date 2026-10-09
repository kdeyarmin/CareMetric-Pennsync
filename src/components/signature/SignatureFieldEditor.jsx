import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PLACEMENT_POSITIONS, defaultPlacement } from '@/components/signature/signatureFieldPlacement';

/**
 * Choose where each signer's signature is drawn on the document. Leaving the
 * list empty is allowed: every signature still appears on the certificate page
 * that is sealed with the document.
 */
export default function SignatureFieldEditor({ signers, placements, onChange, disabled = false }) {
  const usable = signers.filter((signer) => signer.key);
  const update = (index, patch) => onChange(placements.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const remove = (index) => onChange(placements.filter((_, at) => at !== index));
  const add = () => {
    const next = usable.find((signer) => !placements.some((entry) => entry.signerKey === signer.key)) || usable[0];
    if (next) onChange([...placements, defaultPlacement(next.key, placements.length)]);
  };

  return (
    <div className="space-y-3">
      {placements.length === 0 && (
        <p className="text-sm text-slate-600">
          No signature boxes placed. Signatures will appear on the certificate page attached to the signed copy.
        </p>
      )}
      {placements.map((placement, index) => (
        <div key={`${placement.signerKey}-${index}`} className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[1.4fr_0.6fr_1fr_auto_auto] sm:items-end">
          <div>
            <Label className="text-xs">Signer</Label>
            <Select value={placement.signerKey} onValueChange={(value) => update(index, { signerKey: value })} disabled={disabled}>
              <SelectTrigger aria-label="Signer"><SelectValue placeholder="Signer" /></SelectTrigger>
              <SelectContent>
                {usable.map((signer) => <SelectItem key={signer.key} value={signer.key}>{signer.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`field-page-${index}`} className="text-xs">Page</Label>
            <Input
              id={`field-page-${index}`}
              type="number"
              min={1}
              max={500}
              value={placement.page}
              disabled={disabled}
              onChange={(event) => update(index, { page: Math.max(1, Math.min(500, Number(event.target.value) || 1)) })}
            />
          </div>
          <div>
            <Label className="text-xs">Position</Label>
            <Select value={placement.position} onValueChange={(value) => update(index, { position: value })} disabled={disabled}>
              <SelectTrigger aria-label="Position"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLACEMENT_POSITIONS.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id={`field-date-${index}`}
              checked={placement.withDate}
              disabled={disabled}
              onCheckedChange={(value) => update(index, { withDate: value === true })}
            />
            <Label htmlFor={`field-date-${index}`} className="text-xs">Date</Label>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} disabled={disabled} aria-label="Remove signature box">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled || usable.length === 0} className="gap-2">
        <Plus className="h-4 w-4" aria-hidden="true" /> Add signature box
      </Button>
    </div>
  );
}
