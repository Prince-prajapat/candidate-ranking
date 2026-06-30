// src/seeder.js — Seeds Firestore with the India Runs sample candidate dataset
// Run from the recruiter dashboard via the "Seed Database" button

import {
  collection, doc, setDoc, getCountFromServer, getDocs, writeBatch
} from './firebase.js'
import { db } from './firebase.js'

const BATCH_SIZE = 400  // Firestore max per batch is 500

export async function seedDatabase(onProgress) {
  // Check if already seeded
  const col = collection(db, 'candidates')
  const countSnap = await getCountFromServer(col)
  const existingCount = countSnap.data().count

  if (existingCount >= 50) {
    return { skipped: true, count: existingCount }
  }

  // Fetch the browser-friendly 50-candidate sample from the challenge package.
  const res = await fetch('/india_runs_sample_candidates.json')
  const candidates = await res.json()

  let seeded = 0
  const chunks = chunkArray(candidates, BATCH_SIZE)

  for (const chunk of chunks) {
    const batch = writeBatch(db)
    chunk.forEach(candidate => {
      const ref = doc(col, candidate.candidate_id)
      batch.set(ref, {
        ...candidate,
        // Map to our app's expected structure for backward compat
        uid: candidate.candidate_id,
        personalInfo: {
          name: candidate.profile.anonymized_name,
          headline: candidate.profile.headline,
          location: `${candidate.profile.location}, ${candidate.profile.country}`,
          bio: candidate.profile.summary,
          photoURL: '',
        },
        _seeded: true,
        _dataset: 'India Runs Data and AI Challenge',
        _sample_source: 'india_runs_sample_candidates.json',
      })
    })
    await batch.commit()
    seeded += chunk.length
    onProgress?.(seeded, candidates.length)
  }

  return { seeded, total: candidates.length }
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// ── Count seeded candidates ───────────────────────────────────────────────────
export async function getCandidateCount() {
  const col = collection(db, 'candidates')
  const snap = await getCountFromServer(col)
  return snap.data().count
}
