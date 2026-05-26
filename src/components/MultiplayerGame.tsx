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
  resolveCurrentPlayerNoMoves,
} from '../game/rules';
import type { CardId, GameSessionState, MoveTarget, PlayerId, RoundPlayerState } from '../game/types';
import { electNextHostPeerId } from '../network/hostElection';
import { PeerMeshClient } from '../network/peerMesh';
import {
  createRoom,
  JoinRoomFailure,
  joinRoom,
  listRooms,
  markRoomPlaying,
  resumeGame,
  validatePlayerName,
} from '../network/signalingClient';
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
  RoomMetadata,
} from '../network/types';

const INITIAL_DRAG_STATUS: StageDragStatus = {
  selectedCard: 'Ready',
  target: 'No target',
};

const PLAYER_NAME_STORAGE_KEY = 'penguin-party.playerName';
const ROOM_LIST_POLL_MS = 1600;
const AUTO_PLAY_DISCONNECTED_MIN_MS = 5000;
const AUTO_PLAY_DISCONNECTED_JITTER_MS = 3000;

type MultiplayerScene =
  | 'landing_page'
  | 'matchmaking_lobby'
  | 'waiting_room'
  | 'game_play'
  | 'round_result'
  | 'game_result';

interface RoomListItemView extends RoomMetadata {
  canJoin: boolean;
  joinRole: 'player' | 'spectator' | null;
}

export function MultiplayerGame() {
  const [scene, setScene] = useState<MultiplayerScene>('landing_page');
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [game, setGame] = useState<GameSessionState | null>(null);
  const [peers, setPeers] = useState<PeerRuntimeView[]>([]);
  const [dragStatus, setDragStatus] = useState<StageDragStatus>(INITIAL_DRAG_STATUS);
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [rejoinCode, setRejoinCode] = useState('');
  const [rooms, setRooms] = useState<RoomMetadata[]>([]);
  const [isRoomListLoading, setIsRoomListLoading] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [passwordRoom, setPasswordRoom] = useState<RoomListItemView | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomName, setRoomName] = useState('Penguin Table');
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [message, setMessage] = useState('Enter a player name to start.');
  const [networkStatus, setNetworkStatus] = useState('idle');
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const meshRef = useRef<PeerMeshClient | null>(null);
  const identityRef = useRef<NetworkIdentity | null>(null);
  const gameRef = useRef<GameSessionState | null>(null);
  const peersRef = useRef<PeerRuntimeView[]>([]);
  const hostPeerIdRef = useRef<string | null>(null);
  const eventSeqRef = useRef(0);
  const autoPlayTimeoutRef = useRef<number | null>(null);
  const autoPlayScheduleRef = useRef<{ playerId: PlayerId; revision: number } | null>(null);
  const trimmedPlayerName = playerName.trim();
  const trimmedRejoinCode = rejoinCode.trim();
  const isPlayerNameValid = trimmedPlayerName.length > 0 && trimmedPlayerName.length <= 16;
  const canStartLanding = isPlayerNameValid || trimmedRejoinCode.length > 0;
  const roomItems = useMemo(() => rooms.map(toRoomListItem), [rooms]);

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    if (isPlayerNameValid && typeof window.localStorage.setItem === 'function') {
      window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, trimmedPlayerName);
    }
  }, [isPlayerNameValid, trimmedPlayerName]);

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
      if (autoPlayTimeoutRef.current !== null) {
        window.clearTimeout(autoPlayTimeoutRef.current);
        autoPlayTimeoutRef.current = null;
      }
      autoPlayScheduleRef.current = null;
      meshRef.current?.close();
      delete window.__PENGUIN_DEBUG__;
    },
    [],
  );

  const refreshOpenRooms = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsRoomListLoading(true);
    }

    try {
      const nextRooms = await listRooms();
      setRooms(nextRooms);

      if (showLoading) {
        setMessage(nextRooms.length > 0 ? 'Select an open room or create a new one.' : 'No open rooms yet.');
      }
    } catch {
      setRooms([]);
      setMessage('Signaling server is unavailable. Start npm run signaling.');
    } finally {
      if (showLoading) {
        setIsRoomListLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (identity || scene !== 'matchmaking_lobby') {
      return undefined;
    }

    void refreshOpenRooms(true);
    const intervalId = window.setInterval(() => {
      void refreshOpenRooms(false);
    }, ROOM_LIST_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [identity, refreshOpenRooms, scene]);

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

  useEffect(() => {
    if (!identity || identity.peerId !== hostPeerId || !game || game.status !== 'round_active') {
      clearAutoPlayTimer();
      return undefined;
    }

    const activePlayerId = game.currentRound?.activePlayerId ?? null;
    const activePeer = activePlayerId ? peers.find((peer) => peer.playerId === activePlayerId) : null;

    if (
      !activePlayerId ||
      !activePeer ||
      activePeer.peerId === identity.peerId ||
      activePeer.connectionStatus === 'connected' ||
      activePeer.role === 'spectator'
    ) {
      clearAutoPlayTimer();
      return undefined;
    }

    if (
      autoPlayScheduleRef.current?.playerId === activePlayerId &&
      autoPlayScheduleRef.current.revision === game.revision
    ) {
      return undefined;
    }

    clearAutoPlayTimer();

    const delayMs =
      AUTO_PLAY_DISCONNECTED_MIN_MS + Math.floor(Math.random() * (AUTO_PLAY_DISCONNECTED_JITTER_MS + 1));
    const disconnectedPlayerId = activePlayerId;
    const scheduledRevision = game.revision;
    autoPlayScheduleRef.current = { playerId: disconnectedPlayerId, revision: scheduledRevision };
    autoPlayTimeoutRef.current = window.setTimeout(() => {
      autoPlayTimeoutRef.current = null;
      autoPlayScheduleRef.current = null;
      autoPlayDisconnectedPlayer(disconnectedPlayerId, scheduledRevision);
    }, delayMs);

    return undefined;
  }, [game, hostPeerId, identity, peers]);

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
  const currentScene = useMemo<MultiplayerScene>(() => {
    if (!identity) {
      return scene;
    }

    if (game?.status === 'round_result') {
      return 'round_result';
    }

    if (game?.status === 'game_result') {
      return 'game_result';
    }

    if (identity.room.status === 'playing' || game) {
      return 'game_play';
    }

    return 'waiting_room';
  }, [game, identity, scene]);

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
    setScene(nextIdentity.room.status === 'playing' ? 'game_play' : 'waiting_room');
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

  const handleEnterMatchmaking = useCallback(async () => {
    if (trimmedRejoinCode) {
      try {
        const nextIdentity = await resumeGame({ rejoinCode: trimmedRejoinCode });
        setPlayerName(nextIdentity.displayName);
        setRejoinCode('');
        setMessage(`Resumed room ${nextIdentity.room.roomId}.`);
        startMesh(nextIdentity);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Re-join failed.');
      }
      return;
    }

    if (!isPlayerNameValid) {
      return;
    }

    try {
      await validatePlayerName(trimmedPlayerName);
      setPlayerName(trimmedPlayerName);
      setScene('matchmaking_lobby');
      setMessage('Loading open rooms.');
      void refreshOpenRooms(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Player name is unavailable.');
    }
  }, [isPlayerNameValid, refreshOpenRooms, startMesh, trimmedPlayerName, trimmedRejoinCode]);

  const handleCreateRoom = useCallback(async () => {
    if (!isPlayerNameValid) {
      setMessage('Enter a player name before creating a room.');
      return;
    }

    setIsCreatingRoom(true);

    try {
      const password = createPassword.trim();
      const nextIdentity = await createRoom({
        roomName,
        hostDisplayName: trimmedPlayerName,
        password: password || undefined,
        maxPlayers: 6,
      });
      setIsCreateDialogOpen(false);
      setCreatePassword('');
      setMessage(`Room ${nextIdentity.room.roomId} created. Waiting for players.`);
      startMesh(nextIdentity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Room creation failed.');
    } finally {
      setIsCreatingRoom(false);
    }
  }, [createPassword, isPlayerNameValid, roomName, startMesh, trimmedPlayerName]);

  const handleJoinRoom = useCallback(async (room: RoomListItemView, password?: string) => {
    if (!isPlayerNameValid) {
      setMessage('Enter a player name before joining a room.');
      return;
    }

    setJoiningRoomId(room.roomId);
    setJoinError(null);

    try {
      const nextIdentity = await joinRoom(room.roomId, {
        displayName: trimmedPlayerName,
        password: password?.trim() || undefined,
      });
      setMessage(`Joined room ${nextIdentity.room.roomId}.`);
      setPasswordRoom(null);
      setJoinPassword('');
      startMesh(nextIdentity);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Join failed.';

      if (error instanceof JoinRoomFailure && error.code === 'room_closed') {
        setPasswordRoom(null);
        setJoinPassword('');
        void refreshOpenRooms(true);
      }

      if (room.hasPassword && passwordRoom?.roomId === room.roomId) {
        setJoinError(errorMessage);
      } else {
        setMessage(errorMessage);
      }
    } finally {
      setJoiningRoomId(null);
    }
  }, [isPlayerNameValid, passwordRoom?.roomId, refreshOpenRooms, startMesh, trimmedPlayerName]);

  const handleRoomClick = useCallback((room: RoomListItemView) => {
    if (!room.canJoin) {
      setMessage('Room is full.');
      return;
    }

    if (room.hasPassword) {
      setPasswordRoom(room);
      setJoinPassword('');
      setJoinError(null);
      return;
    }

    void handleJoinRoom(room);
  }, [handleJoinRoom]);

  const handleLeaveRoom = useCallback(() => {
    meshRef.current?.close();
    meshRef.current = null;
    identityRef.current = null;
    gameRef.current = null;
    hostPeerIdRef.current = null;
    eventSeqRef.current = 0;
    setIdentity(null);
    setGame(null);
    setPeers([]);
    setHostPeerId(null);
    setDragStatus(INITIAL_DRAG_STATUS);
    setNetworkStatus('idle');
    setScene('matchmaking_lobby');
    setMessage('Returned to matchmaking lobby.');
    void refreshOpenRooms(true);
  }, [refreshOpenRooms]);

  const handleStartGame = useCallback(() => {
    const currentIdentity = identityRef.current;

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current) {
      return;
    }

    const playerPeers = getPlayerPeers(currentIdentity, peersRef.current);
    const snapshot = createLocalGame({
      playerCount: playerPeers.length,
      playerIds: playerPeers.map((peer) => peer.playerId),
      playerNames: playerPeers.map((peer) => peer.displayName),
      seed: `room-${currentIdentity.room.roomId}`,
    });

    eventSeqRef.current = 0;
    gameRef.current = snapshot;
    setGame(snapshot);
    void markRoomPlaying(currentIdentity.room.roomId);
    const playingIdentity = {
      ...currentIdentity,
      room: { ...currentIdentity.room, status: 'playing' as const },
    };
    identityRef.current = playingIdentity;
    setIdentity(playingIdentity);
    setScene('game_play');
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
    <main className="app-shell" data-scene={currentScene}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__copy">
            <h1 className="brand__title">Penguin Party</h1>
            <span className="brand__mode">{sceneLabel(currentScene)}</span>
          </div>
        </div>
        <div className="connection-indicator" aria-label={`P2P status ${networkStatus}`}>
          <span className="connection-indicator__dot" />
          {networkStatus}
        </div>
      </header>

      {!identity && scene === 'landing_page' ? (
        <section className="landing-page" aria-label="Landing page">
          <div className="landing-form">
            <label className="player-name-field">
              Player name
              <input
                data-player-name
                value={playerName}
                maxLength={16}
                onChange={(event) => setPlayerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleEnterMatchmaking();
                  }
                }}
              />
            </label>
            <label className="player-name-field">
              Re-join code
              <input
                data-rejoin-code-input
                value={rejoinCode}
                maxLength={32}
                onChange={(event) => setRejoinCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleEnterMatchmaking();
                  }
                }}
              />
            </label>
            <button type="button" disabled={!canStartLanding} onClick={() => void handleEnterMatchmaking()}>
              Start
            </button>
          </div>
          <p className="lobby-message" data-game-message>
            {canStartLanding ? message : 'Player name or re-join code is required.'}
          </p>
        </section>
      ) : null}

      {!identity && scene === 'matchmaking_lobby' ? (
        <section className="matchmaking-lobby" aria-label="Matchmaking lobby">
          <div className="room-list-panel">
            <div className="room-list-panel__header">
              <h2>Open rooms</h2>
              <button className="button-secondary" type="button" onClick={() => void refreshOpenRooms(true)}>
                Refresh
              </button>
            </div>
            <label className="player-name-field player-name-field--compact">
              Player name
              <input
                data-player-name
                value={playerName}
                maxLength={16}
                onChange={(event) => setPlayerName(event.target.value)}
              />
            </label>
            <div className="room-list-scroll" data-room-list>
              {isRoomListLoading && roomItems.length === 0 ? (
                <div className="room-list-empty">Loading rooms</div>
              ) : null}
              {!isRoomListLoading && roomItems.length === 0 ? (
                <div className="room-list-empty">No open rooms</div>
              ) : null}
              {roomItems.map((room) => (
                <button
                  className="room-list-item"
                  data-room-code={room.roomId}
                  data-room-item
                  data-room-status={room.status}
                  disabled={!room.canJoin || joiningRoomId !== null}
                  key={room.roomId}
                  type="button"
                  onClick={() => handleRoomClick(room)}
                >
                  <span className="room-list-item__main">
                    <span className="room-list-item__title">
                      {room.hasPassword ? <span className="room-lock" aria-label="Password required" /> : null}
                      <strong>{room.roomName}</strong>
                    </span>
                    <span className="room-list-item__meta">
                      {roomStatusLabel(room.status)}
                      {room.joinRole === 'spectator' ? ' / Spectator' : ''}
                      {!room.canJoin ? ' / Full' : ''}
                    </span>
                  </span>
                  <span className="room-list-item__count">
                    {room.currentPlayerCount}/{room.maxPlayers}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            className="floating-create-room"
            data-open-create-room
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            新しいゲームルームを作成
          </button>
          <p className="lobby-message" data-game-message>{message}</p>

          {isCreateDialogOpen ? (
            <div className="dialog-backdrop">
              <form
                className="dialog-card"
                aria-labelledby="create-room-title"
                aria-modal="true"
                role="dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleCreateRoom();
                }}
              >
                <h2 id="create-room-title">Create room</h2>
                <label>
                  Room name
                  <input
                    data-create-room-name
                    value={roomName}
                    maxLength={32}
                    onChange={(event) => setRoomName(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    data-create-password
                    value={createPassword}
                    maxLength={20}
                    type="password"
                    onChange={(event) => setCreatePassword(event.target.value)}
                  />
                </label>
                <div className="dialog-actions">
                  <button data-create-room-submit type="submit" disabled={isCreatingRoom || !roomName.trim()}>
                    Create room
                  </button>
                  <button className="button-secondary" type="button" onClick={() => setIsCreateDialogOpen(false)}>
                    Back
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {passwordRoom ? (
            <div className="dialog-backdrop">
              <form
                className="dialog-card"
                aria-labelledby="join-password-title"
                aria-modal="true"
                role="dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleJoinRoom(passwordRoom, joinPassword);
                }}
              >
                <h2 id="join-password-title">Room password</h2>
                <p>{passwordRoom.roomName}</p>
                <label>
                  Password
                  <input
                    data-join-password
                    value={joinPassword}
                    maxLength={20}
                    type="password"
                    onChange={(event) => setJoinPassword(event.target.value)}
                  />
                </label>
                {joinError ? <p className="dialog-error" data-join-error>{joinError}</p> : null}
                <div className="dialog-actions">
                  <button data-join-room-submit type="submit" disabled={joiningRoomId === passwordRoom.roomId}>
                    Join room
                  </button>
                  <button className="button-secondary" type="button" onClick={() => setPasswordRoom(null)}>
                    Back
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {identity ? (
        <section className="game-shell" data-scene={currentScene} aria-label="Penguin Party P2P game">
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
                    <span>{game ? peer.role : `${peer.role} / ${peer.connectionStatus}`}</span>
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
                <button type="button" onClick={handleLeaveRoom}>
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
              {!game ? (
                <div>
                  <span>Connected</span>
                  <strong data-connected-count>{connectedPeerCount}</strong>
                </div>
              ) : (
                <div>
                  <span>Rejoin</span>
                  <strong data-rejoin-code>{identity.rejoinCode ?? 'none'}</strong>
                </div>
              )}
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
      ) : null}
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

    if (!currentIdentity) {
      return;
    }

    const candidates = [toPeerRuntime(currentIdentity, 'connected'), ...peersRef.current]
      .filter((peer) => peer.peerId !== peerId)
      .filter((peer, index, all) => all.findIndex((candidate) => candidate.peerId === peer.peerId) === index)
      .map((peer) => ({ ...peer, connectionStatus: peer.connectionStatus === 'signaling' ? 'connected' : peer.connectionStatus }));
    const nextHostPeerId = currentGame
      ? electNextHostPeerId({
          previousHostPeerId: peerId,
          peers: candidates,
          revision: currentGame.revision,
          stateHash: currentGame.stateHash,
        })
      : selectWaitingRoomHost(candidates)?.peerId ?? null;

    if (!nextHostPeerId) {
      setMessage('Host disconnected; no replacement host was available.');
      return;
    }

    setHostPeerId(nextHostPeerId);
    hostPeerIdRef.current = nextHostPeerId;
    meshRef.current?.setHostPeerId(nextHostPeerId);

    const nextHostPlayerId = candidates.find((peer) => peer.peerId === nextHostPeerId)?.playerId;

    let nextGame = currentGame;

    if (leftPeer?.playerId && nextHostPlayerId && currentGame?.currentRound?.activePlayerId === leftPeer.playerId) {
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

      if (nextGame) {
        for (const peer of candidates) {
          if (peer.peerId !== promotedIdentity.peerId) {
            sendHostHello(promotedIdentity, peer, nextGame);
          }
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

  function autoPlayDisconnectedPlayer(playerId: PlayerId, expectedRevision: number): void {
    const currentIdentity = identityRef.current;
    const currentGame = gameRef.current;
    const currentHostPeerId = hostPeerIdRef.current;

    if (
      !currentIdentity ||
      currentIdentity.peerId !== currentHostPeerId ||
      !currentGame ||
      currentGame.revision !== expectedRevision ||
      currentGame.currentRound?.activePlayerId !== playerId
    ) {
      return;
    }

    const activePeer = peersRef.current.find((peer) => peer.playerId === playerId);

    if (!activePeer || activePeer.connectionStatus === 'connected') {
      return;
    }

    const legalMovesForDisconnectedPlayer = getLegalMovesForPlayer(currentGame, playerId);

    if (legalMovesForDisconnectedPlayer.length > 0) {
      const selectedMove =
        legalMovesForDisconnectedPlayer[Math.floor(Math.random() * legalMovesForDisconnectedPlayer.length)];
      commitHostMove(playerId, selectedMove.cardId, selectedMove.target, null);
      return;
    }

    const nextGame = resolveCurrentPlayerNoMoves(currentGame);

    if (nextGame.revision !== currentGame.revision) {
      commitHostResolvedState(nextGame);
    }
  }

  function clearAutoPlayTimer(): void {
    if (autoPlayTimeoutRef.current !== null) {
      window.clearTimeout(autoPlayTimeoutRef.current);
      autoPlayTimeoutRef.current = null;
    }

    autoPlayScheduleRef.current = null;
  }

  function commitHostResolvedState(nextGame: GameSessionState): void {
    const currentIdentity = identityRef.current;
    const event = nextGame.eventLog.at(-1);

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current || !event) {
      return;
    }

    eventSeqRef.current += 1;
    gameRef.current = nextGame;
    setGame(nextGame);
    setDragStatus(INITIAL_DRAG_STATUS);
    setMessage(`Committed event ${eventSeqRef.current}; revision ${nextGame.revision}.`);

    for (const peer of peersRef.current) {
      if (peer.peerId === currentIdentity.peerId || peer.connectionStatus !== 'connected') {
        continue;
      }

      const payload: EventCommitted = {
        type: 'event_committed',
        event,
        eventSeq: eventSeqRef.current,
        revision: nextGame.revision,
        stateHash: nextGame.stateHash,
        snapshot: peer.role === 'spectator' ? redactGameForSpectator(nextGame) : nextGame,
      };
      meshRef.current?.sendPayload(peer.peerId, payload);
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

function getPlayerPeers(identity: NetworkIdentity, peers: PeerRuntimeView[]): Array<PeerRuntimeView & { playerId: PlayerId }> {
  return [toPeerRuntime(identity, 'connected'), ...peers]
    .filter((peer) => peer.role !== 'spectator')
    .filter((peer): peer is PeerRuntimeView & { playerId: PlayerId } => peer.playerId !== null)
    .filter((peer, index, all) => all.findIndex((candidate) => candidate.peerId === peer.peerId) === index)
    .sort((left, right) => numericPlayerIndex(left.playerId) - numericPlayerIndex(right.playerId));
}

function selectWaitingRoomHost(peers: PeerRuntimeView[]): PeerRuntimeView | null {
  return (
    peers
      .filter((peer) => peer.role !== 'spectator')
      .filter((peer): peer is PeerRuntimeView & { playerId: PlayerId } => peer.playerId !== null)
      .sort((left, right) => numericPlayerIndex(left.playerId) - numericPlayerIndex(right.playerId))[0] ?? null
  );
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

function readStoredPlayerName(): string {
  const stored =
    typeof window.localStorage.getItem === 'function'
      ? window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY)?.trim()
      : null;

  if (stored) {
    return stored.slice(0, 16);
  }

  return createDefaultPlayerName();
}

function createDefaultPlayerName(): string {
  const bytes = new Uint8Array(3);

  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }

  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `Player_${suffix}`;
}

function toRoomListItem(room: RoomMetadata): RoomListItemView {
  const canJoin = room.status === 'playing' || room.currentPlayerCount < room.maxPlayers;

  return {
    ...room,
    canJoin,
    joinRole: canJoin ? (room.status === 'playing' ? 'spectator' : 'player') : null,
  };
}

function roomStatusLabel(status: RoomMetadata['status']): string {
  return status === 'waiting_for_start' ? '開始待ち' : 'プレイ中';
}

function sceneLabel(scene: MultiplayerScene): string {
  if (scene === 'landing_page') {
    return 'Landing page';
  }

  if (scene === 'matchmaking_lobby') {
    return 'Matchmaking lobby';
  }

  if (scene === 'waiting_room') {
    return 'Waiting room';
  }

  if (scene === 'round_result') {
    return 'Round result';
  }

  if (scene === 'game_result') {
    return 'Game result';
  }

  return 'Game play';
}
