# Mission Control macOS Shell - 2026-04-19

This repo now contains a native macOS shell scaffold at:

- `/Users/jessybrenenstahl/Documents/Sprint/Gemma/apps/mission-control-macos`

## Why it exists

The existing stack already has:

- a real mission-control HTTP server
- a browser UI in `apps/mission-control/public`
- route and lane tests

What it did not have was a native macOS operator surface. The new shell is the first step toward that.

## Liquid Glass posture

The shell uses the macOS-native structure first:

- `NavigationSplitView`
- system toolbar chrome
- material-backed cards instead of opaque custom panels

That keeps the UI aligned with the modern macOS design system without inventing bespoke chrome before the operator workflow is proven.

## AppKit boundary

The AppKit bridge is intentionally small:

1. `WindowAccessor`
   - resolves `NSWindow`
   - sets minimum size, autosave name, and standard window chrome behavior

2. `SessionFilePanel`
   - uses `NSOpenPanel`
   - loads a saved session JSON snapshot from disk

SwiftUI remains the source of truth for the app state. AppKit handles only the desktop-specific edges that SwiftUI does not model directly.

## Current scope

The native shell currently supports:

- server status
- session list
- active session detail
- route prompt composer
- route execution through the existing HTTP API
- local session snapshot import from disk

It does not yet replace the web UI for:

- lane-config editing
- recovery watch
- Taildrop / clipboard / bridge diagnostics

## Next implementation slice

1. Add lane-config editing and recovery surfaces to the native shell.
2. Decide whether the shell should stay SwiftPM-first for development or move to a packaged `.app` workflow.
3. Keep the server contract stable enough that the native shell and browser shell can coexist during transition.
