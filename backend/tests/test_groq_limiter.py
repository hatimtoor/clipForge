"""
groq_limiter retry behavior.
Covers retry-after parsing and the daily-quota fail-fast (no real API calls).
"""
import asyncio

import pytest

import groq_limiter
from groq_limiter import _parse_retry_after, groq_with_retry, set_groq_keys


# ── retry-after parsing ───────────────────────────────────────────────────────

@pytest.mark.parametrize("msg,expected", [
    ("Rate limit reached. Please try again in 47m12.3s.", 47 * 60 + 12.3),
    ("Please try again in 1h2m", 3720),
    ("Please try again in 7.5s", 7.5),
    ("Please try again in 2h", 7200),
    ("no hint here", None),
    ("", None),
])
def test_parse_retry_after(msg, expected):
    assert _parse_retry_after(msg) == expected


# ── daily-quota fail-fast ─────────────────────────────────────────────────────

class _FakeRateLimitError(Exception):
    pass


class _NoWaitLimiter:
    async def acquire(self):
        pass


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _patch(monkeypatch):
    # groq_with_retry catches groq.RateLimitError — substitute our fake
    monkeypatch.setattr(groq_limiter._groq_sdk, "RateLimitError", _FakeRateLimitError)
    set_groq_keys(["k1", "k2", "k3"])
    yield
    set_groq_keys([])


def test_daily_quota_fails_fast_without_60s_waits():
    """All keys reporting hour-scale waits → raise immediately, never sleep."""
    async def call():
        raise _FakeRateLimitError("Please try again in 47m12s")

    async def no_sleep(_):
        raise AssertionError("should not wait when quota is daily-exhausted")

    async def wrapped():
        orig = asyncio.sleep
        asyncio.sleep = no_sleep
        try:
            with pytest.raises(RuntimeError, match="daily token quota exhausted"):
                await groq_with_retry(call, _NoWaitLimiter())
        finally:
            asyncio.sleep = orig

    _run(wrapped())


def test_short_wait_keeps_retrying_and_recovers():
    """Per-minute 429s (short waits) still retry and can succeed."""
    calls = {"n": 0}

    async def call():
        calls["n"] += 1
        if calls["n"] <= 3:  # first round: all 3 keys 429 with a short wait
            raise _FakeRateLimitError("Please try again in 2.5s")
        return "ok"

    async def wrapped():
        orig = asyncio.sleep
        async def fast(_):
            pass
        asyncio.sleep = fast
        try:
            return await groq_with_retry(call, _NoWaitLimiter())
        finally:
            asyncio.sleep = orig

    assert _run(wrapped()) == "ok"


def test_unparsable_429_still_retries():
    """A 429 without a wait hint must not trigger the daily fail-fast."""
    calls = {"n": 0}

    async def call():
        calls["n"] += 1
        if calls["n"] <= 4:
            raise _FakeRateLimitError("rate limited, no hint")
        return "ok"

    async def wrapped():
        orig = asyncio.sleep
        async def fast(_):
            pass
        asyncio.sleep = fast
        try:
            return await groq_with_retry(call, _NoWaitLimiter())
        finally:
            asyncio.sleep = orig

    assert _run(wrapped()) == "ok"
