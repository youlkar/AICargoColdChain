import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentLiveStrip from './AgentLiveStrip';

describe('AgentLiveStrip', () => {
  it('renders nothing when there is no active windowId', () => {
    const { container } = render(<AgentLiveStrip windowId={null} currentWave={1} agentStatus={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the window id and current wave when active', () => {
    render(<AgentLiveStrip windowId="W00042" currentWave={2} agentStatus={{ route_agent: 'done' }} />);
    expect(screen.getByText('W00042')).toBeInTheDocument();
    expect(screen.getByText(/wave 2/i)).toBeInTheDocument();
  });

  it('renders a status chip per known agent in agentStatus', () => {
    render(<AgentLiveStrip windowId="W00042" currentWave={1} agentStatus={{ route_agent: 'running', insurance_agent: 'idle' }} />);
    expect(screen.getByText('Route Agent')).toBeInTheDocument();
    expect(screen.getByText('Insurance')).toBeInTheDocument();
  });
});
