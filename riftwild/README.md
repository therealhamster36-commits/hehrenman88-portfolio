# RIFTWILD — Realms Edition

Original single-player browser voxel adventure. Buildless, self-contained static application; Three.js is vendored under its MIT license. No external service, account, tracking, or asset CDN is required.

## Play

Open the hosted site in a WebGL 2 browser. Desktop: WASD, mouse look, Space jump, Shift sprint, left-click mine/attack, right-click build, 1–9 slots, E inventory, C crafting, R realms, H heal, Escape menu. Touch controls are included. Creative mode adds flight with F, Space up and Q down.

## Content

- Three 96×96 voxel realms, deterministic terrain, caves, forests, mineral deposits, ruins, nine treasure chests.
- 31 selectable block types plus indestructible foundation; mining, collision, placement, editable hotbar.
- Adventure and creative modes, 13 crafting recipes, three blade tiers and three armor states.
- Two minibosses (Root Warden and Ash Smith) and final boss Aethor; telegraphed area attacks and phase-two projectiles, common enemies, seal-gated travel, victory screen.
- Water/lava shader, procedural material grain, physically based lighting, atmospheric fog, soft shadows on supported desktop devices, particles and generated sound effects.
- Local autosave, manual save, JSON export/import. Single-device/browser storage, no cloud sync or multiplayer.

The browser build is this folder: `index.html`, `game.js`, `style.css`, and `vendor/THREE-LICENSE.txt`. `game.js` bundles the renderer locally. Editable original game code is in `src/game.js`. To rebuild: `npm install` then `npm run build`. Serve through HTTP(S); ES modules do not run from file://.

## Originality and dependencies

Game code, terrain generation, creatures, interfaces, sounds, names and materials are original to this project. No Minecraft assets, code, branding or music are used. This does not constitute trademark clearance or a guarantee against legal claims. Three.js 0.186.1 is included with its original license at `vendor/THREE-LICENSE.txt`.

## Verification

JavaScript syntax and automated gameplay logic checks cover terrain generation, spawn collisions, mining/placement, crafting costs and equipment progression, dimension locks, boss rewards, death recovery and save/restore. Browser preview was attempted; the test browser disables WebGL, so rendered shader quality, GPU performance and full input/gameplay have not been visually verified. A clear unsupported-WebGL screen is provided.
