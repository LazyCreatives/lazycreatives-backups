"""Async pub/sub for streaming backup progress to WebSocket subscribers."""
import asyncio
from typing import Optional


class ProgressHub:
    def __init__(self, history_limit: int = 500):
        self._subscribers: list[asyncio.Queue] = []
        self._history: list[dict] = []
        self._history_limit = history_limit
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Record the event loop so worker threads can publish into it."""
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        for event in self._history:  # replay so late subscribers catch up
            q.put_nowait(event)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    async def publish(self, event: dict) -> None:
        self._record(event)
        for q in list(self._subscribers):
            q.put_nowait(event)

    def publish_threadsafe(self, event: dict) -> None:
        """Publish from a non-loop thread (the backup worker)."""
        if self._loop is None:
            raise RuntimeError("ProgressHub.bind_loop must be called first")
        asyncio.run_coroutine_threadsafe(self.publish(event), self._loop)

    def _record(self, event: dict) -> None:
        self._history.append(event)
        if len(self._history) > self._history_limit:
            self._history = self._history[-self._history_limit:]
