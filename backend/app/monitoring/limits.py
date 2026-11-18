"""In-memory event rate limiting per candidate (development MVP; resets on restart)."""

from __future__ import annotations

import threading
import time
from collections import deque


class EventRateLimiter:
    """Allows at most ``max_events`` per ``window_seconds`` for each key."""

    def __init__(self, max_events: int, window_seconds: int = 60) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[tuple[float, int]]] = {}
        self._lock = threading.Lock()

    def try_consume(self, key: str, count: int) -> int | None:
        """Record ``count`` events. Returns None if allowed, else seconds to wait."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0][0] >= self.window_seconds:
                hits.popleft()
            used = sum(n for _, n in hits)
            if used + count > self.max_events:
                oldest = hits[0][0] if hits else now
                return max(1, int(self.window_seconds - (now - oldest)) + 1)
            hits.append((now, count))
            return None
