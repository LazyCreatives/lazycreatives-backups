"""Async pub/sub for streaming scan/backup progress to WebSocket subscribers."""
import asyncio
from typing import Optional

_START = ("scan_start", "backup_start")
_DONE = ("scan_done", "backup_done")


class ProgressHub:
    def __init__(self, history_limit: int = 500):
        self._subscribers: list[asyncio.Queue] = []
        self._history: list[dict] = []
        self._history_limit = history_limit
        self._active = False  # is an operation currently running?
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Record the event loop so worker threads can publish into it."""
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        # Only replay while a run is in progress — so a socket that connects (or
        # reconnects) AFTER a run finished doesn't resurrect a stale "Complete"
        # and re-fire the completion notification.
        if self._active:
            for event in self._history:
                q.put_nowait(event)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    async def publish(self, event: dict) -> None:
        t = event.get("type")
        if t in _START:
            self._history = []  # fresh run -> fresh catch-up history
            self._active = True
        self._record(event)
        for q in list(self._subscribers):
            q.put_nowait(event)
        if t in _DONE:
            self._active = False

    def publish_threadsafe(self, event: dict) -> None:
        """Publish from a non-loop thread (the scan/backup worker)."""
        if self._loop is None:
            raise RuntimeError("ProgressHub.bind_loop must be called first")
        asyncio.run_coroutine_threadsafe(self.publish(event), self._loop)

    def _record(self, event: dict) -> None:
        # Per-item scan ticks are high-volume and pointless to replay; skip them.
        if event.get("type") == "scan_progress":
            return
        self._history.append(event)
        if len(self._history) > self._history_limit:
            self._history = self._history[-self._history_limit:]
