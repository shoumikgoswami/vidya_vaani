# Model test, 27 Nov 2026

Run against NVIDIA Build's free endpoints with the app's own clean-up, tagging and translation code.
Each model got 12 diary sentences (4 Hindi, 4 Tamil, 4 Bengali). All models ran at the same time with a
30 second timeout. A model that answered nothing in its first 3 sentences was stopped.

| Model | Usable answers | Right tag | Numbers and names kept | Translations returned | Median clean-up | Median translation |
|---|---|---|---|---|---|---|
| `nvidia/nemotron-3.5-bolt-e4b` | 12/12 | 12/12 | 12/12 | 44/48 | 1.5 s | 1.4 s |
| `minimaxai/minimax-m3.1-flash` | 9/12 (rate limited) | 9/9 | 9/9 | 44/48 | 1.9 s | 4.0 s |
| `nvidia/nemotron-3-ultra-550b-a55b` | 11/11 | 11/11 | 11/11 | 20/44 | 19.5 s | 15.5 s |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | 11/12 | 11/11 | 11/11 | 0/48 | 11.2 s | none |
| `stepfun-ai/step-5-preview` | 0/3 (timeouts, empty answers) | | | 0 | | |
| `mistralai/mistral-large-4-1t-a52b` | 0/3 (timeouts) | | | 0 | | |

Listed on NVIDIA but not callable with this key on this date: `google/gemma-3-12b-it` and `google/gemma-3-4b-it` (404).

**Chosen:** `nvidia/nemotron-3.5-bolt-e4b`, with `minimaxai/minimax-m3.1-flash` as fallback.

Translation quality was only spot-checked by an AI assistant, not by a native speaker. Bolt's samples read
correctly; one MiniMax Bengali sample turned "science homework" into "science exam".

## Speech

| Check | Result |
|---|---|
| Parakeet, `hi-IN` and `en-US`, natural synthetic voice | Correct, with word confidence |
| Parakeet, `bn-IN` and `ta-IN` | Refused (invalid argument). These languages use Whisper |
| Parakeet on the robotic demo clips | Empty. Whisper then answers |
| Whisper, Hindi, Tamil, Bengali | Answers; accuracy on robotic demo clips is poor |
| Whisper, auto-detect on a robotic Hindi clip | Detected Welsh. Set the teacher's language rather than "auto" |
| Whisper, Odia | Not supported, as expected. Notes stay audio only |
| Magpie text-to-speech, Hindi and English | Audio returned |

Accuracy with real classroom recordings has not been measured. Re-run with `npm run models:test`.
