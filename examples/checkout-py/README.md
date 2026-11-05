# Example: a checkout service in Python (stdio adapter)

[`checkout.py`](checkout.py) is an ordinary Python checkout service (stdlib only): a cart with two
SKUs (`mug`, `tee`, at most 2 of each), coupons (`SAVE10`, `FREESHIP`), a shipping address step
(domestic / international), card authorization through a payment gateway client, retry after a gateway
timeout, a reconciliation job for timed-out requests, capture, cancel (voids the authorization) and
refund. It has no reachgate code in it.

[`target.py`](target.py) imports it and calls `serve(...)` from the
[stdio adapter](../../adapters/python/reachgate_adapter.py). It plays the shopper, the payment
provider and the reconciliation job. The provider is a fake, `FakeProvider`, that is idempotent like
real ones: a request whose idempotency key it has already seen gets the stored answer. Its responses
are environment actions. `pay approve`, `pay decline` and `pay timeout` say what happens to that
request, and a timeout means the provider approved it but the response was lost, which is the case that
costs money. The state is `{"order": ..., "provider": ...}`, and the money invariants are checked
against the provider's ledger, which says what the card was really charged.

| Invariant | Meaning |
| --- | --- |
| `charged-equals-total` | the card is charged exactly the order total, and only once captured |
| `single-capture` | at most one authorization is captured per order |
| `no-capture-without-auth` | every capture uses an authorization the order saw approved |
| `refund-not-exceeding-capture` | refunds never exceed what was captured |

Labels: `status:<status>`, `coupon:<code>`, `ship:<region>`, `payment:approved|declined|timed_out|voided`,
`payment:retried`, `refund:done`. `is_terminal` is set (cancelled and refunded orders are final), so
reachgate also checks that no order gets stuck with nothing to do (`deadlock`).

## The seeded bug

Checkout 1.3 sent a retry after a timeout as a *new* payment attempt with a new idempotency key
([`checkout.py` line 122](checkout.py#L122)):

```python
attempt = self.order["attempts"][-1]
if self.retry_with_new_key:          # 1.3
    ...
    attempt = self._new_attempt()    # new key: the provider can't tell it's a retry
self._authorize(attempt)
```

The provider had already approved the timed-out request, so it approves the retry too: two
authorizations. When the reconciliation job later learns about the first one, the order holds two
approved attempts, and `capture()` captures every approved attempt (line 145), relying on its
docstring's assumption that there is only ever one. The customer is charged twice.

## Run it

```console
$ node bin/reachgate.mjs explore examples/checkout-py/target.py
FAIL: 2 invariants violated · 4290 states, 5751 steps, 37 labels · state space exhausted · 1569 ms
  ✗ charged-equals-total: card charged 3400 for an order total of 1700
    witness (6 steps, shortest): add_item mug → set_address domestic → pay timeout → retry_payment approve → reconcile → capture
    replay: reachgate replay examples/checkout-py/target.py .reachgate/witnesses/charged-equals-total.json
  ✗ single-capture: 2 authorizations captured for one order
    witness (6 steps, shortest): add_item mug → set_address domestic → pay timeout → retry_payment approve → reconcile → capture
    replay: reachgate replay examples/checkout-py/target.py .reachgate/witnesses/single-capture.json
warning: 192 state(s) that violate an invariant were not explored further, so the invariants reported as holding were only checked on the other states. Fix the violations, or rerun with --expand-violations to check past them.
report: .reachgate/report.md
```

A `.py` target runs through the adapter as `python3 <path to the file>`. `target.py` puts
`adapters/python` on `sys.path` relative to its own location, so it works from any directory.

```console
$ node bin/reachgate.mjs replay examples/checkout-py/target.py .reachgate/witnesses/charged-equals-total.json
replaying 6 step(s) on checkout-py (1.3, retry bug) (recorded violation: charged-equals-total)
  0. initial()
       + status:cart
  1. add_item mug
  2. set_address domestic
       + status:ready
       + ship:domestic
  3. pay timeout
       + status:payment_pending
       + payment:timed_out
  4. retry_payment approve
       + status:authorized
       + payment:approved
       + payment:retried
  5. reconcile
  6. capture
       + status:captured
       ✗ charged-equals-total: card charged 3400 for an order total of 1700
       ✗ single-capture: 2 authorizations captured for one order
REPRODUCED: charged-equals-total at step 6
```

### Why 6 steps is the minimum

BFS finds a shortest witness by construction. By hand: `pay` needs a non-empty cart and an address
(2 steps). The first request must time out (1 step), because `approve` leaves exactly one authorization
and `decline` leaves none. A second authorization needs a retry under a new key (1 step). Capture
only uses attempts the order knows are approved, and the timed-out one stays `timed_out` until the
reconciliation job looks it up (1 step). Then `capture` (1 step). 2 + 1 + 1 + 1 + 1 = 6. Both
invariants break on the same step, so both witnesses are the same trace.

## The fixed version

```console
$ node bin/reachgate.mjs explore --cmd "python3 examples/checkout-py/target.py --fixed"
PASS: 0 invariants violated · 1170 states, 2295 steps, 37 labels · state space exhausted · 852 ms
report: .reachgate/report.md
```

With `--fixed`, a retry re-sends the timed-out attempt under its original key. The provider answers
from its record, so there is one authorization whatever the network does. All 1170 reachable states
were visited (`state space exhausted`), so every path, including decline then pay again, timeout then
cancel, and capture then refund, keeps the four money invariants and never deadlocks.

## Tests

[`test/example-checkout-py.test.mjs`](../../test/example-checkout-py.test.mjs) drives the Python
target through `adapterDriver(['python3', 'examples/checkout-py/target.py', ...])`. It checks the
6-step witness and its replay, that `--fixed` exhausts 1170 states with no violation, and the CLI end to
end (exit code 1, report and witness files written to `--out`).
