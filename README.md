# Vidya Vaani

A voice-first school diary. The teacher scans the QR sticker on a child's paper diary and speaks a note. The parent scans the same sticker, hears the teacher's voice and reads the note in their own language. **Scan, speak, done.**

Live demo: **https://vidyavaani.shoumikgoswami.com** (a shared sample school that resets every night).

Built for rural schools: a light screen by default (dark is a choice under **Me**), big buttons, pictures and voice before text, works on a low-end Android phone over patchy 4G, and keeps recordings on the phone until the network returns.

## Start it

```bash
git clone https://github.com/shoumikgoswami/vidya_vaani.git
cd vidya_vaani
docker compose up --build
```

Open **http://localhost:3000**. No `.env` file, account, database or API key is needed: the app carries its own Postgres and keeps it in a Docker volume.

Docker Compose 2.24 or newer is required for the optional `.env` file. On older versions use `docker compose -f docker-compose.nofile.yml up --build`.

## Two-minute walkthrough

The front page introduces the app and plays a real note. Demo mode is on by default: a sample school, one-tap role switching and "simulate scan" in place of a printed sticker.

1. Tap **Try the demo** (or open `/demo`), then tap **Lakshmi Iyer** (an English-speaking science teacher).
2. Tap **Scan QR**, then **Simulate scan**, then **Ravi Kumar**. Speak a note in English and tap **Save**. (No microphone? Use the sample notes already in Ravi's diary.)
3. Tap **Switch person** and choose **Sunita Devi**, Ravi's Hindi-speaking mother. The whole app turns to Hindi.
4. Play the English note: one button speaks it in Hindi, and the link under the words plays the teacher's own voice. (Selvi, Padma and Bimal use Tamil, Telugu and Bengali, spoken by the phone's voice where it has one.)
5. Tap **Reply by voice**.
6. Switch back to Lakshmi: open the note to see "Heard by", and **Replies** for the voice reply.
7. Switch to **Anita Rao** (admin), open **School**, then **Configuration** to see the keys in use, the models and what each language gets.

Without an NVIDIA key, a note you record yourself keeps the browser's own live transcript where the browser has one (Chrome, Edge), and translation shows as unavailable. The sample notes carry stored transcripts and translations, so the cross-language flow always works. The sample school speaks Hindi and English, in NVIDIA's synthetic voice unless real recordings are placed in `demo/sample-notes/`.

## Who sees what

| Address | Opens |
|---|---|
| `/` | The landing page. Signed-in people go to their own screen, and the installed app shows a simple scan-and-sign-in screen |
| `/demo` | The sample school |
| `/login` | Teachers and parents: classes and recording, or the child's diary |
| `/school/login` | School office (principal, clerk): settings, teachers and classes, reports |
| `/register` | Choose who you are: `/register/parent` (language, then scan), `/register/teacher` (school code), `/register/school` (a request) |
| `/owner` | The site owner approves or declines requests |

The office sign-in admits only accounts the school lists as office staff, or a newcomer on a fresh install who is about to create the school. The server applies office rights only to sessions that came through it: someone who is both a principal and a teacher signs in at the office for school work and at the other door to record notes.

### New schools

On your own computer with no owner set, the first person to run the setup wizard creates the school. On a public site that would let a stranger claim it, so set `OWNER_EMAILS` to your sign-in email (it needs Clerk). The wizard is then switched off, and always is on Netlify: schools send a request at `/register/school`, and you approve it at `/owner`. Approval creates the school and gives its office to the email in the request, or to the mobile number when there is no email. No message is sent, so tell the school yourself. Each school sees only its own data.

### New teachers and parents

- **Teachers:** the office adds a teacher by name (mobile and email are optional) and gets a one-time code, valid 14 days. The teacher signs in at `/register/teacher` and types it. A teacher added by mobile or email is also recognised on signing in.
- **Parents:** choose a language first, then scan the diary sticker. The parent screens are worded in all 23 languages as machine drafts that a speaker should check. The sign-in box stays in English.

## Install it on a phone

Vidya Vaani is a Progressive Web App: it installs from the browser, opens full screen from the home screen, and keeps working on a weak network.

- **Android (Chrome, Samsung Internet):** tap **Install** on the card in the app, or choose *Install app* in the browser menu.
- **iPhone (Safari):** tap Share, then **Add to Home Screen**. The app shows these steps.
- The offer also stays under **Me** for anyone who dismissed the card.

Browsers only install apps, and only open the camera and microphone, on **HTTPS** or `localhost`. A phone opening `http://192.168.x.x:3000` can do neither. To try it on your own Android phone before deploying, connect it by USB, open `chrome://inspect/#devices` on the computer, add port forwarding `3000` to `localhost:3000`, and open `http://localhost:3000` on the phone.

App icons are rendered from `client/img/*.svg` with `node scripts/make-icons.js`.

## Add keys

Copy `.env.example` to `.env`, fill in what you have, then run `docker compose up --build` again. All keys stay on the server.

| Key | What it turns on |
|---|---|
| `NVIDIA_API_KEY` ([build.nvidia.com](https://build.nvidia.com)) | Speech-to-text, clean-up, tags, translation, Hindi and English voices |
| `OPENROUTER_API_KEY` ([openrouter.ai](https://openrouter.ai)) | Free models used when NVIDIA fails or is rate limited |
| `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` ([clerk.com](https://clerk.com)) | Sign-in with SMS OTP, Google, or a username and password |
| `DATABASE_URL` ([neon.com](https://neon.com), optional) | A hosted Postgres instead of the built-in one |

Then test the models and choose the best one:

```bash
docker compose exec app npm run models:test
```

### Clerk setup

Three ways to register: **mobile number (SMS code)**, **Google**, or **username and password**.

1. Create an application and copy both keys into `.env`.
2. Under **User and authentication**, turn on **Phone number** (SMS verification code), **Google**, **Username** and **Password**.
3. Make phone number and username **optional** at sign-up. If both are required, everyone has to give both, so they are no longer separate options. Check the sign-up screen afterwards: Clerk may still ask a phone sign-up for a password while Password is on.
4. Lower the minimum password length. A long minimum is hard for parents who type slowly.
5. To link parents by Gmail, also turn on **Email address**.
6. Under **SMS**, add India to the allowed countries. New instances allow only the US and Canada.
7. On a free development instance, Clerk sends about 20 real SMS a month. For testing use the test numbers `+1 201 555 0100` to `0199` with code `424242`.
8. Real SMS in production needs Clerk's paid plan and your own domain.

**How each option links to a child.** A verified phone number or email that matches the school's record links at once. A username proves nothing about who someone is, so a username-only parent waits for the teacher's approval. Teachers and admins are added by phone or email, so they should sign in with one of those.

With Clerk keys set, the demo phone login is switched off. One-tap demo roles remain while `DEMO_MODE=true` and only ever reach the sample school's accounts.

**For a real school set `DEMO_MODE=false` and use Clerk keys.** The demo phone login shows the code on screen, so it must never guard real children's data.

## QR stickers

Every code carries the Vidya Vaani logo and colours, and a test reads each style back so a code that stops scanning fails the build.

- **One class:** open the class and tap **Print stickers**.
- **Whole school:** office sign-in, then **Stickers for all classes** (all, or one class at a time).
- Choose 8, 12 or 24 to an A4 page, then **Print or save as PDF** (A4, 100% size). Cut along the dashed lines.
- A school that prefers one code for everyone prints the **School QR** poster; child stickers keep working.

## What it does

- **Teachers:** scan a sticker, speak, check the card (words, uncertain words, tags, dates, numbers), save by tapping or saying "save". Whole-class and selected-student notes, listen receipts, reminders, a voice inbox.
- **Parents:** hear and read each note in their preferred language (with the teacher's own recording one tap away), see due dates, reply by voice, filter the diary, hear a weekly summary, get notifications and a reminder at 6 pm the day before a deadline.
- **Voices:** a teacher picks one of six NVIDIA voices under **Me** for notes spoken in translation (Hindi and English). English words in a Hindi note are written in Devanagari before they are spoken, so "Science" is not spelled out letter by letter.
- **Admins:** a Configuration screen with every technical detail (nothing about keys or models shows anywhere else), school settings, teachers and classes, per-student or per-school QR, branded sticker sheets, moving students one by one into new classes, adding and removing class teachers, metrics, activity log, AI status by language.

## Language coverage, stated plainly

The app ships 23 locales (the 22 scheduled languages and English). NVIDIA's free speech models do not cover all of them.

| Tier | Languages | Speech-to-text | Translation | Read aloud |
|---|---|---|---|---|
| A | Hindi, Bengali, Tamil, English | Hindi: NVIDIA Parakeet, then Whisper. Bengali, Tamil, English: Whisper | NVIDIA or OpenRouter model | Hindi, English: NVIDIA Magpie. Others: phone voice |
| B | Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu | NVIDIA Whisper | Model | Phone voice |
| C | Nepali, Assamese, Sanskrit, Sindhi | NVIDIA Whisper (weaker) | Model, with a "may be wrong" label for Sanskrit and Sindhi | Phone voice where present |
| D | Odia, Konkani, Maithili, Dogri, Bodo, Santali, Manipuri, Kashmiri | Approximate transcript in a nearby language, or audio only | Model, with a "may be wrong" label for most | Text only |

In every tier the parent hears the teacher's own recording.

**App text is a machine draft** and is marked `_review` until a native speaker checks it. Hindi, Bengali, Tamil and Telugu cover the main teacher and parent screens. Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Odia, Assamese and Nepali cover the spoken prompts and main buttons. The rest show a few words or English. With a key, `npm run i18n:fill` drafts the missing strings.

## How it works

```
Phone (plain JavaScript PWA, no build step)
  record -> save in IndexedDB -> upload
        |
Express API            Docker: one container      Netlify: functions
  audio saved first -> job queue in the database (35 requests/min per model, retries on 429)
  ffmpeg 16 kHz -> NVIDIA Riva gRPC (Parakeet for Hindi / Whisper) -> browser text -> audio only
  one model call: clean-up + tags + dates   -> rules if every model fails
  one model call: all parents' languages, with names and numbers protected
  Web Push (keys generated on first start)
        |
Postgres: built in (PGlite, in /data) or Neon. Recordings live in the database too.
```

- `server/` API, permissions, AI providers, jobs. Every request is permission-checked on the server.
- `client/` the app. `client/i18n/` one file per language.
- `netlify/` and `netlify.toml` the hosted version. `demo/` sample school. `tests/` API, storage, QR, language rules and AI pipeline tests.

## Tests

```bash
docker compose exec app npm test
```

The AI pipeline tests run against local stand-ins for the NVIDIA and OpenRouter APIs, so they need no key. GitHub Actions starts the app with `docker compose up` on amd64 and arm64 and runs the smoke check and tests on every push.

## Live deployment

The camera and microphone need HTTPS (or `localhost`).

### Netlify and Neon (how the live demo runs)

1. Create a Postgres project at [neon.com](https://neon.com) in the region your Netlify functions use (US East, Ohio on the free plan).
2. Put the secrets in a file that git ignores, for example `.env.netlify`: `DATABASE_URL`, the Clerk keys and the AI keys.
3. Create and link a site, send it the secrets and the public settings, then deploy:

```bash
npx netlify-cli login
npx netlify-cli init
npx netlify-cli env:import .env.netlify
npx netlify-cli env:set PUBLIC_BASE_URL https://diary.example.org
npx netlify-cli deploy --build --prod
```

On Windows, `scripts\netlify-secrets.ps1` does the import in one step: run it and paste the connection string from Neon when asked. It takes the keys from `.env`.

4. To deploy from GitHub, link the repository once in Netlify (Project configuration, Build & deploy, Link repository) and pick the `main` branch. The build settings come from `netlify.toml`. From then on every push to `main` is built and published, and a build that fails leaves the last version live. Netlify does not wait for the GitHub checks, so run `npm test` before pushing.

Netlify stops a build when the value of a secret setting appears in the code or the built files. `netlify.toml` lists the settings that are public by nature, such as model names and addresses. Never add a real key or the database address to that list.

Add `OWNER_EMAILS` in Netlify's environment variables so you can approve schools. If you mark it secret, it is already listed in `netlify.toml` as a setting the secret scan may skip.

`PUBLIC_BASE_URL` is printed into the QR codes, so set it before printing stickers. The database tables and the sample school are created on first use. Functions:

| Function | Work |
|---|---|
| `api` | The whole API |
| `jobs-background` | Speech-to-text, translation and notifications (up to 15 minutes) |
| `tick` | Every 5 minutes: reminders and stuck jobs; once a night: old notes and the demo reset |

The sample school may use at most `AI_DEMO_DAILY_LIMIT` AI jobs a day (300 on Netlify), so a public demo cannot spend the whole free tier.

### Your own server

Behind Caddy:

```
diary.example.org {
  reverse_proxy localhost:3000
}
```

Set `PUBLIC_BASE_URL=https://diary.example.org`, `TRUST_PROXY=true`, `DEMO_MODE=false` and the Clerk keys.

## Limits

- NVIDIA's free tier is for prototyping and evaluation. A school rollout should self-host NIM containers or use a paid provider.
- Voice recordings are sent to a cloud AI service when a key is set. The consent screen says so.
- Notes are deleted after the academic year plus the school's retention period (one year by default).
- Recordings are stored in the database. A free database holds a demo, not a district.
- The first office sign-in on a fresh deployment may create the school, so set up your school as soon as it is live.
- iOS Safari records and plays, but has no live on-screen words.

## Licence

MIT. Icons by [Phosphor](https://phosphoricons.com), type by [Anek](https://github.com/EkType/Anek) (Ek Type) and Noto, QR reading by jsQR. The speech protocol file is a subset of NVIDIA Riva's (MIT). The Netlify build downloads [ffmpeg](https://ffmpeg.org) (GPL) through ffmpeg-static; the Docker image uses Debian's package.
