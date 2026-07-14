import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import AgentRunRow from './AgentRunRow';

function RunKeyProbe() {
  const { runKey } = useParams();
  return <div>Run detail for run key: {runKey}</div>;
}

function renderRow(decision, runLabel) {
  return render(
    <MemoryRouter>
      <AgentRunRow decision={decision} runLabel={runLabel} />
    </MemoryRouter>
  );
}

describe('AgentRunRow', () => {
  it('shows window id and shipment/container ids', () => {
    renderRow({ window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH' });
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText(/S014/)).toBeInTheDocument();
    expect(screen.getByText(/C220/)).toBeInTheDocument();
  });

  it('renders a crit-colored status pill when awaiting approval', () => {
    renderRow({ window_id: 'W00041', risk_tier: 'HIGH', awaiting_approval: true });
    const pill = screen.getByText(/awaiting approval/i);
    expect(pill).toHaveStyle({ color: 'var(--accent-red)' });
  });

  it('renders an ok-colored status pill when resolved with actions taken', () => {
    renderRow({ window_id: 'W00040', risk_tier: 'LOW', actions_taken: [{ tool: 'route_agent' }] });
    const pill = screen.getByText(/resolved/i);
    expect(pill).toHaveStyle({ color: 'var(--accent-emerald)' });
  });

  it('navigates on click', () => {
    renderRow({ window_id: 'W00041', risk_tier: 'HIGH' });
    fireEvent.click(screen.getByRole('button'));
    // navigation target itself is covered by the test below; here we only
    // assert the row is keyboard/click actionable.
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('navigates using the run-specific key (thread_id), not just window_id, so two runs sharing a window_id go to different pages', () => {
    render(
      <MemoryRouter initialEntries={['/agent']}>
        <Routes>
          <Route path="/agent" element={<AgentRunRow decision={{ window_id: 'W00890', thread_id: 'S015_W00890_111', risk_tier: 'HIGH' }} />} />
          <Route path="/agent/runs/:runKey" element={<RunKeyProbe />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/S015_W00890_111/)).toBeInTheDocument();
  });

  it('shows the decision_summary and a relative time on a second line', () => {
    renderRow({
      window_id: 'W00890',
      risk_tier: 'CRITICAL',
      decision_summary: 'Graph paused at human_review — 4 tool(s) executed.',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(screen.getByText(/Graph paused at human_review/)).toBeInTheDocument();
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it('shows a fallback message when decision_summary is absent', () => {
    renderRow({ window_id: 'W00890', risk_tier: 'CRITICAL' });
    expect(screen.getByText(/no decision summary recorded/i)).toBeInTheDocument();
  });

  it('shows one icon per unique agent tool in actions_taken', () => {
    const { container } = renderRow({
      window_id: 'W00890',
      risk_tier: 'CRITICAL',
      actions_taken: [{ tool: 'compliance_agent' }, { tool: 'cold_storage_agent' }, { tool: 'compliance_agent' }],
    });
    expect(container.querySelectorAll('[data-agent-icon]').length).toBe(2);
  });

  it('shows a run-label badge when provided', () => {
    renderRow({ window_id: 'W00890', risk_tier: 'CRITICAL' }, { index: 2, total: 3 });
    expect(screen.getByText('Run 2 of 3')).toBeInTheDocument();
  });

  it('does not show a run-label badge when not provided', () => {
    renderRow({ window_id: 'W00890', risk_tier: 'CRITICAL' });
    expect(screen.queryByText(/run \d of \d/i)).not.toBeInTheDocument();
  });

  it('shows a replan badge when replan_count is greater than 0', () => {
    renderRow({ window_id: 'W00890', risk_tier: 'CRITICAL', replan_count: 2 });
    expect(screen.getByText(/re-planned 2x/i)).toBeInTheDocument();
  });

  it('does not show a replan badge when replan_count is 0 or absent', () => {
    renderRow({ window_id: 'W00890', risk_tier: 'CRITICAL', replan_count: 0 });
    expect(screen.queryByText(/re-planned/i)).not.toBeInTheDocument();
  });
});
