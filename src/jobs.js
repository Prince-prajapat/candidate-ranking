import { onAuth, logout } from './auth.js';
import { db, collection, doc, getDocs, setDoc } from './firebase.js';
import { toast } from './utils.js';

let currentUser = null;
let jobs = [];
let savedJobIds = new Set();

export function initJobsBoard() {
  onAuth((user) => {
    if (!user || user.role !== 'candidate') {
      toast("Access denied. Candidate session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }

    currentUser = user;
    loadJobs();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  ['jobs-search', 'jobs-location', 'jobs-salary'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderJobs);
    document.getElementById(id)?.addEventListener('change', renderJobs);
  });
}

async function loadJobs() {
  try {
    const [jobsRes, savedSnap] = await Promise.all([
      fetch('/jobs.json'),
      getDocs(collection(db, 'candidates', currentUser.uid, 'saved_jobs'))
    ]);

    jobs = await jobsRes.json();
    savedJobIds = new Set(savedSnap.docs.map(docSnap => docSnap.id));
    renderJobs();
  } catch (err) {
    console.error(err);
    document.getElementById('jobsGrid').innerHTML = `<div class="empty-state">Unable to load jobs right now.</div>`;
    toast("Could not load jobs board.", "error");
  }
}

function renderJobs() {
  const grid = document.getElementById('jobsGrid');
  const searchTerm = normalize(document.getElementById('jobs-search')?.value);
  const locationTerm = normalize(document.getElementById('jobs-location')?.value);
  const minSalary = Number(document.getElementById('jobs-salary')?.value || 0);

  const visible = jobs.filter(job => {
    const searchText = normalize(`${job.role} ${job.company} ${(job.tags || []).join(' ')}`);
    const locationText = normalize(job.location);
    const salaryMax = Number(job.salary_lpa?.max || 0);

    return (!searchTerm || searchText.includes(searchTerm)) &&
      (!locationTerm || locationText.includes(locationTerm)) &&
      (!minSalary || salaryMax >= minSalary);
  });

  if (visible.length === 0) {
    grid.innerHTML = `<div class="empty-state">No jobs match these filters.</div>`;
    return;
  }

  grid.innerHTML = visible.map(renderJobCard).join('');
  grid.querySelectorAll('[data-save-job]').forEach(btn => {
    btn.addEventListener('click', () => saveJob(btn.dataset.saveJob));
  });
}

function renderJobCard(job) {
  const isSaved = savedJobIds.has(job.id);
  const salary = job.salary_lpa || {};

  return `
    <article class="job-card">
      <div class="job-card-top">
        <div>
          <h2 class="card-name">${escapeHtml(job.role)}</h2>
          <p class="card-sub">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</p>
        </div>
        <span class="salary-badge">${salary.min || 0}-${salary.max || 0} LPA</span>
      </div>
      <p class="card-summary">${escapeHtml(job.description)}</p>
      <div class="skills-chips">
        ${(job.tags || []).map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
      </div>
      <div class="feed-card-meta">
        <span>${escapeHtml(job.work_mode || 'Flexible')}</span>
        <span>${escapeHtml(job.experience || 'Any experience')}</span>
      </div>
      <button class="btn ${isSaved ? 'btn-secondary' : 'btn-primary'} btn-sm" data-save-job="${escapeHtml(job.id)}" type="button">
        ${isSaved ? 'Saved' : 'Save Job'}
      </button>
    </article>
  `;
}

async function saveJob(jobId) {
  const job = jobs.find(item => item.id === jobId);
  if (!job || savedJobIds.has(jobId)) return;

  try {
    await setDoc(doc(db, 'candidates', currentUser.uid, 'saved_jobs', jobId), {
      ...job,
      saved_at: new Date().toISOString()
    });
    savedJobIds.add(jobId);
    renderJobs();
    toast("Job saved.", "success");
  } catch (err) {
    console.error(err);
    toast("Could not save job: " + err.message, "error");
  }
}

function normalize(value = '') {
  return value.toString().trim().toLowerCase();
}

function escapeHtml(value = '') {
  return value.toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
