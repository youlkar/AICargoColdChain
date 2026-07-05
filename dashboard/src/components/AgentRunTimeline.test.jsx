import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentRunTimeline from './AgentRunTimeline';

function renderTimeline(decision) {
  return render(<MemoryRouter><AgentRunTimeline decision={decision} /></MemoryRouter>);
}

const DECISION = {
  timestamp: '2026-06-20T09:14:02Z',
  draft_plan: [{ step: 1, action: 'reroute', tool: 'route_agent' }],
  actions_taken: [{ tool: 'route_agent', result: { status: 'ok' } }],
  reflection_notes: ['missing cert'],
  awaiting_approval: true,
};

describe('AgentRunTimeline', () => {
  it('renders one entry per timeline step in order', () => {
    renderTimeline(DECISION);
    const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
    expect(headings).toEqual(['Interpret & Plan', 'Execute', 'Reflect', 'Awaiting human approval']);
  });

  it('renders summary text collapsed by default', () => {
    renderTimeline(DECISION);
    expect(screen.getByText('missing cert')).toBeInTheDocument();
  });

  it('expands a step detail on click', () => {
    renderTimeline(DECISION);
    fireEvent.click(screen.getByText('Execute'));
    expect(screen.getByText('Route Agent')).toBeInTheDocument();
  });

  it('renders nothing but an empty container for a decision with no steps', () => {
    const { container } = renderTimeline({});
    expect(container.querySelectorAll('h4').length).toBe(0);
  });

  it('renders a chevron icon for each step header that rotates when expanded', () => {
    const { container } = renderTimeline(DECISION);
    const chevrons = container.querySelectorAll('.lucide-chevron-down');
    expect(chevrons.length).toBe(4);
    fireEvent.click(screen.getByText('Execute'));
    const executeButton = screen.getByText('Execute').closest('button');
    expect(executeButton.querySelector('.lucide-chevron-down')).toHaveClass('rotate-180');
  });

  it('renders a link to the Approvals page in the awaiting-approval step detail', () => {
    renderTimeline(DECISION);
    fireEvent.click(screen.getByText('Awaiting human approval'));
    const link = screen.getByRole('link', { name: /go to approvals/i });
    expect(link).toHaveAttribute('href', '/approvals');
  });

  it('renders the step time as a human-readable date, not the raw ISO string', () => {
    renderTimeline(DECISION);
    expect(screen.queryByText(DECISION.timestamp)).not.toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('shows the agent display name in the plan step, not the raw tool id', () => {
    renderTimeline({
      draft_plan: [{ step: 1, action: 'log event', tool: 'compliance_agent' }],
    });
    fireEvent.click(screen.getByText('Interpret & Plan'));
    expect(screen.getByText('Compliance Agent')).toBeInTheDocument();
    expect(screen.queryByText('[compliance_agent]')).not.toBeInTheDocument();
  });

  it('gives each step marker a valid CSS background-color value (not a malformed var()+hex string)', () => {
    const { container } = renderTimeline(DECISION);
    const markers = container.querySelectorAll('span.rounded-full.flex.items-center.justify-center');
    expect(markers.length).toBeGreaterThan(0);
    markers.forEach(marker => {
      expect(marker.style.backgroundColor).not.toBe('');
      expect(marker.style.backgroundColor).not.toContain('var(--accent-emerald)33');
    });
  });
});
