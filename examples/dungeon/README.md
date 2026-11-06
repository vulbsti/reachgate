# Dungeon: a softlock BFS finds in 13 moves, and one that only Go-Explore reaches

`game.mjs` is **Wellcrawl**, a small deterministic turn-based dungeon crawl, written as ordinary game
code (map strings, entities, `createGame()`, `legalMoves()`, `applyMove()`). It has no reachgate code in
it. `target.mjs` is the reachgate target that wraps it.

```
##########      @ you         k key        D locked door    E exit
#@.$#.~k.#      G ghoul       $ gold       ~ water          ! potion
#.!......#
#...#.~.G#      The exit is behind the locked door. The key lies in the well room,
########D#      guarded by a ghoul. Ghouls are slow (they act every other turn) and
########E#      only chase you inside their own room. A ghoul's hit costs 1 hp and
##########      knocks the key out of your hands: it skids one tile away from the ghoul.
```

You win on the exit and lose at 0 hp. Bump a ghoul to hit it (two hits kill it); potions heal.

## The seeded bug

When a hit knocks the key loose, the game checks where it can land
([`game.mjs` line 97](game.mjs#L97)):

```js
// Can an item knocked out of the player's hands come to rest at (x, y)?
function canLand(game, x, y) {
  if (game.bugs) return tileAt(game.level, x, y) !== WALL; // only walls stop it: water and closed doors swallow the key
  return isWalkable(game, x, y);
}
```

The fixed version asks the same question player movement asks (`isWalkable`: not a wall, not water,
not a closed door). The buggy version only checks for walls, the kind of thing a "simplify the tile
checks" refactor does. So if the ghoul hits you while you stand in front of the locked door with your
back to it, the key skids *into the closed door*. You can't step onto a closed door without the key,
so you can never pick it up again. The game can't be won any more, but it isn't lost either: the
player can still walk around. That's a **softlock**. No position check notices it: the key isn't in a
wall.

`createGame({ bugs: true })` (the default) has the bug. `createGame({ bugs: false })` doesn't.

## The invariants

| Invariant | Meaning |
| --- | --- |
| `no-softlock` | while the game is on, the exit is still reachable. A flood fill over the map: a locked door counts as passable once the key is in hand or lies on a tile the player can reach. |
| `in-bounds` | every entity is on the map |
| `not-in-wall` | no entity stands in a wall or water; no item lies in a wall |
| `hp-bounded` | `0 <= hp <= 3`, and hp is 0 exactly when the game is lost |
| `one-key` | exactly one key exists: in hand, on the floor, or in the opened door |

`isTerminal` (won or lost) turns on deadlock detection. `observe` names `room:<name>`, `picked:key`,
`key:knocked-loose`, `door:open`, `ghoul:slain`, `won`, `lost` and more, for the baseline.

## Run it

From the repository root:

```console
$ node bin/reachgate.mjs explore examples/dungeon/target.mjs
FAIL: 1 invariant violated · 10772 states, 35881 steps, 18 labels · state space exhausted · 475 ms
  ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (8,4)
    witness (13 steps, shortest): down → right → right → right → right → right → right → up → right → down → down → up → wait
    replay: reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json
warning: 16 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
```

The witness is **13 moves, and no shorter one exists**. BFS visits states in order of distance from
the start, so the first state it finds that breaks an invariant is one of the closest. This run also
exhausted the state space (every reachable state was visited), so nothing was missed. Here is what the
13 moves do: walk to the well room (1-7), take the key (8), and run for the door with the ghoul
following (9-11). Then you turn and hit it (12) instead of opening the door, wait (13), and the ghoul
hits back:

```
after move 11              after move 13
##########                 ##########
#..$#.~..#                 #..$#.~..#
#.......G#                 #.......G#
#...#.~.@#                 #...#.~.@#
########D#                 ########k#   <- the key skidded into the locked door
########E#                 ########E#
```

`reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json` plays it back one
step at a time. It ends with `REPRODUCED: no-softlock at step 13`.

The fixed game passes, and that's a full proof for this level, not a sample:

```console
$ node bin/reachgate.mjs explore examples/dungeon/target.mjs#fixed
PASS: 0 invariants violated · 11306 states, 37594 steps, 18 labels · state space exhausted · 631 ms
report: .reachgate/report.md
```

## Go-Explore vs BFS on a bigger level

`target.mjs#deep` is the same game and the same bug on the `catacombs` level: seven small chambers in
a snake, then the same well room, ghoul and door. On the way there are 13 gold coins and a bat that
flutters back and forth. None of that matters for the bug, but all of it is exact state: every subset
of coins picked up, and every bat position, is a different state to BFS.

With the default 200,000-step budget:

```console
$ node bin/reachgate.mjs explore examples/dungeon/target.mjs#deep
PASS: 0 invariants violated · 66774 states, 200000 steps, 14 labels · stopped by steps budget · 2658 ms
report: .reachgate/report.md

$ node bin/reachgate.mjs explore examples/dungeon/target.mjs#deep --strategy go-explore
FAIL: 1 invariant violated · 10108 states, 200000 steps, 23 labels · stopped by steps budget · 2759 ms
  ✗ no-softlock: the exit can no longer be reached: the key is stuck in the locked door at (6,8)
    witness (47 steps, 1-minimal): right → right → wait → down → right → wait → right → right → down → right → right → right → right → right → right → right → up → up → right → down → right → right → right → down → right → down → down → down → left → left → down → left → left → left → left → left → up → left → left → left → left → up → left → down → down → wait → up
    replay: reachgate replay examples/dungeon/target.mjs#deep .reachgate/witnesses/no-softlock.json
warning: 4 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
```

BFS runs out of budget at depth 32 and never reaches the well room (no `room:well` label). The BFS
"PASS" here only means nothing was found: the report says it stopped on the step budget, so states
past that were never checked. In CI, `--require-exhaustive` turns a partial pass like this into exit code 3 ("could not measure"), so it can't be mistaken for a proof. Even a 10x budget (2,000,000 steps: 638,404 states, about 48 s and 700 MB in [the benchmark](../../docs/benchmarks.md)) only gets
BFS to depth 41, and it still finds nothing.

Go-Explore works because of `abstract`: the target groups states into coarse **cells**, given by the
room you are in, whether you hold the key, whether the door is open and whether you are hurt. Coins,
the bat and exact positions are left out. Go-Explore keeps one saved state per cell and keeps jumping
back to rarely visited cells to explore from them. So reaching a new chamber counts as progress, and it
can push room by room toward the well. The witness it finds is then shrunk with delta debugging until
no single move can be removed (**1-minimal**). That doesn't make it the shortest: Go-Explore can't
prove that, and reachgate doesn't claim it.

Seeds 1 to 5, each with the same 200,000-step budget. All five find the bug. The numbers are from
`node bench/run.mjs` (median of 3 runs, see [docs/benchmarks.md](../../docs/benchmarks.md)):

| Strategy | Seed | Found? | First violation after | Witness (shrunk from) |
| --- | --- | --- | --- | --- |
| bfs | n/a | no (stopped at depth 32) | n/a | n/a |
| go-explore | 1 | yes | 58,019 steps | 47 (50) |
| go-explore | 2 | yes | 58,447 steps | 45 (51) |
| go-explore | 3 | yes | 86,329 steps | 45 (51) |
| go-explore | 4 | yes | 53,125 steps | 47 (52) |
| go-explore | 5 | yes | 30,994 steps | 43 (52) |

On `#deepFixed`, Go-Explore (seed 1, same budget) reaches every label, including `won`, and reports no
violation.

What this shows, honestly: Go-Explore wins here because the level has an obvious notion of progress
(rooms) that `abstract` can name, and because BFS's exact states multiply with irrelevant detail. On
the small cellar level BFS is the better tool. It is exhaustive in under a second, and its witness is
provably shortest.

## Files

- `game.mjs`: the game (no reachgate code)
- `target.mjs`: the target. `default` is the cellar with the bug, `fixed` the cellar without it,
  `deep` and `deepFixed` are the catacombs
- `bench.json`: the variants `bench/run.mjs` measures
- `../../test/example-dungeon.test.mjs`: tests of the numbers above (13-step shortest witness, the
  fixed game exhausts cleanly, Go-Explore finds the deep bug with a 1-minimal witness and BFS doesn't)
