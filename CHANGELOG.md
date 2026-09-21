# Changelog

## [Unreleased]

## [0.1.0] - 2026-09-21

First release.

- engine: headless reading state machine, pure page math, tap zones, keyboard
  registry, gesture state, continuous virtualization, host-owned image
  pipeline with a failure registry.
- views: prebuilt paged and webtoon views, HUD primitives, theming through CSS
  custom properties, accessibility rendering.
- test-utils: gesture, keyboard, and observer simulators for host tests.

Runtime dependency: `@tanstack/react-virtual`, used only by the continuous
views. Peer dependencies: `react` and `react-dom` 18.2 or 19.