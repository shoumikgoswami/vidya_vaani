// Chrome's built-in on-device Translator, used when the server has no translation (spec 5.5).

export async function translateOnDevice(text, from, to) {
  try {
    const Translator = window.Translator;
    if (!Translator || !from || from === to) return null;
    const options = { sourceLanguage: from, targetLanguage: to };
    // Only use a language pack already on the phone, so nobody is surprised by a large download.
    if ((await Translator.availability(options)) !== 'available') return null;
    const translator = await Translator.create(options);
    const result = await translator.translate(text);
    translator.destroy?.();
    return result || null;
  } catch {
    return null;
  }
}
