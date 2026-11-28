# Vidya Vaani — Product Spec (Round 2 build)

**Version:** 2.0 · **Owner:** Shoumik Goswami
**Deadline:** 30 Nov 2026, 11:59 pm IST, according to the build rules. The official page says 29 Nov, so plan for 29 Nov. One submission only.
**Scope:** This extends our Round 1 idea, which the organisers allow. Every feature below is in scope. There is no phased MVP.

**One line:** A voice-first school diary. The teacher scans the QR on a child's paper diary and speaks a note. The parent scans the same QR, hears the teacher's voice, and reads the note in their own language. Scan → speak → done.

**What changed from v1.1** (the old version is kept as `PRODUCT_SPEC.v1.1.md`):
- We don't have access to the Wispr Flow API. All AI inside the product now runs on **free models from NVIDIA Build** (build.nvidia.com). We still use the Wispr Flow app to **build** the product hands-free (section 20).
- NVIDIA's speech models don't cover all 22 languages. Section 6 says exactly which languages each model covers and what each language falls back to.

## Changes agreed during the build (v2.1, 27 Nov 2026)

These override the sections below where they differ.

| Topic | v2.0 said | v2.1 builds |
|---|---|---|
| Sign-in (2.2) | Our own phone + OTP, SMS provider keys | **Clerk**: SMS OTP, Google, or username and password (a username alone never links a parent automatically). Without Clerk keys and with `DEMO_MODE=true`, a demo phone login shows the code on screen |
| Parent linking (J5) | Verified phone matches | Verified **phone or email** matches. The teacher can record the parent's Gmail |
| LLM chain (5.4, 5.5) | NVIDIA model, NVIDIA fallback, rules | NVIDIA model, NVIDIA fallback, **free OpenRouter models**, rules |
| LLM choice (5.4) | Llama 4 Maverick / Gemma 4 / Qwen / Mistral Large 3 | Those NVIDIA ids were no longer listed on 27 Nov. Chosen by live test (`docs/model-eval.md`): `nvidia/nemotron-3.5-bolt-e4b`, then `minimaxai/minimax-m3.1-flash` |
| Sign-in pages (4, S2) | One login | Two: `/login` for teachers and parents, `/school/login` for school office staff. Office rights need a session from the office sign-in |
| Runtime (11) | Node 20 | Node 22 |
| Parakeet coverage (5.2, 6) | Hindi, Bengali, Tamil | Checked live on 27 Nov: the hosted function transcribes Hindi and English and refuses `bn-IN` and `ta-IN`. Bengali and Tamil go to Whisper |
| Speech requests (5.2) | StreamingRecognize for large audio | Notes are capped at 2 minutes and sent as FLAC when the WAV exceeds 3.5 MB, so only `Recognize` is used |
| Settings (12) | `SMS_PROVIDER`, `SMS_API_KEY` | Removed. Clerk sends the SMS. Added `CLERK_*` and `OPENROUTER_*` |

## Changes agreed during the build (v2.2, 28 Nov 2026)

These override v2.1 and the sections below where they differ.

| Topic | Before | v2.2 builds |
|---|---|---|
| Database (9, 11) | SQLite file, audio on disk | **Postgres**: PGlite inside the container (no setup), Neon when `DATABASE_URL` is set. Recordings and read-aloud audio live in the database |
| Hosting (R7) | One container behind a proxy | Also **Netlify**: static app, the API as a function, a background function for AI jobs, a five-minute scheduled function. Live at `vidyavaani.shoumikgoswami.com` |
| Look (4) | Leaf green, Noto | New identity: school-ink blue, Anek type, voice-bar "V" logo, short transitions that respect reduced motion |
| QR (J1, S15) | Plain codes, 12 or 24 a page | Branded codes with the logo; class or whole-school sheets of 8, 12 or 24 stickers; child stickers also work when a school uses one QR |
| Public demo (15) | Local only | Demo school resets nightly and has a daily AI limit |
| Appearance (4) | Followed the phone | **Light by default**; each person can choose dark under Me |
| AI status (5.7, S11) | In school settings and reports, with key warnings elsewhere | One office **Configuration** screen. Teachers, parents and other office screens show no keys, models or service names |
| Sample notes (15) | Tamil, Hindi and Bengali recordings | **Hindi and English** recordings in NVIDIA's natural voice; parents still read Tamil, Telugu and Bengali translations |
| Languages (J4, S10) | App language, a reading language per child, and a translation/original switch | **One preferred language** for screens, note text and note sound |
| Note playback (5.7, S10) | The teacher's recording first, plus a read-aloud button on the translation | **One play button.** In the teacher's language it plays the recording; otherwise it speaks the translation (NVIDIA for Hindi and English, else the phone's voice). A small link still plays the original |
| Voices (5.7) | One default voice | Each teacher picks a voice (Aria by default) for translated notes. English words in Hindi are written in Devanagari before they are spoken |

---

## 0. Hackathon build rules (hard constraints)

| # | Rule | How we meet it |
|---|------|----------------|
| R1 | Public GitHub repo | `github.com/shoumikgoswami/vidya-vaani`, public from the first commit |
| R2 | **The submission isn't scored if `docker compose up` doesn't start the app** | We build on the Docker Compose setup from Day 0 (section 16). A CI check runs `docker compose up` and `curl :3000` on every push. Nothing new is merged while it fails |
| R3 | A port in the compose file shows the app, not a default page | `ports: - "3000:3000"`. `GET /` serves the Vidya Vaani home or setup screen |
| R4 | The app starts and shows its main screen **without any secret keys** | `NVIDIA_API_KEY` is optional. Without it, each feature uses a free in-browser fallback or shows "NVIDIA key not set" (section 5.7) |
| R5 | `.env.example` with placeholders, and the app starts **without** a `.env` | The compose file loads `.env` with `required: false`, and every setting has a default. `.env.example` is committed |
| R6 | At least 300 lines of our own code, written during the hackathon | We expect over 4,000 lines. No starter template |
| R7 | Live link optional (small bonus) | The same image on an HTTPS host (the mic and camera need HTTPS) |
| R8 | Built hands-free with Wispr Flow | Specs, prompts to the AI coding tool, commit messages and docs are dictated with the Wispr Flow app and logged in `BUILT_WITH_FLOW.md` (section 20) |

**Judge-proofing:** Judges will most likely open `http://localhost:3000` on a laptop, without a phone and without keys. So:
- `localhost` counts as a secure context, so the mic and camera work there.
- **Demo mode** (section 15) is on by default. It gives:
  - one-click role switching;
  - "simulate scan" instead of a real QR scan;
  - an OTP shown on screen;
  - sample Tamil, Hindi and Bengali notes with their transcripts and translations already stored.
- A judge can run the whole cross-language flow in under 2 minutes, with no phone, printer or key.

---

## 1. Users and roles

| Role | Who | Device and setting | Languages |
|------|-----|------------------|-----------|
| **School admin** | Principal, owner or office clerk | Phone or office PC | Any supported language |
| **Teacher** | Class teacher or subject teacher, Classes 1–12 | Mid-range Android, noisy corridor, about 10 seconds per note | Her own language, often mixed with English words ("homework", "test", "fees") |
| **Parent / guardian** | Non-literate, newly literate, reading in a second language, or a busy working parent | Low-end or shared Android, patchy 4G | Home language, which may differ from the teacher's |
| **Student** | The child | No account and no phone. Carries the paper diary with the QR sticker | — |

### Permission matrix

| Action | Admin | Teacher | Parent |
|--------|:----:|:-------:|:------:|
| Create the school, set QR mode and languages | ✅ | — | — |
| Add, deactivate and assign teachers | ✅ | — | — |
| Create classes, run year-end promotion | ✅ | — | — |
| Add students to own classes, record parent phone | ✅ | ✅ (own classes) | — |
| Print QR sticker sheets, re-issue a lost QR | ✅ | ✅ (own classes) | — |
| Record a note for one child or the whole class | — | ✅ (assigned classes) | — |
| Approve a second guardian | ✅ | ✅ (class teacher) | — |
| Listen to and read notes (marked "heard" automatically) | — | ✅ (own notes) | ✅ (own children) |
| Send a voice reply | — | ✅ | ✅ |
| See listen receipts and metrics | ✅ (school) | ✅ (own classes) | — |
| Request deletion of own data | — | — | ✅ |

One person can hold several roles, for example a teacher who is also a parent. They get a role switcher.

---

## 2. Core concepts

### 2.1 QR codes (the admin picks one mode per school)

| | **Per-student QR** (default) | **Per-school QR** |
|---|---|---|
| Encodes | `{PUBLIC_BASE_URL}/s/{student_token}` | `{PUBLIC_BASE_URL}/k/{school_token}` |
| Printed as | One sticker per child, on the diary cover | One QR for the whole school, as a poster or the same sticker on every diary |
| Teacher scans | That child's record screen opens | Class picker → student grid, with names read aloud → record |
| Parent scans | That child's diary opens | Login → children linked to their phone |
| Best for | Seamless scan → speak → done | Schools that won't print a sticker per child |

- **Generation:** A token is created automatically when a student is registered. The server renders the QR as SVG or PNG.
- **Token:** 22 random base62 characters, about 128 bits. The QR contains no personal data.
- **Tied to the student, not the diary:** For a new diary or a new year, print the *same* QR again, so the history carries on.
- **Rotation:** If a diary is lost or misused, a teacher or admin can **rotate** the token. The old QR then shows "This QR is no longer active". Every rotation is logged.
- **A scan alone never gives access.** The QR says which child it is. The device also needs a verified login session (section 2.2).

### 2.2 Identity and login (no passwords)

- **Login:** Phone number plus a 6-digit OTP. This creates an httpOnly session cookie that lasts 180 days on that device.
- **Parent linking:** The teacher records the parent's phone number when adding a student. A parent who verifies that same number is linked **instantly**. A different number, such as a second guardian or relative, needs one-tap approval from the class teacher.
- **Teachers:** The admin adds the teacher's phone number. Her first login links her to the school and her classes.
- **First-run wizard:** On a fresh install, `/` opens a setup wizard: school name, admin name and phone, default language and QR mode. That phone becomes the owner admin.
- **OTP delivery:**
  - If an SMS key is set, the code is sent by SMS.
  - If not, a banner says "SMS key not set — demo OTP shown" and the code appears on screen.
  - Limits: 5 attempts per code, 10-minute expiry, at most 3 sends per phone per 15 minutes.

### 2.3 Telling students apart without IDs
- A student is identified by `school + class + normalised name + parent phone`. The roll number is optional.
- If the class already has a student with the same name, the app warns about a possible duplicate. Matching is fuzzy and works across scripts. The teacher can confirm it's a different child.
- One parent phone can be linked to several children, for siblings.

### 2.4 Academic years and promotion
- Each class belongs to an academic year (`2026-27`).
- **Promotion wizard:** Class 5A 2026-27 becomes 6A 2027-28.
  - The admin unticks students who are held back or have left.
  - Promoted students keep their token and all their notes.
  - New sticker sheets can be printed if needed.
- Parents see notes grouped by year and class.

---

## 3. User journeys

### J1 — School setup (admin, about 5 minutes)
1. Run the setup wizard (first run only).
2. Settings: QR mode, enabled languages, default language, logo (optional).
3. Add teachers with name, phone, subjects and speaking language. Teachers can also be added by voice ("Meena Kumari, 98…, Hindi aur Maths"). An NVIDIA LLM picks out the fields (section 5.4).
4. Create classes and assign class teachers and subject teachers.

### J2 — Adding students and printing QRs (teacher or admin)
1. Open a class and tap **Add students**.
2. Add students in any of three ways:
   - **Speak:** "Ravi Kumar, papa ka number 98…". The app extracts the name and number, and the teacher confirms.
   - **Type.**
   - **Paste a list:** one student per line, for example copied from WhatsApp.
3. Each student gets a token and QR as soon as they are saved.
4. **Print stickers:** an A4 sheet with 12 or 24 stickers per page. Each sticker shows the QR, the child's name, class, school and logo. The sheet uses print CSS and has a "Save as PDF" button.
5. In per-school mode, print the school QR instead.

### J3 — Teacher records a note for one child (the core loop, target 15 seconds or less)
1. The teacher taps **Scan** in the app, or points her phone camera at the sticker.
2. The record screen opens with the child's name, class and initial in large text. The app says "Ravi, Class 5A. बोलिए।" in the teacher's language, and the mic starts by itself.
   - If the page was opened from the phone's camera app, the browser needs one tap first. The app shows a full-screen **🎤 Tap to speak** button. From the in-app scanner, no tap is needed.
3. The teacher speaks normally: "Kal Hindi ki kitab ka page barah ki kavita yaad karni hai. Shukrawar tak fees jama karni hai."
   - While she speaks, the screen shows a live waveform, a noise meter and the words as she says them (from the browser's own speech recognition, if available).
   - Recording stops after 2 seconds of silence, when she taps Stop, or at the 2-minute limit.
4. The app says "समझ रहा हूँ…" and shows a confirmation card with:
   - **Transcript:** in the original script, from NVIDIA speech-to-text (section 5.2). Uncertain words are highlighted in amber.
   - **Clean version:** filler words removed (section 5.3), with a toggle back to the raw transcript.
   - **Language chip:** for example "हिन्दी". Tapping it re-transcribes the same audio in another language.
   - **Tag chips with dates:** for example `📘 Homework · Hindi · Tomorrow (Sat 22 Nov)` and `₹ Fee · Fri 28 Nov`. Tap a chip to edit or remove it.
   - **Read-back:** every number, date, amount and name.
   - **Buttons:** a big green **Save**, plus **Re-record** and **Play back**.
5. She taps Save, or says a confirmation word: "save", "ठीक है", "हाँ", "சரி", "ঠিক আছে" and so on. The app chimes and says "हो गया।"
6. The audio is saved first. Translations, notifications and receipts are then handled in the background.
7. **Next-student loop:** the scanner reopens within 1 second, so the rhythm is scan → speak → done → next.

### J4 — A note for the whole class, or some students
- A toggle on the record screen offers **This child / Whole class / Select students**. There is also a "🎤 Note for whole class" button on the class screen, with no scan needed.
- One recording goes into every selected child's diary, with a separate listen receipt for each child.
- **Why:** the teacher shouldn't have to scan 40 diaries for the same homework. Teacher time is the main adoption risk named in our impact answer.

### J5 — Parent's first scan and linking
1. The parent scans the sticker with their phone camera. It opens in the browser, with nothing to install.
2. The welcome screen is read aloud. The parent picks their language from large tiles, each written in its own script.
3. They type their phone number on a number pad, then the OTP.
4. If the number matches the one recorded for that child, they are **linked straight away**. If not, they see "Request sent to Ravi's teacher", and the screen updates when the teacher approves.
5. **One-time consent screen**, read aloud. It covers what is stored and who can hear it. It also says that audio is processed by a cloud AI service (NVIDIA) to make transcripts and translations. The parent taps "Agree".
6. The app prompts them to **add it to the home screen** and **allow notifications**, so they don't have to scan every day.

### J6 — Parent listens and replies
1. A push notification arrives: "Ravi ki teacher ka naya sandesh 🎤".
2. The parent opens the notification, scans the sticker, or opens the home-screen icon. The newest note appears with a **very large Play button**. It plays by itself if the browser allows; otherwise it takes one tap.
3. Under the player:
   - The translation in the parent's language, with a toggle to the original transcript.
   - A 🔊 button that reads the translation aloud (section 5.6).
   - Tag icons: 📘 homework, ₹ fee, ✏️ exam or test, 📅 event or parent-teacher meeting, 🏖 holiday, 📢 notice.
   - The due date in large text, with a countdown ("2 din baaki").
4. When the parent plays the note, a "heard ✓" receipt is sent automatically.
5. **🎤 Reply:** the parent can say, for example, "Samajh gaya" or "Ravi kal nahi aayega, bimaar hai". The reply is transcribed and translated into the teacher's language.
6. **Diary view:**
   - All notes, newest first, grouped by date.
   - Filters: Homework, Fee, Exam, Notice, and Pending or Done.
   - A "This week" summary at the top, which can be read aloud.
7. A parent with more than one child gets a child switcher.

### J7 — Teacher inbox and receipts
- Each note shows "Heard by 31/40 parents". Tapping it shows who hasn't heard it yet, with a one-tap reminder (push nudge).
- Parent replies arrive in a voice inbox for each class, with transcript and translation. The teacher can answer by voice.

### J8 — Due-date reminders
- At 6 pm the day before a homework, fee or exam deadline, the parent gets a push reminder. The note is pinned to the top of the diary.

### J9 — Lost diary or damaged QR
- **Lost diary:** reprint the same QR, or rotate the token if the old one could be misused.
- **Unknown or unreadable QR:** the app shows "QR नहीं मिला". A teacher gets the class list, with names read aloud. A parent gets their linked children.

---

## 4. Screens

| # | Screen | Role | Key elements |
|---|--------|------|--------------|
| S1 | Home / setup wizard | All | "Scan QR", "Login", demo entry. The wizard appears on first run |
| S2 | Login (phone + OTP) | All | Number pad, OTP boxes, demo OTP banner |
| S3 | Language picker | All | A tile per language in its own script, read aloud on tap |
| S4 | Scanner | Teacher, Parent | Full-screen camera, torch, "Can't scan? Pick from list" |
| S5 | Record | Teacher | Name and class header, recipient toggle, mic, waveform, noise meter, live text |
| S6 | Confirmation card | Teacher | Raw and clean transcript, amber words, language chip, tags, read-back, Save / Re-record |
| S7 | Class dashboard | Teacher | Student grid, whole-class note, receipts, approvals, print stickers |
| S8 | Teacher inbox | Teacher | Parent replies, voice reply |
| S9 | Parent diary | Parent | Child switcher, latest note player, filters, weekly summary |
| S10 | Note detail | Parent, Teacher | Player, translation/original toggle, read aloud, tags, due date, reply |
| S11 | Admin: settings | Admin | QR mode, languages, **AI provider status** for each language |
| S12 | Admin: teachers and classes | Admin | Add, assign, deactivate |
| S13 | Admin: promotion wizard | Admin | Move to the next year |
| S14 | Admin: metrics | Admin | See section 14 |
| S15 | Sticker print sheet | Admin, Teacher | A4, 12 or 24 per page, PDF |
| S16 | Mic and camera help | All | Picture guide for each browser |
| S17 | Privacy, consent and deletion | Parent | Consent read aloud, delete request |

**UI rules:**
- Mobile-first at 360px wide. Touch targets at least 56px. Colour contrast meets WCAG AA.
- Every instruction is shown as an icon, as text and as audio. No screen relies on reading alone.
- Urdu, Kashmiri and Sindhi display right to left.
- Supported browsers: Chrome on Android 100+, Samsung Internet and desktop Chrome. Safari on iOS works, with the limits in section 5.7.

---

## 5. Voice and AI pipeline (free NVIDIA Build models)

### 5.1 What we use from NVIDIA Build, and the limits

All model calls go **from our server** to NVIDIA's free hosted endpoints with one key: `NVIDIA_API_KEY` (starts with `nvapi-`, created at build.nvidia.com). The key is never sent to the browser.

| Job | Model on NVIDIA Build | How it's called | Indian languages covered (from the model docs, checked 21 Nov 2026) |
|---|---|---|---|
| **Speech-to-text, first choice for Hindi, Bengali and Tamil** | `nvidia/parakeet-1.1b-rnnt-multilingual-asr`, **Indic type** | Riva gRPC at `grpc.nvcf.nvidia.com:443`, function-id `71203149-d3b7-4460-8231-1be2543a1fca` | hi-IN, bn-IN, ta-IN, en-US. Tuned for Indian and mixed-language speech. Doesn't report which language it detected |
| **Speech-to-text, all other languages** | `openai/whisper-large-v3` | Riva gRPC, function-id `b702f636-f60c-4a3d-a6f4-f3568c13bd7d`. Language code `multi` detects the language automatically | hi, bn, ta, te, mr, gu, kn, ml, pa, ur, ne, as, sa, sd, en (Whisper's language list) |
| **Translation, clean-up, tagging, filling forms by voice** | An instruction LLM through the OpenAI-compatible API at `https://integrate.api.nvidia.com/v1/chat/completions`. The model is set by `NVIDIA_LLM_MODEL` and chosen on Day 1 (section 5.4) | HTTPS REST | Depends on the model. Must be tested for each language |
| **Translation, Hindi ↔ English only** | `nvidia/riva-translate-4b-instruct-v2` | OpenAI-compatible chat | Hindi is its only Indian language. We use it where it beats the LLM in our test |
| **Text-to-speech** | `nvidia/magpie-tts-multilingual` | HTTP `POST https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize` (form fields: text, language, voice, encoding, sample_rate_hz) | **Only hi-IN and en-US** of our languages |

**Limits:**
- **Rate limit:** The free tier allows about **40 requests per minute per model**. Going over that returns an HTTP 429 error. Your exact limit and credits are shown on the build.nvidia.com dashboard.
- **Terms of use:** The free tier is for **prototyping and evaluation**, not production. After the hackathon, a real rollout would need self-hosted NIM containers (same API) or a paid provider. The provider layer can be swapped, so this is a configuration change.
- **Not yet confirmed:** Function IDs and model names can change, so all of them live in configuration (`server/providers/nvidia/models.json`). Each one is tested on Day 1 (section 16).

### 5.2 Speech-to-text

**Interface:** `transcribe(audio, { languageHint }) → { text, language, words[{w, conf}]?, provider }`

1. **Recording:** The browser records Opus/WebM audio, which is kept for playback, and uploads it.
2. **Conversion:** The server uses **ffmpeg** (included in the Docker image) to make **16 kHz, mono, 16-bit** audio. It sends this as LINEAR_PCM WAV, or as FLAC if the WAV would be over 3.5 MB.
   - gRPC limits messages to 4 MB by default, so we raise the client limit and cap notes at 2 minutes.
   - Anything still too big is sent through `StreamingRecognize` in 100 ms chunks.
3. **Model choice by language:**

   | Teacher's speaking language | First choice | Second choice | Third choice |
   |---|---|---|---|
   | hi, bn, ta | Parakeet 1.1b, Indic type, with code `hi-IN`, `bn-IN` or `ta-IN` | Whisper large v3 | The browser's live text |
   | te, mr, gu, kn, ml, pa, ur, ne, as, sa, sd, en | Whisper large v3, with that language code | The browser's live text | Audio only |
   | or, kok, mai, doi, brx, sat, mni, ks | Whisper with the nearest supported language (mai, doi, kok and brx → hi or mr in Devanagari; ks → ur), labelled **"approximate transcript"** | The browser's live text, if the device supports it | **Audio only** |

   If the teacher's language isn't set, or she taps "Auto", the app uses Whisper with the code `multi`.
4. **Riva settings:** `RecognitionConfig { encoding, sample_rate_hertz: 16000, language_code, enable_automatic_punctuation: true, max_alternatives: 1, enable_word_time_offsets: true }`.
   - Word confidence comes from `words[].confidence` when the model returns it.
   - Otherwise, words that differ between NVIDIA's transcript and the browser's live text are marked amber.
5. **Mixed languages:** English words stay in Roman script inside the native-script transcript ("कल test है"). The transcript is never forced into one "pure" language.
6. **Re-transcribing:** Tapping the language chip runs the saved audio again with the new language code. Nothing has to be re-recorded.
7. **Live text while recording (no key needed):** The browser's Web Speech API (`xx-IN` languages on Chrome) shows words as the teacher speaks. This gives:
   - instant feedback for the teacher;
   - a fallback when there is no NVIDIA key;
   - a second opinion for spotting uncertain words.

### 5.3 Clean-up (polishing the transcript in the style of Wispr Flow, using the LLM)
- **The request:** The raw transcript goes to the NVIDIA LLM with this instruction: *Remove filler words and false starts. Fix obvious recognition errors using the class context. Keep the speaker's language, tone and any mixed-in English. Do not add information. Return JSON `{ clean, changes[] }`.*
- **Context sent with it:** The selected students' names, the school name, the teacher's subjects and recent tags. This helps fix misheard names.
- **What the teacher sees:** The card shows the **clean** version by default, with a "Show original" toggle. Both versions are stored. Parents can always also hear the teacher's real audio.
- **Safety check:** Numbers, amounts, dates and names in the clean text must match what was extracted (section 5.4). If they don't, the app shows the raw text and flags the mismatch.

### 5.4 Understanding the note: tags, dates and key details (LLM + rules)
- **Interface:** `extract(text, lang, today, schoolCalendar) → { tags[{type, subject?, dueDate?}], entities{amounts, pages, dates, names}, ambiguities[] }`.
- **With a key:**
  - The NVIDIA LLM is called at temperature 0, with a JSON schema (`response_format` where the model supports it).
  - The output is checked with `zod`, with one retry if it is invalid.
- **Without a key, or if the LLM fails:**
  - A rule engine with keyword lists for each language (homework → गृहकार्य/होमवर्क/বাড়ির কাজ/வீட்டுப்பாடம்; fee → फीस/ফি/கட்டணம்; exam → परीक्षा/টেস্ট/தேர்வு).
  - A date-word parser (kal, parso, weekday names, numeric dates).
  - Number words are converted to digits.
  - If nothing is found, the teacher taps a tag chip herself.
- **"Kal" in Hindi and Urdu** can mean yesterday or tomorrow. In a homework or deadline context it is read as tomorrow, and the actual date is always shown for confirmation.
- **Filling forms by voice:** The same LLM call adds teachers and students from speech (J1, J2).

**Choosing the LLM (Day 1, about 1 hour):**
- **Candidates:** Instruction models currently on build.nvidia.com, for example:
  - `meta/llama-4-maverick-17b-128e-instruct`
  - `google/gemma-4-31b-it`
  - `qwen/qwen3.5-122b-a10b`
  - `mistralai/mistral-large-3-675b-instruct-2512`

  Sarvam-M is marked deprecated, so we don't use it.
- **Test set:** 30 real diary sentences: 10 Hindi or Hinglish, 10 Tamil or Tanglish, 10 Bengali.
- **What we score:**
  1. Valid JSON output.
  2. Correct tags and dates.
  3. Translation quality into hi, ta, bn, te and en, checked by a native speaker where we have one.
  4. Median response time.
- **Result:** The best model becomes the default and the runner-up the fallback (`NVIDIA_LLM_MODEL`, `NVIDIA_LLM_FALLBACK`). The scores are saved in `docs/model-eval.md`.

### 5.5 Translation
- **Interface:** `translate(text, from, toLangs[]) → { [lang]: { text, provider } }`.
- **One call for all languages:** One LLM call translates a note into **every language needed**. That means each linked parent's reading language, plus English. It returns JSON such as `{ "hi": "...", "ta": "...", "en": "..." }`. This keeps us within the 40-requests-per-minute limit.
- **Protected details:** Names, amounts, dates and page numbers are swapped for placeholders (`⟦N1⟧`) before translation and put back afterwards, so they can't be mistranslated.
- **Meaning over word-for-word:** The prompt asks for plain, simple wording that a parent with little schooling would understand. Common English words ("homework", "test", "fees") are kept as they are.
- **Hindi ↔ English:** Uses `riva-translate-4b-instruct-v2` if it scored better in the Day 1 test.
- **New languages on demand:** If a parent switches to a language that hasn't been translated yet, it is translated then and saved in `note_translation`.
- **Languages with little training data** (sat, mni, brx, doi, ks, kok, mai, sd): LLM quality is uncertain. These translations carry the badge **"मशीन अनुवाद — गलत हो सकता है"** ("machine translation, may be wrong"), and the English version is always shown underneath.
- **No key, or translation fails:**
  - Chrome's built-in on-device Translator is used where the browser has it.
  - Otherwise the original is shown with "अनुवाद अभी उपलब्ध नहीं" ("translation not available yet") and a retry button.
  - A note is never blocked from saving because of translation.

### 5.6 Text-to-speech
- **Used for:** app prompts ("बोलिए", "हो गया" and so on), reading translations aloud, student names in pickers, and the weekly summary.
- **Order of preference:**
  1. **Magpie TTS Multilingual** for Hindi and English, with a Hindi voice such as `Magpie-Multilingual.HI-IN.Aria`. The list of voices is fetched from `/v1/audio/list_voices` when the server starts.
  2. The browser's `speechSynthesis`, for languages the device has a voice for. Many Android phones have Indian-language voices through Google TTS.
  3. Text and icons only.
- **Caching:** App prompts are generated once per language and saved as audio files, so they work offline. If someone records the prompts by voice, those recordings are used instead (section 19).
- **The teacher's voice comes first:** For parents, the main audio is always **the teacher's own recording**. TTS is only for translations and app prompts.

### 5.7 What works with and without the NVIDIA key

| Feature | With `NVIDIA_API_KEY` | Without any keys (default `docker compose up`) |
|---|---|---|
| Recording and playing audio | ✅ | ✅ (never needs a key) |
| Speech-to-text | Parakeet (hi, bn, ta) and Whisper (14 more languages), on the server | The browser's speech recognition on Chrome and Edge. Elsewhere: audio only, with "NVIDIA key not set" |
| Clean-up | LLM | Raw transcript shown |
| Tags and dates | LLM + rules | Rules + tapping tags by hand |
| Translation | LLM (all languages in one call), plus Riva for Hindi ↔ English | Chrome's on-device Translator where available. Otherwise the original, with "key not set" |
| Text-to-speech | Magpie (hi, en) + browser | The browser's `speechSynthesis` |
| Filling forms by voice | LLM | Typed entry, with the browser's live text filling the field |
| OTP | SMS provider if set | OTP shown on screen |
| Push notifications | Web Push. Its VAPID keys are generated on first start, so **no external key** is needed | ✅ same |
| Making and scanning QRs | ✅ local libraries | ✅ |
| Sample demo notes | ✅ | ✅ Transcripts and translations are stored in the seed data, so the cross-language demo still works |

The admin's **AI provider status** panel (S11) shows what each language currently uses: `✅ NVIDIA Parakeet` / `✅ NVIDIA Whisper` / `⚪ browser only` / `⚪ audio only` / `⚪ key not set`.

### 5.8 Staying within free-tier limits
- **Queue:** All NVIDIA calls go through a server-side job queue, with a limit for each model set to 35 requests per minute to leave headroom.
- **Rate-limit errors (429):** These are retried with exponential backoff and jitter. The note shows "transcribing…" and the teacher carries on working.
- **About 3 calls per note:** one speech-to-text call, one LLM call that does clean-up and tagging together, and one LLM call for all translations. A whole-class note is still one recording, so it is still about 3 calls.
- **Caching:** Translations are saved per note and language, and app prompts as audio files. A note is only re-transcribed when the teacher asks.
- **Tracking:** The metrics page shows NVIDIA calls per day and the 429 error rate.

### 5.9 Recording on the phone
- **Mic settings:** `getUserMedia` with `{ noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 }`.
- **Format:** `MediaRecorder` records Opus/WebM at 24 kbps mono (about 180 KB a minute). Safari falls back to MP4/AAC.
- **Noise meter:** A WebAudio `AnalyserNode` measures loudness. It compares the background noise in the first 300 ms with the speech level, giving a signal-to-noise ratio (SNR).
- **Auto-stop:** Recording stops after 2 seconds of silence, once speech has been detected.
- **Saved before upload:** Audio is saved to IndexedDB first, then uploaded. If the upload fails, the note stays in the queue (section 7).

---

## 6. Languages

**Supported:** all 22 scheduled languages plus English: as, bn, brx, doi, gu, hi, kn, ks, kok, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur, en.

**Coverage in tiers.** These are based on NVIDIA's model docs and will be confirmed by the Day 1 test.

| Tier | Languages | Speech-to-text | Translation | Text-to-speech |
|---|---|---|---|---|
| **A — full** | hi, bn, ta, en | NVIDIA Parakeet (Indic), then Whisper | NVIDIA LLM (+ Riva for Hindi ↔ English) | hi, en: Magpie. bn, ta: browser |
| **B — good** | te, mr, gu, kn, ml, pa, ur | NVIDIA Whisper | NVIDIA LLM | Browser (most Android phones have voices) |
| **C — partial** | ne, as, sa, sd | NVIDIA Whisper (weaker) | NVIDIA LLM, with the "may be wrong" badge | Browser, where available |
| **D — audio first** | or, kok, mai, doi, brx, sat, mni, ks | Approximate (nearest language), or audio only | NVIDIA LLM, with the "may be wrong" badge, plus English | Text only |

**What tier D still gets:**
- The core promise still holds: the parent **hears the teacher's own voice**.
- The app's screens are fully in their language.
- Tags can always be added with one tap.

We say this openly in the README, rather than claiming full support for all 22 languages.

| Item | Rule |
|---|---|
| App text | `client/i18n/{lang}.json`, about 120 strings, all 23 languages shipped. Missing strings fall back to English. Strings drafted by machine are marked `"_review": true` until a native speaker checks them |
| Fonts | Noto Sans fonts are bundled with the app (not loaded from the internet), so they work offline: Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati, Gurmukhi, Oriya, Ol Chiki, Meetei Mayek, Arabic/Nastaliq. Each font loads only when needed |
| Text direction | `dir="rtl"` for ur, ks, sd |
| Each person's languages | Teacher: speaking language and app language. Parent: reading language and app language. Each note keeps its original language |
| Spoken prompts | Every phrase in section 8 has a version in each language |

---

## 7. When things go wrong

| Situation | How it's detected | What the app does and says |
|---|---|---|
| **Background noise** | Signal-to-noise ratio below the threshold | The meter turns red. After recording: "थोड़ा शोर है। फ़ोन को मुँह के पास रखिए।" ("It's a bit noisy. Hold the phone near your mouth.") with **Re-record** or **Save anyway**. The raw audio is always kept |
| **Uncertain words** | Word confidence under 0.7, or NVIDIA's transcript disagrees with the browser's | Highlighted in amber. The teacher taps the word, says it again, and it's replaced |
| **Accent or dialect errors** | Low overall confidence, or the clean-up made many changes | "Transcript may be wrong — parents will also hear your voice". She can still save |
| **Wrong language detected** | Whisper's auto-detected language doesn't match the hint, or the teacher taps the chip | The same audio is re-transcribed in the chosen language |
| **Mixed languages** | Always expected | English words stay in Roman script. Translation goes by meaning |
| **Unclear number or date** | Two or more possible values found | "पेज 12 या 2?" ("Page 12 or 2?") with two big buttons. The chosen value is then read back |
| **Silence** | No speech for 5 seconds after the mic opens | "कुछ सुनाई नहीं दिया। फिर से बोलिए।" ("I couldn't hear anything. Please speak again.") It tries once more, then shows a button |
| **Too short** | Under 1 second of speech | Discarded with "फिर से बोलिए" ("Please speak again") |
| **Mic permission refused** | `NotAllowedError` | The picture guide (S16), plus a typed-note fallback. This is the only typing in the app |
| **Scan fails** | Camera error, or nothing read in 10 seconds | "QR नहीं मिला" ("QR not found"), a pick-from-list fallback with names read aloud, and a torch button |
| **Cancelled or unknown QR** | Server returns 404 or 410 | "This QR is no longer active. Ask the teacher for a new sticker." |
| **No internet** | `navigator.onLine`, or a failed request | Saved on the phone (IndexedDB): "नेटवर्क नहीं है। नोट फ़ोन में सेव है।" ("No network. The note is saved on the phone.") It uploads automatically later, with a pending badge |
| **NVIDIA rate limit** | HTTP 429 | Waits and retries. The note shows "transcribing…" and the teacher carries on |
| **NVIDIA down or slow** | Server error, or timeout (20 s for speech-to-text, 15 s for the LLM) | Tries the next provider or model in the chain. If all fail, the note is marked "transcript pending" and retried for up to 6 hours. The browser's live text is shown meanwhile |
| **LLM returns invalid JSON** | `zod` validation fails | One retry with a stricter prompt, then the rule engine |
| **Clean-up changed a number or name** | Comparison with the extracted details | The raw text is shown and the mismatch is flagged |
| **Translation failed** | Every provider returned an error | The original, plus "अनुवाद अभी उपलब्ध नहीं" ("translation not available yet") and a retry button |
| **Autoplay blocked** | `play()` is rejected | A giant ▶ button |
| **Parent's phone not on record** | OTP verified, but no matching number | A pending-approval screen, and a push to the teacher |
| **Possible duplicate student** | Fuzzy name match within the class | "Same child? / Different child" |
| **Audio too large for gRPC** | Over 3.5 MB after conversion | Sent as FLAC, or through streaming recognition |

---

## 8. What the app says and shows (phrase list)

Every response is **spoken and shown on screen**, in the user's language. Hindi examples:

| Key | Hindi |
|---|---|
| `ready` | "{name}, कक्षा {class}। बोलिए।" |
| `processing` | "समझ रहा हूँ…" |
| `saved` | "हो गया। नोट सेव हो गया।" |
| `saved_class` | "हो गया। {n} बच्चों को भेज दिया।" |
| `retry_unclear` | "आवाज़ साफ़ नहीं आई। फिर से बोलिए।" |
| `noisy` | "थोड़ा शोर है। फ़ोन को मुँह के पास रखिए।" |
| `silence` | "कुछ सुनाई नहीं दिया। फिर से बोलिए।" |
| `offline_saved` | "नेटवर्क नहीं है। नोट फ़ोन में सेव है।" |
| `qr_not_found` | "QR नहीं मिला।" |
| `parent_new_note` | "{child} की टीचर का नया संदेश।" |
| `parent_due_tomorrow` | "कल {tag} की आख़िरी तारीख़ है।" |
| `confirm_number` | "पेज {a} या {b}?" |
| `mt_warning` | "मशीन अनुवाद — गलत हो सकता है।" |

---

## 9. Data model (SQLite, with migrations)

```sql
school(id, name, address, logo_path, qr_mode CHECK IN ('per_student','per_school'),
       school_token UNIQUE, default_lang, enabled_langs JSON, academic_year, created_at)

user(id, phone UNIQUE, name, ui_lang, created_at)
membership(id, user_id, school_id, role CHECK IN ('admin','teacher','parent'),
           admin_level NULL CHECK IN ('owner','staff'), speak_lang NULL, active, created_at)

class(id, school_id, name, section, academic_year, class_teacher_id → membership, created_at)
class_teacher(class_id, membership_id, subjects JSON)

student(id, school_id, class_id, name, name_normalised, roll_no NULL,
        parent_phone, token UNIQUE, token_rotated_at NULL, active, created_at)
student_history(id, student_id, class_id, academic_year, from_date, to_date)

guardian_link(id, student_id, user_id, relation, read_lang,
              status CHECK IN ('active','pending','rejected','revoked'),
              auto_verified BOOL, approved_by → membership NULL, consent_at, created_at)

note(id, school_id, class_id, author_membership_id,
     kind CHECK IN ('teacher_note','parent_reply'), parent_note_id NULL,
     audio_path, audio_mime, duration_ms, snr_db,
     transcript_raw, transcript_clean, transcript_lang, transcript_conf, words JSON,
     browser_preview_text NULL,                       -- keyless fallback + second opinion
     stt_provider, stt_model, llm_model,              -- e.g. 'nvidia','parakeet-1.1b-indic','llama-4-maverick'
     tier CHECK IN ('A','B','C','D'),
     status CHECK IN ('uploaded','transcribing','ready','transcript_failed','audio_only'),
     created_at, client_uuid UNIQUE)                  -- idempotent offline sync
note_recipient(note_id, student_id, PRIMARY KEY(note_id, student_id))
note_tag(id, note_id, type CHECK IN ('homework','fee','exam','event','holiday','notice'),
         subject NULL, due_date NULL, source CHECK IN ('llm','rules','teacher'))
note_translation(note_id, lang, text, provider, model, machine_warning BOOL, created_at,
                 PRIMARY KEY(note_id, lang))
listen_receipt(note_id, student_id, user_id, first_played_at, play_count,
               PRIMARY KEY(note_id, student_id, user_id))

job(id, type, payload JSON, model, attempts, run_after, status, last_error)   -- rate-limited AI queue
ai_usage(day, model, calls, errors_429, errors_other)                         -- free-tier monitoring
otp(phone, code_hash, expires_at, attempts, sent_count_window)
session(id, user_id, device_label, created_at, last_seen_at, expires_at)
push_subscription(id, user_id, endpoint UNIQUE, keys JSON, created_at)
tts_cache(lang, voice, text_hash, audio_path, PRIMARY KEY(lang, voice, text_hash))
audit_log(id, actor_user_id, action, entity, entity_id, meta JSON, created_at)
setting(key PRIMARY KEY, value)                                                -- VAPID keys, session secret, demo flag
```

- **Audio files** are stored at `/data/audio/{school}/{yyyy}/{mm}/{note_id}.webm`. They are only served through an endpoint that checks permission, never as public files.
- **Data survives restarts**, because `/data` is a Docker volume.

---

## 10. API (REST + JSON, cookie session)

```
POST /api/setup                          first-run wizard (only when no school exists)
POST /api/auth/otp/send   {phone}
POST /api/auth/otp/verify {phone, code}  → session cookie
POST /api/auth/logout
GET  /api/me                             roles, schools, children, languages

GET  /api/resolve/s/:token               → {student, viewerRole, access: 'record'|'listen'|'request'}
GET  /api/resolve/k/:schoolToken         → {school, viewerRole, classes|children}

# admin
GET/PATCH  /api/school
GET        /api/school/providers         AI provider status per language
CRUD       /api/teachers, /api/classes
POST       /api/classes/:id/promote
GET        /api/metrics

# teacher
GET/POST   /api/classes/:id/students     single, bulk paste, or voice (audio → LLM form-fill)
PATCH      /api/students/:id
POST       /api/students/:id/rotate-token
GET        /api/classes/:id/stickers?per_page=12|24
GET        /api/qr/:token.svg
POST       /api/notes            multipart: audio, client_uuid, recipients[], lang_hint, browser_preview_text?
GET        /api/notes/:id/status          poll while transcribing (or SSE /api/notes/:id/events)
PATCH      /api/notes/:id                 edit transcript / tags
POST       /api/notes/:id/retranscribe {lang}
POST       /api/notes/:id/respeak {wordIndex} + audio
POST       /api/notes/:id/nudge
GET        /api/classes/:id/inbox
POST       /api/approvals/:linkId {action: approve|reject}

# parent
POST       /api/links/request    {token, relation}
POST       /api/links/:id/consent
GET        /api/children/:id/notes?tag=&status=&cursor=
GET        /api/notes/:id                 transcript + translation in the viewer's read_lang
GET        /api/notes/:id/translation/:lang
POST       /api/notes/:id/listened
POST       /api/notes/:id/reply   multipart audio
GET        /api/notes/:id/audio           authorised stream (Range supported)
GET        /api/tts?lang=&text=           cached TTS (Magpie, or 204 → client uses speechSynthesis)
POST       /api/push/subscribe
POST       /api/privacy/delete-request

# demo
POST /api/demo/reset                     only when DEMO_MODE=true
GET  /healthz                            always 200 once the server is up (does not depend on NVIDIA)
```

**Every request is permission-checked on the server**, using the `membership` and `guardian_link` tables. A parent can never read another child's note, even by guessing IDs.

---

## 11. Architecture and repo layout

**Stack:** one container, so it starts reliably for the judges.
- **Server:** Node.js 20, Express, `better-sqlite3`, `multer`, `qrcode`, `web-push`, `zod`.
- **Talking to NVIDIA:**
  - Speech models (Riva): `@grpc/grpc-js` and `@grpc/proto-loader`, with the Riva `.proto` files copied into the repo.
  - LLMs: plain `fetch` calls to the OpenAI-compatible endpoint.
- **Audio conversion:** `ffmpeg`, included in the image.
- **Client:** a plain-JavaScript progressive web app (PWA), with no build step. `jsQR` is bundled for browsers without `BarcodeDetector`.
- **Background jobs:** a job loop inside the server process, with a rate limit for each model.

```
vidya-vaani/
├─ docker-compose.yml
├─ docker-compose.nofile.yml           # for Compose < 2.24 (no env_file line)
├─ Dockerfile                          # node:20-slim + ffmpeg
├─ .env.example
├─ .dockerignore
├─ .github/workflows/compose-smoke.yml # docker compose up + curl :3000 on every push
├─ README.md                           # one-command start, demo walkthrough, language tiers, screenshots
├─ PRODUCT_SPEC.md
├─ BUILT_WITH_FLOW.md                  # how Wispr Flow was used to build this (section 20)
├─ docs/model-eval.md                  # Day-1 NVIDIA model test results
├─ server/
│  ├─ index.js                         # express, static, routes, job loop
│  ├─ db/ (schema.sql, migrations/, seed-demo.js)
│  ├─ auth/ (otp.js, session.js, authorize.js)
│  ├─ routes/ (setup, auth, resolve, admin, teacher, parent, notes, tts, push, demo)
│  ├─ providers/
│  │  ├─ nvidia/
│  │  │  ├─ models.json                # function IDs, model names, languages per model
│  │  │  ├─ riva-asr.js                # gRPC Recognize / StreamingRecognize (Parakeet, Whisper)
│  │  │  ├─ llm.js                     # chat completions: cleanup+extract, translate, form-fill
│  │  │  ├─ riva-translate.js          # hi↔en
│  │  │  ├─ magpie-tts.js              # HTTP synthesize + list_voices
│  │  │  └─ protos/                    # Riva .proto files (from nvidia-riva/common)
│  │  ├─ audio/ffmpeg.js               # webm/opus → 16 kHz mono WAV/FLAC
│  │  ├─ router.js                     # picks provider by language + tier, fallback chain
│  │  ├─ ratelimit.js                  # per-model token bucket, 429 backoff
│  │  └─ sms/ (msg91.js, twilio.js, none.js)
│  ├─ nlp/ (lexicon/{lang}.json, dates.js, numbers.js, tags.js, placeholders.js)
│  └─ jobs/ (transcribe.js, enrich.js, translate.js, notify.js, reminders.js)
├─ client/
│  ├─ index.html, app.js, router.js, sw.js, manifest.webmanifest
│  ├─ views/ (home, login, scan, record, confirm, class, inbox, diary, note, admin/*)
│  ├─ lib/ (recorder.js, vad.js, noise-meter.js, offline-queue.js, live-preview.js,
│  │        tts.js, translator-fallback.js, i18n.js, qr-scan.js)
│  ├─ i18n/{23 locales}.json
│  ├─ audio/prompts/{lang}/*.mp3       # cached or human-recorded prompts
│  └─ fonts/ (Noto subsets)
├─ demo/ sample-notes/{hi,ta,bn,...}.webm + seed transcripts and translations
└─ tests/ (api.test.js, nlp.test.js, providers.mock.test.js, e2e-smoke.sh)
```

**docker-compose.yml:**
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - path: .env
        required: false        # app must start without .env
    environment:
      PORT: 3000
      DEMO_MODE: "true"
    volumes:
      - vv-data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 10s
      retries: 5
    restart: unless-stopped
volumes:
  vv-data:
```

**Notes on the setup:**
- **Older Docker Compose:** `env_file.required: false` needs Docker Compose v2.24 or newer. The README says so and gives `docker compose -f docker-compose.nofile.yml up` for older versions.
- **Dockerfile:**
  - Based on `node:20-slim`, plus `ffmpeg` and `wget` (for the health check).
  - `better-sqlite3` uses its prebuilt binary, with build tools as a fallback.
  - Installs with `npm ci --omit=dev` and runs as a non-root user.
- **Processor types:** Build and test on **amd64** (GitHub CI) and on **arm64** (the Oracle server). Judges will most likely use amd64.
- **No dependency on NVIDIA at start-up:** The app never calls NVIDIA when it starts. It runs and `/healthz` passes even with no key, or when NVIDIA is down.

---

## 12. Configuration (`.env.example`)

```dotenv
# All optional. The app starts and works without any of these.
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000   # URL encoded in QR codes; set to your HTTPS domain for phone/live use
DEMO_MODE=true                          # demo school, on-screen OTP, role switcher, simulate scan
SESSION_SECRET=                         # auto-generated and stored in /data if empty

# NVIDIA Build (build.nvidia.com → API keys). Free tier, ~40 requests/min per model.
NVIDIA_API_KEY=
NVIDIA_LLM_BASE=https://integrate.api.nvidia.com/v1
NVIDIA_LLM_MODEL=meta/llama-4-maverick-17b-128e-instruct   # final choice from Day-1 test
NVIDIA_LLM_FALLBACK=google/gemma-4-31b-it
NVIDIA_GRPC_HOST=grpc.nvcf.nvidia.com:443
NVIDIA_ASR_PARAKEET_FUNCTION_ID=71203149-d3b7-4460-8231-1be2543a1fca
NVIDIA_ASR_WHISPER_FUNCTION_ID=b702f636-f60c-4a3d-a6f4-f3568c13bd7d
NVIDIA_TTS_MAGPIE_URL=https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com
NVIDIA_TRANSLATE_MODEL=nvidia/riva-translate-4b-instruct-v2
NVIDIA_RPM_LIMIT=35

# SMS for real OTPs (otherwise the OTP is shown on screen)
SMS_PROVIDER=                           # msg91 | twilio | none
SMS_API_KEY=
SMS_SENDER_ID=
```

---

## 13. Security and privacy

- **Children's data:** We store only the child's name, class, parent's phone number and the notes. No photos, no date of birth and no biometrics. Face recognition was ruled out because of children's privacy, siblings who look alike, and faces that change as children grow.
- **Consent:** Recorded with a timestamp when a parent links (DPDP Act 2023, which covers children's data). The consent text says that audio is processed by NVIDIA's cloud AI to make transcripts and translations.
- **Sending NVIDIA as little as possible:** Only the audio and the context needed (first names, subject words) are sent. Parents' phone numbers are never sent.
- **Free-tier caveat:** NVIDIA's free tier is for evaluation. A real school rollout would move to self-hosted NIM containers, so audio stays on our own servers. The provider layer already allows this: same API, different host.
- **QR tokens:** Can't be guessed, and can be rotated. A QR alone gives no access.
- **OTPs:** Stored hashed, with expiry, attempt limits and rate limits per phone and per IP address.
- **Audio:** Only streamed to people with permission. Never on public URLs.
- **How long data is kept:** Notes are kept for the academic year plus one year, adjustable per school. A parent's delete request removes their link and listen receipts. Deleting a child's data is done by the admin.
- **Audit log:** Logins, approvals, token rotations, deletions and promotions.
- **Web security:**
  - HTTPS for the live deployment.
  - `helmet` security headers.
  - CSRF protection (same-site cookies plus a token).
  - The NVIDIA key stays on the server.

---

## 14. Metrics (built in, matching our impact claims)

| Metric | Target (8-week pilot) |
|---|---|
| % of notes played by at least one linked parent within 24 hours | 70% or more |
| Median time from scan to save | 15 seconds or less |
| Teachers active in week N ÷ teachers onboarded | 80% or more at week 8 |
| % of parents who sent at least one voice reply | 30% or more |
| Fee and exam notes heard before their due date | trend |
| Transcript quality per language (% low-confidence, % edited by teachers) | monitoring |
| NVIDIA calls per day and 429 rate, per model | stay within free-tier limits |

A manual entry form records homework completion and missed fee deadlines as reported by teachers, compared with the previous term. The app can't observe these outcomes by itself.

---

## 15. Demo mode and sample data (`DEMO_MODE=true`, the default)

**Sample school:** "Sarvodaya Vidyalaya", in per-student QR mode.
- **Teachers:**
  - Meena: Hindi, class teacher of 5A.
  - Lakshmi: Tamil, teaches Science to 5A.
  - Arjun: Bengali, class teacher of 7B.
- **Students and parents:** 10 students in 5A and 8 in 7B. Parents' languages vary; some differ from the teacher's (a Hindi-speaking parent of one of Lakshmi's students, and a Telugu-speaking parent).
- **Sample notes:** 6 notes with real audio in Hindi, Tamil and Bengali:
  - one in mixed language;
  - one about fees;
  - one for the whole class;
  - one tier-D example (Odia, audio only, with translated text).
- **Works without a key:** The raw and clean transcripts and the translations are **stored in the sample data**.

**Demo bar** (always visible in demo mode):
- "Act as: Admin / Meena / Lakshmi / Parent of Ravi…": one-click role switching, no OTP.
- "Simulate scan": a grid of students. Clicking a card counts as scanning that QR.
- "Reset demo data".
- An indicator: "AI: NVIDIA ✅ / key not set ⚪".

**Judge walkthrough** (in the README, about 2 minutes):
1. As Lakshmi, record a Tamil note (or use the sample one if there's no key).
2. As the Hindi-speaking parent, play it.
3. Read the Hindi translation.
4. Reply by voice.
5. Back as Lakshmi, see the receipt and the reply.
6. Go to Admin → AI provider status to see the language tiers.

---

## 16. Build order (this is the order only; every feature ships)

**Day 0: the Docker Compose setup comes first, and it must keep passing.**

0. **Compose setup (the first commit, before any feature):**
   - **Files:** `docker-compose.yml`, `docker-compose.nofile.yml`, a `Dockerfile` (node:20-slim + ffmpeg), `.env.example`, `.dockerignore`, and an Express server.
   - **What it serves:** a real Vidya Vaani home page on port 3000, plus `GET /healthz`.
   - **Check on a fresh copy of the repo with no `.env`:**
     1. Run `docker compose up --build`.
     2. Run `curl -f localhost:3000/healthz`.
     3. Check that `curl localhost:3000/` contains "Vidya Vaani".
   - **Automate the same check** in GitHub Actions on every push (amd64), and on the Oracle server (arm64).
   - **From then on:** every feature is built and tested *inside* the container (`docker compose watch` or a bind mount), never with a plain local `npm start`. If the check fails, fixing it comes before anything else.
1. **NVIDIA test (Day 1, about 2 hours):**
   - Get a key at build.nvidia.com.
   - Inside the container, run a short script that calls:
     - Parakeet and Whisper on 6 sample clips (hi, ta, bn, te, mr, Hinglish);
     - Magpie TTS for hi and en;
     - the 4 candidate LLMs on the 30-sentence test set.
   - Confirm the function IDs and model names, fill in `models.json`, choose `NVIDIA_LLM_MODEL` and write `docs/model-eval.md`.
   - **If a model is missing or broken,** update the tiers in section 6 before building on it.
2. Database schema, setup wizard, OTP and sessions, roles and permissions.
3. Classes and students, tokens and QRs, sticker sheet, QR lookup endpoints, both QR modes.
4. Recorder, silence detection, noise meter, live browser text, offline queue, upload, playback, receipts.
5. **NVIDIA provider layer:**
   - ffmpeg conversion;
   - Riva gRPC speech-to-text, picking Parakeet or Whisper by language;
   - LLM clean-up and extraction;
   - translation into all languages in one call, with protected details;
   - Magpie TTS plus browser TTS;
   - rate limiter and job queue;
   - fallbacks for when there's no key;
   - the confirmation card, re-transcribing, and re-speaking a single word.
6. Parent linking (automatic and approved), consent, diary, filters, replies, inbox.
7. Whole-class notes, push notifications, due-date reminders, nudges.
8. Promotion wizard, token rotation, deletion requests, audit log, metrics (including AI usage).
9. App text in 23 languages, fonts, right-to-left layout, phrase list. Sample data and recorded sample audio.
10. **Final checks:**
    - tests;
    - README with the language-tier table;
    - `BUILT_WITH_FLOW.md`;
    - live HTTPS deployment;
    - re-run section 17 on a fresh copy, **both with and without** `NVIDIA_API_KEY`.

---

## 17. Acceptance tests

**Submission gate (fresh copy of the repo, no `.env`):**
- [ ] The GitHub Actions compose check passes on the final commit.
- [ ] `git clone … && docker compose up` builds and starts without errors on amd64 and arm64.
- [ ] Within 60 seconds, `http://localhost:3000` shows Vidya Vaani, not a default page.
- [ ] With no keys, the whole app can be navigated, AI provider status shows "NVIDIA key not set", and the sample cross-language demo works.
- [ ] With `NVIDIA_API_KEY` set, a new Hindi note shows `stt_provider = nvidia` and `stt_model = parakeet…`, and its translations show `llm_model`.
- [ ] `.env.example` is present, the repo is public, our own code is well over 300 lines, and `BUILT_WITH_FLOW.md` is filled in.

**Functional tests (with an NVIDIA key unless stated otherwise):**
1. **Setup:** The admin completes setup, adds 2 teachers (one by voice), creates a class and switches QR mode. The school QR and the student stickers both print correctly.
2. **New student:** The teacher adds a student by voice. The QR appears straight away, and scanning it with the in-app scanner (webcam) opens the record screen.
3. **Hinglish note:** Parakeet transcribes it with the English words kept in Roman script. The clean version has the filler words removed. Homework and fee tags with the correct dates are suggested. Saving takes 3 taps or fewer.
4. **Cross-language:** A Tamil teacher records a note. The Hindi-speaking parent hears the Tamil audio and reads a Hindi translation, with names and amounts unchanged.
5. **Tier B:** Whisper transcribes a Telugu or Marathi note.
6. **Tier D:** An Odia note is saved as audio and labelled "approximate" or "audio only". The parent can still play it, and it can still be tagged.
7. **Noise:** A noisy recording brings up the noise prompt and offers a re-record.
8. **Unclear number:** "Page barah ya do" brings up the "पेज 12 या 2?" choice.
9. **Rate limit:** With `NVIDIA_RPM_LIMIT=2`, five quick notes are queued and all of them complete. No errors are shown to the teacher.
10. **Bad key:** With an invalid key, a note still saves with audio and the browser's text, and is shown as "transcript pending" or "key not set".
11. **Parent linking:** A parent with the matching phone is linked automatically. A parent with a different phone goes to pending and is linked after the teacher approves.
12. **Access control:** A parent can't open another child's note by its ID (403 error).
13. **Offline:** A note recorded in airplane mode is queued and uploads after reconnecting, with no duplicate (`client_uuid`).
14. **Whole class:** A whole-class note reaches all 10 diaries, and the receipts update as each parent plays it.
15. **Parent reply:** A parent's voice reply appears in the teacher's inbox, translated into her language.
16. **Lost diary:** After the token is rotated, the old QR shows "no longer active".
17. **Promotion:** 5A becomes 6A, and the old notes are still visible to parents.
18. **Languages:** Urdu displays right to left. Santali shows Ol Chiki script using the bundled font. A Hindi translation is read aloud by Magpie TTS.

---

## 18. Deliberately out of scope
- **Face recognition or any biometrics:** children's privacy, siblings who look alike, faces that change.
- **Native apps:** the PWA covers this.
- **Paying fees:** notes only send reminders.
- **Voice cloning for translations:** parents hear the teacher's real voice. Translations are text, read by a standard TTS voice.
- **Grades, attendance and timetables:** that's a school ERP, a different product.
- **Claiming full speech support for all 22 languages:** NVIDIA's free models don't cover them all. We're open about the tiers (section 6).

## 19. Open questions for Shoumik
1. **Deadline:** The official page says **29 Nov**; the build rules you pasted say **30 Nov, 11:59 pm**. Plan for 29 Nov unless your dashboard confirms the 30th.
2. **NVIDIA account:** Create a build.nvidia.com account and API key (this needs phone verification). Check your rate limit and credits on the dashboard; public sources disagree on how many credits you get.
3. **Sample audio:** About 6 short real notes in Hindi, Tamil and Bengali, plus one in Odia for the tier-D demo. Could you or friends record them? Voice recordings of the 13 app phrases in Bengali and Tamil would also help, because NVIDIA's text-to-speech only covers Hindi and English.
4. **Native-speaker check:** Is there someone who can judge the quality of the Tamil and Bengali translations in the Day 1 test?
5. **Live link host:** Your Oracle server with Caddy (for HTTPS) would work.
6. **Whole-class notes:** I added these beyond what we discussed. Keep them?

## 20. Built hands-free with Wispr Flow (our process)

The hackathon's theme is building "hands-free with Wispr Flow". We don't have Flow's API, so we use the **Wispr Flow app** to build the product, and we make that visible:

- **Dictated, not typed:** Every prompt to the AI coding tool, every commit message, the README, edits to this spec and review comments are dictated with Wispr Flow, on desktop or with the phone keyboard.
- **`BUILT_WITH_FLOW.md`:** One row per work session, giving:
  - the date;
  - what was built;
  - roughly how much was dictated;
  - 2–3 dictated prompts copied word for word.

  It ends with a screenshot of the Flow app's usage stats (words dictated).
- **Commit tag:** Dictated commits end with `Dictated-with: Wispr Flow`, so it shows in `git log`.
- **Demo video:** Includes 20–30 seconds of building a feature by voice with Flow, next to the product's own voice flow.
- **Flow works inside the product too:** Every text field in Vidya Vaani is a standard `<input>` or `<textarea>` with the correct `lang` attribute. A teacher who has Flow on her phone can dictate into any of them, such as student names, the typed-note fallback and settings.

**Still to confirm:** How the judges will check that Flow was used. Check the Round 2 rules and adjust this section if needed.
