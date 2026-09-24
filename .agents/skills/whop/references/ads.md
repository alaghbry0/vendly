# Ads — nothing to a live campaign

Read this before creating or launching ads. Enums and field lists live in `whop ads create --help` / `--schema`.

Drafts can be created without billing. Launch (`--status active`) cannot.

## Setup

1. **Auth.** `whop login` (OAuth). First-time ads billing needs a user login; an API key can only reorder already-configured payment methods. Scope errors that say the login predates the scope → `whop login` again.
2. **Facebook page.** `whop social-accounts list` must show `"platform": "facebook"`.
   - Connect an existing Meta Business: `whop social-accounts connect --platform meta_business --scopes '["advertise"]' --redirect_url <url>` and open `authorize_url`.
   - Or create a Whop-managed page: `whop social-accounts create --platform facebook`. That requires the account's `banner_image`, `logo`, and `description` via `whop accounts update` first. Account API keys cannot update their own account's branding — use a user login. `meta_business` is invalid on `create`; use `facebook`.
3. **Payment method.** `whop accounts preferences`. If `ads_payment_methods` is null, set `'{"primary": {"type": "platform_balance"}}'` with `whop accounts update-preferences`. Fund with `whop deposits create --help`. A 402 returns `deposit_url` — open it. A successful deposit's `hosted_url` is the page, not an action link.

TikTok uses `whop social-accounts connect --platform tiktok`. Same authorize-url rule.

## Launch

```sh
whop media generate --type image --prompt "A running club at sunrise" --wait
whop ads create \
  --title "Launch ad" --headlines "Find your stride" --call_to_action sign_up \
  --url "https://whop.com/your-store" \
  --creatives '[{"id":"file_x"}]' --social_accounts '[{"id":"sacc_x"}]' \
  --ad_group '{"title":"US broad","conversion_location":"website","ad_campaign":{"title":"Growth","platform":"meta","objective":"sales","status":"draft","budget_amount":25,"budget_optimization":"ad_campaign"}}'
whop ad-campaigns update adcamp_xxx --status active
```

`--wait` on media returns `file.id` for `--creatives` (default timeout 600s). 402 → fund, then retry.

Pass exactly one of `--ad_group` or `--ad_group_id`. Nested `"ad_campaign": {…}` inside `--ad_group` creates the campaign + group + ad in one call (the OpenAPI blurb understates this). Reuse a container with `--ad_group_id` or `"ad_campaign_id"` inside `--ad_group`.

Keep `"status": "draft"` until review. **Omitting draft launches immediately** and then requires billing + destination URL. Flip the campaign to `active` when ready.

| Field | Rule |
| --- | --- |
| `creatives` | One entry with no `format` is the base asset. Optional crops: `square` / `vertical` / `horizontal` only — not `portrait`. No duplicate formats. Two or more unformatted entries is a carousel (2–10). |
| `url` | Required to launch a website ad. A whop.com store page works as-is; an external page needs the Whop pixel. Drafts may omit it. |
| Budget | CBO: `budget_amount` on the campaign with `budget_optimization: "ad_campaign"`. ABO: `budget_amount` on the ad group with `budget_optimization: "ad_group"`. Never both. |
| Targeting | Omit `demographics` / `placements` / `devices` for automatic optimization. `regions` uses ISO 3166 (`"US"`, `"US-CA"`). |
| `lead_form` | Only with an instant-form `conversion_location`. |

`whop ads update` with `creatives` replaces the whole set — include the base entry. `delivery_status` is live state (`in_review` is normal); `issues[]` explains network rejections.
