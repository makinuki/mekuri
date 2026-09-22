# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- views: `PagedView` accepts `gestures` and `keyboard` flags (default `true`)
  to detach either input layer; `WebtoonView` accepts `keyboard` (default
  `true`) with the `keyboardOptions` and `gestureOptions` bags matching the
  paged surface, so a host that owns input keeps exactly one dispatcher.
- views: custom `renderPage` bodies receive the pipeline attempt as a third
  argument, with documented ownership: host bodies own their nodes, report
  load outcomes to the failure registry, and key reloads on host state rather
  than on the attempt alone.
- views: the continuous surface takes an injectable `now` clock for the
  scroll-alignment settling window, and views expose `useEngineSelector` for
  single-field subscriptions. The README gains host-integration notes covering
  attach targets, code-based maps, suppression, and test dispatch targets.
- engine: prebuilt views and the gesture layer take the structural
  `MekuriViewEngine` instead of the vanilla store, with `MekuriGestureEngine`
  for the gesture layer. The `useMekuriEngine` output exposes `subscribe`,
  `reportScroll`, and `syncControlled`, so hosts render the shipped views
  directly from the hook.

### Fixed

- views: the boundary mount container no longer swallows zone taps while slot
  content shows. The container takes no pointer events; slot content opts back
  in per element where it wants taps.

## [0.1.1] - 2026-09-21

Add release script.

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
