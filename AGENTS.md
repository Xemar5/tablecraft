# Agent instructions

## Project

Tablecraft is a local-first, 2D board-game design and playtesting app. It uses React, TypeScript, Vite, Zod and SpaceTimeDB 2.15. Read the [README](README.md) when you need the full setup guide, user workflows, or product details.

## Setup and validation

- Use a supported Node version: Node 22.23.4+, 24.22.1+, or 26.12.1+.
- Install frontend dependencies with `npm ci`; start the app with `npm run dev`.
- Run `npm test` and `npm run build` for routine validation.
- Browser tests require Chromium (`npx playwright install chromium`), a running local SpaceTimeDB server and a published module (`npm run test:e2e`).
- Check server types with `npx tsc -p server/tsconfig.json`. Shared command changes also require republishing the module before live clients can use them, even if the database schema and generated bindings are unchanged.
- For multiplayer changes, run `npm run db:generate` after changing the module schema, then publish with `npm run db:publish`. Do not use anonymous publishing for a database that must be updated later.

## Architecture

- `src/domain.ts` is the authoritative shared contract: Zod schemas, project invariants, and immutable game commands are used by both the browser and server.
- `src/Designer.tsx` and `src/ComponentView.tsx` implement component editing and rendering. `src/Playground.tsx` implements the table, pieces, stacks, hands and seats.
- `src/App.tsx` coordinates projects, persistence, commands and navigation. `src/storage.ts` validates portable JSON and local saves.
- `src/multiplayer.ts` and generated `src/module_bindings/` connect clients to the SpaceTimeDB module in `server/src/index.ts`.
- Keep offline and multiplayer behavior consistent by routing mutations through `applyCommand` and the shared command schema; put multiplayer authority checks in server reducers as well.

## Invariants and trust boundaries

- Validate imported data, project state and commands at their boundaries. Preserve unique IDs, valid layer-parent trees, component/player references, and compatible stack membership.
- Instances reference component IDs and CSV row indices. Keep that relationship so design and CSV updates refresh all spawned, stacked and held pieces.
- Untagged stackable pieces combine only with the same component; nonempty matching tags permit cross-component stacks.
- Turning off hand, flipping or stacking support must keep existing instances valid. Do not silently discard player-held pieces when hands are hidden.
- Multiplayer rooms are for trusted playtesters. Hidden hand faces are **visual privacy only**: subscribed clients receive the complete room state. Room codes grant editing access. Never describe this setup as competitive secrecy.
- Associate remote seat changes and private hand actions with the authenticated sender; do not trust a client-supplied player ID as proof of ownership. The explicit `allowOtherHands` table setting is off by default and grants all authenticated room members permission to use the dedicated visible-hand transfer/play commands; ordinary hand commands retain their ownership checks.
- Stack drops, multi-draws, hand reordering and releasing onto a stack are validated atomically by the shared command engine. Hand order uses the existing instance `order` field; validate a complete hand and active actor before reordering. Camera and table-hand visibility are local presentation state, not multiplayer privacy controls.
- Tabletop layering follows instance-array order (boards render underneath); the `front` command persists it. Duplicating stacks, extracting pieces, multi-card hand drops and deterministic seeded dice rolls are shared commands, not client-only mutations. Copies retain stack membership via fresh stack IDs. A stack's optional `stackReversed` flag changes its visible top and faces without rewriting member order or face state; materialize those semantics when removing or merging pieces. Dice rolls change rows, not rotations or instance IDs.
- Never check secrets, local identities, authentication tokens, or generated test output into source control.

## Changes and documentation

Make focused changes, preserve existing workflows, and add or update targeted tests for behavior changes. Update the [README](README.md) when user-facing workflows, setup, persistence, multiplayer, commands, or their limitations change. Keep agent-specific architecture, validation, and trust guidance in this file rather than duplicating it in the Claude or custom-agent files.

After making and validating changes, commit them. Split distinct changes into separate, focused commits. Never commit secrets, local identities, or generated output.
