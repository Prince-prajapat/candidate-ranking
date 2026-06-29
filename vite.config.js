import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'firebase/app': '/src/firebase.js',
      'firebase/firestore': '/src/firebase.js',
      'firebase/auth': '/src/firebase.js',
    }
  },
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
