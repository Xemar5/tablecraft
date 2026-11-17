# Arcane Assembly

A fantasy worker-placement engine builder for 2–4 rival factory factions, built as a Tablecraft project.

| File | What it is |
|---|---|
| `arcane-assembly.tablecraft.json` | The project. Import it from Tablecraft's Home (**Import**). |
| `RULES.md` | Core rules, every faction rulebook and full card lists. |
| `build.ts` | Regenerates the project through the Tablecraft CLI. |
| `src/content.ts` | Factions, resources, cards and rules text. |
| `src/components.ts`, `src/art.ts` | Card templates and vector art. |
| `preview.html` | Contact sheet of every card (`npm run dev`, then open `/games/arcane-assembly/preview.html`; add `?c=brass`, `?pairs` or `?back`). |

Rebuild after editing the content or templates (from the repository root):

```powershell
npx tsx games/arcane-assembly/build.ts
```

## Factions

| Faction | Colours | Style | Special pieces |
|---|---|---|---|
| Brassbound Works | steel navy / brass | steady engine | Boiler Gauge, Pressure marker |
| Verdant Loom | deep fern / blossom | slow growth | Grove board, Seeds |
| Cinderforge Covenant | oxblood / flame | volatile bursts | Crucible, Heat marker |
| Starwright Atelier | indigo / aether cyan | clever conversion | Orrery die, Insight tokens |

Each faction has 5 actions, 6 supporting actions, 5 units, 5 buildings, 5 achievements, 5 resources, 6 workers, a reminder card and a 4-page rulebook. The shared **Core rulebook** explains the game.

## Editing cards in Tablecraft

Every card type is one component whose CSV rows are the cards, so you can add or change cards in **Data bindings** without touching the design.

| Component | Columns |
|---|---|
| `… · Actions` | `name, art, workers, pay1, pay2, effect, support` (`yes` adds the support edge) |
| `… · Supports` | `name, art, pay1, pay2, effect` |
| `… · Units` / `… · Buildings` | `name, art, cost1…cost6, pay1, pay2, extra, effect` (`pay`/`extra` fill the ALSO band) |
| `… · Achievements` | `name, art, cost1…cost6` |
| `… · Rulebook` | `page, title, art, body` |

Cost and pay cells take one icon code each:

- a resource key (`coal`, `prism`, …): that exact resource
- `abundant`, `common`, `uncommon`, `rare`: any resource of that rarity
- `common:o`: socket (filled during setup)
- `common:A` … `common:D`: lettered cost
- `common:oA` … `common:oD`: lettered socket

`art` picks an illustration from **Art · Card illustrations 1** (its variant list shows every key). The shared **Icons · …** and **Resource · …** artworks at the end of the library draw the cost icons and tokens. Change them once and every card updates.

Faction colours are part of each design (Tablecraft colours can't come from CSV), so a new faction is easiest to add as a new entry in `src/content.ts` followed by a rebuild.
