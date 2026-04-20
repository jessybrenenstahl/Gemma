# Mission Control macOS Shell

This is a native macOS operator shell for the existing AGRO mission-control server.

Current scope:

- uses the existing HTTP contract on `http://127.0.0.1:3040`
- mirrors the core operator workflow:
  - status
  - session list
  - active session detail
  - route prompt composer
- keeps the visual structure macOS-native with `NavigationSplitView`, system toolbar chrome, and material-backed cards
- keeps AppKit interop narrow:
  - `NSWindow` access for window configuration
  - `NSOpenPanel` for loading a session snapshot from disk

This does **not** replace the Node mission-control server. It is a native client for it.

## Build

```bash
cd /Users/jessybrenenstahl/Documents/Sprint/Gemma/apps/mission-control-macos
swift build
```

## Next Steps

1. Add lane-config and recovery surfaces.
2. Add a repo-aware session import flow.
3. Decide whether to keep SwiftPM for development-only builds or wrap this target in a full `.app` packaging path.
