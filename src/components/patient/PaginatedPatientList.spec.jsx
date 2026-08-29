import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PaginatedPatientList from './PaginatedPatientList';

const renderList = (patients) =>
  render(
    <MemoryRouter>
      <PaginatedPatientList patients={patients} />
    </MemoryRouter>,
  );

// Card headings are the rendered patient names, in display order.
const renderedNames = () =>
  screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('PaginatedPatientList name sorting', () => {
  it('sorts alphabetically by the name it displays', () => {
    renderList([
      { id: '3', first_name: 'Carol', last_name: 'Adams' },
      { id: '1', first_name: 'Alice', last_name: 'Zhang' },
      { id: '2', first_name: 'Bob', last_name: 'Miller' },
    ]);
    expect(renderedNames()).toEqual(['Alice Zhang', 'Bob Miller', 'Carol Adams']);
  });

  it('keeps a chart with a missing name half in alphabetical position', () => {
    // Regression: the key was `${first_name} ${last_name}`, so a chart with no
    // last name produced "Nadia undefined" and sorted under N…u — which happens
    // to be right here — while a chart with no FIRST name produced
    // "undefined Brooks" and jumped to the end of the roster, far from the "B"
    // its card actually renders under.
    renderList([
      { id: '1', first_name: 'Alice', last_name: 'Zhang' },
      { id: '2', last_name: 'Brooks' },
      { id: '3', first_name: 'Carol', last_name: 'Adams' },
    ]);
    expect(renderedNames()).toEqual(['Alice Zhang', 'Brooks', 'Carol Adams']);
  });

  it('never renders the literal string "undefined" in a name', () => {
    renderList([{ id: '1', first_name: 'Dana' }, { id: '2', last_name: 'Ellis' }]);
    for (const name of renderedNames()) {
      expect(name).not.toContain('undefined');
    }
  });
});
