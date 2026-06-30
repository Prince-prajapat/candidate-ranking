import { onAuth, logout } from './auth.js';
import { db, doc, getDoc } from './firebase.js';
import { toast } from './utils.js';

let currentUser = null;
let profileData = null;

export function initCandidateHome() {
  onAuth((user) => {
    if (!user || user.role !== 'candidate') {
      toast("Access denied. Candidate session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }

    currentUser = user;
    loadCandidateHome();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  setupProfileDropdown();
}

async function loadCandidateHome() {
  try {
    const snap = await getDoc(doc(db, 'candidates', currentUser.uid));
    profileData = snap.exists() ? snap.data() : createEmptyProfile();
    renderHome();
  } catch (err) {
    console.error(err);
    toast("Could not load your profile home.", "error");
    profileData = createEmptyProfile();
    renderHome();
  }
}

function renderHome() {
  const profile = profileData.profile || {};
  const signals = profileData.redrob_signals || {};
  const skills = profileData.skills || [];
  const projects = profileData.projects || [];
  const achievements = profileData.achievements || profileData.certifications || [];
  const name = profile.anonymized_name || currentUser.name || 'Candidate';
  const headline = profile.headline || profile.current_title || 'Add your headline to stand out';
  const initial = name.charAt(0).toUpperCase();
  const score = Math.round(signals.profile_completeness_score || 0);

  setAvatar('homeAvatar', profile.photoURL, initial, name);
  setAvatar('navAvatar', profile.photoURL, initial, name);
  setAvatar('dropdownAvatar', profile.photoURL, initial, name);

  setText('homeName', name);
  setText('navName', name.split(' ')[0] || 'Profile');
  setText('dropdownName', name);
  setText('homeHeadline', headline);
  setText('dropdownHeadline', headline);
  setText('homeLocation', profile.location || 'Location not added');
  setText('dropdownLocation', profile.location || 'Location not added');
  setText('homeExperience', `${Number(profile.years_of_experience || 0).toFixed(1)} yrs experience`);
  setText('homeSummary', profile.summary || 'Your profile summary will appear here after you save it.');
  setText('homeOpenStatus', signals.open_to_work_flag === false ? 'Not open to work' : 'Open to work');
  setText('dropdownOpen', signals.open_to_work_flag === false ? 'Not open to work' : 'Open to work');
  setText('homeScore', `${score}%`);
  setText('dropdownScore', `${score}%`);
  setWidth('homeProgress', score);
  setWidth('dropdownProgress', score);

  renderSkills('homeSkills', skills, 12);
  renderSkills('dropdownSkills', skills, 4);
  setText('skillCount', `${skills.length} skill${skills.length === 1 ? '' : 's'}`);
  renderList('homeProjects', projects, 'No projects added yet.', project => ({
    title: project.title || 'Untitled project',
    subtitle: project.description || project.url || 'Project details not added'
  }));
  renderList('homeAchievements', achievements, 'No achievements added yet.', item => ({
    title: item.title || item.name || 'Achievement',
    subtitle: [item.issuer, item.date || item.year].filter(Boolean).join(' · ') || item.type || 'Achievement details not added'
  }));

  const roles = signals.preferred_roles || [];
  const salary = signals.expected_salary_range_inr_lpa || {};
  setText('homeRoles', roles.length ? roles.join(', ') : 'Not added');
  setText('homeNotice', `${signals.notice_period_days ?? 30} days`);
  setText('homeSalary', salary.min || salary.max ? `${salary.min || 0}-${salary.max || 0} LPA` : 'Not added');
}

function setupProfileDropdown() {
  const btn = document.getElementById('profileMenuBtn');
  const dropdown = document.getElementById('profileDropdown');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target) && !btn.contains(event.target)) {
      dropdown.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function renderSkills(targetId, skills, limit) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const visible = skills.slice(0, limit);
  target.innerHTML = visible.length
    ? visible.map(skill => `<span class="chip">${escapeHtml(skill.name || skill)}</span>`).join('')
    : `<span class="chip">No skills yet</span>`;
}

function renderList(targetId, items, emptyText, mapper) {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!items.length) {
    target.innerHTML = `<p class="home-muted">${emptyText}</p>`;
    return;
  }

  target.innerHTML = items.slice(0, 4).map(item => {
    const mapped = mapper(item);
    return `
      <div class="home-list-item">
        <strong>${escapeHtml(mapped.title)}</strong>
        <span>${escapeHtml(mapped.subtitle)}</span>
      </div>
    `;
  }).join('');
}

function setAvatar(id, photoURL, initial, name) {
  const el = document.getElementById(id);
  if (!el) return;
  if (photoURL && !photoURL.startsWith('data:image/svg+xml')) {
    el.innerHTML = `<img src="${photoURL}" alt="${escapeHtml(name)}" />`;
  } else {
    el.textContent = initial;
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setWidth(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function createEmptyProfile() {
  return {
    profile: { anonymized_name: currentUser.name || 'Candidate' },
    skills: [],
    projects: [],
    achievements: [],
    redrob_signals: { profile_completeness_score: 0, open_to_work_flag: true, notice_period_days: 30 }
  };
}

function escapeHtml(value = '') {
  return value.toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
