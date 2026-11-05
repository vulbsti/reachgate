# Adapter protocol (v1)

A target written in any language plugs into reachgate as a child process that speaks **JSON Lines over
stdio**: reachgate writes one JSON request per line to the adapter's stdin, and the adapter writes one
JSON response per line to its stdout. Anything else the adapter prints must go to stderr. reachgate
keeps the last 4 KB of stderr and shows it if the adapter dies; set `REACHGATE_ADAPTER_STDERR=1` to
stream it.

```bash
reachgate explore my_target.py                       # .py files are run with python3
reachgate explore --cmd "ruby my_target.rb"          # any other language
reachgate explore --cmd "go run ./cmd/reachgate-target"
```

For Python there is a zero-dependency helper, [`adapters/python/reachgate_adapter.py`](../adapters/python/reachgate_adapter.py).
`reachgate init --lang python` copies it into your project.

## The adapter is stateless

reachgate owns every state. Each request carries the full state as JSON, and the adapter answers from
that state alone. That has three consequences:

- States and actions **must be JSON values** (objects, arrays, strings, finite numbers, booleans, null).
- Go-Explore can restore any archived state for free, without a snapshot API in your language.
- An adapter could be restarted mid-search without losing anything. reachgate doesn't do that yet:
  today a dead adapter ends the run with exit code 3. A restart policy is on the roadmap.

## Messages

Requests: `{"id": <int>, "method": <string>, "params": <object>}`.
Responses: `{"id": <same int>, "result": <object>}` or `{"id": <same int>, "error": {"message": <string>}}`.
reachgate sends one request at a time and waits for its answer (default timeout 30 s per request).

### `hello`

Sent once at start-up.

```json
→ {"id":1,"method":"hello","params":{"protocol":1}}
← {"id":1,"result":{"protocol":1,"name":"checkout","invariants":["single-capture"],"transitions":[],"deadlock":false,"describe":{"single-capture":"an order is captured at most once"}}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `protocol` | yes | Must be `1`. Any other value stops reachgate with exit code 3. |
| `name` | no | The name shown in reports. |
| `invariants`, `transitions` | no | Ids of the state and transition invariants, listed in reports even while they hold. |
| `deadlock` | no | `true` if `visit` reports `terminal`, which turns on deadlock detection. |
| `describe` | no | Map of invariant id to a sentence explaining it. |

### `initial`

```json
→ {"id":2,"method":"initial","params":{}}
← {"id":2,"result":{"state":{"cart":{},"step":"cart"}}}
```

`initial` must return the same state every time. An `error` reply here is fatal (exit 3).

### `visit`

Called for each new state reachgate reaches. One round trip returns everything reachgate needs to
know about that state.

```json
→ {"id":3,"method":"visit","params":{"state":{"cart":{},"step":"cart"}}}
← {"id":3,"result":{
     "actions":[{"action":{"type":"add","sku":"tea"},"label":"add tea"}, {"type":"checkout"}],
     "violations":[{"id":"single-capture","message":"captured twice: 2 x 9.00"}],
     "labels":["step:cart"],
     "hash":"optional exact identity",
     "cell":"optional Go-Explore cell",
     "terminal":false}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `actions` | yes | Everything that can happen in this state. Each entry is either a plain JSON action, or `{"action": <json>, "label": <string>}` to control how it prints. |
| `violations` | no | State invariants that fail here, as `{id, message}`. |
| `labels` | no | Strings naming behaviour in this state; the baseline tracks which ones are reachable. |
| `hash` | no | Exact identity, used for dedupe. Default: SHA-1 of the canonical JSON of the state, the same in every language. |
| `cell` | no | Coarse cell for Go-Explore's archive. Default: `hash`. |
| `terminal` | no | With `deadlock: true`, a non-terminal state with no actions is a `deadlock` violation. |

An `error` reply to `visit` is recorded as a `no-crash` violation at that state, with a witness.

### `step`

```json
→ {"id":4,"method":"step","params":{"state":{...},"action":{"type":"add","sku":"tea"}}}
← {"id":4,"result":{"state":{...},"violations":[]}}
```

`violations` here are transition invariants, checked on `(previous state, action, next state)`.
An `error` reply means your code threw: it is recorded as a `no-crash` violation, and its witness ends
with this action. It does not stop the search.

### `shutdown`

```json
→ {"id":9,"method":"shutdown","params":{}}
← {"id":9,"result":{}}
```

The adapter should exit after answering. reachgate kills it after 500 ms either way.

## What counts as an adapter failure (exit code 3)

reachgate treats these as "could not measure", never as a pass:

- the process can't be started, or exits while reachgate is waiting for an answer;
- it writes a stdout line that isn't JSON;
- `hello` reports a protocol other than 1, or `initial` returns an error;
- a request goes unanswered past the timeout.

## Writing an adapter in another language

The Python helper is about 150 lines and makes a good template. A minimal adapter loop, in pseudocode:

```
for line in stdin:
    req = json.parse(line)
    switch req.method:
      "hello":    reply {protocol: 1, name, invariants: [...ids]}
      "initial":  reply {state: initial()}
      "visit":    s = req.params.state
                  reply {actions: affordances(s), violations: check(s), labels: observe(s)}
      "step":     try reply {state: step(req.params.state, req.params.action)}
                  catch e: reply error {message: str(e)}
      "shutdown": reply {}; exit
    flush stdout after every reply
```

Make sure your JSON encoder writes no `NaN` or `Infinity` (they aren't JSON), and that your code's own
logging goes to stderr.
