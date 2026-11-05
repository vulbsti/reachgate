"""reachgate stdio adapter for Python targets. Zero dependencies: copy this one file next to your target.

    from reachgate_adapter import serve

    def initial(): return {"n": 0}
    def affordances(s): return [{"type": "inc"}] if s["n"] < 3 else []
    def step(s, a): return {"n": s["n"] + 1}

    serve(name="counter", initial=initial, affordances=affordances, step=step,
          invariants={"small": lambda s: s["n"] <= 3})

Run with `reachgate explore my_target.py` (or `--cmd "python3 my_target.py"`).

Protocol (JSON Lines on stdin/stdout, one request per line, see docs/protocol.md):
    {"id": 1, "method": "hello", "params": {"protocol": 1}}
    {"id": 2, "method": "initial"}
    {"id": 3, "method": "visit", "params": {"state": ...}}
    {"id": 4, "method": "step",  "params": {"state": ..., "action": ...}}
    {"id": 5, "method": "shutdown"}
The adapter is stateless: every request carries the full state, so states must be JSON values.
Anything your code prints goes to stderr, never stdout, so it cannot corrupt the protocol.
"""

import json
import sys
import traceback

PROTOCOL = 1


def _judge(result):
    """True/None = holds; False = violated; str = violated with that message; (ok, msg) also accepted."""
    if result is True or result is None:
        return None
    if result is False:
        return ""
    if isinstance(result, str):
        return result
    if isinstance(result, tuple) and len(result) == 2:
        return None if result[0] else str(result[1])
    return None if result else ""


def _check(table, args):
    out = []
    for name, fn in (table or {}).items():
        try:
            msg = _judge(fn(*args))
        except Exception as e:  # an invariant that throws is reported, not swallowed
            msg = f"the invariant itself threw: {e!r}"
        if msg is not None:
            out.append({"id": name, "message": msg})
    return out


def serve(*, initial, affordances, step, invariants=None, transitions=None, observe=None,
          hash=None, abstract=None, is_terminal=None, label=None, name="python-target", describe=None):
    """Answer reachgate requests on stdin/stdout until shutdown or EOF."""
    out = sys.stdout
    sys.stdout = sys.stderr  # user prints can't corrupt the protocol stream

    def reply(rid, result=None, error=None):
        msg = {"id": rid, "error": error} if error is not None else {"id": rid, "result": result}
        out.write(json.dumps(msg, separators=(",", ":"), allow_nan=False) + "\n")
        out.flush()

    def visit(s):
        violations = []
        try:
            actions = list(affordances(s) or [])
        except Exception as e:
            return {"actions": [], "violations": [{"id": "no-crash", "message": f"affordances() raised {e!r}"}],
                    "labels": [], "terminal": True}
        violations += _check(invariants, (s,))
        terminal = False
        if is_terminal is not None:
            try:
                terminal = bool(is_terminal(s))
            except Exception as e:
                violations.append({"id": "no-crash", "message": f"is_terminal() raised {e!r}"})
            if not terminal and not actions:
                violations.append({"id": "deadlock", "message": "no action is possible and the state is not terminal"})
        labels = []
        if observe is not None:
            try:
                labels = [str(x) for x in (observe(s) or [])]
            except Exception as e:
                violations.append({"id": "no-crash", "message": f"observe() raised {e!r}"})
        res = {"actions": [{"action": a, "label": str(label(a))} for a in actions] if label else actions,
               "violations": violations, "labels": labels, "terminal": terminal}
        if hash is not None:
            res["hash"] = hash(s)
        if abstract is not None:
            res["cell"] = abstract(s)
        return res

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            reply(None, error={"message": "request is not JSON"})
            continue
        rid, method, p = req.get("id"), req.get("method"), req.get("params") or {}
        try:
            if method == "hello":
                reply(rid, {"protocol": PROTOCOL, "name": name, "invariants": list((invariants or {}).keys()),
                            "transitions": list((transitions or {}).keys()), "deadlock": is_terminal is not None,
                            "describe": describe or {}})
            elif method == "initial":
                reply(rid, {"state": initial()})
            elif method == "visit":
                reply(rid, visit(p["state"]))
            elif method == "step":
                s, a = p["state"], p["action"]
                prev = json.loads(json.dumps(s))  # step may mutate; transitions see the state before
                try:
                    nxt = step(s, a)
                except Exception as e:
                    tb = traceback.format_exc(limit=3).strip().splitlines()[-1]
                    reply(rid, error={"message": f"step({json.dumps(a)}) raised {e!r} ({tb})"})
                    continue
                if nxt is None:
                    reply(rid, error={"message": f"step({json.dumps(a)}) returned None (return the new state)"})
                    continue
                reply(rid, {"state": nxt, "violations": _check(transitions, (prev, a, nxt))})
            elif method == "shutdown":
                reply(rid, {})
                return
            else:
                reply(rid, error={"message": f"unknown method {method!r}"})
        except Exception as e:
            reply(rid, error={"message": f"{method} failed: {e!r}"})
