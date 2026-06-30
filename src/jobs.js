import { onAuth, logout } from './auth.js';
import { db, collection, doc, getDoc, getDocs, setDoc } from './firebase.js';
import { toast } from './utils.js';
import { getLocalJobs, loadSampleCandidates } from './sampleData.js';
import { rank } from './ranking.js';

let currentUser = null;
let jobs = [];
let savedJobIds = new Set();
let candidateProfile = null;
let sampleCandidates = [];

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
    const [jobsRes, samples, profile, savedIds, firestoreJobs] = await Promise.all([
      fetch('/jobs.json'),
      loadSampleCandidates(),
      loadCurrentCandidateProfile(),
      loadSavedJobIds(),
      loadFirestoreJobs()
    ]);

    sampleCandidates = samples;
    candidateProfile = profile;
    const staticJobs = (await jobsRes.json()).map(normalizeStaticJob);
    const localJobs = getLocalJobs().map(normalizeRecruiterJob);
    jobs = mergeJobs([...localJobs, ...firestoreJobs.map(normalizeRecruiterJob), ...staticJobs])
      .map(addCandidateRank);
    savedJobIds = savedIds;
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
  const rankInfo = job.rankInfo;

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
      <div class="candidate-rank-panel">
        <div>
          <span>Your rank</span>
          <strong>${rankInfo ? `#${rankInfo.rank} of ${rankInfo.total}` : 'Not available'}</strong>
        </div>
        <div>
          <span>Match score</span>
          <strong>${rankInfo ? `${rankInfo.score}%` : '0%'}</strong>
        </div>
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
    saveLocalSavedJob(jobId);
    renderJobs();
    toast("Job saved.", "success");
  } catch (err) {
    console.error(err);
    savedJobIds.add(jobId);
    saveLocalSavedJob(jobId);
    renderJobs();
    toast("Job saved locally.", "success");
  }
}

async function loadCurrentCandidateProfile() {
  try {
    const snap = await getDoc(doc(db, 'candidates', currentUser.uid));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data(), candidate_id: snap.data().candidate_id || currentUser.uid };
    }
  } catch (err) {
    console.warn("Candidate profile unavailable; using session basics for rank preview.", err);
  }

  return {
    candidate_id: currentUser.uid,
    profile: {
      anonymized_name: currentUser.name || 'You',
      headline: 'Candidate',
      summary: '',
      years_of_experience: 0
    },
    skills: [],
    career_history: [],
    education: [],
    redrob_signals: {
      profile_completeness_score: 0,
      open_to_work_flag: true,
      recruiter_response_rate: 0
    }
  };
}

async function loadSavedJobIds() {
  const localIds = new Set(readLocalSavedJobs());
  try {
    const savedSnap = await getDocs(collection(db, 'candidates', currentUser.uid, 'saved_jobs'));
    savedSnap.docs.forEach(docSnap => localIds.add(docSnap.id));
  } catch (err) {
    console.warn("Saved jobs Firestore read unavailable; using local saved jobs.", err);
  }
  return localIds;
}

async function loadFirestoreJobs() {
  try {
    const snap = await getDocs(collection(db, 'jobs'));
    return snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (err) {
    console.warn("Firestore jobs unavailable; using local/static jobs.", err);
    return [];
  }
}

function normalizeStaticJob(job) {
  return {
    ...job,
    id: job.id,
    role: job.role,
    title: job.role,
    requiredSkills: job.tags || [],
    tags: job.tags || [],
    experienceLevel: inferExperienceLevel(job.experience),
    location: job.location || 'Flexible',
    source: 'sample'
  };
}

function normalizeRecruiterJob(job) {
  return {
    ...job,
    id: job.jobId || job.id,
    role: job.title || job.role || 'Posted Role',
    title: job.title || job.role || 'Posted Role',
    requiredSkills: job.requiredSkills || job.tags || [],
    tags: job.requiredSkills || job.tags || [],
    location: job.location || 'Recruiter posted',
    experience: job.experience || job.experienceLevel || 'Any experience',
    work_mode: job.work_mode || 'Flexible',
    salary_lpa: job.salary_lpa || {},
    source: job._local ? 'local' : 'recruiter'
  };
}

function addCandidateRank(job) {
  if (!candidateProfile) return job;
  const pool = [
    { ...candidateProfile, candidate_id: candidateProfile.candidate_id || currentUser.uid },
    ...sampleCandidates.filter(candidate => candidate.candidate_id !== candidateProfile.candidate_id)
  ];
  const ranked = rank(pool, job);
  const mine = ranked.find(item => item.candidateId === (candidateProfile.candidate_id || currentUser.uid));
  return {
    ...job,
    rankInfo: mine ? { rank: mine.rank, score: mine.total, total: ranked.length } : null
  };
}

function mergeJobs(items) {
  const map = new Map();
  items.forEach(job => map.set(job.id, job));
  return [...map.values()];
}

function inferExperienceLevel(experience = '') {
  const text = experience.toLowerCase();
  if (text.includes('1-') || text.includes('2-')) return 'junior';
  if (text.includes('5') || text.includes('6') || text.includes('7') || text.includes('8')) return 'senior';
  return 'mid';
}

function readLocalSavedJobs() {
  try {
    return JSON.parse(localStorage.getItem(savedJobsKey()) || '[]');
  } catch {
    return [];
  }
}

function saveLocalSavedJob(jobId) {
  const ids = new Set(readLocalSavedJobs());
  ids.add(jobId);
  localStorage.setItem(savedJobsKey(), JSON.stringify([...ids]));
}

function savedJobsKey() {
  return `recrob_saved_jobs_${currentUser.uid}`;
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
