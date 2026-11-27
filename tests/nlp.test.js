import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDueDate, addDays } from '../server/nlp/dates.js';
import { wordsToDigits, numberAmbiguities, numbersIn } from '../server/nlp/numbers.js';
import { ruleExtract } from '../server/nlp/tags.js';
import { similarNames } from '../server/nlp/names.js';
import { protect, restore } from '../server/nlp/placeholders.js';
import { parsePerson, parseList } from '../server/nlp/formfill.js';

const FRIDAY = '2026-11-27';

test('date words in several languages', () => {
  assert.equal(parseDueDate('कल कविता याद करनी है', FRIDAY), '2026-11-28');
  assert.equal(parseDueDate('Kal test hai', FRIDAY), '2026-11-28');
  assert.equal(parseDueDate('परसों लाना है', FRIDAY), '2026-11-29');
  assert.equal(parseDueDate('நாளை வர வேண்டும்', FRIDAY), '2026-11-28');
  assert.equal(parseDueDate('সোমবার পরীক্ষা', FRIDAY), '2026-11-30');
  assert.equal(parseDueDate('शुक्रवार तक फीस जमा करें', FRIDAY), '2026-12-04');
  assert.equal(parseDueDate('வெள்ளிக்கிழமைக்குள் கட்டணம்', FRIDAY), '2026-12-04');
  assert.equal(parseDueDate('Pay by 5 December', FRIDAY), '2026-12-05');
  assert.equal(parseDueDate('२८ नवंबर को बैठक', FRIDAY), '2026-11-28');
  assert.equal(parseDueDate('3 tarikh ko test', FRIDAY), '2026-12-03');
  assert.equal(parseDueDate('15/1 को परीक्षा', FRIDAY), '2027-01-15');
  assert.equal(parseDueDate('अच्छा काम किया', FRIDAY), null);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('number words become digits only where a number is meant', () => {
  assert.equal(wordsToDigits('page barah yaad karo'), 'page 12 yaad karo');
  assert.equal(wordsToDigits('paanch sau rupaye lana'), '500 rupaye lana');
  assert.equal(wordsToDigits('फीस जमा कर दो'), 'फीस जमा कर दो');
  assert.equal(wordsToDigits('do your homework'), 'do your homework');
  assert.deepEqual(numbersIn('पेज १२ और ₹1,500'), ['12', '1500']);
});

test('"page barah ya do" asks which one', () => {
  assert.deepEqual(numberAmbiguities('Page barah ya do yaad karna')[0].options, ['12', '2']);
  assert.deepEqual(numberAmbiguities('पेज बारह या दो')[0].options, ['12', '2']);
  assert.equal(numberAmbiguities('page 12 yaad karna').length, 0);
});

test('the rule engine tags a mixed Hindi note', () => {
  const found = ruleExtract('Kal Hindi ki kitab ka page barah ki kavita yaad karni hai. Shukrawar tak fees jama karni hai.', FRIDAY);
  assert.deepEqual(found.tags, [
    { type: 'homework', subject: 'Hindi', dueDate: '2026-11-28' },
    { type: 'fee', subject: null, dueDate: '2026-12-04' },
  ]);
  assert.deepEqual(found.entities.pages, ['12']);
});

test('names match across scripts', () => {
  assert.ok(similarNames('Ravi Kumar', 'रवि कुमार'));
  assert.ok(similarNames('Ravi', 'Ravi Kumar'));
  assert.ok(similarNames('Ravi', 'ரவி'));
  assert.ok(similarNames('Priya Sharma', 'Priyaa Sharma'));
  assert.ok(!similarNames('Ravi Kumar', 'Rohan Das'));
  assert.ok(!similarNames('Amit', 'Sumit'));
});

test('protected details survive translation or the result is rejected', () => {
  const guarded = protect('Ravi, page 12 and ₹500 by 28/11', ['Ravi']);
  assert.equal(guarded.text, '⟦N1⟧, page ⟦N2⟧ and ⟦N3⟧ by ⟦N4⟧');
  assert.equal(restore('पेज ⟦N2⟧, ⟦N1⟧, [[N3]], ⟦N4⟧', guarded.values), 'पेज 12, Ravi, ₹500, 28/11');
  assert.equal(restore('⟦N1⟧ only', guarded.values), null);
  assert.equal(restore('⟦N1⟧ ⟦N2⟧ ⟦N3⟧ ⟦N4⟧ ⟦N9⟧', guarded.values), null);
});

test('spoken student details are picked out', () => {
  const person = parsePerson('Ravi Kumar, papa ka number 98765 43210');
  assert.equal(person.name, 'Ravi Kumar');
  assert.equal(person.phone, '+919876543210');
  const spoken = parsePerson('सीता देवी पापा का नंबर नौ आठ सात छह पांच चार तीन दो एक शून्य');
  assert.equal(spoken.name, 'सीता देवी');
  assert.equal(spoken.phone, '+919876543210');
  const teacher = parsePerson('Meena Kumari, 9876543210, Hindi aur Maths');
  assert.deepEqual(teacher.subjects, ['Hindi', 'Maths']);
  assert.equal(parseList('1. Asha 9876500000\n\n- Bala, bala.parent@gmail.com').length, 2);
});
