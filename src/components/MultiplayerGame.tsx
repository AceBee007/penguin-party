import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixiDragStage, type StageDragStatus } from './PixiDragStage';
import {
  CARD_COLOR_LABELS,
  buildStateHash,
  createLocalGame,
  getActivePlayer,
  getCurrentRoundPlayer,
  getFinalStandings,
  getLegalMovesForPlayer,
  playCard,
} from '../game/rules';
import type { CardId, GameSessionState, MoveTarget, PlayerId, RoundPlayerState } from '../game/types';
import { electNextHostPeerId } from '../network/hostElection';
import { PeerMeshClient } from '../network/peerMesh';
import { createRoom, joinRoom, markRoomPlaying } from '../network/signalingClient';
import type {
  EventCommitted,
  Heartbeat,
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
  const [createPassword, setCreatePassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('Peer B');
  const [joinPassword, setJoinPassword] = useState('');
  const [message, setMessage] = useState('Create or join a local P2P room.');
  const [networkStatus, setNetworkStatus] = useState('idle');
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const meshRef = useRef<PeerMeshClient | null>(null);
  const identityRef = useRef<NetworkIdentity | null>(null);
  const gameRef = useRef<GameSessionState | null>(null);
  const peersRef = useRef<PeerRuntimeView[]>([]);
  const hostPeerIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    hostPeerIdRef.current = hostPeerId;
  }, [hostPeerId]);

  useEffect(() => {
    window.__PENGUIN_DEBUG__ = {
      game,
      hostPeerId,
      identity,
      peers,
    };
  }, [game, hostPeerId, identity, peers]);

  useEffect(
    () => () => {
      meshRef.current?.close();
      delete window.__PENGUIN_DEBUG__;
    },
    [],
  );

  useEffect(() => {
    if (!identity || identity.peerId !== hostPeerId || !game) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const currentGame = gameRef.current;

      if (!currentGame) {
        return;
      }

      sendHostHeartbeat(identity, currentGame);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [game, hostPeerId, identity]);

  const activePlayer = game ? getActivePlayer(game) : null;
  const localPlayerId = identity?.playerId ?? null;
  const isHost = Boolean(identity && hostPeerId === identity.peerId);
  const isSpectator = identity?.role === 'spectator';
  const isLocalTurn = Boolean(game && localPlayerId && activePlayer?.playerId === localPlayerId && !isSpectator);
  const legalMoves = useMemo(
    () => (game && localPlayerId && isLocalTurn ? getLegalMovesForPlayer(game, localPlayerId) : []),
    [game, isLocalTurn, localPlayerId],
  );
  const activeRoundPlayer = game && localPlayerId ? getCurrentRoundPlayer(game, localPlayerId) : null;
  const standings = game ? getFinalStandings(game) : [];
  const connectedPeerCount = peers.filter((peer) => peer.connectionStatus === 'connected').length;
  const playerCount = peers.filter((peer) => peer.role !== 'spectator').length;
  const spectatorCount = peers.filter((peer) => peer.role === 'spectator').length;
  const canStartGame = Boolean(isHost && !game && playerCount >= 2);

  const startMesh = useCallback((nextIdentity: NetworkIdentity) => {
    meshRef.current?.close();
    const nextHostPeerId = nextIdentity.room.hostPeerId;
    const mesh = new PeerMeshClient({
      identity: nextIdentity,
      hostPeerId: nextHostPeerId,
      onPeersChanged: (nextPeers) => {
        setPeers(nextPeers);
      },
      onPayload: (envelope) => handleP2PPayload(envelope),
      onChannelOpen: (peer) => {
        setMessage(`DataChannel open with ${peer.displayName}.`);

        if (nextIdentity.peerId === hostPeerIdRef.current && gameRef.current) {
          sendHostHello(nextIdentity, peer, gameRef.current);
        }
      },
      onPeerLeft: (peerId) => {
        handlePeerLeft(peerId);
      },
      onStatus: (status) => {
        setNetworkStatus(status);
      },
    });

    meshRef.current = mesh;
    setIdentity(nextIdentity);
    setHostPeerId(nextHostPeerId);
    hostPeerIdRef.current = nextHostPeerId;
    setPeers([
      toPeerRuntime(nextIdentity, 'signaling'),
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
      const password = createPassword.trim();
      const nextIdentity = await createRoom({
        roomName,
        hostDisplayName: displayName,
        visibility: password ? 'private' : 'public',
        password: password || undefined,
        maxPlayers: 6,
      });
      setMessage(`Room ${nextIdentity.room.roomId} created. Waiting for players.`);
      startMesh(nextIdentity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Room creation failed.');
    }
  }, [createPassword, displayName, roomName, startMesh]);

  const handleJoinRoom = useCallback(async () => {
    try {
      const nextIdentity = await joinRoom(joinCode.trim().toUpperCase(), {
        displayName: joinName,
        password: joinPassword.trim() || undefined,
      });
      setMessage(`Joined room ${nextIdentity.room.roomId}.`);
      startMesh(nextIdentity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Join failed.');
    }
  }, [joinCode, joinName, joinPassword, startMesh]);

  const handleStartGame = useCallback(() => {
    const currentIdentity = identityRef.current;

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current) {
      return;
    }

    const playerPeers = getPlayerPeers(currentIdentity, peersRef.current);
    const snapshot = createLocalGame({
      playerCount: playerPeers.length,
      playerNames: playerPeers.map((peer) => peer.displayName),
      seed: `room-${currentIdentity.room.roomId}`,
    });

    eventSeqRef.current = 0;
    gameRef.current = snapshot;
    setGame(snapshot);
    void markRoomPlaying(currentIdentity.room.roomId);
    setMessage(`Started ${playerPeers.length}-player game.`);

    for (const peer of peersRef.current) {
      if (peer.peerId !== currentIdentity.peerId) {
        sendHostHello(currentIdentity, peer, snapshot);
      }
    }
  }, []);

  const handlePlayCard = useCallback((cardId: CardId, target: MoveTarget) => {
    const currentIdentity = identityRef.current;
    const currentGame = gameRef.current;
    const currentHostPeerId = hostPeerIdRef.current;

    if (!currentIdentity || !currentGame || !currentIdentity.playerId || currentIdentity.role === 'spectator') {
      return;
    }

    if (currentIdentity.peerId === currentHostPeerId) {
      commitHostMove(currentIdentity.playerId, cardId, target, null);
      return;
    }

    if (!currentHostPeerId) {
      setMessage('No current host is available.');
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
    meshRef.current?.sendPayload(currentHostPeerId, command);
    setMessage('Sent play_card command to host.');
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__copy">
            <h1 className="brand__title">Penguin Party</h1>
            <span className="brand__mode">P2P party room</span>
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
              <input
                data-create-name
                value={displayName}
                maxLength={16}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                data-create-password
                value={createPassword}
                maxLength={20}
                onChange={(event) => setCreatePassword(event.target.value)}
              />
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
              <input
                data-join-name
                value={joinName}
                maxLength={16}
                onChange={(event) => setJoinName(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                data-join-password
                value={joinPassword}
                maxLength={20}
                onChange={(event) => setJoinPassword(event.target.value)}
              />
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
                <span>Role</span>
                <strong data-local-role>{identity.role}</strong>
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
                  Waiting for host start
                </div>
              )}
            </div>

            <div className="action-bar">
              <p data-game-message>{message}</p>
              <div className="action-bar__buttons">
                {canStartGame ? (
                  <button data-start-game type="button" onClick={handleStartGame}>
                    Start game
                  </button>
                ) : null}
                <button type="button" onClick={() => window.location.assign('/')}>
                  Leave
                </button>
              </div>
            </div>
          </section>

          <aside className="round-panel" aria-label="P2P details">
            <div className="metric-grid">
              <div>
                <span>Players</span>
                <strong data-player-count>{playerCount}</strong>
              </div>
              <div>
                <span>Connected</span>
                <strong data-connected-count>{connectedPeerCount}</strong>
              </div>
              <div>
                <span>Spectators</span>
                <strong data-spectator-count>{spectatorCount}</strong>
              </div>
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
              <div>
                <span>Host</span>
                <strong data-host-peer>{hostPeerId ?? 'none'}</strong>
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
      setHostPeerId(payload.currentHostPeerId);
      hostPeerIdRef.current = payload.currentHostPeerId;
      meshRef.current?.setHostPeerId(payload.currentHostPeerId);
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

    if (payload.type === 'player_command' && identityRef.current?.peerId === hostPeerIdRef.current) {
      commitHostMove(payload.playerId, payload.command.cardId, payload.command.target, envelope.fromPeerId, payload.commandId);
      return;
    }

    if (payload.type === 'event_committed') {
      gameRef.current = payload.snapshot;
      setGame(payload.snapshot);
      setDragStatus(INITIAL_DRAG_STATUS);
      setMessage(`Committed event ${payload.eventSeq}; revision ${payload.revision}.`);
      return;
    }

    if (payload.type === 'heartbeat') {
      setHostPeerId(payload.hostPeerId);
      hostPeerIdRef.current = payload.hostPeerId;
      meshRef.current?.setHostPeerId(payload.hostPeerId);

      if (
        payload.snapshot &&
        (!gameRef.current ||
          payload.revision > gameRef.current.revision ||
          (payload.revision === gameRef.current.revision && payload.stateHash !== gameRef.current.stateHash))
      ) {
        gameRef.current = payload.snapshot;
        setGame(payload.snapshot);
        setDragStatus(INITIAL_DRAG_STATUS);
      }

      setNetworkStatus(`host rev ${payload.revision}`);
      return;
    }

    if (payload.type === 'command_rejected') {
      setMessage(`Command rejected: ${payload.reason}`);
    }
  }

  function handlePeerLeft(peerId: string): void {
    if (peerId !== hostPeerIdRef.current) {
      return;
    }

    const currentIdentity = identityRef.current;
    const currentGame = gameRef.current;
    const leftPeer = peersRef.current.find((peer) => peer.peerId === peerId);

    if (!currentIdentity || !currentGame) {
      return;
    }

    const candidates = [toPeerRuntime(currentIdentity, 'connected'), ...peersRef.current]
      .filter((peer) => peer.peerId !== peerId)
      .filter((peer, index, all) => all.findIndex((candidate) => candidate.peerId === peer.peerId) === index)
      .map((peer) => ({ ...peer, connectionStatus: peer.connectionStatus === 'signaling' ? 'connected' : peer.connectionStatus }));
    const nextHostPeerId = electNextHostPeerId({
      previousHostPeerId: peerId,
      peers: candidates,
      revision: currentGame.revision,
      stateHash: currentGame.stateHash,
    });

    if (!nextHostPeerId) {
      setMessage('Host disconnected; no replacement host was available.');
      return;
    }

    setHostPeerId(nextHostPeerId);
    hostPeerIdRef.current = nextHostPeerId;
    meshRef.current?.setHostPeerId(nextHostPeerId);

    const nextHostPlayerId = candidates.find((peer) => peer.peerId === nextHostPeerId)?.playerId;

    let nextGame = currentGame;

    if (leftPeer?.playerId && nextHostPlayerId && currentGame.currentRound?.activePlayerId === leftPeer.playerId) {
      const reassigned = reassignActivePlayer(currentGame, nextHostPlayerId);
      nextGame = reassigned;
      gameRef.current = nextGame;
      setGame(nextGame);
    }

    if (currentIdentity.peerId === nextHostPeerId) {
      const promotedIdentity: NetworkIdentity = {
        ...currentIdentity,
        role: 'host',
        room: { ...currentIdentity.room, hostPeerId: nextHostPeerId },
      };
      identityRef.current = promotedIdentity;
      setIdentity(promotedIdentity);
      setMessage('Host disconnected; this peer is the new host.');

      for (const peer of candidates) {
        if (peer.peerId !== promotedIdentity.peerId) {
          sendHostHello(promotedIdentity, peer, nextGame);
        }
      }
    } else {
      setMessage('Host disconnected; elected a replacement host.');
    }
  }

  function sendHostHeartbeat(currentIdentity: NetworkIdentity, snapshot: GameSessionState): void {
    for (const peer of peersRef.current) {
      if (peer.peerId === currentIdentity.peerId) {
        continue;
      }

      const heartbeat: Heartbeat = {
        type: 'heartbeat',
        hostPeerId: currentIdentity.peerId,
        hostEpoch: 1,
        revision: snapshot.revision,
        eventSeq: eventSeqRef.current,
        stateHash: snapshot.stateHash,
        snapshot: peer.role === 'spectator' ? redactGameForSpectator(snapshot) : snapshot,
      };
      meshRef.current?.sendPayload(peer.peerId, heartbeat);
    }
  }

  function sendHostHello(currentIdentity: NetworkIdentity, peer: PeerSummary | PeerRuntimeView, snapshot: GameSessionState): void {
    const allPeers = [toPeerRuntime(currentIdentity, 'connected'), ...peersRef.current].filter(
      (candidate, index, candidates) => candidates.findIndex((item) => item.peerId === candidate.peerId) === index,
    );
    const payload: HostHello = {
      type: 'host_hello',
      currentHostPeerId: currentIdentity.peerId,
      hostEpoch: 1,
      playerIdByPeerId: Object.fromEntries(allPeers.map((item) => [item.peerId, item.playerId])),
      roleByPeerId: Object.fromEntries(allPeers.map((item) => [item.peerId, item.role])),
      snapshot: peer.role === 'spectator' ? redactGameForSpectator(snapshot) : snapshot,
    };

    meshRef.current?.sendPayload(peer.peerId, payload);
  }

  function sendPeerReady(snapshot: GameSessionState): void {
    const currentIdentity = identityRef.current;
    const currentHostPeerId = hostPeerIdRef.current;

    if (!currentIdentity || !currentHostPeerId) {
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

    meshRef.current?.sendPayload(currentHostPeerId, payload);
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

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current || !currentGame) {
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

      for (const peer of peersRef.current) {
        if (peer.peerId === currentIdentity.peerId) {
          continue;
        }

        const payload: EventCommitted = {
          type: 'event_committed',
          event: result.event,
          eventSeq: eventSeqRef.current,
          revision: nextGame.revision,
          stateHash: nextGame.stateHash,
          snapshot: peer.role === 'spectator' ? redactGameForSpectator(nextGame) : nextGame,
        };
        meshRef.current?.sendPayload(peer.peerId, payload);
      }
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

function reassignActivePlayer(game: GameSessionState, activePlayerId: PlayerId): GameSessionState {
  if (!game.currentRound) {
    return game;
  }

  const nextGame = {
    ...game,
    currentRound: {
      ...game.currentRound,
      activePlayerId,
    },
    revision: game.revision + 1,
  };

  return {
    ...nextGame,
    stateHash: buildStateHash(nextGame),
  };
}

function getPlayerPeers(identity: NetworkIdentity, peers: PeerRuntimeView[]): PeerRuntimeView[] {
  return [toPeerRuntime(identity, 'connected'), ...peers]
    .filter((peer) => peer.role !== 'spectator')
    .filter((peer): peer is PeerRuntimeView & { playerId: PlayerId } => peer.playerId !== null)
    .filter((peer, index, all) => all.findIndex((candidate) => candidate.peerId === peer.peerId) === index)
    .sort((left, right) => numericPlayerIndex(left.playerId) - numericPlayerIndex(right.playerId));
}

function redactGameForSpectator(game: GameSessionState): GameSessionState {
  const currentRound = game.currentRound
    ? {
        ...game.currentRound,
        deck: {
          shuffledCardIds: [],
          dealtCardIdsByPlayer: {},
          initialBoardCardIds: [],
        },
        players: Object.fromEntries(
          Object.entries(game.currentRound.players).map(([playerId, player]) => [
            playerId,
            redactRoundPlayer(player),
          ]),
        ),
      }
    : null;
  const redacted = {
    ...game,
    randomSeed: 'redacted',
    currentRound,
    eventLog: [],
  };

  return {
    ...redacted,
    stateHash: game.stateHash || buildStateHash(redacted),
  };
}

function redactRoundPlayer(player: RoundPlayerState): RoundPlayerState {
  return {
    ...player,
    handCardIds: [],
    playedCardIds: [],
    remainingCardCount: player.remainingCardCount,
  };
}

function toPeerRuntime(identity: NetworkIdentity, connectionStatus: PeerRuntimeView['connectionStatus']): PeerRuntimeView {
  return {
    peerId: identity.peerId,
    playerId: identity.playerId,
    displayName: identity.displayName,
    role: identity.role,
    connectionStatus,
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
