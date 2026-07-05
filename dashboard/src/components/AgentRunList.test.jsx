import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentRunList from './AgentRunList';

const HISTORY = [
  { window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH', awaiting_approval: true },
  { window_id: 'W00040', shipment_id: 'S009', container_id: 'C118', risk_tier: 'LOW', actions_taken: [{ tool: 'route_agent' }] },
];

function renderList(props) {
  return render(<MemoryRouter><AgentRunList history={HISTORY} loading={false} {...props} /></MemoryRouter>);
}

describe('AgentRunList', () => {
  it('renders one row per history entry', () => {
    renderList();
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText('W00040')).toBeInTheDocument();
  });

  it('filters by search text matching window id', () => {
    renderList();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'W00041' } });
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.queryByText('W00040')).not.toBeInTheDocument();
  });

  it('shows an empty state when history is an empty array', () => {
    render(<MemoryRouter><AgentRunList history={[]} loading={false} /></MemoryRouter>);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });

  it('shows a loading state when loading is true and history is null', () => {
    render(<MemoryRouter><AgentRunList history={null} loading={true} /></MemoryRouter>);
    expect(screen.queryByText(/no runs/i)).not.toBeInTheDocument();
  });

  it('renders a KPI strip with total/critical/awaiting/resolved counts from the full history', () => {
    renderList();
    expect(screen.getByText('Total Runs')).toBeInTheDocument();
    // 2 total runs in HISTORY
    expect(screen.getByTestId('kpi-total').textContent).toBe('2');
    // 0 entries have risk_tier CRITICAL
    expect(screen.getByTestId('kpi-critical').textContent).toBe('0');
    // 1 entry has awaiting_approval: true
    expect(screen.getByTestId('kpi-awaiting').textContent).toBe('1');
    // 1 entry has actions_taken with no open issues
    expect(screen.getByTestId('kpi-resolved').textContent).toBe('1');
  });

  it('filters rows by the Awaiting Approval chip', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /^awaiting approval/i }));
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.queryByText('W00040')).not.toBeInTheDocument();
  });

  it('filters rows by the Resolved chip', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /^resolved/i }));
    expect(screen.getByText('W00040')).toBeInTheDocument();
    expect(screen.queryByText('W00041')).not.toBeInTheDocument();
  });

  it('shows all rows again when the All chip is clicked after filtering', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /^resolved/i }));
    fireEvent.click(screen.getByRole('button', { name: /^all/i }));
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText('W00040')).toBeInTheDocument();
  });

  it('sorts by highest risk when that sort option is selected', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /highest risk/i }));
    const rows = screen.getAllByText(/^W000\d\d$/).map(el => el.textContent);
    // HIGH should sort before LOW
    expect(rows.indexOf('W00041')).toBeLessThan(rows.indexOf('W00040'));
  });
});
