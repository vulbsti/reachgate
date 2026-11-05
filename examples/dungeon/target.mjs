// reachgate target for the Wellcrawl dungeon game (game.mjs). The game itself knows nothing about
// reachgate; this file only describes it: where a game starts, which moves are legal, how to play one,
// and what must always be true.
//
//   node bin/reachgate.mjs explore examples/dungeon/target.mjs            cellar level, seeded bug
//   node bin/reachgate.mjs explore examples/dungeon/target.mjs#fixed      cellar level, bug fixed
//   node bin/reachgate.mjs explore examples/dungeon/target.mjs#deep --strategy go-explore
import { createGame, applyMove, legalMoves, tileAt, roomAt, doorAt, isWalkable, LEVELS, MAX_HP, DIRECTIONS } from './game.mjs';

/** Can the player still get to the exit? Flood fill over the map; a locked door opens once the key is in hand or lies somewhere reachable. */
export function exitReachable(game) {
  const { player: p, level } = game;
  const w = LEVELS[level].map[0].length;
  const keyAt = new Set(game.items.filter((i) => i.kind === 'key').map((i) => i.y * w + i.x));
  let haveKey = p.hasKey;
  const seen = new Set([p.y * w + p.x]);
  const queue = [[p.x, p.y]], lockedDoors = [];
  while (queue.length) {
    const [x, y] = queue.pop();
    if (tileAt(level, x, y) === 'E') return true;
    if (!haveKey && keyAt.has(y * w + x)) {
      haveKey = true;
      queue.push(...lockedDoors);
    }
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const nx = x + dx, ny = y + dy, k = ny * w + nx;
      if (seen.has(k)) continue;
      const door = doorAt(game, nx, ny);
      if (door && !door.open) {
        if (!haveKey) {
          lockedDoors.push([nx, ny]);
          continue;
        }
      } else if (!isWalkable(game, nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return false;
}

function whereIsKey(g) {
  if (g.player.hasKey) return 'in hand';
  const key = g.items.find((i) => i.kind === 'key');
  if (!key) return 'gone';
  const on = doorAt(g, key.x, key.y)?.open === false ? 'stuck in the locked door' : tileAt(g.level, key.x, key.y) === '~' ? 'in the water' : 'on the floor';
  return `${on} at (${key.x},${key.y})`;
}

const inside = (game, { x, y }) => y >= 0 && y < LEVELS[game.level].map.length && x >= 0 && x < LEVELS[game.level].map[0].length;
const at = (e) => `${e.kind ?? 'player'} at (${e.x},${e.y})`;
const keysInWorld = (g) => (g.player.hasKey ? 1 : 0) + g.items.filter((i) => i.kind === 'key').length + g.doors.filter((d) => d.open).length;

function makeTarget({ name, level, bugs }) {
  const start = createGame({ level }).items.find((i) => i.kind === 'key');
  return {
    name,
    initial: () => createGame({ level, bugs }),
    affordances: (g) => legalMoves(g),
    step: (g, move) => applyMove(g, move),
    isTerminal: (g) => g.status !== 'playing',
    // The game builds its objects with a fixed key order, so plain JSON is an exact identity, and a
    // hand-written copy is faster than structuredClone. Both are optional; they halve the run time here.
    hash: (g) => JSON.stringify(g),
    clone: (g) => ({ ...g, player: { ...g.player }, items: g.items.map((i) => ({ ...i })), doors: g.doors.map((d) => ({ ...d })), monsters: g.monsters.map((m) => ({ ...m })) }),
    label: (m) => m.dir ?? m.type,
    invariants: {
      'no-softlock': (g) => g.status !== 'playing' || exitReachable(g)
        || `the exit can no longer be reached: the key is ${whereIsKey(g)}`,
      'in-bounds': (g) => [g.player, ...g.monsters, ...g.items].every((e) => inside(g, e)) || 'an entity left the map',
      'not-in-wall': (g) => {
        const stuck = [g.player, ...g.monsters].find((e) => !isWalkable(g, e.x, e.y)) ?? g.items.find((i) => tileAt(g.level, i.x, i.y) === '#');
        return !stuck || `${at(stuck)} is inside a wall or water`;
      },
      'hp-bounded': (g) => (g.player.hp >= 0 && g.player.hp <= MAX_HP && (g.player.hp === 0) === (g.status === 'lost')) || `hp ${g.player.hp}, status ${g.status}`,
      'one-key': (g) => keysInWorld(g) === 1 || `${keysInWorld(g)} keys in the world`,
    },
    describe: {
      'no-softlock': 'while the game is on, the exit is still reachable (fetching the key if needed)',
      'in-bounds': 'every entity is on the map',
      'not-in-wall': 'no entity stands in a wall or water; no item lies in a wall',
      'hp-bounded': `0 <= hp <= ${MAX_HP}, and hp is 0 exactly when the game is lost`,
      'one-key': 'exactly one key exists: in hand, on the floor, or in the opened door',
    },
    observe: (g) => {
      const key = g.items.find((i) => i.kind === 'key');
      return [
        `room:${roomAt(level, g.player.x, g.player.y) ?? 'passage'}`,
        ...(g.player.hasKey ? ['picked:key'] : []),
        ...(key && (key.x !== start.x || key.y !== start.y) ? ['key:knocked-loose'] : []),
        ...(g.player.gold ? ['picked:gold'] : []),
        ...(g.player.potions ? ['picked:potion'] : []),
        ...(g.doors.some((d) => d.open) ? ['door:open'] : []),
        ...(!g.monsters.some((m) => m.kind === 'ghoul') ? ['ghoul:slain'] : []),
        ...(g.status !== 'playing' ? [g.status] : []),
      ];
    },
    // Go-Explore cell: which room you are in and how far along you are. Gold, bats and exact positions are left out.
    abstract: (g) => [roomAt(level, g.player.x, g.player.y) ?? 'passage', g.player.hasKey, g.doors.some((d) => d.open), g.player.hp >= 2 ? 'healthy' : 'hurt'],
  };
}

export default makeTarget({ name: 'dungeon (cellar, seeded bug)', level: 'cellar', bugs: true });
export const fixed = makeTarget({ name: 'dungeon (cellar, fixed)', level: 'cellar', bugs: false });
export const deep = makeTarget({ name: 'dungeon (catacombs, seeded bug)', level: 'catacombs', bugs: true });
export const deepFixed = makeTarget({ name: 'dungeon (catacombs, fixed)', level: 'catacombs', bugs: false });
