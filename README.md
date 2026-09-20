# Mekuri

Headless-first reader engine and view library for manga, comics, and webtoons
on the web. Published as `@makinuki/mekuri`.

The library is split into three surfaces:

- `engine`: headless state machine, pure page math, keyboard and tap-zone
  registries, gesture state, and virtualization math. No DOM, no CSS.
- `views`: optional unstyled, themeable view implementations and HUD
  primitives driven by CSS custom properties.
- `test-utils`: gesture simulators, viewport mocks, and observer mocks for
  testing host integrations under JSDOM.

Persistence, authentication, image proxying, and settings storage are host
responsibilities. The library never fetches images and never stores reading
state.

## Status

Pre-release.
Peer dependencies: `react` and `react-dom` 18.2 or 19.
