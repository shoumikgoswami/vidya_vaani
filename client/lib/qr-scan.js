// Camera QR reading: the built-in BarcodeDetector, or jsQR where it is missing.

let jsqrLoading;
function loadJsQr() {
  jsqrLoading ||= new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const script = document.createElement('script');
    script.src = '/vendor/jsqr.js';
    script.onload = () => resolve(window.jsQR);
    script.onerror = reject;
    document.head.append(script);
  });
  return jsqrLoading;
}

/** Only our own sticker addresses are accepted, whatever host they were printed with. */
export function parseSticker(text) {
  const match = /\/(s|k)\/([A-Za-z0-9]{10,40})\/?(?:\?.*)?$/.exec(String(text || '').trim());
  return match ? `/${match[1]}/${match[2]}` : null;
}

export async function startScanner(video, { onCode, onOther, ignore = () => false }) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();

  let detector = null;
  if ('BarcodeDetector' in window) {
    const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  }
  const jsQR = detector ? null : await loadJsQr();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;

  async function read() {
    if (detector) return (await detector.detect(video))[0]?.rawValue;
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data;
  }

  (async function loop() {
    while (!stopped) {
      if (video.readyState >= 2 && video.videoWidth) {
        const raw = await read().catch(() => null);
        if (raw && !stopped) {
          const path = parseSticker(raw);
          if (path && !ignore(path)) {
            stopped = true;
            navigator.vibrate?.(60);
            onCode(path);
            return;
          }
          if (!path) onOther?.();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  })();

  const [track] = stream.getVideoTracks();
  const torchAvailable = Boolean(track.getCapabilities?.().torch);
  let torchOn = false;
  return {
    torchAvailable,
    async toggleTorch() {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      return torchOn;
    },
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
