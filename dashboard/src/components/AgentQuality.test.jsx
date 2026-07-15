import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentQuality from './AgentQuality';
import { useApi } from '../hooks/useApi';

vi.mock('../hooks/useApi');

function mockData(data) {
  useApi.mockReturnValue({ data, loading: false, error: null });
}

// The page defaults to the plain-language "Business View" — several
// assertions below exercise fields that only render in "Technical View".
function switchToTechnicalView() {
  fireEvent.click(screen.getByText('Technical View'));
}

describe('AgentQuality', () => {
  it('shows the critical-findings banner when critical findings exist', () => {
    mockData({ total_runs: 10, severity_counts: { critical: 3, warning: 1 } });
    render(<AgentQuality />);
    switchToTechnicalView();
    expect(screen.getByText(/3 critical guardrail findings/i)).toBeInTheDocument();
  });

  it('does not show the banner when there are no critical findings', () => {
    mockData({ total_runs: 10, severity_counts: { critical: 0, warning: 0 } });
    render(<AgentQuality />);
    switchToTechnicalView();
    expect(screen.queryByText(/critical guardrail finding/i)).not.toBeInTheDocument();
  });

  it('shows the healthy-zero empty state when runs exist but no findings', () => {
    mockData({ total_runs: 10, severity_counts: { critical: 0, warning: 0 } });
    render(<AgentQuality />);
    switchToTechnicalView();
    expect(screen.getByText(/10 runs, 0 critical findings/i)).toBeInTheDocument();
  });

  it('shows the no-data-in-window empty state when total_runs is 0', () => {
    mockData({ total_runs: 0, severity_counts: { critical: 0, warning: 0 } });
    render(<AgentQuality />);
    expect(screen.getByText(/no agent runs recorded/i)).toBeInTheDocument();
  });

  it('does not render raw snake_case guardrail check names anywhere on the page', () => {
    mockData({
      total_runs: 10,
      severity_counts: { critical: 1, warning: 0 },
      top_checks: [{ check: 'temp_excursion', count: 5 }],
    });
    const { container } = render(<AgentQuality />);
    switchToTechnicalView();
    expect(container.textContent).not.toMatch(/temp_excursion/);
  });

  it('renders the guardrail-escalated stat with amber accent, not emerald', () => {
    mockData({ total_runs: 10, severity_counts: { critical: 0, warning: 0 }, guardrail_escalation_rate: 0.14 });
    render(<AgentQuality />);
    switchToTechnicalView();
    const label = screen.getByText('Guardrail Escalated');
    const value = label.closest('.aq-kpi').querySelector('.aq-kpi-value');
    expect(value.style.color).toBe('var(--aq-amber)');
  });
});
