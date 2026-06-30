import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        login: resolve('login.html'),
        candidateHome: resolve('candidate/home.html'),
        candidateProfile: resolve('candidate/profile.html'),
        candidateFeed: resolve('candidate/feed.html'),
        candidateJobs: resolve('candidate/jobs.html'),
        recruiterDashboard: resolve('recruiter/dashboard.html'),
        recruiterCandidates: resolve('recruiter/candidates.html'),
        recruiterResults: resolve('recruiter/results.html'),
      }
    }
  }
});
