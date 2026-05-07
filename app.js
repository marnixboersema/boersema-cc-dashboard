// === Boersema CC Foundations Dashboard ===
// Vanilla JS — fetches all lessons via /api/lessons (Vercel proxy to Airtable),
// then renders home grid or subject detail based on local state.

const SUBJECTS = [
  { key: 'History',         name: 'History',   icon: '📜', color: 'var(--c-history)' },
  { key: 'Science',         name: 'Science',   icon: '🔬', color: 'var(--c-science)' },
  { key: 'Latin',           name: 'Latin',     icon: '📖', color: 'var(--c-latin)' },
  { key: 'Math',            name: 'Math',      icon: '🔢', color: 'var(--c-math)' },
  { key: 'English Grammar', name: 'English',   icon: '✏️', color: 'var(--c-english)' },
  { key: 'Geography',       name: 'Geography', icon: '🌍', color: 'var(--c-geography)' },
  { key: 'Timeline',        name: 'Tydlyn',    icon: '⏳', color: 'var(--c-timeline)' },
  { key: 'Fine Arts',       name: 'Kuns',      icon: '🎨', color: 'var(--c-finearts)' },
];

const MIN_WEEK = 1;
const MAX_WEEK = 24;

const state = {
  records: [],
  cycle: 2,
  week: 2,
  view: 'home',
  subjectKey: null,
};

const root = document.getElementById('app');

// === Data loading ===

async function loadLessons() {
  try {
    const res = await fetch('/api/lessons');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    state.records = data.records || [];

    // Find the active record to set initial cycle/week.
    const active = state.records.find(r => r.fields?.Active === true);
    if (active) {
      state.cycle = Number(active.fields.Cycle) || state.cycle;
      state.week = Number(active.fields.Week) || state.week;
    } else if (state.records.length > 0) {
      const first = state.records[0];
      state.cycle = Number(first.fields.Cycle) || state.cycle;
      state.week = Number(first.fields.Week) || state.week;
    }

    render();
  } catch (err) {
    renderError(err.message);
  }
}

// === Lookup helpers ===

function lessonsForCurrentWeek() {
  return state.records.filter(r =>
    Number(r.fields?.Cycle) === state.cycle &&
    Number(r.fields?.Week) === state.week
  );
}

function lessonForSubject(subjectKey) {
  return state.records.find(r =>
    Number(r.fields?.Cycle) === state.cycle &&
    Number(r.fields?.Week) === state.week &&
    r.fields?.Subject === subjectKey
  );
}

function subjectMeta(key) {
  return SUBJECTS.find(s => s.key === key);
}

// === YouTube helpers ===

function parseYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1) || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'shorts') return parts[1] || null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function youtubeEmbedUrl(id) {
  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
}

// === Filename helpers ===

function stripExtension(filename) {
  if (!filename) return '';
  return filename.replace(/\.[^.]+$/, '');
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// === DOM utility ===

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
    else if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key in node && typeof val !== 'string') {
      node[key] = val;
    } else {
      node.setAttribute(key, val);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// === Renderers ===

function render() {
  clear(root);
  if (state.view === 'subject') {
    renderSubjectPage();
  } else {
    renderHome();
  }
  window.scrollTo(0, 0);
}

function renderError(msg) {
  clear(root);
  root.appendChild(
    el('div', { class: 'error' },
      el('strong', {}, 'Fout met laai van data: '),
      msg,
      el('div', { style: { marginTop: '0.5rem', fontSize: '0.9rem' } },
        'Kontroleer dat AIRTABLE_PAT en AIRTABLE_BASE_ID in Vercel gestel is.')
    )
  );
}

function renderHome() {
  const lessons = lessonsForCurrentWeek();
  const subjectsWithContent = new Set(lessons.map(r => r.fields?.Subject));

  const header = el('header', { class: 'home-header' },
    el('div', {},
      el('h1', { class: 'school-title' }, 'BOERSEMA SKOOL'),
      el('p', { class: 'cycle-week' },
        'Cycle ', el('strong', {}, String(state.cycle)),
        ' · Week ', el('strong', {}, String(state.week).padStart(2, '0'))
      )
    ),
    el('div', { class: 'week-nav' },
      el('button', {
        onclick: () => navigateWeek(-1),
        disabled: state.week <= MIN_WEEK,
        'aria-label': 'Vorige week',
      }, '← Vorige'),
      el('button', {
        onclick: () => navigateWeek(1),
        disabled: state.week >= MAX_WEEK,
        'aria-label': 'Volgende week',
      }, 'Volgende →'),
    )
  );
  root.appendChild(header);

  const grid = el('div', { class: 'subjects-grid' });
  for (const s of SUBJECTS) {
    const hasContent = subjectsWithContent.has(s.key);
    const card = el('button', {
      class: 'subject-card' + (hasContent ? '' : ' ghost'),
      style: { background: s.color },
      disabled: !hasContent,
      onclick: hasContent ? () => openSubject(s.key) : null,
      'aria-label': s.name + (hasContent ? '' : ' (geen inhoud hierdie week)'),
    },
      el('div', { class: 'subject-icon' }, s.icon),
      el('div', { class: 'subject-name' }, s.name)
    );
    grid.appendChild(card);
  }
  root.appendChild(grid);
}

function renderSubjectPage() {
  const meta = subjectMeta(state.subjectKey);
  const lesson = lessonForSubject(state.subjectKey);
  const fields = lesson?.fields || {};

  const header = el('header', { class: 'subject-header' },
    el('button', { class: 'back-button', onclick: goHome }, '← Terug'),
    el('h2', { class: 'subject-title' },
      el('span', { class: 'week-tag' },
        `Week ${String(state.week).padStart(2, '0')} ·`),
      ` ${meta.name}`
    )
  );
  root.appendChild(header);

  root.appendChild(
    el('div', { class: 'subject-color-bar', style: { background: meta.color } })
  );

  // Memory work
  const memoryEn = (fields['Memory Work'] || '').trim();
  const memoryAf = (fields['Memory Work (Afrikaans)'] || '').trim();
  if (memoryEn || memoryAf) {
    const memoryBox = el('div', { class: 'memory-text' });
    if (memoryEn) memoryBox.appendChild(el('div', {}, memoryEn));
    if (memoryAf) {
      memoryBox.appendChild(
        el('div', { class: 'memory-afrikaans' }, memoryAf)
      );
    }
    root.appendChild(
      el('section', { class: 'section' },
        el('h3', { class: 'section-title' }, '📚 Geheue-werk'),
        el('hr', { class: 'section-rule' }),
        memoryBox
      )
    );
  }

  // Videos: CC Connected + YouTube embeds
  const ccUrl = (fields['CC Connected URL'] || '').trim();
  const ccTitle = (fields['CC Connected Title'] || '').trim() || 'Open in CC Connected';
  const youtubeRaw = (fields['YouTube URLs'] || '').trim();
  const youtubeIds = youtubeRaw
    ? youtubeRaw.split(/\r?\n/).map(s => parseYouTubeId(s)).filter(Boolean)
    : [];

  if (ccUrl || youtubeIds.length > 0) {
    const list = el('div', { class: 'video-list' });
    if (ccUrl) {
      list.appendChild(
        el('a', {
          class: 'cc-link',
          href: ccUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
          el('span', { class: 'label' },
            el('span', { class: 'label-small' }, 'CC Connected'),
            el('span', {}, ccTitle),
          ),
          el('span', { class: 'arrow' }, '↗')
        )
      );
    }
    for (const id of youtubeIds) {
      list.appendChild(
        el('div', { class: 'youtube-wrapper' },
          el('iframe', {
            src: youtubeEmbedUrl(id),
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
            allowfullscreen: '',
            loading: 'lazy',
            title: 'YouTube video',
          })
        )
      );
    }
    root.appendChild(
      el('section', { class: 'section' },
        el('h3', { class: 'section-title' }, '🎬 Videos'),
        el('hr', { class: 'section-rule' }),
        list
      )
    );
  }

  // Audio
  const audioFiles = Array.isArray(fields['Audio Files']) ? fields['Audio Files'] : [];
  if (audioFiles.length > 0) {
    const list = el('div', { class: 'audio-list' });
    for (const file of audioFiles) {
      list.appendChild(buildAudioPlayer(file));
    }
    root.appendChild(
      el('section', { class: 'section' },
        el('h3', { class: 'section-title' }, '🎵 Audio'),
        el('hr', { class: 'section-rule' }),
        list
      )
    );
  }

  // PDFs
  const pdfFiles = Array.isArray(fields['PDFs']) ? fields['PDFs'] : [];
  if (pdfFiles.length > 0) {
    const list = el('div', { class: 'pdf-list' });
    for (const file of pdfFiles) {
      list.appendChild(
        el('a', {
          class: 'pdf-button',
          href: file.url,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
          el('span', { class: 'pdf-icon' }, '📄'),
          stripExtension(file.filename || 'Lêer')
        )
      );
    }
    root.appendChild(
      el('section', { class: 'section' },
        el('h3', { class: 'section-title' }, '📄 Drukbare materiaal'),
        el('hr', { class: 'section-rule' }),
        list
      )
    );
  }

  // Empty state when no content fields are populated.
  const hasAnything = memoryEn || memoryAf || ccUrl || youtubeIds.length || audioFiles.length || pdfFiles.length;
  if (!hasAnything) {
    root.appendChild(
      el('section', { class: 'section' },
        el('div', { class: 'section-empty' },
          'Geen inhoud vir hierdie week en vak nie.')
      )
    );
  }
}

function buildAudioPlayer(file) {
  const wrapper = el('div', { class: 'audio-player' });
  const title = stripExtension(file.filename || 'Audio');
  wrapper.appendChild(el('p', { class: 'audio-title' }, title));

  const audio = new Audio();
  audio.src = file.url;
  audio.preload = 'metadata';

  const playBtn = el('button', {
    class: 'audio-play',
    'aria-label': 'Speel of pouse',
  }, '▶');

  const seek = el('input', {
    class: 'audio-seek',
    type: 'range',
    min: '0',
    max: '100',
    value: '0',
    step: '0.1',
    'aria-label': 'Tyd',
  });

  const time = el('span', { class: 'audio-time' }, '0:00 / 0:00');

  const row = el('div', { class: 'audio-row' }, playBtn, seek, time);
  wrapper.appendChild(row);

  const speedRow = el('div', { class: 'speed-buttons' });
  const speeds = [0.5, 1, 1.5, 2];
  const speedButtons = speeds.map(speed => {
    const btn = el('button', {
      onclick: () => {
        audio.playbackRate = speed;
        speedButtons.forEach(b => b.classList.toggle('active', b === btn));
      },
      'aria-label': `Spoed ${speed}x`,
    }, `${speed}x`);
    if (speed === 1) btn.classList.add('active');
    speedRow.appendChild(btn);
    return btn;
  });

  const loopBtn = el('button', {
    class: 'loop-toggle',
    onclick: () => {
      audio.loop = !audio.loop;
      loopBtn.classList.toggle('active', audio.loop);
    },
    'aria-label': 'Skakel herhaal aan/af',
  }, '↻ HERHAAL');

  wrapper.appendChild(
    el('div', { class: 'audio-controls' }, speedRow, loopBtn)
  );

  // Audio events
  let seeking = false;

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().catch(err => console.warn('play failed', err));
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => { playBtn.textContent = '⏸'; });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });
  audio.addEventListener('ended', () => { if (!audio.loop) playBtn.textContent = '▶'; });

  audio.addEventListener('loadedmetadata', () => {
    seek.max = String(audio.duration || 0);
    time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

  audio.addEventListener('timeupdate', () => {
    if (!seeking) seek.value = String(audio.currentTime);
    time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

  seek.addEventListener('input', () => {
    seeking = true;
    time.textContent = `${formatTime(Number(seek.value))} / ${formatTime(audio.duration)}`;
  });
  seek.addEventListener('change', () => {
    audio.currentTime = Number(seek.value);
    seeking = false;
  });

  return wrapper;
}

// === State transitions ===

function navigateWeek(delta) {
  const next = state.week + delta;
  if (next < MIN_WEEK || next > MAX_WEEK) return;
  state.week = next;
  render();
}

function openSubject(key) {
  state.subjectKey = key;
  state.view = 'subject';
  render();
}

function goHome() {
  state.view = 'home';
  state.subjectKey = null;
  render();
}

// === Boot ===

loadLessons();
