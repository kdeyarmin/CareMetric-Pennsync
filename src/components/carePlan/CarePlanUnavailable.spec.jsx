import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';
import CarePlanUnavailable, {
  CARE_PLAN_UNAVAILABLE_MESSAGE,
} from './CarePlanUnavailable';

describe('care-plan fail-closed presentation', () => {
  it('names every unavailable workflow without presenting a false empty state', () => {
    renderWithProviders(<CarePlanUnavailable />);

    expect(screen.getByText('Care plans unavailable')).toBeInTheDocument();
    expect(screen.getByText(CARE_PLAN_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /must not be interpreted as an empty care plan, a completed goal, or zero activity/,
    );
  });
});
