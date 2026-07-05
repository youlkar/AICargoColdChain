import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgentRunDetail from './AgentRunDetail';
import * as useApiModule from '../hooks/useApi';

function renderAt(runKey, mockHistory, mockLoading = false) {
  vi.spyOn(useApiModule, 'useApi').mockReturnValue({ data: mockHistory, loading: mockLoading, error: null });
  return render(
    <MemoryRouter initialEntries={[`/agent/runs/${encodeURIComponent(runKey)}`]}>
      <Routes>
        <Route path="/agent/runs/:runKey" element={<AgentRunDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AgentRunDetail', () => {
  it('renders the matching run by its unique run key (thread_id) from history', () => {
    renderAt('THREAD-014', [
      { window_id: 'W00041', thread_id: 'THREAD-014', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH' },
      { window_id: 'W00040', thread_id: 'THREAD-009', shipment_id: 'S009', container_id: 'C118', risk_tier: 'LOW' },
    ]);
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText(/S014/)).toBeInTheDocument();
  });

  it('resolves two runs sharing the same window_id to two different pages, keyed by thread_id', () => {
    const history = [
      { window_id: 'W00890', thread_id: 'THREAD-AAA', shipment_id: 'S015', risk_tier: 'CRITICAL', decision_summary: 'First run' },
      { window_id: 'W00890', thread_id: 'THREAD-BBB', shipment_id: 'S015', risk_tier: 'CRITICAL', decision_summary: 'Second run' },
    ];
    renderAt('THREAD-AAA', history);
    expect(screen.getByText('First run')).toBeInTheDocument();
    expect(screen.queryByText('Second run')).not.toBeInTheDocument();
  });

  it('falls back to window_id + timestamp as the key when thread_id is missing', () => {
    renderAt('W00890_2026-06-18T18:15:18.922614+00:00', [
      { window_id: 'W00890', timestamp: '2026-06-18T18:15:18.922614+00:00', shipment_id: 'S015', risk_tier: 'CRITICAL' },
    ]);
    expect(screen.getByText('W00890')).toBeInTheDocument();
  });

  it('shows an empty state when the run key is not found in history', () => {
    renderAt('NOT-A-REAL-KEY', [{ window_id: 'W00040', thread_id: 'THREAD-009', risk_tier: 'LOW' }]);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('shows a loading state while history is loading and has no data yet', () => {
    renderAt('THREAD-014', null, true);
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('renders a back link to the Agent Activity list', () => {
    renderAt('THREAD-014', [{ window_id: 'W00041', thread_id: 'THREAD-014', risk_tier: 'LOW' }]);
    expect(screen.getByText(/back to agent activity/i)).toBeInTheDocument();
  });

  it('renders the decision_summary and llm_reasoning in a summary banner', () => {
    renderAt('THREAD-890', [{
      window_id: 'W00890',
      thread_id: 'THREAD-890',
      risk_tier: 'CRITICAL',
      decision_summary: 'Graph paused at human_review — 4 tool(s) executed.',
      llm_reasoning: 'The shipment has already breached critical temperature limits.',
    }]);
    expect(screen.getByText(/Graph paused at human_review/)).toBeInTheDocument();
    expect(screen.getByText(/already breached critical temperature limits/)).toBeInTheDocument();
  });

  it('renders real meta fields (status, requires_approval, approval_id, thread_id, replan_count) instead of fields not present on the payload', () => {
    renderAt('THREAD-456', [{
      window_id: 'W00890',
      thread_id: 'THREAD-456',
      risk_tier: 'CRITICAL',
      status: 'awaiting_human_review',
      requires_approval: true,
      replan_count: 0,
      approval_id: 'APPROVAL-123',
    }]);
    expect(screen.getByText(/awaiting human review/i)).toBeInTheDocument();
    expect(screen.getByText('APPROVAL-123')).toBeInTheDocument();
    expect(screen.getByText('THREAD-456')).toBeInTheDocument();
  });
});
