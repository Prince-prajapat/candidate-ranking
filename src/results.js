// src/results.js — AI Shortlist Results Logic

import { onAuth, logout } from './auth.js';
import { db, doc, getDoc } from './firebase.js';
import { rank, toSubmissionRows } from './ranking.js';
import { toast } from './utils.js';
import { getLocalJob, loadSampleCandidates } from './sampleData.js';

let currentJob = null;
let allRankedResults = [];
let filteredResults = [];

export function initResultsPage() {
  // Retrieve Job ID from Query Params
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  if (!jobId) {
    toast("No job identifier provided. Redirecting to dashboard.", "error");
    setTimeout(() => window.location.href = '/recruiter/dashboard.html', 1500);
    return;
  }

  // ── Authentication Check ──
  onAuth((user) => {
    if (!user || user.role !== 'recruiter') {
      toast("Access denied. Recruiter session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }

    loadJobAndRankings(jobId);
  });

  // Setup Logout Button
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  // Setup Filters
  const filterSearch = document.getElementById('filterSearch');
  const filterMinScore = document.getElementById('filterMinScore');

  filterSearch?.addEventListener('input', () => filterAndRender());
  filterMinScore?.addEventListener('input', () => filterAndRender());

  // Setup Exports
  document.getElementById('exportJSON')?.addEventListener('click', () => downloadShortlistJSON());
  document.getElementById('exportCSV')?.addEventListener('click', () => downloadShortlistCSV());

  // Setup Re-rank button
  document.getElementById('rerankBtn')?.addEventListener('click', async () => {
    const rerankBtn = document.getElementById('rerankBtn');
    rerankBtn.disabled = true;
    rerankBtn.textContent = '⏳ Re-ranking...';
    try {
      await runRankingPipeline(jobId);
      toast("Re-ranking completed successfully!", "success");
    } catch (e) {
      console.error(e);
      toast("Failed to run rankings.", "error");
    } finally {
      rerankBtn.disabled = false;
      rerankBtn.textContent = '🔄 Re-rank Candidates';
    }
  });
}

// ── Fetch Job Criteria and Candidates ──
async function loadJobAndRankings(jobId) {
  const container = document.getElementById('resultsContainer');
  try {
    currentJob = await loadJob(jobId);
    if (!currentJob) {
      toast("Posted opportunity not found.", "error");
      setTimeout(() => window.location.href = '/recruiter/dashboard.html', 1500);
      return;
    }

    // Update Header UI
    document.getElementById('jobTitle').textContent = currentJob.title;
    document.getElementById('jobCompany').textContent = currentJob.company;
    document.getElementById('jobLevel').textContent = currentJob.experienceLevel;

    await runRankingPipeline(jobId);

  } catch (err) {
    console.error("Error loading job details: ", err);
    if (container) {
      container.innerHTML = `<div style="color:var(--pink); text-align:center; padding:40px;">Error loading target criteria.</div>`;
    }
  }
}

async function loadJob(jobId) {
  const localJob = getLocalJob(jobId);
  if (localJob) {
    return { id: localJob.jobId, ...localJob };
  }

  try {
    const jobSnap = await getDoc(doc(db, 'jobs', jobId));
    return jobSnap.exists() ? { id: jobSnap.id, ...jobSnap.data() } : null;
  } catch (err) {
    console.warn("Firestore job lookup unavailable.", err);
    return null;
  }
}

// ── Execute Ranking Calculation ──
async function runRankingPipeline(jobId) {
  const container = document.getElementById('resultsContainer');
  if (container) {
    container.innerHTML = `<div class="loading-pulse">🤖 Computing multi-signal AI ranking weights...</div>`;
  }

  try {
    const rawCandidates = await loadSampleCandidates();

    // Execute Ranking Logic
    allRankedResults = rank(rawCandidates, currentJob);
    
    // Update Stats counters
    document.getElementById('totalCount').textContent = allRankedResults.length;
    
    const topScoreVal = allRankedResults.length > 0 ? allRankedResults[0].total : 0;
    document.getElementById('topScore').textContent = `${topScoreVal}%`;

    filterAndRender();

  } catch (err) {
    console.error("Error running ranking pipeline: ", err);
    if (container) {
      container.innerHTML = `<div style="color:var(--pink); text-align:center; padding:40px;">Failed to compute ranking scores.</div>`;
    }
  }
}

// ── Filter and Render Shortlist ──
function filterAndRender() {
  const container = document.getElementById('resultsContainer');
  if (!container) return;

  const searchQuery = document.getElementById('filterSearch').value.toLowerCase().trim();
  const minScore = parseInt(document.getElementById('filterMinScore').value) || 0;

  // Filter candidates list
  filteredResults = allRankedResults.filter(item => {
    const totalScore = item.total;
    if (totalScore < minScore) return false;

    if (searchQuery) {
      const name = (item.candidate.profile?.anonymized_name || '').toLowerCase();
      const headline = (item.candidate.profile?.headline || '').toLowerCase();
      const skills = (item.candidate.skills || []).map(s => s.name.toLowerCase()).join(' ');
      
      const matchSearch = name.includes(searchQuery) || headline.includes(searchQuery) || skills.includes(searchQuery);
      if (!matchSearch) return false;
    }

    return true;
  });

  if (filteredResults.length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="padding: 40px; text-align:center; color: var(--text-secondary);">
        <h3>No Matching Candidates Found</h3>
        <p style="font-size:0.9rem; margin-top:8px;">Try clearing your search keyword or sliding the minimum match score down.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  
  // Render cards
  filteredResults.forEach((result) => {
    const cand = result.candidate;
    const profile = cand.profile || {};
    const signals = cand.redrob_signals || {};
    
    const initials = (profile.anonymized_name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    // Career History Timeline HTML
    let careerHtml = '<p style="color:var(--text-muted); font-size:0.8rem;">No work history provided.</p>';
    if (cand.career_history && cand.career_history.length > 0) {
      careerHtml = cand.career_history.map(job => `
        <div class="details-item">
          <div class="details-item-title">${job.title}</div>
          <div class="details-item-sub">🏢 ${job.company} &bull; ${job.start_date} ${job.is_current ? '- Present' : `to ${job.end_date || 'N/A'}`} (${job.duration_months} months)</div>
          <div class="details-item-desc">${job.description || ''}</div>
        </div>
      `).join('<div style="height:12px;"></div>');
    }

    // Education Timeline HTML
    let eduHtml = '<p style="color:var(--text-muted); font-size:0.8rem;">No academic background provided.</p>';
    if (cand.education && cand.education.length > 0) {
      eduHtml = cand.education.map(edu => `
        <div class="details-item">
          <div class="details-item-title">${edu.degree} in ${edu.field_of_study}</div>
          <div class="details-item-sub">🎓 ${edu.institution} &bull; Class of ${edu.end_year} &bull; <span style="text-transform: capitalize;">${(edu.tier || '').replace('_', ' ')}</span></div>
          <div class="details-item-desc">Grade: ${edu.grade || 'N/A'}</div>
        </div>
      `).join('<div style="height:12px;"></div>');
    }

    const card = document.createElement('div');
    card.className = 'candidate-card glass-card fade-in-up';
    card.style.marginBottom = '20px';

    card.innerHTML = `
      <div class="candidate-header">
        <div class="candidate-info-block">
          <div class="candidate-avatar">${initials}</div>
          <div>
            <span class="candidate-rank-badge">Rank #${result.rank}</span>
            <div class="candidate-name">${profile.anonymized_name || 'Anonymous Candidate'}</div>
            <div class="candidate-headline">${profile.headline || 'Technical Professional'}</div>
          </div>
        </div>
        <div class="candidate-score-block">
          <div class="candidate-score-val">${result.total}%</div>
          <div class="candidate-score-label">Match Score</div>
        </div>
      </div>

      <div class="candidate-reasoning">
        <strong>Scoring Reasoning:</strong> ${result.reasoning}
      </div>

      <!-- Linear progress breakdown of the 5 scoring weights -->
      <div class="candidate-breakdown">
        <div class="breakdown-item">
          <div class="breakdown-label">Skills (30%)</div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width: ${result.scores.skillsMatch}%; background-color: var(--cyan);"></div>
          </div>
          <div class="breakdown-val">${result.scores.skillsMatch}%</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-label">Exp Fit (25%)</div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width: ${result.scores.experienceFit}%; background-color: var(--violet);"></div>
          </div>
          <div class="breakdown-val">${result.scores.experienceFit}%</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-label">Semantic (20%)</div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width: ${result.scores.semanticFit}%; background-color: var(--pink);"></div>
          </div>
          <div class="breakdown-val">${result.scores.semanticFit}%</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-label">Signals (15%)</div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width: ${result.scores.platformSignals}%; background-color: var(--green);"></div>
          </div>
          <div class="breakdown-val">${result.scores.platformSignals}%</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-label">Edu (10%)</div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width: ${result.scores.educationScore}%; background-color: var(--orange);"></div>
          </div>
          <div class="breakdown-val">${result.scores.educationScore}%</div>
        </div>
      </div>

      <button class="candidate-details-toggle">View Career Timeline &rarr;</button>

      <div class="candidate-details-content">
        <div class="details-grid">
          <div>
            <div class="details-section-title">Timeline of Experience</div>
            <div class="details-list">
              ${careerHtml}
            </div>
          </div>
          <div>
            <div class="details-section-title">Education & Credentials</div>
            <div class="details-list">
              ${eduHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    // Collapsible logic
    const toggleBtn = card.querySelector('.candidate-details-toggle');
    const detailsContent = card.querySelector('.candidate-details-content');
    
    toggleBtn.addEventListener('click', () => {
      const isExpanded = detailsContent.classList.toggle('expanded');
      toggleBtn.textContent = isExpanded ? 'Hide Details' : 'View Career Timeline \u2192';
    });

    container.appendChild(card);
  });
}

// ── Export Shortlist to JSON ──
function downloadShortlistJSON() {
  if (filteredResults.length === 0) {
    toast("No candidates to export.", "info");
    return;
  }
  
  const payload = filteredResults.map(r => ({
    rank: r.rank,
    score: (r.total / 100).toFixed(4),
    candidate_id: r.candidateId,
    reasoning: r.reasoning,
    score_breakdown: r.scores
  }));

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `shortlist_job_${currentJob.jobId}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast("JSON export initiated!", "success");
}

// ── Export Shortlist to CSV ──
function downloadShortlistCSV() {
  if (filteredResults.length === 0) {
    toast("No candidates to export.", "info");
    return;
  }

  const rows = toSubmissionRows(filteredResults);
  const csvHeaders = "candidate_id,rank,score,reasoning";
  
  const csvLines = rows.map(r => 
    `"${r.candidate_id}",${r.rank},${r.score},"${r.reasoning.replace(/"/g, '""')}"`
  );
  
  const csvString = [csvHeaders, ...csvLines].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `shortlist_job_${currentJob.jobId}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast("CSV export initiated!", "success");
}
