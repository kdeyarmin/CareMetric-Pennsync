import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import VehicleMaintenance from './VehicleMaintenance';
import { expectNoAxeViolations } from '@/test/axeHelpers';

const { request, current } = vi.hoisted(() => ({ request: vi.fn(), current: { canManage: false, vehicles: [], entries: [] } }));
vi.mock('@/functions/manageVehicleMaintenance', () => ({ manageVehicleMaintenance: request, vehicleRequestId: () => 'fleet-test-request' }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1' }, tenantContext: { agency_id: 'agency-a' } }) }));
vi.mock('@/components/ui/PageHeader', () => ({ default: ({ title, description }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock('@/components/ui/PageContainer', () => ({ default: ({ children }) => <main>{children}</main> }));
const car = { id: 'car-1', unit_name: 'Car 01', year: 2024, make: 'Toyota', model: 'Corolla', assigned_user_id: 'staff-1', assigned_user_name: 'Test Driver', baseline_odometer: 10000, status: 'active', version: 1 };
const service = { id: 'entry-1', service_date: '2026-01-15', odometer: 11000, service_type: 'oil_change', description: 'Synthetic oil service', cost_cents: 8995, review_status: 'pending', review_history: [], submitted_by_name: 'Test Driver', entry_source: 'employee', recorded_at: '2026-01-15T12:00:00Z' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><VehicleMaintenance /></QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  current.canManage = false; current.vehicles = [car]; current.entries = [service];
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
    await waitFor(() => expect(request).toHaveBeenCalledWith('review_entry', { agency_id: 'agency-a', vehicle_id: 'car-1', entry_id: 'entry-1', expected_review_count: 0, status: 'reviewed', note: 'Invoice checked' }));
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
    request.mockImplementation(async (action, payload) => action === 'history' ? { success: true, entries: payload.offset ? [{ ...service, id: 'older', description: 'Older repair' }] : [service], next_offset: payload.offset ? null : 50 } : original(action, payload));
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
