# penguin-party

React + PixiJS scaffold for Penguin Party.

## Development

```sh
npm install
npm run dev
npm run signaling
```

Local development ports use the `1520x` range by default:

- Vite app: `http://127.0.0.1:15200` or `http://<LAN_IP>:15200`
- Signaling server: `http://127.0.0.1:15201` or `http://<LAN_IP>:15201`

The npm scripts bind both local servers to `0.0.0.0` by default so devices on the same LAN can connect. The browser client uses the current page host as the default signaling host, so opening `http://192.168.1.9:15200` makes it target `http://192.168.1.9:15201`.

Port environment variables:

- `APP_HOST`: Vite dev server bind host. Defaults to `0.0.0.0`.
- `APP_PORT`: Vite dev server port. Empty or invalid values fall back to `15200`.
- `SIGNALING_HOST`: Node signaling server bind host. Defaults to `0.0.0.0`.
- `SIGNALING_PORT`: Node signaling server port. Empty or invalid values fall back to `15201`.
- `VITE_SIGNALING_HOST`: browser client signaling target host. Defaults to the current page host.
- `VITE_SIGNALING_PORT`: browser client signaling target port. Use this with `npm run dev` when `SIGNALING_PORT` is changed.
- `VITE_SIGNALING_URL`: browser client signaling target URL. If set, it takes precedence over `VITE_SIGNALING_PORT`.

## Storybook

Run Storybook to inspect pages and components in isolation:

```sh
npm run storybook
```

Storybook is available at `http://127.0.0.1:6006` by default. Use the toolbar to switch between English and Japanese. Set `STORYBOOK_HOST` or `STORYBOOK_PORT` to change its bind address or port.

Build the static Storybook bundle with:

```sh
npm run build-storybook
```

## Checks

```sh
npm run build
npm run test
npm run test:e2e
```
