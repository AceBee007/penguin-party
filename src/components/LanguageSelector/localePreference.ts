import { useState, useSyncExternalStore } from 'react';
import {
  getCurrentLocale,
  resolveSupportedLocale,
  setLocale,
  subscribeLocale,
  type LocaleCode,
} from '../../i18n/uiText';

const LANGUAGE_COOKIE_NAME = 'prefered-language';
const LANGUAGE_QUERY_PARAM = 'lang';
const LANGUAGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function useSelectedLocale(): LocaleCode {
  const [initialized] = useState(() => {
    initializePreferredLocale();
    return true;
  });

  if (!initialized) {
    return 'en';
  }

  return useSyncExternalStore(subscribeLocale, getCurrentLocale, getCurrentLocale);
}

export function handleLanguageChange(rawLocale: string): void {
  const locale = resolveSupportedLocale(rawLocale) ?? 'en';

  writeLanguageCookie(locale);
  removeLanguageQueryParam();
  setLocale(locale);
}

function initializePreferredLocale(): LocaleCode {
  const locale = resolvePreferredLocale();
  setLocale(locale);

  return locale;
}

function resolvePreferredLocale(): LocaleCode {
  const queryLocale = readQueryLocale();

  if (queryLocale) {
    return queryLocale;
  }

  const cookieLocale = readLanguageCookie();

  if (cookieLocale) {
    return cookieLocale;
  }

  return readBrowserLocale() ?? 'en';
}

function readQueryLocale(): LocaleCode | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawLocale = new URL(window.location.href).searchParams.get(LANGUAGE_QUERY_PARAM);

  return resolveSupportedLocale(rawLocale) ?? (rawLocale ? 'en' : null);
}

function readLanguageCookie(): LocaleCode | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookieValue = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${LANGUAGE_COOKIE_NAME}=`))
    ?.slice(LANGUAGE_COOKIE_NAME.length + 1);

  return cookieValue ? resolveSupportedLocale(decodeURIComponent(cookieValue)) : null;
}

function readBrowserLocale(): LocaleCode | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  const browserLocales = [...(navigator.languages ?? []), navigator.language];

  for (const rawLocale of browserLocales) {
    const locale = resolveSupportedLocale(rawLocale);

    if (locale) {
      return locale;
    }
  }

  return null;
}

function writeLanguageCookie(locale: LocaleCode): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = [
    `${LANGUAGE_COOKIE_NAME}=${encodeURIComponent(locale)}`,
    `Max-Age=${LANGUAGE_COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
  ].join('; ');
}

function removeLanguageQueryParam(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);

  if (!url.searchParams.has(LANGUAGE_QUERY_PARAM)) {
    return;
  }

  url.searchParams.delete(LANGUAGE_QUERY_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
