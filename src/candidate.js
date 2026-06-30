// src/candidate.js — Candidate Profile Wizard Logic

import { onAuth, logout } from './auth.js';
import { db, doc, getDoc, setDoc } from './firebase.js';
import { toast, showSpinner, hideSpinner } from './utils.js';

let currentUser = null;
let currentStep = 1;
const TOTAL_STEPS = 7;
const LOCAL_PROFILE_PREFIX = 'recrob_candidate_profile_';

// Local model for profile data
let profileData = {
  candidate_id: '',
  skills: [],
  career_history: [],
  education: [],
  projects: [],
  achievements: [],
  profile: {
    anonymized_name: '',
    headline: '',
    location: '',
    country: 'India',
    summary: '',
    years_of_experience: 0,
    current_title: '',
    current_company: '',
    current_industry: ''
  },
  redrob_signals: {
    open_to_work_flag: true,
    notice_period_days: 30,
    expected_salary_range_inr_lpa: { min: 6, max: 15 },
    preferred_roles: [],
    profile_completeness_score: 0,
    last_active_date: '',
    recruiter_response_rate: 0.85,
    github_activity_score: 75,
    verified_email: true,
    verified_phone: true
  }
};

export function initCandidatePage() {
  // ── Authentication Check ──
  onAuth((user) => {
    if (!user || user.role !== 'candidate') {
      toast("Access denied. Candidate session required.", "error");
      setTimeout(() => window.location.href = '/login.html', 1000);
      return;
    }
    currentUser = user;
    
    // Update basic sidebar info
    document.getElementById('userName').textContent = user.name || 'Candidate';
    document.getElementById('userEmail').textContent = user.email;
    document.getElementById('sidebarAvatar').textContent = (user.name || 'C').charAt(0).toUpperCase();

    loadProfile();
  });

  // Setup Logout Button
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  setupNavigation();
  setupSkillsManager();
  setupDynamicSections();
  setupPhotoUpload();
}

// ── Load Profile from Firestore ──
async function loadProfile() {
  const docRef = doc(db, 'candidates', currentUser.uid);
  try {
    const localProfile = loadLocalProfile();
    const docSnap = await getDoc(docRef);
    if (localProfile || docSnap.exists()) {
      const data = localProfile || docSnap.data();
      // Merge with default model to prevent undefined references
      profileData = {
        ...profileData,
        ...data,
        profile: { ...profileData.profile, ...data.profile },
        redrob_signals: { ...profileData.redrob_signals, ...data.redrob_signals },
        skills: data.skills || [],
        career_history: data.career_history || [],
        education: data.education || [],
        projects: data.projects || [],
        achievements: data.achievements || data.certifications || []
      };
    } else {
      // First time user, prefill name from auth
      profileData.profile.anonymized_name = currentUser.name || '';
      profileData.candidate_id = 'CAND_' + Math.floor(100000 + Math.random() * 900000);
    }
    
    populateForm();
    updateCompleteness();
  } catch (err) {
    console.error("Error loading profile: ", err);
    const localProfile = loadLocalProfile();
    if (localProfile) {
      profileData = {
        ...profileData,
        ...localProfile,
        profile: { ...profileData.profile, ...localProfile.profile },
        redrob_signals: { ...profileData.redrob_signals, ...localProfile.redrob_signals },
        skills: localProfile.skills || [],
        career_history: localProfile.career_history || [],
        education: localProfile.education || [],
        projects: localProfile.projects || [],
        achievements: localProfile.achievements || []
      };
      populateForm();
      updateCompleteness();
      return;
    }
    toast("Error retrieving profile data.", "error");
  }
}

// ── Populate Form Inputs ──
function populateForm() {
  // Step 1: Personal Info
  document.getElementById('pi-name').value = profileData.profile.anonymized_name || '';
  document.getElementById('pi-location').value = profileData.profile.location || '';
  document.getElementById('pi-headline').value = profileData.profile.headline || '';
  document.getElementById('pi-bio').value = profileData.profile.summary || '';
  if (profileData.profile.photoURL) {
    document.getElementById('pi-photo-preview').src = profileData.profile.photoURL;
  }

  // Step 2: Skills
  renderSkills();

  // Step 3: Work Experience
  const expContainer = document.getElementById('exp-list');
  expContainer.innerHTML = '';
  profileData.career_history.forEach(item => addExperienceCard(item));

  // Step 4: Education
  const eduContainer = document.getElementById('edu-list');
  eduContainer.innerHTML = '';
  profileData.education.forEach(item => addEducationCard(item));

  // Step 5: Projects
  const projContainer = document.getElementById('proj-list');
  projContainer.innerHTML = '';
  if (profileData.projects) {
    profileData.projects.forEach(item => addProjectCard(item));
  }

  // Step 6: Preferences
  document.getElementById('act-open').checked = !!profileData.redrob_signals.open_to_work_flag;
  
  // Notice period mapping
  const noticeDays = profileData.redrob_signals.notice_period_days || 30;
  let noticeVal = '30 days';
  if (noticeDays === 0) noticeVal = 'immediately';
  else if (noticeDays <= 15) noticeVal = '15 days';
  else if (noticeDays <= 30) noticeVal = '30 days';
  else if (noticeDays <= 60) noticeVal = '60 days';
  else noticeVal = '90 days';
  document.getElementById('act-avail').value = noticeVal;
  
  document.getElementById('act-roles').value = (profileData.redrob_signals.preferred_roles || []).join(', ');
  
  const salRange = profileData.redrob_signals.expected_salary_range_inr_lpa || {};
  document.getElementById('act-sal-min').value = salRange.min || '';
  document.getElementById('act-sal-max').value = salRange.max || '';

  // Step 7: Achievements
  const achContainer = document.getElementById('ach-list');
  achContainer.innerHTML = '';
  if (profileData.achievements) {
    profileData.achievements.forEach(item => addAchievementCard(item));
  }
}

// ── Form Navigation ──
function setupNavigation() {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const indicators = document.querySelectorAll('.step-indicator');

  indicators.forEach(ind => {
    ind.addEventListener('click', () => {
      const step = parseInt(ind.dataset.step);
      goToStep(step);
    });
  });

  prevBtn.addEventListener('click', () => {
    if (currentStep > 1) {
      goToStep(currentStep - 1);
    }
  });

  nextBtn.addEventListener('click', async () => {
    if (currentStep < TOTAL_STEPS) {
      goToStep(currentStep + 1);
    } else {
      // Step 6 Save action
      showSpinner(nextBtn, "Saving Profile...");
      try {
        await saveProfile();
        toast("Profile saved successfully!", "success");
        setTimeout(() => {
          window.location.href = '/candidate/home.html';
        }, 700);
      } catch (err) {
        console.error(err);
        toast("Failed to save profile: " + err.message, "error");
      } finally {
        hideSpinner(nextBtn);
      }
    }
  });
}

function goToStep(step) {
  // Collect data from the current step before moving
  collectStepData(currentStep);
  updateCompleteness();

  currentStep = step;

  // Toggle active form step
  document.querySelectorAll('.form-step').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.step) === currentStep);
  });

  // Toggle active sidebar indicator
  document.querySelectorAll('.step-indicator').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.step) === currentStep);
  });

  // Update nav buttons
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  prevBtn.disabled = currentStep === 1;
  if (currentStep === TOTAL_STEPS) {
    nextBtn.textContent = 'Save Profile';
    nextBtn.classList.add('save-mode');
  } else {
    nextBtn.textContent = 'Next \u2192';
    nextBtn.classList.remove('save-mode');
  }
}

// ── Collect step inputs ──
function collectStepData(step) {
  if (step === 1) {
    profileData.profile.anonymized_name = document.getElementById('pi-name').value;
    profileData.profile.location = document.getElementById('pi-location').value;
    profileData.profile.headline = document.getElementById('pi-headline').value;
    profileData.profile.summary = document.getElementById('pi-bio').value;
    profileData.profile.photoURL = document.getElementById('pi-photo-preview').src;
  }
  else if (step === 3) {
    const list = [];
    let totalMonths = 0;
    let currentTitle = '';
    let currentCompany = '';
    let currentIndustry = '';

    document.querySelectorAll('#exp-list .entry-card').forEach(card => {
      const company = card.querySelector('.exp-company').value;
      const title = card.querySelector('.exp-title').value;
      const start_date = card.querySelector('.exp-start').value;
      const end_date = card.querySelector('.exp-end').value;
      const is_current = card.querySelector('.exp-current').checked;
      const duration_months = parseInt(card.querySelector('.exp-months').value) || 12;
      const industry = card.querySelector('.exp-industry').value;
      const description = card.querySelector('.exp-desc').value;

      totalMonths += duration_months;
      
      if (is_current) {
        currentTitle = title;
        currentCompany = company;
        currentIndustry = industry;
      }

      list.push({ company, title, start_date, end_date: is_current ? '' : (end_date || ''), is_current, duration_months, industry, description });
    });
    profileData.career_history = list;
    profileData.profile.years_of_experience = parseFloat((totalMonths / 12).toFixed(1));
    if (currentTitle) {
      profileData.profile.current_title = currentTitle;
      profileData.profile.current_company = currentCompany;
      profileData.profile.current_industry = currentIndustry;
    } else if (list.length > 0) {
      // Fallback to first role
      profileData.profile.current_title = list[0].title;
      profileData.profile.current_company = list[0].company;
      profileData.profile.current_industry = list[0].industry;
    }
  }
  else if (step === 4) {
    const list = [];
    document.querySelectorAll('#edu-list .entry-card').forEach(card => {
      const institution = card.querySelector('.edu-inst').value;
      const degree = card.querySelector('.edu-degree').value;
      const field_of_study = card.querySelector('.edu-field').value;
      const start_year = parseInt(card.querySelector('.edu-start').value) || 2020;
      const end_year = parseInt(card.querySelector('.edu-end').value) || 2024;
      const grade = card.querySelector('.edu-grade').value;
      const tier = card.querySelector('.edu-tier').value;

      list.push({ institution, degree, field_of_study, start_year, end_year, grade, tier });
    });
    profileData.education = list;
  }
  else if (step === 5) {
    const list = [];
    document.querySelectorAll('#proj-list .entry-card').forEach(card => {
      const title = card.querySelector('.proj-title').value;
      const description = card.querySelector('.proj-desc').value;
      const url = card.querySelector('.proj-url').value;

      list.push({ title, description, url });
    });
    profileData.projects = list;
  }
  else if (step === 6) {
    profileData.redrob_signals.open_to_work_flag = document.getElementById('act-open').checked;
    
    // Notice Period Map
    const noticeVal = document.getElementById('act-avail').value;
    let days = 30;
    if (noticeVal === 'immediately') days = 0;
    else if (noticeVal === '15 days') days = 15;
    else if (noticeVal === '30 days') days = 30;
    else if (noticeVal === '60 days') days = 60;
    else days = 90;
    profileData.redrob_signals.notice_period_days = days;

    const rolesText = document.getElementById('act-roles').value;
    profileData.redrob_signals.preferred_roles = rolesText ? rolesText.split(',').map(r => r.trim()).filter(Boolean) : [];

    const minSal = parseFloat(document.getElementById('act-sal-min').value) || 0;
    const maxSal = parseFloat(document.getElementById('act-sal-max').value) || 0;
    profileData.redrob_signals.expected_salary_range_inr_lpa = { min: minSal, max: maxSal };
  }
  else if (step === 7) {
    const list = [];
    document.querySelectorAll('#ach-list .entry-card').forEach(card => {
      const type = card.querySelector('.ach-type').value;
      const title = card.querySelector('.ach-title').value;
      const issuer = card.querySelector('.ach-issuer').value;
      const date = card.querySelector('.ach-date').value;
      const url = card.querySelector('.ach-url').value;
      const imageSrc = card.querySelector('.ach-preview')?.src || '';
      const image = imageSrc.startsWith('data:image/svg+xml') ? '' : imageSrc;
      const description = card.querySelector('.ach-desc').value;

      if (title || issuer || url || image) {
        list.push({ type, title, issuer, date, url, image, description });
      }
    });
    profileData.achievements = list;
  }
}

// ── Skills tags manager ──
function setupSkillsManager() {
  const addBtn = document.getElementById('add-skill-btn');
  addBtn.addEventListener('click', () => {
    const nameInput = document.getElementById('skill-input');
    const profSelect = document.getElementById('skill-prof');
    const yearsInput = document.getElementById('skill-years');

    const name = nameInput.value.trim();
    if (!name) return;

    // Check duplicate
    if (profileData.skills.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      toast("Skill already added.", "info");
      return;
    }

    profileData.skills.push({
      name,
      proficiency: profSelect.value,
      duration_months: (parseInt(yearsInput.value) || 1) * 12,
      endorsements: Math.floor(Math.random() * 40) + 1
    });

    nameInput.value = '';
    yearsInput.value = '1';
    renderSkills();
    updateCompleteness();
  });
}

function renderSkills() {
  const listEl = document.getElementById('skills-list');
  listEl.innerHTML = '';
  
  if (profileData.skills.length === 0) {
    listEl.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted);">No skills added yet.</p>`;
    return;
  }

  profileData.skills.forEach((skill, index) => {
    const tag = document.createElement('div');
    tag.className = 'skill-tag';
    tag.innerHTML = `
      <span>${skill.name} (${skill.proficiency}, ${Math.round(skill.duration_months / 12)} yrs)</span>
      <button type="button" data-index="${index}">&times;</button>
    `;
    tag.querySelector('button').addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      profileData.skills.splice(idx, 1);
      renderSkills();
      updateCompleteness();
    });
    listEl.appendChild(tag);
  });
}

// ── Work, Education, Projects Card Generators ──
function setupDynamicSections() {
  // Experience
  document.getElementById('add-exp-btn').addEventListener('click', () => addExperienceCard());
  // Education
  document.getElementById('add-edu-btn').addEventListener('click', () => addEducationCard());
  // Projects
  document.getElementById('add-proj-btn').addEventListener('click', () => addProjectCard());
  // Achievements
  document.getElementById('add-ach-btn').addEventListener('click', () => addAchievementCard());
  setupQuickAddProject();
}

function addExperienceCard(data = {}) {
  const container = document.getElementById('exp-list');
  const card = document.createElement('div');
  card.className = 'entry-card';
  
  const id = 'exp_' + Math.random().toString(36).substr(2, 9);
  
  card.innerHTML = `
    <div class="entry-card-header">
      <h4 style="margin:0; font-weight:700;">💼 Work Entry</h4>
      <button class="remove-entry-btn" type="button">Remove</button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Company Name</label>
        <input type="text" class="glass-input exp-company" value="${data.company || ''}" required placeholder="e.g. Acme Corp"/>
      </div>
      <div class="form-group">
        <label class="form-label">Job Title</label>
        <input type="text" class="glass-input exp-title" value="${data.title || ''}" required placeholder="e.g. AI Engineer"/>
      </div>
      <div class="form-group">
        <label class="form-label">Start Date</label>
        <input type="date" class="glass-input exp-start" value="${data.start_date || ''}" required/>
      </div>
      <div class="form-group">
        <label class="form-label">End Date</label>
        <input type="date" class="glass-input exp-end" value="${data.end_date || ''}" ${data.is_current ? 'disabled' : ''}/>
      </div>
      <div class="form-group">
        <label class="form-label">Duration (Months)</label>
        <input type="number" class="glass-input exp-months" value="${data.duration_months || 12}" min="1"/>
      </div>
      <div class="form-group">
        <label class="form-label">Industry</label>
        <input type="text" class="glass-input exp-industry" value="${data.industry || ''}" placeholder="e.g. Software, Healthcare"/>
      </div>
      <div class="form-group full">
        <label class="form-label" style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" class="exp-current" ${data.is_current ? 'checked' : ''}/>
          <span>I currently work here</span>
        </label>
      </div>
      <div class="form-group full">
        <label class="form-label">Description / Core Projects</label>
        <textarea class="glass-input glass-textarea exp-desc" placeholder="Responsibilities, tech stack, and achievements...">${data.description || ''}</textarea>
      </div>
    </div>
  `;

  // Checkbox toggle end date
  const check = card.querySelector('.exp-current');
  const endInput = card.querySelector('.exp-end');
  check.addEventListener('change', () => {
    endInput.disabled = check.checked;
    if (check.checked) endInput.value = '';
  });

  card.querySelector('.remove-entry-btn').addEventListener('click', () => {
    card.remove();
    updateCompleteness();
  });

  container.appendChild(card);
}

function addEducationCard(data = {}) {
  const container = document.getElementById('edu-list');
  const card = document.createElement('div');
  card.className = 'entry-card';

  card.innerHTML = `
    <div class="entry-card-header">
      <h4 style="margin:0; font-weight:700;">🎓 Education Entry</h4>
      <button class="remove-entry-btn" type="button">Remove</button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Institution Name</label>
        <input type="text" class="glass-input edu-inst" value="${data.institution || ''}" required placeholder="e.g. IIT Delhi"/>
      </div>
      <div class="form-group">
        <label class="form-label">Degree</label>
        <input type="text" class="glass-input edu-degree" value="${data.degree || ''}" required placeholder="e.g. B.Tech"/>
      </div>
      <div class="form-group">
        <label class="form-label">Field of Study</label>
        <input type="text" class="glass-input edu-field" value="${data.field_of_study || ''}" required placeholder="e.g. Computer Science"/>
      </div>
      <div class="form-group">
        <label class="form-label">Institution Tier</label>
        <select class="glass-input edu-tier">
          <option value="tier_1" ${data.tier === 'tier_1' ? 'selected' : ''}>Tier 1 (IIT/IISc/Top Global)</option>
          <option value="tier_2" ${data.tier === 'tier_2' ? 'selected' : ''}>Tier 2 (NITs/Bits/Good regional)</option>
          <option value="tier_3" ${data.tier === 'tier_3' || !data.tier ? 'selected' : ''}>Tier 3 (Other Universities)</option>
          <option value="tier_4" ${data.tier === 'tier_4' ? 'selected' : ''}>Tier 4 (Unaccredited/Self-taught)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Start Year</label>
        <input type="number" class="glass-input edu-start" value="${data.start_year || 2020}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Graduation Year</label>
        <input type="number" class="glass-input edu-end" value="${data.end_year || 2024}"/>
      </div>
      <div class="form-group full">
        <label class="form-label">Grade / GPA</label>
        <input type="text" class="glass-input edu-grade" value="${data.grade || ''}" placeholder="e.g. 8.5 CGPA or 90%"/>
      </div>
    </div>
  `;

  card.querySelector('.remove-entry-btn').addEventListener('click', () => {
    card.remove();
    updateCompleteness();
  });

  container.appendChild(card);
}

function addProjectCard(data = {}) {
  const container = document.getElementById('proj-list');
  const card = document.createElement('div');
  card.className = 'entry-card';

  card.innerHTML = `
    <div class="entry-card-header">
      <h4 style="margin:0; font-weight:700;">🚀 Project Card</h4>
      <button class="remove-entry-btn" type="button">Remove</button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Project Name</label>
        <input type="text" class="glass-input proj-title" value="${data.title || ''}" required placeholder="e.g. Vector DB Search engine"/>
      </div>
      <div class="form-group">
        <label class="form-label">Repository / Link URL</label>
        <input type="url" class="glass-input proj-url" value="${data.url || ''}" placeholder="e.g. https://github.com/..."/>
      </div>
      <div class="form-group full">
        <label class="form-label">Project Description</label>
        <textarea class="glass-input glass-textarea proj-desc" placeholder="Outline what you built, stack used, and results...">${data.description || ''}</textarea>
      </div>
    </div>
  `;

  card.querySelector('.remove-entry-btn').addEventListener('click', () => {
    card.remove();
    updateCompleteness();
  });

  container.appendChild(card);
}

function addAchievementCard(data = {}) {
  const container = document.getElementById('ach-list');
  const card = document.createElement('div');
  card.className = 'entry-card';

  const imageSrc = data.image || data.certificate_image || '';
  card.innerHTML = `
    <div class="entry-card-header">
      <h4 style="margin:0; font-weight:700;">🏅 Achievement</h4>
      <button class="remove-entry-btn" type="button">Remove</button>
    </div>
    <div class="achievement-upload-row">
      <img class="ach-preview" src="${imageSrc || placeholderImage()}" alt="Certificate preview" />
      <div class="form-group" style="margin-bottom:0; flex:1;">
        <label class="form-label">Certificate / Badge Image</label>
        <input type="file" class="glass-input ach-image" accept="image/*" style="padding:8px;" />
      </div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="glass-input ach-type">
          <option value="certificate" ${data.type === 'certificate' || !data.type ? 'selected' : ''}>Certificate</option>
          <option value="award" ${data.type === 'award' ? 'selected' : ''}>Award</option>
          <option value="hackathon" ${data.type === 'hackathon' ? 'selected' : ''}>Hackathon Win</option>
          <option value="publication" ${data.type === 'publication' ? 'selected' : ''}>Publication</option>
          <option value="badge" ${data.type === 'badge' ? 'selected' : ''}>Badge</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Title</label>
        <input type="text" class="glass-input ach-title" value="${data.title || data.name || ''}" placeholder="e.g. AWS Cloud Practitioner" />
      </div>
      <div class="form-group">
        <label class="form-label">Issuer / Organizer</label>
        <input type="text" class="glass-input ach-issuer" value="${data.issuer || ''}" placeholder="e.g. AWS, HackerRank, IEEE" />
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input type="date" class="glass-input ach-date" value="${data.date || formatYearAsDate(data.year)}" />
      </div>
      <div class="form-group full">
        <label class="form-label">Credential / Publication URL</label>
        <input type="url" class="glass-input ach-url" value="${data.url || ''}" placeholder="https://..." />
      </div>
      <div class="form-group full">
        <label class="form-label">Notes</label>
        <textarea class="glass-input glass-textarea ach-desc" placeholder="Briefly describe the achievement, rank, scope, or result...">${data.description || ''}</textarea>
      </div>
    </div>
  `;

  const imgInput = card.querySelector('.ach-image');
  const imgPreview = card.querySelector('.ach-preview');
  imgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      imgPreview.src = ev.target.result;
      updateCompleteness();
    };
    reader.readAsDataURL(file);
  });

  card.querySelector('.remove-entry-btn').addEventListener('click', () => {
    card.remove();
    updateCompleteness();
  });

  container.appendChild(card);
}

function setupQuickAddProject() {
  const form = document.getElementById('quickProjectForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    collectStepData(currentStep);

    const project = {
      title: document.getElementById('qp-title').value.trim(),
      url: document.getElementById('qp-url').value.trim(),
      description: document.getElementById('qp-desc').value.trim()
    };

    if (!project.title) {
      toast("Project name is required.", "error");
      return;
    }

    profileData.projects = profileData.projects || [];
    profileData.projects.push(project);
    renderProjectsFromModel();
    updateCompleteness();

    const submitBtn = form.querySelector('button[type="submit"]');
    showSpinner(submitBtn, "Adding...");
    try {
      await saveProfile();
      form.reset();
      toast("Project added to your profile.", "success");
    } catch (err) {
      console.error(err);
      toast("Could not save project: " + err.message, "error");
    } finally {
      hideSpinner(submitBtn);
    }
  });
}

function renderProjectsFromModel() {
  const projContainer = document.getElementById('proj-list');
  projContainer.innerHTML = '';
  profileData.projects.forEach(item => addProjectCard(item));
}

function placeholderImage() {
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='72' viewBox='0 0 96 72'%3E%3Crect width='96' height='72' rx='10' fill='%23f1f5f9'/%3E%3Cpath d='M25 45h46M25 31h46M25 20h28' stroke='%2394a3b8' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E";
}

function formatYearAsDate(year) {
  return year ? `${year}-01-01` : '';
}

// ── Photo Upload handling ──
function setupPhotoUpload() {
  const imgInput = document.getElementById('pi-photo');
  const imgPreview = document.getElementById('pi-photo-preview');
  
  imgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        imgPreview.src = ev.target.result;
        profileData.profile.photoURL = ev.target.result;
        updateCompleteness();
      };
      reader.readAsDataURL(file);
    }
  });
}

// ── Completeness calculation ──
function updateCompleteness() {
  let score = 0;
  
  // 1. Personal Info: up to 20%
  const name = document.getElementById('pi-name')?.value || profileData.profile.anonymized_name;
  const location = document.getElementById('pi-location')?.value || profileData.profile.location;
  const headline = document.getElementById('pi-headline')?.value || profileData.profile.headline;
  const summary = document.getElementById('pi-bio')?.value || profileData.profile.summary;
  const photo = document.getElementById('pi-photo-preview')?.src || profileData.profile.photoURL;

  if (name) score += 4;
  if (location) score += 4;
  if (headline) score += 4;
  if (summary) score += 4;
  if (photo && !photo.startsWith('data:image/svg+xml')) score += 4;

  // 2. Skills: up to 20%
  if (profileData.skills.length > 0) {
    score += Math.min(20, profileData.skills.length * 5); // 5% per skill, max 20%
  }

  // 3. Work Exp: up to 20%
  const expCards = document.querySelectorAll('#exp-list .entry-card').length;
  if (expCards > 0) {
    score += Math.min(20, expCards * 10); // 10% per card, max 20%
  } else if (profileData.career_history.length > 0) {
    score += Math.min(20, profileData.career_history.length * 10);
  }

  // 4. Education: up to 20%
  const eduCards = document.querySelectorAll('#edu-list .entry-card').length;
  if (eduCards > 0) {
    score += Math.min(20, eduCards * 10); // 10% per card, max 20%
  } else if (profileData.education.length > 0) {
    score += Math.min(20, profileData.education.length * 10);
  }

  // 5. Projects: up to 10%
  const projCards = document.querySelectorAll('#proj-list .entry-card').length;
  if (projCards > 0) {
    score += Math.min(10, projCards * 5); // 5% per card, max 10%
  } else if (profileData.projects && profileData.projects.length > 0) {
    score += Math.min(10, profileData.projects.length * 5);
  }

  // 6. Preferences: up to 10%
  const roles = document.getElementById('act-roles')?.value || (profileData.redrob_signals.preferred_roles || []).join(', ');
  if (roles) score += 10;

  // 7. Achievements: optional bonus, capped at 100%
  const achCards = document.querySelectorAll('#ach-list .entry-card').length;
  if (achCards > 0 || (profileData.achievements && profileData.achievements.length > 0)) {
    score = Math.min(100, score + 5);
  }

  profileData.redrob_signals.profile_completeness_score = score;

  // Update UI Progress bar
  const progressFill = document.getElementById('profileProgress');
  const progressLabel = document.getElementById('progressLabel');
  if (progressFill && progressLabel) {
    progressFill.style.width = `${score}%`;
    progressLabel.textContent = `${score}% Complete`;
  }
}

function saveLocalProfile(profile) {
  localStorage.setItem(`${LOCAL_PROFILE_PREFIX}${currentUser.uid}`, JSON.stringify(toPlainData(profile)));
}

function loadLocalProfile() {
  try {
    return JSON.parse(localStorage.getItem(`${LOCAL_PROFILE_PREFIX}${currentUser.uid}`) || 'null');
  } catch {
    return null;
  }
}

function toPlainData(value) {
  if (Array.isArray(value)) {
    return value.map(toPlainData);
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    return '';
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return '';
  }
  if (typeof value === 'object') {
    const clean = {};
    Object.entries(value).forEach(([key, child]) => {
      if (typeof child !== 'function') {
        clean[key] = toPlainData(child);
      }
    });
    return clean;
  }
  return String(value);
}

function toFirestoreProfile(profile) {
  const clean = toPlainData(profile);
  clean.profile = clean.profile || {};
  if (typeof clean.profile.photoURL === 'string' && clean.profile.photoURL.startsWith('data:image/')) {
    clean.profile.photoURL = '';
  }
  clean.achievements = (clean.achievements || []).map(item => ({
    ...item,
    image: typeof item.image === 'string' && item.image.startsWith('data:image/') ? '' : item.image
  }));
  return clean;
}

// ── Save profile to Firestore ──
async function saveProfile() {
  // Collect all data from step 6 fields first
  collectStepData(TOTAL_STEPS);

  // Also perform a full final collection of all steps just in case
  collectStepData(1);
  collectStepData(3);
  collectStepData(4);
  collectStepData(5);
  collectStepData(6);
  collectStepData(7);

  updateCompleteness();

  profileData.redrob_signals.last_active_date = new Date().toISOString().split('T')[0];

  saveLocalProfile(profileData);

  const docRef = doc(db, 'candidates', currentUser.uid);
  try {
    await setDoc(docRef, toFirestoreProfile(profileData));
  } catch (err) {
    console.warn("Firestore profile save failed; profile saved locally.", err);
  }
}
