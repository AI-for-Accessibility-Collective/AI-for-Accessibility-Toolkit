---
name: game-night-motor-racing
description: Remappable motor-access controls for browser racing via voice and alternate inputs.
---

# Game night motor-access racing

## Need

A player with limited finger mobility needs to drive a browser racing game without multi-key chords or small face buttons. Controls must be fully remappable.

## Adaptations

1. Prefer voice or single large targets over simultaneous key holds when possible.
2. Map phrases `turn left`, `turn right`, `go`, `stop`, `boost`, `pause` to the host’s input bridge.
3. Keep a visible remap UI so the player can change bindings without editing code.
4. Provide camera or phone tilt as redundant steering if voice latency is high.

## Settings vocabulary (host-specific)

Hosts should expose remappable actions rather than fixed keys. See the Game Night Access Adapter protocol for LibreCorsa defaults.

## Validation

- Player can change at least one mapping without assistance.
- Steering works from more than one input source.
- Failure of camera or phone leaves another path working.
