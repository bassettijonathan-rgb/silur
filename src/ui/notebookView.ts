/** Notebook tab: hypotheses with a confidence slider, status and attached evidence. */
import { ClaimType, EvidenceRef, Hypothesis, HypothesisStatus, Notebook } from '../game/notebook';
import { el } from './dom';

const CLAIMS: ClaimType[] = ['civilization', 'extinction-cause', 'event', 'age', 'other'];
const STATUSES: HypothesisStatus[] = ['open', 'supported', 'rejected'];

export interface NotebookHooks {
  notebook(): Notebook;
  actionCount(): number;
  /** Evidence the player can attach right now (current core, selected tie, …). */
  candidateEvidence(): EvidenceRef[];
  changed(): void;
}

export function renderNotebook(root: HTMLElement, hooks: NotebookHooks): void {
  const nb = hooks.notebook();
  const title = el('input', { placeholder: 'e.g. A burst of fire and organics at 120 Ma was a civilization', size: '60' });
  const add = el('button', {}, 'Add hypothesis');
  add.addEventListener('click', () => {
    if (!title.value.trim()) return;
    nb.add({ title: title.value.trim() }, hooks.actionCount());
    hooks.changed();
  });
  root.replaceChildren(el('div', {}, title, ' ', add));
  const cands = hooks.candidateEvidence();
  for (const h of nb.list()) root.append(card(h, nb, cands, hooks));
  if (!nb.list().length) root.append(el('div', { class: 'dim' }, 'No hypotheses yet. Write one down before you have too many cores to remember what each was for.'));
}

function card(h: Hypothesis, nb: Notebook, cands: EvidenceRef[], hooks: NotebookHooks): HTMLElement {
  const text = el('textarea', { rows: '2', cols: '60', placeholder: 'reasoning, what would change your mind…' });
  text.value = h.text;
  text.addEventListener('change', () => { nb.update(h.id, { text: text.value }); hooks.changed(); });
  const claim = el('select', {}, ...CLAIMS.map((c) => el('option', c === h.claimType ? { value: c, selected: '' } : { value: c }, c)));
  claim.addEventListener('change', () => { nb.update(h.id, { claimType: claim.value as ClaimType }); hooks.changed(); });
  const status = el('select', {}, ...STATUSES.map((c) => el('option', c === h.status ? { value: c, selected: '' } : { value: c }, c)));
  status.addEventListener('change', () => { nb.update(h.id, { status: status.value as HypothesisStatus }); hooks.changed(); });
  const p = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(h.p * 100)) });
  const pTxt = el('span', {}, `${Math.round(h.p * 100)} %`);
  p.addEventListener('input', () => { pTxt.textContent = `${p.value} %`; nb.update(h.id, { p: Number(p.value) / 100 }); });
  p.addEventListener('change', () => hooks.changed());
  const attach = el('select', {}, el('option', { value: '' }, 'attach evidence…'), ...cands.map((c, i) => el('option', { value: String(i) }, `${c.kind}: ${c.label}`)));
  attach.addEventListener('change', () => { if (attach.value !== '') { nb.link(h.id, cands[Number(attach.value)]); hooks.changed(); } });
  const del = el('button', {}, '✕');
  del.addEventListener('click', () => { nb.remove(h.id); hooks.changed(); });
  const ev = el('div', { class: 'dim' }, h.evidence.length ? 'evidence: ' + h.evidence.map((e) => e.label).join(' · ') : 'no evidence attached');
  return el('div', { class: `hyp ${h.status}` }, el('div', {}, el('b', {}, h.title), ' ', del), el('div', {}, claim, ' ', status, ' confidence ', p, ' ', pTxt), text, el('div', {}, attach), ev);
}
