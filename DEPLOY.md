# Deploying to Render

The app is a single Python process with no dependencies, so hosting it is
mostly about two constraints that come from how it works:

1. **The league lives in memory.** Run exactly one instance. Two instances
   would each hold their own league, tick their own clocks, and overwrite each
   other's save. Never enable autoscaling.
2. **It writes as you play.** Render replaces the filesystem on every deploy,
   so results written next to the code are gone the next time you push. That
   is what the disk is for.

`render.yaml` in the repository root encodes both.

## What it costs

| | |
|---|---|
| Starter instance | **$7/month** — required, because *disks are not available on the free tier* |
| 1 GB disk | ~$0.25/month |
| Custom domain + TLS | free |

The free tier would also sleep after 15 minutes idle, and since the league is
in memory, waking up means reloading from the last save — so any games played
since that save are lost. Paying for Starter avoids both problems.

## Deploy

1. **Push this branch to GitHub** (already done if you are reading this in the
   repo).

2. **Create the service.** In the Render dashboard: **New → Blueprint**, pick
   this repository, and Render reads `render.yaml`. It will propose one web
   service named `basketball-manager` with a 1 GB disk mounted at `/var/data`.
   Approve it.

   If you would rather click through it manually instead of using the
   blueprint: New → Web Service, runtime **Python 3**, build command
   `python3 -c "import sys; assert sys.version_info >= (3, 11)"`, start command
   `python3 run.py serve`, then add a disk at `/var/data` and an environment
   variable `BBALLSIM_DATA_DIR=/var/data`. Set the health check path to
   `/api/health`.

3. **Wait for the first deploy.** The build does nothing (there is nothing to
   install), so it is quick. The logs should show:

   ```
   seeded /var/data/league.json
   seeded /var/data/season.json
   Basketball Manager shell running at http://0.0.0.0:10000
   ```

   Those lines appear **only on the first boot**. The disk starts empty, so the
   league and the fixture list are copied across from the copies committed in
   `data/`. After that the disk is the truth: a redeploy leaves a season you
   have been playing exactly where it was.

   The one exception is when the **calendar itself** has changed. Results are
   keyed by fixture id, so a season played on a schedule this build no longer
   has is not a season in progress — its standings refer to games that do not
   exist. Each season file carries a fingerprint of its fixture list, and a
   deploy replaces the save when that no longer matches, logging
   `installed season.json -> /var/data/season.json`.

   **Once the league has rolled an offseason, that exception stops applying.**
   A league in its third season is playing a calendar it built for itself,
   which will never match the bundled one — so the fingerprint check would
   replace it on every single deploy, putting the league back on 2026-27 while
   `league.json` still held players three years older and `history.json` still
   held the seasons they played. The presence of `/var/data/history.json` is
   what tells a boot the save has moved on from the seed, and it is left alone
   from then on.

4. **Open the URL.** Render gives you `basketball-manager-xxxx.onrender.com`.
   You get the whole app, not just the tracker: Games, Stats, Standings and
   Teams. There are no clock controls — the league runs on real time, so games
   tip off and play out on their own.

## Adding your domain

Render issues and renews the TLS certificate itself; there is nothing to
configure beyond DNS.

1. In the service, go to **Settings → Custom Domains → Add Custom Domain** and
   enter the name (e.g. `basketball.example.com`, or the apex `example.com`).
2. Render shows the DNS record to create. At your registrar:
   - **Subdomain** (`www`, `basketball`, …): a `CNAME` pointing at the
     `onrender.com` hostname Render gives you.
   - **Apex** (`example.com` with no subdomain): an `A` record pointing at
     Render's IP, which the dashboard shows. Some registrars offer `ALIAS` or
     `ANAME` records, which are preferable if available.
3. Wait for verification. DNS propagation is usually minutes but can take a few
   hours; Render issues the certificate automatically once it can see the
   record. The app needs no changes and no restart.

## Operating it

- **Health check** — `/api/health` answers without touching the league, so it
  keeps reporting healthy even while a slow request holds the lock.
- **Saving** — results are written every two minutes *if games have been
  played*, and once more on shutdown. Render stops a service by sending
  `SIGTERM`, which the app handles: it stops accepting requests, saves, and
  exits. An idle server writes nothing.
- **Logs** — a save prints `saved N played of 1230 fixtures … (sim date …)`, so
  the logs tell you the season is being kept.
- **Resetting the season** — set `BBALLSIM_RESET_SEASON=1` in the service's
  environment and redeploy: the next boot does a **full** reset. It wipes every
  result, standing and stat back to the committed fixture list, resets the
  roster to the committed one, and clears the rolled state a played league
  leaves behind — `history.json`, `records.json`, `offseason.json`,
  `trades.json`, `allstar.json`. That last part matters: a league that has
  rolled even one offseason writes a `history.json`, and its presence otherwise
  blocks the reseed forever, so before this a drifted league could not be
  brought home by the variable alone. **Remove the variable after the reset
  boot**, or every future deploy resets the season again.
- **A rotted calendar heals itself.** The committed `season.json` carries
  absolute dates, and real time keeps moving. If a deploy finds a season that
  has *never been played* and whose every game is already in the past, it
  throws that calendar away and lays a fresh one opening tomorrow, rather than
  fast-forwarding through a whole simulated year on the first tick. (A season
  with even one game played is a real season in progress and is never touched.)
  This is the safety net; the belt is regenerating `data/season.json` with
  `python3 tools/make_season.py --force` before a deploy so it opens in the
  future to begin with.
- **The clock is real time, and so is the tracker.** Games tip off at their
  real 8am, 1pm and 7pm Pacific slots, three a day per team, and reveal their
  play-by-play at real speed — a game runs about 48 minutes, so the three
  slates never overlap. The service has to be *running* at those times to play
  them, which is another reason the free tier's sleep-when-idle does not suit
  this app.

## Known limits

- **One instance, in memory.** Scaling out needs the league state moved into a
  database or a shared store; today two instances would diverge immediately.
- **`http.server`.** The standard library's server is fine for one user and a
  handful of tabs — it is what keeps the project dependency-free — but it has
  no request timeouts, no rate limiting and no slow-client protection. Behind
  Render's proxy on a private URL this is acceptable; if the app ever becomes
  genuinely public, put it behind a real WSGI server (the API only touches the
  `League` object, so swapping in Flask or FastAPI is contained).
- **No authentication.** Anyone with the URL can advance the clock and play
  games. Worth adding before you point a domain people know about at it.
