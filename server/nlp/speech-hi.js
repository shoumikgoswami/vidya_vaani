// The Hindi voice spells an English word out letter by letter ("S, c, i, e, n, c, e"). Before Hindi
// is spoken, every English word is written in Devanagari. What is shown on screen does not change.
import { z } from 'zod';
import { getSetting, setSetting } from '../db/index.js';
import { completeJson, llmChain } from '../providers/llm.js';

// Words that school notes use every day, so the common case needs no AI call.
const SCHOOL_WORDS = `
  absent=एब्सेंट activity=एक्टिविटी admission=एडमिशन all=ऑल and=एंड annual=एनुअल answer=आंसर answers=आंसर्स
  application=एप्लीकेशन assembly=असेंबली assignment=असाइनमेंट attendance=अटेंडेंस bag=बैग bengali=बंगाली biology=बायोलॉजी
  board=बोर्ड book=बुक books=बुक्स bus=बस camp=कैंप card=कार्ड certificate=सर्टिफिकेट chapter=चैप्टर chapters=चैप्टर्स
  chart=चार्ट chemistry=केमिस्ट्री class=क्लास classes=क्लासेस classwork=क्लासवर्क closed=क्लोज़्ड computer=कंप्यूटर
  copy=कॉपी date=डेट day=डे dress=ड्रेस drawing=ड्रॉइंग english=इंग्लिश evs=ई वी एस exam=एग्ज़ाम exams=एग्ज़ाम्स
  exercise=एक्सरसाइज़ fee=फी fees=फीस file=फाइल final=फाइनल form=फॉर्म friday=फ्राइडे function=फंक्शन games=गेम्स
  geography=ज्योग्राफी good=गुड grade=ग्रेड hindi=हिंदी history=हिस्ट्री holiday=हॉलिडे homework=होमवर्क id=आई डी
  lab=लैब leave=लीव lesson=लेसन library=लाइब्रेरी lunch=लंच madam=मैडम marks=मार्क्स math=मैथ maths=मैथ्स
  meeting=मीटिंग monday=मंडे month=मंथ monthly=मंथली notebook=नोटबुक notice=नोटिस office=ऑफिस ok=ओके okay=ओके
  page=पेज pages=पेजेस parent=पेरेंट parents=पेरेंट्स pen=पेन pencil=पेंसिल period=पीरियड physics=फिज़िक्स
  picnic=पिकनिक poem=पोएम practice=प्रैक्टिस practical=प्रैक्टिकल principal=प्रिंसिपल progress=प्रोग्रेस
  project=प्रोजेक्ट ptm=पी टी एम question=क्वेश्चन questions=क्वेश्चन्स report=रिपोर्ट result=रिज़ल्ट
  revision=रिवीज़न roll=रोल sanskrit=संस्कृत saturday=सैटरडे school=स्कूल science=साइंस section=सेक्शन shoes=शूज़
  sir=सर social=सोशल sports=स्पोर्ट्स student=स्टूडेंट students=स्टूडेंट्स study=स्टडी subject=सब्जेक्ट
  sunday=संडे syllabus=सिलेबस teacher=टीचर teachers=टीचर्स test=टेस्ट thursday=थर्सडे tiffin=टिफिन time=टाइम
  tomorrow=टुमॉरो today=टुडे tuesday=ट्यूज़डे uniform=यूनिफ़ॉर्म unit=यूनिट vacation=वेकेशन wednesday=वेडनेसडे
  week=वीक weekly=वीकली work=वर्क worksheet=वर्कशीट
`;
const KNOWN = new Map(SCHOOL_WORDS.trim().split(/\s+(?=[a-z]+=)/).map((pair) => pair.split('=')));

// Single letters and capital abbreviations ("5A", "PTA") are said letter by letter, in Devanagari.
const LETTERS = Object.fromEntries('ए बी सी डी ई एफ़ जी एच आई जे के एल एम एन ओ पी क्यू आर एस टी यू वी डब्ल्यू एक्स वाई ज़ेड'
  .split(' ').map((sound, i) => [String.fromCharCode(97 + i), sound]));
const spelled = (word) => [...word.toLowerCase()].map((c) => LETTERS[c]).filter(Boolean).join(' ');

// With any apostrophe inside or after the word, so none is left behind ("parents'").
const ENGLISH = /[A-Za-z]+(?:['’][A-Za-z]+)*['’]?/g;
const DEVANAGARI = /^[\p{Script=Devanagari}‌‍ ]+$/u;
const plain = (word) => word.toLowerCase().replace(/['’]/g, '');

const answers = z.record(z.string());

/** Names and rarer words are asked of the language model once, then remembered. */
async function askModel(words) {
  const chain = llmChain().slice(0, 2);
  if (!chain.length || !words.length) return {};
  try {
    const { data } = await completeJson({
      system: 'You write English words and Indian names in Devanagari, exactly as a Hindi speaker in India says them. '
        + 'Transliterate the sound; never translate the meaning. Reply with one JSON object that maps each given word to Devanagari.',
      user: JSON.stringify(words),
      schema: answers,
      maxTokens: 600,
      timeoutMs: 8000,
      chain,
    });
    return Object.fromEntries(Object.entries(data).map(([word, said]) => [plain(word), said.trim()]));
  } catch {
    return {};
  }
}

/**
 * The text to hand to the Hindi voice. `complete` is false when some word could not be converted,
 * so the caller does not keep that recording for next time.
 */
export async function toHindiSpeech(text) {
  const found = [...new Set(text.match(ENGLISH) || [])];
  if (!found.length) return { text, complete: true };

  const said = new Map();
  const unknown = [];
  for (const word of found) {
    const key = plain(word);
    const known = KNOWN.get(key)
      || (key.length === 1 || (word.length <= 4 && word === word.toUpperCase()) ? spelled(key) : null)
      || await getSetting(`say-hi:${key}`);
    if (known) said.set(word, known);
    else unknown.push(word);
  }

  const fromModel = await askModel(unknown.slice(0, 40));
  for (const word of unknown) {
    const answer = fromModel[plain(word)];
    if (answer && DEVANAGARI.test(answer)) {
      said.set(word, answer);
      await setSetting(`say-hi:${plain(word)}`, answer);
    }
  }

  return {
    text: text.replace(ENGLISH, (word) => said.get(word) || word),
    complete: said.size === found.length,
  };
}
