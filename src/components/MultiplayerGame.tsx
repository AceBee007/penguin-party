import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixiDragStage, type StageDragStatus } from './PixiDragStage';
import {
  CARD_COLOR_LABELS,
  createLocalGame,
  getActivePlayer,
  getCurrentRoundPlayer,
  getFinalStandings,
  getLegalMovesForPlayer,
  playCard,
} from '../game/rules';
import type { CardId, GameSessionState, MoveTarget, PlayerId } from '../game/types';
import { PeerMeshClient } from '../network/peerMesh';
import { createRoom, joinRoom, markRoomPlaying } from '../network/signalingClient';
import type {
  EventCommitted,
  HostHello,
  NetworkIdentity,
  P2PEnvelope,
  PeerReady,
  PeerRuntimeView,
  PeerSummary,
  PlayerCommand,
} from '../network/types';

const INITIAL_DRAG_STATUS: StageDragStatus = {
  selectedCard: 'Ready',
  target: 'No target',
};

export function MultiplayerGame() {
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [game, setGame] = useState<GameSessionState | null>(null);
  const [peers, setPeers] = useState<PeerRuntimeView[]>([]);
  const [dragStatus, setDragStatus] = useState<StageDragStatus>(INITIAL_DRAG_STATUS);
  const [roomName, setRoomName] = useState('Penguin Table');
  const [displayName, setDisplayName] = useState('Peer A');
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('Peer B');
  const [message, setMessage] = useState('Create or join a local P2P room.');
  const [networkStatus, setNetworkStatus] = useState('idle');
  const meshRef = useRef<PeerMeshClient | null>(null);
  const identityRef = useRef<NetworkIdentity | null>(null);
  const gameRef = useRef<GameSessionState | null>(null);
  const peersRef = useRef<PeerRuntimeView[]>([]);
  const eventSeqRef = useRef(0);

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(
    () => () => {
      meshRef.current?.close();
    },
    [],
  );

  const activePlayer = game ? getActivePlayer(game) : null;
  const localPlayerId = identity?.playerId ?? null;
  const isLocalTurn = Boolean(game && localPlayerId && activePlayer?.playerId === localPlayerId);
  const legalMoves = useMemo(
    () => (game && localPlayerId && isLocalTurn ? getLegalMovesForPlayer(game, localPlayerId) : []),
    [game, isLocalTurn, localPlayerId],
  );
  const activeRoundPlayer = game && localPlayerId ? getCurrentRoundPlayer(game, localPlayerId) : null;
  const standings = game ? getFinalStandings(game) : [];
  const connectedPeerCount = peers.filter((peer) => peer.connectionStatus === 'connected').length;

  const startMesh = useCallback((nextIdentity: NetworkIdentity) => {
    meshRef.current?.close();
    const mesh = new PeerMeshClient({
      identity: nextIdentity,
      hostPeerId: nextIdentity.room.hostPeerId,
      onPeersChanged: (nextPeers) => {
        setPeers(nextPeers);
      },
      onPayload: (envelope) => handleP2PPayload(envelope),
      onChannelOpen: (peer) => {
        setMessage(`DataChannel open with ${peer.displayName}.`);

        if (nextIdentity.role === 'host') {
          const snapshot = ensureHostGame(nextIdentity, peer);
          sendHostHello(nextIdentity, peer, snapshot);
        }
      },
      onStatus: (status) => {
        setNetworkStatus(status);
      },
    });

    meshRef.current = mesh;
    setIdentity(nextIdentity);
    setPeers([
      {
        peerId: nextIdentity.peerId,
        playerId: nextIdentity.playerId,
        displayName: nextIdentity.displayName,
        role: nextIdentity.role,
        connectionStatus: 'signaling',
      },
      ...nextIdentity.existingPeers.map((peer) => ({
        peerId: peer.peerId,
        playerId: peer.playerId,
        displayName: peer.displayName,
        role: peer.role,
        connectionStatus: 'signaling' as const,
      })),
    ]);
    mesh.connect();
  }, []);

  const handleCreateRoom = useCallback(async () => {
    try {
      const nextIdentity = await createRoom({
        roomName,
        hostDisplayName: displayName,
        visibility: 'public',
        maxPlayers: 6,
      });
      setMessage(`Room ${nextIdentity.room.roomId} created. Waiting for Peer B.`);
      startMesh(nextIdentity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Room creation failed.');
    }
  }, [displayName, roomName, startMesh]);

  const handleJoinRoom = useCallback(async () => {
    try {
      const nextIdentity = await joinRoom(joinCode.trim().toUpperCase(), {
        displayName: joinName,
      });
      setMessage(`Joined room ${nextIdentity.room.roomId}. Waiting for host snapshot.`);
      startMesh(nextIdentity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Join failed.');
    }
  }, [joinCode, joinName, startMesh]);

  const handlePlayCard = useCallback(
    (cardId: CardId, target: MoveTarget) => {
      const currentIdentity = identityRef.current;
      const currentGame = gameRef.current;

      if (!currentIdentity || !currentGame || !currentIdentity.playerId) {
        return;
      }

      if (currentIdentity.role === 'host') {
        commitHostMove(currentIdentity.playerId, cardId, target, null);
        return;
      }

      const command: PlayerCommand = {
        type: 'player_command',
        commandId: createCommandId(),
        playerId: currentIdentity.playerId,
        command: { type: 'play_card', cardId, target },
        clientRevision: currentGame.revision,
        clientSentAt: Date.now(),
      };
      meshRef.current?.sendPayload(currentIdentity.room.hostPeerId, command);
      setMessage('Sent play_card command to host.');
    },
    [],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__copy">
            <h1 className="brand__title">Penguin Party</h1>
            <span className="brand__mode">Two-peer P2P mode</span>
          </div>
        </div>
        <div className="connection-indicator" aria-label={`P2P status ${networkStatus}`}>
          <span className="connection-indicator__dot" />
          {networkStatus}
        </div>
      </header>

      {!identity ? (
        <section className="multiplayer-lobby" aria-label="P2P lobby">
          <div className="lobby-panel">
            <h2>Create room</h2>
            <label>
              Room name
              <input value={roomName} maxLength={32} onChange={(event) => setRoomName(event.target.value)} />
            </label>
            <label>
              Display name
              <input value={displayName} maxLength={16} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <button type="button" onClick={handleCreateRoom}>
              Create room
            </button>
          </div>

          <div className="lobby-panel">
            <h2>Join room</h2>
            <label>
              Room code
              <input
                data-room-code-input
                value={joinCode}
                maxLength={8}
                onChange={(event) => setJoinCode(event.target.value)}
              />
            </label>
            <label>
              Display name
              <input value={joinName} maxLength={16} onChange={(event) => setJoinName(event.target.value)} />
            </label>
            <button type="button" onClick={handleJoinRoom}>
              Join room
            </button>
          </div>
          <p className="lobby-message" data-game-message>{message}</p>
        </section>
      ) : (
        <section className="game-shell" aria-label="Penguin Party P2P game">
          <aside className="scoreboard" aria-label="Peers">
            <div className="scoreboard__header">
              <span>Room <strong data-room-id>{identity.room.roomId}</strong></span>
              <strong data-channel-state>{connectedPeerCount > 1 ? 'Open' : 'Connecting'}</strong>
            </div>
            <div className="player-list">
              {peers.map((peer) => (
                <div className="player-row" data-active={peer.playerId === activePlayer?.playerId} key={peer.peerId}>
                  <div>
                    <strong>{peer.displayName}</strong>
                    <span>{peer.role} / {peer.connectionStatus}</span>
                  </div>
                  <div className="player-row__stats">
                    <span>{peer.playerId ?? 'spectator'}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="play-area">
            <div className="hud" aria-live="polite">
              <div>
                <span>Turn</span>
                <strong data-active-player>{activePlayer?.displayName ?? 'Waiting'}</strong>
              </div>
              <div>
                <span>Local</span>
                <strong data-local-player>{identity.displayName}</strong>
              </div>
              <div>
                <span>Card</span>
                <strong data-selected-card>{dragStatus.selectedCard}</strong>
              </div>
              <div>
                <span>Hash</span>
                <strong data-state-hash>{game?.stateHash ?? 'none'}</strong>
              </div>
            </div>

            <div className="stage-frame">
              {game ? (
                <PixiDragStage
                  activePlayerId={activePlayer?.playerId ?? null}
                  canPlay={isLocalTurn}
                  game={game}
                  handPlayerId={localPlayerId}
                  legalMoves={legalMoves}
                  onDragStatusChange={setDragStatus}
                  onPlayCard={handlePlayCard}
                />
              ) : (
                <div className="waiting-canvas" data-waiting-for-snapshot>
                  Waiting for host snapshot
                </div>
              )}
            </div>

            <div className="action-bar">
              <p data-game-message>{message}</p>
              <div className="action-bar__buttons">
                <button type="button" onClick={() => window.location.assign('/?mode=multiplayer')}>
                  Leave
                </button>
              </div>
            </div>
          </section>

          <aside className="round-panel" aria-label="P2P details">
            <div className="metric-grid">
              <div>
                <span>Board</span>
                <strong data-board-count>{game?.currentRound?.board.occupiedCellKeys.length ?? 0}</strong>
              </div>
              <div>
                <span>Hand</span>
                <strong data-hand-count>{activeRoundPlayer?.remainingCardCount ?? 0}</strong>
              </div>
              <div>
                <span>Legal</span>
                <strong data-legal-count>{legalMoves.length}</strong>
              </div>
              <div>
                <span>Revision</span>
                <strong data-revision>{game?.revision ?? 0}</strong>
              </div>
            </div>

            {game?.status === 'game_result' ? (
              <div className="summary-panel" data-game-result>
                <h2>Final</h2>
                {standings.map((standing) => (
                  <div className="summary-row" key={standing.playerId}>
                    <span>#{standing.rank} {standing.displayName}</span>
                    <strong>{standing.totalPenalty} pts</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>
        </section>
      )}
    </main>
  );

  function handleP2PPayload(envelope: P2PEnvelope): void {
    const payload = envelope.payload;

    if (payload.type === 'host_hello') {
      gameRef.current = payload.snapshot;
      setGame(payload.snapshot);
      setMessage('Received host snapshot.');
      sendPeerReady(payload.snapshot);
      return;
    }

    if (payload.type === 'peer_ready') {
      setMessage('Peer is ready.');
      return;
    }

    if (payload.type === 'player_command') {
      const sourcePeerId = envelope.fromPeerId;
      commitHostMove(payload.playerId, payload.command.cardId, payload.command.target, sourcePeerId, payload.commandId);
      return;
    }

    if (payload.type === 'event_committed') {
      gameRef.current = payload.snapshot;
      setGame(payload.snapshot);
      setDragStatus(INITIAL_DRAG_STATUS);
      setMessage(`Committed event ${payload.eventSeq}; revision ${payload.revision}.`);
      return;
    }

    if (payload.type === 'command_rejected') {
      setMessage(`Command rejected: ${payload.reason}`);
    }
  }

  function ensureHostGame(currentIdentity: NetworkIdentity, peer: PeerSummary): GameSessionState {
    if (gameRef.current) {
      return gameRef.current;
    }

    const playerPeers = [
      {
        playerId: currentIdentity.playerId,
        displayName: currentIdentity.displayName,
      },
      {
        playerId: peer.playerId,
        displayName: peer.displayName,
      },
    ]
      .filter((candidate): candidate is { playerId: PlayerId; displayName: string } => Boolean(candidate.playerId))
      .sort((left, right) => numericPlayerIndex(left.playerId) - numericPlayerIndex(right.playerId));
    const snapshot = createLocalGame({
      playerCount: playerPeers.length,
      playerNames: playerPeers.map((player) => player.displayName),
      seed: `room-${currentIdentity.room.roomId}`,
    });

    gameRef.current = snapshot;
    setGame(snapshot);
    void markRoomPlaying(currentIdentity.room.roomId);
    setMessage('Game snapshot created by host.');
    return snapshot;
  }

  function sendHostHello(currentIdentity: NetworkIdentity, peer: PeerSummary, snapshot: GameSessionState): void {
    const allPeers = [toPeerRuntime(currentIdentity), ...peersRef.current].filter(
      (candidate, index, candidates) => candidates.findIndex((item) => item.peerId === candidate.peerId) === index,
    );
    const payload: HostHello = {
      type: 'host_hello',
      currentHostPeerId: currentIdentity.peerId,
      hostEpoch: 1,
      playerIdByPeerId: Object.fromEntries(allPeers.map((item) => [item.peerId, item.playerId])),
      roleByPeerId: Object.fromEntries(allPeers.map((item) => [item.peerId, item.role])),
      snapshot,
    };

    meshRef.current?.sendPayload(peer.peerId, payload);
  }

  function sendPeerReady(snapshot: GameSessionState): void {
    const currentIdentity = identityRef.current;

    if (!currentIdentity) {
      return;
    }

    const payload: PeerReady = {
      type: 'peer_ready',
      playerId: currentIdentity.playerId,
      role: currentIdentity.role,
      ready: true,
      stateRevision: snapshot.revision,
      stateHash: snapshot.stateHash,
    };

    meshRef.current?.sendPayload(currentIdentity.room.hostPeerId, payload);
  }

  function commitHostMove(
    playerId: PlayerId,
    cardId: CardId,
    target: MoveTarget,
    sourcePeerId: string | null,
    commandId = createCommandId(),
  ): void {
    const currentIdentity = identityRef.current;
    const currentGame = gameRef.current;

    if (!currentIdentity || currentIdentity.role !== 'host' || !currentGame) {
      return;
    }

    try {
      const result = playCard(currentGame, playerId, cardId, target);
      const nextGame = result.state;
      eventSeqRef.current += 1;
      gameRef.current = nextGame;
      setGame(nextGame);
      setDragStatus(INITIAL_DRAG_STATUS);
      setMessage(`${currentGame.players.find((player) => player.playerId === playerId)?.displayName} played ${CARD_COLOR_LABELS[currentGame.cardsById[cardId].color]}.`);

      const payload: EventCommitted = {
        type: 'event_committed',
        event: result.event,
        eventSeq: eventSeqRef.current,
        revision: nextGame.revision,
        stateHash: nextGame.stateHash,
        snapshot: nextGame,
      };
      meshRef.current?.broadcastPayload(payload);
    } catch {
      if (sourcePeerId) {
        meshRef.current?.sendPayload(sourcePeerId, {
          type: 'command_rejected',
          commandId,
          reason: 'illegal_move',
          expectedRevision: currentGame.revision,
        });
      }
    }
  }
}

function toPeerRuntime(identity: NetworkIdentity): PeerRuntimeView {
  return {
    peerId: identity.peerId,
    playerId: identity.playerId,
    displayName: identity.displayName,
    role: identity.role,
    connectionStatus: 'connected',
  };
}

function numericPlayerIndex(playerId: PlayerId): number {
  return Number(playerId.replace(/\D+/g, '')) || 0;
}

function createCommandId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
