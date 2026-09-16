import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Plus, Wrench, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { manageVehicleMaintenance } from '@/functions/manageVehicleMaintenance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { FleetField, VehicleForm, ServiceEntryForm, ReviewEntryForm } from '@/components/vehicles/VehicleMaintenanceForms';
import { SERVICE_TYPES, VEHICLE_STATUSES, REVIEW_STATUSES, money, serviceDate, vehicleTitle, summarizeEntries } from '@/components/vehicles/vehicleMaintenanceUtils';

const nextPage = page => page.next_offset ?? undefined;
function QueryError({ error, retry }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"><p>{error?.message || 'Records could not be loaded.'}</p><Button className="mt-2" variant="outline" onClick={retry}>Try again</Button></div>;
}
function latestRows(pages, key) {
  // Offset paging may overlap when a record is added while reading history.
  // Deduplicate by immutable id; never double-count a repeated record.
  return [...new Map((pages || []).flatMap(page => page[key] || []).map(row => [row.id, row])).values()];
}

export default function VehicleMaintenance() {
  const { user, tenantContext } = useAuth();
  const tenantId = tenantContext?.agency_id || tenantContext?.agency?.id || '';
  const [chosen, setChosen] = useState('');
  const context = useQuery({
    queryKey: ['fleetContext', user?.id, tenantId],
    queryFn: () => manageVehicleMaintenance('context'), enabled: !!user?.id, retry: false,
  });
  // A non-owner changes agency through the app's tenant selector, never
  // inside a data screen while the browser remains bound to another tenant.
  const agencies = (context.data?.agencies || []).filter(agency =>
    tenantContext?.is_platform_owner === true || agency.id === tenantId);
  const selected = agencies.find(agency => agency.id === chosen)
    || agencies.find(agency => agency.id === tenantId) || (agencies.length === 1 ? agencies[0] : null);
  return <PageContainer>
    <PageHeader icon={Car} eyebrow="Tools" title="Vehicle Maintenance" description="One service history for every company vehicle. Employees log completed work; administrators manage vehicles and review entries." favoritePage="VehicleMaintenance" />
    <section className="space-y-5 session-record-block" data-no-record-block aria-label="Company vehicle records">
      {context.isPending && <p role="status">Loading vehicle access…</p>}
      {context.isError && <QueryError error={context.error} retry={() => context.refetch()} />}
      {!context.isPending && !context.isError && !agencies.length && <div className="rounded-xl border bg-white p-6"><h2 className="font-semibold">Agency access is needed</h2><p className="mt-2 text-sm text-slate-600">An administrator must link your account to an active agency before company vehicles can be shown.</p></div>}
      {agencies.length > 1 && <div className="max-w-md"><FleetField label="Agency" value={selected?.id || ''} onChange={event => setChosen(event.target.value)}><option value="">Choose an agency</option>{agencies.map(agency => <option key={agency.id} value={agency.id}>{agency.name}</option>)}</FleetField></div>}
      {selected && <FleetWorkspace key={`${user?.id}:${tenantId}:${selected.id}`} agency={selected} userId={user?.id} />}
    </section>
  </PageContainer>;
}

function FleetWorkspace({ agency, userId }) {
  const client = useQueryClient();
  const [includeRetired, setIncludeRetired] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [vehicleDialog, setVehicleDialog] = useState(null);
  const [addService, setAddService] = useState(false);
  const [reviewEntry, setReviewEntry] = useState(null);
  const vehicles = useInfiniteQuery({
    queryKey: ['fleetVehicles', userId, agency.id, includeRetired], initialPageParam: 0,
    queryFn: ({ pageParam }) => manageVehicleMaintenance('vehicles', { agency_id: agency.id, offset: pageParam, include_retired: includeRetired }),
    getNextPageParam: nextPage, retry: false,
  });
  const canManage = vehicles.data?.pages[0]?.can_manage === true;
  const allVehicles = useMemo(() => latestRows(vehicles.data?.pages, 'vehicles'), [vehicles.data]);
  const matching = allVehicles.filter(item => [item.unit_name, item.make, item.model, item.license_plate, item.assigned_user_name].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const selected = allVehicles.find(item => item.id === selectedId) || matching[0];
  const history = useInfiniteQuery({
    queryKey: ['fleetHistory', userId, agency.id, selected?.id], initialPageParam: 0,
    queryFn: ({ pageParam }) => manageVehicleMaintenance('history', { agency_id: agency.id, vehicle_id: selected.id, offset: pageParam }),
    enabled: !!selected, getNextPageParam: nextPage, retry: false,
  });
  const entries = useMemo(() => latestRows(history.data?.pages, 'entries'), [history.data]);
  const summary = summarizeEntries(entries, selected?.baseline_odometer);
  const staff = useInfiniteQuery({
    queryKey: ['fleetStaff', userId, agency.id], initialPageParam: 0,
    queryFn: ({ pageParam }) => manageVehicleMaintenance('staff', { agency_id: agency.id, offset: pageParam }),
    enabled: canManage && !!vehicleDialog, getNextPageParam: nextPage, retry: false,
  });
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['fleetVehicles', userId, agency.id] }),
      client.invalidateQueries({ queryKey: ['fleetHistory', userId, agency.id] }),
    ]);
  }
  async function saveVehicle(values, requestId) {
    const editing = vehicleDialog?.vehicle;
    const result = await manageVehicleMaintenance(editing ? 'update_vehicle' : 'create_vehicle', {
      agency_id: agency.id, vehicle: values,
      ...(editing ? { vehicle_id: editing.id, expected_version: editing.version } : { request_id: requestId }),
    });
    setVehicleDialog(null);
    setSelectedId(result.vehicle.id);
    await refresh();
  }
  async function saveEntry(entry, requestId) {
    await manageVehicleMaintenance('add_entry', { agency_id: agency.id, vehicle_id: selected.id, request_id: requestId, entry });
    setAddService(false);
    await refresh();
  }
  async function saveReview(values) {
    await manageVehicleMaintenance('review_entry', { agency_id: agency.id, vehicle_id: selected.id, entry_id: reviewEntry.id, ...values });
    setReviewEntry(null);
    await refresh();
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{canManage ? 'Company fleet' : 'My assigned vehicles'}</h2><p className="text-sm text-slate-600">{agency.name}</p></div>
      <div className="flex flex-wrap items-center gap-3">
        {canManage && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeRetired} onChange={event => setIncludeRetired(event.target.checked)} />Include retired vehicles</label>}
        <Button variant="outline" onClick={refresh} disabled={vehicles.isFetching || history.isFetching}>Refresh records</Button>
        {canManage && <Button onClick={() => setVehicleDialog({ vehicle: null })}><Plus className="mr-2 h-4 w-4" />Add vehicle</Button>}
      </div>
    </div>
    {vehicles.isError && <QueryError error={vehicles.error} retry={() => vehicles.refetch()} />}
    {vehicles.isPending && <p role="status">Loading vehicles…</p>}
    {!vehicles.isPending && !vehicles.isError && !allVehicles.length && <div className="rounded-xl border bg-white p-8 text-center"><Car className="mx-auto mb-3 h-10 w-10 text-slate-400" /><h3 className="font-semibold">{canManage ? 'Add your first company vehicle' : 'No vehicle is assigned to you yet'}</h3><p className="mt-2 text-sm text-slate-600">{canManage ? 'Create a vehicle record and select its employee. Maintenance stays with the car when drivers change.' : 'Ask your administrator to assign your company vehicle. They can also enter service records for shared vehicles.'}</p></div>}
    {!!allVehicles.length && <div className="grid items-start gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="space-y-3" aria-label="Choose a vehicle">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input className="pl-9" aria-label="Search loaded vehicles" placeholder="Car, plate, or employee" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <p className="text-xs text-slate-500">{allVehicles.length} vehicles loaded{vehicles.hasNextPage ? ' — more available' : ''}</p>
        <div className="space-y-2">{matching.map(item => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === item.id ? 'border-navy-600 bg-navy-50 ring-1 ring-navy-600' : 'bg-white hover:bg-slate-50'}`}>
          <span className="block font-semibold">{item.unit_name}</span><span className="block text-sm text-slate-600">{vehicleTitle(item)}</span><span className="mt-1 block text-xs text-slate-600">{item.license_plate || 'No plate entered'} · {item.assigned_user_name || 'Unassigned'}</span>
          {item.status !== 'active' && <span className="mt-2 block text-xs font-semibold text-amber-700">{VEHICLE_STATUSES[item.status]}</span>}
        </button>)}</div>
        {!matching.length && <p className="text-sm text-slate-600">No matching loaded vehicles.</p>}
        {vehicles.hasNextPage && <Button variant="outline" className="w-full" disabled={vehicles.isFetchingNextPage} onClick={() => vehicles.fetchNextPage()}>{vehicles.isFetchingNextPage ? 'Loading…' : 'Load more vehicles'}</Button>}
      </aside>
      {selected && <div className="min-w-0 space-y-5">
        <div className="rounded-xl border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-semibold">{selected.unit_name}</h2><p className="text-slate-600">{vehicleTitle(selected)}</p></div><Badge variant={selected.status === 'active' ? 'success' : 'warning'}>{VEHICLE_STATUSES[selected.status]}</Badge></div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Assigned employee</dt><dd className="font-medium">{selected.assigned_user_name || 'Unassigned / shared vehicle'}</dd></div><div><dt className="text-slate-500">License plate</dt><dd>{selected.license_plate || 'Not entered'}</dd></div>{selected.vin && <div><dt className="text-slate-500">VIN</dt><dd className="break-all font-mono">{selected.vin}</dd></div>}<div><dt className="text-slate-500">Highest recorded mileage{history.hasNextPage ? ' (loaded records)' : ''}</dt><dd>{summary.odometer.toLocaleString()} miles</dd></div></dl>
          {selected.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{selected.notes}</p>}
          {selected.status === 'out_of_service' && <p role="note" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This vehicle is marked out of service. Follow your company’s instructions before driving it.</p>}
          <div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => setAddService(true)} disabled={selected.status === 'retired'}><Wrench className="mr-2 h-4 w-4" />Log maintenance or repair</Button>{canManage && <Button variant="outline" onClick={() => setVehicleDialog({ vehicle: selected })}>Edit vehicle / assignment</Button>}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Loaded service history summary">
          <SummaryCard label={history.hasNextPage ? 'Loaded service entries' : 'Service entries'} value={String(summary.entries)} />
          <SummaryCard label={history.hasNextPage ? 'Known cost in loaded entries' : 'Known service cost'} value={money(summary.knownCostCents)} detail={summary.missingCosts ? `${summary.missingCosts} ${summary.missingCosts === 1 ? 'entry has' : 'entries have'} no cost entered` : 'Based on recorded costs'} />
          <SummaryCard label={history.hasNextPage ? 'Loaded entries needing review' : 'Entries needing review'} value={String(summary.awaitingReview)} />
        </div>
        <section aria-label="Vehicle service history" className="space-y-3">
          <div><h3 className="text-lg font-semibold">Maintenance & repair history</h3><p className="text-xs text-slate-600">Newest service dates first. Original entries are retained; administrator review notes are added to their history.</p></div>
          {history.isPending && <p role="status">Loading service history…</p>}
          {history.isError && <QueryError error={history.error} retry={() => history.refetch()} />}
          {!history.isPending && !history.isError && !entries.length && <p className="rounded-xl border bg-white p-6 text-slate-600">No service entries yet. Use “Log maintenance or repair” after work is completed.</p>}
          {entries.map(entry => <article key={entry.id} className="rounded-xl border bg-white p-4 sm:p-5">
            <div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-semibold">{SERVICE_TYPES[entry.service_type] || 'Service'}</h4><p className="text-sm text-slate-600">{serviceDate(entry.service_date)} · {entry.odometer?.toLocaleString()} miles</p></div><Badge variant={entry.review_status === 'reviewed' ? 'success' : entry.review_status === 'needs_follow_up' ? 'warning' : 'secondary'}>{REVIEW_STATUSES[entry.review_status] || 'Not yet reviewed'}</Badge></div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{entry.description}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span><strong>Cost:</strong> {money(entry.cost_cents)}</span>{entry.service_provider && <span><strong>Provider:</strong> {entry.service_provider}</span>}{entry.invoice_reference && <span><strong>Reference:</strong> {entry.invoice_reference}</span>}</div>
            {(entry.next_due_date || entry.next_due_odometer != null) && <p className="mt-2 text-sm text-navy-800">Next service: {[entry.next_due_date && serviceDate(entry.next_due_date), entry.next_due_odometer != null && `${entry.next_due_odometer.toLocaleString()} miles`].filter(Boolean).join(' or ')}</p>}
            <p className="mt-3 text-xs text-slate-500">Logged by {entry.submitted_by_name || entry.submitted_by_email} · {entry.entry_source === 'admin' ? 'Administrator entry' : 'Employee entry'} · {entry.recorded_at ? new Date(entry.recorded_at).toLocaleString() : ''}</p>
            {!!entry.review_history?.length && <details className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-medium">Review history ({entry.review_history.length})</summary><ol className="mt-2 space-y-3">{entry.review_history.map((review, index) => <li key={`${review.reviewed_at}:${index}`}><span className="font-medium">{REVIEW_STATUSES[review.status]}</span> · {review.reviewer_name} · {new Date(review.reviewed_at).toLocaleString()}{review.note && <p className="whitespace-pre-wrap text-slate-600">{review.note}</p>}</li>)}</ol></details>}
            {canManage && <Button variant="outline" className="mt-3" onClick={() => setReviewEntry(entry)}>{entry.review_status === 'needs_follow_up' ? <AlertTriangle className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Review entry</Button>}
          </article>)}
          {history.hasNextPage && <div className="rounded-xl border border-dashed p-4 text-center"><p className="mb-3 text-sm text-slate-600">Older entries are available. Totals above cover only the records loaded so far.</p><Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? 'Loading…' : 'Load older entries'}</Button></div>}
        </section>
      </div>}
    </div>}
    <Dialog open={!!vehicleDialog} onOpenChange={open => !open && setVehicleDialog(null)}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" data-no-record-block><DialogHeader><DialogTitle>{vehicleDialog?.vehicle ? 'Edit company vehicle' : 'Add company vehicle'}</DialogTitle><DialogDescription>Vehicle details and the employee who may log service.</DialogDescription></DialogHeader>{vehicleDialog && <VehicleForm vehicle={vehicleDialog.vehicle} staff={latestRows(staff.data?.pages, 'staff')} staffLoading={staff.isFetching} staffError={staff.isError} hasMoreStaff={staff.hasNextPage} loadMoreStaff={() => staff.fetchNextPage()} onSave={saveVehicle} onCancel={() => setVehicleDialog(null)} />}</DialogContent></Dialog>
    <Dialog open={addService} onOpenChange={setAddService}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" data-no-record-block><DialogHeader><DialogTitle>Log maintenance or repair</DialogTitle><DialogDescription>Enter the completed service. Your administrator can review it.</DialogDescription></DialogHeader>{addService && selected && <ServiceEntryForm vehicle={selected} onSave={saveEntry} onCancel={() => setAddService(false)} />}</DialogContent></Dialog>
    <Dialog open={!!reviewEntry} onOpenChange={open => !open && setReviewEntry(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto" data-no-record-block><DialogHeader><DialogTitle>Review service entry</DialogTitle><DialogDescription>Add your review without replacing the original service record.</DialogDescription></DialogHeader>{reviewEntry && <ReviewEntryForm entry={reviewEntry} onSave={saveReview} onCancel={() => setReviewEntry(null)} />}</DialogContent></Dialog>
  </>;
}
function SummaryCard({ label, value, detail }) {
  return <div className="rounded-xl border bg-white p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>;
}
