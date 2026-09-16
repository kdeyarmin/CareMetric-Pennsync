import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import VehicleMaintenance from './VehicleMaintenance';
import { expectNoAxeViolations } from '@/test/axeHelpers';

const { request, current } = vi.hoisted(() => ({ request: vi.fn(), current: { canManage: false, vehicles: [], entries: [], requestIds: 0 } }));
vi.mock('@/functions/manageVehicleMaintenance', () => ({ manageVehicleMaintenance: request, vehicleRequestId: () => current.requestIds++ ? `fleet-test-request-${current.requestIds}` : 'fleet-test-request' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1' }, tenantContext: { agency_id: 'agency-a' } }) }));
vi.mock('@/components/ui/PageHeader', () => ({ default: ({ title, description }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock('@/components/ui/PageContainer', () => ({ default: ({ children }) => <main>{children}</main> }));
const car = { id: 'car-1', unit_name: 'Car 01', year: 2024, make: 'Toyota', model: 'Corolla', assigned_user_id: 'staff-1', assigned_user_name: 'Test Driver', baseline_odometer: 10000, status: 'active', version: 1 };
const service = { id: 'entry-1', service_date: '2026-01-15', odometer: 11000, service_type: 'oil_change', description: 'Synthetic oil service', cost_cents: 8995, review_status: 'pending', review_history: [], submitted_by_name: 'Test Driver', entry_source: 'employee', recorded_at: '2026-01-15T12:00:00Z' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<MemoryRouter><QueryClientProvider client={client}><VehicleMaintenance /></QueryClientProvider></MemoryRouter>), client };
}
beforeEach(() => {
  current.requestIds = 0; current.canManage = false; current.vehicles = [car]; current.entries = [service];
  request.mockReset();
  request.mockImplementation(async (action) => {
    if (action === 'context') return { success: true, agencies: [{ id: 'agency-a', name: 'Test Agency', can_manage: current.canManage }] };
    if (action === 'vehicles') return { success: true, can_manage: current.canManage, vehicles: current.vehicles, next_offset: null };
    if (action === 'history') return { success: true, vehicle: car, entries: current.entries, next_offset: null };
    if (action === 'staff') return { success: true, staff: [{ id: 'staff-1', name: 'Test Driver', email: 'driver@example.test' }], next_offset: null };
    return { success: true, vehicle: car, entry: service };
  });
});

describe('vehicle maintenance employee and admin flows', () => {
  it('shows assigned vehicle and service history without admin controls', async () => {
    mount();
    expect(await screen.findByText('Synthetic oil service')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review entry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log maintenance or repair/ })).toBeEnabled();
  });
  it('employee logs completed work with exact cents, without supplying author or review fields', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Log maintenance or repair/ }));
    await userEvent.type(screen.getByLabelText('Odometer at service (miles)'), '12000');
    await userEvent.type(screen.getByLabelText('What was done?'), 'Changed oil and filter');
    await userEvent.type(screen.getByLabelText('Total cost ($, optional)'), '89.95');
    await userEvent.click(screen.getByRole('button', { name: 'Save service entry' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('add_entry', expect.objectContaining({ agency_id: 'agency-a', vehicle_id: 'car-1', request_id: 'fleet-test-request', entry: expect.objectContaining({ cost_cents: 8995, odometer: 12000, description: 'Changed oil and filter' }) })));
    const sent = request.mock.calls.find(([action]) => action === 'add_entry')[1].entry;
    expect(sent).not.toHaveProperty('submitted_by_user_id'); expect(sent).not.toHaveProperty('review_status');
  });
  it('admin can add a vehicle and select its employee from the active roster', async () => {
    current.canManage = true;
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add vehicle' }));
    await userEvent.type(screen.getByLabelText('Vehicle / unit name'), 'Car 02');
    await userEvent.type(screen.getByLabelText('Make'), 'Ford');
    await userEvent.type(screen.getByLabelText('Model'), 'Escape');
    await userEvent.type(screen.getByLabelText('Starting odometer (miles)'), '22000');
    await userEvent.selectOptions(screen.getByLabelText('Assigned employee'), 'staff-1');
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add vehicle' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('create_vehicle', expect.objectContaining({ vehicle: expect.objectContaining({ unit_name: 'Car 02', assigned_user_id: 'staff-1', baseline_odometer: 22000 }) })));
  });
  it('admin can review a service without rewriting the original entry', async () => {
    current.canManage = true;
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Review entry' }));
    await userEvent.type(screen.getByLabelText('Review note (optional)'), 'Invoice checked');
    await userEvent.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('review_entry', { agency_id: 'agency-a', vehicle_id: 'car-1', entry_id: 'entry-1', request_id: 'fleet-test-request', expected_review_count: 0, status: 'reviewed', note: 'Invoice checked' }));
  });
  it('failed save retains the form and the same retry request id', async () => {
    const original = request.getMockImplementation();
    request.mockImplementation(async (action, payload) => {
      if (action === 'add_entry') throw new Error('Save not confirmed. Refresh the log.');
      return original(action, payload);
    });
    mount(); await userEvent.click(await screen.findByRole('button', { name: /Log maintenance or repair/ }));
    await userEvent.type(screen.getByLabelText('Odometer at service (miles)'), '12345');
    await userEvent.type(screen.getByLabelText('What was done?'), 'Kept details');
    await userEvent.click(screen.getByRole('button', { name: 'Save service entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save not confirmed');
    expect(screen.getByLabelText('What was done?')).toHaveValue('Kept details');
    await userEvent.click(screen.getByRole('button', { name: 'Save service entry' }));
    const calls = request.mock.calls.filter(([action]) => action === 'add_entry');
    expect(calls).toHaveLength(2); expect(calls[0][1].request_id).toBe(calls[1][1].request_id);
  });
  it('does not silently treat a backend failure as an empty fleet', async () => {
    const original = request.getMockImplementation();
    request.mockImplementation(async (action, payload) => { if (action === 'vehicles') throw new Error('Vehicle service unavailable'); return original(action, payload); });
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Vehicle service unavailable');
    expect(screen.queryByText('No vehicle is assigned to you yet')).not.toBeInTheDocument();
  });
  it('hides previously loaded history and disables entry after access fails on refresh', async () => {
    mount();
    await screen.findByText('Synthetic oil service');
    const original = request.getMockImplementation();
    request.mockImplementation(async (action, payload) => {
      if (action === 'history') throw new Error('This vehicle is not assigned to you.');
      return original(action, payload);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not assigned');
    expect(screen.queryByText('Synthetic oil service')).not.toBeInTheDocument();
    expect(screen.queryByText('Known service cost')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log maintenance or repair/ })).toBeDisabled();
  });
  it('hides cached vehicle details if fleet access is rejected on refresh', async () => {
    mount();
    await screen.findByText('Synthetic oil service');
    const original = request.getMockImplementation();
    request.mockImplementation(async (action, payload) => {
      if (action === 'vehicles') throw new Error('No active membership for this agency.');
      return original(action, payload);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No active membership');
    expect(screen.queryByText('Synthetic oil service')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log maintenance or repair/ })).not.toBeInTheDocument();
  });
  it('shows a useful unassigned-employee state', async () => {
    current.vehicles = []; mount(); expect(await screen.findByText('No vehicle is assigned to you yet')).toBeInTheDocument();
  });
  it('retired vehicles retain their history and cannot accept new service until restored', async () => {
    current.canManage = true; current.vehicles = [{ ...car, status: 'retired' }]; mount();
    expect(await screen.findByText('Synthetic oil service')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log maintenance or repair/ })).toBeDisabled();
  });
  it('preserves unknown costs instead of displaying them as zero', async () => {
    current.entries = [{ ...service, cost_cents: undefined }]; mount();
    expect(await screen.findByText('1 entry has no cost entered')).toBeInTheDocument();
    expect(screen.getAllByText('Not entered').length).toBeGreaterThan(0);
  });
  it('loads older pages and labels partial totals before all pages are loaded', async () => {
    const original = request.getMockImplementation();
    request.mockImplementation(async (action, payload) => action === 'history' ? { success: true, entries: payload.cursor ? [{ ...service, id: 'older', description: 'Older repair' }] : [service], next_cursor: payload.cursor ? null : 'v1:agency-a:car-1:2026-01-15:entry-1' } : original(action, payload));
    mount(); expect(await screen.findByText('Known cost in loaded entries')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText('Older repair')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older entries' })).not.toBeInTheDocument();
  });
  it('blocks the vehicle section and portal forms from session replay selectors', async () => {
    mount(); await screen.findByText('Synthetic oil service');
    expect(screen.getByRole('region', { name: 'Company vehicle records' })).toHaveAttribute('data-no-record-block');
    await userEvent.click(screen.getByRole('button', { name: /Log maintenance or repair/ }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-no-record-block');
  });
  it.each([false, true])('loaded fleet screen has no serious accessibility violations (admin=%s)', async canManage => {
    current.canManage = canManage;
    const { container } = mount();
    await screen.findByText('Synthetic oil service');
    await expectNoAxeViolations(container);
  });
  it('employee entry dialog has labeled fields and no serious accessibility violations', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Log maintenance or repair/ }));
    await expectNoAxeViolations(screen.getByRole('dialog'));
  });
  it('invalid cost is rejected before any backend write', async () => {
    mount(); await userEvent.click(await screen.findByRole('button', { name: /Log maintenance or repair/ }));
    fireEvent.change(screen.getByLabelText('Odometer at service (miles)'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('What was done?'), { target: { value: 'Repair' } });
    fireEvent.change(screen.getByLabelText('Total cost ($, optional)'), { target: { value: '-10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save service entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a cost');
    expect(request.mock.calls.some(([action]) => action === 'add_entry')).toBe(false);
  });
});


describe('review regression cases', () => {
  it('context failure unmounts records and dialogs and evicts child fleet caches', async () => {
    const { client } = mount();
    await screen.findByText('Synthetic oil service');
    await userEvent.click(screen.getByRole('button', { name: /Log maintenance or repair/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const original = request.getMockImplementation();
    request.mockImplementation(async (action, payload) => {
      if (action === 'context') throw new Error('Agency access was revoked');
      return original(action, payload);
    });
    await act(async () => { await client.invalidateQueries({ queryKey: ['fleetContext'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('revoked');
    expect(screen.queryByText('Synthetic oil service')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryCache().getAll().filter(query => ['fleetVehicles', 'fleetHistory', 'fleetStaff'].includes(query.queryKey[0]))).toHaveLength(0));
  });

  it('search cannot leave the service action targeting a hidden vehicle', async () => {
    current.vehicles = [car, { ...car, id: 'car-2', unit_name: 'Car 02', make: 'Ford', model: 'Escape' }];
    mount();
    await screen.findByText('Synthetic oil service');
    await userEvent.click(screen.getByRole('button', { name: /Car 01.*Toyota/ }));
    await userEvent.type(screen.getByLabelText('Search loaded vehicles'), 'Ford');
    expect(screen.getByRole('heading', { name: 'Car 02' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Car 01' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Log maintenance or repair/ }));
    expect(within(screen.getByRole('dialog')).getByText('Car 02')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Odometer at service (miles)'), '14000');
    await userEvent.type(screen.getByLabelText('What was done?'), 'Brake inspection');
    await userEvent.click(screen.getByRole('button', { name: 'Save service entry' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('add_entry', expect.objectContaining({ vehicle_id: 'car-2' })));
  });

  it('no matching search result leaves no unrelated detail or log button', async () => {
    mount(); await screen.findByText('Synthetic oil service');
    await userEvent.click(screen.getByRole('button', { name: /Car 01.*Toyota/ }));
    await userEvent.type(screen.getByLabelText('Search loaded vehicles'), 'not-a-vehicle');
    expect(screen.queryByRole('button', { name: /Log maintenance or repair/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic oil service')).not.toBeInTheDocument();
  });

  it('the open service form stays bound to its original car through a roster refresh', async () => {
    const { client } = mount();
    await userEvent.click(await screen.findByRole('button', { name: /Log maintenance or repair/ }));
    current.vehicles = [{ ...car, id: 'car-2', unit_name: 'Car 02' }];
    await act(async () => { await client.invalidateQueries({ queryKey: ['fleetVehicles'] }); });
    expect(within(screen.getByRole('dialog')).getByText('Car 01')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Odometer at service (miles)'), '14000');
    await userEvent.type(screen.getByLabelText('What was done?'), 'Work for original car');
    await userEvent.click(screen.getByRole('button', { name: 'Save service entry' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('add_entry', expect.objectContaining({ vehicle_id: 'car-1' })));
  });

  it.each(['service', 'vehicle', 'review'])('pending %s save cannot be dismissed by Close, Escape, or outside click', async kind => {
    current.canManage = true;
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const action = { service: 'add_entry', vehicle: 'create_vehicle', review: 'review_entry' }[kind];
    const original = request.getMockImplementation();
    request.mockImplementation(async (name, payload) => name === action ? pending : original(name, payload));
    mount();
    await screen.findByText('Synthetic oil service');
    if (kind === 'service') {
      await userEvent.click(screen.getByRole('button', { name: /Log maintenance or repair/ }));
      await userEvent.type(screen.getByLabelText('Odometer at service (miles)'), '14000');
      await userEvent.type(screen.getByLabelText('What was done?'), 'Pending work');
    } else if (kind === 'vehicle') {
      await userEvent.click(screen.getByRole('button', { name: 'Add vehicle' }));
      await userEvent.type(screen.getByLabelText('Vehicle / unit name'), 'Car 02');
      await userEvent.type(screen.getByLabelText('Make'), 'Ford');
      await userEvent.type(screen.getByLabelText('Model'), 'Escape');
      await userEvent.type(screen.getByLabelText('Starting odometer (miles)'), '14000');
    } else {
      await userEvent.click(screen.getByRole('button', { name: 'Review entry' }));
    }
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: { service: 'Save service entry', vehicle: 'Add vehicle', review: 'Save review' }[kind] }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(request.mock.calls.filter(([name]) => name === action)).toHaveLength(1);
    await act(async () => { finish({ success: true, vehicle: car, entry: service }); await pending; });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});


function deferredFleetOperation() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function openReviewForm(kind) {
  if (kind === 'service') {
    await userEvent.click(screen.getByRole('button', { name: /Log maintenance or repair/ }));
    await userEvent.type(screen.getByLabelText('Odometer at service (miles)'), '14000');
    await userEvent.type(screen.getByLabelText('What was done?'), 'Pending work');
  } else if (kind === 'vehicle') {
    await userEvent.click(screen.getByRole('button', { name: 'Add vehicle' }));
    await userEvent.type(screen.getByLabelText('Vehicle / unit name'), 'Car 02');
    await userEvent.type(screen.getByLabelText('Make'), 'Ford');
    await userEvent.type(screen.getByLabelText('Model'), 'Escape');
    await userEvent.type(screen.getByLabelText('Starting odometer (miles)'), '14000');
  } else {
    await userEvent.click(screen.getByRole('button', { name: 'Review entry' }));
    await userEvent.type(screen.getByLabelText('Review note (optional)'), 'Pending review');
  }
  const dialog = screen.getByRole('dialog');
  const form = dialog.querySelector('form');
  const submit = within(dialog).getByRole('button', { name: { service: 'Save service entry', vehicle: 'Add vehicle', review: 'Save review' }[kind] });
  return { dialog, form, submit };
}

describe('follow-up review: mutation and refresh lifetime', () => {
  it.each(['service', 'vehicle', 'review'].flatMap(kind => ['vehicles', 'history'].map(query => [kind, query])))(
    'retains %s form and retry identity through a failed %s refresh and uncertain save', async (kind, query) => {
      current.canManage = true;
      const write = deferredFleetOperation();
      let failRead = false;
      let retried = false;
      const action = { service: 'add_entry', vehicle: 'create_vehicle', review: 'review_entry' }[kind];
      const original = request.getMockImplementation();
      request.mockImplementation(async (name, payload) => {
        if (name === query && failRead) throw new Error('Temporary read failure');
        if (name === action && !retried) return write.promise;
        return original(name, payload);
      });
      const { client } = mount();
      await screen.findByText('Synthetic oil service');
      const { form, submit } = await openReviewForm(kind);
      await userEvent.click(submit);
      await waitFor(() => expect(request.mock.calls.filter(([name]) => name === action)).toHaveLength(1));
      failRead = true;
      await act(async () => { await client.invalidateQueries({ queryKey: [query === 'vehicles' ? 'fleetVehicles' : 'fleetHistory'] }); });
      // Keep operation memory but conceal stale details and do not allow another
      // write while the current record/assignment cannot be revalidated.
      expect(document.body.contains(form)).toBe(true);
      await waitFor(() => expect(form).not.toBeVisible());
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      expect(document.body.contains(form)).toBe(true);
      await act(async () => { write.reject(new Error('Save outcome uncertain')); await write.promise.catch(() => {}); });
      expect(document.body.contains(form)).toBe(true);
      expect(form).not.toBeVisible();
      failRead = false;
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['fleetVehicles'] });
        await client.invalidateQueries({ queryKey: ['fleetHistory'] });
      });
      await waitFor(() => expect(form).toBeVisible());
      expect(screen.getByRole('alert')).toHaveTextContent('Save outcome uncertain');
      retried = true;
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: { service: 'Save service entry', vehicle: 'Add vehicle', review: 'Save review' }[kind] }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const writes = request.mock.calls.filter(([name]) => name === action);
      expect(writes).toHaveLength(2);
      expect(writes[0][1].request_id).toBe(writes[1][1].request_id);
      expect(current.requestIds).toBe(1);
    },
  );

  it.each(['service', 'vehicle', 'review'])('keeps the %s form alive and busy until the successful save refresh completes', async kind => {
    current.canManage = true;
    const read = deferredFleetOperation();
    const second = deferredFleetOperation();
    let holdRefresh = false;
    let writes = 0;
    const action = { service: 'add_entry', vehicle: 'create_vehicle', review: 'review_entry' }[kind];
    const original = request.getMockImplementation();
    request.mockImplementation(async (name, payload) => {
      if (name === action) {
        writes += 1;
        if (writes === 1) { holdRefresh = true; return original(name, payload); }
        return second.promise;
      }
      if (holdRefresh && ['vehicles', 'history'].includes(name)) await read.promise;
      return original(name, payload);
    });
    mount(); await screen.findByText('Synthetic oil service');
    const { form, submit } = await openReviewForm(kind);
    await userEvent.click(submit);
    await waitFor(() => expect(holdRefresh).toBe(true));
    expect(document.body.contains(form)).toBe(true);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(document.body.contains(form)).toBe(true);
    // Background triggers cannot create a second form before the first releases
    // its lifecycle. Include hidden controls because Radix correctly traps focus.
    expect(screen.getByRole('button', { name: 'Add vehicle', hidden: true })).toBeDisabled();
    holdRefresh = false;
    await act(async () => { read.resolve(); await read.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const next = await openReviewForm(kind);
    await userEvent.click(next.submit);
    await waitFor(() => expect(writes).toBe(2));
    await userEvent.click(within(next.dialog).getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(document.body.contains(next.form)).toBe(true);
    expect(within(next.dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => { second.resolve({ success: true, vehicle: car, entry: service }); await second.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const operations = request.mock.calls.filter(([name]) => name === action);
    expect(operations[0][1].request_id).not.toBe(operations[1][1].request_id);
  });
});
