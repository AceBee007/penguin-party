import { useCallback, useState } from 'react';
import { PixiDragStage, type DragStatus } from './components/PixiDragStage';

const INITIAL_DRAG_STATUS: DragStatus = {
  selectedToken: 'Ready',
  position: '0, 0',
};

export function App() {
  const [dragStatus, setDragStatus] = useState<DragStatus>(INITIAL_DRAG_STATUS);

  const handleDragStatusChange = useCallback((status: DragStatus) => {
    setDragStatus(status);
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <h1 className="brand__title">Penguin Party</h1>
        </div>
        <div className="status-strip" aria-live="polite">
          <span className="status-pill" data-selected-token>
            {dragStatus.selectedToken}
          </span>
          <span className="status-pill" data-position-readout>
            {dragStatus.position}
          </span>
        </div>
      </header>
      <section className="game-shell">
        <PixiDragStage onDragStatusChange={handleDragStatusChange} />
      </section>
    </main>
  );
}
