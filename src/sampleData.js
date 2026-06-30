const LOCAL_JOBS_KEY = 'recrob_recruiter_jobs';

let sampleCandidatesCache = null;

export async function loadSampleCandidates() {
  if (sampleCandidatesCache) return sampleCandidatesCache;
  const res = await fetch('/india_runs_sample_candidates.json');
  if (!res.ok) {
    throw new Error('Could not load sample candidates dataset.');
  }
  sampleCandidatesCache = await res.json();
  return sampleCandidatesCache;
}

export function getLocalJobs(userEmail) {
  const allJobs = readAllLocalJobs();
  return allJobs
    .filter(job => !userEmail || job.postedBy === userEmail)
    .map(job => ({ ...job, id: job.jobId, _local: true }));
}

export function getLocalJob(jobId) {
  return readAllLocalJobs().find(job => job.jobId === jobId || job.id === jobId) || null;
}

export function saveLocalJob(job) {
  const allJobs = readAllLocalJobs();
  const normalized = {
    ...job,
    id: job.jobId,
    _local: true,
    storage: 'local'
  };
  const nextJobs = allJobs.filter(item => item.jobId !== normalized.jobId);
  nextJobs.push(normalized);
  localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(nextJobs));
  return normalized;
}

export function deleteLocalJob(jobId) {
  const nextJobs = readAllLocalJobs().filter(job => job.jobId !== jobId && job.id !== jobId);
  localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(nextJobs));
}

function readAllLocalJobs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || '[]');
  } catch {
    return [];
  }
}
