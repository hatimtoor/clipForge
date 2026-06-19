"""
Lemon Squeezy billing for ClipForge.

Lemon Squeezy is the Merchant of Record (it handles VAT/sales tax). This module
only does three things: create a hosted checkout, verify webhook signatures, and
fetch a subscription's customer-portal URL. The webhook is the single source of
truth for a user's plan — never the frontend.

Required env (integration stays dormant until these are set):
  LEMONSQUEEZY_API_KEY          - API key (Settings → API)
  LEMONSQUEEZY_STORE_ID         - numeric store id
  LEMONSQUEEZY_VARIANT_MONTHLY  - variant id of the monthly Pro plan
  LEMONSQUEEZY_VARIANT_ANNUAL   - variant id of the annual Pro plan
  LEMONSQUEEZY_WEBHOOK_SECRET   - signing secret set when creating the webhook
"""
import os
import hmac
import hashlib
from typing import Optional

import httpx

LEMONSQUEEZY_API_KEY         = os.getenv("LEMONSQUEEZY_API_KEY", "")
LEMONSQUEEZY_STORE_ID        = os.getenv("LEMONSQUEEZY_STORE_ID", "")
LEMONSQUEEZY_VARIANT_MONTHLY = os.getenv("LEMONSQUEEZY_MONTHLY_VARIANT_ID", "")
LEMONSQUEEZY_VARIANT_ANNUAL  = os.getenv("LEMONSQUEEZY_ANNUAL_VARIANT_ID", "")
LEMONSQUEEZY_WEBHOOK_SECRET  = os.getenv("LEMONSQUEEZY_WEBHOOK_SECRET", "")

LS_ENABLED = bool(LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID)

_API = "https://api.lemonsqueezy.com/v1"

# Subscription statuses that should grant Pro. "cancelled" still has access until
# the period ends (a later subscription_expired event flips it to free); "past_due"
# is a payment-retry grace window, so we keep access during it.
PRO_STATUSES = {"active", "on_trial", "cancelled", "past_due"}


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {LEMONSQUEEZY_API_KEY}",
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
    }


def variant_for_plan(plan: str) -> str:
    """Map a plan name to its Lemon Squeezy variant id."""
    return LEMONSQUEEZY_VARIANT_ANNUAL if plan == "annual" else LEMONSQUEEZY_VARIANT_MONTHLY


async def create_checkout(user_id: str, email: str, plan: str, redirect_url: str) -> Optional[str]:
    """Create a hosted checkout and return its URL. The Supabase user_id is embedded
    as custom data so the webhook can map the resulting subscription back to the user."""
    variant = variant_for_plan(plan)
    if not LS_ENABLED or not variant:
        return None
    payload = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": {
                    "email": email or None,
                    # custom values must be strings; they return under meta.custom_data
                    "custom": {"user_id": str(user_id)},
                },
                "product_options": {
                    "redirect_url": redirect_url,
                    "enabled_variants": [int(variant)],
                },
            },
            "relationships": {
                "store":   {"data": {"type": "stores",   "id": str(LEMONSQUEEZY_STORE_ID)}},
                "variant": {"data": {"type": "variants", "id": str(variant)}},
            },
        }
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{_API}/checkouts", headers=_headers(), json=payload)
        r.raise_for_status()
        return r.json()["data"]["attributes"]["url"]


def verify_webhook(raw_body: bytes, signature: str) -> bool:
    """Constant-time verify the X-Signature header (hex HMAC-SHA256 of the raw body)."""
    if not LEMONSQUEEZY_WEBHOOK_SECRET or not signature:
        return False
    digest = hmac.new(LEMONSQUEEZY_WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature)


async def get_portal_url(subscription_id: str) -> Optional[str]:
    """Fetch the (freshly signed) customer-portal URL for a subscription so the user
    can update payment details or cancel."""
    if not LS_ENABLED or not subscription_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{_API}/subscriptions/{subscription_id}", headers=_headers())
            r.raise_for_status()
            urls = r.json()["data"]["attributes"].get("urls", {})
            return urls.get("customer_portal")
    except Exception as e:
        print(f"[billing] portal url fetch failed for {subscription_id}: {e}", flush=True)
        return None
