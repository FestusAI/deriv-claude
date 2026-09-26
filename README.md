# Deriv Higher + Lower Hedge — Free Render Version

This version does **not** use a custom domain.

Your Deriv OAuth App ID is already included:

`34vvcam28Ydxf3IHNHKJI`

## Free hosting

Deploy this project as a **Render Web Service** using the **Free** plan.

Render automatically gives every web service a public HTTPS address similar to:

`https://deriv-higher-lower-hedge.onrender.com`

The exact URL depends on the service name Render accepts.

This app automatically reads Render's `RENDER_EXTERNAL_URL`, so you do not need
to configure `APP_BASE_URL` on Render.

## Deploy

1. Upload every file in this project to one GitHub repository.
2. Sign in to Render.
3. New -> Web Service.
4. Connect the GitHub repository.
5. Choose **Free**.
6. Build command: `npm install`
7. Start command: `npm start`
8. Deploy.

The included `render.yaml` already contains your OAuth App ID.

## VERY IMPORTANT after Render deploys

Render will show your actual public URL.

For example:

`https://deriv-higher-lower-hedge.onrender.com`

Go back to your **Deriv Web-based OAuth app** and set its redirect URL to:

`https://YOUR-ACTUAL-RENDER-URL.onrender.com/callback`

Example:

`https://deriv-higher-lower-hedge.onrender.com/callback`

The callback must exactly match the URL Render gives you.

Do not keep `https://dollarprinting.site/callback` in the OAuth app when using
this free Render version.

## User flow

Users visit your free Render URL and:

1. Tap **Connect with Deriv**
2. Sign in on Deriv
3. Approve trade access
4. Return to your Render site
5. The app fetches their Options accounts
6. Demo is selected first when available
7. They can use Higher + Lower hedging

Users never need to give you a PAT token or password.

## Mobile

Because the site is served over HTTPS, Android users can open it in Chrome and
use **Install app / Add to Home screen**.

## Free Render limitations

Free Render web services are appropriate for testing and hobby projects.
They can have usage limits and may take time to wake after inactivity.

## Trading safety

Test on demo first. Real-money trading is blocked until the user deliberately
enables it. Higher and Lower are separate orders submitted as close together as
possible, so exact same-tick execution is not guaranteed. Hedging does not
guarantee profit.

## Recent changes

- **Only Ups / Only Downs added.** A new `Contract pair` selector lets you
  switch between `Higher / Lower` (CALL/PUT, barrier-based) and
  `Only Ups / Only Downs` (RUNHIGH/RUNLOW, tick-run). Selecting the latter
  hides the barrier fields entirely (Run High/Low contracts don't take a
  barrier) and locks the duration unit to Ticks (these contracts are
  always ticks-based). Both sides of the pair still fire concurrently via
  the same `Promise.all`/`Promise.allSettled` pattern used for Higher/Lower.
  Verified the contract type codes (`RUNHIGH`/`RUNLOW`) against Deriv's
  own docs. I could not confirm the exact minimum/maximum tick count Deriv
  allows for these contracts from documentation alone — if a duration is
  rejected, the exact Deriv error will show in the Activity log.

- **Volatility index picker.** The free-text `Symbol` field is now a
  scrollable listbox (`<select size="8">`) showing 8 rows at once, so you
  can see all the common Volatility indices without a dropdown hiding
  most of them: `R_10`, `R_25`, `R_50`, `R_75`, `R_100`, `1HZ10V`,
  `1HZ25V`, `1HZ50V`, `1HZ75V`, `1HZ100V`. An "Other — type symbol code
  manually" option reveals a text field for any symbol not in that list
  (e.g. a newer 1s-index code I wasn't fully confident listing outright).
- **Barrier sign auto-correction.** Higher/Lower barriers previously
  required you to type the exact sign (`+0.5` / `-0.5`) and were rejected
  client-side if you didn't. Now you can enter just the magnitude (or the
  wrong sign) and the app always applies `+` to the Higher barrier and
  `-` to the Lower barrier itself — removing an entire class of "typed
  it wrong" failures.
- **Simultaneous Higher/Lower already confirmed correct.** `hedgePair()`
  sends both proposal requests via `Promise.all` and both buy requests
  via `Promise.allSettled` — genuinely concurrent WebSocket sends, not
  one-then-the-other. This was already correct in the version you sent;
  I verified it rather than rebuilding it.

### About the barrier issue specifically

I verified against Deriv's own documentation and a working example URL
from Deriv's SmartTrader platform that a signed offset barrier (e.g.
`barrier: "+0.37"`) is the documented, correct format for Higher/Lower
proposals on tick-duration Synthetic Index contracts — so the barrier
*mechanism* this app already used was not wrong in principle. What I
could not verify from documentation alone is whether this app's specific
`api.derivws.com/trading/v1/options/...` endpoint (a distinct, newer
product surface from the classic `ws.derivws.com` API, judging by the
renamed fields and reduced schema) has any additional constraint on that
same field — e.g. a minimum barrier magnitude relative to the symbol's
pip size.

**If barrier proposals still fail after this update**, the app already
surfaces Deriv's exact error code and message in the Activity log (e.g.
`HEDGE ERROR: InvalidBarrier: ...`) — that literal text is the fastest
way to pin down the real cause, faster than further guessing from my
side without it.
