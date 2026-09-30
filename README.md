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

## Admin bot catalog

The public site now has a Free Bots catalog seeded with the visible bots from
`dollarprinting.site`, plus the built-in DollarPrinting Hedge V7 bot.

Admin link:

`https://YOUR-ACTUAL-RENDER-URL.onrender.com/admin`

Before using Admin, set this Render environment variable:

`ADMIN_PASSWORD`

Use that password on the Admin page to add, update, hide, or delete bot cards.
Cards added in Admin appear in the public Free Bots section.

Important: this lightweight Render version stores admin-added bot cards in
`data/bots.json` on the running service. For a permanent multi-admin setup, move
the bot catalog to a database or another persistent storage service.

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
