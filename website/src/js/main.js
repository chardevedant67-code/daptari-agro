import {DOWNLOADS} from './downloads.config.js';
import {resolveDownload, formatSize} from './download-rules.js';

const LOCAL_PAGE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i
  .test(location.hostname) || location.protocol === 'file:';

// `npm run dev -- --android <file> --windows <file>` serves the real local
// installers for testing and injects their local URLs here. Never present
// on a deployed site.
function downloadsForThisPage() {
  const local = window.__WQR_LOCAL_DOWNLOADS__ || {};
  const out = {};
  for (const platform of Object.keys(DOWNLOADS)) {
    out[platform] = {...DOWNLOADS[platform], ...(local[platform] ? {url: local[platform]} : {})};
  }
  return out;
}

// ── downloads ─────────────────────────────────────────────────────────────

const STATUS_TEXT = {
  ready: entry => `Ready to download · ${formatSize(entry.sizeBytes)} · version ${entry.version}`,
  unconfigured: () => 'Not available yet — this installer has not been published to a download location.',
  invalid: () => 'This download link is misconfigured, so it has been disabled.',
};

function renderDownloads() {
  const downloads = downloadsForThisPage();
  for (const platform of Object.keys(downloads)) {
    const entry = downloads[platform];
    const other = platform === 'android' ? downloads.windows : downloads.android;
    const result = resolveDownload(platform, entry, other.url, location.href);
    const label = platform === 'android' ? 'Download Android APK' : 'Download Windows App';

    // Header / hero / footer links: the file when ready, otherwise the card
    // that explains why it is not available.
    document.querySelectorAll(`[data-download-link="${platform}"]`).forEach(a => {
      if (result.state === 'ready') {
        a.href = result.href;
        a.setAttribute('download', entry.fileName);
        a.removeAttribute('aria-describedby');
      } else {
        a.href = `#download-${platform}`;
        a.removeAttribute('download');
        a.setAttribute('aria-describedby', `download-${platform}-status`);
      }
      a.dataset.state = result.state;
    });

    const card = document.querySelector(`[data-download-card="${platform}"]`);
    if (!card) continue;
    card.dataset.state = result.state;

    card.querySelectorAll('[data-field]').forEach(el => {
      const key = el.dataset.field;
      el.textContent = key === 'size' ? formatSize(entry.sizeBytes) : (entry[key] ?? '');
    });

    const action = card.querySelector('[data-download-action]');
    if (action) {
      action.replaceChildren();
      if (result.state === 'ready') {
        const a = document.createElement('a');
        a.className = `btn btn--lg ${platform === 'android' ? 'btn--primary' : 'btn--navy'}`;
        a.href = result.href;
        a.setAttribute('download', entry.fileName);
        a.textContent = label;
        action.append(a);
      } else {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--lg btn--disabled';
        b.disabled = true;
        b.setAttribute('aria-describedby', `download-${platform}-status`);
        b.textContent = label;
        action.append(b);
      }
    }

    const status = card.querySelector('[data-download-status]');
    if (status) {
      status.textContent = STATUS_TEXT[result.state](entry);
      status.dataset.state = result.state;
    }

    // Only on a local preview: tell the site owner what to configure.
    const hint = card.querySelector('[data-dev-hint]');
    if (hint) {
      const show = LOCAL_PAGE && result.state !== 'ready';
      hint.hidden = !show;
      if (show) {
        hint.textContent = result.state === 'invalid'
          ? `Developer note: ${result.problem} Fix "${platform}.url" in src/js/downloads.config.js.`
          : `Developer note: set "${platform}.url" in src/js/downloads.config.js to the published file's https address (see README).`;
      }
    }
  }
}

// Copy a checksum, with visible success / failure feedback.
function initCopyButtons() {
  document.querySelectorAll('[data-copy-target]').forEach(button => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        button.textContent = 'Copied';
      } catch (_) {
        button.textContent = 'Copy failed — select and copy manually';
      }
      setTimeout(() => { button.textContent = original; }, 2200);
    });
  });
}

// ── navigation ────────────────────────────────────────────────────────────

function initNav() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const menu = document.getElementById('site-menu');
  if (!toggle || !menu) return;

  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.dataset.open = String(open);
    document.body.classList.toggle('menu-open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 960px)').addEventListener('change', e => { if (e.matches) setOpen(false); });

  // Shadow under the header once the page scrolls.
  const header = document.querySelector('.site-header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, {passive: true});
}

// Gentle fade-in of sections as they enter the screen. Skipped entirely when
// the visitor prefers reduced motion; content is visible without JS.
function initReveal() {
  const items = document.querySelectorAll('[data-reveal]');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, {rootMargin: '0px 0px -8% 0px', threshold: 0.08});
  items.forEach(el => io.observe(el));
}

document.querySelectorAll('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });
renderDownloads();
initCopyButtons();
initNav();
initReveal();
