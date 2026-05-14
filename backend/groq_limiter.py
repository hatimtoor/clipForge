"""
Sliding-window rate limiter for Groq API calls.

Groq free-tier limits (conservative baseline):
  whisper-large-v3        : 20 requests / minute
  llama-3.3-70b-versatile : 30 requests / minute

Each limiter pre-emptively blocks before a request is sent, so we never
hit a 429 under normal single-job operation. If a 429 arrives anyway
(e.g. two jobs running in parallel), the retry wrapper backs off and retries.
"""
import asyncio
import time
from collections import deque

import groq as _groq_sdk


class _SlidingWindowLimiter:
    """Counts requests inside a rolling 60-second window and waits when full."""

    def __init__(self, rpm: int):
        self.rpm     = rpm
        self._window = 60.0          # seconds
        self._calls: deque = deque() # monotonic timestamps of recent calls
        self._lock: asyncio.Lock | None = None   # created lazily inside the loop

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def acquire(self):
        """Block until a request slot is available, then claim it."""
        async with self._get_lock():
            while True:
                now = time.monotonic()
                # Drop timestamps that have aged out of the window
                while self._calls and now - self._calls[0] >= self._window:
                    self._calls.popleft()

                if len(self._calls) < self.rpm:
                    self._calls.append(now)
                    return

                # Sleep until the oldest call falls out of the window
                sleep_for = self._window - (now - self._calls[0]) + 0.1
                await asyncio.sleep(sleep_for)


# One limiter per Groq API surface
whisper_limiter = _SlidingWindowLimiter(rpm=20)   # whisper-large-v3
llama_limiter   = _SlidingWindowLimiter(rpm=30)   # llama-3.x chat


async def groq_with_retry(coro_fn, limiter: _SlidingWindowLimiter,
                           log_fn=None, max_retries: int = 4):
    """
    Acquire a rate-limit slot, call coro_fn(), and retry on 429.

    coro_fn  — async callable that makes the Groq API call and returns its result
    limiter  — whisper_limiter or llama_limiter
    log_fn   — optional callable(str) for progress messages
    """
    for attempt in range(max_retries):
        await limiter.acquire()
        try:
            return await coro_fn()
        except _groq_sdk.RateLimitError:
            wait = 60 * (attempt + 1)
            msg  = f"Groq rate limit hit — waiting {wait}s before retry {attempt + 1}/{max_retries}"
            if log_fn:
                log_fn(msg)
            else:
                print(msg, flush=True)
            await asyncio.sleep(wait)

    raise RuntimeError(f"Groq rate limit exceeded after {max_retries} retries")
