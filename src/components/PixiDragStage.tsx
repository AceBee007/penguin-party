import { useEffect, useRef } from 'react';
import {
  Application,
  Assets,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from 'pixi.js';
import penguinTokenUrl from '../assets/penguin-token.svg';

export interface DragStatus {
  selectedToken: string;
  position: string;
}

interface PixiDragStageProps {
  onDragStatusChange: (status: DragStatus) => void;
}

interface PenguinToken {
  id: string;
  label: string;
  sprite: Sprite;
  home: { x: number; y: number };
}

const TOKEN_SIZE = 92;
const TOKEN_COLORS = [0xe4564f, 0xf1b64b, 0x2f9c95, 0x345f8c, 0x8d5bb5, 0x57a6c7];

export function PixiDragStage({ onDragStatusChange }: PixiDragStageProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return undefined;
    }

    let destroyed = false;
    let app: Application | null = null;

    void startPixiDragScaffold(mount, onDragStatusChange, () => destroyed).then((createdApp) => {
      app = createdApp;

      if (destroyed) {
        app.destroy({ removeView: true }, { children: true });
      }
    });

    return () => {
      destroyed = true;

      if (app) {
        app.destroy({ removeView: true }, { children: true });
        app = null;
      }
    };
  }, [onDragStatusChange]);

  return <div className="pixi-root" data-pixi-root ref={mountRef} />;
}

async function startPixiDragScaffold(
  mount: HTMLDivElement,
  onDragStatusChange: (status: DragStatus) => void,
  isDestroyed: () => boolean,
) {
  const app = new Application();

  await app.init({
    antialias: true,
    autoDensity: true,
    background: '#dff2f0',
    resizeTo: mount,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });

  if (isDestroyed()) {
    return app;
  }

  app.canvas.setAttribute('aria-label', 'Penguin Party sprite stage');
  mount.appendChild(app.canvas);

  const world = new Container();
  const background = new Graphics();
  const lanes = new Graphics();
  const tokenLayer = new Container();

  world.addChild(background, lanes, tokenLayer);
  app.stage.addChild(world);
  app.stage.eventMode = 'static';

  const texture = await Assets.load<Texture>(penguinTokenUrl);

  if (isDestroyed()) {
    return app;
  }

  const tokens = createPenguinTokens(texture, tokenLayer);
  let activeToken: PenguinToken | null = null;
  const dragOffset = { x: 0, y: 0 };
  const lastScreenSize = { width: 0, height: 0 };

  tokens.forEach((token) => {
    token.sprite.on('pointerdown', (event) => {
      activeToken = token;
      tokenLayer.addChild(token.sprite);

      const pointer = tokenLayer.toLocal(event.global);
      dragOffset.x = token.sprite.x - pointer.x;
      dragOffset.y = token.sprite.y - pointer.y;

      token.sprite.alpha = 0.92;
      token.sprite.scale.set(0.82);
      token.sprite.cursor = 'grabbing';
      publishDragStatus(onDragStatusChange, token.label, token.sprite.x, token.sprite.y);
    });

    token.sprite.on('pointerup', endDrag);
    token.sprite.on('pointerupoutside', endDrag);
  });

  app.stage.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!activeToken) {
      return;
    }

    const pointer = tokenLayer.toLocal(event.global);
    const nextX = clamp(pointer.x + dragOffset.x, TOKEN_SIZE / 2, app.screen.width - TOKEN_SIZE / 2);
    const nextY = clamp(pointer.y + dragOffset.y, TOKEN_SIZE / 2, app.screen.height - TOKEN_SIZE / 2);

    activeToken.sprite.position.set(nextX, nextY);
    publishDragStatus(onDragStatusChange, activeToken.label, nextX, nextY);
  });

  app.stage.on('pointerup', endDrag);
  app.stage.on('pointerupoutside', endDrag);

  app.ticker.add((ticker) => {
    if (lastScreenSize.width !== app.screen.width || lastScreenSize.height !== app.screen.height) {
      lastScreenSize.width = app.screen.width;
      lastScreenSize.height = app.screen.height;
      app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
      drawStage(background, lanes, app.screen.width, app.screen.height);
      layoutTokens(tokens, app.screen.width, app.screen.height);
    }

    tokens.forEach((token, index) => {
      if (token === activeToken) {
        return;
      }

      const bob = Math.sin(performance.now() / 520 + index * 0.8) * 2;
      token.sprite.y = clamp(
        token.sprite.y + bob * ticker.deltaTime * 0.02,
        TOKEN_SIZE / 2,
        app.screen.height - TOKEN_SIZE / 2,
      );
    });
  });

  drawStage(background, lanes, app.screen.width, app.screen.height);
  layoutTokens(tokens, app.screen.width, app.screen.height);

  return app;

  function endDrag() {
    if (!activeToken) {
      return;
    }

    activeToken.sprite.alpha = 1;
    activeToken.sprite.scale.set(0.76);
    activeToken.sprite.cursor = 'grab';
    activeToken = null;
  }
}

function createPenguinTokens(texture: Texture, layer: Container): PenguinToken[] {
  return TOKEN_COLORS.map((tint, index) => {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.tint = tint;
    sprite.width = TOKEN_SIZE;
    sprite.height = TOKEN_SIZE;
    sprite.scale.set(0.76);
    sprite.eventMode = 'static';
    sprite.cursor = 'grab';
    sprite.label = `Penguin ${index + 1}`;

    const token = {
      id: `penguin-${index + 1}`,
      label: `Penguin ${index + 1}`,
      sprite,
      home: { x: 0, y: 0 },
    };

    layer.addChild(sprite);

    return token;
  });
}

function drawStage(background: Graphics, lanes: Graphics, width: number, height: number) {
  background.clear();
  background.rect(0, 0, width, height).fill(0xdff2f0);
  background.rect(0, height * 0.62, width, height * 0.38).fill(0xf7f1de);
  background.circle(width * 0.12, height * 0.18, 92).fill({ color: 0xffffff, alpha: 0.38 });
  background.circle(width * 0.86, height * 0.24, 116).fill({ color: 0xffffff, alpha: 0.3 });
  background.circle(width * 0.72, height * 0.76, 140).fill({ color: 0xe4564f, alpha: 0.1 });

  lanes.clear();
  const baseY = height * 0.64;
  for (let i = 0; i < 4; i += 1) {
    const y = baseY + i * 34;
    lanes.moveTo(32, y).lineTo(width - 32, y).stroke({ color: 0x17313a, alpha: 0.12, width: 2 });
  }
}

function layoutTokens(tokens: PenguinToken[], width: number, height: number) {
  const columns = Math.min(tokens.length, Math.max(2, Math.floor(width / 132)));
  const rows = Math.ceil(tokens.length / columns);
  const gapX = Math.min(132, Math.max(98, width / (columns + 1)));
  const gapY = rows > 1 ? 112 : 0;
  const startY = Math.max(TOKEN_SIZE, height * 0.42 - ((rows - 1) * gapY) / 2);

  tokens.forEach((token, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = gapX * (col + 1);
    const y = startY + row * gapY;

    if (token.home.x === 0 && token.home.y === 0) {
      token.sprite.position.set(x, y);
    } else {
      token.sprite.position.set(
        clamp(token.sprite.x, TOKEN_SIZE / 2, width - TOKEN_SIZE / 2),
        clamp(token.sprite.y, TOKEN_SIZE / 2, height - TOKEN_SIZE / 2),
      );
    }

    token.home = { x, y };
  });
}

function publishDragStatus(onDragStatusChange: (status: DragStatus) => void, selectedToken: string, x: number, y: number) {
  onDragStatusChange({
    selectedToken,
    position: `${Math.round(x)}, ${Math.round(y)}`,
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
