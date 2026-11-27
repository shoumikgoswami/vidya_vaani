# Model test

**Not run yet.** It needs an `NVIDIA_API_KEY` or `OPENROUTER_API_KEY`.

```bash
npm run models:test
```

(or `docker compose exec app npm run models:test`). It scores the configured chat models on 30 diary sentences in Hindi, Tamil and Bengali (valid JSON, right tag, translation returned, median time) and checks that Parakeet, Whisper and Magpie answer. This file is replaced with the result.

Compare other models by naming them: `npm run models:test -- vendor/model-a vendor/model-b`.
