# Agent instructions

## Project

Tablecraft is a local-first, 2D board-game design and playtesting app. It uses React, TypeScript, Vite, Zod and SpaceTimeDB 2.15. Read the [README](README.md) when you need the full setup guide, user workflows, or product details.

## Setup and validation

- Use a supported Node version: Node 22.23.4+, 24.22.1+, or 26.12.1+.
- Install frontend dependencies with `npm ci`; start the app with `npm run dev`.
- Run `npm test` and `npm run build` for routine validation.
- CLI changes also require `npm run cli:check`; exercise the CLI through `npm run cli -- --help` and focused command tests.
- Browser tests require Chromium (`npx playwright install chromium`), a running local SpaceTimeDB server and a published module (`npm run test:e2e`).
- Check server types with `npx tsc -p server/tsconfig.json`. Shared command changes also require republishing the module before live clients can use them, even if the database schema and generated bindings are unchanged.
- For multiplayer changes, run `npm run db:generate` after changing the module schema, then publish with `npm run db:publish`. Do not use anonymous publishing for a database that must be updated later.

## Architecture

- `src/domain.ts` is the authoritative shared contract: Zod schemas, project invariants, and immutable game commands are used by both the browser and server.
- `src/Designer.tsx` and `src/ComponentView.tsx` implement component editing and rendering. `src/vectorGeometry.ts` computes SVG path and live boolean-compound geometry; keep the source shapes editable in the layer tree. Nested component nodes hold live component-ID references and render against the full project catalog on every surface.
- Starter botanical artwork is ordinary linked vector components, with generic CSV-driven layer visibility. `upgradeLegacyArtworkProject` in `src/templates.ts` deterministically upgrades legacy shape-text artwork, preserving its original shape; run it at persistence and authoritative room boundaries before validation, and reject over-limit upgrades without overwriting the original. Template consumers must add the full dependency-first `templateBundle` closure.
- `src/Playground.tsx` implements the table, pieces, stacks, hands and seats.
- `src/App.tsx` coordinates projects, persistence, commands and navigation. `src/storage.ts` validates portable JSON and local saves.
- `src/panelLayout.tsx` manages browser-local panel-size preferences and accessible splitters; viewport constraints must leave room for the canvas. Inspector tab selection lives in `App` so keyed Designer remounts retain presentation state without retaining edit history. These preferences are not project or multiplayer state.
- `scripts/tablecraft.ts` exposes validated offline generation and project commands; `scripts/live.ts` uses the generated client and authenticated reducers. Keep CLI identity files outside the repository and report partial live batches explicitly.
- `src/multiplayer.ts` and generated `src/module_bindings/` connect clients to the SpaceTimeDB module in `server/src/index.ts`.
- `src/playgroundHistory.ts` wraps shared commands with bounded tabletop undo. Offline archive/history updates must be atomic; multiplayer history lives only in the private `playground_history` table and reducers serialize dispatch/undo. The room view exposes only undo count and invalidation notice. Never accept client history or restore saved designs, seat identities or ownership. Component edits/removal and explicit seat creation clear history; joining an existing room does not.
- Keep offline and multiplayer behavior consistent by routing mutations through `applyCommand` and the shared command schema; put multiplayer authority checks in server reducers as well.

## Invariants and trust boundaries

- Validate imported data, project state and commands at their boundaries. Preserve unique IDs, valid layer-parent trees, component/player references, and compatible stack membership.
- `validateProject` also owns nested-component reference/cycle/depth checks, nested data-row bounds, and vector-compound source invariants. Component JSON exports include their linked dependency closure; imports remap those IDs and insert dependencies before parents. Keep missing or invalid parent-field row indices explicit in rendered output—never silently fall back.
- Instances reference component IDs and CSV row indices. Keep that relationship so design and CSV updates refresh all spawned, stacked and held pieces.
- Untagged stackable pieces combine only with the same component; nonempty matching tags permit cross-component stacks.
- Turning off hand, flipping or stacking support must keep existing instances valid. Do not silently discard player-held pieces when hands are hidden.
- Multiplayer rooms are for trusted playtesters. Hidden hand faces are **visual privacy only**: subscribed clients receive the complete room state. Room codes grant editing access. Never describe this setup as competitive secrecy.
- Associate remote seat changes and private hand actions with the authenticated sender; do not trust a client-supplied player ID as proof of ownership. Each player owns `allowHandInsert` (default on) and `allowHandTake` (default off) for their hand; In multiplayer, `handSettings` requires the authenticated sender to own that seat or be the room host (the shared engine only requires an active actor). Fall back to legacy table permission fields for older saves only; table settings commands cannot change them. Visible-hand commands check each source hand's taking permission and the destination hand's insertion permission independently, and indexed transfers insert atomically using instance `order`. Hand permissions stay outside shared tabletop undo. Ordinary hand commands retain their ownership checks. The identity that creates a room is recorded in the private `room_host` table; the host may change other seats' settings and remove them (`player`, `handSettings`, `removePlayer`) but never change a seat's `owner` or act from another player's hand, and the UI marks these host overrides in red. The active player may likewise edit other hotseat seats owned by the same client (or any seat offline); the UI marks these as hotseat overrides. `removePlayer` is restricted to the seat owner or host on the server, never removes the actor's active seat or the last seat, releases the held pieces onto the table at the seat, and clears undo history like adding a seat.
- Stack drops, multi-draws, hand reordering and releasing onto a stack are validated atomically by the shared command engine. Hand order uses the existing instance `order` field; validate a complete hand and active actor before reordering. Camera is local presentation state. Per-seat hand preferences (face up on entry, table-hand visibility, seat lock) live on the player and change only via `handSettings` from that seat's active player; table-hand visibility is not a multiplayer privacy control.
- Tabletop layering follows instance-array order (boards render underneath); the `front` command persists it. Duplicating stacks, extracting pieces, multi-card hand drops and deterministic seeded dice rolls are shared commands, not client-only mutations. Copies retain stack membership via fresh stack IDs. A stack's optional `stackReversed` flag changes its visible top and faces without rewriting member order or face state; materialize those semantics when removing or merging pieces. Dice rolls change rows, not rotations or instance IDs.
- Never check secrets, local identities, authentication tokens, or generated test output into source control.

## Changes and documentation

Make focused changes, preserve existing workflows, and add or update targeted tests for behavior changes. Update the [README](README.md) when user-facing workflows, setup, persistence, multiplayer, commands, or their limitations change. Keep agent-specific architecture, validation, and trust guidance in this file rather than duplicating it in the Claude or custom-agent files.

After making and validating changes, commit them. Split distinct changes into separate, focused commits. Never commit secrets, local identities, or generated output.
