import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity, TrendingUp } from 'lucide-react';
import StatCard from './StatCard';

describe('StatCard', () => {
  it('renders the icon chip with a valid color-mix background, not the old malformed string', () => {
    const { container } = render(<StatCard icon={Activity} label="Runs" value={42} accent="cyan" />);
    const chip = container.querySelector('div[style*="background-color"]');
    expect(chip).toBeTruthy();
    const bg = chip.style.backgroundColor;
    expect(bg).not.toBe('');
    expect(bg).not.toMatch(/var\(--accent-cyan\)1f/);
  });

  it('renders label and value', () => {
    render(<StatCard icon={Activity} label="Runs" value={42} accent="cyan" />);
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders an optional delta line with icon and text', () => {
    render(
      <StatCard icon={Activity} label="Runs" value={42} accent="cyan"
        delta={{ icon: TrendingUp, text: '12% vs previous 24h', tone: 'ok' }} />
    );
    expect(screen.getByText('12% vs previous 24h')).toBeInTheDocument();
  });

  it('omits the delta line when none is provided', () => {
    const { container } = render(<StatCard icon={Activity} label="Runs" value={42} accent="cyan" />);
    expect(container.textContent).not.toMatch(/vs previous/);
  });
});
