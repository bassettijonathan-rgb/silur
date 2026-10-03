/** Submission tab: the headline probability and the event list, edited as a draft until the player hands it in. */
import { newEvent, removeEvent, setCause } from '../game/draft';
import { CAUSES, CauseId, SUBMISSION_TYPES, Submission, SubmissionType, TYPE_LABEL, isEpisode } from '../shared/submission';
import { el } from './dom';

export interface SubmitHooks {
  draft(): Submission;
  durationMyr(): number;
  budgetLeft(): number;
  changed(): void;
  submit(): void;
}

export function renderSubmit(root: HTMLElement, h: SubmitHooks): void {
  const d = h.draft();
  const pTxt = el('b', {}, `${Math.round(d.pCivilization * 100)} %`);
  const p = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(d.pCivilization * 100)) });
  p.addEventListener('input', () => { d.pCivilization = Number(p.value) / 100; pTxt.textContent = `${p.value} %`; });
  p.addEventListener('change', () => h.changed());

  const typeSel = el('select', {}, ...SUBMISSION_TYPES.map((t) => el('option', { value: t }, TYPE_LABEL[t])));
  const add = el('button', {}, 'Add event');
  add.addEventListener('click', () => {
    const D = h.durationMyr();
    newEvent(d, typeSel.value as SubmissionType, Math.max(0, D * 0.4), D * 0.6);
    h.changed();
  });

  root.replaceChildren(
    el('div', { class: 'hyp' },
      el('div', {}, 'Headline: how likely is it that a technological civilization existed at some time in this record? ', pTxt),
      p,
      el('div', { class: 'dim' }, 'Scored with a log rule: 50 % earns nothing, being right and confident earns up to ≈ 6.6 bits, being confidently wrong costs the same.')),
    el('div', {}, 'Events you claim: ', typeSel, ' ', add,
      el('span', { class: 'dim' }, '  80 % interval: you should expect to be outside it one time in five.')),
  );
  for (const e of d.events) {
    const num = (v: number, set: (x: number) => void) => {
      const i = el('input', { value: String(+v.toFixed(3)), size: '7' });
      i.addEventListener('change', () => { const x = Number(i.value); if (Number.isFinite(x)) { set(x); h.changed(); } });
      return i;
    };
    const ex = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(e.exists * 100)) });
    const exTxt = el('span', {}, `${Math.round(e.exists * 100)} %`);
    ex.addEventListener('input', () => { e.exists = Number(ex.value) / 100; exTxt.textContent = `${ex.value} %`; });
    const del = el('button', {}, '✕');
    del.addEventListener('click', () => { removeEvent(d, e.id); h.changed(); });
    const note = el('input', { value: e.note ?? '', size: '40', placeholder: 'note / evidence' });
    note.addEventListener('change', () => { e.note = note.value; });
    const card = el('div', { class: 'hyp' },
      el('div', {}, el('b', {}, TYPE_LABEL[e.type]), ' between ', num(e.ageMinMa, (x) => { e.ageMinMa = Math.min(x, e.ageMaxMa); }), ' and ', num(e.ageMaxMa, (x) => { e.ageMaxMa = Math.max(x, e.ageMinMa); }), ' Ma ', del),
      el('div', {}, 'probability it really happened ', ex, ' ', exTxt), note);
    if (isEpisode(e.type)) {
      const row = el('div', { class: 'causes' }, 'cause: ');
      for (const c of CAUSES) {
        const inp = el('input', { value: String(Math.round((e.causes[c] ?? 0) * 100)), size: '3' });
        inp.addEventListener('change', () => { setCause(e, c as CauseId, Number(inp.value) / 100); h.changed(); });
        row.append(el('span', {}, c.replace('_', ' '), ' ', inp, '% '));
      }
      card.append(row);
    }
    root.append(card);
  }
  const go = el('button', { class: 'primary' }, 'Submit and reveal the truth');
  go.addEventListener('click', () => {
    if (confirm('Submitting ends the investigation: you cannot buy more data afterwards, and the hidden history is revealed. Continue?')) h.submit();
  });
  root.append(el('div', {}, go, el('span', { class: 'dim' }, `  budget left ${h.budgetLeft().toFixed(1)} (unspent budget is not scored)`)));
}
