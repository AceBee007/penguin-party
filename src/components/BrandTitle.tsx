import { t } from '../i18n/uiText';

const BRAND_COLOR_COUNT = 5;

export function BrandTitle() {
  const brandTitle = t('app.title');
  let letterIndex = 0;

  return (
    <h1 className="brand__title" aria-label={brandTitle}>
      {Array.from(brandTitle).map((character, index) => {
        if (character === ' ') {
          return (
            <span aria-hidden="true" className="brand__title-space" key={`${character}-${index}`}>
              {' '}
            </span>
          );
        }

        const colorIndex = letterIndex % BRAND_COLOR_COUNT;
        letterIndex += 1;

        return (
          <span
            aria-hidden="true"
            className={`brand__title-letter brand__title-letter--${colorIndex}`}
            key={`${character}-${index}`}
          >
            {character}
          </span>
        );
      })}
    </h1>
  );
}
