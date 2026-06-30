import { onAuth, logout } from './auth.js';
import { db, collection, getDocs } from './firebase.js';
import { toast } from './utils.js';

let candidates = [];
let filteredCandidates = [];

export function initRecruiterCandidates() {
  onAuth((user) => {
    if (!user || user.role !== 'recruiter') {
      toast("Access denied. Recruiter session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }

    loadCandidates();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  ['candidateSearch', 'candidateStatus', 'candidateLocation'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', filterAndRender);
    document.getElementById(id)?.addEventListener('change', filterAndRender);
  });

  document.getElementById('candidateModalClose')?.addEventListener('click', closeModal);
  document.getElementById('candidateModalBackdrop')?.addEventListener('click', closeModal);
}

async function loadCandidates() {
  const grid = document.getElementById('candidatesGrid');
  try {
    const snap = await getDocs(collection(db, 'candidates'));
    candidates = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    candidates.sort((a, b) => (b.redrob_signals?.profile_completeness_score || 0) - (a.redrob_signals?.profile_completeness_score || 0));
    filterAndRender();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="empty-state">Unable to load candidates. Seed the dataset from the dashboard first.</div>`;
    toast("Could not load candidates.", "error");
  }
}

function filterAndRender() {
  const grid = document.getElementById('candidatesGrid');
  const countBadge = document.getElementById('candidateCountBadge');
  const search = normalize(document.getElementById('candidateSearch')?.value);
  const status = document.getElementById('candidateStatus')?.value || '';
  const location = normalize(document.getElementById('candidateLocation')?.value);

  filteredCandidates = candidates.filter(candidate => {
    const profile = candidate.profile || {};
    const skills = candidate.skills || [];
    const text = normalize([
      profile.anonymized_name,
      profile.headline,
      profile.current_title,
      profile.current_company,
      skills.map(skill => skill.name).join(' ')
    ].join(' '));
    const locText = normalize(`${profile.location || ''} ${profile.country || ''}`);
    const open = candidate.redrob_signals?.open_to_work_flag === true;

    return (!search || text.includes(search)) &&
      (!location || locText.includes(location)) &&
      (!status || (status === 'open' ? open : !open));
  });

  countBadge.textContent = `${filteredCandidates.length} loaded`;

  if (filteredCandidates.length === 0) {
    grid.innerHTML = `<div class="empty-state">No candidates match these filters.</div>`;
    return;
  }

  grid.innerHTML = filteredCandidates.map(renderCandidateCard).join('');
  grid.querySelectorAll('[data-candidate-id]').forEach(button => {
    button.addEventListener('click', () => openModal(button.dataset.candidateId));
  });
}

function renderCandidateCard(candidate) {
  const profile = candidate.profile || {};
  const signals = candidate.redrob_signals || {};
  const skills = (candidate.skills || []).slice(0, 5);
  const name = profile.anonymized_name || 'Anonymous Candidate';
  const initials = initialsFor(name);
  const score = Math.round(signals.profile_completeness_score || 0);

  return `
    <article class="recruiter-candidate-card glass-card">
      <div class="candidate-header">
        <div class="candidate-info-block">
          <div class="candidate-avatar">${escapeHtml(initials)}</div>
          <div>
            <div class="candidate-name">${escapeHtml(name)}</div>
            <div class="candidate-headline">${escapeHtml(profile.headline || profile.current_title || 'Technical professional')}</div>
            <div class="recruiter-candidate-meta">
              <span>${escapeHtml(profile.location || 'Location not added')}</span>
              <span>${Number(profile.years_of_experience || 0).toFixed(1)} yrs exp</span>
              <span>${signals.open_to_work_flag ? 'Open to work' : 'Not open'}</span>
            </div>
          </div>
        </div>
        <div class="candidate-score-block">
          <div class="candidate-score-val">${score}%</div>
          <div class="candidate-score-label">Profile Quality</div>
        </div>
      </div>
      <p class="candidate-card-summary">${escapeHtml(truncate(profile.summary || 'No summary added.', 190))}</p>
      <div class="job-card-skills">
        ${skills.map(skill => `<span class="badge">${escapeHtml(skill.name)}</span>`).join('')}
      </div>
      <button class="btn btn-primary btn-sm" type="button" data-candidate-id="${escapeHtml(candidate.id)}">View Full Profile</button>
    </article>
  `;
}

function openModal(candidateId) {
  const candidate = candidates.find(item => item.id === candidateId);
  if (!candidate) return;

  const profile = candidate.profile || {};
  const signals = candidate.redrob_signals || {};
  const salary = signals.expected_salary_range_inr_lpa || {};
  const name = profile.anonymized_name || 'Anonymous Candidate';

  document.getElementById('candidateModalContent').innerHTML = `
    <div class="modal-profile-cover"></div>
    <div class="modal-profile-body">
      <div class="modal-avatar">${escapeHtml(initialsFor(name))}</div>
      <h2>${escapeHtml(name)}</h2>
      <p class="candidate-headline">${escapeHtml(profile.headline || profile.current_title || 'Technical professional')}</p>
      <div class="recruiter-candidate-meta">
        <span>${escapeHtml(profile.location || 'Location not added')}</span>
        <span>${Number(profile.years_of_experience || 0).toFixed(1)} yrs experience</span>
        <span>${signals.open_to_work_flag ? 'Open to work' : 'Not open'}</span>
        ${salary.min || salary.max ? `<span>${salary.min || 0}-${salary.max || 0} LPA</span>` : ''}
      </div>
      <section>
        <h3>About</h3>
        <p>${escapeHtml(profile.summary || 'No summary added.')}</p>
      </section>
      <section>
        <h3>Skills</h3>
        <div class="job-card-skills">${(candidate.skills || []).map(skill => `<span class="badge">${escapeHtml(skill.name)}</span>`).join('')}</div>
      </section>
      <section>
        <h3>Experience</h3>
        <div class="details-list">${renderTimeline(candidate.career_history, item => `${item.title || 'Role'} at ${item.company || 'Company'}`, item => `${item.start_date || ''} ${item.is_current ? '- Present' : `to ${item.end_date || ''}`}`, item => item.description)}</div>
      </section>
      <section>
        <h3>Education</h3>
        <div class="details-list">${renderTimeline(candidate.education, item => `${item.degree || 'Degree'} in ${item.field_of_study || 'Field'}`, item => `${item.institution || 'Institution'} · ${item.end_year || ''}`, item => item.grade)}</div>
      </section>
    </div>
  `;

  document.getElementById('candidateModal').classList.add('open');
  document.getElementById('candidateModal').setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const modal = document.getElementById('candidateModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function renderTimeline(items = [], titleFn, subFn, descFn) {
  if (!items.length) {
    return `<p class="details-item-desc">No details added.</p>`;
  }
  return items.slice(0, 5).map(item => `
    <div class="details-item">
      <div class="details-item-title">${escapeHtml(titleFn(item))}</div>
      <div class="details-item-sub">${escapeHtml(subFn(item))}</div>
      <div class="details-item-desc">${escapeHtml(descFn(item) || '')}</div>
    </div>
  `).join('');
}

function initialsFor(name) {
  return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

function normalize(value = '') {
  return value.toString().trim().toLowerCase();
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function escapeHtml(value = '') {
  return value.toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
