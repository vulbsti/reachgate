"""reachgate target for checkout.py. checkout.py knows nothing about reachgate; this file plays the
shopper, the payment provider and the reconciliation job, and says what must always be true.

    node bin/reachgate.mjs explore examples/checkout-py/target.py                  # checkout 1.3 (bug)
    node bin/reachgate.mjs explore --cmd "python3 examples/checkout-py/target.py --fixed"

The state is {"order": <the order dict>, "provider": <the provider's own ledger>}: the provider's ledger
is the truth about what the card was charged, so the money invariants are checked against it.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "adapters", "python"))

from checkout import (  # noqa: E402
    CATALOG,
    COUPONS,
    EDITABLE,
    MAX_PAYMENT_ATTEMPTS,
    MAX_QTY,
    SHIPPING,
    Checkout,
    GatewayTimeout,
    new_order,
    total,
)
from reachgate_adapter import serve  # noqa: E402

FIXED = "--fixed" in sys.argv[1:]
OUTCOMES = ("approve", "decline", "timeout")


class FakeProvider:
    """An idempotent payment provider. `outcome` is what the network and the issuing bank do with the
    next new request: approve it, decline it, or approve it and lose the response (a timeout).
    A request whose idempotency key the provider has seen is answered from its record."""

    def __init__(self, ledger, outcome=None):
        self.ledger = ledger
        self.outcome = outcome

    def authorize(self, amount, idempotency_key):
        known = self.ledger["requests"].get(idempotency_key)
        if known is None:
            if self.outcome == "decline":
                known = {"result": "declined"}
            else:
                auth_id = f"auth-{len(self.ledger['auths']) + 1}"
                self.ledger["auths"][auth_id] = {"amount": amount, "state": "authorized", "captured": 0, "refunded": 0}
                known = {"result": "approved", "authorization_id": auth_id}
            self.ledger["requests"][idempotency_key] = known
        if self.outcome == "timeout":
            raise GatewayTimeout(idempotency_key)
        return dict(known)

    def lookup(self, idempotency_key):
        known = self.ledger["requests"].get(idempotency_key)
        return dict(known) if known else None

    def capture(self, authorization_id, amount):
        auth = self.ledger["auths"][authorization_id]
        if auth["state"] != "authorized" or amount > auth["amount"]:
            raise RuntimeError(f"provider rejects capture of {authorization_id} ({auth['state']})")
        auth["state"], auth["captured"] = "captured", amount

    def void(self, authorization_id):
        auth = self.ledger["auths"][authorization_id]
        if auth["state"] == "authorized":
            auth["state"] = "voided"

    def refund(self, authorization_id, amount):
        auth = self.ledger["auths"][authorization_id]
        if amount > auth["captured"] - auth["refunded"]:
            raise RuntimeError(f"provider rejects refund of {amount} on {authorization_id}")
        auth["refunded"] += amount
        auth["state"] = "refunded"


def initial():
    return {"order": new_order("ord-1"), "provider": {"requests": {}, "auths": {}}}


def affordances(s):
    o = s["order"]
    acts = []
    if o["status"] in EDITABLE:
        for sku in CATALOG:
            if o["items"][sku] < MAX_QTY:
                acts.append({"type": "add_item", "sku": sku})
            if o["items"][sku] > 0:
                acts.append({"type": "remove_item", "sku": sku})
        for code in COUPONS:
            if o["coupon"] != code:
                acts.append({"type": "apply_coupon", "code": code})
        if o["coupon"]:
            acts.append({"type": "remove_coupon"})
        for region in SHIPPING:
            if o["region"] != region:
                acts.append({"type": "set_address", "region": region})
    if o["status"] in ("ready", "declined") and any(o["items"].values()) and len(o["attempts"]) < MAX_PAYMENT_ATTEMPTS:
        acts += [{"type": "pay", "outcome": x} for x in OUTCOMES]
    if o["status"] == "payment_pending":
        # 1.3 opens a new attempt per retry, so it runs into the attempt limit; the fix reuses the attempt.
        if FIXED or len(o["attempts"]) < MAX_PAYMENT_ATTEMPTS:
            acts += [{"type": "retry_payment", "outcome": x} for x in OUTCOMES]
    if any(a["status"] == "timed_out" for a in o["attempts"]):
        acts.append({"type": "reconcile"})
    if o["status"] == "authorized":
        acts.append({"type": "capture"})
    if o["status"] in ("cart", "ready", "declined", "payment_pending", "authorized"):
        acts.append({"type": "cancel"})
    if o["status"] == "captured":
        acts.append({"type": "refund"})
    return acts


def step(s, a):
    checkout = Checkout(s["order"], FakeProvider(s["provider"], a.get("outcome")), retry_with_new_key=not FIXED)
    t = a["type"]
    if t == "add_item":
        checkout.add_item(a["sku"])
    elif t == "remove_item":
        checkout.remove_item(a["sku"])
    elif t == "apply_coupon":
        checkout.apply_coupon(a["code"])
    elif t == "remove_coupon":
        checkout.remove_coupon()
    elif t == "set_address":
        checkout.set_address(a["region"])
    elif t == "pay":
        checkout.pay()
    elif t == "retry_payment":
        checkout.retry_payment()
    elif t == "reconcile":
        checkout.reconcile()
    elif t == "capture":
        checkout.capture()
    elif t == "cancel":
        checkout.cancel()
    elif t == "refund":
        checkout.refund()
    else:
        raise ValueError(f"unknown action {t}")
    return s


def charged(s):
    return sum(a["captured"] for a in s["provider"]["auths"].values())


def charged_equals_total(s):
    o = s["order"]
    if o["status"] not in ("captured", "refunded"):
        return charged(s) == 0 or f"card charged {charged(s)} before capture"
    return charged(s) == total(o) or f"card charged {charged(s)} for an order total of {total(o)}"


def single_capture(s):
    n = sum(1 for a in s["provider"]["auths"].values() if a["captured"])
    return n <= 1 or f"{n} authorizations captured for one order"


def no_capture_without_auth(s):
    approved = {a["authorization_id"] for a in s["order"]["attempts"] if a["status"] == "approved"}
    for c in s["order"]["captured"]:
        if c["authorization_id"] not in approved:
            return f"captured {c['authorization_id']}, which the order never saw approved"
    return True


def refund_not_exceeding_capture(s):
    refunded = sum(a["refunded"] for a in s["provider"]["auths"].values())
    return refunded <= charged(s) or f"refunded {refunded} of {charged(s)} captured"


def observe(s):
    o = s["order"]
    out = [f"status:{o['status']}"]
    if o["coupon"]:
        out.append(f"coupon:{o['coupon']}")
    if o["region"]:
        out.append(f"ship:{o['region']}")
    statuses = {a["status"] for a in o["attempts"]}
    out += [f"payment:{x}" for x in sorted(statuses)]
    if len(o["attempts"]) >= 2:
        out.append("payment:retried")
    if o["refunded"]:
        out.append("refund:done")
    return out


def label(a):
    return " ".join(str(a[k]) for k in ("type", "sku", "code", "region", "outcome") if k in a)


serve(
    name="checkout-py (fixed)" if FIXED else "checkout-py (1.3, retry bug)",
    initial=initial,
    affordances=affordances,
    step=step,
    invariants={
        "charged-equals-total": charged_equals_total,
        "single-capture": single_capture,
        "no-capture-without-auth": no_capture_without_auth,
        "refund-not-exceeding-capture": refund_not_exceeding_capture,
    },
    describe={
        "charged-equals-total": "the card is charged exactly the order total, and only once captured",
        "single-capture": "at most one authorization is captured per order",
        "no-capture-without-auth": "every capture uses an authorization the order saw approved",
        "refund-not-exceeding-capture": "refunds never exceed what was captured",
    },
    observe=observe,
    is_terminal=lambda s: s["order"]["status"] in ("cancelled", "refunded"),
    label=label,
)
