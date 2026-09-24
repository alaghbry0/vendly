#!/usr/bin/env python3
"""Launch the Vendly dev server as a fully-detached daemon (double-fork)."""
import os
import sys

PROJECT = "/home/z/my-project"

# double-fork daemonize: parent exits immediately, grandchild is reparented
# to init (PPID 1) in its own session — survives the tool-session teardown.
pid = os.fork()
if pid > 0:
    sys.exit(0)

os.setsid()

pid2 = os.fork()
if pid2 > 0:
    sys.exit(0)

devnull = os.open(os.devnull, os.O_RDWR)
os.dup2(devnull, 0)
os.dup2(devnull, 1)
os.dup2(devnull, 2)
os.close(devnull)

os.chdir(PROJECT)

with open("/home/z/my-project/.zscripts/dev.pid", "w") as f:
    f.write(str(os.getpid()))

os.execvp("bun", ["bun", "run", "dev"])
