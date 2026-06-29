import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingState from './LoadingState';
import AccessDeniedState from './AccessDeniedState';

describe('LoadingState', () => {
  it('renders an accessible status region with a spinning icon', () => {
    const { container } = render(<LoadingState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide.animate-spin')).toBeInTheDocument();
    // Always announces something to assistive tech, even without a label.
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('shows the provided label', () => {
    render(<LoadingState label="Loading certificates…" />);
    expect(screen.getByText('Loading certificates…')).toBeInTheDocument();
  });
});

describe('AccessDeniedState', () => {
  it('renders default admin-access wording', () => {
    render(<AccessDeniedState />);
    expect(screen.getByRole('heading', { name: 'Admin Access Required' })).toBeInTheDocument();
  });

  it('renders custom title and description', () => {
    render(<AccessDeniedState title="Access Denied" description="Only administrators can access learning reports." />);
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.getByText('Only administrators can access learning reports.')).toBeInTheDocument();
  });
});
