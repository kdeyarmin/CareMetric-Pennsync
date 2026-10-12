import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CarePlanTimeline from './CarePlanTimeline';
const plan = (id, target_date, status = 'active') => ({ id, target_date, status, problem: id, goal: 'Test goal' });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 12, 15, 30)); });
afterEach(() => vi.useRealTimers());
describe('care plan calendar deadlines', () => {
  it('does not mark a date-only deadline overdue during its due day', () => {
    render(<CarePlanTimeline carePlans={[plan('today-plan', '2026-10-12')]} />);
    expect(screen.getByText('Due today')).toBeInTheDocument();
    expect(screen.getByText('today-plan').closest('.border-l-4')).not.toHaveClass('border-l-red-500');
  });
  it('counts tomorrow and yesterday by calendar days rather than full 24-hour periods', () => {
    render(<CarePlanTimeline carePlans={[plan('tomorrow-plan', '2026-10-13'), plan('yesterday-plan', '2026-10-11')]} />);
    expect(screen.getByText('1d left')).toBeInTheDocument();
    expect(screen.getByText('1d overdue')).toBeInTheDocument();
  });
  it('does not label a completed goal overdue', () => {
    render(<CarePlanTimeline carePlans={[plan('met-plan', '2026-10-11', 'met')]} />);
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });
  it('does not position Today outside the target-date timeline', () => {
    render(<CarePlanTimeline carePlans={[plan('future-plan', '2026-10-20')]} />);
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.getByText('0 days')).toBeInTheDocument();
  });
});