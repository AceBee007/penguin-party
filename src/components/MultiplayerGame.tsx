import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandTitle } from './BrandTitle';
import { LanguageSelector } from './LanguageSelector';
import { PixiDragStage } from './PixiDragStage';
import {
  buildStateHash,
  createLocalGame,
  getActivePlayer,
  getCurrentRoundPlayer,
  getFinalStandings,
  getLegalMovesForPlayer,
  playCard,
  resolveCurrentPlayerNoMoves,
  startNextRound,
} from '../game/rules';
import type { CardId, GameSessionState, MoveTarget, PlayerId, RoundPlayerState } from '../game/types';
import { electNextHostPeerId } from '../network/hostElection';
import { PeerMeshClient } from '../network/peerMesh';
import {
  checkRejoinCode,
  checkSignalingServer,
  createRoom,
  getSignalingHttpUrl,
  getSignalingServerQueryUrl,
  invalidateGameRejoinCodes,
  JoinRoomFailure,
  joinRoom,
  listRooms,
  markRoomPlaying,
  markRoomWaitingForStart,
  normalizeSignalingHttpUrl,
  requestGameRejoinCode,
  releasePlayerNameReservation,
  resumeGame,
  setSignalingServerQuery,
  validatePlayerName,
} from '../network/signalingClient';
import {
  clearStoredRejoinSession,
  getRejoinCodeExpiresAt,
  readStoredRejoinSession,
  storeRejoinSession,
  type StoredRejoinSession,
} from '../network/rejoinStorage';
import {
  cardColorLabel,
  peerConnectionStatusLabel,
  peerRoleLabel,
  roomStatusLabel,
  t,
  type LocaleCode,
} from '../i18n/uiText';
import type {
  EventCommitted,
  Heartbeat,
  HostHello,
  NetworkIdentity,
  P2PEnvelope,
  PeerReady,
  PeerRuntimeView,
  ReadyGateKind,
  ReadyGateState,
  PeerSummary,
  PlayerCommand,
  RoomMetadata,
} from '../network/types';

const PLAYER_NAME_STORAGE_KEY = 'penguin-party.playerName';
const ROOM_LIST_POLL_MS = 1600;
const LOBBY_NAME_RESERVATION_REFRESH_MS = 15 * 1000;
const AUTO_PLAY_DISCONNECTED_MIN_MS = 5000;
const AUTO_PLAY_DISCONNECTED_JITTER_MS = 3000;

let autoSignalingConnectAttemptedUrl: string | null = null;

type MultiplayerScene =
  | 'landing_page'
  | 'matchmaking_lobby'
  | 'waiting_room'
  | 'game_play'
  | 'round_result'
  | 'game_result';

type SignalingConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

interface RoomListItemView extends RoomMetadata {
  canJoin: boolean;
  joinRole: 'player' | 'spectator' | null;
}

interface ScoreboardPlayerView {
  playerId: PlayerId;
  displayName: string;
  isActive: boolean;
  isLocal: boolean;
  remainingCardCount: number;
  totalPenalty: number;
}

interface MultiplayerGameProps {
  locale: LocaleCode;
}

export function MultiplayerGame({ locale }: MultiplayerGameProps) {
  const [scene, setScene] = useState<MultiplayerScene>('landing_page');
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [game, setGame] = useState<GameSessionState | null>(null);
  const [peers, setPeers] = useState<PeerRuntimeView[]>([]);
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [storedRejoinSession, setStoredRejoinSession] = useState<StoredRejoinSession | null>(() =>
    readStoredRejoinSession(),
  );
  const [isStoredRejoinAvailable, setIsStoredRejoinAvailable] = useState(false);
  const [isRejoining, setIsRejoining] = useState(false);
  const [signalingServerUrl, setSignalingServerUrl] = useState(
    () => getSignalingServerQueryUrl() ?? storedRejoinSession?.signalingServerUrl ?? getSignalingHttpUrl(),
  );
  const [connectedSignalingServerUrl, setConnectedSignalingServerUrl] = useState<string | null>(null);
  const [signalingConnectionStatus, setSignalingConnectionStatus] =
    useState<SignalingConnectionStatus>('idle');
  const [rooms, setRooms] = useState<RoomMetadata[]>([]);
  const [isRoomListLoading, setIsRoomListLoading] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
  const [isScoreboardExpanded, setIsScoreboardExpanded] = useState(false);
  const [isBoardMaximized, setIsBoardMaximized] = useState(false);
  const [readyByPlayerId, setReadyByPlayerId] = useState<Record<PlayerId, boolean>>({});
  const [passwordRoom, setPasswordRoom] = useState<RoomListItemView | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomName, setRoomName] = useState(t('room.defaultName'));
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [message, setMessage] = useState(t('message.initialMultiplayer'));
  const [networkStatus, setNetworkStatus] = useState(t('network.idle'));
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const meshRef = useRef<PeerMeshClient | null>(null);
  const scoreboardOverlayPanelRef = useRef<HTMLElement | null>(null);
  const nameReservationTokenRef = useRef<string | null>(null);
  const identityRef = useRef<NetworkIdentity | null>(null);
  const gameRef = useRef<GameSessionState | null>(null);
  const peersRef = useRef<PeerRuntimeView[]>([]);
  const readyByPlayerIdRef = useRef<Record<PlayerId, boolean>>({});
  const readyGateRef = useRef<ReadyGateKind | null>(null);
  const hostPeerIdRef = useRef<string | null>(null);
  const signalingConnectionRequestRef = useRef(0);
  const eventSeqRef = useRef(0);
  const autoPlayTimeoutRef = useRef<number | null>(null);
  const autoPlayScheduleRef = useRef<{ playerId: PlayerId; revision: number } | null>(null);
  const invalidatedRejoinGameIdRef = useRef<string | null>(null);
  const lastRoomLeaveAtRef = useRef(0);
  const trimmedPlayerName = playerName.trim();
  const isPlayerNameValid = trimmedPlayerName.length > 0 && trimmedPlayerName.length <= 16;
  const hasLandingStartInput = isPlayerNameValid;
  const canStartLanding = hasLandingStartInput && signalingConnectionStatus === 'connected';
  const canConnectSignalingServer = signalingServerUrl.trim().length > 0 && signalingConnectionStatus !== 'checking';
  const signalingConnectionLabel = getSignalingConnectionLabel(
    signalingConnectionStatus,
    connectedSignalingServerUrl,
  );
  const connectionIndicator = getConnectionIndicatorView(
    signalingConnectionStatus,
    connectedSignalingServerUrl,
    networkStatus,
  );
  const landingMessage = getLandingMessage(hasLandingStartInput, signalingConnectionStatus, message);
  const roomItems = useMemo(() => rooms.map(toRoomListItem), [rooms]);

  useEffect(() => {
    if (!identity && scene === 'landing_page') {
      setMessage(t('message.initialMultiplayer'));
      setNetworkStatus(t('network.idle'));
    }
  }, [identity, locale, scene]);

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
    readyByPlayerIdRef.current = readyByPlayerId;
  }, [readyByPlayerId]);

  useEffect(() => {
    hostPeerIdRef.current = hostPeerId;
  }, [hostPeerId]);

  useEffect(() => {
    window.__PENGUIN_DEBUG__ = {
      game,
      hostPeerId,
      identity,
      peers,
      readyByPlayerId,
    };
  }, [game, hostPeerId, identity, peers, readyByPlayerId]);

  useEffect(
    () => () => {
      if (autoPlayTimeoutRef.current !== null) {
        window.clearTimeout(autoPlayTimeoutRef.current);
        autoPlayTimeoutRef.current = null;
      }
      autoPlayScheduleRef.current = null;
      releaseCurrentNameReservation();
      meshRef.current?.close();
      delete window.__PENGUIN_DEBUG__;
    },
    [],
  );

  const refreshOpenRooms = useCallback(async (showLoading = false) => {
    if (!connectedSignalingServerUrl) {
      setRooms([]);
      setMessage(t('message.connectBeforeLoadingRooms'));
      return;
    }

    if (showLoading) {
      setIsRoomListLoading(true);
    }

    try {
      const nextRooms = await listRooms(connectedSignalingServerUrl);
      setRooms(nextRooms);

      if (showLoading) {
        setMessage(nextRooms.length > 0 ? t('message.roomListPrompt') : t('message.noOpenRoomsYet'));
      }
    } catch {
      setRooms([]);
      setMessage(t('message.signalingUnavailable'));
    } finally {
      if (showLoading) {
        setIsRoomListLoading(false);
      }
    }
  }, [connectedSignalingServerUrl]);

  const handleSignalingServerUrlChange = useCallback((value: string) => {
    signalingConnectionRequestRef.current += 1;
    setSignalingServerUrl(value);
    setConnectedSignalingServerUrl(null);
    setSignalingConnectionStatus('idle');
  }, []);

  const handleConnectSignalingServer = useCallback(async () => {
    const requestId = signalingConnectionRequestRef.current + 1;
    signalingConnectionRequestRef.current = requestId;
    setSignalingConnectionStatus('checking');
    setConnectedSignalingServerUrl(null);
    setMessage(t('message.connectingSignaling'));

    try {
      const normalizedUrl = normalizeSignalingHttpUrl(signalingServerUrl);
      await checkSignalingServer(normalizedUrl);

      if (signalingConnectionRequestRef.current !== requestId) {
        return;
      }

      setSignalingServerUrl(normalizedUrl);
      setConnectedSignalingServerUrl(normalizedUrl);
      setSignalingConnectionStatus('connected');
      setSignalingServerQuery(normalizedUrl);
      setMessage(t('message.connectedSignaling'));
    } catch (error) {
      if (signalingConnectionRequestRef.current !== requestId) {
        return;
      }

      setSignalingConnectionStatus('error');
      setMessage(error instanceof Error ? error.message : t('message.signalingConnectionFailed'));
    }
  }, [signalingServerUrl]);

  useEffect(() => {
    if (identity || scene !== 'landing_page') {
      return;
    }

    const autoConnectUrl = getSignalingServerQueryUrl() ?? storedRejoinSession?.signalingServerUrl ?? null;

    if (!autoConnectUrl || autoSignalingConnectAttemptedUrl === autoConnectUrl) {
      return;
    }

    autoSignalingConnectAttemptedUrl = autoConnectUrl;
    void handleConnectSignalingServer();
  }, [handleConnectSignalingServer, identity, scene, storedRejoinSession?.signalingServerUrl]);

  useEffect(() => {
    if (identity || scene !== 'landing_page' || !storedRejoinSession || !connectedSignalingServerUrl) {
      setIsStoredRejoinAvailable(false);
      return undefined;
    }

    if (storedRejoinSession.signalingServerUrl !== connectedSignalingServerUrl) {
      setIsStoredRejoinAvailable(false);
      return undefined;
    }

    const expiresAt = getRejoinCodeExpiresAt(storedRejoinSession.rejoinCode);

    if (expiresAt === null || expiresAt <= Date.now()) {
      clearStoredRejoinSession(storedRejoinSession.rejoinCode);
      setStoredRejoinSession(null);
      setIsStoredRejoinAvailable(false);
      return undefined;
    }

    let cancelled = false;
    let expiryTimeoutId: number | null = null;
    setIsStoredRejoinAvailable(false);

    void checkRejoinCode({ rejoinCode: storedRejoinSession.rejoinCode }, connectedSignalingServerUrl)
      .then(({ valid }) => {
        if (cancelled) {
          return;
        }

        if (valid) {
          const remainingMs = expiresAt - Date.now();

          if (remainingMs <= 0) {
            clearStoredRejoinSession(storedRejoinSession.rejoinCode);
            setStoredRejoinSession(null);
            return;
          }

          setIsStoredRejoinAvailable(true);
          expiryTimeoutId = window.setTimeout(() => {
            clearStoredRejoinSession(storedRejoinSession.rejoinCode);
            setStoredRejoinSession(null);
            setIsStoredRejoinAvailable(false);
          }, remainingMs);
          return;
        }

        clearStoredRejoinSession(storedRejoinSession.rejoinCode);
        setStoredRejoinSession(null);
      })
      .catch(() => {
        if (!cancelled) {
          setIsStoredRejoinAvailable(false);
        }
      });

    return () => {
      cancelled = true;

      if (expiryTimeoutId !== null) {
        window.clearTimeout(expiryTimeoutId);
      }
    };
  }, [connectedSignalingServerUrl, identity, scene, storedRejoinSession]);

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
    if (identity || scene !== 'matchmaking_lobby' || !isPlayerNameValid) {
      return undefined;
    }

    void refreshNameReservation(trimmedPlayerName);
    const intervalId = window.setInterval(() => {
      void refreshNameReservation(trimmedPlayerName);
    }, LOBBY_NAME_RESERVATION_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [identity, isPlayerNameValid, scene, trimmedPlayerName]);

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
  const latestSummary = game?.completedRounds.at(-1) ?? null;
  const connectedPeerCount = peers.filter((peer) => peer.connectionStatus === 'connected').length;
  const playerCount = peers.filter((peer) => peer.role !== 'spectator').length;
  const spectatorCount = peers.filter((peer) => peer.role === 'spectator').length;
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
  const canMaximizeSpectatorBoard = currentScene === 'game_play' && isSpectator && Boolean(game);
  const currentReadyGate = getReadyGateKind(identity, game);
  const readyGatePlayerIds = useMemo(
    () => (identity && currentReadyGate ? getReadyGatePlayerIds(identity, peers, game) : []),
    [currentReadyGate, game, identity, peers],
  );
  const readyGatePlayerKey = readyGatePlayerIds.join('|');
  const localReady = Boolean(localPlayerId && readyByPlayerId[localPlayerId]);
  const readyGateRemainingCount = readyGatePlayerIds.filter((playerId) => !readyByPlayerId[playerId]).length;
  const readyGateActionLabel = currentReadyGate ? readyActionLabel(currentReadyGate, localReady) : '';
  const readyGateStatusText = currentReadyGate
    ? readyStatusText(currentReadyGate, localReady, readyGateRemainingCount, readyGatePlayerIds.length)
    : '';
  const isResultScene = game?.status === 'round_result' || game?.status === 'game_result';
  const isResultReadyGate = !isSpectator && (currentReadyGate === 'round_result' || currentReadyGate === 'game_result');

  useEffect(() => {
    if (!canMaximizeSpectatorBoard) {
      setIsBoardMaximized(false);
    }
  }, [canMaximizeSpectatorBoard]);

  useEffect(() => {
    if (readyGateRef.current !== currentReadyGate) {
      readyGateRef.current = currentReadyGate;
      readyByPlayerIdRef.current = {};
      setReadyByPlayerId({});
      return;
    }

    if (!currentReadyGate) {
      return;
    }

    const allowedPlayerIds = new Set(readyGatePlayerIds);
    setReadyByPlayerId((current) => {
      const nextReady = Object.fromEntries(
        Object.entries(current).filter(([playerId, ready]) => ready && allowedPlayerIds.has(playerId)),
      );

      if (Object.keys(nextReady).length === Object.keys(current).length) {
        return current;
      }

      readyByPlayerIdRef.current = nextReady;
      return nextReady;
    });
  }, [currentReadyGate, readyGatePlayerKey, readyGatePlayerIds]);

  useEffect(() => {
    if (!isHost || !currentReadyGate || readyGatePlayerIds.length === 0 || readyGateRemainingCount > 0) {
      return;
    }

    evaluateReadyGate(currentReadyGate, readyByPlayerIdRef.current, readyGatePlayerIds);
  }, [currentReadyGate, isHost, readyGatePlayerIds, readyGateRemainingCount]);

  useEffect(() => {
    if (game?.status !== 'game_result') {
      return;
    }

    const currentIdentity = identityRef.current;
    clearStoredRejoinSession();
    setStoredRejoinSession(null);
    setIsStoredRejoinAvailable(false);

    if (currentIdentity?.rejoinCode) {
      const nextIdentity = { ...currentIdentity, rejoinCode: undefined };
      identityRef.current = nextIdentity;
      setIdentity(nextIdentity);
    }

    if (
      currentIdentity &&
      connectedSignalingServerUrl &&
      currentIdentity.peerId === hostPeerId &&
      invalidatedRejoinGameIdRef.current !== game.gameId
    ) {
      invalidatedRejoinGameIdRef.current = game.gameId;
      void invalidateGameRejoinCodes(currentIdentity, connectedSignalingServerUrl).catch(() => {
        invalidatedRejoinGameIdRef.current = null;
      });
    }
  }, [connectedSignalingServerUrl, game?.gameId, game?.status, hostPeerId]);

  useEffect(() => {
    if (!isBoardMaximized) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBoardMaximized(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBoardMaximized]);

  useEffect(() => {
    if (!isScoreboardExpanded || currentScene !== 'game_play') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (scoreboardOverlayPanelRef.current?.contains(target) || target.closest('[data-scoreboard-toggle]')) {
        return;
      }

      setIsScoreboardExpanded(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [currentScene, isScoreboardExpanded]);

  const scoreboardPlayers = useMemo<ScoreboardPlayerView[]>(() => {
    if (game) {
      return game.players.map((player) => {
        const roundPlayer = game.currentRound?.players[player.playerId];

        return {
          playerId: player.playerId,
          displayName: player.displayName,
          isActive: player.playerId === activePlayer?.playerId,
          isLocal: player.playerId === localPlayerId,
          remainingCardCount: roundPlayer?.remainingCardCount ?? 0,
          totalPenalty: player.totalPenalty,
        };
      });
    }

    return peers
      .filter((peer) => peer.role !== 'spectator' && peer.playerId)
      .map((peer) => ({
        playerId: peer.playerId ?? peer.peerId,
        displayName: peer.displayName,
        isActive: false,
        isLocal: peer.peerId === identity?.peerId,
        remainingCardCount: 0,
        totalPenalty: 0,
      }));
  }, [activePlayer?.playerId, game, identity?.peerId, localPlayerId, peers]);

  useEffect(() => {
    if (currentScene !== 'game_play') {
      setIsScoreboardExpanded(false);
    }
  }, [currentScene]);

  const startMesh = useCallback((nextIdentity: NetworkIdentity) => {
    const signalingHttpUrl = connectedSignalingServerUrl;

    if (!signalingHttpUrl) {
      setMessage(t('message.connectBeforeJoin'));
      return;
    }

    meshRef.current?.close();
    const nextHostPeerId = nextIdentity.room.hostPeerId;
    const mesh = new PeerMeshClient({
      identity: nextIdentity,
      hostPeerId: nextHostPeerId,
      signalingHttpUrl,
      onPeersChanged: (nextPeers) => {
        setPeers(nextPeers);
      },
      onPayload: (envelope) => handleP2PPayload(envelope),
      onChannelOpen: (peer) => {
        setMessage(t('message.dataChannelOpen', { displayName: peer.displayName }));

        const currentIdentity = identityRef.current ?? nextIdentity;
        if (currentIdentity.peerId === hostPeerIdRef.current && gameRef.current) {
          sendHostHello(currentIdentity, peer, gameRef.current);
          return;
        }

        const gate = getReadyGateKind(currentIdentity, gameRef.current);
        if (currentIdentity.peerId === hostPeerIdRef.current && gate) {
          sendReadyGateStateToPeer(currentIdentity, peer, gate);
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
  }, [connectedSignalingServerUrl]);

  const handleEnterMatchmaking = useCallback(async () => {
    if (!connectedSignalingServerUrl) {
      setMessage(t('message.connectBeforeStart'));
      return;
    }

    if (!isPlayerNameValid) {
      return;
    }

    try {
      const reservation = await validatePlayerName(
        trimmedPlayerName,
        nameReservationTokenRef.current ?? undefined,
        connectedSignalingServerUrl,
      );
      nameReservationTokenRef.current = reservation.nameReservationToken;
      setPlayerName(trimmedPlayerName);
      setScene('matchmaking_lobby');
      setMessage(t('message.loadingOpenRooms'));
      void refreshOpenRooms(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('message.playerNameUnavailable'));
    }
  }, [connectedSignalingServerUrl, isPlayerNameValid, refreshOpenRooms, trimmedPlayerName]);

  const handleRejoinGame = useCallback(async () => {
    if (!connectedSignalingServerUrl || !storedRejoinSession || !isStoredRejoinAvailable) {
      return;
    }

    setIsRejoining(true);

    try {
      const nextIdentity = await resumeGame(
        { rejoinCode: storedRejoinSession.rejoinCode },
        connectedSignalingServerUrl,
      );
      setPlayerName(nextIdentity.displayName);
      setIsStoredRejoinAvailable(false);
      setMessage(t('message.resumedRoom', { roomId: nextIdentity.room.roomId }));
      startMesh(nextIdentity);
    } catch (error) {
      clearStoredRejoinSession(storedRejoinSession.rejoinCode);
      setStoredRejoinSession(null);
      setIsStoredRejoinAvailable(false);
      setMessage(error instanceof Error ? error.message : t('message.rejoinFailed'));
    } finally {
      setIsRejoining(false);
    }
  }, [connectedSignalingServerUrl, isStoredRejoinAvailable, startMesh, storedRejoinSession]);

  const handleCreateRoom = useCallback(async () => {
    if (!isPlayerNameValid) {
      setMessage(t('message.enterNameBeforeCreate'));
      return;
    }

    if (!connectedSignalingServerUrl) {
      setMessage(t('message.connectBeforeCreate'));
      return;
    }

    setIsCreatingRoom(true);

    try {
      const password = createPassword.trim();
      const nextIdentity = await createRoom({
        roomName,
        hostDisplayName: trimmedPlayerName,
        nameReservationToken: nameReservationTokenRef.current ?? undefined,
        password: password || undefined,
        maxPlayers: 6,
      }, connectedSignalingServerUrl);
      nameReservationTokenRef.current = null;
      setIsCreateDialogOpen(false);
      setCreatePassword('');
      setMessage(t('message.roomCreated', { roomId: nextIdentity.room.roomId }));
      startMesh(nextIdentity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('message.roomCreationFailed'));
    } finally {
      setIsCreatingRoom(false);
    }
  }, [connectedSignalingServerUrl, createPassword, isPlayerNameValid, roomName, startMesh, trimmedPlayerName]);

  const handleJoinRoom = useCallback(async (room: RoomListItemView, password?: string) => {
    if (!isPlayerNameValid) {
      setMessage(t('message.enterNameBeforeJoin'));
      return;
    }

    if (!connectedSignalingServerUrl) {
      setMessage(t('message.connectBeforeJoin'));
      return;
    }

    setJoiningRoomId(room.roomId);
    setJoinError(null);

    try {
      const nextIdentity = await joinRoom(room.roomId, {
        displayName: trimmedPlayerName,
        nameReservationToken: nameReservationTokenRef.current ?? undefined,
        password: password?.trim() || undefined,
      }, connectedSignalingServerUrl);
      nameReservationTokenRef.current = null;
      setMessage(t('message.joinedRoom', { roomId: nextIdentity.room.roomId }));
      setPasswordRoom(null);
      setJoinPassword('');
      startMesh(nextIdentity);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('message.joinFailed');

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
  }, [
    connectedSignalingServerUrl,
    isPlayerNameValid,
    passwordRoom?.roomId,
    refreshOpenRooms,
    startMesh,
    trimmedPlayerName,
  ]);

  const handleRoomClick = useCallback((room: RoomListItemView) => {
    if (!room.canJoin) {
      setMessage(t('message.roomFull'));
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
    lastRoomLeaveAtRef.current = Date.now();
    setIsLeaveConfirmOpen(false);
    setIsScoreboardExpanded(false);
    setIsBoardMaximized(false);
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
    setNetworkStatus(t('network.idle'));
    setScene('matchmaking_lobby');
    setMessage(t('message.returnedToMatchmaking'));
    void refreshOpenRooms(true);
    if (isPlayerNameValid) {
      void refreshNameReservation(trimmedPlayerName);
    }
  }, [isPlayerNameValid, refreshOpenRooms, trimmedPlayerName]);

  const handleLeaveClick = useCallback(() => {
    if (gameRef.current) {
      setIsLeaveConfirmOpen(true);
      return;
    }

    handleLeaveRoom();
  }, [handleLeaveRoom]);

  const handleToggleReady = useCallback(() => {
    const currentIdentity = identityRef.current;
    const playerId = currentIdentity?.playerId ?? null;
    const gate = getReadyGateKind(currentIdentity, gameRef.current);
    const currentHostPeerId = hostPeerIdRef.current;

    if (!currentIdentity || !playerId || !currentHostPeerId || currentIdentity.role === 'spectator' || !gate) {
      return;
    }

    const ready = !readyByPlayerIdRef.current[playerId];

    if (currentIdentity.peerId === currentHostPeerId) {
      applyReadyGateUpdate(gate, playerId, ready);
      return;
    }

    const command: PlayerCommand = {
      type: 'player_command',
      commandId: createCommandId(),
      playerId,
      command: { type: 'set_ready', gate, ready },
      clientRevision: gameRef.current?.revision ?? 0,
      clientSentAt: Date.now(),
    };
    readyByPlayerIdRef.current = { ...readyByPlayerIdRef.current, [playerId]: ready };
    setReadyByPlayerId(readyByPlayerIdRef.current);
    meshRef.current?.sendPayload(currentHostPeerId, command);
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
      setMessage(t('message.noCurrentHost'));
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
    setMessage(t('message.sentPlayCardCommand'));
  }, []);

  return (
    <main className="app-shell" data-scene={currentScene} lang={locale}>
      <header className="topbar">
        <div className="brand">
          <div className="brand__copy">
            <BrandTitle />
            <span className="brand__mode">{sceneLabel(currentScene)}</span>
          </div>
        </div>
        <div
          className="connection-indicator"
          aria-label={t('aria.connectionStatus', { status: connectionIndicator.label })}
          data-status={connectionIndicator.status}
        >
          <span className="connection-indicator__dot" />
          {connectionIndicator.label}
        </div>
      </header>

      {!identity && scene === 'landing_page' ? (
        <section className="landing-page" aria-label={t('aria.landingPage')}>
          <div className="landing-page__language">
            <LanguageSelector />
          </div>
          <div className="landing-form">
            <label className="player-name-field landing-form__player-name">
              {t('field.playerName')}
              <input
                data-player-name
                value={playerName}
                maxLength={16}
                onChange={(event) => setPlayerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canStartLanding) {
                    void handleEnterMatchmaking();
                  }
                }}
              />
            </label>
            <button
              className="landing-form__start-button"
              type="button"
              disabled={!canStartLanding}
              onClick={() => void handleEnterMatchmaking()}
            >
              {t('button.start')}
            </button>
            {isStoredRejoinAvailable ? (
              <button
                className="landing-form__rejoin-button"
                data-rejoin-game
                type="button"
                disabled={isRejoining}
                onClick={() => void handleRejoinGame()}
              >
                {t('button.rejoinGame')}
              </button>
            ) : null}
            <label className="player-name-field signaling-server-field">
              {t('field.signalingServer')}
              <input
                data-signaling-server-input
                value={signalingServerUrl}
                onChange={(event) => handleSignalingServerUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canConnectSignalingServer) {
                    void handleConnectSignalingServer();
                  }
                }}
              />
            </label>
            <button
              className="landing-form__connect-button"
              data-connect-signaling
              type="button"
              disabled={!canConnectSignalingServer}
              onClick={() => void handleConnectSignalingServer()}
            >
              {t('button.connect')}
            </button>
            <p className="landing-form__connection-status" data-signaling-status data-status={signalingConnectionStatus}>
              {signalingConnectionLabel}
            </p>
          </div>
          <p className="lobby-message" data-game-message>
            {landingMessage}
          </p>
        </section>
      ) : null}

      {!identity && scene === 'matchmaking_lobby' ? (
        <section className="matchmaking-lobby" aria-label={t('scene.matchmaking_lobby')}>
          <div className="room-list-panel">
            <div className="room-list-panel__header">
              <h2>{t('room.openRooms')}</h2>
              <button className="button-secondary" type="button" onClick={() => void refreshOpenRooms(true)}>
                {t('button.refresh')}
              </button>
            </div>
            <label className="player-name-field player-name-field--compact">
              {t('field.playerName')}
              <input
                data-player-name
                value={playerName}
                maxLength={16}
                onChange={(event) => setPlayerName(event.target.value)}
              />
            </label>
            <div className="room-list-scroll" data-room-list>
              {isRoomListLoading && roomItems.length === 0 ? (
                <div className="room-list-empty">{t('room.listLoading')}</div>
              ) : null}
              {!isRoomListLoading && roomItems.length === 0 ? (
                <div className="room-list-empty">{t('room.listEmpty')}</div>
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
                      {room.hasPassword ? <span className="room-lock" aria-label={t('aria.passwordRequired')} /> : null}
                      <strong>{room.roomName}</strong>
                    </span>
                    <span className="room-list-item__meta">
                      {roomStatusLabel(room.status)}
                      {room.joinRole === 'spectator' ? t('common.slash') + t('room.spectatorBadge') : ''}
                      {!room.canJoin ? t('common.slash') + t('room.full') : ''}
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
            {t('button.createGameRoom')}
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
                <h2 id="create-room-title">{t('dialog.createRoomTitle')}</h2>
                <label>
                  {t('field.roomName')}
                  <input
                    data-create-room-name
                    value={roomName}
                    maxLength={32}
                    onChange={(event) => setRoomName(event.target.value)}
                  />
                </label>
                <label>
                  {t('field.password')}
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
                    {t('button.createRoom')}
                  </button>
                  <button className="button-secondary" type="button" onClick={() => setIsCreateDialogOpen(false)}>
                    {t('button.back')}
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
                <h2 id="join-password-title">{t('dialog.joinPasswordTitle')}</h2>
                <p>{passwordRoom.roomName}</p>
                <label>
                  {t('field.password')}
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
                    {t('button.joinRoom')}
                  </button>
                  <button className="button-secondary" type="button" onClick={() => setPasswordRoom(null)}>
                    {t('button.back')}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {identity ? (
        <section className="game-shell" data-scene={currentScene} aria-label={t('aria.p2pGame')}>
          <aside className="scoreboard" aria-label={t('aria.peers')}>
            <div className="scoreboard__header">
              <span>{t('room.idLabel')} <strong data-room-id>{identity.room.roomId}</strong></span>
              <strong data-channel-state>
                {connectedPeerCount > 1 ? t('room.channel.open') : t('room.channel.connecting')}
              </strong>
            </div>
            <div className="scoreboard-compact" data-compact-scoreboard>
              <div className="scoreboard-compact__players">
                {scoreboardPlayers.map((player) => (
                  <div
                    className="scoreboard-compact__player"
                    aria-label={
                      player.isLocal
                        ? t('aria.you', { displayName: player.displayName })
                        : player.isActive
                          ? t('aria.activePlayer')
                          : t('aria.player')
                    }
                    data-active={player.isActive}
                    data-compact-player
                    data-local={player.isLocal}
                    key={player.playerId}
                  >
                    {player.isLocal ? <span>{player.displayName}</span> : null}
                  </div>
                ))}
              </div>
              <button
                className="scoreboard-toggle"
                aria-expanded={isScoreboardExpanded}
                aria-label={isScoreboardExpanded ? t('aria.scoreboardCollapse') : t('aria.scoreboardExpand')}
                data-scoreboard-toggle
                type="button"
                onClick={() => setIsScoreboardExpanded((expanded) => !expanded)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            <div className="player-list">
              {peers.map((peer) => (
                <div className="player-row" data-active={peer.playerId === activePlayer?.playerId} key={peer.peerId}>
                  <div>
                    <strong>{peer.displayName}</strong>
                    <span>
                      {currentReadyGate && peer.playerId
                        ? `${peerRoleLabel(peer.role)}${t('common.slash')}${readyByPlayerId[peer.playerId] ? t('peerStatus.ready') : t('peerStatus.preparing')}`
                        : game
                          ? peerRoleLabel(peer.role)
                          : `${peerRoleLabel(peer.role)}${t('common.slash')}${peerConnectionStatusLabel(peer.connectionStatus)}`}
                    </span>
                  </div>
                  <div className="player-row__stats">
                    <span>{peer.playerId ?? t('role.spectator')}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {isScoreboardExpanded && currentScene === 'game_play' ? (
            <div className="scoreboard-overlay" data-scoreboard-overlay>
              <section
                className="scoreboard-overlay__panel"
                aria-label={t('aria.expandedScoreboard')}
                aria-modal="false"
                ref={scoreboardOverlayPanelRef}
                role="dialog"
              >
                <div className="scoreboard-overlay__header">
                  <div>
                    <span>{t('room.idLabel')}</span>
                    <strong>{identity.room.roomName}</strong>
                  </div>
                  <button
                    className="scoreboard-toggle scoreboard-toggle--open"
                    aria-expanded="true"
                    aria-label={t('aria.scoreboardCollapse')}
                    type="button"
                    onClick={() => setIsScoreboardExpanded(false)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
                <div className="scoreboard-overlay__hint" data-active-scoreboard-hint>
                  <span className="scoreboard-overlay__hint-block" />
                  <span>{t('aria.activePlayer')}</span>
                </div>
                <div className="scoreboard-overlay__players">
                  {scoreboardPlayers.map((player) => (
                    <div
                      className="scoreboard-overlay__player"
                      data-active={player.isActive}
                      data-local={player.isLocal}
                      data-scoreboard-player={player.playerId}
                      key={player.playerId}
                    >
                      <span>{player.displayName}</span>
                      <span>{t('common.cards', { count: player.remainingCardCount })}</span>
                      <strong>{t('common.points', { count: player.totalPenalty })}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          <section className="play-area">
            {!isResultScene ? (
              <div className="action-bar">
                {currentReadyGate === 'waiting_room' && !isSpectator ? (
                  <div className="ready-gate" data-ready-gate={currentReadyGate}>
                    <div className="action-bar__buttons">
                      <button data-ready-toggle data-start-game type="button" onClick={handleToggleReady}>
                        {readyGateActionLabel}
                      </button>
                      <button type="button" onClick={handleLeaveClick}>
                        {t('button.leave')}
                      </button>
                    </div>
                    {localReady || readyGatePlayerIds.length < 2 ? (
                      <p className="ready-gate__status" data-ready-status>{readyGateStatusText}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="action-bar__buttons">
                    <button type="button" onClick={handleLeaveClick}>
                      {t('button.leave')}
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {isResultScene ? (
              <div className="result-review-panel" data-result-review-panel>
                <div className="summary-panel summary-panel--result-review" data-game-result={game.status === 'game_result' ? 'true' : undefined} data-round-result>
                  <h2>
                    {game.status === 'game_result' ? t('summary.finalResult') : t('summary.roundResult')}{' '}
                    {latestSummary
                      ? t('common.fraction', { current: latestSummary.roundIndex + 1, total: game.totalRounds })
                      : ''}
                  </h2>
                  {standings.map((standing) => {
                    const roundResult = latestSummary?.playerResults.find(
                      (result) => result.playerId === standing.playerId,
                    );

                    return (
                      <div className="summary-row" key={standing.playerId}>
                        <span>{t('common.rankedName', { displayName: standing.displayName, rank: standing.rank })}</span>
                        <span>{formatPenaltyDelta(roundResult?.netPenaltyDelta ?? 0)}</span>
                        <strong>{t('common.points', { count: standing.totalPenalty })}</strong>
                      </div>
                    );
                  })}
                  <div className="ready-gate ready-gate--result" data-ready-gate={currentReadyGate ?? undefined}>
                    <div className="action-bar__buttons result-review-actions">
                      {isResultReadyGate ? (
                        <button data-ready-toggle data-result-primary-action type="button" onClick={handleToggleReady}>
                          {readyGateActionLabel}
                        </button>
                      ) : null}
                    </div>
                    {isResultReadyGate && localReady ? (
                      <p className="ready-gate__status" data-ready-status>{readyGateStatusText}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="stage-frame">
              {game ? (
                <PixiDragStage
                  activePlayerId={activePlayer?.playerId ?? null}
                  canPlay={isLocalTurn}
                  debugId={isSpectator ? 'spectator-stage' : 'game-stage'}
                  game={game}
                  handPlayerId={localPlayerId}
                  legalMoves={legalMoves}
                  onPlayCard={handlePlayCard}
                  showHand={!isSpectator}
                />
              ) : (
                <div className="waiting-canvas" data-waiting-for-snapshot>
                  {t('waiting.hostStart')}
                </div>
              )}
            </div>

            {canMaximizeSpectatorBoard ? (
              <div className="spectator-board-controls">
                <button
                  className="board-icon-button board-icon-button--maximize"
                  aria-label={t('button.maximizeBoard')}
                  data-spectator-board-toggle
                  type="button"
                  onClick={() => setIsBoardMaximized(true)}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            ) : null}

            <p className="game-message" data-game-message>{message}</p>
          </section>

          {isBoardMaximized && game && isSpectator ? (
            <div className="board-fullscreen" data-board-fullscreen role="dialog" aria-label={t('aria.maximizedBoard')}>
              <PixiDragStage
                activePlayerId={activePlayer?.playerId ?? null}
                canPlay={false}
                debugId="spectator-fullscreen"
                fitMode="perfect-pyramid"
                game={game}
                handPlayerId={null}
                legalMoves={[]}
                onPlayCard={handlePlayCard}
                showHand={false}
              />
              <button
                className="board-icon-button board-icon-button--minimize board-fullscreen__close"
                aria-label={t('button.restoreBoard')}
                data-spectator-board-close
                type="button"
                onClick={() => setIsBoardMaximized(false)}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <aside className="round-panel" aria-label={t('aria.p2pDetails')}>
            <div className="metric-grid">
              <div>
                <span>{t('metric.players')}</span>
                <strong data-player-count>{playerCount}</strong>
              </div>
              <div>
                <span>{t('metric.connected')}</span>
                <strong data-connected-count>{connectedPeerCount}</strong>
              </div>
              <div>
                <span>{t('metric.spectators')}</span>
                <strong data-spectator-count>{spectatorCount}</strong>
              </div>
              <div>
                <span>{t('metric.board')}</span>
                <strong data-board-count>{game?.currentRound?.board.occupiedCellKeys.length ?? 0}</strong>
              </div>
              <div>
                <span>{t('metric.hand')}</span>
                <strong data-hand-count>{activeRoundPlayer?.remainingCardCount ?? 0}</strong>
              </div>
              <div>
                <span>{t('metric.legal')}</span>
                <strong data-legal-count>{legalMoves.length}</strong>
              </div>
              <div>
                <span>{t('metric.revision')}</span>
                <strong data-revision>{game?.revision ?? 0}</strong>
              </div>
              <div>
                <span>{t('metric.host')}</span>
                <strong data-host-peer>{hostPeerId ?? t('common.none')}</strong>
              </div>
            </div>

            {isResultScene ? (
              <div className="result-exit-actions" data-result-exit-actions>
                <button className="button-secondary" data-result-secondary-action type="button" onClick={handleLeaveClick}>
                  {t('button.leave')}
                </button>
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}

      {isLeaveConfirmOpen ? (
        <div className="dialog-backdrop">
          <div className="dialog-card" aria-labelledby="leave-room-title" aria-modal="true" role="dialog">
            <h2 id="leave-room-title">{t('dialog.leaveRoomTitle')}</h2>
            <p>{t('dialog.leaveRoomBody')}</p>
            <div className="dialog-actions">
              <button data-confirm-leave-room type="button" onClick={handleLeaveRoom}>
                {t('button.leave')}
              </button>
              <button className="button-secondary" type="button" onClick={() => setIsLeaveConfirmOpen(false)}>
                {t('button.stay')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );

  function handleP2PPayload(envelope: P2PEnvelope): void {
    const payload = envelope.payload;

    if (payload.type === 'host_hello') {
      const currentIdentity = identityRef.current;
      const playingIdentity = currentIdentity
        ? {
            ...currentIdentity,
            room: { ...currentIdentity.room, status: 'playing' as const, hostPeerId: payload.currentHostPeerId },
          }
        : null;

      if (playingIdentity) {
        identityRef.current = playingIdentity;
        setIdentity(playingIdentity);
        void activateGameRejoinCode(playingIdentity);
      }

      setHostPeerId(payload.currentHostPeerId);
      hostPeerIdRef.current = payload.currentHostPeerId;
      meshRef.current?.setHostPeerId(payload.currentHostPeerId);
      gameRef.current = payload.snapshot;
      setGame(payload.snapshot);
      setMessage(t('message.receivedHostSnapshot'));
      sendPeerReady(payload.snapshot);
      return;
    }

    if (payload.type === 'peer_ready') {
      setMessage(t('message.peerReady'));
      return;
    }

    if (payload.type === 'ready_gate_state') {
      applyReadyGateSnapshot(payload);
      return;
    }

    if (payload.type === 'player_command' && identityRef.current?.peerId === hostPeerIdRef.current) {
      if (payload.command.type === 'set_ready') {
        applyReadyGateUpdate(payload.command.gate, payload.playerId, payload.command.ready);
        return;
      }

      commitHostMove(payload.playerId, payload.command.cardId, payload.command.target, envelope.fromPeerId, payload.commandId);
      return;
    }

    if (payload.type === 'event_committed') {
      gameRef.current = payload.snapshot;
      setGame(payload.snapshot);
      setMessage(t('message.committedEvent', { eventSeq: payload.eventSeq, revision: payload.revision }));
      return;
    }

    if (payload.type === 'room_phase_changed') {
      applyWaitingRoomPhase(payload.hostPeerId);
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
      }

      setNetworkStatus(t('network.hostRevision', { revision: payload.revision }));
      return;
    }

    if (payload.type === 'command_rejected') {
      setMessage(t('message.commandRejected', { reason: payload.reason }));
    }
  }

  function applyReadyGateUpdate(gate: ReadyGateKind, playerId: PlayerId, ready: boolean): void {
    const currentIdentity = identityRef.current;
    const currentGate = getReadyGateKind(currentIdentity, gameRef.current);

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current || gate !== currentGate) {
      return;
    }

    const requiredPlayerIds = getReadyGatePlayerIds(currentIdentity, peersRef.current, gameRef.current);

    if (!requiredPlayerIds.includes(playerId)) {
      return;
    }

    const nextReady = pruneReadyState(readyByPlayerIdRef.current, requiredPlayerIds);

    if (ready) {
      nextReady[playerId] = true;
    } else {
      delete nextReady[playerId];
    }

    readyByPlayerIdRef.current = nextReady;
    setReadyByPlayerId(nextReady);
    broadcastReadyGateState(gate, nextReady, requiredPlayerIds);
    evaluateReadyGate(gate, nextReady, requiredPlayerIds);
  }

  function applyReadyGateSnapshot(payload: ReadyGateState): void {
    const currentGate = getReadyGateKind(identityRef.current, gameRef.current);

    if (payload.gate !== currentGate) {
      return;
    }

    const allowedPlayerIds = new Set(payload.requiredPlayerIds);
    const nextReady = Object.fromEntries(
      payload.readyPlayerIds.filter((playerId) => allowedPlayerIds.has(playerId)).map((playerId) => [playerId, true]),
    );
    readyByPlayerIdRef.current = nextReady;
    setReadyByPlayerId(nextReady);
  }

  function evaluateReadyGate(
    gate: ReadyGateKind,
    readyState: Record<PlayerId, boolean>,
    requiredPlayerIds: PlayerId[],
  ): void {
    const currentIdentity = identityRef.current;

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current) {
      return;
    }

    if (gate === 'waiting_room' && requiredPlayerIds.length < 2) {
      return;
    }

    if (requiredPlayerIds.length === 0 || requiredPlayerIds.some((playerId) => !readyState[playerId])) {
      return;
    }

    if (gate === 'waiting_room') {
      void startGameFromReadyGate(requiredPlayerIds);
      return;
    }

    if (gate === 'round_result') {
      startNextRoundFromReadyGate();
      return;
    }

    returnRoomToWaitingFromReadyGate();
  }

  async function startGameFromReadyGate(requiredPlayerIds: PlayerId[]): Promise<void> {
    const currentIdentity = identityRef.current;

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current) {
      return;
    }

    const required = new Set(requiredPlayerIds);
    const playerPeers = getPlayerPeers(currentIdentity, peersRef.current).filter((peer) => required.has(peer.playerId));

    if (playerPeers.length < 2) {
      return;
    }

    const snapshot = createLocalGame({
      playerCount: playerPeers.length,
      playerIds: playerPeers.map((peer) => peer.playerId),
      playerNames: playerPeers.map((peer) => peer.displayName),
      seed: `room-${currentIdentity.room.roomId}`,
    });

    clearReadyGateState();
    eventSeqRef.current = 0;
    gameRef.current = snapshot;
    setGame(snapshot);

    try {
      await markRoomPlaying(currentIdentity.room.roomId, connectedSignalingServerUrl ?? undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('message.markRoomPlayingFailed'));
      return;
    }

    let playingIdentity: NetworkIdentity = {
      ...currentIdentity,
      room: { ...currentIdentity.room, status: 'playing' as const },
    };
    identityRef.current = playingIdentity;
    setIdentity(playingIdentity);
    playingIdentity = await activateGameRejoinCode(playingIdentity);
    setScene('game_play');
    setMessage(t('message.startedMultiplayerGame', { count: playerPeers.length }));

    for (const peer of peersRef.current) {
      if (peer.peerId !== currentIdentity.peerId) {
        sendHostHello(playingIdentity, peer, snapshot);
      }
    }
  }

  function startNextRoundFromReadyGate(): void {
    const currentGame = gameRef.current;

    if (!currentGame || currentGame.status !== 'round_result') {
      return;
    }

    const nextGame = startNextRound(currentGame);
    clearReadyGateState();
    commitHostResolvedState(nextGame);
    setScene('game_play');
  }

  async function activateGameRejoinCode(currentIdentity: NetworkIdentity): Promise<NetworkIdentity> {
    if (!connectedSignalingServerUrl || !currentIdentity.playerId || currentIdentity.role === 'spectator') {
      return currentIdentity;
    }

    try {
      const { rejoinCode: nextRejoinCode } = await requestGameRejoinCode(
        currentIdentity,
        connectedSignalingServerUrl,
      );

      if (identityRef.current?.peerId !== currentIdentity.peerId) {
        return currentIdentity;
      }

      const nextIdentity = {
        ...identityRef.current,
        rejoinCode: nextRejoinCode,
      };
      const nextStoredRejoinSession = {
        rejoinCode: nextRejoinCode,
        signalingServerUrl: connectedSignalingServerUrl,
      };
      identityRef.current = nextIdentity;
      storeRejoinSession(nextStoredRejoinSession);
      setStoredRejoinSession(nextStoredRejoinSession);
      setIsStoredRejoinAvailable(false);
      setIdentity(nextIdentity);
      return nextIdentity;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('message.rejoinIssueFailed'));
      return currentIdentity;
    }
  }

  function returnRoomToWaitingFromReadyGate(): void {
    const currentIdentity = identityRef.current;

    if (!currentIdentity || currentIdentity.peerId !== hostPeerIdRef.current) {
      return;
    }

    clearReadyGateState();
    eventSeqRef.current = 0;
    void markRoomWaitingForStart(currentIdentity.room.roomId, connectedSignalingServerUrl ?? undefined);
    applyWaitingRoomPhase(currentIdentity.peerId);
    meshRef.current?.broadcastPayload({
      type: 'room_phase_changed',
      roomStatus: 'waiting_for_start',
      hostPeerId: currentIdentity.peerId,
    });
  }

  function applyWaitingRoomPhase(nextHostPeerId: string): void {
    const currentIdentity = identityRef.current;

    if (!currentIdentity) {
      return;
    }

    const waitingIdentity: NetworkIdentity = {
      ...currentIdentity,
      rejoinCode: undefined,
      room: {
        ...currentIdentity.room,
        hostPeerId: nextHostPeerId,
        status: 'waiting_for_start',
      },
    };
    identityRef.current = waitingIdentity;
    gameRef.current = null;
    hostPeerIdRef.current = nextHostPeerId;
    meshRef.current?.setHostPeerId(nextHostPeerId);
    clearStoredRejoinSession();
    setStoredRejoinSession(null);
    setIsStoredRejoinAvailable(false);
    setIdentity(waitingIdentity);
    setGame(null);
    setHostPeerId(nextHostPeerId);
    setScene('waiting_room');
    setMessage(t('message.returnedToWaitingRoom'));
  }

  function broadcastReadyGateState(
    gate: ReadyGateKind,
    readyState: Record<PlayerId, boolean>,
    requiredPlayerIds: PlayerId[],
  ): void {
    const payload: ReadyGateState = {
      type: 'ready_gate_state',
      gate,
      readyPlayerIds: requiredPlayerIds.filter((playerId) => readyState[playerId]),
      requiredPlayerIds,
    };

    meshRef.current?.broadcastPayload(payload);
  }

  function clearReadyGateState(): void {
    readyGateRef.current = null;
    readyByPlayerIdRef.current = {};
    setReadyByPlayerId({});
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
      setMessage(t('message.hostDisconnectedNoReplacement'));
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
      setMessage(t('message.hostDisconnectedPromoted'));

      if (nextGame) {
        for (const peer of candidates) {
          if (peer.peerId !== promotedIdentity.peerId) {
            sendHostHello(promotedIdentity, peer, nextGame);
          }
        }
      }
    } else {
      setMessage(t('message.hostDisconnectedElected'));
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

  function sendReadyGateStateToPeer(
    currentIdentity: NetworkIdentity,
    peer: PeerSummary | PeerRuntimeView,
    gate: ReadyGateKind,
  ): void {
    const requiredPlayerIds = getReadyGatePlayerIds(currentIdentity, peersRef.current, gameRef.current);
    const readyState = pruneReadyState(readyByPlayerIdRef.current, requiredPlayerIds);
    const payload: ReadyGateState = {
      type: 'ready_gate_state',
      gate,
      readyPlayerIds: requiredPlayerIds.filter((playerId) => readyState[playerId]),
      requiredPlayerIds,
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
      setMessage(t('message.cardPlayed', {
        color: cardColorLabel(currentGame.cardsById[cardId].color),
        displayName: currentGame.players.find((player) => player.playerId === playerId)?.displayName,
      }));

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
    setMessage(t('message.committedEvent', { eventSeq: eventSeqRef.current, revision: nextGame.revision }));

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

  async function refreshNameReservation(displayName: string): Promise<void> {
    if (!connectedSignalingServerUrl) {
      setMessage(t('message.connectBeforeRefreshName'));
      setScene('landing_page');
      return;
    }

    try {
      const reservation = await validatePlayerName(
        displayName,
        nameReservationTokenRef.current ?? undefined,
        connectedSignalingServerUrl,
      );
      nameReservationTokenRef.current = reservation.nameReservationToken;
    } catch (error) {
      if (Date.now() - lastRoomLeaveAtRef.current < 2500) {
        setMessage(t('message.returnedToMatchmakingRefreshingName'));
        window.setTimeout(() => {
          void refreshNameReservation(displayName);
        }, 500);
        return;
      }

      setMessage(error instanceof Error ? error.message : t('message.playerNameUnavailable'));
      releaseCurrentNameReservation();
      setScene('landing_page');
    }
  }

  function releaseCurrentNameReservation(): void {
    const token = nameReservationTokenRef.current;

    if (!token) {
      return;
    }

    nameReservationTokenRef.current = null;
    void releasePlayerNameReservation(token, connectedSignalingServerUrl ?? undefined);
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

function getReadyGateKind(identity: NetworkIdentity | null, game: GameSessionState | null): ReadyGateKind | null {
  if (!identity || identity.role === 'spectator') {
    return null;
  }

  if (!game && identity.room.status === 'waiting_for_start') {
    return 'waiting_room';
  }

  if (game?.status === 'round_result' || game?.status === 'game_result') {
    return game.status;
  }

  return null;
}

function getReadyGatePlayerIds(
  identity: NetworkIdentity,
  peers: PeerRuntimeView[],
  game: GameSessionState | null,
): PlayerId[] {
  const onlinePlayerIds = new Set(
    getPlayerPeers(identity, peers)
      .filter((peer) => peer.connectionStatus !== 'closed' && peer.connectionStatus !== 'disconnected')
      .map((peer) => peer.playerId),
  );

  if (game) {
    return game.players.map((player) => player.playerId).filter((playerId) => onlinePlayerIds.has(playerId));
  }

  return [...onlinePlayerIds].sort((left, right) => numericPlayerIndex(left) - numericPlayerIndex(right));
}

function pruneReadyState(
  readyState: Record<PlayerId, boolean>,
  requiredPlayerIds: PlayerId[],
): Record<PlayerId, boolean> {
  const required = new Set(requiredPlayerIds);

  return Object.fromEntries(Object.entries(readyState).filter(([playerId, ready]) => ready && required.has(playerId)));
}

function readyActionLabel(gate: ReadyGateKind, isReady: boolean): string {
  if (isReady) {
    return gate === 'waiting_room' ? t('ready.action.waitingRoomReady') : t('ready.action.resultReady');
  }

  if (gate === 'round_result') {
    return t('ready.action.roundResult');
  }

  if (gate === 'game_result') {
    return t('ready.action.gameResult');
  }

  return t('ready.action.waitingRoom');
}

function readyStatusText(
  gate: ReadyGateKind,
  isReady: boolean,
  remainingCount: number,
  playerCount: number,
): string {
  if (gate === 'waiting_room' && playerCount < 2) {
    return t('ready.status.waitingRoomNeedsPlayers');
  }

  if (!isReady) {
    return '';
  }

  if (gate === 'waiting_room') {
    return t('ready.status.waitingForPlayers', { count: remainingCount });
  }

  return t('ready.status.resultWaiting', { count: remainingCount });
}

function formatPenaltyDelta(penaltyDelta: number): string {
  if (penaltyDelta === 0) {
    return '+0';
  }

  return penaltyDelta > 0 ? `+${penaltyDelta}` : String(penaltyDelta);
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
  return t('player.defaultName', { suffix });
}

function toRoomListItem(room: RoomMetadata): RoomListItemView {
  const canJoin = room.status === 'playing' || room.currentPlayerCount < room.maxPlayers;

  return {
    ...room,
    canJoin,
    joinRole: canJoin ? (room.status === 'playing' ? 'spectator' : 'player') : null,
  };
}

function getLandingMessage(
  hasLandingStartInput: boolean,
  signalingConnectionStatus: SignalingConnectionStatus,
  message: string,
): string {
  if (!hasLandingStartInput) {
    return t('validation.landingMissingInput');
  }

  if (signalingConnectionStatus !== 'connected') {
    return t('validation.landingNeedsSignaling');
  }

  return message;
}

function getSignalingConnectionLabel(
  status: SignalingConnectionStatus,
  connectedSignalingServerUrl: string | null,
): string {
  if (status === 'connected' && connectedSignalingServerUrl) {
    return t('signaling.connected', { url: connectedSignalingServerUrl });
  }

  if (status === 'checking') {
    return t('signaling.connecting');
  }

  if (status === 'error') {
    return t('signaling.failed');
  }

  return t('signaling.notConnected');
}

function getConnectionIndicatorView(
  status: SignalingConnectionStatus,
  connectedSignalingServerUrl: string | null,
  networkStatus: string,
): { label: string; status: SignalingConnectionStatus } {
  if (status !== 'connected') {
    return {
      label: getSignalingConnectionLabel(status, connectedSignalingServerUrl),
      status,
    };
  }

  return {
    label: networkStatus === t('network.idle') ? t('signaling.connectedShort') : networkStatus,
    status,
  };
}

function sceneLabel(scene: MultiplayerScene): string {
  return t(`scene.${scene}`);
}
