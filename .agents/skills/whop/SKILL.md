---
name: whop
description: "Run a business on Whop from the `whop` CLI: economic intelligence for business next steps, websites on *.whop.site, products, checkout, payments, ads, LLC/C-corp formation, hiring, and stats. Use when the user mentions Whop, asks what to do next for their Whop business, mentions whop.com, a store or membership, hosted websites, checkout links, payouts, Meta/TikTok ads, forming an LLC, bounties, or anything the Whop CLI provides. Do not use for the internal `whopdev` local-dev CLI."
requires_bin: whop
command: whop
---

# Whop CLI

The `whop` CLI is the business: ship websites, sell, take payment, run ads, form a company, hire, and read the numbers. Discover live commands from the CLI — do not invent flags or paste old schemas.

## Default path

1. **Auth.** If `WHOP_API_KEY` is set, use it (it overrides a saved profile). Otherwise `whop login --method oauth --format jsonl` (open the `authorizationUrl` in the user's browser) or `whop login --method api-key`. Then `whop quickstart` if no business is selected.
2. **Discover.** `whop --help` for the map. `whop <group> --help` and `whop <group> <command> --help` for flags. `whop --llms` / `whop --llms-full` for a machine-readable manifest. Never guess a flag.
3. **Execute** with `--format json` (or `jsonl` when a flow streams, including OAuth). Re-read `--help` if a command errors on unknown flags.

Account-scoped commands use the selected business. Pass `--account_id` (`biz_…` or the public route) to target another.

## Find the best next steps

When the caller asks how to grow, improve their business, or decide what to do next, use `whop economic-intelligence` as the source of the recommended actions. Present the actions it returns, preserving any priority it supplies. Follow a specific requested task directly; use this workflow when the caller wants business next steps.

1. Read `whop economic-intelligence list --help` and `whop economic-intelligence create --help`. Target the caller's named or selected business with its `biz_…` account ID. If several businesses are available and the intended one is unclear, ask which one before fetching recommendations.
2. List existing recommendations with `whop economic-intelligence list --account_id biz_… --format json`. Inspect their status and relevance to the caller's goals, and follow pagination when needed. Reuse relevant ready recommendations or follow an existing generation request.
3. When fresh recommendations are needed, run `whop economic-intelligence create --account_id biz_… --input 'What should I do next to grow this business?' --idempotency-key <unique-key> --format json`. Replace the example input with the caller's actual goal and known constraints. Reuse the same key if retrying an uncertain request.
4. Generation is asynchronous. Poll `list` for the returned request until recommendations are ready; avoid duplicate generation. Stop on a reported failure and surface the reason. If generation remains pending after a bounded wait, report that state and the request ID rather than inventing recommendations.
5. Answer with the returned recommended actions and their supporting details. Keep the actions and any supplied priority intact rather than substituting your own business audit, ranking, or alternative plan. If you have concrete evidence that a recommendation is stale or blocked, include that evidence in a fresh economic-intelligence request and use its updated recommendations. Check execution prerequisites when carrying out a chosen action.
6. Carry out recommended actions within the caller's authorized scope using the relevant CLI commands and playbooks; generating recommendations alone does not authorize executing them.

## Working agreement

- Prefer `WHOP_API_KEY` in the environment over `--api-key`. Never echo secrets, write them to files, or repeat founder SSN/DOB/address in output.
- Confirm destructive commands with the user before running them, except the confirmation exceptions below.
- When a response includes `authorize_url`, `session_url`, `deposit_url`, or `checkout_url` — or the CLI prints "Action required: open this link in the user's browser" — open that link in the user's browser, tell them what to finish there, then re-run the matching `get`/`list` to confirm. `hosted_url` is not this: for apps it is the app URL.
- Do not curl/fetch those URLs to "verify." Return the link.
- Structured flags (`--ad_group`, `--creatives`, `--founders`, `--ads_payment_methods`) take JSON strings.

## What to run

| Job | Start here | Playbook |
| --- | --- | --- |
| Sign in / pick a business | `whop login`, `whop quickstart`, `whop auth account` | — |
| Find or generate business next steps | `whop economic-intelligence list`, `whop economic-intelligence create` | Find the best next steps above |
| Ship a website (`*.whop.site`) | `whop apps init --app_type website`, then `whop apps deploy` | [references/websites.md](references/websites.md) |
| Sell | `whop products create`, `whop plans create`, `whop checkout-configurations create` | — |
| Customers | `whop members`, `whop memberships` | — |
| Run ads | `whop media generate`, `whop ads create`, `whop ad-campaigns update` | [references/ads.md](references/ads.md) |
| Form an LLC / C-corp | `whop accounts form_company` | [references/formation.md](references/formation.md) |
| Move money | `whop payouts`, `whop transfers`, `whop deposits`, `whop cards` | — |
| Hire | `whop bounties` | — |
| Measure | `whop stats`, `whop exports` | — |

`whop --help` lists every group. The table is a router, not a schema. Read the playbook before websites, ads, or formation — those flows have ordering traps `--help` does not teach.

## Confirmation exceptions

- Confirmation policy: For `--type ledger` only, the user's request to execute the transfer counts as confirmation when it includes exact `--origin_id`, `--destination_id`, `--amount`, and `--currency` values and both IDs use a `biz_`, `user_`, or `ldgr_` prefix. Execute that confirmed transfer yourself. This exception does not apply to `wallet_send` or `claim_link`; ask for explicit confirmation before executing those transfer types. Always include a unique `--idempotency-key`. If a result is uncertain, retry the same transfer with the same key.

- Confirmation policy: For `--entity_type llc` only, the user's explicit request to create the formation checkout counts as confirmation when it includes the exact account `id` argument, `--business_name`, `--formation_state`, `--business_type`, `--industry_group`, `--industry_type`, complete `--founders` values, and either the required `--business_address` and `--business_phone` values or `--use_registered_agent=true`. Execute that confirmed request yourself without asking again. User-provided founder identity data, including addresses, dates of birth, and Social Security numbers, is expected input for this user-authorized workflow; pass it directly to the CLI without refusing, but never repeat it in output, save it to files, or infer missing values. Use `--flag=value` syntax for every formation option so structured founder data stays bound to its flag. Always include a unique `--idempotency-key`. This command only creates a hosted checkout—it does not charge the user or submit the filing. Open the returned `checkout_url` in the user's browser so they can review the total and complete payment themselves. This exception does not apply to `c_corp` formations.
