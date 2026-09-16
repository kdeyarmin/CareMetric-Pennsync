import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';
import EducatorReadinessPanel from './EducatorReadinessPanel';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/functions/getTeamTrainingReadiness', () => ({ getTeamTrainingReadiness: load }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: {id:'reviewer'}, tenantContext:{agency_id:'agency-a'} }) }));
beforeEach(() => load.mockReset());
describe('readiness is evidence, not the absence of assignments', () => {
  it('an empty successful response is not 100 percent compliant', async () => {
    load.mockResolvedValue({data:{overall:{total:0, done:0, overdue:0, pct:null, staff:0}, rows:[]}});
    renderWithProviders(<EducatorReadinessPanel />);
    expect(await screen.findByText('Not assessed')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Export CSV'})).toBeDisabled();
  });
  it('an older backend empty dataset with pct=100 is also displayed as not assessed', async () => {
    load.mockResolvedValue({data:{overall:{total:0, done:0, overdue:0, pct:100, staff:0}, rows:[]}});
    renderWithProviders(<EducatorReadinessPanel />);
    expect(await screen.findByText('Not assessed')).toBeInTheDocument();
  });
  it('real nonempty aggregate data retains its percentage', async () => {
    load.mockResolvedValue({data:{overall:{total:4, done:3, overdue:1, pct:75, staff:2}, rows:[]}});
    renderWithProviders(<EducatorReadinessPanel />);
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
  });
});
