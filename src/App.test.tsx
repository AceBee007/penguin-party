import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./components/PixiDragStage', () => ({
  PixiDragStage: ({
    onDragStatusChange,
  }: {
    onDragStatusChange: (status: { selectedToken: string; position: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onDragStatusChange({
          selectedToken: 'Penguin 1',
          position: '12, 34',
        })
      }
    >
      Mock Pixi Drag
    </button>
  ),
}));

describe('App', () => {
  it('renders the initial React shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Penguin Party' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('0, 0')).toBeInTheDocument();
  });

  it('updates the HUD when the Pixi stage reports a drag status', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Mock Pixi Drag' }));

    expect(screen.getByText('Penguin 1')).toBeInTheDocument();
    expect(screen.getByText('12, 34')).toBeInTheDocument();
  });
});
