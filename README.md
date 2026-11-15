# Tablecraft

A local-first, 2D board-game design and playtesting workshop. Built with React, TypeScript, Vite and SpaceTimeDB 2.15, with a shared validated command engine for offline and online play.

## Run

Use Node.js **22.23.4+ on the 22.x line**, **24.22.1+ on the 24.x line**, or **26.12.1+**, as required by the SpaceTimeDB SDK.

```powershell
npm ci
npm run dev
```

Starting the development server automatically opens **http://127.0.0.1:5173** in your browser. The component designer and hotseat playground work without a backend, account or multiplayer connection. The included Wildwood project is a fully editable example, not a fixed game.

On Windows, `.\Start-Tablecraft.ps1` also starts the app and opens it in your browser. It can use either an installed Node runtime or the portable runtime provisioned under `%LOCALAPPDATA%\prototyper-tools`.

In VS Code, open **Run and Debug**, select **Tablecraft: Launch app**, and press **F5** to start Vite and open Chrome with frontend debugging. On Windows this uses the provisioned runtime at `%LOCALAPPDATA%\prototyper-tools\node.exe`, so Node does not need to be on PATH. On other platforms it uses `node` from PATH. If you installed Node yourself, choose **Tablecraft: Launch app (installed Node)** instead; restart VS Code after installing Node so it picks up PATH changes. Run `npm ci` first, and stop any existing frontend on port 5173 before launching. These configurations start only the frontend; multiplayer still requires the server and published module described below.

The optional script requires a PowerShell execution policy that permits local scripts. If scripts are disabled, use the npm commands instead. With the provisioned portable runtime, you can start the frontend directly without running a script:

```powershell
& "$env:LOCALAPPDATA\prototyper-tools\node.exe" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173
```

## Multiplayer

Install the [SpaceTimeDB CLI](https://spacetimedb.com/install), then:

```powershell
# Terminal 1: persistent local server
spacetime start --listen-addr 127.0.0.1:3000

# Terminal 2: dependencies, build and publish
Set-Location server
npm ci
Set-Location ..
npm run db:publish
```

Publish using a persistent CLI identity, not `--anonymous`, so you can update the database later. If the CLI prompts for authentication, follow its login flow. For local-only development, you can obtain a server-issued identity without an external account:

```powershell
$identity = Invoke-RestMethod -Method Post http://127.0.0.1:3000/v1/identity
spacetime login --token $identity.token
npm run db:publish
```

Treat that token as a secret. Do not put it in source control or shared logs.

On this Windows setup, the equivalent launch helpers are `.\Start-Tablecraft.ps1 -Database` and `.\Start-Tablecraft.ps1 -Publish`.

In the app, choose **Invite players**, enter a name and a room code, then **Host this table**. In another browser profile/device, choose **Join room** with the same server, database (`tablecraft-studio`) and code. Separate browser profiles provide distinct identities; tabs in the same profile share an identity. A browser identity has one active live room at a time.

For other computers, use a reachable SpaceTimeDB server and a reachable frontend. The default development listeners are deliberately loopback-only. For example, start Vite with `npm run dev -- --host 0.0.0.0`, bind SpaceTimeDB to a LAN interface, allow the chosen ports through your firewall, and enter that machine's LAN address in the connection dialog. Use HTTPS/WSS behind a reverse proxy for internet deployment.

Optional frontend defaults in `.env.local`:

```dotenv
VITE_SPACETIMEDB_URI=https://your-spacetimedb-host
VITE_SPACETIMEDB_DATABASE=tablecraft-studio
```

After server schema changes, run `npm run db:generate`, then republish. Shared command changes also require republishing the module, even when the schema is unchanged. Generated client bindings are included.

### Trust model

Rooms are collaborative prototyping spaces for **trusted playtesters**, not adversarial competitive games:

- Room tables are private. A sender-specific view exposes the room joined by that identity.
- Knowing the room code grants membership and collaborative editing access.
- Server reducers validate commands and serialize mutations. Seat changes and ordinary hand actions are restricted to players owned by the sender. The optional visible-hand transfer setting explicitly lets any room member move cards into or out of any hand.
- **Hidden hands are visual privacy, not server-side secrecy.** Every room member receives the entire project state, including CSV data, stack order and hand assignments. Developer tools can inspect that information.
- Component designs use last-write-wins replacement. Two simultaneous edits to the same design are not merged.
- Returning players must use the same browser identity/token to recover their original seats and hands. There is no account-based cross-device identity recovery.

## Designing components

- Start with a card, token, board or die template, or a blank component.
- Add text, shapes, images, empty elements and nested frames. The collapsible hierarchy supports drag-and-drop reordering, reparenting, and moving layers back to the component root.
- Select multiple layers in the hierarchy with Ctrl/Cmd-click (or Shift-click). Drag the selection on the canvas, edit shared properties, group it under a transparent parent, or delete it together. Designer edits support undo and redo.
- Frames support absolute positioning or horizontal/vertical stacks with wrapping, gaps, alignment and separate padding on each edge. Fixed, hug-contents and fill-parent sizing make layouts adapt to their contents and parent. Assign a layer's **Parent** to nest it; flow-layout children are positioned by their parent instead of being freely draggable.
- Use a Google Font family name in the font field. Textures support HTTP(S) URLs and raster base64 data URLs. Fonts and remote textures require internet access; external image hosts must permit embedding.
- Open **Data bindings** to paste or import CSV. A header such as `name,cost,image` exposes `{{name}}`, `{{cost}}` and `{{image}}` in text/image layers. Mix static text and multiple bindings, e.g. `Power: {{power}}`.
- Each CSV row defines a variant. Select a row to preview it; **Spawn all variants** creates one instance of each. CSV updates immediately refresh every existing instance, including held and stacked pieces, on all connected clients.
- Instances reference **row indices**, not copied content. Reordering CSV rows changes which data those instances display. Removed rows resolve bindings to empty strings; existing pieces are not silently deleted.
- **Behavior** controls flippability/back design, hands, front visibility, stacking, shuffling and stack tags. Untagged pieces stack only with instances of the same component; tagged pieces can stack with any stackable component sharing that tag.
- Turning off hand/stack/flip support normalizes existing instances. Disabling player hands at the table level only hides the hand UI; it does not discard held pieces.
- Export a component as JSON from **Behavior**. The library's **Import** accepts component JSON or project/workspace JSON. Component imports also work inside live sessions.
- Deleting a component requires confirmation and removes all its spawned instances.

## Playing

The compact top bar includes project, mode, save and session controls. Its panel icons independently toggle the component library, hand tray and table inspector. Panel visibility and camera changes are local to the browser; toggling a panel preserves the camera.

Click library previews to spawn pieces. Set **Spawn quantity** for multiple copies. Drag pieces to move; Shift/Ctrl/Cmd-click toggles pieces in the selection, or drag an empty area to box-select (Shift adds to the selection). Shift-drag the top of a stack to move just that piece. Clicking a piece brings it to the front. Move, rotate, flip, scale, clone, lock, delete or draw the whole selection together. Rotation and scaling preserve relative differences; flipping a whole stack reverses its displayed order and faces without rewriting the underlying members. Drawing or extracting from it takes the visible top face. Drop compatible unlocked pieces or complete stacks onto another piece or stack to combine them, with the dragged pieces on top. A highlighted target and drop hint preview stacking; **hold Alt** to move without stacking, including when playing from hand. Dragged pieces stay above the hand tray. Middle-drag or the hand tool pans; scroll zooms; the camera buttons rotate the view; **Fit table** resets the view and camera.

Each seat's hand is shown at its table position. Your own table hand can be switched between faces and backs using the eye toggle in the icon toolbar below your hand; other players' pieces use their component's **Hide front in hand** setting. Your hand tray shows each card's current face; double-click a flippable hand card or hover and press F to flip it. These controls are visual only and do not provide secrecy from other connected clients. Drag tabletop pieces or complete stacks to your tray or seat to take them into your hand. Drag selected hand cards onto the table (or a compatible stack) to play them, or within the hand to reorder them together. An insertion marker shows the destination. The tray scrolls horizontally, including with a mouse wheel. Reorder arrows appear on hover or keyboard focus. The toolbar also offers **Shuffle hand**, **Reverse hand**, **Switch seat**, and a lock for dragging table seats (locked by default). In multiplayer only your own seats can be moved. Hover or focus a piece for a preview and shortcuts; hold Alt to hide it, or Ctrl-scroll over the preview to resize it.

The table setting **Move cards between table hands** is off by default. When enabled, any player may drag tabletop pieces or their own hand cards into another visible seat, and drag cards out of visible table hands. This is a shared permission for trusted playtesters, not a secrecy control; disable it to retain the usual hand-ownership restrictions.

| Action | Shortcut / control |
|---|---|
| Flip | Hover/focus a piece and press `F`; double-click a flippable hand card |
| Rotate | `R` rotates 90 degrees; Shift-scroll over a card rotates 15 degrees |
| Clone selection | `Ctrl+D` / `Cmd+D`; stacks remain stacks |
| Copy and paste | `Ctrl+C` / `Cmd+C`, then `Ctrl+V` / `Cmd+V` at the table pointer |
| Delete selection | `Delete` / `Backspace` |
| Deselect | `Esc` |
| Draw a piece | Double-click a tabletop component or stack |
| Draw 1–10 pieces | Hover/focus a stack and press `1`–`9`, or `0` for 10; draws up to the number available |
| Stack | Drag onto a compatible piece/stack, or select compatible pieces and press `G` |
| Search/reorder | Select stack, then **Search stack**; list runs bottom to top |
| Shuffle/roll | Hover/focus and press `S`; stack controls also offer shuffle/spread |
| Scale/lock | Selection inspector |
| Roll a die | Press `S` or select a die and choose **Roll die** (rotation stays unchanged) |
| Play from hand | Drag a held piece onto the table |

Use **Players** to add any number of hotseat seats and change names, colors, hand/seat coordinates and rotation. Switching local seats shows a pass-the-screen privacy curtain. Remote players own their own seats; each connected client can add more hotseat players. The turn tracker is optional and advisory: it does not prevent other players from manipulating pieces.

The flip, rotate, clone and delete shortcuts apply to the selection when hovering a selected piece, otherwise to the hovered/focused piece (or stack); without a hovered piece they fall back to the selection. Number shortcuts draw from the hovered/focused stack. Shortcuts are disabled while editing form fields or while a dialog is open. Numeric controls allow intermediate edits, clamp to their allowed range on blur, support native spin controls, and can be adjusted by dragging vertically.

## Saves and portability

- The workspace automatically persists in browser local storage after every accepted change. No external service is contacted for offline game-state storage.
- Projects group designs, CSV sources, pieces, seats, hands and table settings.
- **Save playground** creates a named snapshot. **Load** opens a restored copy as a project, preserving seats, hands, stack order and design links.
- **Export JSON** saves one project. **My projects → Export all projects** backs up the whole workspace. Exports are versioned (`format: "tablecraft", version: 1`).
- Import validates the complete hierarchy and all references, and adds copies instead of replacing existing projects. Workspace/project import is disabled during live play to avoid replacing an active room accidentally.
- To host a restored save, load/import it offline and then host a new room. Existing remote identity ownership is preserved. Players rejoining with the same tokens recover their saved seats and hands.
- Keep JSON backups: browser storage has quotas and can be cleared. Named snapshots are local; include them in a portable backup by loading and exporting them as projects.
- Invalid saves, imports, server commands and storage failures are reported explicitly. Corrupt workspace/snapshot data is not automatically overwritten; the UI offers a recovery download.

There is no fixed player limit. Guardrails limit a project to 500 component designs, 10,000 pieces, 300 layers per face, and 10,000 CSV rows per component; individual spawn commands create at most 1,000 pieces. Import files are limited to 20 MB. Snapshots are capped at 100.

## Validation

```powershell
npm test
npm run build
npx tsc -p server/tsconfig.json

# Browser tests (start/publish the local SpaceTimeDB server first)
npx playwright install chromium
npm run test:e2e
```

Unit tests cover bindings, hierarchy validation, stack compatibility, shuffle/reorder/draw, hand restrictions, live component updates and save round-trips. Browser tests exercise the designer, CSV refresh, actual drag/grid coordinates, nonflippable hidden hands, snapshots/import/export and two real SpaceTimeDB clients. Multiplayer checks include concurrent spawns, rapid design typing with delayed WebSocket responses, returning-player hands, and restoring a saved playground into a new room without losing players' seats or names.

## Source map

- `src/domain.ts`: Zod schemas, invariants and immutable game commands, shared with the server.
- `src/Designer.tsx`: hierarchy, live visual editor, inspector and CSV workflow.
- `src/Playground.tsx`: 2D tabletop, manipulation, stacks, hands and seating.
- `src/ComponentView.tsx`: safe recursive component renderer and procedural template artwork.
- `src/App.tsx`, `src/storage.ts`: workspace/projects, portable saves and application shell.
- `src/multiplayer.ts`, `src/module_bindings/`: typed SpaceTimeDB connection/subscriptions.
- `server/src/index.ts`: authoritative room reducers and private room view.

The app intentionally does not enforce board-game rules or load arbitrary executable HTML. Exported components are validated JSON data, not scripts.
