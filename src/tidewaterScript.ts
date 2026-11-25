/**
 * The Tidewater Isles rules script (Lua, run by the table's scripting engine; see Scripting in the README). It rolls the
 * dice when a turn starts, hands out resources for the huts and lighthouses beside the rolled tiles, warns about the
 * squall on a 7, deals starting resources and keeps building points in memory for the scoreboard.
 *
 * It also hides the buttons that don't apply yet (or any more) from every seat: Start game once the game is under way,
 * and Roll dice until then and while the dice roll by themselves.
 *
 * Memory it uses: `colors` (the colour each seat plays, in seat order), `autoRoll`, `started`, `round`, `lastRoll`,
 * `points` (building points per colour) and `placed` (each colour's huts in the order they were placed, before the
 * game starts).
 */
export const TIDEWATER_SCRIPT = String.raw`-- Tidewater Isles: rolls, resources and the squall.
--
-- Seats play the colours in memory.colors, in seat order (seat 1 crimson, 2 azure, 3 ivory, 4 amber); change the list in
-- the Memory window to match your table. Place the huts and boardwalks of the setup rounds, then press Start game: each
-- player takes one resource for every tile touching the second hut they placed. From then on the dice roll by
-- themselves whenever a turn starts (set memory.autoRoll to false to roll with the Roll dice button instead, which only
-- shows while it's needed). Every
-- hut on a corner of a tile showing the rolled number takes one of its resource and every lighthouse two, unless the
-- squall is on that tile. A 7 brings the squall instead.

local CORNER = 56        -- from a tile's centre to its corners
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

function startGame(piece, player)
  if memory.started then
    game.announce("The game is already under way: end your turn to roll, or press Roll dice.")
    return
  end
  local gains, tiles, missing = {}, islandTiles(), {}
  local huts = onTable("Hut")
  for _, color in ipairs(colors()) do
    local placed = (memory.placed or {})[color] or {}
    local second
    for _, hut in ipairs(huts) do
      if hut.id == placed[2] then second = hut end
    end
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
