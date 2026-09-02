import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import OasisResponseControl, { LegacyResponseNotice } from './OasisResponseControl';
import { v2Definition } from './responseSchema/registry.js';

const def = (id) => v2Definition(id);

function renderControl(id, timepoint, value = null, onChange = () => {}) {
  return render(
    <OasisResponseControl definition={def(id)} timepoint={timepoint} value={value} onChange={onChange} />,
  );
}

describe('OasisResponseControl a11y', () => {
  it('single-select has no serious axe violations', async () => {
    const { container } = renderControl('m1830_cms_e2', 'DC');
    await expectNoAxeViolations(container);
  });

  it('matrix (M1100) has no serious axe violations', async () => {
    const { container } = renderControl('m1100_cms_e2', 'SOC');
    await expectNoAxeViolations(container);
  });

  it('multi-select (M1740) has no serious axe violations', async () => {
    const { container } = renderControl('m1740_cms_e2', 'DC');
    await expectNoAxeViolations(container);
  });

  it('grid (M2401) has no serious axe violations', async () => {
    const { container } = renderControl('m2401_cms_e2', 'DC');
    await expectNoAxeViolations(container);
  });

  it('the legacy read-only notice has no serious axe violations', async () => {
    const { container } = render(<LegacyResponseNotice definitionId="m1830" storedValue={6} />);
    await expectNoAxeViolations(container);
  });
});

describe('OasisResponseControl behaviour', () => {
  it('begins blank — no option is pre-selected', () => {
    renderControl('m1830_cms_e2', 'DC');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getAllByText(/No response selected/i).length).toBeGreaterThan(0);
  });

  it('requires an explicit clinician action and preserves the code exactly', () => {
    const onChange = vi.fn();
    renderControl('m1100_cms_e2', 'SOC', null, onChange);
    expect(onChange).not.toHaveBeenCalled();
    // Leading zero must survive the DOM round-trip.
    fireEvent.click(screen.getByDisplayValue('07'));
    expect(onChange).toHaveBeenCalledWith({ code: '07' });
  });

  it('shows applicability and source/version information', () => {
    renderControl('m2420_cms_e2', 'DC');
    expect(screen.getByText(/collected at DC/i)).toBeInTheDocument();
    expect(screen.getByText(/All-Item instrument, M2420/i)).toBeInTheDocument();
    expect(screen.getByText(/does not certify this response/i)).toBeInTheDocument();
  });

  it('refuses to render an answerable control at an inapplicable timepoint', () => {
    renderControl('m2420_cms_e2', 'SOC');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/Not collected at SOC/i)).toBeInTheDocument();
  });

  it('omits a code CMS does not offer at this timepoint', () => {
    renderControl('m1620_cms_e2', 'DC');
    expect(screen.queryByDisplayValue('UK')).not.toBeInTheDocument();
    renderControl('m1620_cms_e2', 'SOC');
    expect(screen.getAllByDisplayValue('UK').length).toBeGreaterThan(0);
  });

  it('enforces the mutually exclusive response in the control itself', () => {
    const onChange = vi.fn();
    renderControl('m1740_cms_e2', 'DC', { codes: ['1', '3'] }, onChange);
    fireEvent.click(screen.getByDisplayValue('7'));
    // Selecting "None of the above" clears everything else.
    expect(onChange).toHaveBeenCalledWith({ codes: ['7'] });
  });

  it('clears the exclusive response when another is selected', () => {
    const onChange = vi.fn();
    renderControl('m1740_cms_e2', 'DC', { codes: ['7'] }, onChange);
    fireEvent.click(screen.getByDisplayValue('2'));
    expect(onChange).toHaveBeenCalledWith({ codes: ['2'] });
  });

  it('announces which grid rows are still unanswered', () => {
    const onChange = vi.fn();
    renderControl('m2401_cms_e2', 'DC', { rows: [{ row_id: 'b', code: '1' }] }, onChange);
    const status = screen.getByText(/rows still to answer/i);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toMatch(/c, d, e, f/);
  });

  it('keeps grid rows in the published order regardless of answer order', () => {
    const onChange = vi.fn();
    renderControl('m2401_cms_e2', 'DC', { rows: [{ row_id: 'f', code: '1' }] }, onChange);
    fireEvent.click(screen.getAllByDisplayValue('0')[0]); // row b
    expect(onChange).toHaveBeenCalledWith({ rows: [{ row_id: 'b', code: '0' }, { row_id: 'f', code: '1' }] });
  });

  it('every input has a programmatic label', () => {
    renderControl('m1740_cms_e2', 'DC');
    for (const box of screen.getAllByRole('checkbox')) expect(box).toHaveAccessibleName();
  });

  it('legacy history is read-only and carries the persistent warning', () => {
    render(<LegacyResponseNotice definitionId="m1830" storedValue={6} />);
    expect(screen.getByText(/artificial opening/i)).toBeInTheDocument();
    expect(screen.getByText(/do not copy this code/i)).toBeInTheDocument();
    // No edit, clone, carry-forward, copy or convert affordance exists.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});
