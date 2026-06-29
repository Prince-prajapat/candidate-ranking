// src/utils.js — General utility functions for UI and Ranking Calculations

// ── UI Toast Notifications ──
export function toast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    document.body.appendChild(container);
  }
  
  const el = document.createElement('div');
  el.className = `toast toast-${type} fade-in-up`;
  el.textContent = message;
  
  // Custom toast styling variables mapped to main.css theme
  el.style.padding = '12px 24px';
  el.style.borderRadius = '8px';
  el.style.color = '#fff';
  el.style.fontSize = '0.9rem';
  el.style.fontWeight = '600';
  el.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3)';
  el.style.transition = 'all 0.3s ease';
  
  if (type === 'success') {
    el.style.background = 'linear-gradient(135deg, #10b981, #059669)'; // Emerald
  } else if (type === 'error') {
    el.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)'; // Red
  } else if (type === 'info') {
    el.style.background = 'linear-gradient(135deg, #06b6d4, #0891b2)'; // Cyan
  } else {
    el.style.background = 'linear-gradient(135deg, #6b7280, #4b5563)'; // Gray
  }
  
  container.appendChild(el);
  
  // Fade out and remove toast
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ── Button loading spinners ──
export function showSpinner(button, text) {
  button.disabled = true;
  button.dataset.originalText = button.innerHTML;
  button.innerHTML = `<span class="spinner"></span> ${text || 'Loading...'}`;
}

export function hideSpinner(button) {
  if (button && button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
  }
  if (button) {
    button.disabled = false;
  }
}

// ── Levenshtein Distance Calculator ──
export function levenshtein(a, b) {
  const tmp = [];
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;
  
  for (let i = 0; i <= alen; i++) tmp[i] = [i];
  for (let j = 0; j <= blen; j++) tmp[0][j] = j;
  
  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[alen][blen];
}

// ── Clamp numerical values ──
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}
