import { SUPPORTED_LOCALES, t } from '../../i18n/uiText';
import { handleLanguageChange, useSelectedLocale } from './localePreference';

export function LanguageSelector() {
  const locale = useSelectedLocale();

  return (
    <label className="language-selector">
      <span>{t('field.language')}</span>
      <select
        aria-label={t('field.language')}
        data-language-selector
        value={locale}
        onChange={(event) => handleLanguageChange(event.target.value)}
      >
        {SUPPORTED_LOCALES.map((item) => (
          <option key={item.code} value={item.code}>
            {item.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
