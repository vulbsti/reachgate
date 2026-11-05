"""Checkout service: cart, coupon, shipping address, card authorization, capture, cancel and refund.

An order is a plain dict (what the orders table stores). Checkout wraps one order plus a payment
gateway client and enforces the flow:

    cart -> ready (address set) -> authorized -> captured -> refunded
                      |   ^             ^
                      v   | pay again   |
                    declined      payment_pending (gateway timed out)
    any status before captured -> cancelled

The cart is locked once the first payment attempt starts.

A gateway timeout is ambiguous: the provider may have approved the charge and only the response was
lost. So after a timeout the order waits in payment_pending until a retry or the reconciliation job
(reconcile()) finds out what happened.

`retry_with_new_key=True` reproduces checkout 1.3, where retry_payment() sent the retry under a new
idempotency key.
"""

CATALOG = {"mug": 1200, "tee": 2500}  # prices in cents
MAX_QTY = 2
COUPONS = {"SAVE10": "10% off items", "FREESHIP": "free shipping"}
SHIPPING = {"domestic": 500, "international": 1500}
MAX_PAYMENT_ATTEMPTS = 3

EDITABLE = ("cart", "ready")


class GatewayTimeout(Exception):
    """The gateway did not answer in time. The request may or may not have been processed."""


class CheckoutError(Exception):
    """The requested operation is not allowed in the order's current state."""


def new_order(order_id):
    return {
        "id": order_id,
        "status": "cart",
        "items": {sku: 0 for sku in CATALOG},
        "coupon": None,
        "region": None,
        "attempts": [],  # one per authorization request: {key, amount, status, authorization_id}
        "captured": [],  # {authorization_id, amount}
        "refunded": 0,
    }


def subtotal(order):
    return sum(CATALOG[sku] * qty for sku, qty in order["items"].items())


def total(order):
    items = subtotal(order)
    if order["coupon"] == "SAVE10":
        items = items * 90 // 100
    shipping = 0 if order["coupon"] == "FREESHIP" or order["region"] is None else SHIPPING[order["region"]]
    return items + shipping


class Checkout:
    """`gateway` provides authorize(amount, idempotency_key), lookup(idempotency_key),
    capture(authorization_id, amount), void(authorization_id) and refund(authorization_id, amount).
    authorize/lookup return {"result": "approved", "authorization_id": ...} or {"result": "declined"};
    authorize may raise GatewayTimeout."""

    def __init__(self, order, gateway, *, retry_with_new_key=False):
        self.order = order
        self.gateway = gateway
        self.retry_with_new_key = retry_with_new_key

    # --- cart -----------------------------------------------------------------------------------
    def add_item(self, sku):
        self._require(*EDITABLE)
        if sku not in CATALOG:
            raise CheckoutError(f"unknown sku {sku}")
        if self.order["items"][sku] >= MAX_QTY:
            raise CheckoutError(f"at most {MAX_QTY} of {sku}")
        self.order["items"][sku] += 1

    def remove_item(self, sku):
        self._require(*EDITABLE)
        if self.order["items"].get(sku, 0) == 0:
            raise CheckoutError(f"{sku} is not in the cart")
        self.order["items"][sku] -= 1

    def apply_coupon(self, code):
        self._require(*EDITABLE)
        if code not in COUPONS:
            raise CheckoutError(f"unknown coupon {code}")
        self.order["coupon"] = code  # one coupon per order: a new one replaces the old

    def remove_coupon(self):
        self._require(*EDITABLE)
        self.order["coupon"] = None

    def set_address(self, region):
        self._require(*EDITABLE)
        if region not in SHIPPING:
            raise CheckoutError(f"we don't ship to {region}")
        self.order["region"] = region
        self.order["status"] = "ready"

    # --- payment --------------------------------------------------------------------------------
    def pay(self):
        """Authorize the order total. The cart is locked from here on."""
        self._require("ready", "declined")
        if subtotal(self.order) == 0:
            raise CheckoutError("the cart is empty")
        if len(self.order["attempts"]) >= MAX_PAYMENT_ATTEMPTS:
            raise CheckoutError("too many payment attempts")
        self._authorize(self._new_attempt())

    def retry_payment(self):
        """Ask the gateway again after a timeout. The retry must carry the same idempotency key, so a
        request the provider did process is answered from its record instead of charged twice."""
        self._require("payment_pending")
        attempt = self.order["attempts"][-1]
        if self.retry_with_new_key:
            if len(self.order["attempts"]) >= MAX_PAYMENT_ATTEMPTS:
                raise CheckoutError("too many payment attempts")
            attempt = self._new_attempt()
        self._authorize(attempt)

    def reconcile(self):
        """Background job: ask the gateway what happened to requests that timed out."""
        for attempt in self.order["attempts"]:
            if attempt["status"] != "timed_out":
                continue
            answer = self.gateway.lookup(attempt["key"])
            if answer is None:
                continue
            self._record(attempt, answer)
        unresolved = any(a["status"] == "timed_out" for a in self.order["attempts"])
        if self.order["status"] == "payment_pending" and not unresolved:
            self.order["status"] = "authorized" if self._approved() else "declined"

    def capture(self):
        """Capture the authorized amount. An order holds one approved authorization: a declined attempt
        leaves none behind, and a retry reuses the attempt that timed out."""
        self._require("authorized")
        for attempt in self._approved():
            self.gateway.capture(attempt["authorization_id"], attempt["amount"])
            capture = {"authorization_id": attempt["authorization_id"], "amount": attempt["amount"]}
            self.order["captured"].append(capture)
        self.order["status"] = "captured"

    def cancel(self):
        self._require("cart", "ready", "declined", "payment_pending", "authorized")
        if self.order["status"] == "payment_pending":
            self.reconcile()  # find out whether a timed-out request holds money before releasing it
        for attempt in self._approved():
            self.gateway.void(attempt["authorization_id"])
            attempt["status"] = "voided"
        self.order["status"] = "cancelled"

    def refund(self):
        self._require("captured")
        for capture in self.order["captured"]:
            self.gateway.refund(capture["authorization_id"], capture["amount"])
            self.order["refunded"] += capture["amount"]
        self.order["status"] = "refunded"

    # --- helpers --------------------------------------------------------------------------------
    def _require(self, *statuses):
        if self.order["status"] not in statuses:
            raise CheckoutError(f"not allowed while the order is {self.order['status']}")

    def _new_attempt(self):
        n = len(self.order["attempts"]) + 1
        key = f"{self.order['id']}-pay-{n}"
        attempt = {"key": key, "amount": total(self.order), "status": "pending", "authorization_id": None}
        self.order["attempts"].append(attempt)
        return attempt

    def _authorize(self, attempt):
        try:
            answer = self.gateway.authorize(attempt["amount"], attempt["key"])
        except GatewayTimeout:
            attempt["status"] = "timed_out"
            self.order["status"] = "payment_pending"
            return
        self._record(attempt, answer)
        self.order["status"] = "authorized" if answer["result"] == "approved" else "declined"

    @staticmethod
    def _record(attempt, answer):
        if answer["result"] == "approved":
            attempt["status"] = "approved"
            attempt["authorization_id"] = answer["authorization_id"]
        else:
            attempt["status"] = "declined"

    def _approved(self):
        return [a for a in self.order["attempts"] if a["status"] == "approved"]
