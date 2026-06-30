// src/recruiter.js — Recruiter Dashboard Logic

import { onAuth, logout } from './auth.js';
import { db, doc, collection, getDocs, setDoc, deleteDoc } from './firebase.js';
import { toast, showSpinner, hideSpinner } from './utils.js';
import { deleteLocalJob, getLocalJobs, loadSampleCandidates, saveLocalJob } from './sampleData.js';

let currentUser = null;

export function initRecruiterDashboard() {
  // ── Authentication Check ──
  onAuth((user) => {
    if (!user || user.role !== 'recruiter') {
      toast("Access denied. Recruiter session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }
    currentUser = user;
    
    // Update dashboard header
    const recruiterName = document.getElementById('recruiterName');
    if (recruiterName) {
      recruiterName.textContent = user.name || 'Recruiter';
    }

    loadJobsList();
  });

  // Setup Logout Button
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  // Setup Job Posting Form Handler
  const jobForm = document.getElementById('jobForm');
  jobForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = jobForm.querySelector('button[type="submit"]');
    
    showSpinner(submitBtn, "Posting Job...");
    try {
      const result = await postNewJob();
      toast(result.storage === 'local'
        ? "Job saved locally and ready for ranking."
        : "Job posted successfully!", "success");
      jobForm.reset();
      await loadJobsList();
    } catch (err) {
      console.error(err);
      toast("Failed to post job: " + err.message, "error");
    } finally {
      hideSpinner(submitBtn);
    }
  });
}

// ── Load and Render Posted Jobs ──
async function loadJobsList() {
  const jobsListContainer = document.getElementById('jobsList');
  const jobsCountBadge = document.getElementById('jobsCountBadge');
  if (!jobsListContainer) return;

  jobsListContainer.innerHTML = `<div class="loading-pulse">🤖 Loading your posted opportunities...</div>`;

  try {
    const sampleCandidates = await loadSampleCandidates();
    const totalCandidates = sampleCandidates.length;
    const localJobs = getLocalJobs(currentUser.email);
    const firestoreJobs = await loadFirestoreJobs();
    const myJobs = mergeJobs(localJobs, firestoreJobs);

    // Update count badge
    if (jobsCountBadge) {
      jobsCountBadge.textContent = `${myJobs.length} posted`;
    }

    if (myJobs.length === 0) {
      jobsListContainer.innerHTML = `
        <div class="glass-card" style="padding: 40px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 3rem; margin-bottom: 16px;">💼</div>
          <h3>No Job Opportunities Posted Yet</h3>
          <p style="font-size: 0.9rem; margin-top: 8px;">Fill out the form on the left to list your first tech role and start ranking candidates instantly!</p>
        </div>
      `;
      return;
    }

    // Sort by newest
    myJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    jobsListContainer.innerHTML = '';
    myJobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'job-card glass-card fade-in-up';
      
      const skillsHtml = (job.requiredSkills || []).map(skill => 
        `<span class="badge" style="border-color: rgba(6, 182, 212, 0.2); color: var(--cyan); text-transform:none;">${skill}</span>`
      ).join(' ');

      card.innerHTML = `
        <div class="job-card-header">
          <div>
            <h3 class="job-card-title">${job.title}</h3>
            <div class="job-card-company">🏢 ${job.company} &bull; 💼 Level: <span style="text-transform: capitalize; font-weight:600; color:var(--violet-l);">${job.experienceLevel}</span></div>
          </div>
          <button class="delete-job-btn" data-id="${job.id}">Delete</button>
        </div>
        
        <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
          ${job.description}
        </p>

        <div class="job-card-skills">
          ${skillsHtml}
        </div>

        <div class="job-card-footer">
          <div class="job-card-stats">
            📊 Scored against <strong style="color:var(--green);">${totalCandidates}</strong> matching profiles
          </div>
          <a href="/recruiter/results.html?jobId=${job.id}" class="btn btn-primary btn-sm" style="padding: 8px 16px;">
            🔍 View AI Shortlist
          </a>
        </div>
      `;

      // Bind delete button
      card.querySelector('.delete-job-btn').addEventListener('click', async (e) => {
        if (confirm("Are you sure you want to delete this job posting?")) {
          const jobId = e.target.dataset.id;
          await deleteJob(jobId);
          toast("Job deleted successfully.", "info");
          await loadJobsList();
        }
      });

      jobsListContainer.appendChild(card);
    });

  } catch (err) {
    console.error("Error loading jobs list: ", err);
    jobsListContainer.innerHTML = `<div style="color: var(--pink); text-align:center; padding: 20px;">Error loading posted opportunities.</div>`;
  }
}

async function loadFirestoreJobs() {
  try {
    const jobsSnap = await getDocs(collection(db, 'jobs'));
    const jobs = [];
    jobsSnap.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (data && data.postedBy === currentUser.email) {
        jobs.push({ id: docSnap.id, ...data });
      }
    });
    return jobs;
  } catch (err) {
    console.warn("Firestore jobs unavailable; using local jobs only.", err);
    return [];
  }
}

function mergeJobs(localJobs, firestoreJobs) {
  const map = new Map();
  [...firestoreJobs, ...localJobs].forEach(job => {
    map.set(job.jobId || job.id, job);
  });
  return [...map.values()];
}

// ── Save Job Details ──
async function postNewJob() {
  const title = document.getElementById('jf-title').value;
  const company = document.getElementById('jf-company').value;
  
  // Read level select
  const experienceLevel = document.getElementById('jf-level').value;
  
  const skillsRaw = document.getElementById('jf-skills').value;
  const requiredSkills = skillsRaw ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  
  const description = document.getElementById('jf-desc').value;
  
  const mustRaw = document.getElementById('jf-must').value;
  const mustHaves = mustRaw ? mustRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  
  const niceRaw = document.getElementById('jf-nice').value;
  const niceToHaves = niceRaw ? niceRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];

  const jobId = 'JOB_' + Math.floor(100000 + Math.random() * 900000);
  const jobRef = doc(db, 'jobs', jobId);

  const jobDoc = {
    jobId,
    title,
    company,
    experienceLevel,
    requiredSkills,
    description,
    mustHaves,
    niceToHaves,
    postedBy: currentUser.email,
    createdAt: new Date().toISOString()
  };

  try {
    await setDoc(jobRef, jobDoc);
    return { ...jobDoc, id: jobId, storage: 'firestore' };
  } catch (err) {
    console.warn("Firestore rejected job write; saving locally.", err);
    return saveLocalJob(jobDoc);
  }
}

// ── Delete Posted Job ──
async function deleteJob(jobId) {
  deleteLocalJob(jobId);
  try {
    const jobRef = doc(db, 'jobs', jobId);
    await deleteDoc(jobRef);
  } catch (err) {
    console.warn("Firestore delete skipped; local job removed.", err);
  }
}
