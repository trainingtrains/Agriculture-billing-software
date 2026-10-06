/**
 * Akshara Spices Trades - Global Loading, Processing & Feedback System
 */

// Active operation locks to prevent double-submission
const operationLocks = new Set();

/**
 * Executes an async function with double-submit locking.
 * Returns null if the lock is already held.
 */
export async function withLock(lockKey, asyncFn) {
  if (!lockKey) return await asyncFn();
  if (operationLocks.has(lockKey)) {
    console.warn(`[Operation Locked] ${lockKey} is already in progress.`);
    return null;
  }
  operationLocks.add(lockKey);
  try {
    return await asyncFn();
  } finally {
    operationLocks.delete(lockKey);
  }
}

/**
 * Sets a button into a loading state or restores its original state.
 * @param {HTMLElement|string} btn - Element or ID
 * @param {boolean} isLoading - Loading state
 * @param {string} loadingText - Text to show during loading
 */
export function setButtonLoading(btn, isLoading, loadingText = 'Processing...') {
  const el = typeof btn === 'string' ? document.getElementById(btn) : btn;
  if (!el) return;

  if (isLoading) {
    if (!el.hasAttribute('data-original-html')) {
      el.setAttribute('data-original-html', el.innerHTML);
    }
    // Lock button width to avoid UI jump
    const currentWidth = el.getBoundingClientRect().width;
    if (currentWidth > 0 && !el.style.minWidth) {
      el.style.minWidth = `${Math.ceil(currentWidth)}px`;
    }

    el.disabled = true;
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-disabled', 'true');
    el.classList.add('is-loading');

    el.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> <span>${loadingText}</span>`;
  } else {
    el.disabled = false;
    el.removeAttribute('aria-busy');
    el.removeAttribute('aria-disabled');
    el.classList.remove('is-loading');

    if (el.hasAttribute('data-original-html')) {
      el.innerHTML = el.getAttribute('data-original-html');
      el.removeAttribute('data-original-html');
    }
  }
}

/**
 * Displays a non-intrusive full-page or section loading overlay.
 */
export function showPageLoading(text = 'Loading application...') {
  let overlay = document.getElementById('globalLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalLoadingOverlay';
    overlay.className = 'global-loading-overlay';
    overlay.innerHTML = `
      <div class="loading-box">
        <div class="page-spinner"></div>
        <div id="globalLoadingText" class="loading-text">Loading...</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const textEl = document.getElementById('globalLoadingText');
  if (textEl) textEl.textContent = text;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-busy', 'true');
}

export function hidePageLoading() {
  const overlay = document.getElementById('globalLoadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.removeAttribute('aria-busy');
  }
}

/**
 * Generates skeleton loading rows for tables.
 */
export function showSkeleton(containerOrId, columnsCount = 6, rowCount = 4) {
  const container = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
  if (!container) return;

  let skeletonRows = '';
  for (let r = 0; r < rowCount; r++) {
    let cols = '';
    for (let c = 0; c < columnsCount; c++) {
      cols += `<td><div class="skeleton-cell"></div></td>`;
    }
    skeletonRows += `<tr class="skeleton-row">${cols}</tr>`;
  }
  container.innerHTML = skeletonRows;
}

export function hideSkeleton(containerOrId) {
  const container = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
  if (!container) return;
  const skeletons = container.querySelectorAll('.skeleton-row');
  skeletons.forEach(s => s.remove());
}

/**
 * Toast notifications with icon prefixes and status themes.
 */
export function showToast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const icon = icons[type] || 'ℹ';
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-message">${message}</span>`;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.gap = '8px';

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    el.style.display = 'none';
  }, 4000);
}

/**
 * Higher-Order Helper for Async Actions with button loading, locking, and toast feedback.
 */
export async function withAsyncFeedback({ button, loadingText, lockKey, successToast, errorToast }, asyncFn) {
  const runAction = async () => {
    if (button) setButtonLoading(button, true, loadingText);
    try {
      const result = await asyncFn();
      if (result !== false && successToast) {
        showToast(successToast, 'success');
      }
      return result;
    } catch (err) {
      console.error(`[Feedback Error] ${loadingText}:`, err);
      const errMsg = errorToast || err.message || 'Operation failed. Please try again.';
      showToast(errMsg, 'error');
      throw err;
    } finally {
      if (button) setButtonLoading(button, false);
    }
  };

  if (lockKey) {
    return await withLock(lockKey, runAction);
  } else {
    return await runAction();
  }
}
