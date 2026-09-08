import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguageSelector } from './LanguageSelector';

const meta = {
  title: 'Components/Language Selector',
  component: LanguageSelector,
  decorators: [
    (Story) => (
      <div className="app-shell" style={{ minHeight: '180px', padding: '32px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LanguageSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
