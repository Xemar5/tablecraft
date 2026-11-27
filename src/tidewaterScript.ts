import { seatPlacementAt } from './domain';

/** The four colours of Tidewater Isles, in seat order. */
export const TIDEWATER_COLORS = [
  { color: 'crimson', name: 'Crimson', fill: '#b8483a', edge: '#5e2018' }, { color: 'azure', name: 'Azure', fill: '#3b6fa8', edge: '#1c3657' },
  { color: 'ivory', name: 'Ivory', fill: '#efe8d4', edge: '#7c7259' }, { color: 'amber', name: 'Amber', fill: '#d99a2b', edge: '#6e4c10' },
];

/**
 * Where each colour's player sits, clockwise from the bottom: the bottom, left, top and right of the table. `ring` is the
 * spot on the seat ring their pieces are laid out from; the top and bottom seats themselves sit 60 px further out, so
 * the cards fanned above their table hands stay clear of the pieces in front of them.
 */
export const TIDEWATER_SEATS = TIDEWATER_COLORS.map((color, index) => {
  const ring = seatPlacementAt(index * 90);
  const out = index % 2 ? 0 : index ? -60 : 60;
  return { ...color, ring, x: ring.x, y: ring.y + out, rotation: ring.rotation };
});

/**
 * The beginner island of Tidewater Isles, which the sample lays out and the host can deal again: the terrains of its
 * rows of 3, 4, 5, 4 and 3 tiles (top row first, each row left to right), the tide marker numbers on them (0 on the
 * dunes, which take the squall) and the harbor rows (data rows of the Harbor component, from 0) clockwise from the top.
 * Its 6 and 8 markers aren't next to each other.
 */
export const TIDEWATER_ISLAND = {
  terrains: [
    ['stone', 'reed', 'fish'], ['clay', 'salt', 'fish', 'reed'], ['salt', 'stone', 'dunes', 'reed', 'clay'], ['reed', 'fish', 'clay', 'salt'], ['fish', 'salt', 'stone'],
  ],
  markers: [[10, 2, 9], [12, 6, 4, 10], [9, 11, 0, 3, 8], [8, 3, 4, 5], [5, 6, 11]],
  harbors: [0, 1, 0, 2, 3, 0, 4, 0, 5],
};

const luaList = (values: (string | number)[]) => `{ ${values.map(value => typeof value === 'string' ? `"${value}"` : value).join(', ')} }`;
const luaSeats = () => `{\n${TIDEWATER_SEATS.map(seat =>
  `  { color = "${seat.color}", name = "${seat.name}", fill = "${seat.fill}", x = ${seat.x}, y = ${seat.y}, rotation = ${seat.rotation} },`).join('\n')}\n}`;

/**
 * The Tidewater Isles rules script (Lua, run by the table's scripting engine; see Scripting in the README). The game
 * goes through three phases, kept in memory.phase:
 *
 * - "setup": the table starts with the host's seat alone. The host chooses the settings in the Game setup popup and
 *   deals the island: the number of players (3 or 4; an unused colour's pieces are hidden), the beginner island or a
 *   shuffled one (terrains, tide markers and harbors, with no 6 and 8 next to each other), the points to win and
 *   whether the dice roll by themselves.
 * - "placing": the setup rounds. Seats for the other players are added clockwise (left, top, right), each colour's
 *   pieces are locked (and order-locked) for every seat but its own, and in turn order and back again, each player
 *   places a hut on a corner of the island and a boardwalk beside it. Pieces placed out of turn, too close to another hut or away from the new hut go back
 *   to their pile with a note saying why; placed pairs stay locked until the game begins.
 * - "playing": it begins by itself after the last placement, dealing each player one resource for every tile
 *   touching the hut they placed in the second round. The dice roll when a turn starts (or with Roll dice), huts and
 *   lighthouses beside the rolled tiles take resources, a 7 brings the squall, and building points are kept for the
 *   scoreboard, with a Victory popup once a colour's buildings alone reach the goal. The dice and the squall are
 *   locked for every seat but the one whose turn it is, and only that seat sees Roll dice.
 *
 * It tells players what happens with popups: the Status banner says whose turn it is to place, Notice shows rolls and
 * events in the corner (also written to the console), and buttons that don't apply are hidden from every seat.
 *
 * Memory it uses: `colors` (the colours in play, in seat order), `playerCount`, `inPlay` (each colour: in play or
 * not, for the scoreboard), `phase`, `host`, `randomIsland`, `shuffled`,
 * `goal`, `autoRoll`, `round`, `lastRoll`, `points` (building points per colour), `winner`, and for the setup rounds
 * `order` (seat ids in placing order), `step`, `stepHut`, `secondHuts` and `placedPieces`.
 */
export const TIDEWATER_SCRIPT = String.raw`-- Tidewater Isles: the game setup, the setup rounds, rolls, resources and the squall.
--
-- Seats play the colours in memory.colors, in seat order (seat 1 crimson, 2 azure, 3 ivory, 4 amber), sitting clockwise
-- from the bottom of the table (bottom, left, top, right).
--
-- 1. Game setup (memory.phase "setup"): the table starts with the host's seat alone. The host chooses the number of
--    players (memory.playerCount), the island (memory.randomIsland), the points to win (memory.goal) and whether the
--    dice roll by themselves (memory.autoRoll) in the Game setup popup, which also deals the island. Game setup (the
--    button, which only the host sees) opens the popup again.
-- 2. The setup rounds ("placing"): the other players' seats are added, each colour's pieces are locked for every
--    other seat, and in turn order and back again, each player places a hut on a corner of the island and a boardwalk
--    beside it. The Status banner says whose turn it is; pieces placed out of turn, on a corner next
--    to another hut or away from the new hut go back to their pile.
-- 3. The game ("playing") begins after the last placement: each player takes one resource for every tile touching the
--    hut they placed in the second round. From then on the dice roll whenever a turn starts (or with Roll dice, which
--    only shows while memory.autoRoll is false). Every hut on a corner of a tile showing the rolled number takes one
--    of its resource and every lighthouse two, unless the squall is on that tile. A 7 brings the squall instead. The
--    dice and the squall are locked for every seat but the one whose turn it is.

local CORNER = 56        -- from a tile's centre to its corners
local HALF_EDGE = 28     -- from the middle of a tile edge (a boardwalk) to its corners (huts)
local ON_TILE = 45       -- a tide marker or the squall this close to a tile's centre is on that tile
local SLOT_DOWN = 23     -- a tile's number slot sits this far below its centre
local NEIGHBOURS = 100   -- tiles whose centres are closer than this share an edge
local TERRAINS = { "reed", "clay", "salt", "fish", "stone" }
local PRODUCES = { reed = true, clay = true, salt = true, fish = true, stone = true }
local BUILDINGS = { { "Hut", 1 }, { "Lighthouse", 2 } }

-- The beginner island, in reading order (top row first, each row left to right); harbor rows clockwise from the top.
local BEGINNER = {
  terrains = ${luaList(TIDEWATER_ISLAND.terrains.flat())},
  numbers = ${luaList(TIDEWATER_ISLAND.markers.flat().filter(number => number))},
  harbors = ${luaList(TIDEWATER_ISLAND.harbors.map(row => row + 1))},
}

-- Each colour's seat, clockwise from the bottom, with the name of its pieces' group ("Crimson pieces").
local SEATS = ${luaSeats()}

local function distance(a, b) return math.sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2) end
local function onTable(component) return game.pieces({ component = component, holder = false }) end
local function snappedOn(piece, grid) return piece.snap ~= nil and piece.snap.grid == grid end

-- The laid-out island: face-up tiles that aren't in a stack.
local function islandTiles()
  local tiles = {}
  for _, tile in ipairs(onTable("Island tile")) do
    if tile.faceUp and not tile.stack then table.insert(tiles, tile) end
  end
  return tiles
end

local function tileUnder(piece, tiles)
  for _, tile in ipairs(tiles or islandTiles()) do
    if distance(piece, tile) < ON_TILE then return tile end
  end
end

local function onCorner(building, tile) return math.abs(distance(building, tile) - CORNER) < 6 end

local function colors() return memory.colors or { "crimson", "azure", "ivory", "amber" } end

local function seatFor(color)
  local seats = game.players()
  for index, name in ipairs(colors()) do
    if name == color then return seats[index] end
  end
end

local function seatName(color)
  local seat = seatFor(color)
  return seat and seat.name or (color:sub(1, 1):upper() .. color:sub(2))
end

-- The seats that play a colour, in turn order.
local function seated()
  local seats = {}
  for _, seat in ipairs(game.players()) do
    if colors()[seat.seat] then table.insert(seats, seat) end
  end
  return seats
end

-- The colours in play: the first playerCount colours. Out-of-play colours' pieces are hidden from everyone, and so
-- is their scoreboard row (memory.inPlay).
local function setPlayerCount(count)
  local list, inPlay = {}, {}
  for index, seat in ipairs(SEATS) do
    inPlay[seat.color] = index <= count
    if index <= count then table.insert(list, seat.color) end
    game.hideGroup(seat.name .. " pieces", index > count)
  end
  memory.playerCount = count
  memory.colors = list
  memory.inPlay = inPlay
end

-- Adds the seats still missing for the colours in play, each at its colour's place: clockwise from the host at the
-- bottom, the left, top and right of the table.
local function addSeats()
  for index = #game.players() + 1, #colors() do
    local seat = SEATS[index]
    game.addPlayer({ name = "Player " .. index, color = seat.fill, x = seat.x, y = seat.y, rotation = seat.rotation })
  end
end

-- Each colour's pieces are its player's: locked for every other seat, and so is their place in the order. An
-- out-of-play colour's pieces are locked for everyone (and stay hidden).
local function claimPieces()
  local seats = game.players()
  for index, seat in ipairs(SEATS) do
    local group, owner = seat.name .. " pieces", seats[index]
    if index <= #colors() and owner then
      local others = {}
      for _, other in ipairs(seats) do
        if other.id ~= owner.id then table.insert(others, other.id) end
      end
      game.lockGroup(group, false, false, others)
      game.lockGroup(group, false, true, others)
    else
      game.lockGroup(group, true)
    end
  end
end

-- Popups ----------------------------------------------------------------------------------------------------------

-- A note in the corner (the Notice popup) for everyone or only some seats, closing by itself after seconds (6 when
-- left out; 0 keeps it until it's closed). It replaces the notes those seats still have open, and the console keeps
-- a copy.
local function notify(title, text, players, seconds)
  for _, open in ipairs(game.popups()) do
    if open.component == "Notice" then
      if players then game.closePopup(open.id, players) else game.closePopup(open.id) end
    end
  end
  game.popup("Notice", { players = players, data = { title = title, text = text }, duration = seconds or 6 })
  game.log(title .. ": " .. text)
end

-- The banner at the bottom (the Status popup): text for everyone (watchers too), or with a seat, its own text for
-- that seat (nothing when mine is nil) and text for everyone else. Without text, the banner goes away.
local function status(text, seat, mine)
  game.closePopup("Status")
  if not text then return end
  local shown = game.popup("Status", { data = { text = text } })
  if seat then
    game.closePopup(shown, seat)
    if mine then game.popup("Status", { players = seat, data = { text = mine } }) end
  end
end

-- Shows each button only to the seat it's for, hidden from everyone else (seats that join later too): Game setup to
-- the host until the setup rounds start, and Roll dice to the seat whose turn it is during the game, while the dice
-- don't roll by themselves (memory.autoRoll is false).
local function showButtons()
  local function showTo(component, seat)
    local pieces = onTable(component)
    if #pieces > 0 then game.hide(pieces, true, seat and { seat } or {}) end
  end
  local host = memory.host and game.player(memory.host)
  showTo("Game setup button", memory.phase == "setup" and host and host.id or nil)
  local current = game.currentPlayer()
  showTo("Roll dice", memory.phase == "playing" and memory.autoRoll == false and current and current.id or nil)
end

-- The dice and the squall belong to the seat whose turn it is during the game: they're locked for every other seat,
-- and for every seat outside the game. (The locks name the seats they cover, so the script can still roll and move
-- them.)
local function turnLocks()
  local current = memory.phase == "playing" and game.currentPlayer() or nil
  local others, pieces = {}, {}
  for _, seat in ipairs(game.players()) do
    if not (current and seat.id == current.id) then table.insert(others, seat.id) end
  end
  for _, component in ipairs({ "Die", "Squall" }) do
    for _, piece in ipairs(onTable(component)) do table.insert(pieces, piece) end
  end
  if #pieces > 0 then game.lock(pieces, false, others) end
end

-- Scoring ---------------------------------------------------------------------------------------------------------

-- Building points: 1 for each hut and 2 for each lighthouse standing on the island. Once a colour's buildings alone
-- reach the goal during the game, the Victory popup shows for everyone.
local function tally()
  local points, tiles = {}, islandTiles()
  for _, color in ipairs(colors()) do points[color] = 0 end
  for _, kind in ipairs(BUILDINGS) do
    for _, building in ipairs(onTable(kind[1])) do
      for _, tile in ipairs(tiles) do
        if onCorner(building, tile) then
          local color = building.data.color
          points[color] = (points[color] or 0) + kind[2]
          break
        end
      end
    end
  end
  memory.points = points
  local goal = memory.goal or 10
  if memory.phase ~= "playing" or memory.winner then return end
  for _, color in ipairs(colors()) do
    if seatFor(color) and points[color] >= goal then
      memory.winner = color
      game.popup("Victory", { data = { name = seatName(color),
        text = seatName(color) .. "'s huts and lighthouses alone are worth " .. points[color] .. " points, reaching the goal of " .. goal .. "." } })
      game.log("Victory: " .. seatName(color) .. " wins with " .. points[color] .. " building points.")
      return
    end
  end
end

-- What each colour gains when a number is rolled: gains[color][terrain] = count.
local function production(number)
  local gains, tiles = {}, islandTiles()
  local markers, squalls = onTable("Tide marker"), onTable("Squall")
  for _, tile in ipairs(tiles) do
    local terrain, numbered, stormy = tile.data.terrain, false, false
    for _, marker in ipairs(markers) do
      if tonumber(marker.data.number) == number and distance(marker, tile) < ON_TILE then numbered = true end
    end
    for _, squall in ipairs(squalls) do
      if distance(squall, tile) < ON_TILE then stormy = true end
    end
    if numbered and not stormy and PRODUCES[terrain] then
      for _, kind in ipairs(BUILDINGS) do
        for _, building in ipairs(onTable(kind[1])) do
          if onCorner(building, tile) then
            local color = building.data.color
            gains[color] = gains[color] or {}
            gains[color][terrain] = (gains[color][terrain] or 0) + kind[2]
          end
        end
      end
    end
  end
  return gains
end

-- Gives each colour's gains from the resource cards on the table, in seat order. Returns what was given, as text, and
-- the resources the supply ran out of.
local function handOut(gains)
  local supply = {}
  for _, card in ipairs(onTable("Resource")) do
    local terrain = card.data.terrain
    supply[terrain] = supply[terrain] or {}
    table.insert(supply[terrain], card)
  end
  local lines, short, missing = {}, {}, {}
  for _, color in ipairs(colors()) do
    local wanted, seat = gains[color], seatFor(color)
    if wanted and seat then
      local cards, parts = {}, {}
      for _, terrain in ipairs(TERRAINS) do
        local count, pile, given = wanted[terrain] or 0, supply[terrain] or {}, 0
        while given < count and #pile > 0 do
          table.insert(cards, table.remove(pile))
          given = given + 1
        end
        if given > 0 then table.insert(parts, given .. " " .. terrain) end
        if given < count and not missing[terrain] then
          missing[terrain] = true
          table.insert(short, terrain)
        end
      end
      if #cards > 0 then
        game.give(cards, seat)
        table.insert(lines, seat.name .. " takes " .. table.concat(parts, ", "))
      end
    end
  end
  return lines, short
end

local function squallWarning()
  local heavy = {}
  for _, seat in ipairs(game.players()) do
    local count = #game.hand(seat)
    if count > 7 then table.insert(heavy, seat.name .. " (" .. count .. " cards: discard " .. math.floor(count / 2) .. ")") end
  end
  local text = "Move the squall to another tile, then take a random card from a player beside it."
  if #heavy > 0 then text = text .. " Discard half your cards: " .. table.concat(heavy, ", ") .. "." end
  return text
end

-- Rolls the dice and hands out what the roll brings. Returns a title and text to show (nil when there are no dice).
local function roll(player)
  local dice = onTable("Die")
  if #dice == 0 then return nil end
  local total, faces = 0, {}
  -- One roll per die: dice rolled together in one call come out of one seed and aren't independent.
  for _, die in ipairs(dice) do
    local rolled = game.roll(die)[1]
    total = total + tonumber(rolled.data.value)
    table.insert(faces, rolled.data.value)
  end
  memory.lastRoll = total
  local title = (player and player.name or "The table") .. " rolled " .. total .. " (" .. table.concat(faces, " + ") .. ")"
  if total == 7 then return title .. ": the squall!", squallWarning() end
  local lines, short = handOut(production(total))
  local text = #lines == 0 and "Nothing comes in." or (table.concat(lines, "; ") .. ".")
  if #short > 0 then text = text .. " The supply ran out of " .. table.concat(short, ", ") .. "." end
  return title, text
end

-- Rolls for a player and shows what came of it.
local function rollFor(player)
  local title, text = roll(player)
  if not title then
    notify("No dice", "Put the dice on the table to roll them.", game.actor())
    return
  end
  notify(title, text, nil, memory.lastRoll == 7 and 15 or 8)
end

-- Dealing the island ----------------------------------------------------------------------------------------------

-- The island tiles in reading order (top row first, each row left to right), as BEGINNER lists them.
local function tilesInOrder()
  local tiles = islandTiles()
  table.sort(tiles, function(a, b)
    if math.abs(a.y - b.y) > 20 then return a.y < b.y end
    return a.x < b.x
  end)
  return tiles
end

-- The harbors clockwise around the island from the top, as BEGINNER lists them.
local function harborsInOrder(tiles)
  local middle = { x = 0, y = 0 }
  for _, tile in ipairs(tiles) do middle.x, middle.y = middle.x + tile.x / #tiles, middle.y + tile.y / #tiles end
  local function bearing(piece)
    local angle = math.atan(piece.x - middle.x, middle.y - piece.y)
    return angle < 0 and angle + 2 * math.pi or angle
  end
  local harbors = onTable("Harbor")
  table.sort(harbors, function(a, b) return bearing(a) < bearing(b) end)
  return harbors
end

-- The data row (from 1) of a component whose field has a value.
local function rowOf(component, field, value)
  for index, row in ipairs(game.component(component).data) do
    if row[field] == value then return index end
  end
  error(component .. " has no row with " .. field .. " " .. value)
end

-- Shows each piece's row (rows[i] for pieces[i]), with one change per row.
local function setRows(pieces, rows)
  local byRow, order = {}, {}
  for index, piece in ipairs(pieces) do
    local row = rows[index]
    if not byRow[row] then byRow[row] = {}; table.insert(order, row) end
    table.insert(byRow[row], piece)
  end
  for _, row in ipairs(order) do game.setRow(byRow[row], row) end
end

local function shuffled(list)
  local copy = {}
  for index, value in ipairs(list) do copy[index] = value end
  for index = #copy, 2, -1 do
    local other = game.random(index)
    copy[index], copy[other] = copy[other], copy[index]
  end
  return copy
end

local function markerOn(tile, markers)
  for _, marker in ipairs(markers) do
    if distance(marker, tile) < ON_TILE then return marker end
  end
end

-- Lays out the island on the tiles where they are: terrains (in reading order), the tide marker numbers of the tiles
-- that aren't the dunes (in reading order) and harbor rows (clockwise from the top). The squall moves to the dunes,
-- and the tide marker on the tile that becomes the dunes moves to the tile that stops being them. Returns false (and
-- says why) when the island isn't laid out as it should be.
local function layIsland(terrains, numbers, harbors)
  local tiles, markers = tilesInOrder(), onTable("Tide marker")
  local bare = {}
  for _, tile in ipairs(tiles) do
    if not markerOn(tile, markers) then table.insert(bare, tile) end
  end
  if #tiles ~= #terrains or #markers ~= #numbers or #bare ~= 1 then
    notify("The island can't be dealt", "It needs all " .. #terrains .. " island tiles face up with a tide marker on every tile but one. Put the island back together first.", game.actor(), 10)
    return false
  end
  local dunes
  for index, tile in ipairs(tiles) do
    if terrains[index] == "dunes" then dunes = tile end
  end
  local rows = {}
  for index, terrain in ipairs(terrains) do rows[index] = rowOf("Island tile", "terrain", terrain) end
  setRows(tiles, rows)
  -- The tide markers are held in place by their group, which the script unlocks for the move.
  local moving = markerOn(dunes, markers)
  if moving then
    game.lockGroup("Tide markers", false)
    game.move(moving, bare[1].x, bare[1].y + SLOT_DOWN)
    game.lockGroup("Tide markers", true)
  end
  for _, squall in ipairs(onTable("Squall")) do game.move(squall, dunes.x, dunes.y + SLOT_DOWN) end
  markers = onTable("Tide marker")
  local numbered = {}
  for _, tile in ipairs(tiles) do
    if tile.id ~= dunes.id then table.insert(numbered, markerOn(tile, markers)) end
  end
  rows = {}
  for index, number in ipairs(numbers) do rows[index] = rowOf("Tide marker", "number", tostring(number)) end
  setRows(numbered, rows)
  local piers = harborsInOrder(tiles)
  if #piers == #harbors then setRows(piers, harbors) end
  return true
end

-- A shuffled island: terrains, tide markers (no 6 or 8 next to another 6 or 8) and harbors.
local function randomIsland()
  local terrains, tiles = shuffled(BEGINNER.terrains), tilesInOrder()
  local spots = {}
  for index, tile in ipairs(tiles) do
    if terrains[index] ~= "dunes" then table.insert(spots, tile) end
  end
  local numbers
  for attempt = 1, 500 do
    numbers = shuffled(BEGINNER.numbers)
    local apart = true
    for i = 1, #spots do
      for j = i + 1, #spots do
        local red = (numbers[i] == 6 or numbers[i] == 8) and (numbers[j] == 6 or numbers[j] == 8)
        if red and distance(spots[i], spots[j]) < NEIGHBOURS then apart = false end
      end
    end
    if apart then break end
  end
  if layIsland(terrains, numbers, shuffled(BEGINNER.harbors)) then memory.shuffled = true end
end

-- The setup rounds --------------------------------------------------------------------------------------------------

local function placer()
  local id = memory.order and memory.order[memory.step]
  return id and game.player(id)
end

local function promptPlacer()
  local seat = placer()
  if not seat then return end
  game.setTurn(seat)
  local which = memory.step > #memory.order / 2 and "second" or "first"
  status(seat.name .. " is placing their " .. which .. " hut and boardwalk.", seat,
    "Your turn: place your " .. which .. " hut on a corner of the island, then a boardwalk beside it.")
end

local function beginPlacing()
  addSeats()
  claimPieces()
  local order, seats = {}, seated()
  for _, seat in ipairs(seats) do table.insert(order, seat.id) end
  for index = #seats, 1, -1 do table.insert(order, seats[index].id) end
  memory.phase = "placing"
  memory.order = order
  memory.step = 1
  memory.stepHut = nil
  memory.secondHuts = {}
  memory.placedPieces = {}
  showButtons()
  turnLocks()
  notify("The setup rounds", "In turn order and back again, each player places a hut on a corner of the island and a boardwalk beside it. The second hut earns your starting resources.", nil, 10)
  promptPlacer()
end

-- The last placement starts the game: starting resources for the second huts, then the first roll.
local function beginGame()
  memory.phase = "playing"
  memory.round = 1
  memory.stepHut = nil
  local placed = {}
  for _, id in ipairs(memory.placedPieces or {}) do
    if game.piece(id) then table.insert(placed, id) end
  end
  if #placed > 0 then game.unlock(placed) end
  status(nil)
  local gains, tiles = {}, islandTiles()
  for color, id in pairs(memory.secondHuts or {}) do
    local hut = game.piece(id)
    for _, tile in ipairs(hut and tiles or {}) do
      local terrain = tile.data.terrain
      if PRODUCES[terrain] and onCorner(hut, tile) then
        gains[color] = gains[color] or {}
        gains[color][terrain] = (gains[color][terrain] or 0) + 1
      end
    end
  end
  local lines = handOut(gains)
  local first = seated()[1]
  if first then game.setTurn(first) end
  showButtons()
  turnLocks()
  local text = (#lines > 0 and ("Starting resources: " .. table.concat(lines, "; ") .. ".") or "Nobody's second hut touches a producing tile.")
  text = text .. " First to " .. (memory.goal or 10) .. " points wins."
  tally()
  if memory.autoRoll ~= false and first then
    local title, rolled = roll(first)
    if title then text = text .. " " .. title .. ": " .. rolled end
  end
  notify("The game begins", text, nil, 15)
end

-- Sends a piece back to its colour's pile (hut-crimson, boardwalk-azure, ...) and tells whoever placed it why.
local function sendBack(piece, player, why)
  game.stackOnto(piece, piece.component:lower() .. "-" .. piece.data.color)
  if player then notify("Not there", why, player, 8) end
end

-- A piece snapped onto the island during the setup rounds.
local function placing(piece, player)
  local seat = placer()
  if not seat then return end
  local color = colors()[seat.seat]
  if piece.component == "Lighthouse" then
    return sendBack(piece, player, "Lighthouses come later: during the game, one replaces a hut of yours.")
  end
  if piece.data.color ~= color then
    return sendBack(piece, player, "It's " .. seat.name .. "'s turn to place a hut and a boardwalk.")
  end
  if piece.component == "Hut" and snappedOn(piece, "grid-corners") then
    local current = memory.stepHut and game.piece(memory.stepHut)
    if current and current.id ~= piece.id and snappedOn(current, "grid-corners") then
      return sendBack(piece, player, "One hut per turn: now place a boardwalk beside the hut you just placed.")
    end
    for _, other in ipairs(onTable("Hut")) do
      if other.id ~= piece.id and snappedOn(other, "grid-corners") and distance(other, piece) < CORNER + 4 then
        return sendBack(piece, player, "Too close: no hut may stand on a corner next to another hut.")
      end
    end
    memory.stepHut = piece.id
    status(seat.name .. " is placing a boardwalk beside their hut.", seat, "Now place a boardwalk on an edge beside your new hut.")
  elseif piece.component == "Boardwalk" and snappedOn(piece, "grid-edges") then
    local hut = memory.stepHut and game.piece(memory.stepHut)
    if not (hut and snappedOn(hut, "grid-corners")) then
      return sendBack(piece, player, "Place your hut first, then the boardwalk beside it.")
    end
    if math.abs(distance(hut, piece) - HALF_EDGE) > 4 then
      return sendBack(piece, player, "The boardwalk goes on an edge beside the hut you just placed.")
    end
    -- The pair is placed: it stays locked until the game begins.
    game.lock({ hut, piece })
    table.insert(memory.placedPieces, hut.id)
    table.insert(memory.placedPieces, piece.id)
    if memory.step > #memory.order / 2 then memory.secondHuts[color] = hut.id end
    memory.stepHut = nil
    memory.step = memory.step + 1
    tally()
    if memory.step > #memory.order then beginGame() else promptPlacer() end
  end
end

-- Buttons and popup actions -----------------------------------------------------------------------------------------

-- Game setup (the button): opens the Game setup popup for whoever presses it, who becomes the host.
function openSetup(button, player)
  if not player then return end
  if memory.phase ~= "setup" then
    notify("Game setup", "The game has already been set up.", player)
    return
  end
  memory.host = player.id
  game.closePopup("Game setup")
  game.popup("Game setup", { players = player })
  status("Waiting for " .. player.name .. " to choose the settings and deal the island.", player, nil)
end

-- The Game setup popup's choices, by the layer clicked.
function gameSetup(popup, player, layer)
  if memory.phase ~= "setup" or not player then return end
  if layer == "Random island" or layer == "Shuffle island" then
    memory.randomIsland = true
    randomIsland()
  elseif layer == "Beginner island" then
    memory.randomIsland = false
    if layIsland(BEGINNER.terrains, BEGINNER.numbers, BEGINNER.harbors) then memory.shuffled = false end
  elseif layer == "Three players" then
    setPlayerCount(3)
  elseif layer == "Four players" then
    setPlayerCount(4)
  elseif layer == "Fewer points" then
    memory.goal = math.max(5, (memory.goal or 10) - 1)
  elseif layer == "More points" then
    memory.goal = math.min(15, (memory.goal or 10) + 1)
  elseif layer == "Automatic dice" then
    memory.autoRoll = true
  elseif layer == "Dice button" then
    memory.autoRoll = false
  elseif layer == "Start placing" then
    -- A random island that hasn't been shuffled yet is shuffled now.
    if memory.randomIsland and not memory.shuffled then randomIsland() end
    game.closePopup("Game setup")
    beginPlacing()
  end
end

function rollDice(piece, player)
  if memory.phase ~= "playing" then
    notify("Not yet", "The dice roll once the game has begun.", player)
    return
  end
  rollFor(player)
  tally()
end

-- Events ----------------------------------------------------------------------------------------------------------

function onTurnStart(player)
  if memory.phase == "placing" then
    -- The setup rounds keep their own order: the turn goes back to whoever is placing.
    local seat = placer()
    if seat and player and seat.id ~= player.id then
      game.setTurn(seat)
      notify("Setup rounds", "It's still " .. seat.name .. "'s turn to place a hut and a boardwalk.", nil, 6)
    end
    return
  end
  if memory.phase ~= "playing" then return end
  if player and player.seat == 1 then memory.round = (memory.round or 0) + 1 end
  -- Roll dice, the dice and the squall pass to the new seat.
  showButtons()
  turnLocks()
  if memory.autoRoll ~= false then rollFor(player) end
end

function onSnap(pieces, player)
  for _, piece in ipairs(pieces) do
    local building = piece.component == "Hut" or piece.component == "Boardwalk" or piece.component == "Lighthouse"
    if building and memory.phase == "setup" and (snappedOn(piece, "grid-corners") or snappedOn(piece, "grid-edges")) then
      sendBack(piece, player, "Wait for the game setup: the setup rounds start once the host has dealt the island.")
    elseif building and memory.phase == "placing" then
      placing(piece, player)
    end
    -- The squall settles on a tile during the game: name the players beside it.
    if piece.component == "Squall" and memory.phase == "playing" then
      local tile = tileUnder(piece)
      if tile then
        local beside, seen = {}, {}
        for _, kind in ipairs(BUILDINGS) do
          for _, other in ipairs(onTable(kind[1])) do
            local color = other.data.color
            local seat = seatFor(color)
            if onCorner(other, tile) and not seen[color] and not (player and seat and seat.id == player.id) then
              seen[color] = true
              table.insert(beside, seatName(color))
            end
          end
        end
        local who = player and player.name or "Whoever moved it"
        local text = #beside > 0 and (who .. " takes a random card from " .. table.concat(beside, " or ") .. ".") or "Nobody lives beside it."
        notify("The squall settles on the " .. tile.data.name, text, nil, 8)
      end
    end
  end
end

-- Changing memory.autoRoll or memory.phase in the Memory window shows or hides the buttons to match.
function onMemoryChanged(changes, player)
  for _, change in ipairs(changes) do
    if change.keys[1] == "autoRoll" or change.keys[1] == "phase" then
      showButtons()
      return
    end
  end
end

function onMove(pieces, player)
  for _, piece in ipairs(pieces) do
    if piece.component == "Hut" or piece.component == "Lighthouse" then
      tally()
      return
    end
  end
end
`;
