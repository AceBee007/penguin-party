import type { Meta, StoryObj } from '@storybook/react-vite';
import { BrandTitle } from './BrandTitle';

const meta = {
  title: 'Components/Brand Title',
  component: BrandTitle,
  decorators: [
    (Story) => (
      <div className="app-shell" style={{ minHeight: '180px' }}>
        <header className="topbar">
          <div className="brand">
            <div className="brand__copy">
              <Story />
            </div>
          </div>
        </header>
      </div>
    ),
  ],
} satisfies Meta<typeof BrandTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
