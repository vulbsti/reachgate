"""reachgate target in Python: describe your real code so reachgate can explore it.
Replace the toy door below with imports of your own code. States and actions must be JSON values.
Run: reachgate explore reachgate_target.py
Docs: https://github.com/vulbsti/reachgate/blob/main/docs/wire-in-15-minutes.md
"""
from reachgate_adapter import serve


# --- your code (normally imported, e.g. `from myapp.store import reducer, initial_state`) ---
def reducer(s, a):
    t = a["type"]
    if t == "open":
        return {**s, "door": "open"}
    if t == "close":
        return {**s, "door": "closed"}
    if t == "lock":
        return {**s, "locked": True}
    if t == "unlock":
        return {**s, "locked": False}
    return s


def affordances(s):
    acts = []
    if s["door"] == "closed" and not s["locked"]:
        acts.append({"type": "open"})
    if s["door"] == "open":
        acts.append({"type": "close"})
    acts.append({"type": "unlock"} if s["locked"] else {"type": "lock"})
    return acts


serve(
    name="door",
    initial=lambda: {"door": "closed", "locked": False},
    affordances=affordances,
    step=reducer,
    invariants={
        "open-door-is-unlocked": lambda s: s["door"] == "closed" or not s["locked"] or "the door is open and locked",
    },
    observe=lambda s: [f"door:{s['door']}"] + (["locked"] if s["locked"] else []),
    label=lambda a: a["type"],
)
