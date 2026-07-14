import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentActivity from './AgentActivity';
import * as useApiModule from '../hooks/useApi';
import * as useWebSocketModule from '../hooks/useWebSocket';
import { OrchestrationStreamProvider } from '../lib/OrchestrationStreamContext';

function renderPage(history) {
  vi.spyOn(useApiModule, 'useApi').mockImplementation((path) => {
    if (path.includes('/orchestrator/history')) return { data: history, loading: false, error: null, refetch: vi.fn() };
    return { data: { active_provider: 'groq' }, loading: false, error: null, refetch: vi.fn() };
  });
  vi.spyOn(useWebSocketModule, 'useWebSocket').mockReturnValue({ messages: [], connected: true, clearMessages: vi.fn() });
  return render(
    <MemoryRouter>
      <OrchestrationStreamProvider>
        <AgentActivity />
      </OrchestrationStreamProvider>
    </MemoryRouter>
  );
}

describe('AgentActivity (redesigned)', () => {
  it('renders the run list with history entries', () => {
    renderPage([{ window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH' }]);
    expect(screen.getByText('W00041')).toBeInTheDocument();
  });

  it('renders the run-launch panel (window id input + run button)', () => {
    renderPage([]);
    expect(screen.getByPlaceholderText(/window id \(/i)).toBeInTheDocument();
  });

  it('does not render an Overview/Technical view toggle', () => {
    renderPage([]);
    expect(screen.queryByText(/^overview$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^technical$/i)).not.toBeInTheDocument();
  });
});
