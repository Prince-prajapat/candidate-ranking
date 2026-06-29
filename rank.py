# rank.py — Production candidate ranker for Redrob Challenge
import json
import csv
import argparse
from datetime import datetime
import re

# ── Stopwords for basic NLP ────────────────────────────────────────────────────
STOP_WORDS = {
    'a','an','the','and','or','but','in','on','at','to','for','of','with','is','are',
    'was','were','be','been','have','has','had','do','does','did','will','would','could',
    'should','may','might','must','shall','can','this','that','these','those','we','you',
    'they','he','she','it','i','our','your','their','its','my','as','by','from','up',
    'about','into','not','no','just','also','very','more','most','some','any','all','each',
}

# ── Service companies list ─────────────────────────────────────────────────────
SERVICE_COMPANIES = {
    'tcs', 'tata consultancy services', 'infosys', 'wipro', 'accenture', 'cognizant', 
    'capgemini', 'hcl', 'hcltech', 'tech mahindra', 'l&t', 'ltts', 'l&t technology services', 
    'mindtree', 'mphasis', 'cts', 'tata consultancy', 'infosys limited', 'wipro limited'
}

# ── Preffered Locations ────────────────────────────────────────────────────────
PREFERRED_LOCATIONS = {'noida', 'pune', 'delhi', 'ncr', 'gurgaon', 'mumbai', 'hyderabad'}

# ── Helper: tokenize & clean ───────────────────────────────────────────────────
def tokenize(text):
    if not text:
        return []
    words = re.findall(r'[a-zA-Z0-9#+.]+', text.lower())
    return [w for w in words if w not in STOP_WORDS and len(w) > 1]

def build_tf(tokens):
    tf = {}
    for t in tokens:
        tf[t] = tf.get(t, 0) + 1
    return tf

def cosine_similarity(vec1, vec2):
    dot = 0
    for k, v in vec1.items():
        dot += v * vec2.get(k, 0)
    mag1 = sum(v ** 2 for v in vec1.values()) ** 0.5
    mag2 = sum(v ** 2 for v in vec2.values()) ** 0.5
    if not mag1 or not mag2:
        return 0.0
    return dot / (mag1 * mag2)

def calculate_average_tenure_months(career_history):
    if not career_history:
        return 0.0
    durations = [item.get('duration_months', 0) for item in career_history if item.get('duration_months')]
    if not durations:
        return 0.0
    return sum(durations) / len(durations)

# ── Scorer ─────────────────────────────────────────────────────────────────────
def score_candidate(cand):
    profile = cand.get('profile', {})
    career = cand.get('career_history', [])
    skills = cand.get('skills', [])
    education = cand.get('education', [])
    signals = cand.get('redrob_signals', {})
    
    # 1. Base check flags & disqualifiers
    is_service_only = False
    if career:
        companies = [c.get('company', '').lower().strip() for c in career if c.get('company')]
        if companies:
            is_service_only = all(any(s in comp for s in SERVICE_COMPANIES) for comp in companies)
            
    # Academic/Research only check
    is_academic_only = False
    if career:
        research_keywords = {'researcher', 'postdoc', 'academic', 'professor', 'lab', 'doctoral', 'phd researcher', 'research assistant'}
        titles = [c.get('title', '').lower() for c in career if c.get('title')]
        if titles:
            is_academic_only = all(any(rk in t for rk in research_keywords) for t in titles)
            
    # Title-chaser check (switching companies too fast)
    avg_tenure = calculate_average_tenure_months(career)
    is_title_chaser = len(career) >= 3 and avg_tenure < 18.0
    
    # Non-NLP check (Computer vision/speech/robotics with NO NLP/retrieval skills)
    cv_keywords = {'computer vision', 'image classification', 'speech recognition', 'tts', 'robotics', 'object detection', 'cnn', 'resnet', 'audio'}
    nlp_keywords = {'nlp', 'retrieval', 'search', 'embeddings', 'ranking', 'transformers', 'llm', 'bert', 'gpt', 'rag'}
    skill_names = {s.get('name', '').lower() for s in skills if s.get('name')}
    
    has_cv = any(any(cvk in s for cvk in cv_keywords) for s in skill_names)
    has_nlp = any(any(nlpk in s for nlpk in nlp_keywords) for s in skill_names)
    is_non_nlp_specialist = has_cv and not has_nlp
    
    # Recent LangChain only check
    recent_ai_only = False
    ai_skills = [s for s in skills if s.get('name', '').lower() in {'langchain', 'openai', 'chatgpt', 'llamaindex'}]
    other_ml = [s for s in skills if s.get('name', '').lower() in {'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit-learn', 'nlp', 'search', 'retrieval'}]
    if ai_skills and not other_ml:
        max_duration = max(s.get('duration_months', 0) for s in ai_skills)
        if max_duration <= 12:
            recent_ai_only = True
            
    # 2. Compute Scoring Elements
    # Skills Alignment (30%)
    target_skills = {
        'embeddings': 2.0, 'vector database': 2.0, 'pinecone': 1.8, 'weaviate': 1.8, 
        'milvus': 1.8, 'qdrant': 1.8, 'elasticsearch': 1.6, 'opensearch': 1.6, 
        'faiss': 1.6, 'python': 1.5, 'nlp': 1.5, 'ndcg': 2.0, 'mrr': 2.0, 'map': 2.0,
        'ab testing': 1.5, 'ranking': 1.8, 'retrieval': 1.8, 'search': 1.8
    }
    
    skills_score = 0.0
    max_skills_possible = sum(target_skills.values())
    for s in skills:
        sname = s.get('name', '').lower()
        sprof = s.get('proficiency', '').lower()
        prof_mult = 1.2 if sprof == 'expert' else (1.0 if sprof == 'advanced' else 0.8)
        
        # Match target skills using direct contains
        for ts, weight in target_skills.items():
            if ts in sname:
                skills_score += weight * prof_mult
                break
                
    skills_score = min(1.0, skills_score / max_skills_possible) if max_skills_possible else 0.0
    
    # Experience scoring (25%)
    years_exp = profile.get('years_of_experience', 0)
    exp_years_score = min(1.0, years_exp / 8.0)  # optimal 8 years
    
    # Job titles relevance (e.g. machine learning engineer, backend engineer, etc.)
    title_words = tokenize(" ".join([c.get('title', '') for c in career]))
    jd_titles_words = tokenize("Senior Machine Learning Engineer Applied ML ranking search retrieval")
    title_score = cosine_similarity(build_tf(title_words), build_tf(jd_titles_words))
    
    experience_score = exp_years_score * 0.5 + title_score * 0.5
    
    # Semantic text overlap (20%)
    bio_text = tokenize(f"{profile.get('headline', '')} {profile.get('summary', '')}")
    jd_tokens = tokenize("own the intelligence layer matching systems ranking retrieval embeddings hybrid retrieval vector databases evaluaton frameworks python product over research")
    semantic_score = cosine_similarity(build_tf(bio_text), build_tf(jd_tokens))
    
    # Redrob platform activity and response metrics (15%)
    completeness = signals.get('profile_completeness_score', 0) / 100.0
    response_rate = signals.get('recruiter_response_rate', 0.0)
    open_to_work = 1.0 if signals.get('open_to_work_flag') else 0.0
    
    # recency of active log in
    last_active = signals.get('last_active_date', '')
    days_inactive = 180.0
    if last_active:
        try:
            dt = datetime.strptime(last_active, '%Y-%m-%d')
            days_inactive = (datetime(2026, 6, 29) - dt).days
        except Exception:
            pass
    active_score = max(0.0, 1.0 - (days_inactive / 180.0))
    
    platform_score = completeness * 0.3 + response_rate * 0.3 + open_to_work * 0.2 + active_score * 0.2
    
    # Education Alignment (10%)
    edu_score = 0.0
    for e in education:
        deg = e.get('degree', '').lower()
        field = e.get('field_of_study', '').lower()
        tier = e.get('tier', '').lower()
        
        deg_score = 0.5
        if 'b' in deg or 'tech' in deg or 'eng' in deg:
            deg_score = 0.8
        if 'm' in deg or 'master' in deg or 'ph' in deg:
            deg_score = 1.0
            
        field_score = 0.5
        if 'computer' in field or 'data' in field or 'information' in field or 'math' in field:
            field_score = 1.0
            
        tier_mult = 1.0 if tier == 'tier_1' else (0.8 if tier == 'tier_2' else 0.6)
        curr_score = deg_score * field_score * tier_mult
        if curr_score > edu_score:
            edu_score = curr_score
            
    # 3. Sum up and apply disqualification penalty modifiers
    total_score = (
        skills_score * 0.30 +
        experience_score * 0.25 +
        semantic_score * 0.20 +
        platform_score * 0.15 +
        edu_score * 0.10
    )
    
    # Location alignment modifier (Delhi NCR, Noida, Pune, Mumbai, Hyderabad etc)
    loc = profile.get('location', '').lower()
    country = profile.get('country', '').lower()
    has_pref_loc = any(p in loc for p in PREFERRED_LOCATIONS) or 'india' in country
    if has_pref_loc:
        total_score *= 1.05  # up to 5% bonus for preferred locations
        
    # Apply severe penalty for strict disqualifiers
    reasons = []
    if is_service_only:
        total_score *= 0.2
        reasons.append("service company only")
    if is_academic_only:
        total_score *= 0.3
        reasons.append("academic research only")
    if is_title_chaser:
        total_score *= 0.6
        reasons.append("frequent job hopper")
    if is_non_nlp_specialist:
        total_score *= 0.4
        reasons.append("non-NLP specialist")
    if recent_ai_only:
        total_score *= 0.5
        reasons.append("recent OpenAI wrapper engineer only")
    if signals.get('recruiter_response_rate', 1.0) < 0.15:
        total_score *= 0.7
        reasons.append("very low response rate")
        
    reasoning = f"{profile.get('current_title', 'Engineer')} with {years_exp} yrs exp; {len(skills)} skills; response rate {response_rate:.2f}."
    if reasons:
        reasoning += " Note: " + ", ".join(reasons)
        
    return clamp_val(total_score, 0.0, 1.0), reasoning

def clamp_val(val, min_v, max_v):
    return max(min_v, min(max_v, val))

# ── Main CLI Runner ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidates', required=True, help="Path to candidates.jsonl")
    parser.add_argument('--out', required=True, help="Path to output CSV file")
    args = parser.parse_args()
    
    candidates_list = []
    
    print("Reading candidates...")
    with open(args.candidates, 'r', encoding='utf-8') as f:
        for idx, line in enumerate(f):
            if not line.strip():
                continue
            cand = json.loads(line)
            score, reasoning = score_candidate(cand)
            candidates_list.append({
                'candidate_id': cand['candidate_id'],
                'score': score,
                'reasoning': reasoning
            })
            if (idx + 1) % 10000 == 0:
                print(f"Processed {idx + 1} candidates...")
                
    # Sort by rounded score descending. Ties broken by candidate_id ascending.
    print("Sorting and ranking candidates...")
    candidates_list.sort(key=lambda x: (-round(x['score'], 4), x['candidate_id']))
    
    # Pick top 100 candidates
    top_100 = candidates_list[:100]
    
    # Save to output csv
    print(f"Writing results to {args.out}...")
    with open(args.out, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['candidate_id', 'rank', 'score', 'reasoning'])
        for rank_num, item in enumerate(top_100, 1):
            writer.writerow([
                item['candidate_id'],
                rank_num,
                f"{item['score']:.4f}",
                item['reasoning']
            ])
            
    print("Completed successfully!")

if __name__ == '__main__':
    main()
