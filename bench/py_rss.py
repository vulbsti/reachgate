"""Run a Python reachgate target and record its peak RSS (KiB) to a file when it exits.

Used by bench/run.mjs: python3 bench/py_rss.py <rss-file> <target.py> [target args...]. The CLI ends the adapter with
SIGTERM right after the shutdown reply, so the RSS is written from a signal handler as well as atexit.
"""
import atexit
import resource
import runpy
import signal
import sys

out, target = sys.argv[1], sys.argv[2]


def record(*_):
    with open(out, "w") as f:
        f.write(str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss))  # KiB on Linux


def on_term(*_):
    record()
    sys.exit(0)


atexit.register(record)
signal.signal(signal.SIGTERM, on_term)
sys.argv = [target, *sys.argv[3:]]  # forward the target's own arguments (e.g. --fixed)
sys.path[0] = target.rsplit("/", 1)[0] if "/" in target else "."
runpy.run_path(target, run_name="__main__")
