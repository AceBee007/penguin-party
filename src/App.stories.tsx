import type { Meta, StoryObj } from '@storybook/react-vite';
import { LocalGame } from './App';
import { useSelectedLocale } from './components/LanguageSelector';
import { createLocalGame } from './game/rules';

const meta = {
  title: 'Pages/Local Game',
  component: LocalGame,
  parameters: {
    layout: 'fullscreen',
  },
  render: (args) => {
    const locale = useSelectedLocale();

    return <LocalGame {...args} locale={locale} />;
  },
} satisfies Meta<typeof LocalGame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoPlayers: Story = {
  args: {
    locale: 'en',
    initialGame: createLocalGame({
      playerCount: 2,
      playerNames: ['You', 'Player 2'],
      seed: 'storybook-local-two-players',
    }),
  },
};

export const SixPlayers: Story = {
  args: {
    locale: 'en',
    initialGame: createLocalGame({
      playerCount: 6,
      playerNames: ['You', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'],
      seed: 'storybook-local-six-players',
    }),
  },
};
