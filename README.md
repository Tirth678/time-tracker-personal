# Study Tracker

A personal timer for study sessions. Name what you are studying, start the clock, and watch the hours add up.

- **Next.js** (App Router) front end, animated with Motion
- **Express** API under `/api`, which is the only code that talks to the database
- **PostgreSQL** for storage
- Deploys to **Vercel** as it is

## What it does

- **Dashboard**: total time studied, time studied today, and the number of sessions.
- **Sessions**: type a name, then Start, Pause, Resume and End. The name can be changed while the timer runs.
- **Pomodoro mode** (optional): focus rounds and breaks with lengths you choose, a chime when a phase ends, and a long break after a number of rounds. Only focus time counts as studied.
- **Backgrounds**: five animated presets, or your own picture or video, uploaded from the device or given as a link. A video has a mute button, a volume slider and a dimmer.
- **History**: every session by day, with delete.
- **It keeps counting**: the timer survives reloads, closed tabs and a sleeping laptop. If a stopwatch ran unobserved for more than 30 minutes, the app asks whether that time should count.
- **Works without a database**: sessions are then kept in the browser. Once a database is connected, they are uploaded and shared by all your devices. Sessions recorded while offline are uploaded when the connection returns.

Keyboard: `Space` starts, pauses and resumes. `Enter` in the name field starts the session. `Esc` closes a panel.

## Run it

Needs Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The badge in the header says **On this device** until a database is connected.

## Connect a database

The app reads one setting, `DATABASE_URL`: a PostgreSQL connection string. Any PostgreSQL works (Neon, Supabase, a local server).

### On your computer

1. Copy `.env.example` to `.env.local`.
2. Put your connection string in it:

   ```bash
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
   ```

3. Restart `npm run dev`.

`.env.local` is ignored by Git. Keep the connection string out of every file that is committed: it contains the password.

### What happens next

- The table `study_sessions` is created on the first request. There is nothing to migrate by hand. If the table is dropped later, it is created again.
- The header badge changes to **Synced**. Sessions that were recorded before are uploaded.
- `GET /api/health` answers `{"ok":true,"database":"connected"}`. If the database cannot be reached, it answers `{"ok":false,"database":"unreachable","cause":"…"}`, and the app keeps your sessions on the device until it can.

### Notes on the connection string

- `POSTGRES_URL` is used when `DATABASE_URL` is not set.
- Use your provider's **pooled** endpoint when it offers one (on Neon, the host with `-pooler` in its name).
- `sslmode=require`: the server's certificate is verified first. Only if it cannot be verified (some providers sign with their own authority) does the app continue with an encrypted, unverified connection, and it says so in the server log. `sslmode=verify-full` never falls back.
- Extra parameters that the Node driver does not know, such as Neon's `channel_binding=require`, are accepted and have no effect.

### There is no login

Anyone who knows the address of your deployment can read and change the sessions in the database. For a personal tracker, keep the address to yourself or put the deployment behind your host's access protection.

## Deploy to Vercel

1. Merge this code into `main` on GitHub.
2. On Vercel choose **Add New → Project** and import the repository. Next.js is detected. No build setting needs changing.
3. Before deploying, open **Environment Variables** and add:

   | Name           | Value                             | Environments                           |
   | -------------- | --------------------------------- | -------------------------------------- |
   | `DATABASE_URL` | your PostgreSQL connection string | Production (and Preview, if you want) |

4. Deploy.
5. Open `https://YOUR-APP.vercel.app/api/health`. It should answer `{"ok":true,"database":"connected"}`, and the app's badge should say **Synced**.

If the project already exists, add the variable under **Settings → Environment Variables** and redeploy: a variable only reaches deployments made after it was saved.

Every request to the API goes to the database, so choose the function region closest to it (**Settings → Functions → Function Region**).

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Development server                            |
| `npm run build`     | Production build                              |
| `npm start`         | Serve the production build                    |
| `npm test`          | All tests                                     |
| `npm run typecheck` | TypeScript                                    |
| `npm run lint`      | ESLint                                        |
| `npm run check`     | Type check, lint and tests, one after another |

## How it is built

```
app/                Next.js pages: layout, the one page, error and not-found screens
components/         The interface: timer, controls, totals, history, settings, backgrounds
lib/timer/          The timer and Pomodoro rules, as pure functions
lib/client/         Browser side: the store that keeps data on the device and syncs it, the API client
lib/types.ts        Types shared by browser and server
server/             The Express app, input validation and the database layer
pages/api/          Hands every /api request to the Express app (one function on Vercel)
tests/              Timer rules, the store against a live API, the API against PostgreSQL
```

The browser is the source of truth while a session runs. The timer is stored as timestamps, so no time is lost when the page is closed. A finished session is written to the browser's storage first and uploaded after that. Uploading the same session twice is harmless, because each session carries an id made in the browser.

### API

| Method and path            | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `GET /api/health`          | Is the API up, and is a database connected?                           |
| `GET /api/stats`           | Total seconds and number of sessions. `?todayStart=` adds today.      |
| `GET /api/sessions`        | Finished sessions, newest first. `?limit=` and `?cursor=` page them.  |
| `POST /api/sessions`       | Save up to 200 finished sessions. Reports a result for each session.  |
| `DELETE /api/sessions/:id` | Delete a session.                                                     |

Without a database, the data routes answer `503` with the code `database_not_configured`.

## Tests

```bash
npm test
```

The API tests run against a real PostgreSQL compiled to WebAssembly, in memory, so no database has to be installed. To run them against a PostgreSQL server as well, set `TEST_DATABASE_URL`.

**The tests empty the `study_sessions` table.** Never point `TEST_DATABASE_URL` at a database that holds your sessions.

## Other settings

| Variable              | Purpose                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_DEV_ORIGINS` | Only for `npm run dev` opened through a tunnel or a cloud IDE: extra host names, comma-separated (`*.example.dev`). |

## Fonts

Geist and Instrument Serif are served from the app itself, under the SIL Open Font License. The licences are in `app/fonts/`.
