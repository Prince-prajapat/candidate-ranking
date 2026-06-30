import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        login: resolve('login.html'),
        candidateProfile: resolve('candidate/profile.html'),
        recruiterDashboard: resolve('recruiter/dashboard.html'),
        recruiterResults: resolve('recruiter/results.html'),
      }
    }
  }
});
