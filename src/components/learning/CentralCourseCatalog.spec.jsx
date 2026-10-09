import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';
import CentralCourseCatalog from './CentralCourseCatalog';

const { list, openWindow } = vi.hoisted(() => ({ list: vi.fn(), openWindow: vi.fn() }));
vi.mock('@/functions/listCentralLearningCourses', () => ({ listCentralLearningCourses: list }));
vi.mock('@/lib/authorityBoundWindows', () => ({ openAuthorityBoundWindow: openWindow }));
// A learner: the staff plan summary beside the catalog renders nothing.
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'learner', role: 'user' }, tenantContext: { tenant_role: 'clinician' } }) }));

const COURSE = {
  id: '11111111-2222-4333-8444-555555555555', title: 'Infection control', summary: 'Hand hygiene basics',
  category: 'Safety', duration_minutes: 30, delivery: 'Support Hub',
  url: 'https://support-hub-web-production.up.railway.app/learn/courses/11111111-2222-4333-8444-555555555555',
};

beforeEach(() => { list.mockReset(); openWindow.mockReset(); });

describe('central course catalog', () => {
  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['items without categories or paging', { items: [] }],
    ['a body whose fields have the wrong types', { items: 'nope', categories: null, total: '4', next_offset: undefined }],
  ])('renders the empty state for %s instead of crashing', async (_label, data) => {
    list.mockResolvedValue({ data });
    renderWithProviders(<CentralCourseCatalog />);
    expect(await screen.findByText('No published courses are available for PennSync yet.')).toBeInTheDocument();
    expect(screen.getByText('0 courses')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('draws a partial page without inventing paging it was not given', async () => {
    list.mockResolvedValue({ data: { items: [COURSE, { title: 'No id' }, null] } });
    renderWithProviders(<CentralCourseCatalog />);
    expect(await screen.findByText('Infection control')).toBeInTheDocument();
    expect(screen.queryByText('No id')).toBeNull();
    expect(screen.getByText('1 course · Showing 1–1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('opens courses and the Hub through the authority-bound window, never a declarative blank target', async () => {
    list.mockResolvedValue({ data: { items: [COURSE], total: 1, categories: ['Safety'], next_offset: null } });
    const { container } = renderWithProviders(<CentralCourseCatalog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open course' }));
    expect(openWindow).toHaveBeenLastCalledWith(COURSE.url);
    fireEvent.click(screen.getByRole('button', { name: 'My Hub learning' }));
    expect(openWindow).toHaveBeenCalledTimes(2);
    expect(new URL(openWindow.mock.calls[1][0]).pathname).toBe('/learn/my');
    expect(container.querySelector('[target]')).toBeNull();
  });

  it('offers no open button for a course whose link is not http(s)', async () => {
    list.mockResolvedValue({ data: { items: [{ ...COURSE, url: 'javascript:alert(1)' }], total: 1, categories: [], next_offset: null } });
    renderWithProviders(<CentralCourseCatalog />);
    expect(await screen.findByText('This course is awaiting a delivery link.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open course' })).toBeNull();
  });
});
