// Wellcrawl: a tiny deterministic turn-based dungeon crawl.
//
// You (@) need the exit (E). It is behind a locked door (D), and the key (k) lies in a room guarded
// by a ghoul (G). Ghouls are slow (they act every other turn) and only chase you inside their own
// room. A ghoul's hit costs 1 hp and knocks the key out of your hands: it skids one tile away from the
// ghoul and you have to fetch it again. Bump into a ghoul to hit it back; two hits kill it. Potions (!)
// heal 1 hp, gold ($) is just score, bats (b) flutter back and forth and get in the way.
//
// Nothing here knows about testing tools: it is ordinary game code. `createGame()` makes a game,
// `legalMoves(game)` lists what the player may do, `applyMove(game, move)` plays one turn.

export const MAX_HP = 3;
const GHOUL_HP = 2;

const WALL = '#';
const WATER = '~';

export const LEVELS = {
  cellar: {
    map: [
      '##########',
      '#@.$#.~k.#',
      '#.!......#',
      '#...#.~.G#',
      '########D#',
      '########E#',
      '##########',
    ],
    rooms: { cellar: [1, 1, 3, 3], well: [5, 1, 8, 3], stairs: [8, 5, 8, 5] },
  },
  // Seven small chambers in a snake, then the stairs. Same well room as the cellar, much further away.
  catacombs: {
    map: [
      '#####################',
      '#@.$.#.$..#b.$.#.$..#',
      '#.........#.........#',
      '#..$.#..$....$.#..$!#',
      '##################.##',
      '######.k~.#..$.#.$..#',
      '######.........#...$#',
      '######G.~.#.$.....$.#',
      '######D##############',
      '######E##############',
      '#####################',
    ],
    rooms: {
      crypt: [1, 1, 4, 3], gallery: [6, 1, 9, 3], belfry: [11, 1, 14, 3], shrine: [16, 1, 19, 3],
      ossuary: [16, 5, 19, 7], chapel: [11, 5, 14, 7], well: [6, 5, 9, 7], stairs: [6, 9, 6, 9],
    },
  },
};

export const DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createGame({ level = 'cellar', bugs = true } = {}) {
  const { map } = LEVELS[level];
  const game = { level, bugs, status: 'playing', player: null, items: [], doors: [], monsters: [] };
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '@') game.player = { x, y, hp: MAX_HP, gold: 0, potions: 0, hasKey: false };
    else if (ch === 'k') game.items.push({ kind: 'key', x, y });
    else if (ch === '$') game.items.push({ kind: 'gold', x, y });
    else if (ch === '!') game.items.push({ kind: 'potion', x, y });
    else if (ch === 'D') game.doors.push({ x, y, open: false });
    else if (ch === 'G') game.monsters.push({ kind: 'ghoul', x, y, hp: GHOUL_HP, home: roomAt(level, x, y), rested: false });
    else if (ch === 'b') game.monsters.push({ kind: 'bat', x, y, dx: 1 });
  }));
  return game;
}

/** The static tile at (x, y): '#', '~', 'E', or '.' (entities and doors are tracked separately). */
export function tileAt(level, x, y) {
  const ch = LEVELS[level].map[y]?.[x];
  if (ch === undefined || ch === WALL) return WALL;
  if (ch === WATER || ch === 'E') return ch;
  return '.';
}

export function roomAt(level, x, y) {
  for (const [name, [x0, y0, x1, y1]] of Object.entries(LEVELS[level].rooms)) {
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return name;
  }
  return null; // a doorway or gap between rooms
}

export const doorAt = (game, x, y) => game.doors.find((d) => d.x === x && d.y === y);
export const monsterAt = (game, x, y) => game.monsters.find((m) => m.x === x && m.y === y);

/** Ground you could stand on: not a wall, not water, not a closed door. */
export function isWalkable(game, x, y) {
  const t = tileAt(game.level, x, y);
  if (t === WALL || t === WATER) return false;
  return !doorAt(game, x, y) || doorAt(game, x, y).open;
}

// Can an item knocked out of the player's hands come to rest at (x, y)?
function canLand(game, x, y) {
  if (game.bugs) return tileAt(game.level, x, y) !== WALL; // only walls stop it: water and closed doors swallow the key
  return isWalkable(game, x, y);
}

export function legalMoves(game) {
  if (game.status !== 'playing') return [];
  const { player: p } = game;
  const moves = [];
  for (const [dir, [dx, dy]] of Object.entries(DIRECTIONS)) {
    const x = p.x + dx, y = p.y + dy;
    const door = doorAt(game, x, y);
    const m = monsterAt(game, x, y);
    if (door && !door.open) {
      if (p.hasKey) moves.push({ type: 'walk', dir }); // unlocks it
    } else if (isWalkable(game, x, y) && m?.kind !== 'bat') moves.push({ type: 'walk', dir });
  }
  moves.push({ type: 'wait' });
  if (p.potions > 0 && p.hp < MAX_HP) moves.push({ type: 'drink' });
  return moves;
}

/** Play one turn: the player's move, then every monster's. Mutates and returns `game`. */
export function applyMove(game, move) {
  if (!legalMoves(game).some((m) => m.type === move.type && m.dir === move.dir)) {
    throw new Error(`illegal move ${JSON.stringify(move)}`);
  }
  const p = game.player;
  if (move.type === 'drink') {
    p.potions--;
    p.hp = Math.min(MAX_HP, p.hp + 1);
  } else if (move.type === 'walk') {
    const [dx, dy] = DIRECTIONS[move.dir];
    const x = p.x + dx, y = p.y + dy;
    const door = doorAt(game, x, y);
    const ghoul = monsterAt(game, x, y);
    if (door && !door.open) {
      door.open = true;
      p.hasKey = false; // the key stays in the lock
    } else if (ghoul) {
      if (--ghoul.hp <= 0) game.monsters = game.monsters.filter((m) => m !== ghoul);
    } else {
      p.x = x;
      p.y = y;
      pickUp(game);
      if (tileAt(game.level, x, y) === 'E') {
        game.status = 'won';
        return game;
      }
    }
  }
  for (const m of game.monsters) {
    if (m.kind === 'bat') flutter(game, m);
    else ghoulTurn(game, m);
    if (game.status !== 'playing') break;
  }
  return game;
}

function pickUp(game) {
  const p = game.player;
  for (const item of game.items.filter((i) => i.x === p.x && i.y === p.y)) {
    if (item.kind === 'gold') p.gold++;
    else if (item.kind === 'potion') p.potions++;
    else if (item.kind === 'key') p.hasKey = true;
    game.items.splice(game.items.indexOf(item), 1);
  }
}

function blocked(game, x, y) {
  return !isWalkable(game, x, y) || monsterAt(game, x, y) || (game.player.x === x && game.player.y === y);
}

function flutter(game, bat) {
  if (blocked(game, bat.x + bat.dx, bat.y)) bat.dx = -bat.dx;
  if (!blocked(game, bat.x + bat.dx, bat.y)) bat.x += bat.dx;
}

function ghoulTurn(game, g) {
  const p = game.player;
  if (roomAt(game.level, p.x, p.y) !== g.home) return; // asleep until you walk in
  g.rested = !g.rested;
  if (!g.rested) return; // slow: acts every other turn
  const ddx = p.x - g.x, ddy = p.y - g.y;
  if (Math.abs(ddx) + Math.abs(ddy) === 1) return hit(game, g);
  const horizontal = [Math.sign(ddx), 0], vertical = [0, Math.sign(ddy)];
  const tries = Math.abs(ddx) >= Math.abs(ddy) ? [horizontal, vertical] : [vertical, horizontal];
  for (const [sx, sy] of tries) {
    if ((sx || sy) && !blocked(game, g.x + sx, g.y + sy)) {
      g.x += sx;
      g.y += sy;
      return;
    }
  }
}

function hit(game, g) {
  const p = game.player;
  p.hp--;
  if (p.hp <= 0) {
    game.status = 'lost';
    return;
  }
  if (p.hasKey) {
    // The key skids one tile away from the ghoul, or stays at your feet if something is in the way.
    const x = p.x + Math.sign(p.x - g.x), y = p.y + Math.sign(p.y - g.y);
    const [kx, ky] = canLand(game, x, y) ? [x, y] : [p.x, p.y];
    p.hasKey = false;
    game.items.push({ kind: 'key', x: kx, y: ky });
  }
}

/** The map as text, with entities drawn in. */
export function render(game) {
  const rows = LEVELS[game.level].map.map((r) => [...r].map((ch) => ('#~E'.includes(ch) ? ch : '.')));
  for (const d of game.doors) rows[d.y][d.x] = d.open ? '/' : 'D';
  for (const i of game.items) rows[i.y][i.x] = { key: 'k', gold: '$', potion: '!' }[i.kind];
  for (const m of game.monsters) rows[m.y][m.x] = m.kind === 'bat' ? 'b' : 'G';
  rows[game.player.y][game.player.x] = '@';
  return rows.map((r) => r.join('')).join('\n');
}
