"""
Sliding-window rate limiter for Groq API calls.

Groq free-tier limits (conservative baseline):
  whisper-large-v3        : 20 requests / minute
  chat analysis model     : 30 requests / minute
    (openai/gpt-oss-120b — replaced llama-3.3-70b, decommissioned 2026-08-16)

Each limiter pre-emptively blocks before a request is sent, so we never
hit a 429 under normal single-job operation. If a 429 arrives anyway
(e.g. two jobs running in parallel), the retry wrapper cycles through
all configured API keys before waiting and retrying.
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

# ── Multi-key rotation ────────────────────────────────────────────────────────
_keys: list[str] = []
_key_idx: int = 0


def set_groq_keys(keys: list[str]) -> None:
    """Call once at startup with all available GROQ_API_KEY* values."""
    global _keys, _key_idx
    _keys = [k for k in keys if k]
    _key_idx = 0


def get_groq_key() -> str:
    """Return the currently active API key."""
    if not _keys:
        return ""
    return _keys[_key_idx % len(_keys)]


def _advance_groq_key() -> bool:
    """Rotate to the next key. Returns True if all keys have been cycled once."""
    global _key_idx
    _key_idx += 1
    return len(_keys) > 0 and (_key_idx % len(_keys)) == 0


async def groq_with_retry(coro_fn, limiter: _SlidingWindowLimiter,
                           log_fn=None, max_retries: int = 4):
    """
    Acquire a rate-limit slot, call coro_fn(), and retry on 429.

    On each 429 the active key advances to the next one. Only when all keys
    have been exhausted does the wrapper wait 60 s before the next round.

    coro_fn  — async callable that makes the Groq API call (calls get_groq_key()
               internally so it always uses the current active key)
    limiter  — whisper_limiter or llama_limiter
    log_fn   — optional callable(str) for progress messages
    """
    n = max(1, len(_keys))
    total = max_retries * n

    for attempt in range(total):
        await limiter.acquire()
        try:
            return await coro_fn()
        except _groq_sdk.RateLimitError:
            exhausted = _advance_groq_key()
            if exhausted:
                wait = 60
                msg = f"All {n} Groq key(s) rate limited — waiting {wait}s (retry {attempt // n + 1}/{max_retries})"
                if log_fn:
                    log_fn(msg)
                else:
                    print(msg, flush=True)
                await asyncio.sleep(wait)
            else:
                active = _key_idx % n
                msg = f"Groq key {active} rate limited — switching to key {active + 1}/{n}"
                if log_fn:
                    log_fn(msg)
                else:
                    print(msg, flush=True)

    raise RuntimeError(f"Groq rate limit exceeded after {max_retries} rounds across {n} key(s)")
