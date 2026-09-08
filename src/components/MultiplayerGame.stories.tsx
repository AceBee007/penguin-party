import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useSelectedLocale } from './LanguageSelector';
import { MultiplayerGame } from './MultiplayerGame';
import {
  clearAllStoredRejoinSessions,
  storeRejoinSession,
} from '../network/rejoinStorage';
import {
  clearRejoinCodeQuery,
  setRejoinCodeQuery,
  setSignalingServerQuery,
} from '../network/signalingClient';

function MultiplayerLandingPreview() {
  const [isReady] = useState(() => {
    clearAllStoredRejoinSessions();
    clearRejoinCodeQuery();
    return true;
  });
  const locale = useSelectedLocale();

  return isReady ? <MultiplayerGame locale={locale} /> : null;
}

function MultiplayerRejoinPreview() {
  const locale = useSelectedLocale();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const previousFetch = window.fetch;
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const currentTabCode = `storybook-current.${expiresAt.toString(36)}`;
    const otherTabCode = `storybook-other.${(expiresAt + 60_000).toString(36)}`;
    const signalingServerUrl = 'http://storybook-signaling.local';
    const roomsByCode = new Map([
      [currentTabCode, {
        roomId: 'CURRENT',
        roomName: 'Penguin Table',
        currentPlayerCount: 3,
        maxPlayers: 6,
      }],
      [otherTabCode, {
        roomId: 'OTHER',
        roomName: 'Snow Room',
        currentPlayerCount: 5,
        maxPlayers: 6,
      }],
    ]);

    clearAllStoredRejoinSessions();
    storeRejoinSession({ rejoinCode: otherTabCode, signalingServerUrl });
    storeRejoinSession({ rejoinCode: currentTabCode, signalingServerUrl });
    setSignalingServerQuery(signalingServerUrl);
    setRejoinCodeQuery(currentTabCode);
    window.fetch = async (input, init) => {
      const requestUrl = String(input);

      if (requestUrl.endsWith('/rejoin/status')) {
        const body = typeof init?.body === 'string'
          ? JSON.parse(init.body) as { rejoinCode?: string }
          : {};
        const room = body.rejoinCode ? roomsByCode.get(body.rejoinCode) : undefined;

        return Response.json(room ? { valid: true, room } : { valid: false });
      }

      if (requestUrl.endsWith('/rooms')) {
        return Response.json({ rooms: [] });
      }

      return new Response(null, { status: 404 });
    };
    setIsReady(true);

    return () => {
      window.fetch = previousFetch;
      clearAllStoredRejoinSessions();
      clearRejoinCodeQuery(currentTabCode);
      removeStorybookSignalingServerQuery(signalingServerUrl);
    };
  }, []);

  return isReady ? <MultiplayerGame locale={locale} /> : null;
}

const meta = {
  title: 'Pages/Multiplayer Game',
  component: MultiplayerGame,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof MultiplayerGame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LandingPage: Story = {
  args: {
    locale: 'en',
  },
  render: () => <MultiplayerLandingPreview />,
};

export const MultipleRejoinCandidates: Story = {
  args: {
    locale: 'en',
  },
  render: () => <MultiplayerRejoinPreview />,
};

function removeStorybookSignalingServerQuery(expectedUrl: string): void {
  const pageUrl = new URL(window.location.href);

  if (pageUrl.searchParams.get('signaling-server') !== expectedUrl) {
    return;
  }

  pageUrl.searchParams.delete('signaling-server');
  window.history.replaceState(window.history.state, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
}
