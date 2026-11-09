// =============================================================
// HugoMed - orodha ya mwanzo ya ICD-10 (WHO) ya magonjwa yanayoonekana mara nyingi
// Daktari anaweza pia kuandika code yoyote sahihi ya ICD-10 isiyokuwepo hapa.
// Orodha kamili ya ICD-10 inaweza kuingizwa baadaye.
// =============================================================

const ICD10 = [
  ['A01.0', 'Typhoid fever'],
  ['A06.0', 'Acute amoebic dysentery'],
  ['A09', 'Gastroenteritis and colitis of infectious or unspecified origin'],
  ['A15.0', 'Tuberculosis of lung, confirmed'],
  ['A16.2', 'Tuberculosis of lung, without confirmation'],
  ['A90', 'Dengue fever'],
  ['B01.9', 'Varicella (chickenpox) without complication'],
  ['B05.9', 'Measles without complication'],
  ['B24', 'Unspecified HIV disease'],
  ['B35.4', 'Tinea corporis'],
  ['B37.0', 'Candidal stomatitis (oral thrush)'],
  ['B37.3', 'Candidiasis of vulva and vagina'],
  ['B50.0', 'Plasmodium falciparum malaria with cerebral complications'],
  ['B50.9', 'Plasmodium falciparum malaria, unspecified'],
  ['B54', 'Unspecified malaria'],
  ['B65.9', 'Schistosomiasis, unspecified'],
  ['B77.9', 'Ascariasis, unspecified'],
  ['B82.9', 'Intestinal parasitism, unspecified'],
  ['B86', 'Scabies'],
  ['D50.9', 'Iron deficiency anaemia, unspecified'],
  ['D57.0', 'Sickle-cell anaemia with crisis'],
  ['D57.1', 'Sickle-cell disease without crisis'],
  ['D64.9', 'Anaemia, unspecified'],
  ['E10.9', 'Type 1 diabetes mellitus without complications'],
  ['E11.9', 'Type 2 diabetes mellitus without complications'],
  ['E14.9', 'Unspecified diabetes mellitus without complications'],
  ['E43', 'Unspecified severe protein-energy malnutrition'],
  ['E44.0', 'Moderate protein-energy malnutrition'],
  ['E66.9', 'Obesity, unspecified'],
  ['E86', 'Volume depletion (dehydration)'],
  ['F20.9', 'Schizophrenia, unspecified'],
  ['F32.9', 'Depressive episode, unspecified'],
  ['F41.1', 'Generalized anxiety disorder'],
  ['G03.9', 'Meningitis, unspecified'],
  ['G40.9', 'Epilepsy, unspecified'],
  ['G43.9', 'Migraine, unspecified'],
  ['H10.9', 'Conjunctivitis, unspecified'],
  ['H60.9', 'Otitis externa, unspecified'],
  ['H66.9', 'Otitis media, unspecified'],
  ['I10', 'Essential (primary) hypertension'],
  ['I50.9', 'Heart failure, unspecified'],
  ['I64', 'Stroke, not specified as haemorrhage or infarction'],
  ['J00', 'Acute nasopharyngitis (common cold)'],
  ['J02.9', 'Acute pharyngitis, unspecified'],
  ['J03.9', 'Acute tonsillitis, unspecified'],
  ['J06.9', 'Acute upper respiratory infection, unspecified'],
  ['J18.9', 'Pneumonia, unspecified'],
  ['J20.9', 'Acute bronchitis, unspecified'],
  ['J44.9', 'Chronic obstructive pulmonary disease, unspecified'],
  ['J45.9', 'Asthma, unspecified'],
  ['K02.9', 'Dental caries, unspecified'],
  ['K04.7', 'Periapical abscess without sinus'],
  ['K21.9', 'Gastro-oesophageal reflux disease without oesophagitis'],
  ['K29.7', 'Gastritis, unspecified'],
  ['K30', 'Dyspepsia'],
  ['K35.8', 'Acute appendicitis, other and unspecified'],
  ['K40.9', 'Inguinal hernia, without obstruction or gangrene'],
  ['K59.0', 'Constipation'],
  ['L02.9', 'Cutaneous abscess, furuncle and carbuncle, unspecified'],
  ['L03.9', 'Cellulitis, unspecified'],
  ['L20.9', 'Atopic dermatitis, unspecified'],
  ['L30.9', 'Dermatitis, unspecified'],
  ['M10.9', 'Gout, unspecified'],
  ['M19.9', 'Arthrosis, unspecified'],
  ['M54.5', 'Low back pain'],
  ['M79.1', 'Myalgia'],
  ['N30.0', 'Acute cystitis'],
  ['N39.0', 'Urinary tract infection, site not specified'],
  ['N40', 'Hyperplasia of prostate'],
  ['N73.9', 'Female pelvic inflammatory disease, unspecified'],
  ['N76.0', 'Acute vaginitis'],
  ['N94.6', 'Dysmenorrhoea, unspecified'],
  ['O03.9', 'Spontaneous abortion, complete or unspecified, without complication'],
  ['O13', 'Gestational hypertension'],
  ['O14.9', 'Pre-eclampsia, unspecified'],
  ['O21.0', 'Mild hyperemesis gravidarum'],
  ['O80', 'Single spontaneous delivery'],
  ['O99.0', 'Anaemia complicating pregnancy, childbirth and the puerperium'],
  ['R05', 'Cough'],
  ['R10.4', 'Other and unspecified abdominal pain'],
  ['R11', 'Nausea and vomiting'],
  ['R50.9', 'Fever, unspecified'],
  ['R51', 'Headache'],
  ['R53', 'Malaise and fatigue'],
  ['R56.0', 'Febrile convulsions'],
  ['S09.9', 'Unspecified injury of head'],
  ['S61.9', 'Open wound of wrist and hand, part unspecified'],
  ['S93.4', 'Sprain and strain of ankle'],
  ['T14.1', 'Open wound of unspecified body region'],
  ['T30.0', 'Burn of unspecified body region, unspecified degree'],
  ['T63.0', 'Toxic effect of snake venom'],
  ['Z00.0', 'General medical examination'],
  ['Z30.9', 'Contraceptive management, unspecified'],
  ['Z34.9', 'Supervision of normal pregnancy, unspecified']
];

// Muundo sahihi wa code ya ICD-10, mf. B50.9, I10, O80
const ICD10_PATTERN = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

function search(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return ICD10.slice(0, 20).map(([code, name]) => ({ code, name }));
  return ICD10
    .filter(([code, name]) => code.toLowerCase().startsWith(s) || name.toLowerCase().includes(s))
    .slice(0, 20)
    .map(([code, name]) => ({ code, name }));
}

function lookup(code) {
  const row = ICD10.find(([c]) => c === code);
  return row ? row[1] : null;
}

module.exports = { search, lookup, ICD10_PATTERN };
