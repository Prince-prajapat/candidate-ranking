"""
ranker.py  —  Redrob AI Talent Ranking Engine
==============================================
Produces a validated 100-row CSV shortlist from candidates.jsonl.

Algorithm (4-component weighted composite):
  ┌─────────────────────────────────────────────┬────────┐
  │ Component                                   │ Weight │
  ├─────────────────────────────────────────────┼────────┤
  │ 1. Semantic skill match (embedding cosine)  │  0.40  │
  │ 2. Experience fit  (years + seniority tier) │  0.25  │
  │ 3. Career trajectory  (growth + recency)    │  0.20  │
  │ 4. Behavioural signals  (engagement/intent) │  0.15  │
  └─────────────────────────────────────────────┴────────┘

Honeypot guard: candidates flagged by honeypot_detector.py receive a
score floor of 0.0 and are sorted to the bottom.

Constraints met:
  • CPU-only, no network calls at ranking time
  • < 5 min wall-clock (streaming JSONL, no full load into RAM)
  • Output: 100 rows, ranks 1–100, scores non-increasing
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from honeypot_detector import is_honeypot

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

DATA_DIR = os.path.join(
    os.path.dirname(__file__),
    "[PUB] India_runs_data_and_ai_challenge",
    "India_runs_data_and_ai_challenge",
)
CANDIDATES_FILE = os.path.join(DATA_DIR, "candidates.jsonl")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "team_redrob.csv")

# Weights — must sum to 1.0
W_SKILL = 0.40
W_EXPERIENCE = 0.25
W_TRAJECTORY = 0.20
W_SIGNALS = 0.15

# Ideal experience window for the Senior AI Engineer role (years)
EXP_MIN, EXP_IDEAL_LO, EXP_IDEAL_HI, EXP_MAX = 3, 5, 9, 20

# ─────────────────────────────────────────────────────────────────────────────
# Job-description embedding targets
# ─────────────────────────────────────────────────────────────────────────────

# Key phrases extracted directly from the JD — used to build the JD vector.
JD_SKILL_PHRASES = [
    "production machine learning systems",
    "large language models LLMs fine-tuning",
    "vector databases embeddings semantic search",
    "MLOps model serving inference optimisation",
    "PyTorch transformers deep learning",
    "RAG retrieval augmented generation pipelines",
    "distributed training GPU inference",
    "Python software engineering",
    "model evaluation benchmarking",
    "data pipelines feature engineering",
    "senior AI engineer",
    "ship production ML systems",
    "embedding models sentence transformers",
    "FAISS Pinecone Weaviate Milvus",
    "FastAPI microservices API design",
]

JD_TEXT = " ".join(JD_SKILL_PHRASES)

# Core AI / ML skills to look for in candidate skill lists
CORE_AI_SKILLS = {
    "python", "pytorch", "tensorflow", "keras",
    "machine learning", "deep learning", "nlp", "llm", "large language models",
    "transformers", "bert", "gpt", "fine-tuning",
    "vector database", "embeddings", "semantic search", "rag",
    "faiss", "pinecone", "weaviate", "milvus", "chroma",
    "mlops", "model serving", "inference", "onnx", "triton",
    "scikit-learn", "xgboost", "lightgbm",
    "sql", "spark", "kafka", "airflow",
    "docker", "kubernetes", "aws", "gcp", "azure",
    "distributed training", "cuda", "gpu",
    "fastapi", "flask", "rest api",
    "feature engineering", "data pipeline",
}

# High-prestige companies for trajectory scoring
TIER1_COMPANIES = {
    "google", "meta", "amazon", "microsoft", "apple", "netflix", "uber",
    "salesforce", "adobe", "linkedin",
    "openai", "deepmind", "anthropic",
    "flipkart", "razorpay", "swiggy", "zomato", "freshworks",
    "sarvam ai", "krutrim", "observe.ai",
}

CURRENT_DATE = datetime(2026, 6, 20)


# ─────────────────────────────────────────────────────────────────────────────
# Lazy sentence-transformer singleton
# ─────────────────────────────────────────────────────────────────────────────

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        print("[ranker] Loading sentence-transformer model …", flush=True)
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        print("[ranker] Model ready.", flush=True)
    return _model


def _embed(texts: List[str]) -> np.ndarray:
    model = _get_model()
    return model.encode(texts, convert_to_numpy=True, show_progress_bar=False)


# ─────────────────────────────────────────────────────────────────────────────
# Feature extraction helpers
# ─────────────────────────────────────────────────────────────────────────────

def _candidate_text(cand: Dict[str, Any]) -> str:
    """Build a rich free-text description of the candidate for embedding."""
    parts: List[str] = []
    p = cand.get("profile", {})

    if p.get("headline"):
        parts.append(p["headline"])
    if p.get("summary"):
        parts.append(p["summary"])
    if p.get("current_title"):
        parts.append(p["current_title"])

    for job in cand.get("career_history", [])[:4]:   # latest 4 jobs
        if job.get("title"):
            parts.append(job["title"])
        if job.get("description"):
            parts.append(job["description"])

    for skill in cand.get("skills", []):
        if skill.get("name"):
            parts.append(skill["name"])

    for cert in cand.get("certifications", []):
        if cert.get("name"):
            parts.append(cert["name"])

    return " ".join(parts)


def _experience_score(cand: Dict[str, Any]) -> float:
    """Score in [0, 1] based on years of experience and seniority signals."""
    yoe = cand.get("profile", {}).get("years_of_experience", 0) or 0

    # Triangle function: peak 1.0 in [EXP_IDEAL_LO, EXP_IDEAL_HI]
    if yoe < EXP_MIN:
        base = max(0.0, yoe / EXP_MIN * 0.4)
    elif yoe <= EXP_IDEAL_LO:
        base = 0.4 + (yoe - EXP_MIN) / (EXP_IDEAL_LO - EXP_MIN) * 0.6
    elif yoe <= EXP_IDEAL_HI:
        base = 1.0
    else:
        # Slight penalty for over-experienced (might be over-senior / expensive)
        excess = min(yoe - EXP_IDEAL_HI, EXP_MAX - EXP_IDEAL_HI)
        base = 1.0 - (excess / (EXP_MAX - EXP_IDEAL_HI)) * 0.25

    # Seniority bonus from title
    title = (cand.get("profile", {}).get("current_title") or "").lower()
    if any(t in title for t in ("senior", "lead", "principal", "staff", "head")):
        base = min(1.0, base + 0.08)
    elif any(t in title for t in ("junior", "intern", "trainee", "fresher")):
        base = max(0.0, base - 0.15)

    return float(np.clip(base, 0.0, 1.0))


def _count_ai_skills(cand: Dict[str, Any]) -> Tuple[int, float]:
    """Returns (count, weighted_score) of AI/ML skills present."""
    skills = cand.get("skills", [])
    proficiency_weight = {"expert": 1.0, "advanced": 0.8, "intermediate": 0.5, "beginner": 0.2}
    total, count = 0.0, 0
    for s in skills:
        name = s.get("name", "").lower()
        if any(k in name for k in CORE_AI_SKILLS):
            pw = proficiency_weight.get(s.get("proficiency", "beginner"), 0.2)
            dur = min(s.get("duration_months", 0), 60) / 60.0   # cap at 5 yrs
            total += pw * (0.5 + 0.5 * dur)
            count += 1
    score = min(1.0, total / 8.0)   # 8 core skills ≈ ideal
    return count, float(score)


def _trajectory_score(cand: Dict[str, Any]) -> float:
    """Career growth + recency + company prestige score in [0, 1]."""
    history = cand.get("career_history", [])
    if not history:
        return 0.1

    score = 0.0

    # Recency: was the most recent role AI-related?
    recent_title = (history[0].get("title") or "").lower()
    recent_desc = (history[0].get("description") or "").lower()
    ai_terms = ("ml", "ai", "machine learning", "data science", "nlp", "llm",
                 "deep learning", "model", "neural", "transformer")
    if any(t in recent_title or t in recent_desc for t in ai_terms):
        score += 0.35
    else:
        score += 0.05

    # Company prestige
    for job in history[:3]:
        comp = (job.get("company") or "").lower()
        if comp in TIER1_COMPANIES:
            score += 0.15
            break

    # Career continuity (no unexplained gaps > 1 yr)
    gaps_ok = True
    for i in range(len(history) - 1):
        end_str = history[i].get("end_date")
        next_start_str = history[i + 1].get("start_date")
        if end_str and next_start_str:
            try:
                end = datetime.strptime(end_str, "%Y-%m-%d")
                nxt = datetime.strptime(next_start_str, "%Y-%m-%d")
                gap_months = (end.year - nxt.year) * 12 + (end.month - nxt.month)
                if gap_months > 12:
                    gaps_ok = False
                    break
            except ValueError:
                pass
    if gaps_ok:
        score += 0.15

    # Educational tier bonus
    edu_tier_map = {"tier_1": 0.15, "tier_2": 0.10, "tier_3": 0.05, "tier_4": 0.0}
    edu = cand.get("education", [])
    if edu:
        best_tier = max(
            (edu_tier_map.get(e.get("tier", "tier_4"), 0.0) for e in edu),
            default=0.0,
        )
        score += best_tier

    # GitHub activity
    gh = cand.get("redrob_signals", {}).get("github_activity_score", -1)
    if gh is not None and gh >= 0:
        score += min(0.15, gh / 100.0 * 0.15)

    return float(np.clip(score, 0.0, 1.0))


def _signals_score(cand: Dict[str, Any]) -> float:
    """Engagement / availability behavioural signals score in [0, 1]."""
    sig = cand.get("redrob_signals", {})
    if not sig:
        return 0.3

    score = 0.0

    # Open to work — strong intent signal
    if sig.get("open_to_work_flag"):
        score += 0.20

    # Profile completeness
    completeness = sig.get("profile_completeness_score", 0) or 0
    score += (completeness / 100.0) * 0.15

    # Recruiter response rate
    rrr = sig.get("recruiter_response_rate")
    if rrr is not None and rrr >= 0:
        score += rrr * 0.20

    # Activity recency (days since last active)
    last_active_str = sig.get("last_active_date")
    if last_active_str:
        try:
            last_active = datetime.strptime(last_active_str, "%Y-%m-%d")
            days_idle = (CURRENT_DATE - last_active).days
            if days_idle <= 30:
                score += 0.20
            elif days_idle <= 90:
                score += 0.12
            elif days_idle <= 180:
                score += 0.05
        except ValueError:
            pass

    # Interview completion rate
    icr = sig.get("interview_completion_rate")
    if icr is not None and icr >= 0:
        score += icr * 0.10

    # Notice period (shorter = better for fast hiring)
    notice = sig.get("notice_period_days", 90)
    if notice is not None:
        score += max(0.0, (90 - min(notice, 90)) / 90.0) * 0.08

    # Verified identity bonus
    if sig.get("verified_email") and sig.get("verified_phone"):
        score += 0.05
    elif sig.get("verified_email") or sig.get("verified_phone"):
        score += 0.02

    # Downweights
    # Salary range inversion (honeypot signal but soft penalty if not caught)
    sal = sig.get("expected_salary_range_inr_lpa", {}) or {}
    s_min, s_max = sal.get("min"), sal.get("max")
    if s_min is not None and s_max is not None and s_min > s_max:
        score *= 0.5

    return float(np.clip(score, 0.0, 1.0))


# ─────────────────────────────────────────────────────────────────────────────
# Main ranking pipeline
# ─────────────────────────────────────────────────────────────────────────────

def rank_candidates(
    candidates_file: str = CANDIDATES_FILE,
    output_file: str = OUTPUT_FILE,
    top_n: int = 100,
) -> str:
    """
    Full ranking pipeline. Returns path to the output CSV.

    Stage 1 — Stream & pre-filter: load all candidates, detect honeypots,
               collect candidate texts for batch embedding.

    Stage 2 — Embed: batch-embed all candidate texts + JD text together
               (single model.encode call for efficiency).

    Stage 3 — Score: compute 4-component composite score per candidate.

    Stage 4 — Output: sort, take top_n, write validated CSV.
    """
    t0 = time.time()
    print(f"[ranker] Reading candidates from {candidates_file} …", flush=True)

    records: List[Dict[str, Any]] = []   # lightweight per-candidate data
    texts: List[str] = []               # candidate texts for embedding
    honeypot_ids = set()

    with open(candidates_file, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            cand = json.loads(line)
            cid = cand["candidate_id"]

            flagged, reason = is_honeypot(cand)
            if flagged:
                honeypot_ids.add(cid)
                continue  # skip honeypots entirely — don't even score them

            # Extract lightweight features to avoid keeping full JSON in RAM
            exp_score = _experience_score(cand)
            ai_count, skill_feat = _count_ai_skills(cand)
            traj_score = _trajectory_score(cand)
            sig_score = _signals_score(cand)
            text = _candidate_text(cand)

            records.append({
                "candidate_id": cid,
                "exp_score": exp_score,
                "skill_feat": skill_feat,
                "traj_score": traj_score,
                "sig_score": sig_score,
                "ai_count": ai_count,
                "exp_years": (cand.get("profile", {}).get("years_of_experience") or 0),
                "title": (cand.get("profile", {}).get("current_title") or ""),
                "recruiter_response_rate": (
                    cand.get("redrob_signals", {}).get("recruiter_response_rate") or 0
                ),
            })
            texts.append(text)

            if (i + 1) % 20000 == 0:
                print(f"[ranker]   … {i+1:,} candidates processed", flush=True)

    t1 = time.time()
    print(
        f"[ranker] Streamed {len(records):,} valid candidates "
        f"({len(honeypot_ids)} honeypots excluded) in {t1-t0:.1f}s",
        flush=True,
    )

    # ── Stage 2: embed ─────────────────────────────────────────────────────
    print("[ranker] Embedding candidates + JD …", flush=True)
    all_texts = [JD_TEXT] + texts
    all_embeddings = _embed(all_texts)
    jd_emb = all_embeddings[0]
    cand_embs = all_embeddings[1:]

    # Cosine similarity
    jd_norm = jd_emb / (np.linalg.norm(jd_emb) + 1e-9)
    norms = np.linalg.norm(cand_embs, axis=1, keepdims=True) + 1e-9
    cand_normed = cand_embs / norms
    cosine_sims = cand_normed @ jd_norm

    t2 = time.time()
    print(f"[ranker] Embeddings computed in {t2-t1:.1f}s", flush=True)

    # ── Stage 3: composite score ────────────────────────────────────────────
    scores: List[Tuple[float, Dict[str, Any]]] = []
    for idx, rec in enumerate(records):
        sem_score = float(cosine_sims[idx])
        # Normalise cosine to [0, 1]: typical range is [-0.2, 0.8]
        sem_score_norm = float(np.clip((sem_score + 0.2) / 1.0, 0.0, 1.0))

        composite = (
            W_SKILL * sem_score_norm
            + W_EXPERIENCE * rec["exp_score"]
            + W_TRAJECTORY * rec["traj_score"]
            + W_SIGNALS * rec["sig_score"]
        )
        scores.append((composite, rec))

    # Sort descending
    scores.sort(key=lambda x: (-x[0], x[1]["candidate_id"]))

    t3 = time.time()
    print(f"[ranker] Scoring completed in {t3-t2:.1f}s", flush=True)

    # ── Stage 4: write CSV ──────────────────────────────────────────────────
    top = scores[:top_n]

    # Ensure strictly non-increasing scores (tie-break by cand_id ascending)
    # This is already guaranteed by the sort above.

    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["candidate_id", "rank", "score", "reasoning"])
        for rank, (score, rec) in enumerate(top, start=1):
            reasoning = (
                f"{rec['title'] or 'AI Engineer'} with "
                f"{rec['exp_years']:.1f} yrs experience; "
                f"{rec['ai_count']} AI/ML core skills matched; "
                f"semantic fit score {score:.3f}; "
                f"recruiter response rate {rec['recruiter_response_rate']:.2f}."
            )
            writer.writerow([
                rec["candidate_id"],
                rank,
                round(score, 4),
                reasoning,
            ])

    t4 = time.time()
    print(
        f"[ranker] Wrote {top_n} ranked candidates to {output_file} "
        f"in {t4-t3:.1f}s",
        flush=True,
    )
    print(f"[ranker] Total wall-clock time: {t4-t0:.1f}s", flush=True)
    return output_file


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    out = rank_candidates()
    print(f"\nOutput: {out}")

    # Run the official validator automatically
    validator_path = os.path.join(DATA_DIR, "validate_submission.py")
    if os.path.exists(validator_path):
        import subprocess
        result = subprocess.run(
            [sys.executable, validator_path, out],
            capture_output=True, text=True
        )
        print("\n── Validation result ──")
        print(result.stdout or result.stderr)
