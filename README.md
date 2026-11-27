# Vidya Vaani

A voice-first school diary. The teacher scans the QR sticker on a child's paper diary and speaks a note. The parent scans the same sticker, hears the teacher's voice and reads the note in their own language. **Scan, speak, done.**

Built for rural schools: big buttons, pictures and voice before text, works on a low-end Android phone over patchy 4G, and keeps recordings on the phone until the network returns.

## Start it

```bash
git clone https://github.com/shoumikgoswami/vidya_vaani.git
cd vidya_vaani
docker compose up --build
```

Open **http://localhost:3000**. No `.env` file, account or API key is needed.

Docker Compose 2.24 or newer is required for the optional `.env` file. On older versions use `docker compose -f docker-compose.nofile.yml up --build`.

## Two-minute walkthrough

Demo mode is on by default: a sample school, one-tap role switching and "simulate scan" in place of a printed sticker.

1. On the home screen tap **Lakshmi Iyer** (a Tamil-speaking science teacher).
2. Tap **Scan QR**, then **Simulate scan**, then **Ravi Kumar**. Speak a note in Tamil and tap **Save**. (No microphone? Use the sample notes already in Ravi's diary.)
3. Tap **Switch person** and choose **Sunita Devi**, Ravi's Hindi-speaking mother.
4. Play the Tamil note. The Hindi translation is under the player.
5. Tap **Reply by voice**.
6. Switch back to Lakshmi: open the note to see "Heard by", and **Replies** for the voice reply.
7. Switch to **Anita Rao** (admin) and open **School** to see what each language uses ("AI status by language").

Without an NVIDIA key, a note you record yourself keeps the browser's own live transcript where the browser has one (Chrome, Edge), and translation shows as unavailable. The sample notes carry stored transcripts and translations, so the cross-language flow always works. Sample audio is a computer voice unless real recordings are placed in `demo/sample-notes/`.

## Add keys

Copy `.env.example` to `.env`, fill in what you have, then run `docker compose up --build` again. All keys stay on the server.

| Key | What it turns on |
|---|---|
| `NVIDIA_API_KEY` ([build.nvidia.com](https://build.nvidia.com)) | Speech-to-text, clean-up, tags, translation, Hindi and English voices |
| `OPENROUTER_API_KEY` ([openrouter.ai](https://openrouter.ai)) | Free models used when NVIDIA fails or is rate limited |
| `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` ([clerk.com](https://clerk.com)) | Sign-in with Google, email code or SMS OTP |

Then test the models and choose the best one:

```bash
docker compose exec app npm run models:test
```

### Clerk setup

1. Create an application and copy both keys into `.env`.
2. Under **User and authentication**, turn on **Phone number** (SMS verification code), **Email address** (verification code) and **Google**.
3. Under **SMS**, add India to the allowed countries. New instances allow only the US and Canada.
4. On a free development instance, Clerk sends about 20 real SMS a month. For testing use the test numbers `+1 201 555 0100` to `0199` with code `424242`.
5. Real SMS in production needs Clerk's paid plan and your own domain.

With Clerk keys set, the demo phone login is switched off. One-tap demo roles remain while `DEMO_MODE=true` and only ever reach the sample school's accounts.

**For a real school set `DEMO_MODE=false` and use Clerk keys.** The demo phone login shows the code on screen, so it must never guard real children's data.

## What it does

- **Teachers:** scan a sticker, speak, check the card (words, uncertain words, tags, dates, numbers), save by tapping or saying "save". Whole-class and selected-student notes, listen receipts, reminders, a voice inbox.
- **Parents:** hear the teacher, read a translation, see due dates, reply by voice, filter the diary, hear a weekly summary, get notifications and a reminder at 6 pm the day before a deadline.
- **Admins:** school settings, teachers and classes, per-student or per-school QR, A4 sticker sheets, year-end promotion, metrics, activity log, AI status by language.

## Language coverage, stated plainly

The app ships 23 locales (the 22 scheduled languages and English). NVIDIA's free speech models do not cover all of them.

| Tier | Languages | Speech-to-text | Translation | Read aloud |
|---|---|---|---|---|
| A | Hindi, Bengali, Tamil, English | NVIDIA Parakeet (Hindi, Bengali, Tamil), Whisper | NVIDIA or OpenRouter model | Hindi, English: NVIDIA Magpie. Others: phone voice |
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
Express server in one container, SQLite in the /data volume
  audio saved first -> job queue (35 requests/min per model, retries on 429)
  ffmpeg 16 kHz -> NVIDIA Riva gRPC (Parakeet / Whisper) -> browser text -> audio only
  one model call: clean-up + tags + dates   -> rules if every model fails
  one model call: all parents' languages, with names and numbers protected
  Web Push (keys generated on first start)
```

- `server/` API, permissions, AI providers, jobs. Every request is permission-checked on the server.
- `client/` the app. `client/i18n/` one file per language.
- `demo/` sample school. `tests/` API, language rules and AI pipeline tests.

## Tests

```bash
docker compose exec app npm test
```

The AI pipeline tests run against local stand-ins for the NVIDIA and OpenRouter APIs, so they need no key. GitHub Actions starts the app with `docker compose up` on amd64 and arm64 and runs the smoke check and tests on every push.

## Live deployment

The camera and microphone need HTTPS (or `localhost`). Behind Caddy:

```
diary.example.org {
  reverse_proxy localhost:3000
}
```

Set `PUBLIC_BASE_URL=https://diary.example.org` (it is printed into the QR codes), `TRUST_PROXY=true`, `DEMO_MODE=false` and the Clerk keys.

## Limits

- NVIDIA's free tier is for prototyping and evaluation. A school rollout should self-host NIM containers or use a paid provider.
- Voice recordings are sent to a cloud AI service when a key is set. The consent screen says so.
- Notes are deleted after the academic year plus the school's retention period (one year by default).
- iOS Safari records and plays, but has no live on-screen words.

## Licence

MIT. Icons by [Phosphor](https://phosphoricons.com), fonts by Noto, QR reading by jsQR. The speech protocol file is a subset of NVIDIA Riva's (MIT).
