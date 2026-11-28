# Real sample recordings (optional)

Put real recordings here to replace the synthetic voices in the demo. Use WebM/Opus, named after the sample:

`hi-homework.webm`, `hi-fee.webm`, `en-science.webm`, `en-meeting.webm`, `hi-exam.webm`, `hi-uniform.webm`, `hi-reply.webm`

The words to read are the `raw` field of each entry in `../sample-data.json`. To convert a phone recording:

```bash
ffmpeg -i recording.m4a -ac 1 -c:a libopus -b:a 24k hi-homework.webm
```

Then rebuild (`docker compose up --build`) and tap **Reset demo data**. Only add recordings of people who agreed to have their voice published in a public repository.
