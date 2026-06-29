// src/ranking.js — AI Multi-Signal Candidate Ranking Engine
// Fully aligned with the Redrob India Runs Challenge dataset schema
// ═══════════════════════════════════════════════════════════════════════════
//
// Scoring Model (weighted total = 100%):
//   30% — Skills Match        (endorsement-weighted fuzzy overlap + proficiency + duration)
//   25% — Experience Fit      (years × role-title cosine similarity + industry match)
//   20% — Semantic Fit        (TF-IDF cosine: JD text vs full profile text)
//   15% — Redrob Signals      (platform activity, assessments, github, responsiveness)
//   10% — Education Score     (degree level × institution tier × field relevance)
//
// ═══════════════════════════════════════════════════════════════════════════

import { levenshtein, clamp } from './utils.js'

// ── Scoring Weights ───────────────────────────────────────────────────────────
export const WEIGHTS = {
  skills:     0.30,
  experience: 0.25,
  semantic:   0.20,
  signals:    0.15,
  education:  0.10,
}

// ── Proficiency multipliers ───────────────────────────────────────────────────
const PROF_MULT = { beginner: 0.6, intermediate: 1.0, advanced: 1.5, expert: 2.0 }

// ── Degree level scores ───────────────────────────────────────────────────────
const DEGREE_SCORES = {
  'high school': 0.25, 'diploma': 0.40, 'associate': 0.45,
  'b.sc': 0.65, 'b.e': 0.70, 'b.tech': 0.70, 'bachelor': 0.70, 'be': 0.70,
  'm.sc': 0.85, 'm.tech': 0.88, 'master': 0.88, 'msc': 0.85, 'mba': 0.83,
  'phd': 1.00, 'doctorate': 1.00, 'ph.d': 1.00,
}

// ── Institution tier scores ───────────────────────────────────────────────────
const TIER_SCORES = { tier_1: 1.0, tier_2: 0.75, tier_3: 0.55, tier_4: 0.35, unknown: 0.5 }

// ── Stop words ────────────────────────────────────────────────────────────────
const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','is','are',
  'was','were','be','been','have','has','had','do','does','did','will','would','could',
  'should','may','might','must','shall','can','this','that','these','those','we','you',
  'they','he','she','it','i','our','your','their','its','my','as','by','from','up',
  'about','into','not','no','just','also','very','more','most','some','any','all','each',
])

// ── Known tech/domain skills for JD extraction ────────────────────────────────
const KNOWN_SKILLS = [
  'python','javascript','typescript','java','c++','c#','go','rust','swift','kotlin','scala',
  'react','vue','angular','nextjs','node','express','django','flask','fastapi','spring',
  'sql','nosql','mongodb','postgresql','mysql','redis','elasticsearch','cassandra',
  'aws','azure','gcp','docker','kubernetes','terraform','git','ci/cd','jenkins',
  'machine learning','deep learning','nlp','computer vision','tensorflow','pytorch',
  'scikit','pandas','numpy','spark','kafka','airflow','dbt','snowflake','databricks',
  'tableau','power bi','excel','data science','data engineering','mlops','llm',
  'react native','flutter','android','ios','html','css','tailwind','graphql','rest',
  'agile','scrum','jira','communication','leadership','teamwork','problem solving',
  'fine-tuning','transformers','hugging face','langchain','vector database','rag',
  'statistical modeling','a/b testing','hypothesis testing','time series',
]

// ── Tokenizer ─────────────────────────────────────────────────────────────────
function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9#+.\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t))
}

// ── TF vector ─────────────────────────────────────────────────────────────────
function buildVec(tokens) {
  const v = {}
  tokens.forEach(t => { v[t] = (v[t] || 0) + 1 })
  return v
}

function cosine(a, b) {
  let dot = 0, ma = 0, mb = 0
  Object.keys(a).forEach(k => { dot += a[k] * (b[k] || 0); ma += a[k] ** 2 })
  Object.values(b).forEach(v => { mb += v ** 2 })
  if (!ma || !mb) return 0
  return dot / (Math.sqrt(ma) * Math.sqrt(mb))
}

// ── Extract skills from JD free text ──────────────────────────────────────────
function extractJdSkills(jdText) {
  const lower = jdText.toLowerCase()
  const found = KNOWN_SKILLS.filter(s => lower.includes(s))
  // Also grab quoted phrases / capitalized terms
  const extras = (jdText.match(/\b[A-Z][a-zA-Z0-9+#.]{1,}\b/g) || [])
    .map(s => s.toLowerCase()).filter(s => !STOP.has(s))
  return [...new Set([...found, ...extras])]
}

// ═══ SIGNAL 1: Skills Match (30%) ════════════════════════════════════════════
function scoreSkills(candidate, jdSkillsRaw, jdText) {
  const jdSkills = [...new Set([...jdSkillsRaw.map(s => s.toLowerCase()), ...extractJdSkills(jdText)])]
  const cSkills = (candidate.skills || [])

  if (!jdSkills.length || !cSkills.length) return 0

  let totalScore = 0, maxPossible = 0

  jdSkills.forEach(jdS => {
    // max possible: expert proficiency (2.0) + endorsement bonus (0.3) + duration bonus (0.2)
    maxPossible += 2.5
    let best = 0
    cSkills.forEach(cs => {
      const cName = (cs.name || '').toLowerCase()
      const dist = levenshtein(jdS, cName)
      const maxLen = Math.max(jdS.length, cName.length)
      const strSim = maxLen === 0 ? 1 : 1 - dist / maxLen

      if (strSim >= 0.78) {
        const profMult    = PROF_MULT[cs.proficiency?.toLowerCase()] || 1.0
        const endBonus    = Math.min((cs.endorsements || 0) / 100, 0.3)   // up to +0.3
        const durBonus    = Math.min((cs.duration_months || 0) / 120, 0.2) // up to +0.2 (10 yrs)
        const assessBonus = (() => {
          const assessments = candidate.redrob_signals?.skill_assessment_scores || {}
          const score = assessments[cs.name]
          return score !== undefined ? (score / 100) * 0.2 : 0               // up to +0.2
        })()
        const total = strSim * profMult + endBonus + durBonus + assessBonus
        if (total > best) best = total
      }
    })
    totalScore += best
  })

  return clamp(totalScore / maxPossible, 0, 1)
}

// ═══ SIGNAL 2: Experience Fit (25%) ══════════════════════════════════════════
function scoreExperience(candidate, job) {
  const history = candidate.career_history || []
  const profileYears = candidate.profile?.years_of_experience || 0
  if (!history.length && !profileYears) return 0

  // ── Years score ──
  const levelMap = {
    'intern': 0, 'trainee': 0.5, 'junior': 1, 'associate': 2,
    'mid': 3, 'senior': 5, 'lead': 7, 'principal': 9, 'staff': 8,
    'manager': 5, 'director': 8, 'vp': 10,
  }
  const jdLevel = (job.experienceLevel || '').toLowerCase()
  const expectedYears = Object.entries(levelMap).find(([k]) => jdLevel.includes(k))?.[1] ?? 3
  const yearsScore = clamp(profileYears / Math.max(expectedYears, 1), 0, 1)

  // ── Role title similarity ──
  const jdTitleTokens = tokenize(job.title || '')
  const allTitlesTokens = history.flatMap(h => tokenize(h.title || ''))
  const titleScore = cosine(buildVec(jdTitleTokens), buildVec(allTitlesTokens))

  // ── Industry relevance ──
  const jdIndustry = (job.industry || '').toLowerCase()
  const hasIndustryMatch = history.some(h =>
    (h.industry || '').toLowerCase().includes(jdIndustry) || jdIndustry.includes((h.industry || '').toLowerCase())
  )
  const industryBonus = hasIndustryMatch && jdIndustry ? 0.1 : 0

  // ── Recency bonus: current role relevant? ──
  const currentJob = history.find(h => h.is_current)
  const currentRelevance = currentJob
    ? cosine(buildVec(jdTitleTokens), buildVec(tokenize(currentJob.title || '')))
    : 0

  return clamp(yearsScore * 0.45 + titleScore * 0.35 + currentRelevance * 0.1 + industryBonus, 0, 1)
}

// ═══ SIGNAL 3: Semantic Fit (20%) ═════════════════════════════════════════════
function scoreSemantic(candidate, jdText) {
  const profile = candidate.profile || {}
  const profileBlob = [
    profile.headline,
    profile.summary,
    profile.current_title,
    profile.current_industry,
    ...(candidate.skills || []).map(s => s.name),
    ...(candidate.career_history || []).flatMap(h => [h.title, h.company, h.description, h.industry]),
    ...(candidate.education || []).flatMap(e => [e.degree, e.field_of_study, e.institution]),
    ...(candidate.certifications || []).map(c => c.name),
  ].filter(Boolean).join(' ')

  const sim = cosine(buildVec(tokenize(jdText)), buildVec(tokenize(profileBlob)))
  // cosine similarity is naturally small; scale up (empirically tuned)
  return clamp(sim * 4.5, 0, 1)
}

// ═══ SIGNAL 4: Redrob Platform Signals (15%) ══════════════════════════════════
function scoreSignals(candidate) {
  const sig = candidate.redrob_signals || {}
  let score = 0

  // Profile completeness (0–0.25)
  score += clamp((sig.profile_completeness_score || 0) / 100, 0, 1) * 0.25

  // Open to work (0.10 bonus)
  if (sig.open_to_work_flag) score += 0.10

  // Activity recency (0–0.15): last active within 90 days
  if (sig.last_active_date) {
    const days = (Date.now() - new Date(sig.last_active_date).getTime()) / 86400000
    score += Math.max(0, (1 - days / 90)) * 0.15
  }

  // Recruiter response rate (0–0.15)
  score += clamp(sig.recruiter_response_rate || 0, 0, 1) * 0.15

  // GitHub activity (0–0.10)
  if (sig.github_activity_score >= 0) {
    score += clamp(sig.github_activity_score / 100, 0, 1) * 0.10
  }

  // Interview + offer completion (0–0.10)
  const interviewScore = clamp(sig.interview_completion_rate || 0, 0, 1)
  const offerScore     = sig.offer_acceptance_rate >= 0 ? clamp(sig.offer_acceptance_rate, 0, 1) : 0.5
  score += (interviewScore * 0.6 + offerScore * 0.4) * 0.10

  // Recruiter saves & search appearances (0–0.10)
  const saveScore   = Math.min((sig.saved_by_recruiters_30d || 0) / 20, 1)
  const searchScore = Math.min((sig.search_appearance_30d  || 0) / 500, 1)
  score += (saveScore * 0.5 + searchScore * 0.5) * 0.10

  // Verified identity bonus (0–0.05)
  if (sig.verified_email)  score += 0.025
  if (sig.verified_phone)  score += 0.025

  return clamp(score, 0, 1)
}

// ═══ SIGNAL 5: Education Score (10%) ══════════════════════════════════════════
function scoreEducation(candidate, jdText) {
  const edu = candidate.education || []
  if (!edu.length) return 0.2

  const jdSet = new Set(tokenize(jdText))
  let best = 0

  edu.forEach(e => {
    const degLower = (e.degree || '').toLowerCase()
    const degScore = Object.entries(DEGREE_SCORES).find(([k]) => degLower.includes(k))?.[1] ?? 0.5
    const tierScore = TIER_SCORES[e.tier || 'unknown'] || 0.5
    const fieldTokens = tokenize(e.field_of_study || '')
    const fieldMatch = fieldTokens.length
      ? fieldTokens.filter(t => jdSet.has(t)).length / fieldTokens.length
      : 0
    const total = degScore * 0.55 + tierScore * 0.30 + fieldMatch * 0.15
    if (total > best) best = total
  })

  return clamp(best, 0, 1)
}

// ═══ MAIN RANKING FUNCTION ════════════════════════════════════════════════════
/**
 * rank(candidates, job) → sorted array of ranked results
 *
 * @param {Array}  candidates  Array of candidate objects (Redrob schema)
 * @param {Object} job         { title, description, requiredSkills[], experienceLevel, industry?, mustHaves[], niceToHaves[] }
 * @returns {Array} Sorted descending by total score with full breakdown
 */
export function rank(candidates, job) {
  const jdText = [
    job.title,
    job.description,
    ...(job.requiredSkills  || []),
    ...(job.mustHaves       || []),
    ...(job.niceToHaves     || []),
  ].filter(Boolean).join(' ')

  const jdSkills = (job.requiredSkills || []).map(s => s.toLowerCase())

  const results = candidates.map(candidate => {
    const skillsScore  = scoreSkills    (candidate, jdSkills, jdText)
    const expScore     = scoreExperience(candidate, job)
    const semScore     = scoreSemantic  (candidate, jdText)
    const sigScore     = scoreSignals   (candidate)
    const eduScore     = scoreEducation (candidate, jdText)

    const total =
      skillsScore  * WEIGHTS.skills     +
      expScore     * WEIGHTS.experience +
      semScore     * WEIGHTS.semantic   +
      sigScore     * WEIGHTS.signals    +
      eduScore     * WEIGHTS.education

    return {
      candidate,
      candidateId: candidate.candidate_id,
      scores: {
        skillsMatch:    Math.round(skillsScore * 100),
        experienceFit:  Math.round(expScore    * 100),
        semanticFit:    Math.round(semScore    * 100),
        platformSignals:Math.round(sigScore    * 100),
        educationScore: Math.round(eduScore    * 100),
      },
      total: Math.round(total * 100),
      // Human-readable reasoning for submission output
      reasoning: buildReasoning(candidate, { skillsScore, expScore, sigScore }),
    }
  })

  return results
    .sort((a, b) => b.total - a.total)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

// ── Build reasoning string (matches submission format) ────────────────────────
function buildReasoning(candidate, { skillsScore, expScore, sigScore }) {
  const p = candidate.profile || {}
  const sig = candidate.redrob_signals || {}
  const skillCount = (candidate.skills || []).length
  return `${p.current_title || 'Candidate'} with ${p.years_of_experience || 0} yrs; ` +
    `${skillCount} skills; response rate ${sig.recruiter_response_rate?.toFixed(2) || 'N/A'}.`
}

// ── Format for submission CSV ─────────────────────────────────────────────────
export function toSubmissionRows(rankedResults) {
  return rankedResults.map(r => ({
    candidate_id: r.candidateId,
    rank: r.rank,
    score: (r.total / 100).toFixed(4),
    reasoning: r.reasoning,
  }))
}
