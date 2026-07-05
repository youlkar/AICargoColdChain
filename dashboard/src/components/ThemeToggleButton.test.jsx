import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeContext';
import ThemeToggleButton from './ThemeToggleButton';

function renderButton() {
  return render(
    <ThemeProvider>
      <ThemeToggleButton />
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.removeItem('theme');
  document.documentElement.classList.remove('light');
});

describe('ThemeToggleButton', () => {
  it('shows "Light mode" label when currently dark', () => {
    renderButton();
    expect(screen.getByText(/light mode/i)).toBeInTheDocument();
  });

  it('toggles the html.light class and localStorage on click', () => {
    renderButton();
    expect(document.documentElement.classList.contains('light')).toBe(false);
    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('shows "Dark mode" label after toggling to light', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/dark mode/i)).toBeInTheDocument();
  });

  it('toggles back to dark on a second click', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
