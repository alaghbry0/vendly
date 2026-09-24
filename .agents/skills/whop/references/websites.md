# Websites and apps (`*.whop.site`)

Read this before `whop apps init` or `whop apps deploy`. Flag lists live in `whop apps <command> --help` — do not invent them.

`--app_type` is `website` (visitors browse `<route>.whop.site`) or `b2c_app` (creators install it). Ask; do not guess. A website cannot be turned back into an app.

## New website

```sh
whop apps init --app_type website --name "Acme" --route acme
whop apps deploy
```

Agents and scripts must pass `--app_type`. Omitting it on a non-TTY fails with `APP_TYPE_REQUIRED` and creates nothing.

`init` registers the app on Whop **before** it writes files. If it fails after that, retry the same flags — do not `create` a second app.

`--template app_xxx` only inherits `website` from the template. Any other type still needs an explicit `--app_type`.

## Existing app on this machine

```sh
whop apps pull --app app_xxx
whop apps deploy
```

`pull` requires git. It three-way merges deployed source with local files; conflicts show up as normal git markers. Default pull is the **production** build, not the latest preview. `--build abld_xxx` also needs `--app` (builds do not carry the app id).

Code already on disk, no scaffold: `whop apps create --help`, then `whop apps deploy --app app_xxx`.

## Deploy, preview, promote

```sh
whop apps deploy                 # build, upload, promote
whop apps deploy --preview       # upload only
whop apps builds promote abld_xxx
```

`--preview` is the flag. Promoting an older build rolls back.

Looks like deploy will scaffold a missing project. Actually it only ships an existing Vite app. Agents get `NOT_A_VITE_APP` with init/pull CTAs — follow those, do not invent a scaffold flag.

The project must be linked (`whop.app.json`) or you must pass `--app`. Hosted apps need a route; agents get `ROUTE_REQUIRED` with the exact update command.

The app must use the `whop()` Vite plugin (`@whop/cli/vite`). Missing it fails with `NO_BUILD_ARCHIVE`.

Preview output is a build id. The production URL exists only after promote. `hosted_url` on `whop apps get` is the live app URL — display it; do not treat it as a "complete this step" action link.

## Experimentation

Split traffic between the live production build and one next build of the same app. Whop hosting assigns visitors, serves the bound build, and records exposures. Always this flow — never a client-side test, never `whop experiments exposures`, never promote the treatment. One active experiment per app.

```sh
whop experiments list --account_id biz_xxx --related_resource '{"object":"app","id":"app_xxx"}' --status active
whop apps deploy --preview
whop experiments create --account_id biz_xxx --flag_key xxxxxxxx --bucket_by anonymous \
  --hypothesis "If we xxxxxxxx for xxxxxxxx, then xxxxxxxx will xxxxxxxx, resulting in xxxxxxxx, because xxxxxxxx. Created by xxxxxxxx." \
  --related_resource '{"object":"app","id":"app_xxx"}' \
  --control '{"related_resource":{"object":"app_build","id":"apbu_xxxxxxxx"}}' \
  --variants '[{"name":"xxxxxxxx","weight":50,"related_resource":{"object":"app_build","id":"apbu_yyyyyyyy"}}]'
whop experiments activate expt_xxx
```

`--preview` is the next version. Control is `production_web_build.id` from `whop apps get`. Related resource is the app. Each arm must bind a different build. If the list is non-empty, pause or end that experiment first — do not start a second. Then activate. Hosting does the rest. Flags: `whop experiments create --help`.

## Dev, secrets, logs

```sh
whop apps dev
whop apps secrets set --secret KEY=VALUE
whop apps logs app_xxx --level error
```

`dev` injects stored secrets locally. Explicit env vars win. Runtime-control keys (`PATH`, `NODE_OPTIONS`, `NPM_*`, …) are not injected.

Logs need the positional `app_xxx`. Retention is 7 days. Filters: `whop apps logs --help`.
