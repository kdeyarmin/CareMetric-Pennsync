import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { vehicleRequestId } from '@/functions/manageVehicleMaintenance';
import { SERVICE_TYPES, VEHICLE_STATUSES, parseCostCents, todayLocal } from './vehicleMaintenanceUtils';

export function FleetField({ label, children, ...props }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children
    ? <select id={id} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base" {...props}>{children}</select>
    : <Input id={id} {...props} />}</div>;
}
function FleetText({ label, ...props }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Textarea id={id} {...props} /></div>;
}
function FormMessage({ error }) {
  return error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null;
}
function FormActions({ busy, label, onCancel }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : label}</Button></div>;
}
function useFleetSave(onSave) {
  const inFlight = useRef(false);
  const requestId = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event, prepare) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const payload = prepare();
      requestId.current ||= vehicleRequestId();
      await onSave(payload, requestId.current);
    } catch (failure) {
      setError(failure?.message || 'Save was not confirmed. Refresh the log before retrying.');
    } finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, error, submit };
}

export function VehicleForm({ vehicle, staff = [], staffLoading, staffError, hasMoreStaff, loadMoreStaff, onSave, onCancel }) {
  const [values, setValues] = useState(() => ({
    unit_name: vehicle?.unit_name || '', year: vehicle?.year || new Date().getFullYear(),
    make: vehicle?.make || '', model: vehicle?.model || '', vin: vehicle?.vin || '',
    license_plate: vehicle?.license_plate || '', baseline_odometer: vehicle?.baseline_odometer ?? '',
    status: vehicle?.status || 'active', assigned_user_id: vehicle?.assigned_user_id || '', notes: vehicle?.notes || '',
  }));
  const { busy, error, submit } = useFleetSave(onSave);
  const update = key => event => setValues(previous => ({ ...previous, [key]: event.target.value }));
  return <form className="space-y-4" data-no-record-block onSubmit={event => submit(event, () => ({ ...values, year: Number(values.year), baseline_odometer: Number(values.baseline_odometer) }))}>
    <fieldset disabled={busy} className="space-y-4">
      <FleetField label="Vehicle / unit name" value={values.unit_name} onChange={update('unit_name')} required maxLength={100} placeholder="For example, Car 01" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FleetField label="Model year" type="number" min={1900} max={new Date().getFullYear() + 2} value={values.year} onChange={update('year')} required />
        <FleetField label="Make" value={values.make} onChange={update('make')} required maxLength={60} placeholder="Toyota" />
        <FleetField label="Model" value={values.model} onChange={update('model')} required maxLength={80} placeholder="Corolla" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FleetField label="License plate (optional)" value={values.license_plate} onChange={update('license_plate')} maxLength={30} />
        <FleetField label="VIN (optional)" value={values.vin} onChange={update('vin')} maxLength={17} autoCapitalize="characters" />
        <FleetField label="Starting odometer (miles)" type="number" min={0} max={2000000} step={1} value={values.baseline_odometer} onChange={update('baseline_odometer')} required />
        <FleetField label="Vehicle status" value={values.status} onChange={update('status')}>{Object.entries(VEHICLE_STATUSES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</FleetField>
      </div>
      <FleetField label="Assigned employee" value={values.assigned_user_id} onChange={update('assigned_user_id')}>
        <option value="">Unassigned / shared vehicle</option>
        {vehicle?.assigned_user_id && !staff.some(person => person.id === vehicle.assigned_user_id)
          && <option value={vehicle.assigned_user_id}>{vehicle.assigned_user_name || vehicle.assigned_user_email} (current assignment)</option>}
        {staff.map(person => <option value={person.id} key={person.id}>{person.name} — {person.email}</option>)}
      </FleetField>
      {staffLoading && <p role="status" className="text-sm text-slate-600">Loading active employees…</p>}
      {staffError && <p role="alert" className="text-sm text-red-700">Employee list could not be loaded. Existing assignments are not automatically removed.</p>}
      {hasMoreStaff && <Button type="button" variant="outline" onClick={loadMoreStaff} disabled={staffLoading}>Load more employees</Button>}
      <FleetText label="Vehicle notes (optional)" value={values.notes} onChange={update('notes')} maxLength={2000} placeholder="Vehicle information only. Do not enter patient details." />
      <p className="text-xs text-slate-600">Retiring a vehicle keeps its entire maintenance history. Reassigning it moves employee access to the new driver.</p>
    </fieldset>
    <FormMessage error={error} /><FormActions busy={busy} label={vehicle ? 'Save vehicle' : 'Add vehicle'} onCancel={onCancel} />
  </form>;
}

export function ServiceEntryForm({ vehicle, onSave, onCancel }) {
  const [values, setValues] = useState({ service_date: todayLocal(), odometer: '', service_type: 'oil_change', description: '', service_provider: '', cost: '', invoice_reference: '', next_due_date: '', next_due_odometer: '' });
  const { busy, error, submit } = useFleetSave(onSave);
  const update = key => event => setValues(previous => ({ ...previous, [key]: event.target.value }));
  function payload() {
    const { cost, ...entry } = values;
    return { ...entry, odometer: Number(values.odometer), cost_cents: parseCostCents(cost), next_due_odometer: values.next_due_odometer === '' ? undefined : Number(values.next_due_odometer) };
  }
  return <form className="space-y-4" data-no-record-block onSubmit={event => submit(event, payload)}>
    <p className="rounded-lg bg-slate-100 p-3 font-medium">{vehicle.unit_name}</p>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FleetField label="Service date" type="date" max={todayLocal()} value={values.service_date} onChange={update('service_date')} required />
        <FleetField label="Odometer at service (miles)" type="number" min={0} max={2000000} step={1} value={values.odometer} onChange={update('odometer')} required />
      </div>
      <FleetField label="Maintenance / repair type" value={values.service_type} onChange={update('service_type')}>{Object.entries(SERVICE_TYPES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</FleetField>
      <FleetText label="What was done?" value={values.description} onChange={update('description')} required maxLength={4000} placeholder="For example, oil and filter changed; tires rotated." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FleetField label="Shop / service provider (optional)" value={values.service_provider} onChange={update('service_provider')} maxLength={200} />
        <FleetField label="Total cost ($, optional)" inputMode="decimal" value={values.cost} onChange={update('cost')} placeholder="Leave blank if unknown" />
      </div>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Invoice reference and next service (optional)</summary><div className="mt-4 space-y-4">
        <FleetField label="Invoice / receipt reference" value={values.invoice_reference} onChange={update('invoice_reference')} maxLength={100} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FleetField label="Next service due date" type="date" min={values.service_date} value={values.next_due_date} onChange={update('next_due_date')} />
          <FleetField label="Next service due mileage" type="number" min={values.odometer || 0} max={2000000} step={1} value={values.next_due_odometer} onChange={update('next_due_odometer')} />
        </div>
      </div></details>
      <p className="text-xs text-slate-600">Your name and entry time are recorded automatically. Enter vehicle information only—no patient details. An administrator can review this entry.</p>
    </fieldset>
    <FormMessage error={error} /><FormActions busy={busy} label="Save service entry" onCancel={onCancel} />
  </form>;
}

export function ReviewEntryForm({ entry, onSave, onCancel }) {
  const [status, setStatus] = useState('reviewed');
  const [note, setNote] = useState('');
  const { busy, error, submit } = useFleetSave(onSave);
  return <form className="space-y-4" data-no-record-block onSubmit={event => submit(event, () => ({ status, note, expected_review_count: entry.review_history?.length || 0 }))}>
    <p className="rounded-lg bg-slate-100 p-3 text-sm whitespace-pre-wrap">{entry.description}</p>
    <fieldset disabled={busy} className="space-y-4">
      <FleetField label="Review result" value={status} onChange={event => setStatus(event.target.value)}><option value="reviewed">Reviewed</option><option value="needs_follow_up">Needs follow-up</option></FleetField>
      <FleetText label={status === 'needs_follow_up' ? 'Follow-up needed' : 'Review note (optional)'} value={note} onChange={event => setNote(event.target.value)} required={status === 'needs_follow_up'} maxLength={2000} />
      <p className="text-xs text-slate-600">The original entry is preserved. This review is added to its review history.</p>
    </fieldset>
    <FormMessage error={error} /><FormActions busy={busy} label="Save review" onCancel={onCancel} />
  </form>;
}
