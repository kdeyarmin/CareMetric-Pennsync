import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ modules: vi.fn(), courses: vi.fn(), update: vi.fn(), manage: vi.fn(),
  success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { entities: {
  TrainingModule: { filter: mocks.modules, update: mocks.update }, TrainingCourse: { filter: mocks.courses },
} } }));
vi.mock('@/functions/manageTrainingVideos', () => ({ manageTrainingVideos: mocks.manage }));
vi.mock('@/components/training/PresenterPicker', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
import TrainingVideoStudio from './TrainingVideoStudio';
import ModuleScriptPanel from './ModuleScriptPanel';
import CourseCatalogDetail from '../learning/CourseCatalogDetail';

const course = { id: 'synthetic-course-a', title: 'Synthetic course A', status: 'draft', short_description: 'Synthetic lesson overview' };
const script = 'This is invented course narration for a test. Review the learning objective before proceeding, and record the practice result in the training system.';
const lesson = { id: 'synthetic-module-a', title: 'Synthetic lesson A', course_id: course.id, content_json: { video_narration: script } };
const video = { module_id: lesson.id, title: lesson.title, video_status: 'none' };
const status = modules => ({ data: { heygen_configured: true, modules } });
let clients = [];
function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return { ...render(ui, { wrapper }), client };
}
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.modules.mockResolvedValue([lesson]); mocks.courses.mockResolvedValue([course]); mocks.update.mockResolvedValue({});
  mocks.manage.mockResolvedValue(status([video]));
});
afterEach(() => { clients.forEach(client => client.clear()); clients = []; });

describe('training read failures are not empty or successful results', () => {
  it('shows an unresolved course outline as loading rather than zero lessons', async () => {
    const waiting = deferred(); mocks.modules.mockReturnValue(waiting.promise);
    mount(<CourseCatalogDetail course={course} open onOpenChange={() => {}} />);
    expect(within(screen.getByText('Lessons').parentElement).getByText('Loading…')).toBeVisible();
    await act(async () => waiting.resolve([]));
    expect(await screen.findByText('This course has no lesson modules yet.')).toBeVisible();
  });

  it('shows a retryable outline error without leaking the backend exception', async () => {
    mocks.modules.mockRejectedValueOnce(new Error('PRIVATE_BACKEND_DETAIL')).mockResolvedValue([lesson]);
    mount(<CourseCatalogDetail course={course} open onOpenChange={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Course outline could not be loaded');
    expect(within(screen.getByText('Lessons').parentElement).getByText('Unavailable')).toBeVisible();
    expect(screen.queryByText(/PRIVATE_BACKEND_DETAIL/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry course outline' }));
    expect(await screen.findByText(lesson.title)).toBeVisible();
  });

  it('does not claim video status is current or empty while the first read is pending', async () => {
    const waiting = deferred(); mocks.manage.mockReturnValue(waiting.promise);
    mount(<TrainingVideoStudio course={course} />);
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
    expect(screen.queryByText('This course has no lesson modules to turn into videos.')).not.toBeInTheDocument();
    expect(screen.getByText('Loading video status…')).toBeVisible();
    await act(async () => waiting.resolve(status([])));
    expect(await screen.findByText('This course has no lesson modules to turn into videos.')).toBeVisible();
  });

  it('offers a retry after a rejected video-status request instead of claiming current status', async () => {
    mocks.manage.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL')).mockResolvedValue(status([video]));
    mount(<TrainingVideoStudio course={course} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Video status could not be loaded');
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_PROVIDER_DETAIL/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry video status' }));
    expect(await screen.findByText(video.title)).toBeVisible();
  });

  it.each([{}, { heygen_configured: true, modules: null }, { heygen_configured: true, modules: [null] }])('treats malformed status as unavailable rather than a zero-lesson course', async value => {
    mocks.manage.mockResolvedValue({ data: value });
    mount(<TrainingVideoStudio course={course} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Video status could not be loaded');
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
  });

  it('reports a failed course picker read, preserving a way to retry', async () => {
    mocks.courses.mockRejectedValueOnce(new Error('PRIVATE_CATALOG_DETAIL'));
    mount(<TrainingVideoStudio />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Course list could not be loaded');
    expect(screen.getByRole('button', { name: 'Retry course list' })).toBeEnabled();
  });

  it('hides stale video actions during a failed refresh without losing the in-progress script draft', async () => {
    const view = mount(<TrainingVideoStudio course={course} />);
    fireEvent.click(await screen.findByRole('button', { name: /View script/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Edit script/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: script + ' Unsaved draft.' } });
    mocks.manage.mockRejectedValue(new Error('failed refresh'));
    await act(async () => view.client.invalidateQueries({ queryKey: ['training-video-status', course.id] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Video status could not be loaded');
    expect(screen.queryByRole('button', { name: 'Save script' })).not.toBeInTheDocument();
    mocks.manage.mockResolvedValue(status([video]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry video status' }));
    expect(await screen.findByDisplayValue(script + ' Unsaved draft.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save script' })).toBeEnabled();
  });
});

describe('training mutations stay attached to their original scope', () => {
  it('blocks an already-open script editor while disabled and preserves its draft for recovery', async () => {
    const view = mount(<ModuleScriptPanel module={lesson} courseId={course.id} />);
    fireEvent.click(screen.getByRole('button', { name: /View script/ }));
    fireEvent.click(screen.getByRole('button', { name: /Edit script/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: script + ' Unsaved draft.' } });
    view.rerender(<ModuleScriptPanel module={lesson} courseId={course.id} disabled />);
    expect(screen.getByRole('button', { name: 'Save script' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save script' }));
    expect(mocks.update).not.toHaveBeenCalled();
    view.rerender(<ModuleScriptPanel module={lesson} courseId={course.id} />);
    expect(screen.getByRole('textbox')).toHaveValue(script + ' Unsaved draft.');
  });

  it('does not reuse an unsaved script when the same panel is given another module', () => {
    const view = mount(<ModuleScriptPanel module={lesson} courseId={course.id} />);
    fireEvent.click(screen.getByRole('button', { name: /View script/ }));
    fireEvent.click(screen.getByRole('button', { name: /Edit script/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: script + ' Draft A.' } });
    view.rerender(<ModuleScriptPanel module={{ ...lesson, id: 'module-b', title: 'Different lesson' }} courseId={course.id} />);
    expect(screen.queryByDisplayValue(script + ' Draft A.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save script' })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not announce success when the provider started zero jobs', async () => {
    mocks.manage.mockImplementation(payload => Promise.resolve(payload.action === 'status' ? status([video])
      : { data: { started: 0, modules: [{ ...video, video_status: 'failed' }] } }));
    mount(<TrainingVideoStudio course={course} />);
    const generate = await screen.findByRole('button', { name: 'Generate all' });
    await waitFor(() => expect(generate).toBeEnabled()); fireEvent.click(generate);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('No videos were started')));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('refreshes the original course and suppresses stale success feedback after a course switch', async () => {
    const waiting = deferred();
    mocks.manage.mockImplementation(payload => payload.action === 'status' ? Promise.resolve(status([video])) : waiting.promise);
    const view = mount(<TrainingVideoStudio course={course} />);
    const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    const generate = await screen.findByRole('button', { name: 'Generate all' });
    await waitFor(() => expect(generate).toBeEnabled()); fireEvent.click(generate);
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith(expect.objectContaining({ action: 'start', course_id: course.id })));
    view.rerender(<TrainingVideoStudio course={{ ...course, id: 'course-b', title: 'Synthetic course B' }} />);
    await act(async () => waiting.resolve({ data: { started: 1, modules: [{ ...video, video_status: 'processing' }] } }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['training-video-status', course.id] }));
    expect(mocks.success).not.toHaveBeenCalled();
  });
});


describe('remaining training recovery and paid-action boundaries', () => {
  it('retries a malformed course outline without treating it as an empty course', async () => {
    mocks.modules.mockResolvedValueOnce({ private: 'PRIVATE_DETAIL' }).mockResolvedValue([lesson]);
    mount(<CourseCatalogDetail course={course} open onOpenChange={() => {}} />);
    expect(await screen.findByRole('alert', {}, { timeout: 1000 })).toHaveTextContent('Course outline could not be loaded');
    expect(screen.queryByText('This course has no lesson modules yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry course outline' }));
    expect(await screen.findByText(lesson.title)).toBeVisible();
  });

  it('keeps an edited script through a malformed read and a verified recovery', async () => {
    const view = mount(<TrainingVideoStudio course={course} />);
    fireEvent.click(await screen.findByRole('button', { name: /View script/ }));
    fireEvent.click(screen.getByRole('button', { name: /Edit script/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: script + ' Preserved draft.' } });
    mocks.modules.mockResolvedValue({ private: 'PRIVATE_DETAIL' });
    await act(async () => view.client.invalidateQueries({ queryKey: ['training-modules', course.id] }));
    expect(await screen.findByRole('alert', {}, { timeout: 1000 })).toHaveTextContent('Lesson scripts could not be loaded');
    expect(screen.queryByRole('button', { name: 'Save script' })).not.toBeInTheDocument();
    mocks.modules.mockResolvedValue([lesson]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry lesson scripts' }));
    expect(await screen.findByDisplayValue(script + ' Preserved draft.')).toBeVisible();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not offer generation for video modules missing a status', async () => {
    mocks.manage.mockResolvedValue(status([{ module_id: lesson.id, title: lesson.title }]));
    mount(<TrainingVideoStudio course={course} />);
    expect(await screen.findByRole('alert', {}, { timeout: 1000 })).toHaveTextContent('Video status could not be loaded');
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate all' })).toBeDisabled();
    expect(mocks.manage.mock.calls.some(([payload]) => payload.action !== 'status')).toBe(false);
  });

  it('keeps a malformed course picker response unavailable and retryable', async () => {
    mocks.courses.mockResolvedValueOnce([null]).mockResolvedValue([]);
    mount(<TrainingVideoStudio />);
    expect(await screen.findByRole('alert', {}, { timeout: 1000 })).toHaveTextContent('Course list could not be loaded');
    expect(screen.getByRole('combobox', { name: 'Course' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry course list' }));
    expect(await screen.findByText('No published or draft courses are available.')).toBeVisible();
  });

  it('preserves the script draft but blocks its controls after a script-history read failure', async () => {
    const view = mount(<TrainingVideoStudio course={course} />);
    fireEvent.click(await screen.findByRole('button', { name: /View script/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Edit script/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: script + ' Still editing.' } });
    mocks.modules.mockRejectedValue(new Error('read failed'));
    await act(async () => view.client.invalidateQueries({ queryKey: ['training-modules', course.id] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lesson scripts could not be loaded');
    expect(screen.queryByRole('button', { name: 'Save script' })).not.toBeInTheDocument();
    mocks.modules.mockResolvedValue([lesson]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry lesson scripts' }));
    expect(await screen.findByDisplayValue(script + ' Still editing.')).toBeVisible();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not enable generation while a cached status is being refreshed', async () => {
    const view = mount(<TrainingVideoStudio course={course} />);
    const generate = await screen.findByRole('button', { name: 'Generate all' });
    await waitFor(() => expect(generate).toBeEnabled());
    const waiting = deferred(); mocks.manage.mockReturnValue(waiting.promise);
    let refresh;
    act(() => { refresh = view.client.invalidateQueries({ queryKey: ['training-video-status', course.id] }); });
    expect(await screen.findByText('Refreshing video status…')).toBeVisible();
    expect(generate).toBeDisabled(); fireEvent.click(generate);
    expect(mocks.manage.mock.calls.some(([payload]) => payload.action === 'start')).toBe(false);
    await act(async () => { waiting.resolve(status([video])); await refresh; });
    await waitFor(() => expect(generate).toBeEnabled());
  });

  it('warns about partial generation instead of reporting every lesson as successful', async () => {
    const second = { ...video, module_id: 'synthetic-module-b', title: 'Synthetic lesson B' };
    mocks.manage.mockImplementation(payload => Promise.resolve(payload.action === 'status' ? status([video, second])
      : { data: { started: 1, modules: [{ ...video, video_status: 'processing' }, { ...second, video_status: 'failed' }] } }));
    mount(<TrainingVideoStudio course={course} />);
    const generate = await screen.findByRole('button', { name: 'Generate all' });
    await waitFor(() => expect(generate).toBeEnabled()); fireEvent.click(generate);
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('1 lesson reports a failure')));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('a rapid double click starts one mutation, not two paid provider jobs', async () => {
    const waiting = deferred();
    mocks.manage.mockImplementation(payload => payload.action === 'status' ? Promise.resolve(status([video])) : waiting.promise);
    mount(<TrainingVideoStudio course={course} />);
    const generate = await screen.findByRole('button', { name: 'Generate all' });
    await waitFor(() => expect(generate).toBeEnabled());
    act(() => { fireEvent.click(generate); fireEvent.click(generate); });
    await waitFor(() => expect(mocks.manage.mock.calls.filter(([payload]) => payload.action === 'start')).toHaveLength(1));
    await act(async () => waiting.resolve({ data: { started: 1, modules: [{ ...video, video_status: 'processing' }] } }));
  });

  it('retains safe same-tab video preview rather than routing it into a disabled popup helper', async () => {
    const url = 'https://example.test/synthetic-video.mp4';
    mocks.manage.mockResolvedValue(status([{ ...video, video_status: 'completed', video_url: url, video_duration_seconds: 119.7 }]));
    mount(<TrainingVideoStudio course={course} />);
    const preview = await screen.findByRole('link', { name: 'Preview' });
    expect(preview).toHaveAttribute('href', url); expect(preview).not.toHaveAttribute('target');
    expect(screen.getByText('2:00')).toBeVisible();
  });

  it('does not equate a rejected generation result with a successful job', async () => {
    mocks.manage.mockImplementation(payload => Promise.resolve(payload.action === 'status' ? status([video]) : { data: { error: 'PRIVATE_PROVIDER_ERROR' } }));
    mount(<TrainingVideoStudio course={course} />);
    const generate = await screen.findByRole('button', { name: 'Generate all' });
    await waitFor(() => expect(generate).toBeEnabled()); fireEvent.click(generate);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Could not confirm video generation. Refresh status before trying again.'));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.manage.mock.calls.filter(([payload]) => payload.action === 'start')).toHaveLength(1);
  });
});
