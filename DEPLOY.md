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

   Those two lines appear **only on the first boot**. The disk starts empty, so
   the league and the fixture list are copied across from the copies committed
   in `data/`. After that the disk is the truth and seeding never overwrites it
   — a redeploy leaves a season you have been playing exactly where it was.

4. **Open the URL.** Render gives you `basketball-manager-xxxx.onrender.com`.

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
- **Logs** — a save prints `saved N played of 870 fixtures … (sim date …)`, so
  the logs tell you the season is being kept.
- **Resetting the league** — delete `/var/data/season.json` from a Render shell
  and restart; the next boot re-seeds it from the committed fixture list.
  Deleting `league.json` too resets the players and coaches.

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
