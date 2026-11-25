/**
 * The Tidewater Isles rules script (Lua, run by the table's scripting engine; see Scripting in the README). It rolls the
 * dice when a turn starts, hands out resources for the huts and lighthouses beside the rolled tiles, warns about the
 * squall on a 7, deals starting resources and keeps building points in memory for the scoreboard.
 *
 * It also hides the buttons that don't apply yet (or any more) from every seat: Start game once the game is under way,
 * and Roll dice until then and while the dice roll by themselves.
 *
 * Start game first checks that every seat has set up correctly (two huts and two boardwalks on the island, each hut
 * beside one of its boardwalks, no huts on neighbouring corners), points out what's wrong and doesn't start otherwise.
 *
 * Memory it uses: `colors` (the colour each seat plays, in seat order), `checkSetup`, `autoRoll`, `started`, `round`, `lastRoll`,
 * `points` (building points per colour) and `placed` (each colour's huts in the order they were placed, before the
 * game starts).
 */
export const TIDEWATER_SCRIPT = String.raw`-- Tidewater Isles: rolls, resources and the squall.
--
-- Seats play the colours in memory.colors, in seat order (seat 1 crimson, 2 azure, 3 ivory, 4 amber); change the list in
-- the Memory window to match your table. Place the huts and boardwalks of the setup rounds, then press Start game. It
-- checks everyone's setup first and points out what's missing (set memory.checkSetup to false to skip that); then each
-- player takes one resource for every tile touching the second hut they placed. From then on the dice roll by
-- themselves whenever a turn starts (set memory.autoRoll to false to roll with the Roll dice button instead, which only
-- shows while it's needed). Every
-- hut on a corner of a tile showing the rolled number takes one of its resource and every lighthouse two, unless the
-- squall is on that tile. A 7 brings the squall instead.

local CORNER = 56        -- from a tile's centre to its corners
local HALF_EDGE = 28     -- from the middle of a tile edge (a boardwalk) to its corners (huts)
local ON_TILE = 45       -- a tide marker or the squall this close to a tile's centre is on that tile
local TERRAINS = { "reed", "clay", "salt", "fish", "stone" }
local PRODUCES = { reed = true, clay = true, salt = true, fish = true, stone = true }
local BUILDINGS = { { "Hut", 1 }, { "Lighthouse", 2 } }

local function distance(a, b) return math.sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2) end
local function onTable(component) return game.pieces({ component = component, holder = false }) end

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

-- Building points: 1 for each hut and 2 for each lighthouse standing on the island.
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
  local text = "The squall! Move it to another tile, then take a random card from a player beside it."
  if #heavy > 0 then text = text .. " Discard half your cards: " .. table.concat(heavy, ", ") .. "." end
  return text
end

local function roll(player)
  local dice = onTable("Die")
  if #dice == 0 then
    game.announce("Put the dice on the table to roll them.")
    return
  end
  local total, faces = 0, {}
  -- One roll per die: dice rolled together in one call come out of one seed and aren't independent.
  for _, die in ipairs(dice) do
    local rolled = game.roll(die)[1]
    total = total + tonumber(rolled.data.value)
    table.insert(faces, rolled.data.value)
  end
  memory.lastRoll = total
  local text = (player and player.name or "The table") .. " rolled " .. total .. " (" .. table.concat(faces, " + ") .. "). "
  if total == 7 then
    text = text .. squallWarning()
  else
    local lines, short = handOut(production(total))
    if #lines == 0 then text = text .. "Nothing comes in." else text = text .. table.concat(lines, "; ") .. "." end
    if #short > 0 then text = text .. " The supply ran out of " .. table.concat(short, ", ") .. "." end
  end
  game.announce(text)
end

-- Buttons ---------------------------------------------------------------------------------------------------------

-- Shows only the buttons that make sense now and hides the others from every seat: Start game until the game starts,
-- then Roll dice while the dice don't roll by themselves (memory.autoRoll is false).
local function showButtons()
  local everyone = {}
  for _, seat in ipairs(game.players()) do table.insert(everyone, seat.id) end
  local function shownWhen(shown, component)
    local pieces = onTable(component)
    if #pieces > 0 then
      if shown then game.hideFrom(pieces, {}) else game.hideFrom(pieces, everyone) end
    end
  end
  shownWhen(not memory.started, "Start game")
  shownWhen(memory.started and memory.autoRoll == false, "Roll dice")
end

-- Each colour's pieces standing on one of a grid's points (huts on the corner grid, boardwalks on the edge grid).
local function snappedTo(component, grid)
  local byColor = {}
  for _, piece in ipairs(onTable(component)) do
    if piece.snap and piece.snap.grid == grid then
      local list = byColor[piece.data.color] or {}
      table.insert(list, piece)
      byColor[piece.data.color] = list
    end
  end
  return byColor
end

local function plural(count, word) return count .. " " .. word .. (count == 1 and "" or "s") end

-- What's wrong with the setup, as text for each problem, and the pieces to point out. Every seated colour needs two
-- huts on corners of the island and two boardwalks on its edges, each hut with one of its boardwalks beside it and
-- each boardwalk beside one of its huts; no two huts may stand on neighbouring corners, and lighthouses come later.
local function setupProblems()
  local huts, walks = snappedTo("Hut", "grid-corners"), snappedTo("Boardwalk", "grid-edges")
  local towers = snappedTo("Lighthouse", "grid-corners")
  local problems, flagged = {}, {}
  local function beside(a, b) return math.abs(distance(a, b) - HALF_EDGE) < 4 end
  for _, color in ipairs(colors()) do
    local seat = seatFor(color)
    if seat then
      local mine, ways, issues = huts[color] or {}, walks[color] or {}, {}
      if #mine ~= 2 then table.insert(issues, plural(#mine, "hut") .. " on the island instead of 2") end
      if #ways ~= 2 then table.insert(issues, plural(#ways, "boardwalk") .. " on the island instead of 2") end
      local lonely, loose = 0, 0
      for _, hut in ipairs(mine) do
        local ok = false
        for _, walk in ipairs(ways) do if beside(hut, walk) then ok = true end end
        if not ok then lonely = lonely + 1; table.insert(flagged, hut) end
      end
      for _, walk in ipairs(ways) do
        local ok = false
        for _, hut in ipairs(mine) do if beside(hut, walk) then ok = true end end
        if not ok then loose = loose + 1; table.insert(flagged, walk) end
      end
      if lonely > 0 then table.insert(issues, plural(lonely, "hut") .. " without a boardwalk beside it") end
      if loose > 0 then table.insert(issues, plural(loose, "boardwalk") .. " away from their huts") end
      local early = towers[color] or {}
      for _, lighthouse in ipairs(early) do table.insert(flagged, lighthouse) end
      if #early > 0 then table.insert(issues, plural(#early, "lighthouse") .. " on the island before the game") end
      if #issues > 0 then table.insert(problems, seat.name .. " has " .. table.concat(issues, ", ")) end
    end
  end
  -- The distance rule, between every pair of huts on the island.
  local all = {}
  for _, color in ipairs(colors()) do
    if seatFor(color) then for _, hut in ipairs(huts[color] or {}) do table.insert(all, hut) end end
  end
  for i = 1, #all do
    for j = i + 1, #all do
      if distance(all[i], all[j]) < CORNER + 4 then
        table.insert(problems, "huts of " .. seatName(all[i].data.color) .. " and " .. seatName(all[j].data.color) .. " stand on neighbouring corners")
        table.insert(flagged, all[i])
        table.insert(flagged, all[j])
      end
    end
  end
  return problems, flagged
end

-- The colour's hut on the island placed last of its huts (the one that earns starting resources), or nil.
local function secondHut(color, onIsland)
  local placed, best, bestAt = (memory.placed or {})[color] or {}, nil, 0
  for _, hut in ipairs(onIsland) do
    for index, id in ipairs(placed) do
      if id == hut.id and index > bestAt then best, bestAt = hut, index end
    end
  end
  return best
end

function startGame(piece, player)
  if memory.started then
    game.announce("The game is already under way: end your turn to roll, or press Roll dice.")
    return
  end
  -- Everyone must have set up correctly first (set memory.checkSetup to false to start anyway).
  if memory.checkSetup ~= false then
    local problems, flagged = setupProblems()
    if #problems > 0 then
      if #flagged > 0 then game.ping(flagged) end
      game.announce("Not ready to start: " .. table.concat(problems, "; ") .. ".")
      return
    end
  end
  local gains, tiles, missing = {}, islandTiles(), {}
  local huts = snappedTo("Hut", "grid-corners")
  for _, color in ipairs(colors()) do
    local second = secondHut(color, huts[color] or {})
    if second then
      for _, tile in ipairs(tiles) do
        local terrain = tile.data.terrain
        if PRODUCES[terrain] and onCorner(second, tile) then
          gains[color] = gains[color] or {}
          gains[color][terrain] = (gains[color][terrain] or 0) + 1
        end
      end
    elseif seatFor(color) then
      table.insert(missing, seatName(color))
    end
  end
  memory.started = true
  memory.round = 1
  showButtons()
  local lines = handOut(gains)
  local text = "The game begins."
  if #lines > 0 then text = text .. " Starting resources: " .. table.concat(lines, "; ") .. "." end
  if #missing > 0 then text = text .. " No second hut on the island for " .. table.concat(missing, ", ") .. ": take those starting resources by hand." end
  game.announce(text)
  tally()
  if memory.autoRoll ~= false then roll(game.currentPlayer()) end
end

function rollDice(piece, player)
  roll(player)
  tally()
end

-- Events ----------------------------------------------------------------------------------------------------------

function onTurnStart(player)
  if not memory.started then return end
  if player and player.seat == 1 then memory.round = (memory.round or 0) + 1 end
  if memory.autoRoll ~= false then roll(player) end
end

function onSnap(pieces, player)
  for _, piece in ipairs(pieces) do
    -- Before the game starts, remember the order each colour places its huts in (the second one earns starting resources).
    if piece.component == "Hut" and not memory.started and piece.snap and piece.snap.grid == "grid-corners" then
      local placed = memory.placed or {}
      local list = placed[piece.data.color] or {}
      local known = false
      for _, id in ipairs(list) do
        if id == piece.id then known = true end
      end
      if not known then table.insert(list, piece.id) end
      placed[piece.data.color] = list
      memory.placed = placed
    end
    -- The squall settles on a tile: name the players beside it.
    if piece.component == "Squall" then
      local tile = tileUnder(piece)
      if tile then
        local beside, seen = {}, {}
        for _, kind in ipairs(BUILDINGS) do
          for _, building in ipairs(onTable(kind[1])) do
            local color = building.data.color
            local seat = seatFor(color)
            if onCorner(building, tile) and not seen[color] and not (player and seat and seat.id == player.id) then
              seen[color] = true
              table.insert(beside, seatName(color))
            end
          end
        end
        local text = "The squall settles on the " .. tile.data.name .. "."
        if #beside > 0 then text = text .. " Take a random card from " .. table.concat(beside, " or ") .. "." else text = text .. " Nobody lives beside it." end
        game.announce(text)
      end
    end
  end
end

-- Turning memory.autoRoll (or started) on or off in the Memory window shows or hides the buttons to match.
function onMemoryChanged(changes, player)
  for _, change in ipairs(changes) do
    if change.keys[1] == "autoRoll" or change.keys[1] == "started" then
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
