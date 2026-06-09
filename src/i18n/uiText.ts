import en from './locales/en.json';
import ja from './locales/ja.json';
import type { CardColor, GameStatus, RoundEndReason, RoundPlayerStatus } from '../game/types';
import type { PeerConnectionStatus, PeerRole, RoomMetadata } from '../network/types';

type TextParams = Record<string, number | string | null | undefined>;

const dictionaries = {
  en,
  ja,
} as const;
const DEFAULT_LOCALE = 'en';
const localeListeners = new Set<() => void>();

export const SUPPORTED_LOCALES = [
  { code: 'en', nativeName: 'English' },
  { code: 'ja', nativeName: '日本語' },
] as const;

export type LocaleCode = keyof typeof dictionaries;

let currentLocale: LocaleCode = DEFAULT_LOCALE;

export function t(key: string, params: TextParams = {}): string {
  const template = getTextTemplate(key);

  return template.replace(/\{(\w+)\}/g, (match, paramName: string) => {
    const value = params[paramName];

    return value === null || value === undefined ? match : String(value);
  });
}

export function getCurrentLocale(): LocaleCode {
  return currentLocale;
}

export function setLocale(locale: LocaleCode): void {
  applyDocumentLocale(locale);

  if (locale === currentLocale) {
    return;
  }

  currentLocale = locale;
  localeListeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);

  return () => localeListeners.delete(listener);
}

export function resolveSupportedLocale(rawLocale: string | null | undefined): LocaleCode | null {
  const normalizedLocale = rawLocale?.trim().toLowerCase();

  if (!normalizedLocale) {
    return null;
  }

  if (normalizedLocale in dictionaries) {
    return normalizedLocale as LocaleCode;
  }

  const baseLanguage = normalizedLocale.split('-')[0];

  return baseLanguage in dictionaries ? (baseLanguage as LocaleCode) : null;
}

function applyDocumentLocale(locale: LocaleCode): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = locale;
}

export function cardColorLabel(color: CardColor): string {
  return t(`card.color.${color}`);
}

export function gameStatusLabel(status: GameStatus): string {
  return t(`gameStatus.${status}`);
}

export function peerConnectionStatusLabel(status: PeerConnectionStatus): string {
  return t(`peerConnectionStatus.${status}`);
}

export function peerRoleLabel(role: PeerRole): string {
  return t(`role.${role}`);
}

export function roomStatusLabel(status: RoomMetadata['status']): string {
  return t(`room.status.${status}`);
}

export function roundEndReasonLabel(reason: RoundEndReason): string {
  return t(`roundEndReason.${reason}`);
}

export function roundPlayerStatusLabel(status: RoundPlayerStatus): string {
  return t(`roundPlayerStatus.${status}`);
}

function getTextTemplate(key: string): string {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, dictionaries[currentLocale]);

  if (typeof value === 'string') {
    return value;
  }

  const fallbackValue = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, dictionaries[DEFAULT_LOCALE]);

  return typeof fallbackValue === 'string' ? fallbackValue : `[${key}]`;
}
