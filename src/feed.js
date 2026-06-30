import { onAuth, logout } from './auth.js';
import { toast } from './utils.js';
import { loadSampleCandidates } from './sampleData.js';

let currentUser = null;
let candidates = [];

export function initTalentFeed() {
  onAuth((user) => {
    if (!user || user.role !== 'candidate') {
      toast("Access denied. Candidate session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }

    currentUser = user;
    loadCandidates();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  ['feed-role', 'feed-skill', 'feed-location'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderFeed);
  });
}

async function loadCandidates() {
  try {
    const sampleCandidates = await loadSampleCandidates();
    candidates = sampleCandidates.map(candidate => ({ id: candidate.candidate_id, ...candidate }));
    renderFeed();
  } catch (err) {
    console.error(err);
    document.getElementById('feedGrid').innerHTML = `<div class="empty-state">Unable to load the sample talent dataset right now.</div>`;
    toast("Could not load talent feed.", "error");
  }
}

function renderFeed() {
  const grid = document.getElementById('feedGrid');
  const roleTerm = normalize(document.getElementById('feed-role')?.value);
  const skillTerm = normalize(document.getElementById('feed-skill')?.value);
  const locationTerm = normalize(document.getElementById('feed-location')?.value);

  const visible = candidates.filter(candidate => {
    const profile = candidate.profile || {};
    const skills = candidate.skills || [];
    const roleText = normalize(`${profile.headline || ''} ${profile.current_title || ''}`);
    const skillText = normalize(skills.map(skill => skill.name).join(' '));
    const locationText = normalize(`${profile.location || ''} ${profile.country || ''}`);

    return (!roleTerm || roleText.includes(roleTerm)) &&
      (!skillTerm || skillText.includes(skillTerm)) &&
      (!locationTerm || locationText.includes(locationTerm));
  });

  if (visible.length === 0) {
    grid.innerHTML = `<div class="empty-state">No sample candidates match these filters.</div>`;
    return;
  }

  grid.innerHTML = visible.map(renderCandidateCard).join('');
  grid.querySelectorAll('[data-action="connect"]').forEach(btn => {
    btn.addEventListener('click', () => toast("Connection request previewed.", "info"));
  });
  grid.querySelectorAll('[data-action="profile"]').forEach(btn => {
    btn.addEventListener('click', () => toast("Profile preview is visual only in this build.", "info"));
  });
}

function renderCandidateCard(candidate) {
  const profile = candidate.profile || {};
  const name = profile.anonymized_name || 'Candidate';
  const initial = name.charAt(0).toUpperCase();
  const skills = (candidate.skills || []).slice(0, 5);
  const signals = candidate.redrob_signals || {};
  const salary = signals.expected_salary_range_inr_lpa || {};

  return `
    <article class="candidate-card">
      <div class="card-header">
        ${profile.photoURL ? `<img class="card-avatar-img" src="${profile.photoURL}" alt="${escapeHtml(name)}" />` : `<div class="card-avatar">${escapeHtml(initial)}</div>`}
        <div>
          <h2 class="card-name">${escapeHtml(name)}</h2>
          <p class="card-sub">${escapeHtml(profile.headline || profile.current_title || 'Open candidate')}</p>
        </div>
      </div>
      <div class="feed-card-meta">
        <span class="open-badge">${signals.open_to_work_flag ? 'Open to work' : 'Dataset profile'}</span>
        <span>${escapeHtml(profile.location || 'Location flexible')}</span>
      </div>
      <p class="card-summary">${escapeHtml(truncate(profile.summary || 'Candidate profile summary will appear here.', 150))}</p>
      <div class="skills-chips">
        ${skills.map(skill => `<span class="chip">${escapeHtml(skill.name)}</span>`).join('')}
      </div>
      <div class="feed-card-meta">
        <span>${Number(profile.years_of_experience || 0).toFixed(1)} yrs exp</span>
        ${salary.min || salary.max ? `<span class="salary-badge">${salary.min || 0}-${salary.max || 0} LPA</span>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" data-action="connect" type="button">Connect</button>
        <button class="btn btn-secondary btn-sm" data-action="profile" type="button">View Profile</button>
      </div>
    </article>
  `;
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
