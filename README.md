# penguin-party

React + PixiJS scaffold for Penguin Party.

## Development

```sh
npm install
npm run dev
```

Local development ports use the `1520x` range by default:

- Vite app: `http://127.0.0.1:15200`
- Signaling server: `http://127.0.0.1:15201`

Port environment variables:

- `APP_PORT`: Vite dev server port. Empty or invalid values fall back to `15200`.
- `SIGNALING_PORT`: Node signaling server port. Empty or invalid values fall back to `15201`.
- `VITE_SIGNALING_PORT`: browser client signaling target port. Use this with `npm run dev` when `SIGNALING_PORT` is changed.
- `VITE_SIGNALING_URL`: browser client signaling target URL. If set, it takes precedence over `VITE_SIGNALING_PORT`.

## Checks

```sh
npm run build
npm run test
npm run test:e2e
```
