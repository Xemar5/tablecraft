# Tablecraft

A local-first, 2D board-game design and playtesting workshop. Built with React, TypeScript, Vite and SpaceTimeDB 2.15, with a shared validated command engine for offline and online play.

## Run

Use Node.js **22.23.4+ on the 22.x line**, **24.22.1+ on the 24.x line**, or **26.12.1+**, as required by the SpaceTimeDB SDK.

```powershell
npm ci
npm run dev
```

Starting the development server automatically opens **http://127.0.0.1:5173** in your browser. The component designer and hotseat playground work without a backend, account or multiplayer connection. The included Wildwood project is a fully editable example, not a fixed game.

### Project home and reusable components

Click the **Tablecraft logo** to open Home. On the first visit (or when the previously loaded project is unavailable), Home lists your projects. Otherwise the app automatically opens the last loaded project. Home lets you create or open projects, expand their component lists, import/export individual projects or the full workspace, delete projects with confirmation, and reorder them by dragging their grips (or focus a grip and use Up/Down). Deleting the last project leaves an empty workspace. Clicking Home while connected leaves the live room and retains its latest state locally.

In the component library, choose **Link from another project**, then select a source component. The component and its nested dependencies remain read-only links, not independent designs. Library badges show their source; opening one shows a read-only preview. **Make local copy** creates an independently editable copy of the complete nested dependency bundle with fresh IDs, leaving the original link and existing placed pieces intact.

Local source edits refresh linked snapshots, including placed and held pieces, and source changes are picked up when opening a project or restarting the app. Cross-project dependency cycles are rejected. Project/component exports and live rooms include the full read-only snapshot and provenance, so they render without access to the source workspace. If a source project or component is deleted or unavailable, the last snapshot remains usable. Importing a full workspace remaps internal project links to the imported projects. Source projects are browser-local, not remotely subscribed: multiplayer participants receive the room's snapshots; explicitly selecting the link again refreshes a live room from your locally available source. Read-only is an editing constraint, not a security or secrecy guarantee.

On Windows, `.\Start-Tablecraft.ps1` also starts the app and opens it in your browser. It can use either an installed Node runtime or the portable runtime provisioned under `%LOCALAPPDATA%\prototyper-tools`.

In VS Code, open **Run and Debug**, select **Tablecraft: Launch app**, and press **F5** to start Vite and open Chrome with frontend debugging. On Windows this uses the provisioned runtime at `%LOCALAPPDATA%\prototyper-tools\node.exe`, so Node does not need to be on PATH. On other platforms it uses `node` from PATH. If you installed Node yourself, choose **Tablecraft: Launch app (installed Node)** instead; restart VS Code after installing Node so it picks up PATH changes. Run `npm ci` first, and stop any existing frontend on port 5173 before launching. These configurations start only the frontend; multiplayer still requires the server and published module described below.

The optional script requires a PowerShell execution policy that permits local scripts. If scripts are disabled, use the npm commands instead. With the provisioned portable runtime, you can start the frontend directly without running a script:

```powershell
& "$env:LOCALAPPDATA\prototyper-tools\node.exe" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173
```

## Agent CLI

The CLI uses the same project schemas and command engine as the app. After `npm ci`, run `npm --silent run cli -- --help`. Successful commands print JSON on stdout (except help); errors print JSON to stderr and exit nonzero. Use npm's `--silent` option to avoid its banner on stdout. JSON files are UTF-8. These examples use PowerShell:

```powershell
# Create an offline archive and add a component, including its linked dependencies.
npm --silent run cli -- new --out game.tablecraft.json --template blank --name "My game"
npm --silent run cli -- generate --file game.tablecraft.json --template card --name "My cards"
npm --silent run cli -- list --file game.tablecraft.json --what components
npm --silent run cli -- schema --what command
npm --silent run cli -- inspect --file game.tablecraft.json --component COMPONENT_ID
npm --silent run cli -- spawn --file game.tablecraft.json --component COMPONENT_ID --count 3 --x 700 --y 450
npm --silent run cli -- apply --file game.tablecraft.json --commands commands.json --actor PLAYER_ID
npm --silent run cli -- validate --file game.tablecraft.json
npm --silent run cli -- export --file game.tablecraft.json --out card.json --component COMPONENT_ID
npm --silent run cli -- import --file game.tablecraft.json --bundle card.json
npm --silent run cli -- export --file game.tablecraft.json --out portable.tablecraft.json
```

Replace IDs with those in `list`/`inspect` output. `new` also supports `--template wildwood`; `generate` supports `blank`, `card`, `token`, `board`, and `dice`. Supply `--data component-overrides.json` to merge a JSON object of component fields over the template (including `front`, `back`, `csv`, and `rows`); schema and cross-reference validation still apply. Component exports include dependencies and imports remap their IDs. `commands.json` is a command object or array, for example `[{"type":"settings","patch":{"snap":true}}]`; inspect the command schema for every supported action. Offline `apply` is atomic and supports `{"type":"undo"}` for prior playground commands **in the same batch only**; its history is not persisted across CLI invocations. Use `--project PROJECT_ID` to select a project in a multi-project archive. Mutations replace the input file atomically only after the whole batch validates. New/export destinations are never overwritten without `--force`.

For live rooms, first start and publish the server as described below, then:

```powershell
npm --silent run cli -- live host --file game.tablecraft.json --code MY-TABLE --name "Agent"
npm --silent run cli -- live state --code MY-TABLE
npm --silent run cli -- live dispatch --code MY-TABLE --commands commands.json
npm --silent run cli -- live undo --code MY-TABLE
# Another identity can instead use: npm --silent run cli -- live join --code MY-TABLE
```

Each invocation joins (or rejoins) the room; `state` reads the current full state, and `dispatch` submits the same validated commands to authoritative reducers. The returned identity and players let you choose an owned hotseat with `--actor`; specifying somebody else's player ID does not grant ownership. Live batches commit **one command at a time**; on error the confirmed count is reported, and a timed-out submitted operation may have committed—read state before retrying. Undo uses the server's shared playground history. `--uri`, `--database`, and bounded `--timeout` (milliseconds, 100–120000) are available; defaults are `http://127.0.0.1:3000`, `tablecraft-studio`, and 12000. Non-loopback connections require HTTPS/WSS. `--name` and `--color` configure a newly joined seat. Hosting fails if the code exists; joining fails if it does not.

The CLI keeps a separate durable identity per server/database under `~/.tablecraft/identities`, outside Git repositories. The directory/files are created with owner-only permissions where supported; on Windows keep the user profile private. These tokens are secrets: do not copy them into projects, logs, or source control. The CLI identity is separate from the browser identity. Like the browser, it has one active room at a time and receives complete room state; see the trust model below.

**Artwork** is a component type for reusable, linked illustrations, especially nested artwork in cards, tokens, and boards. Choose **Create component → Artwork** (or CLI `generate --template artwork`) for a blank, transparent 200 × 200 canvas ready for editable vector layers. Artwork starts without hand, flip, stack, or shuffle support; existing component templates keep their defaults. The library's **Artwork** filter includes the built-in botanical assets. Add an artwork component through a nested component layer to reuse its live design and CSV bindings; exports include linked dependencies. The component JSON/API kind is `"artwork"`, also exposed by the CLI component schema.

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

### Hosting on GitHub Pages

The frontend is a static site. [.github/workflows/pages.yml](.github/workflows/pages.yml) runs the unit tests, builds with `BASE_PATH=/<repository>/` and deploys `dist/` to GitHub Pages on every push to `main` (or manually from the Actions tab). Enable it once under **Settings → Pages → Source: GitHub Actions**. Offline design and play work without a server; saves stay in each visitor's browser.

Pages cannot run SpaceTimeDB, so the deployed build defaults multiplayer to Maincloud (`https://maincloud.spacetimedb.com`, database `tablecraft-xemar5`). Override either with the repository variables `SPACETIMEDB_URI` and `SPACETIMEDB_DATABASE`. Pages is served over HTTPS, so any other server must offer HTTPS/WSS. Both values are public in the built site.

Publish the module to Maincloud with `spacetime login` (browser sign-in to the account that owns the database) and `npm run db:publish:maincloud`. Republish there after server or shared command changes, just as for a local server; pushing to `main` only redeploys the frontend.

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
- Add text, vector shapes, images, linked components, empty elements and nested frames. The collapsible hierarchy supports drag-and-drop reordering, reparenting, and moving layers back to the component root.
- Hover or focus a layer row to hide it with the eye control; hidden layers keep their control visible so they can be shown again. The selected layer's eye toggle in **Design** does the same. Hiding a group hides its subtree without deleting it or changing its layout properties; flow layouts reflow around hidden children. Visibility is saved with the design, applies to previews and play, and combines with CSV visibility conditions.
- Use **Add shape** to choose and immediately insert a rectangle, ellipse, regular polygon, star or pen path. **Add empty element** creates a transparent frame using the frame icon. Edit fill, stroke and stroke weight in the inspector. Click a segment to split its curve exactly; Alt-click an anchor to delete it, double-click to toggle its handles, and Shift-drag a handle to mirror its opposite. Delete/Backspace removes the selected anchor (minimum three on closed paths, two on open paths). Path bounds account for curve extrema and stroke; flow-layout children retain their allocated layout space. Ancestor frames and component edges still clip their contents.
- Starter botanical illustrations are linked components made of editable vector layers, not a shape fill. Older saved botanical shapes are upgraded to linked artwork on load/import or when joining a room; their original shape and text are retained. Upgrades that would exceed project limits are rejected rather than silently discarding data.
- Select two or more vector layers and click **Union**, **Subtract**, **Intersect** or **Exclude (XOR)** at the top of the **Design** tab to create a live compound. These buttons are disabled without multiple vector layers selected. The source shapes stay in the layer hierarchy and update the boolean result when edited; change the operation or **Uncombine** to recover the editable sources. Compounds support holes and overlapping regions. Bézier curves are sampled for boolean calculations; the original paths remain editable and are not flattened in the project.
- **Link component…** nests a live reference to another project component. Linked designs refresh in the Designer, component previews, playground, hands and exports. Nested data can inherit the parent row, use a selected row from the linked component, or read a row index from a parent CSV field. Parent-field row indices are zero-based integers; a missing, malformed or out-of-range value displays a visible error instead of silently choosing a row. Component export includes its nested dependency closure; imports remap linked IDs. A linked component cannot be deleted until its parent links are removed or changed.
- **Nested fitting** controls how linked artwork fills its layer: **Stretch** fills both dimensions independently (the default for existing saves); **Fit inside** preserves aspect ratio with space around the artwork; **Fill / crop (envelope)** preserves aspect ratio and crops overflow. Aspect-preserving modes are centered and adapt to the layer's actual layout size.
- Select multiple layers in the hierarchy with Ctrl/Cmd-click (or Shift-click). Drag the selection on the canvas, edit shared properties, group it under a transparent parent, or delete it together. Designer edits support undo and redo. A continuous edit is one undo step, recorded when you finish it: typing in a field (until it loses focus or you press Enter), dragging a slider, color picker or number scrubber (until release), or holding an arrow key to nudge.
- Designer shortcuts (outside fields and dialogs): Delete/Backspace deletes the selection; Ctrl/Cmd+X, C, V and D cut, copy, paste and duplicate layer subtrees; Ctrl/Cmd+G groups selected layers, or ungroups when only groups are selected. Ctrl/Cmd+Shift+G also ungroups (or uncombines selected compounds). Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) undo and redo; Ctrl/Cmd+A selects root layers, Escape clears selection, and arrows nudge by 1 unit (Shift: 10). The in-editor clipboard stays on the original component face and retains the original parent. Grouping requires consecutive siblings in fixed-size absolute layouts; ungrouping also requires a transparent, fully opaque frame. Groups never clip their content, so children may extend beyond a group's bounds in the designer, on the table and in previews. Unsupported operations report an error rather than changing placement unexpectedly.
- When a single fixed-size layer is selected, drag the handles on its canvas outline to resize from an edge or corner (the opposite side stays put; Shift keeps proportions on corners, and pen paths scale their points) or drag the round handle above it to rotate (Shift snaps to 15°). Each drag is one undo step. Layers inside row/column stacks or with hug/fill sizing are edited in the inspector instead.
- Use the mouse wheel over the Designer canvas to zoom around the pointer; drag with the middle mouse button or Space+left mouse button to pan.
- Frames support absolute positioning or horizontal/vertical stacks with wrapping, gaps, alignment and separate padding on each edge. Fixed, hug-contents and fill-parent sizing make layouts adapt to their contents and parent. Drop a layer onto the middle of a frame/group in the hierarchy to nest it; drop near an edge to reorder. To unparent a layer, drop it near an edge of a root-level layer. Drops on non-container layers reorder rather than parent. Flow-layout children are positioned by their parent instead of being freely draggable.
- Use a Google Font family name in the font field. Textures support HTTP(S) URLs and raster base64 data URLs. Fonts and remote textures require internet access; external image hosts must permit embedding.
- Open **Data bindings** to paste or import CSV. A header such as `name,cost,image` exposes `{{name}}`, `{{cost}}` and `{{image}}` in text/image layers. Mix static text and multiple bindings, e.g. `Power: {{power}}`. A layer can optionally be shown only when a CSV field equals a value.
- CSV editing supports single-column data (including dice values), commas, tabs, semicolons and quoted multiline text. Every column needs a unique non-empty header; data rows must have the same number of cells. Empty CSV clears the data source. Invalid data is reported without replacing the existing rows.
- Each CSV row defines a variant. Use the row selector in the designer's top toolbar for any component type, including artwork; it stays synced with **Preview row** in **Data bindings** and the dice variant editor. All three selectors label variants as `N. value`, using the one-based row number and the first CSV column's value. The toolbar scrolls horizontally with the mouse wheel or trackpad, with edge shadows indicating more controls. Components without data show a disabled **Default** option. **Spawn all variants** creates one instance of each. CSV updates immediately refresh every existing instance, including held and stacked pieces, on all connected clients.
- Color controls include an **Alpha** slider (0% transparent to 100% opaque) for fills, text, strokes, component backgrounds and player colors. Color entry accepts CSS colors including `#RRGGBBAA`, `rgba(...)` and `transparent`; choosing a new RGB color preserves its alpha. Color alpha is separate from layer opacity.
- Library previews show a variant-count badge and additional variant faces for any component type with multiple data rows, not just cards. The type filters scroll horizontally with the mouse wheel or trackpad when the library is narrow; edge shadows indicate more filters, without a visible scrollbar.
- Instances reference **row indices**, not copied content. Reordering CSV rows changes which data those instances display. Removed rows resolve bindings to empty strings; existing pieces are not silently deleted.
- **Behavior** controls flippability/back design, hands, front visibility, stacking, shuffling and stack tags. Untagged pieces stack only with instances of the same component; tagged pieces can stack with any stackable component sharing that tag.
- **Component type** in Behavior switches between card, token, board and dice without resetting artwork, dimensions, data or behavior settings. Dice gain rolling controls; tokens use round component rendering.
- Dice **variants** are their CSV rows, with equal probability on each roll. In Behavior, choose a variant, edit its column values, or add/remove a variant; Data bindings remains available for adding columns and bulk editing. At least one variant is retained by the variant editor. Removal shifts later placed dice and fixed nested-row references down; references to the deleted row use the next row or the last remaining row. Parent-field row bindings keep their CSV values and report invalid rows as usual. These changes update all instances and are included in design undo/redo; undo restores the design data, not previous dice roll results.
- Turning off hand/stack/flip support normalizes existing instances. Disabling player hands at the table level only hides the hand UI; it does not discard held pieces.
- Export a component as JSON from **Behavior**. The library's **Import** accepts component bundles, legacy component JSON or project/workspace JSON. Component imports also work inside live sessions.
- Deleting a component requires confirmation and removes all its spawned instances; referenced nested components must first be unlinked.

## Playing

The compact top bar includes project, mode, save and session controls. Its panel icons independently toggle the component library, hand tray and table inspector. Panel visibility and camera changes are local to the browser; toggling a panel preserves the camera.

Use **Toggle component library** in the header to hide or show the library in both the playground and component designer; its visibility is retained when switching modes. **Create component** stays in the library footer, outside the scrolling component list. Drag the separators to resize the library, designer layers and inspector, table inspector, and hand tray. Separators have a thin 2px visible line within a 6px drag target. Focus a separator and use the arrow keys (Shift for larger steps), Home or End to resize without a mouse. Preferred panel sizes are saved locally, not in the project or shared room, and may be temporarily constrained on smaller screens. The active inspector tabs are retained while switching components or modes during the session.

Notification banners have an **X** button to dismiss them locally. Dismissing an undo notice does not change shared history; dismissing a storage or snapshot error does not enable writes or overwrite unreadable saves. Reload to show an unresolved warning again.

The Playground inspector opens on **Selection**, with settings and actions for selected pieces, stacks or hand cards. Clicking a seat on the table selects it instead of switching to it: the Selection tab then shows that seat's name, color (with alpha), position and rotation, plus the same hand actions as the hand toolbar and a **Switch to this seat** button. Every hand toggle (face up on entry, table-hand visibility, insert/take permissions and the seat lock) is that seat's own setting, saved with the playground. Only the seat's active player can change it, so these toggles, along with shuffle and reverse, are disabled for other seats. You can only edit seats you own. Press Escape or click empty table space to deselect. When nothing is selected, it prompts you to select a component. **Table** contains shared table settings, while **Players** manages seats. Switching tabs does not change the selection.

Hover the horizontal overflow shadows in the library filters or designer toolbar to reveal scroll arrows. Hold an arrow to scroll continuously; release to stop. Focus an arrow and press Enter or Space to scroll a step.

Drag a component's grip beside its name to reorder the library in either mode; the insertion line shows whether it will move before or after the target. Focus the grip and use Up/Down arrows for keyboard reordering. Filters and search retain the saved project order; moving a filtered item repositions only that item relative to the drop target. Library order is saved, exported and shared in multiplayer, and does not change placed pieces or consume tabletop undo history. Agents can use `{"type":"reorderComponent","id":"COMPONENT_ID","targetId":"TARGET_ID","position":"before"}` (or `"after"`).

Click a library preview to spawn its first variant; hovering it shows a drag hint. Click a component's name to open it in the designer; hovering the name shows a pen and an edit hint. For components with multiple CSV rows, the preview also has a **Spawn all variants** button beside **+**, and dragging the preview onto the table spawns every variant at the drop point. Both place the variants in a single stack when the component is stackable, or spread them out otherwise. Use the arrow at the right of the component's name row to show or hide its variant previews. Click a variant to select it, Ctrl/Cmd-click to toggle variants, and Shift-click to select a range (Ctrl/Cmd+Shift adds the range). Drag a selected variant onto the table to spawn one of each selected row; dragging an unselected variant spawns only that row. **Spawn all variants**, also shown below the expanded variants list, works the same way as the preview button. Up to 1,000 rows can be spawned at once. Each drop is one undoable action; the pieces remain linked to their component and rows. Dice rows are faces of one die rather than variants: a die has no Variants list or spawn-all button, and clicking or dragging it always spawns one die showing its first face.

Drag pieces to move; Shift/Ctrl/Cmd-click toggles pieces in the selection, or drag an empty area to box-select (Shift adds to the selection). Shift-drag the top of a stack to move just that piece. Clicking a piece brings it to the front. Move, rotate, flip, scale, clone, lock, delete or draw the whole selection together. Rotation and scaling preserve relative differences; flipping a whole stack reverses its displayed order and faces without rewriting the underlying members. Drawing or extracting from it takes the visible top face. With a whole stack selected, **Draw one** takes its top piece into your hand (the remaining stack stays selected) and **Draw all** takes every piece. Drop compatible unlocked pieces or complete stacks onto another piece or stack to combine them, with the dragged pieces on top. A highlighted target and drop hint preview stacking; **hold Alt** to move without stacking, including when playing from hand. Dragged pieces stay above the hand tray. Middle-drag or the hand tool pans; scroll zooms; the camera buttons rotate the view; **Fit table** resets the view and camera.

Each seat's hand is shown at its table position. Your own table hand can be switched between faces and backs using the eye toggle in the icon toolbar below your hand (a per-seat setting); other players' pieces use their component's **Hide front in hand** setting. Your hand tray shows each card's current face; double-click a flippable hand card or hover and press F to flip it. These controls are visual only and do not provide secrecy from other connected clients. Drag tabletop pieces or complete stacks to your tray or seat to take them into your hand. Drag selected hand cards onto the table (or a compatible stack) to play them, or within the hand to reorder them together. An insertion marker shows the destination. The tray scrolls horizontally, including with a mouse wheel. Reorder arrows appear on hover or keyboard focus. The toolbar also offers **Shuffle hand**, **Reverse hand**, **Switch seat**, and a lock for dragging your seat on the table (locked by default; each seat has its own lock). While dragging an unlocked seat, scroll to rotate it by 15° or press Q/E to rotate by 90°, and Ctrl-scroll to zoom; the seat stays under the cursor. Q/E also rotate a hovered or selected unlocked seat you own; a locked seat cannot be moved or rotated on the table. In multiplayer only your own seats can be moved. Hover or focus a piece for a preview and shortcuts (stacks also show their piece count); hold Alt to hide it, or Ctrl-scroll over the preview to resize it.

Your active seat's mini hand always supports dragging cards onto the playground or a compatible stack, and dropping tabletop pieces into it. While dragging over an allowed mini hand, the piece shrinks to mini-hand size and an insertion marker shows its position: before, between, or after the existing cards. You can also drag from the bottom tray into a specific mini-hand position, or reorder your mini hand directly. Hovering a grabbable mini-hand card highlights exactly which card will be taken. The seat-position lock does not lock card interactions.

Compact horizontal strips use hidden scrollbars with thin, fast-fading edge shadows: component filters, the designer toolbar, inspector and face tabs, hand cards, and hand actions. Mouse-wheel and trackpad input eases smoothly toward the requested position, accumulating rapid input; reduced-motion preferences disable that animation. Hover an edge to reveal an arrow, hold it to scroll, or focus it and press Enter/Space to step. Shadows and arrows appear only where more content is available.

Click a hand card to select it. Shift-click selects the range from the selection anchor (or just the clicked card if nothing is selected); Ctrl-click or Cmd-click toggles individual cards. Clicking elsewhere clears hand selection. Dragging an already selected tray card keeps the selected group together.

Shift-drag detaches the top card immediately, revealing the remaining stack before you drop it. The detached card can be dropped on the table, into a hand, or onto a compatible stack; hold Alt to bypass stacking. Tabletop drags preserve the original grab offset in table coordinates, so it scales with the current zoom and camera rotation.

Table hands accept drops within an extra 28 screen pixels on every side, making edge insertion easier at any zoom. The dashed target outline sits 20 screen pixels outside the mini hand, behind the player badge; an insertion tooltip shows the position and Alt shortcut. Component previews remain visible while dragging (Alt still hides them). A mini-hand card stays faded at its source until the drag ends. Mouse-wheel zoom-in follows the cursor; zoom-out uses the table center, including during drags. The dragged piece updates immediately to keep its grabbed point anchored to the cursor independently of the camera pivot. Zoom buttons use the table center. Hold **Alt** while dropping to bypass table-hand insertion and stacking and place the pieces directly on the tabletop instead.

The hand toolbar below the tray controls permissions for your active hand only: **Allow others to insert into my hand** (down-to-line icon, on by default) and **Allow others to take from my hand** (up-from-line icon, off by default). Each player configures their own hand independently; switching hotseat players switches the displayed settings. Transfers check the source hand's taking permission and the destination hand's insertion permission. Your own active hand remains accessible with both off. Older projects inherit their previous table permissions until each hand is configured. Permissions persist across tabletop undo, and only the hand's owner can change them in multiplayer. These permissions are for trusted playtesters, not secrecy controls.

Cards turn to their front face when entering a hand by default, including number-key draws, double-clicks and transfers. Disable **Turn cards face up when entering my hand** in the bottom hand toolbar to preserve their current visible face instead. This is a per-seat setting saved with the playground: it applies to cards entering that seat's hand, whoever moves them. Dragging alone does not animate a flip; changing faces during a drag does.

Locked pieces do not show previews. Previews switch to the left when hovering in the right third of the playground, and disappear when the pointer leaves a piece or its preview. Holding Alt temporarily hides the currently hovered piece's preview; releasing Alt restores it while that piece is still hovered.

| Action | Shortcut / control |
|---|---|
| Flip | Hover/focus a piece and press `F`; double-click a flippable hand card |
| Rotate | `Q` rotates −90 degrees, `E` rotates +90 degrees; Shift-scroll over a card rotates 15 degrees |
| Clone selection | `Ctrl+D` / `Cmd+D`; stacks remain stacks |
| Copy and paste | `Ctrl+C` / `Cmd+C`, then `Ctrl+V` / `Cmd+V` at the table pointer |
| Delete selection | `Delete` / `Backspace` |
| Deselect | `Esc` |
| Draw a piece | Double-click a tabletop component or stack |
| Draw 1–10 pieces | Hover/focus a stack and press `1`–`9`, or `0` for 10; draws up to the number available |
| Stack | Drag onto a compatible piece/stack, or select compatible pieces and press `G` |
| Search/reorder | Select stack, then **Search stack**; list runs bottom to top |
| Shuffle/roll | Hover/focus and press `R`; stack controls also offer shuffle/spread |
| Lock/unlock | Hover/focus a piece and press `L`, or use the selection inspector |
| Scale | Selection inspector |
| Roll a die | Press `R` or select a die and choose **Roll die** (rotation stays unchanged). The die briefly tumbles and cycles through its faces for every player, even when it lands on the same face; reduced-motion settings skip the animation |
| Play from hand | Drag a held piece onto the table |

Use **Players** to add any number of hotseat seats. Seats are named **Player 1**, **Player 2** and so on by default; the seat you are currently playing is marked with a **You** tag on the table, in **Players** and in the seat inspector. To change a seat's name, color, coordinates or rotation, select the seat on the table or use its edit button in **Players**. **Remove seat** in the seat inspector deletes a seat after confirmation; any pieces in its hand keep their faces and are spread in rows centered where the seat was. You cannot remove your active seat (switch seats first) or the last seat, and in multiplayer only your own seats can be removed. Removing a seat clears undo history. Switching local seats shows a pass-the-screen privacy curtain. Remote players own their own seats; each connected client can add more hotseat players. Drag a player's grip in **Players** (or focus it and press Up/Down) to reorder seats; the order is shared with the room and sets the turn order, and the current turn stays with the same player. The turn tracker is optional (**Table** > **Turn tracker**) and advisory: it does not prevent other players from manipulating pieces. While it is on, a pill at the top of the table shows whose turn it is, and its **End turn** button passes the turn to the next player in the list, wrapping around to the first. **Players** marks the current turn.

Selection inspector buttons show their shortcut keys, and the button grid adds or removes columns (down to one) as the inspector is resized. The flip, rotate, lock, clone and delete shortcuts apply to the selection when hovering a selected piece, otherwise to the hovered/focused piece (or stack); without a hovered piece they fall back to the selection. Number shortcuts draw from the hovered/focused stack. Shortcuts are disabled while editing form fields or while a dialog is open. Numeric controls allow intermediate edits, clamp to their allowed range on blur, support native spin controls, and can be adjusted by dragging vertically.

On first pointer focus, input contents are selected only after releasing the pointer without dragging. Keyboard focus selects immediately; dragging a number field adjusts its value without selecting its contents.

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
# Playground undo

Use the Playground toolbar's **Undo playground action** button or **Ctrl+Z / Cmd+Z** to reverse the latest tabletop action. In a live room, **any authenticated player can undo the most recent action by any player**, and everyone receives the result. Undo includes pieces, stacks, dice rolls, hands, table settings, and edits to existing seats. Shortcuts do not intercept typing, dialogs, pass-device curtains, or Component designer editing. The inspector's Rotation, Scale, Grid size and selected-seat fields apply their value when you finish typing (blur or Enter), release a scrub or slider, or close the color picker, so each finished edit is one action. There is no redo.

The latest 50 effective actions are retained. Offline history lasts until a workspace reload, replacement/import or live-session transition; it is not included in JSON exports or snapshots. Live room history is stored server-side with the room and survives reconnects. A component design edit/removal or explicit new-seat creation clears history and displays a notice; designs and seat identities/ownership are never restored by undo. Joining an existing live room does not clear history or allow undo to remove the joined seat.
