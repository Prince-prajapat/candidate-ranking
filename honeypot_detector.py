"""
honeypot_detector.py
====================
Detects impossibly-profiled "honeypot" candidates that must be excluded
from the shortlist.  A honeypot rate > 10 % in the top-100 causes
automatic disqualification (per submission_spec).

Detection rules (derived from challenge documentation + dataset analysis):

  1. Company-founding-year mismatch  — candidate started at a company
     BEFORE the company was actually founded.
  2. Expert/Advanced skill with 0 duration_months — claiming mastery of
     a skill with zero practical use.
  3. Profile-level experience vs. career-history sum — large discrepancy
     between `years_of_experience` and sum of job `duration_months`.
  4. Job declared duration vs. calendar span — a job's duration_months
     is far greater than the actual start→end calendar window.
  5. Education timeline inversion — start_year > end_year.
  6. Job date inversion — start_date > end_date.

Returns a set of candidate_id strings that should be treated as honeypots.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Set

# ── Company founding years (real-world + fictional placeholders) ──────────────
COMPANY_FOUNDING_YEARS: Dict[str, int] = {
    # Real Indian startups — tight constraints
    "Krutrim": 2023,
    "Sarvam AI": 2023,
    "Glance": 2019,
    "Rephrase.ai": 2019,
    "Aganitha": 2018,
    "CRED": 2018,
    "Saarthi.ai": 2017,
    "Observe.AI": 2017,
    "Niramai": 2016,
    "Yellow.ai": 2016,
    "Verloop.io": 2015,
    "PhonePe": 2015,
    "Unacademy": 2015,
    "PharmEasy": 2015,
    "upGrad": 2015,
    "Freshworks": 2010,
    "Meesho": 2015,
    "Wysa": 2015,
    "Locobuzz": 2015,
    "Razorpay": 2014,
    "Vedantu": 2011,
    "BYJU'S": 2011,
    "Ola": 2010,
    "Paytm": 2010,
    "Nykaa": 2012,
    "Swiggy": 2013,
    "Haptik": 2013,
    "Dream11": 2008,
    "PolicyBazaar": 2008,
    "Zomato": 2008,
    "Flipkart": 2007,
    "InMobi": 2007,
    # Older Indian IT firms — loose constraints (we won't flag these)
    # Real global tech
    "Uber": 2009,
    "Meta": 2004,
    "LinkedIn": 2002,
    "Netflix": 1997,
    "Google": 1998,
    "Amazon": 1994,
    "Salesforce": 1999,
    "Adobe": 1982,
    "Microsoft": 1975,
    "Apple": 1976,
    # Fictional companies (dataset scaffolding) — very old so never flag
    "Pied Piper": 1900,
    "Initech": 1900,
    "Wayne Enterprises": 1900,
    "Acme Corp": 1900,
    "Stark Industries": 1900,
    "Hooli": 1900,
    "Globex Inc": 1900,
    "Dunder Mifflin": 1900,
}

# Threshold: if a candidate started working at a company MORE THAN this many
# years before the company was founded, flag it.  A small buffer (1 yr) is
# allowed for rounding / data noise.
_FOUNDING_YEAR_BUFFER = 1

_CURRENT_DATE = datetime(2026, 6, 20)


def _parse_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def _is_honeypot(candidate: Dict[str, Any]) -> tuple[bool, str]:
    """
    Returns (True, reason) if the candidate appears to be a honeypot,
    (False, "") otherwise.
    """
    profile = candidate.get("profile", {})
    history = candidate.get("career_history", [])
    edu = candidate.get("education", [])
    skills = candidate.get("skills", [])

    reasons: List[str] = []

    # ── Rule 1: company founding-year mismatch ─────────────────────────────
    for job in history:
        comp = job.get("company", "")
        start_str = job.get("start_date")
        if comp in COMPANY_FOUNDING_YEARS and start_str:
            start_year = int(start_str.split("-")[0])
            founded = COMPANY_FOUNDING_YEARS[comp]
            if founded > 1900 and start_year < (founded - _FOUNDING_YEAR_BUFFER):
                reasons.append(
                    f"worked at {comp} from {start_year} (founded {founded})"
                )

    # ── Rule 2: expert/advanced skill with 0 duration ─────────────────────
    expert_zero = [
        s["name"]
        for s in skills
        if s.get("proficiency") in ("expert", "advanced")
        and s.get("duration_months", 1) == 0
    ]
    if len(expert_zero) >= 3:
        reasons.append(
            f"claims expert/advanced in {len(expert_zero)} skills with 0 months used"
        )

    # ── Rule 3: profile experience vs career-history sum ──────────────────
    total_months = sum(j.get("duration_months", 0) for j in history)
    declared_yrs = profile.get("years_of_experience", 0) or 0
    if abs(total_months / 12.0 - declared_yrs) > 5.0:
        reasons.append(
            f"profile claims {declared_yrs:.1f} yrs but history sums to "
            f"{total_months / 12.0:.1f} yrs"
        )

    # ── Rule 4: declared duration >> calendar span ─────────────────────────
    for job in history:
        start = _parse_date(job.get("start_date"))
        end = _parse_date(job.get("end_date"))
        if not end and job.get("is_current"):
            end = _CURRENT_DATE
        if start and end:
            elapsed = (end.year - start.year) * 12 + (end.month - start.month)
            declared = job.get("duration_months", 0)
            if declared - elapsed > 24:          # more than 2 yrs padding
                reasons.append(
                    f"job at {job.get('company')} declares {declared} months "
                    f"but calendar span is only {elapsed} months"
                )

    # ── Rule 5 & 6: timeline inversions ───────────────────────────────────
    for school in edu:
        sy, ey = school.get("start_year"), school.get("end_year")
        if sy and ey and sy > ey:
            reasons.append(f"education start {sy} > end {ey}")

    for job in history:
        s = _parse_date(job.get("start_date"))
        e = _parse_date(job.get("end_date"))
        if s and e and s > e:
            reasons.append(
                f"job start {job.get('start_date')} > end {job.get('end_date')}"
            )

    if reasons:
        return True, "; ".join(reasons)
    return False, ""


def build_honeypot_set(jsonl_path: str) -> Set[str]:
    """
    Stream through the JSONL file and return the set of candidate_ids
    that are detected as honeypots.
    """
    honeypots: Set[str] = set()
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            cand = json.loads(line)
            flagged, _ = _is_honeypot(cand)
            if flagged:
                honeypots.add(cand["candidate_id"])
    return honeypots


def is_honeypot(candidate: Dict[str, Any]) -> tuple[bool, str]:
    """Public single-candidate check."""
    return _is_honeypot(candidate)
