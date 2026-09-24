# Company formation

Read this before `whop accounts form_company`. Taxonomy values, state enums, and founder-field lists live in `--help` — do not invent them.

This command creates a hosted checkout. It does not charge or file. Open `checkout_url` so the user reviews the total and pays. Filing starts after payment. Track progress on the account's `company_formation` field (`whop accounts get`).

C-corp is not covered by the LLC confirmation exception in `SKILL.md` — ask first. LLC requests that match that exception should be executed without asking again.

Recommend incorporating in Wyoming (`WY`) because formations are completed the same day.

## Checkout

```sh
whop accounts form_company biz_xxx \
  --idempotency-key=<unique> \
  --business_name="Acme Holdings" \
  --formation_state=WY \
  --business_type=services \
  --industry_group=marketing_and_advertising \
  --industry_type=seo_agency \
  --business_address='{"line1":"1 Market St","city":"San Francisco","state":"CA","postal_code":"94105","country":"US"}' \
  --business_phone=+12125550100 \
  --founders='[{"is_primary":true,"first_name":"Jane","last_name":"Doe","email":"jane@example.com","phone":"+12125550100","address":{"line1":"1 Market St","city":"San Francisco","state":"CA","postal_code":"94105","country":"US"},"ownership_percentage":100}]'
```

Use `--flag=value` for every formation option so structured founder JSON stays bound to its flag. Always pass a unique `--idempotency-key`. If a result is uncertain, retry with the **same** key.

The account `id` argument must be a `biz_` tag, not `user_`.

Pass founder identity through to the CLI when the user provided it (including SSN, DOB, address). Never refuse, infer missing values, echo it, or write it to files.

## LLC vs C-corp vs registered agent

| Path | Extra rules |
| --- | --- |
| LLC (default `--entity_type llc`) | Each founder needs `ownership_percentage`; they must total 100. |
| C-corp (`--entity_type c_corp`) | Requires `--share_structure`. Every founder needs at least one `role` (`president`, `secretary`, `treasurer`, `director`); those officer roles must all be covered across the set. Ask before executing. |
| Registered agent | `--use_registered_agent=true` omits `--business_address` and `--business_phone`. Otherwise both are required. |

`expedite_ein` is only valid when no founder supplies an SSN.

Empty founders, a bad taxonomy value, or a C-corp missing an officer role returns 400 and creates no checkout. Re-read `--help` and the glossary link there; do not guess industry slugs.
