import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { Preview } from '@storybook/react-vite';
import { setLocale, type LocaleCode } from '../src/i18n/uiText';
import '../src/styles/main.scss';

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
  },
  tags: ['autodocs'],
};

export default preview;
