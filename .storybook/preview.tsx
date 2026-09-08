import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { Preview } from '@storybook/react-vite';
import type { ViewportMap } from 'storybook/viewport';
import { setLocale, type LocaleCode } from '../src/i18n/uiText';
import '../src/styles/main.scss';

const IPHONE_VIEWPORTS = {
  iphone6s: {
    name: 'iPhone 6s',
    styles: {
      height: '667px',
      width: '375px',
    },
    type: 'mobile',
  },
  iphone13pro: {
    name: 'iPhone 13 Pro',
    styles: { height: '844px', width: '390px' },
    type: 'mobile',
  },
  iphone13promax: {
    name: 'iPhone 13 Pro Max',
    styles: { height: '926px', width: '428px' },
    type: 'mobile',
  },
  iphone14pro15pro: {
    name: 'iPhone 14 Pro / 15 Pro',
    styles: { height: '852px', width: '393px' },
    type: 'mobile',
  },
  iphone14promax15promax: {
    name: 'iPhone 14 Pro Max / 15 Pro Max',
    styles: { height: '932px', width: '430px' },
    type: 'mobile',
  },
  iphone16pro17pro: {
    name: 'iPhone 16 Pro / 17 Pro',
    styles: { height: '874px', width: '402px' },
    type: 'mobile',
  },
  iphone16promax17promax: {
    name: 'iPhone 16 Pro Max / 17 Pro Max',
    styles: { height: '956px', width: '440px' },
    type: 'mobile',
  },
} satisfies ViewportMap;

interface LocaleGateProps {
  children: ReactNode;
  locale: LocaleCode;
}

function LocaleGate({ children, locale }: LocaleGateProps) {
  const [appliedLocale, setAppliedLocale] = useState<LocaleCode | null>(null);

  useLayoutEffect(() => {
    document.cookie = `prefered-language=${encodeURIComponent(locale)}; Path=/; SameSite=Lax`;
    setLocale(locale);
    setAppliedLocale(locale);
  }, [locale]);

  if (appliedLocale !== locale) {
    return null;
  }

  return <div lang={locale}>{children}</div>;
}

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const locale: LocaleCode = context.globals.locale === 'ja' ? 'ja' : 'en';

      return (
        <LocaleGate locale={locale}>
          <Story />
        </LocaleGate>
      );
    },
  ],
  globalTypes: {
    locale: {
      description: 'UI language',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'ja', title: '日本語' },
        ],
      },
    },
  },
  initialGlobals: {
    locale: 'en',
  },
  parameters: {
    a11y: {
      test: 'todo',
    },
    controls: {
      expanded: true,
    },
    layout: 'fullscreen',
    viewport: {
      options: IPHONE_VIEWPORTS,
    },
  },
  tags: ['autodocs'],
};

export default preview;
