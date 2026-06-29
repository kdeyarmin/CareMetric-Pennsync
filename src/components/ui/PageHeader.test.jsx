import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Calendar } from 'lucide-react';
import PageHeader from './PageHeader';

describe('PageHeader', () => {
  // Regression: lucide-react icons are forwardRef *objects*, not plain
  // functions. The old `typeof icon === "function"` gate sent them down the
  // "render as-is" path, so React threw "Objects are not valid as a React
  // child ({$$typeof, render})" — blanking every page that used PageHeader.
  it('renders a lucide (forwardRef) icon component reference without crashing', () => {
    const { container } = render(<PageHeader title="Patients" icon={Calendar} />);
    expect(screen.getByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    // The icon should be instantiated to an actual <svg>, not dropped/thrown.
    expect(container.querySelector('svg.lucide')).toBeInTheDocument();
  });

  it('renders an already-built element passed as icon as-is', () => {
    render(
      <PageHeader title="Reports" icon={<Calendar data-testid="prebuilt-icon" />} />,
    );
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByTestId('prebuilt-icon')).toBeInTheDocument();
  });

  it('renders the title when no icon is provided', () => {
    render(<PageHeader title="Settings" />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});
