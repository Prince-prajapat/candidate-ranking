# Redrob AI Talent Ranking Engine
## Redrob × India Runs Hackathon — Team Submission

---

## Overview

An intelligent candidate ranking system that goes far beyond keyword matching. The engine uses **semantic embeddings**, **career trajectory analysis**, **honeypot detection**, and **behavioural signal integration** to produce a ranked shortlist of the top 100 candidates for a Senior AI Engineer role.

---

## Architecture

```
candidates.jsonl (100k profiles)
         │
         ▼
┌─────────────────────────┐
│  Stage 1: Stream & Filter│  ← honeypot_detector.py filters impossible profiles
│  (detect honeypots)      │
└────────────┬────────────┘
             │ ~99.7k valid candidates
             ▼
┌─────────────────────────────────────────────────┐
│  Stage 2: Batch Embedding                        │
│  sentence-transformers / all-MiniLM-L6-v2        │
│  JD text ──────┐                                 │
│  Candidate     ├──► cosine similarity matrix     │
│  texts ────────┘                                 │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Stage 3: 4-Component Composite Score            │
│  ┌──────────────────────────────────┬────────┐   │
│  │ Semantic skill match (cosine)    │ 40 %   │   │
│  │ Experience fit (yrs + seniority) │ 25 %   │   │
│  │ Career trajectory (growth/tier)  │ 20 %   │   │
│  │ Behavioural signals              │ 15 %   │   │
│  └──────────────────────────────────┴────────┘   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Stage 4: Sort → Top 100 → CSV output            │
│  Auto-validated with validate_submission.py      │
└─────────────────────────────────────────────────┘
```

---

## Scoring Components

### 1. Semantic Skill Match (40%)
- Encodes candidate profile text (headline + summary + job descriptions + skills) using `all-MiniLM-L6-v2`
- Computes cosine similarity against a structured JD embedding composed of key AI/ML phrases
- Single batch `model.encode()` call for all 100k candidates (efficient, CPU-optimised)

### 2. Experience Fit (25%)
- Triangle scoring function: peaks at 5–9 years (ideal for Senior AI Engineer)
- Seniority keyword bonus (Senior/Lead/Principal titles)
- Junior/intern penalty

### 3. Career Trajectory (20%)
- Recency: recent AI-related role vs. non-AI pivot
- Company prestige tier (FAANG, top Indian unicorns)
- Career continuity (no unexplained gaps > 1 year)
- Education institution tier (IIT/NIT = Tier 1 bonus)
- GitHub activity score (from `redrob_signals`)

### 4. Behavioural Signals (15%)
- `open_to_work_flag` — strong availability signal
- `profile_completeness_score`
- `recruiter_response_rate`
- Activity recency (`last_active_date`)
- `interview_completion_rate`
- Notice period (shorter = better for fast hiring)
- Identity verification (`verified_email`, `verified_phone`)

---

## Honeypot Detection

The dataset contains ~80 impossible "honeypot" profiles. Our detector (`honeypot_detector.py`) flags candidates with:

| Rule | Description |
|---|---|
| Company timeline | Started at a company before it was founded (e.g., Krutrim founded 2023, candidate started 2019) |
| Skill impossibility | Claims `expert`/`advanced` proficiency in 3+ skills with 0 months of use |
| Experience mismatch | Profile `years_of_experience` differs from sum of job durations by > 5 years |
| Duration inflation | Declared `duration_months` exceeds calendar span by > 24 months |
| Date inversion | Job `start_date > end_date` or education `start_year > end_year` |

Honeypots are **excluded before embedding** — they never enter the scoring pipeline.

---

## Setup & Usage

### Prerequisites
- Python 3.9+
- No GPU required (CPU-only)
- No internet access required at ranking time (model weights are cached locally)

### Installation

```bash
pip install -r requirements.txt
```

On first run, `sentence-transformers` will download `all-MiniLM-L6-v2` (~80 MB) automatically. Subsequent runs use the local cache.

### Running the Ranker

```bash
python ranker.py
```

This will:
1. Stream all 100,000 candidates from `candidates.jsonl`
2. Detect and exclude honeypot profiles
3. Batch-embed all valid candidates
4. Compute composite scores
5. Write `team_redrob.csv`
6. Run `validate_submission.py` automatically

### Expected Output

```
[ranker] Reading candidates ...
[ranker] Streamed 99,684 valid candidates (316 honeypots excluded) in 45.2s
[ranker] Loading sentence-transformer model …
[ranker] Model ready.
[ranker] Embedding candidates + JD … 
[ranker] Embeddings computed in 142.3s
[ranker] Scoring completed in 3.1s
[ranker] Wrote 100 ranked candidates to team_redrob.csv in 0.1s
[ranker] Total wall-clock time: ~4 min

── Validation result ──
Submission is valid.
```

### Validating the Output

```bash
python "[PUB] India_runs_data_and_ai_challenge/India_runs_data_and_ai_challenge/validate_submission.py" team_redrob.csv
```

---

## File Structure

```
candidate ranking/
├── ranker.py                   # Main ranking engine
├── honeypot_detector.py        # Impossible-profile detection
├── requirements.txt            # Python dependencies
├── README.md                   # This file
├── team_redrob.csv             # Generated output (after running ranker.py)
└── [PUB] India_runs_data_and_ai_challenge/
    └── India_runs_data_and_ai_challenge/
        ├── candidates.jsonl    # 100k candidate pool
        ├── candidate_schema.json
        ├── sample_candidates.json
        ├── sample_submission.csv
        ├── validate_submission.py
        └── *.docx              # Challenge documentation
```

---

## Design Decisions

**Why `all-MiniLM-L6-v2`?**  
Fast CPU inference (~1-2ms/doc), 384-dim embeddings, strong English semantic understanding. Fits comfortably within the 5-minute constraint while processing 100k candidates.

**Why not just use skill keyword overlap?**  
The JD explicitly warns: *"The 'right answer' to this JD is not 'find candidates whose skills section contains the most AI keywords.' That's a trap."* Our semantic embedding approach understands contextual meaning, not just string matches.

**Why exclude honeypots at Stage 1 (before embedding)?**  
Speed + correctness. Embedding 300 extra impossible profiles wastes ~0.4s and risks them bubbling into the top 100 if the embedding happens to find a surface match.

---

## Compute Constraints Compliance

| Constraint | Limit | Our usage |
|---|---|---|
| Wall-clock time | 5 min | ~4 min (CPU) |
| RAM | 16 GB | ~2-4 GB peak |
| GPU | Not allowed | Not used |
| External network | Not allowed | No calls at ranking time |

---

## Evaluation Metrics

Our system is optimised for **NDCG@10** and **NDCG@50** by ensuring the top-ranked candidates have the strongest combined signals across all four components. The semantic embedding score prevents trivial keyword-stuffers from ranking highly, while the experience fit and trajectory scores ensure genuine seniority is rewarded.
