# WozBets — Rainbet wager leaderboard

Live at **https://wozbets.com/**

A one-page static site showing a $250 monthly wager leaderboard for Rainbet
affiliate code **WOZBETS**. Generated from the Forge Partners leaderboard
template — do not hand-edit, see *Making changes* below.

## How it works

The site never calls the Rainbet API. The API takes its key as a URL query
parameter, so any browser-side call would publish the key to every visitor.
Instead:

```
GitHub Actions (holds the key)
  -> calls the Rainbet affiliate API
  -> masks usernames, computes ranks and prizes
  -> writes data/leaderboard.json
  -> commits it to this repo
  -> Netlify sees the push and redeploys
  -> the browser reads static JSON
```

The board therefore keeps working if the API is down, and costs nothing to serve.

## Settings

| Setting | Value |
| --- | --- |
| Affiliate code | `WOZBETS` |
| Referral link | https://rainbet.com?r=wozbets |
| Prize pool | $250 across 5 places |
| Split | 1st $100 · 2nd $60 · 3rd $40 · 4th $30 · 5th $20 |
| Cycle | Calendar month — 1st to the last day of the month |
| First cycle | 2026-09-01 — earlier months are never shown as past winners |
| Timezone | Europe/London |
| Refresh | 2 0 * * * and 2 23 * * * (UTC) |

## Go-live checklist

1. **Create the repo** and push this folder to it.
2. **Add the API key** — Settings → Secrets and variables → Actions → New
   repository secret, named exactly `RAINBET_API_KEY`.
3. **Check the default branch.** Scheduled workflows only run on the
   repository's default branch. If you pushed to anything other than the
   default, the cron will never fire.
4. **Connect Netlify** to the repo (this needs an interactive login, so a human
   has to do it). Settings come from `netlify.toml`. Set the production branch
   to the branch you pushed.
5. **Point the domain** at Netlify and wait for the TLS certificate. A new
   custom domain serves Netlify's default certificate for a while — confirm the
   certificate is actually issued for `wozbets.com` before telling anyone the
   site is live.
6. **Run the workflow once by hand** — Actions → Refresh leaderboard → Run
   workflow. Confirm it produces a data commit authored by
   `github-actions[bot]`.
7. **Load the site** and check the board, the countdown and the username search.

## Making changes

Colours, fonts, copy, prizes, socials and the cycle all live in
`creators/wozbets.json` in the template repo. Edit that, re-run
`node new-creator.mjs wozbets`, and copy the regenerated files over. The cycle
constants appear in two files (`assets/app.js` and
`scripts/fetch-leaderboard.mjs`) and must always agree — regenerating is what
guarantees that.

`data/leaderboard.json` and `data/history/*.json` are written by the workflow.
Never hand-merge them: if you hit a rebase conflict there, regenerate instead.

## Local preview

`crypto.subtle` — which the username search uses — is unavailable on `file://`,
so the page must be served:

```
npx serve .
# or
python3 -m http.server 8000
```
