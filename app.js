/* ==========================================================================
   IDEAL — Studio Archive & Customizable Visual Vault (v4)
   - Pop-uppable / Pinnable Sidebar with customizable labels
   - Single-row Header & Single-row Filter/Action Bar
   - 07 Customize & Design (Fonts, Theme Presets, Card Geometry, Per-Section UI)
   - Per-Section UI Drawer (Layout Mode, Aspect Ratio, Image Fit, Card Size)
   - Full Visual Seed Data: 8 Project Boards + All Spaces Populated with Every Item Type
   ========================================================================== */

const LS_KEY = 'ideal_vault_v5';
const CURRENT_VAULT_VERSION = 25;

/* ==========================================================================
   IDEAL PRIVATE CLOUD VAULT BRIDGE (GitHub Pages -> Private ideal-vault Repo)
   - Zero impact on localhost:8080 (only activates on *.github.io)
   - Shares authentication token with Finland on omgorigold-maker.github.io
   - Privately loads & saves ideal_vault.json and vault_media/* via GitHub API
   ========================================================================== */
(function initIdealPrivateCloudBridge() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const CLOUD_REPO = 'omgorigold-maker/ideal-vault';
  const FINLAND_REPO = 'omgorigold-maker/finland-vault';
  const GH_API_BASE = 'https://api.github.com/repos/' + CLOUD_REPO + '/contents';

  function parseCandidateKey(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';
    try {
      if (str.includes('cloud_key=')) {
        const m = str.match(/[?&#]cloud_key=([^&#\s]+)/);
        if (m && m[1]) return decodeURIComponent(m[1]).trim();
      }
    } catch (e) {}
    return str;
  }

  function extractKeyFromUrl() {
    try {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      let found = '';
      if (search.includes('cloud_key=')) {
        found = new URLSearchParams(search).get('cloud_key') || '';
      } else if (hash.includes('cloud_key=')) {
        const qIdx = hash.indexOf('?');
        if (qIdx !== -1) {
          found = new URLSearchParams(hash.slice(qIdx + 1)).get('cloud_key') || '';
        } else {
          found = parseCandidateKey(hash);
        }
      }
      found = parseCandidateKey(found);
      if (found) {
        localStorage.setItem('ideal_cloud_gh_token', found);
        localStorage.setItem('vault_cloud_gh_token', found);
        if (window.history && window.history.replaceState) {
          const cleanUrl = window.location.pathname + (hash && !hash.includes('cloud_key=') ? hash : '');
          window.history.replaceState({}, document.title, cleanUrl);
        }
        return found;
      }
    } catch (e) {}
    return '';
  }

  function getCloudToken() {
    const fromUrl = extractKeyFromUrl();
    if (fromUrl) return fromUrl;
    try {
      return (
        localStorage.getItem('ideal_cloud_gh_token') ||
        localStorage.getItem('vault_cloud_gh_token') ||
        localStorage.getItem('vault_auth_token') ||
        ''
      ).trim();
    } catch (e) {
      return '';
    }
  }

  function isCloudHost() {
    try {
      return Boolean(window.location && window.location.hostname && window.location.hostname.endsWith('github.io'));
    } catch (e) {
      return false;
    }
  }

  extractKeyFromUrl();
  if (!isCloudHost()) return;

  const nativeFetch = window.fetch.bind(window);
  let lastVaultSha = null;
  let writeQueue = Promise.resolve();

  function ensureCloudTokenInteractive() {
    let tk = getCloudToken();
    if (tk) return tk;
    try {
      const entered = window.prompt('IDEAL Private Studio Vault — Paste your Pairing Link or Cloud Key to unlock your private data:');
      const parsed = parseCandidateKey(entered);
      if (parsed) {
        localStorage.setItem('ideal_cloud_gh_token', parsed);
        localStorage.setItem('vault_cloud_gh_token', parsed);
        return parsed;
      }
    } catch (e) {}
    return '';
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    const clean = String(b64 || '').replace(/\s+/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  async function ghFetch(repo, path, options = {}) {
    const tk = ensureCloudTokenInteractive();
    if (!tk) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing Cloud Key' }), { status: 401 });
    }
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const sep = cleanPath.includes('?') ? '&' : '?';
    const isGet = !options.method || options.method === 'GET';
    const url = 'https://api.github.com/repos/' + repo + '/contents/' + cleanPath + (isGet ? sep + '_t=' + Date.now() : '');
    const headers = Object.assign({
      'Authorization': 'Bearer ' + tk,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, options.headers || {});
    return nativeFetch(url, Object.assign({}, options, { headers, cache: 'no-store' }));
  }

  async function readGhJson(repo, filePath) {
    const res = await ghFetch(repo, filePath, { method: 'GET' });
    if (!res.ok) return { ok: false, status: res.status, data: null, sha: null };
    const meta = await res.json();
    const sha = meta && meta.sha ? meta.sha : null;
    if (meta && meta.content) {
      return { ok: true, status: 200, data: JSON.parse(base64ToUtf8(meta.content)), sha };
    }
    const rawRes = await ghFetch(repo, filePath, {
      method: 'GET',
      headers: { 'Accept': 'application/vnd.github.v3.raw' }
    });
    if (!rawRes.ok) return { ok: false, status: rawRes.status, data: null, sha };
    return { ok: true, status: 200, data: JSON.parse(await rawRes.text()), sha };
  }

  async function writeGhJson(filePath, obj, commitMsg) {
    const serialized = JSON.stringify(obj, null, 2);
    if (!lastVaultSha) {
      const cur = await ghFetch(CLOUD_REPO, filePath, { method: 'GET' });
      if (cur.ok) {
        const meta = await cur.json();
        if (meta && meta.sha) lastVaultSha = meta.sha;
      }
    }
    const payload = {
      message: commitMsg || 'sync(ideal-cloud): update ' + filePath,
      content: utf8ToBase64(serialized)
    };
    if (lastVaultSha) payload.sha = lastVaultSha;
    let putRes = await ghFetch(CLOUD_REPO, filePath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (putRes.status === 409) {
      const latest = await ghFetch(CLOUD_REPO, filePath, { method: 'GET' });
      if (latest.ok) {
        const meta = await latest.json();
        if (meta && meta.sha) {
          lastVaultSha = meta.sha;
          payload.sha = lastVaultSha;
          putRes = await ghFetch(CLOUD_REPO, filePath, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }
      }
    }
    if (putRes.ok) {
      const out = await putRes.json();
      if (out && out.content && out.content.sha) lastVaultSha = out.content.sha;
    }
    return putRes;
  }

  function jsonResp(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  window.fetch = async function(input, init = {}) {
    const urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    if (!urlStr.includes('/api/')) {
      return nativeFetch(input, init);
    }
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    let apiPath = urlStr.split('?')[0];
    try {
      if (urlStr.startsWith('http')) apiPath = new URL(urlStr).pathname;
    } catch (e) {}

    if (apiPath === '/api/vault') {
      if (method === 'GET') {
        const r = await readGhJson(CLOUD_REPO, 'ideal_vault.json');
        if (r.ok && r.data) {
          lastVaultSha = r.sha;
          return jsonResp({ ok: true, vault: r.data });
        }
        return jsonResp({ ok: false }, r.status || 404);
      }
      if (method === 'POST') {
        try {
          const bodyObj = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
          writeQueue = writeQueue.then(() => writeGhJson('ideal_vault.json', bodyObj, 'sync(ideal-web): save studio vault')).catch(() => {});
          await writeQueue;
          return jsonResp({ ok: true });
        } catch (e) {
          return jsonResp({ ok: false, error: String(e) }, 500);
        }
      }
    }

    if (apiPath === '/api/gdrive-assets') {
      const r = await readGhJson(CLOUD_REPO, 'gdrive_index.json');
      if (r.ok && r.data) return jsonResp(r.data);
      return jsonResp({ ok: true, batches: [], totalFiles: 0, totalBatches: 0 });
    }

    if (apiPath === '/api/finland-projects') {
      try {
        const r = await readGhJson(FINLAND_REPO, 'vault_data.json');
        if (r.ok && r.data && r.data.vaultspend_budget_data_v1) {
          const rawB = r.data.vaultspend_budget_data_v1;
          const budget = typeof rawB === 'string' ? JSON.parse(rawB) : rawB;
          const projects = (budget.projects || []).map(p => ({
            id: p.id || '',
            type: 'project',
            client: p.client || '',
            title: p.title || p.description || p.client || 'Untitled',
            description: p.description || '',
            status: p.status || '',
            dueDate: p.dueDate || '',
            amount: p.amount || p.fee || 0,
            currency: p.currency || 'EUR',
            notes: p.notes || '',
            finlandUrl: 'https://omgorigold-maker.github.io/finland-web/#project_followup/' + (p.id || '')
          }));
          const leads = (budget.leads || []).map(l => ({
            id: l.id || '',
            type: 'lead',
            client: l.client || '',
            title: l.projectTitle || l.name || l.client || 'Lead',
            description: l.notes || '',
            status: l.status || 'Lead',
            dueDate: l.nextFollowUp || '',
            amount: l.estimatedValue || 0,
            currency: l.currency || 'EUR',
            notes: l.notes || '',
            finlandUrl: 'https://omgorigold-maker.github.io/finland-web/#project_followup/lead:' + (l.id || '')
          }));
          return jsonResp({ ok: true, readOnly: true, projects, leads });
        }
      } catch (e) {}
      return jsonResp({ ok: true, readOnly: true, projects: [], leads: [] });
    }

    if (apiPath === '/api/upload' && method === 'POST') {
      try {
        const rawName = decodeURIComponent((init.headers && (init.headers['X-File-Name'] || init.headers['x-file-name'])) || 'upload.bin');
        const safeName = rawName.replace(/[^a-zA-Z0-9._\- ()]/g, '_');
        const storedName = Date.now() + '_' + safeName;
        const fileBlob = init.body;
        const ab = await fileBlob.arrayBuffer();
        const b64 = arrayBufferToBase64(ab);
        const putRes = await ghFetch(CLOUD_REPO, 'vault_media/' + encodeURIComponent(storedName), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'upload(ideal-web): ' + safeName,
            content: b64
          })
        });
        if (putRes.ok) {
          const blobUrl = URL.createObjectURL(new Blob([ab], { type: fileBlob.type || 'application/octet-stream' }));
          memBlobCache.set(storedName, blobUrl);
          return jsonResp({
            ok: true,
            fileName: rawName,
            storedName,
            fileUrl: '/vault_media/' + storedName,
            downloadUrl: '/vault_media/' + storedName,
            fileSize: ab.byteLength
          });
        }
      } catch (e) {}
      return jsonResp({ ok: false }, 500);
    }

    if (apiPath === '/api/trash' || apiPath === '/api/reveal') {
      return jsonResp({ ok: true });
    }

    return nativeFetch(input, init);
  };

  // Private Media Hydrator for vault_media/* and /api/asset-thumb on GitHub Pages
  const memBlobCache = new Map();
  const pendingFetches = new Map();
  const IDB_NAME = 'ideal_private_media_cache_v1';
  const IDB_STORE = 'blobs';

  function openMediaCacheDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function getCachedBlob(key) {
    const db = await openMediaCacheDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function setCachedBlob(key, blob) {
    const db = await openMediaCacheDB();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
    } catch (e) {}
  }

  function guessMime(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime',
      webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4'
    };
    return map[ext] || 'application/octet-stream';
  }

  async function resolvePrivateMediaBlobUrl(storedName) {
    const cleanName = decodeURIComponent(String(storedName || '').replace(/^\/?vault_media\//, '').split('?')[0]);
    if (!cleanName) return '';
    if (memBlobCache.has(cleanName)) return memBlobCache.get(cleanName);
    if (pendingFetches.has(cleanName)) return pendingFetches.get(cleanName);

    const p = (async () => {
      const cached = await getCachedBlob(cleanName);
      if (cached instanceof Blob && cached.size > 0) {
        const u = URL.createObjectURL(cached);
        memBlobCache.set(cleanName, u);
        return u;
      }
      const res = await ghFetch(CLOUD_REPO, 'vault_media/' + encodeURIComponent(cleanName), {
        method: 'GET',
        headers: { 'Accept': 'application/vnd.github.v3.raw' }
      });
      if (!res.ok) return '';
      const ab = await res.arrayBuffer();
      const blob = new Blob([ab], { type: guessMime(cleanName) });
      await setCachedBlob(cleanName, blob);
      const u = URL.createObjectURL(blob);
      memBlobCache.set(cleanName, u);
      return u;
    })().finally(() => {
      pendingFetches.delete(cleanName);
    });

    pendingFetches.set(cleanName, p);
    return p;
  }

  function buildSpecimenSvgDataUri(qsStr) {
    const params = new URLSearchParams(qsStr);
    const name = (params.get('name') || 'Studio Asset').slice(0, 34).replace(/[<>&"]/g, '');
    const ext = (params.get('ext') || 'PSD').toUpperCase().slice(0, 6).replace(/[<>&"]/g, '');
    const cat = (params.get('cat') || 'ASSET').toUpperCase().slice(0, 22).replace(/[<>&"]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="100%" height="100%">
      <rect width="400" height="260" fill="#171615"/>
      <text x="20" y="28" fill="#8C867B" font-family="monospace" font-size="10" letter-spacing="1.4">${cat}</text>
      <rect x="330" y="14" width="52" height="20" rx="3" fill="#C84B31" opacity="0.22"/>
      <text x="356" y="28" text-anchor="middle" fill="#C84B31" font-family="monospace" font-size="10.5" font-weight="600">${ext}</text>
      <rect x="136" y="64" width="128" height="92" rx="8" fill="none" stroke="#C84B31" stroke-width="1.6"/>
      <text x="200" y="114" text-anchor="middle" fill="#F4F1EA" font-family="monospace" font-size="18" font-weight="700">.${ext}</text>
      <text x="20" y="218" fill="#F4F1EA" font-family="-apple-system, BlinkMacSystemFont, Inter, sans-serif" font-size="13" font-weight="500">${name}</text>
      <text x="20" y="238" fill="#8C867B" font-family="monospace" font-size="9.5">GOOGLE DRIVE LINKED • CLICK TO OPEN</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function hydratePrivateMediaInRoot(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('img[src], video[src], audio[src], source[src]').forEach(el => {
      const rawSrc = el.getAttribute('src') || '';
      if (rawSrc.includes('vault_media/') && !rawSrc.startsWith('blob:')) {
        const stored = rawSrc.split('vault_media/').pop();
        resolvePrivateMediaBlobUrl(stored).then(blobUrl => {
          if (blobUrl) el.src = blobUrl;
        });
      } else if (rawSrc.includes('/api/asset-thumb?')) {
        const qs = rawSrc.split('?')[1] || '';
        el.src = buildSpecimenSvgDataUri(qs);
      }
    });
    root.querySelectorAll('a[href*="vault_media/"]').forEach(a => {
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref.startsWith('blob:')) {
        const stored = rawHref.split('vault_media/').pop();
        resolvePrivateMediaBlobUrl(stored).then(blobUrl => {
          if (blobUrl) a.href = blobUrl;
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    hydratePrivateMediaInRoot(document.body);
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => {
            if (n && n.nodeType === 1) {
              hydratePrivateMediaInRoot(n);
            }
          });
        } else if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
          const val = m.target.getAttribute(m.attributeName) || '';
          if ((val.includes('vault_media/') || val.includes('/api/asset-thumb?')) && !val.startsWith('blob:') && !val.startsWith('data:')) {
            hydratePrivateMediaInRoot(m.target.parentElement || document.body);
          }
        }
      }
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href']
    });
  });
})();

const FONT_OPTIONS_HEADING = [
  { label: 'Inter (Clean Gallery Sans)', value: "'Inter', -apple-system, sans-serif" },
  { label: 'Space Grotesk (Technical Studio)', value: "'Space Grotesk', sans-serif" },
  { label: 'Plus Jakarta Sans (Modern Geometric)', value: "'Plus Jakarta Sans', sans-serif" },
  { label: 'Syne (Art Direction / Bold)', value: "'Syne', sans-serif" },
  { label: 'Instrument Serif (Editorial Gallery)', value: "'Instrument Serif', Georgia, serif" },
  { label: 'Playfair Display (Classic Exhibition)', value: "'Playfair Display', Georgia, serif" },
  { label: 'Newsreader (Warm Book Serif)', value: "'Newsreader', Georgia, serif" },
  { label: 'System UI (Native macOS SF Pro)', value: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif" }
];

const FONT_OPTIONS_BODY = [
  { label: 'Inter (Clean Modern Sans)', value: "'Inter', -apple-system, sans-serif" },
  { label: 'Plus Jakarta Sans (Swiss Utility)', value: "'Plus Jakarta Sans', sans-serif" },
  { label: 'Space Grotesk (Technical Sans)', value: "'Space Grotesk', sans-serif" },
  { label: 'IBM Plex Mono (Studio Typewriter)', value: "'IBM Plex Mono', monospace" },
  { label: 'JetBrains Mono (Crisp Code Mono)', value: "'JetBrains Mono', monospace" },
  { label: 'Space Mono (Raw Print Mono)', value: "'Space Mono', monospace" },
  { label: 'Courier Prime (Classic Typewriter)', value: "'Courier Prime', monospace" },
  { label: 'Newsreader (Editorial Serif)', value: "'Newsreader', Georgia, serif" }
];

const FONT_OPTIONS_MONO = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'IBM Plex Mono', value: "'IBM Plex Mono', monospace" },
  { label: 'Space Mono', value: "'Space Mono', monospace" },
  { label: 'Courier Prime', value: "'Courier Prime', monospace" },
  { label: 'SF Mono (macOS Native)', value: "'SF Mono', ui-monospace, Menlo, monospace" }
];

const THEME_PRESETS = {
  warm_gallery: {
    name: 'Warm Gallery (Default)',
    mode: 'light',
    bg: '#F6F4EF',
    surface: '#FAF8F5',
    stage: '#E8E4DC',
    pill: '#FFFFFF',
    border: '#DDD8CE',
    strong: '#1C1B19',
    text: '#181715',
    textMid: '#656159',
    textFaint: '#948E84',
    accent: '#C84B31'
  },
  pure_museum: {
    name: 'Pure White Museum',
    mode: 'light',
    bg: '#FAFAFA',
    surface: '#FFFFFF',
    stage: '#EFEFEF',
    pill: '#FFFFFF',
    border: '#E2E2E2',
    strong: '#111111',
    text: '#111111',
    textMid: '#555555',
    textFaint: '#888888',
    accent: '#D9381E'
  },
  swiss_atelier: {
    name: 'Swiss Cool Stone',
    mode: 'light',
    bg: '#F2F3F5',
    surface: '#FFFFFF',
    stage: '#E5E7EB',
    pill: '#FFFFFF',
    border: '#D5D8DF',
    strong: '#111317',
    text: '#14161A',
    textMid: '#5A606B',
    textFaint: '#88909E',
    accent: '#2563EB'
  },
  soft_paper: {
    name: 'Warm Archive Paper',
    mode: 'light',
    bg: '#EFECE4',
    surface: '#F6F3EC',
    stage: '#E1DDD2',
    pill: '#FAF8F3',
    border: '#D2CCC0',
    strong: '#22201C',
    text: '#1E1C18',
    textMid: '#5E5950',
    textFaint: '#8C8579',
    accent: '#B84A2E'
  },
  dark_studio: {
    name: 'Dark Studio Cinema',
    mode: 'dark',
    bg: '#121211',
    surface: '#1A1A18',
    stage: '#22221F',
    pill: '#252522',
    border: '#2E2E2B',
    strong: '#F0EDE6',
    text: '#F3F1EC',
    textMid: '#A39E93',
    textFaint: '#6E6A61',
    accent: '#E06D53'
  },
  tokyo_graphite: {
    name: 'Tokyo Carbon Slate',
    mode: 'dark',
    bg: '#0E1014',
    surface: '#161920',
    stage: '#1E222B',
    pill: '#202530',
    border: '#2A303D',
    strong: '#F3F5F8',
    text: '#ECEFF4',
    textMid: '#949DAB',
    textFaint: '#636C7A',
    accent: '#38BDF8'
  },
  oled_midnight: {
    name: 'OLED Pitch Black',
    mode: 'dark',
    bg: '#080808',
    surface: '#111111',
    stage: '#181818',
    pill: '#1C1C1C',
    border: '#262626',
    strong: '#FFFFFF',
    text: '#F5F5F5',
    textMid: '#999999',
    textFaint: '#666666',
    accent: '#FF6B4A'
  }
};

function createSeedVault() {
  const now = Date.now();
  return {
    version: 5,
    brand: {
      title: 'IDEAL',
      badge: 'STUDIO VAULT',
      tagline: 'Visual Archive • Original Quality'
    },
    customization: {
      fontHeading: "'Inter', -apple-system, sans-serif",
      fontBody: "'IBM Plex Mono', monospace",
      fontMono: "'IBM Plex Mono', monospace",
      baseFontSize: 13.5,
      headingScale: 1,
      themePreset: 'warm_gallery',
      customColors: {
        bg: '#F6F4EF',
        surface: '#FAF8F5',
        stage: '#E8E4DC',
        text: '#181715',
        accent: '#C84B31'
      },
      cardRadius: 5,
      cardBorderWidth: 0,
      gridGap: 28,
      showIndexBadge: true,
      showStatusBadge: true,
      showCountBadge: true,
      showCardTags: true,
      sidebarPinned: true,
      sleekV6Migrated: true
    },
    spaces: [
      {
        id: 'projects',
        code: '01',
        title: 'Studio Projects',
        kicker: '01 / LIVING VISUAL ARCHIVE',
        heading: 'Studio Projects & Visual Collections',
        categories: ['All Disciplines', 'VJ & Club Visuals', '3D & Motion', 'Graphic Design', 'Mixed Media'],
        ui: {
          layoutMode: 'wall',
          cardSize: 330,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'gdrive_assets',
        code: '02',
        title: 'Drive & PSD Assets',
        kicker: '02 / GOOGLE DRIVE • 6-EXAMPLE VISUAL BATCHES (READ-ONLY LINK)',
        heading: 'Google Drive & Photoshop Assets — Visual Batches',
        categories: ['All Asset Batches', 'Mockups (PSD)', 'Textures & Riso', '3D & Graphic Stocks', '3D Sculpt Vault', 'Brushes, Fonts & Presets'],
        ui: {
          layoutMode: 'wall',
          cardSize: 360,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'quick_drop',
        code: '03',
        title: 'Quick Drop Table',
        kicker: '03 / UNSORTED STUDIO DESK',
        heading: 'Quick Drop Table — Unsorted Captures, Audio & Sparks',
        categories: ['All', 'To Sort', 'Voice & Audio', 'Visual Sparks', 'Tasks'],
        ui: {
          layoutMode: 'wall',
          cardSize: 320,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'instagram',
        code: '04',
        title: 'Instagram & Highlights',
        kicker: '04 / SOCIAL PIPELINE & ARCHIVE',
        heading: 'Instagram Posts, Reels & Story Highlights',
        categories: ['All', 'Feed Posts', 'Reels & Motion', 'Story Highlights', 'Captions & Tasks'],
        ui: {
          layoutMode: 'wall',
          cardSize: 310,
          aspectRatio: '4 / 5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'website',
        code: '05',
        title: 'For My Website',
        kicker: '05 / PORTFOLIO & WEB UPDATES',
        heading: 'For My Website — Portfolio Cases, Layout & Upload Queue',
        categories: ['All', 'Portfolio Cases', 'Homepage & Bio', 'Layout & Bugs', 'Assets to Upload'],
        ui: {
          layoutMode: 'wall',
          cardSize: 330,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'residencies',
        code: '06',
        title: 'Residencies & Awards',
        kicker: '06 / OPEN CALLS & GRANTS RADAR',
        heading: 'Residencies, Open Calls & Reusable Statements',
        categories: ['All', 'Open Calls', 'Reusable Bios & Texts', 'Portfolio Stills', 'Submitted'],
        ui: {
          layoutMode: 'wall',
          cardSize: 330,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'finland',
        code: '07',
        title: 'Finland Link',
        kicker: '07 / 100% READ-ONLY BRIDGE',
        heading: 'Finland Link — Active Client & Financial Twin Projects',
        categories: ['All'],
        ui: {
          layoutMode: 'wall',
          cardSize: 330,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      },
      {
        id: 'customize',
        code: '08',
        title: 'Customize & Design',
        kicker: '08 / STUDIO INTERFACE & TYPOGRAPHY',
        heading: 'Customize Ideal — Fonts, Palette, Cards & Per-Section UI',
        categories: [],
        ui: {
          layoutMode: 'wall',
          cardSize: 340,
          aspectRatio: '16 / 10.5',
          imageFit: 'cover',
          sortOrder: 'manual'
        }
      }
    ],
    projects: [
      {
        id: 'proj_test_sculpt',
        title: 'TEST 1 — Sculpting WIP (Keep Going)',
        status: '🔥 Keep Sculpting',
        category: '3D & Motion',
        subtitle: 'Mid-sculpt organic chrome figure in ZBrush/Blender. Documenting stages so I remember to finish the collarbone & shaders next week.',
        sections: ['All', 'Sculpt Stages', 'Turntable Loops', 'To-Do & Reminders'],
        tags: ['3D & Motion', 'Sculpting WIP', 'Blender / ZBrush'],
        finlandLinked: false,
        ui: { layoutMode: 'wall', cardSize: 310, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 6,
        updatedAt: now - 3600000 * 2
      },
      {
        id: 'proj_test_ig',
        title: 'TEST 2 — Instagram Post & Highlights',
        status: '✨ Ready to Post',
        category: '3D & Motion',
        subtitle: 'Carousel + vertical 9:16 reel cut + new custom Story Highlight covers ("3D WIP", "VJ LIVE", "PRINT").',
        sections: ['All', 'Carousel Slides', 'Vertical Reel', 'Highlight Covers', 'Caption & Tags'],
        tags: ['3D & Motion', 'Instagram', 'Highlights'],
        finlandLinked: false,
        ui: { layoutMode: 'wall', cardSize: 300, aspectRatio: '4 / 5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 5,
        updatedAt: now - 3600000 * 4
      },
      {
        id: 'proj_test_web',
        title: 'TEST 3 — Website Updates & Notes',
        status: '🛠 To Upload',
        category: 'Graphic Design',
        subtitle: 'Things to change on my website: new hero reel, mobile 2-column grid layout fix, and updated 2026 artist bio.',
        sections: ['All', 'Layout Mockups', 'Checklist', 'Copy & Bio'],
        tags: ['Graphic Design', 'Website', 'Portfolio'],
        finlandLinked: false,
        ui: { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 4,
        updatedAt: now - 3600000 * 5
      },
      {
        id: 'proj_foggy_vj',
        title: 'Foggy — Party Work (VJ Visuals)',
        status: '🔥 In Progress',
        category: 'VJ & Club Visuals',
        subtitle: 'Live VJ loops, 3D club textures, and high-contrast screen animations for Foggy.',
        sections: ['All', 'VJ Loops', 'Stage Renders', 'Setlist Notes'],
        tags: ['VJ & Club Visuals', '🔗 Finland Linked'],
        finlandLinked: true,
        ui: { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 3,
        updatedAt: now - 3600000 * 6
      },
      {
        id: 'proj_noods_fly',
        title: 'Noods Radio — The Fly',
        status: '✨ Finished / Ready',
        category: '3D & Motion',
        subtitle: 'Design & animation package for Noods Radio — The Fly. Great candidate for Website + IG Reel.',
        sections: ['All', 'Final Stills', 'Motion Cuts', 'Export Checklist'],
        tags: ['3D & Motion', '🔗 Finland Linked'],
        finlandLinked: true,
        ui: { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 2,
        updatedAt: now - 3600000 * 8
      },
      {
        id: 'proj_fugwub',
        title: 'Foggy x Wub — SHUT THE FUGWUB',
        status: '✨ Finished / Ready',
        category: 'Graphic Design',
        subtitle: 'Daytime Halloween open-air party at Tempelhof via THF Radio. Vibe: Spooky ~ silly ~ punky print style, red & halftone.',
        sections: ['All', 'Print & Poster', 'Lineup Notes'],
        tags: ['Graphic Design', '🔗 Finland Linked'],
        finlandLinked: true,
        ui: { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 1.5,
        updatedAt: now - 3600000 * 10
      },
      {
        id: 'proj_test_refs',
        title: 'TEST 4 — Visual References & Moodboard',
        status: '💡 Idea / Spark',
        category: 'Mixed Media',
        subtitle: 'Refractive glass dispersion studies, brutalist kinetic typography, and synth sound textures.',
        sections: ['All', 'Shader Refs', 'Typography', 'Audio Loops'],
        tags: ['Mixed Media', 'Moodboard', 'Shaders'],
        finlandLinked: false,
        ui: { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 1,
        updatedAt: now - 3600000 * 12
      },
      {
        id: 'proj_test_residency',
        title: 'TEST 5 — Open Call / Residency Package',
        status: '📅 Deadline Soon',
        category: 'Mixed Media',
        subtitle: 'Submission package for Villa Massimo / BBK Studio Grant: high-res exhibition views, 250-word statement, and budget checklist.',
        sections: ['All', 'Exhibition Stills', 'Statement & Bio', 'Checklist'],
        tags: ['Mixed Media', 'Residency', 'Open Call'],
        finlandLinked: false,
        ui: { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
        createdAt: now - 86400000 * 0.5,
        updatedAt: now - 3600000 * 14
      }
    ],
    items: [
      /* --- PROJECT 1: TEST 1 — Sculpting WIP --- */
      {
        id: 'itm_sculpt_1',
        parentType: 'project',
        parentId: 'proj_test_sculpt',
        section: 'Sculpt Stages',
        kind: 'image',
        title: 'Sculpt Stage 04 — Chrome Clay Form',
        status: '🔥 Stage 04',
        url: 'vault_media/test_sculpt_stage1.png',
        notes: 'Primary silhouette locked. Need to refine the left clavicle transition and add subtle surface pores before baking displacement.',
        tags: ['ZBrush', 'Clay Pass', 'WIP'],
        link: '~/Desktop/3d projects 2026',
        createdAt: now - 500000
      },
      {
        id: 'itm_sculpt_2',
        parentType: 'project',
        parentId: 'proj_test_sculpt',
        section: 'Turntable Loops',
        kind: 'image',
        title: '360° Wireframe Turntable Loop (GIF)',
        status: '🎞 Loop',
        url: 'vault_media/test_turntable_loop.gif',
        notes: 'Animated turntable check to inspect silhouette from all angles.',
        tags: ['Turntable', 'GIF Loop', 'Wireframe'],
        link: '',
        createdAt: now - 490000
      },
      {
        id: 'itm_sculpt_3',
        parentType: 'project',
        parentId: 'proj_test_sculpt',
        section: 'Sculpt Stages',
        kind: 'image',
        title: 'Topology & SubD Wireframe Check',
        status: '📐 Topology',
        url: 'vault_media/test_sculpt_wire.png',
        notes: 'Clean quad flow around shoulder deform area. Ready for UV unwrap once sculpt is finalized.',
        tags: ['Topology', 'Wireframe'],
        link: '',
        createdAt: now - 480000
      },
      {
        id: 'itm_sculpt_4',
        parentType: 'project',
        parentId: 'proj_test_sculpt',
        section: 'To-Do & Reminders',
        kind: 'checklist',
        title: 'Sculpting Next Steps (Don\'t Forget!)',
        status: '📋 2/5 Done',
        url: '',
        notes: '[x] Block out main head & torso proportions\n[x] Test chrome anisotropic shader in Octane\n[ ] Sculpt asymmetrical ear / cybernetic detail\n[ ] Retopo low-poly cage & bake 32-bit EXR displacement\n[ ] Render 4:5 turntable for Instagram WIP post',
        tags: ['Checklist', 'Keep Going'],
        link: '~/Desktop/3d projects 2026',
        createdAt: now - 470000
      },

      /* --- PROJECT 2: TEST 2 — Instagram Post & Highlights --- */
      {
        id: 'itm_ig_proj_1',
        parentType: 'project',
        parentId: 'proj_test_ig',
        section: 'Carousel Slides',
        kind: 'image',
        title: 'Slide 01 — Hero 4:5 Render Crop',
        status: '📸 Slide 1',
        url: 'vault_media/test_ig_slide1.png',
        notes: 'Cover slide for carousel. High-contrast warm rim light pops on the feed grid.',
        tags: ['4:5 Carousel', 'Cover Slide'],
        link: '',
        createdAt: now - 460000
      },
      {
        id: 'itm_ig_proj_2',
        parentType: 'project',
        parentId: 'proj_test_ig',
        section: 'Vertical Reel',
        kind: 'image',
        title: '9:16 Vertical Reel Cut (Loop Preview)',
        status: '🎬 9:16 Reel',
        url: 'vault_media/test_reel_vertical.gif',
        notes: '60fps vertical motion loop synced to ambient synth pad.',
        tags: ['Reel', '9:16', 'Motion'],
        link: '~/Desktop/socials',
        createdAt: now - 450000
      },
      {
        id: 'itm_ig_proj_3',
        parentType: 'project',
        parentId: 'proj_test_ig',
        section: 'Highlight Covers',
        kind: 'image',
        title: 'Instagram Highlight Icons Set (WIP / VJ / 3D / PRINT)',
        status: '⭕ Highlights',
        url: 'vault_media/test_ig_highlights.png',
        notes: 'Minimal metallic orb icons for profile Story Highlights so the top of the profile looks clean and cohesive.',
        tags: ['Highlights', 'Profile UI'],
        link: '',
        createdAt: now - 440000
      },
      {
        id: 'itm_ig_proj_4',
        parentType: 'project',
        parentId: 'proj_test_ig',
        section: 'Caption & Tags',
        kind: 'checklist',
        title: 'Post Caption Draft & Upload Checklist',
        status: '✍️ Caption',
        url: '',
        notes: '[x] Export uncompressed PNG slides (1080x1350)\n[x] Render 9:16 Reel with audio stem\n[ ] Update "3D WIP" Highlight cover on profile\n[ ] Pin post to top-left of profile grid\n\nCaption Draft:\n"Studio archive 04 // liquid chrome & wireframe studies. Sculpted in ZBrush + rendered in Blender Cycles."',
        tags: ['Caption', 'Checklist'],
        link: 'https://instagram.com',
        createdAt: now - 430000
      },

      /* --- PROJECT 3: TEST 3 — Website Updates & Notes --- */
      {
        id: 'itm_web_proj_1',
        parentType: 'project',
        parentId: 'proj_test_web',
        section: 'Layout Mockups',
        kind: 'image',
        title: 'Desktop Index Layout — 2-Column Visual Grid',
        status: '🖥 Desktop UI',
        url: 'vault_media/test_web_layout.png',
        notes: 'Replace current landing page with cleaner 2-column project stage + typewriter index numbers.',
        tags: ['Website', 'Desktop Grid'],
        link: '~/Desktop/molly upload to site',
        createdAt: now - 420000
      },
      {
        id: 'itm_web_proj_2',
        parentType: 'project',
        parentId: 'proj_test_web',
        section: 'Layout Mockups',
        kind: 'image',
        title: 'Mobile Portfolio Responsive Breakpoints',
        status: '📱 Mobile UI',
        url: 'vault_media/test_web_mobile.png',
        notes: 'Make sure videos autoplay inline (`playsinline muted loop`) on iOS Safari without fullscreen takeover.',
        tags: ['Mobile', 'Responsive'],
        link: '~/Desktop/website files',
        createdAt: now - 410000
      },
      {
        id: 'itm_web_proj_3',
        parentType: 'project',
        parentId: 'proj_test_web',
        section: 'Checklist',
        kind: 'checklist',
        title: 'Website Launch & Upload To-Do List',
        status: '🛠 3/6 Done',
        url: '',
        notes: '[x] Collect high-res stills from Noods Radio — The Fly\n[x] Compress hero loop to WebM + MP4 fallback\n[x] Draft updated 2026 short bio\n[ ] Upload SHUT THE FUGWUB poster scans\n[ ] Add Residency / Exhibitions section to About page\n[ ] Fix broken Vimeo embed on mobile',
        tags: ['Website Checklist', 'Priority'],
        link: '~/Desktop/website files',
        createdAt: now - 400000
      },

      /* --- PROJECT 4: Foggy — Party Work (VJ Visuals) --- */
      {
        id: 'itm_foggy_1',
        parentType: 'project',
        parentId: 'proj_foggy_vj',
        section: 'VJ Loops',
        kind: 'image',
        title: 'Foggy Club Screen — High-Contrast VJ Loop 01',
        status: '🎛 VJ Loop',
        url: 'vault_media/test_turntable_loop.gif',
        notes: 'Tested at 135 BPM in Resolume Arena. Zero black-frame drops; alpha channel ready for live mixing.',
        tags: ['Resolume', 'DXV3 / HAP', 'Club Visuals'],
        link: '~/Desktop/VJ',
        createdAt: now - 390000
      },
      {
        id: 'itm_foggy_2',
        parentType: 'project',
        parentId: 'proj_foggy_vj',
        section: 'Stage Renders',
        kind: 'image',
        title: 'Chrome Strobing Shader Study for Foggy',
        status: '✨ Shader',
        url: 'vault_media/test_ref_glass.png',
        notes: 'Dispersion shader pass for peak-time set transition.',
        tags: ['Shader', 'Foggy'],
        link: '~/Desktop/foggy general',
        createdAt: now - 385000
      },
      {
        id: 'itm_foggy_3',
        parentType: 'project',
        parentId: 'proj_foggy_vj',
        section: 'Setlist Notes',
        kind: 'checklist',
        title: 'Foggy VJ Pack Deliverables Checklist',
        status: '📋 Active',
        url: '',
        notes: '[x] 6x 16:9 Main Stage Tunnel & Chrome Loops\n[x] 3x Logo Bumpers (Foggy typographic strobe)\n[ ] Export 1080p ProRes 4444 backup onto USB-C drive\n[ ] Sync final invoice in Finland app',
        tags: ['Deliverables', 'Finland Linked'],
        link: '~/Desktop/foggy general',
        createdAt: now - 380000
      },

      /* --- PROJECT 5: Noods Radio — The Fly --- */
      {
        id: 'itm_noods_1',
        parentType: 'project',
        parentId: 'proj_noods_fly',
        section: 'Final Stills',
        kind: 'image',
        title: 'Noods Radio — The Fly (Hero Artwork Still)',
        status: '✨ Master Still',
        url: 'vault_media/test_ig_slide1.png',
        notes: 'Final approved key visual for Noods Radio broadcast & social announcement.',
        tags: ['Noods Radio', 'Key Visual', '3D'],
        link: '~/Desktop/The Fly',
        createdAt: now - 370000
      },
      {
        id: 'itm_noods_2',
        parentType: 'project',
        parentId: 'proj_noods_fly',
        section: 'Motion Cuts',
        kind: 'image',
        title: 'The Fly — 9:16 Teaser Animation Loop',
        status: '🎬 Teaser Cut',
        url: 'vault_media/test_reel_vertical.gif',
        notes: 'Exported 4:5 & 9:16 cuts for IG + Website portfolio case study.',
        tags: ['Animation', '9:16 Cut', 'Website Ready'],
        link: '~/Desktop/The Fly',
        createdAt: now - 365000
      },

      /* --- PROJECT 6: Foggy x Wub — SHUT THE FUGWUB --- */
      {
        id: 'itm_fugwub_1',
        parentType: 'project',
        parentId: 'proj_fugwub',
        section: 'Print & Poster',
        kind: 'image',
        title: 'SHUT THE FUGWUB — Halftone Print & Type Layout',
        status: '🖨 Print Master',
        url: 'vault_media/test_ref_type.png',
        notes: 'Daytime Halloween open-air party at Tempelhof via THF Radio. Spooky ~ silly ~ punky print style, riso red & halftone grain.',
        tags: ['Riso Print', 'Poster', 'THF Radio'],
        link: '~/Desktop/fubwog',
        createdAt: now - 360000
      },
      {
        id: 'itm_fugwub_2',
        parentType: 'project',
        parentId: 'proj_fugwub',
        section: 'Lineup Notes',
        kind: 'note',
        title: 'SHUT THE FUGWUB — Original Brief & Lineup Credits',
        status: '📝 Archive Note',
        url: '',
        notes: 'Event: Foggy x Wub @ Tempelhof (THF Radio)\nAssets delivered: A2 Poster, Square IG Flyer, Story Timetable.\nLocal folder: ~/Desktop/fubwog & ~/Desktop/riso_8fps_80f',
        tags: ['Brief', 'Credits'],
        link: '~/Desktop/riso_8fps_80f',
        createdAt: now - 355000
      },

      /* --- PROJECT 7: TEST 4 — Visual References & Moodboard --- */
      {
        id: 'itm_ref_1',
        parentType: 'project',
        parentId: 'proj_test_refs',
        section: 'Shader Refs',
        kind: 'image',
        title: 'Optical Glass Caustics & Chromatic Dispersion',
        status: '💎 Shader Ref',
        url: 'vault_media/test_ref_glass.png',
        notes: 'Reference for index-of-refraction (IOR 1.52 -> 1.68) spectral splitting in Octane / Cycles.',
        tags: ['Caustics', 'Glass', 'Octane'],
        link: '',
        createdAt: now - 350000
      },
      {
        id: 'itm_ref_2',
        parentType: 'project',
        parentId: 'proj_test_refs',
        section: 'Typography',
        kind: 'image',
        title: 'Swiss Brutalist Halftone & Stretched Condensed Type',
        status: '🔤 Type Ref',
        url: 'vault_media/test_ref_type.png',
        notes: 'High-contrast editorial grid with mono metadata stamps.',
        tags: ['Typography', 'Editorial'],
        link: '',
        createdAt: now - 345000
      },
      {
        id: 'itm_ref_3',
        parentType: 'project',
        parentId: 'proj_test_refs',
        section: 'Audio Loops',
        kind: 'audio',
        title: 'Warm Analog Synth Pad — A Major 7 Loop (WAV)',
        status: '🔊 Audio Stem',
        url: 'vault_media/test_ambient_loop.wav',
        notes: 'Uncompressed .wav ambient bed for 3D turntable reels and website background sound design.',
        tags: ['Audio', 'WAV', 'Ambient'],
        link: '',
        createdAt: now - 340000
      },

      /* --- PROJECT 8: TEST 5 — Open Call / Residency Package --- */
      {
        id: 'itm_res_proj_1',
        parentType: 'project',
        parentId: 'proj_test_residency',
        section: 'Exhibition Stills',
        kind: 'image',
        title: 'Installation View — Monolith Projection Study',
        status: '🏛 Exhibition',
        url: 'vault_media/test_residency_still.png',
        notes: '300 DPI TIFF/PNG exhibition simulation for residency jury PDF.',
        tags: ['Installation', 'Jury PDF'],
        link: '~/Desktop/PDF Documents',
        createdAt: now - 335000
      },
      {
        id: 'itm_res_proj_2',
        parentType: 'project',
        parentId: 'proj_test_residency',
        section: 'Checklist',
        kind: 'checklist',
        title: 'Villa Massimo / BBK Grant Application Checklist',
        status: '📅 Due Nov 15',
        url: '',
        notes: '[x] Select 10 work samples (stills + 2 video links)\n[x] Update CV with 2025/2026 exhibitions & radio visuals\n[ ] Finalize 1,500-character project proposal\n[ ] Export single merged PDF under 15 MB',
        tags: ['Grant', 'Checklist'],
        link: '~/Desktop/PDF Documents',
        createdAt: now - 330000
      },

      /* =====================================================================
         SIDEBAR SECTION 02: QUICK DROP TABLE (Every Item Type Represented!)
         ===================================================================== */
      {
        id: 'itm_qd_1',
        parentType: 'space',
        parentId: 'quick_drop',
        section: 'Visual Sparks',
        kind: 'image',
        title: 'Late-Night Sketch — Metallic Ribbons & Type Overlay',
        status: '⚡ Quick Drop',
        url: 'vault_media/test_unsorted_sketch.png',
        notes: 'Dropped quickly from Desktop screenshots. Might turn this into a poster series or 3D spline extrusion.',
        tags: ['Sketch', 'To Sort'],
        link: '~/Desktop/Screenshots',
        createdAt: now - 300000
      },
      {
        id: 'itm_qd_2',
        parentType: 'space',
        parentId: 'quick_drop',
        section: 'Visual Sparks',
        kind: 'image',
        title: 'Unsorted Wireframe Turntable Test (GIF Loop)',
        status: '🎞 Motion Test',
        url: 'vault_media/test_turntable_loop.gif',
        notes: 'Quick viewport capture before shutting down Blender last night.',
        tags: ['GIF', 'Viewport'],
        link: '~/Desktop/3d projects 2026',
        createdAt: now - 290000
      },
      {
        id: 'itm_qd_3',
        parentType: 'space',
        parentId: 'quick_drop',
        section: 'Voice & Audio',
        kind: 'audio',
        title: 'Studio Synth Idea — Warm Pad Loop (Original WAV)',
        status: '🔊 Audio Note',
        url: 'vault_media/test_ambient_loop.wav',
        notes: 'Click play right on the card! Useful for testing sound with vertical reels.',
        tags: ['WAV', 'Sound Design'],
        link: '',
        createdAt: now - 280000
      },
      {
        id: 'itm_qd_4',
        parentType: 'space',
        parentId: 'quick_drop',
        section: 'Tasks',
        kind: 'checklist',
        title: 'This Week\'s Quick Studio Tasks (Interactive Checkboxes)',
        status: '📋 Studio Tasks',
        url: '',
        notes: '[x] Organize Desktop 3D renders into Ideal boards\n[ ] Back up ZBrush custom brushes to iCloud\n[ ] Send Noods Radio high-res stills to press contact\n[ ] Test new halftone shader on SHUT THE FUGWUB assets',
        tags: ['Weekly Tasks', 'Checklist'],
        link: '',
        createdAt: now - 270000
      },
      {
        id: 'itm_qd_5',
        parentType: 'space',
        parentId: 'quick_drop',
        section: 'To Sort',
        kind: 'note',
        title: 'Idea Spark — Interactive Sculpture Series "Soft Armor"',
        status: '💡 Typewriter Note',
        url: '',
        notes: 'Combine soft-body cloth inflation with rigid chrome cages.\nRender on warm stone background (#E8E4DC) so it feels like a physical gallery object rather than sci-fi CGI.',
        tags: ['Concept', 'Sculpting'],
        link: '',
        createdAt: now - 260000
      },
      {
        id: 'itm_qd_6',
        parentType: 'space',
        parentId: 'quick_drop',
        section: 'To Sort',
        kind: 'link',
        title: 'Desktop Folder Shortcut — ~/Desktop/3d projects 2026',
        status: '📁 Local Mac Path',
        url: '',
        notes: 'Direct link to local working directory on Mac for heavy .blend / .c4d / .zpr project files.',
        tags: ['Mac Path', 'Folder'],
        link: '~/Desktop/3d projects 2026',
        createdAt: now - 250000
      },

      /* =====================================================================
         SIDEBAR SECTION 03: INSTAGRAM & HIGHLIGHTS (Full Visual Pipeline!)
         ===================================================================== */
      {
        id: 'itm_ig_space_1',
        parentType: 'space',
        parentId: 'instagram',
        section: 'Story Highlights',
        kind: 'image',
        title: 'Story Highlight Covers — "3D WIP", "VJ LIVE", "PRINT", "PRESS"',
        status: '⭕ Highlights',
        url: 'vault_media/test_ig_highlights.png',
        notes: 'Custom cohesive highlight covers ready to upload to Instagram profile.',
        tags: ['Highlights', 'Covers'],
        link: '~/Desktop/socials',
        createdAt: now - 240000
      },
      {
        id: 'itm_ig_space_2',
        parentType: 'space',
        parentId: 'instagram',
        section: 'Story Highlights',
        kind: 'image',
        title: 'Story Highlight Slide — Behind-the-Scenes Sculpting WIP',
        status: '📱 9:16 Story',
        url: 'vault_media/test_ig_story_wip.png',
        notes: 'Add this vertical progress card to the "3D WIP" Story Highlight so visitors immediately see studio process.',
        tags: ['Story', '3D WIP Highlight'],
        link: '',
        createdAt: now - 230000
      },
      {
        id: 'itm_ig_space_3',
        parentType: 'space',
        parentId: 'instagram',
        section: 'Reels & Motion',
        kind: 'image',
        title: 'Reel Draft 01 — Vertical 9:16 Motion Cut (GIF Loop)',
        status: '🎬 Ready Reel',
        url: 'vault_media/test_reel_vertical.gif',
        notes: 'Vertical loop for Reels. Pair with Warm Analog Synth Pad WAV.',
        tags: ['Reels', '9:16', 'Animation'],
        link: '~/Desktop/socials',
        createdAt: now - 220000
      },
      {
        id: 'itm_ig_space_4',
        parentType: 'space',
        parentId: 'instagram',
        section: 'Feed Posts',
        kind: 'image',
        title: 'Feed Grid 9-Tile Color Harmony Planner',
        status: '📅 Grid Plan',
        url: 'vault_media/test_ig_grid_plan.png',
        notes: 'Checking how the next 3 posts (Chrome Sculpt, Noods Radio, Fugwub Red Poster) balance warm stone and dark contrast on the profile grid.',
        tags: ['Grid Planner', 'Art Direction'],
        link: '',
        createdAt: now - 210000
      },
      {
        id: 'itm_ig_space_5',
        parentType: 'space',
        parentId: 'instagram',
        section: 'Feed Posts',
        kind: 'image',
        title: 'Carousel Post — Noods Radio "The Fly" Still 01',
        status: '✨ Ready to Post',
        url: 'vault_media/test_ig_slide1.png',
        notes: 'Uncompressed original PNG ready for AirDrop to phone.',
        tags: ['Carousel', 'Noods Radio'],
        link: '~/Desktop/The Fly',
        createdAt: now - 205000
      },
      {
        id: 'itm_ig_space_6',
        parentType: 'space',
        parentId: 'instagram',
        section: 'Captions & Tasks',
        kind: 'checklist',
        title: 'Instagram Content & Highlights Checklist',
        status: '📋 IG Pipeline',
        url: '',
        notes: '[x] Design 4 new Story Highlight covers\n[x] Export Noods Radio 4:5 carousel stills\n[ ] Archive old 2023 Story Highlights that feel cluttered\n[ ] Create a dedicated "WEBSITE / SHOP" Highlight with direct link sticker\n[ ] Post Sculpting WIP turntable Reel on Thursday 18:00',
        tags: ['Checklist', 'Highlights', 'Schedule'],
        link: 'https://instagram.com',
        createdAt: now - 200000
      },

      /* =====================================================================
         SIDEBAR SECTION 04: FOR MY WEBSITE (Full Visual Web Queue!)
         ===================================================================== */
      {
        id: 'itm_web_space_1',
        parentType: 'space',
        parentId: 'website',
        section: 'Layout & Bugs',
        kind: 'image',
        title: 'New Homepage Grid — Warm Editorial Index Layout',
        status: '🖥 Layout Mockup',
        url: 'vault_media/test_web_layout.png',
        notes: 'Clean two-column project showcase with large media stage and monospace index numbers.',
        tags: ['Homepage', 'UI Mockup'],
        link: '~/Desktop/website files',
        createdAt: now - 190000
      },
      {
        id: 'itm_web_space_2',
        parentType: 'space',
        parentId: 'website',
        section: 'Layout & Bugs',
        kind: 'image',
        title: 'Mobile Case Study View — Vertical Stack & Sticky Nav',
        status: '📱 Mobile View',
        url: 'vault_media/test_web_mobile.png',
        notes: 'Ensure 4:5 and 9:16 videos scale cleanly on mobile screens without cropping captions.',
        tags: ['Mobile', 'UX'],
        link: '',
        createdAt: now - 180000
      },
      {
        id: 'itm_web_space_3',
        parentType: 'space',
        parentId: 'website',
        section: 'Portfolio Cases',
        kind: 'image',
        title: 'Upload to Site — Noods Radio "The Fly" Case Study Hero',
        status: '🚀 Ready for Site',
        url: 'vault_media/test_ig_slide1.png',
        notes: 'Include 1 hero video loop + 4 process stills + short credit block.',
        tags: ['Case Study', 'Noods Radio'],
        link: '~/Desktop/molly upload to site',
        createdAt: now - 170000
      },
      {
        id: 'itm_web_space_4',
        parentType: 'space',
        parentId: 'website',
        section: 'Assets to Upload',
        kind: 'checklist',
        title: 'Website Master Update Checklist',
        status: '🛠 2/5 Done',
        url: '',
        notes: '[x] Export WebP + MP4 loops from ~/Desktop/molly upload to site\n[x] Write 2-sentence project descriptions for 2025/2026 works\n[ ] Replace homepage showreel with new 2026 cut\n[ ] Add "Selected Exhibitions & Club Visuals" list to Info page\n[ ] Test custom domain SSL & mobile load speed',
        tags: ['Website', 'Checklist'],
        link: '~/Desktop/molly upload to site',
        createdAt: now - 160000
      },
      {
        id: 'itm_web_space_5',
        parentType: 'space',
        parentId: 'website',
        section: 'Homepage & Bio',
        kind: 'note',
        title: 'Website Info Page — 2026 Short Artist & Design Bio',
        status: '✍️ Bio Copy',
        url: '',
        notes: 'Multidisciplinary visual artist, 3D sculptor, and graphic designer working across digital sculpture, club visuals (VJ), experimental print, and motion direction.\n\nAvailable for commissions, art direction, and live audiovisual performances.',
        tags: ['Bio', 'Copywriting'],
        link: '',
        createdAt: now - 150000
      },

      /* =====================================================================
         SIDEBAR SECTION 05: RESIDENCIES & AWARDS (Open Calls & Statements!)
         ===================================================================== */
      {
        id: 'itm_res_space_1',
        parentType: 'space',
        parentId: 'residencies',
        section: 'Open Calls',
        kind: 'image',
        title: 'Open Call — BBK Studio Grant & Sound/Vision Residency 2026',
        status: '📅 Deadline Nov 30',
        url: 'vault_media/test_residency_card.png',
        notes: 'Stipend: €2,000/mo + studio space. Requires: 10-page portfolio PDF, artist statement, and 1-page technical rider.',
        tags: ['Open Call', 'Grant', 'Berlin'],
        link: '~/Desktop/PDF Documents',
        createdAt: now - 140000
      },
      {
        id: 'itm_res_space_2',
        parentType: 'space',
        parentId: 'residencies',
        section: 'Portfolio Stills',
        kind: 'image',
        title: 'Exhibition Documentation Still — Audiovisual Monolith',
        status: '🏛 Jury Still',
        url: 'vault_media/test_residency_still.png',
        notes: 'High-resolution uncompressed installation view for grant applications.',
        tags: ['Portfolio Still', 'Installation'],
        link: '',
        createdAt: now - 130000
      },
      {
        id: 'itm_res_space_3',
        parentType: 'space',
        parentId: 'residencies',
        section: 'Reusable Bios & Texts',
        kind: 'note',
        title: 'Reusable Artist Statement (150 Words — Copy & Paste)',
        status: '📄 Statement',
        url: '',
        notes: 'My practice investigates the tactile tension between hyper-glossy digital 3D sculpture and raw, physical print and club architectures. Combining ZBrush/Blender sculptural forms with kinetic typography and live VJ projection, I build immersive visual systems that move fluidly between club screens, autonomous gallery installations, and tactile publications.',
        tags: ['Artist Statement', 'Reusable Text'],
        link: '',
        createdAt: now - 120000
      },
      {
        id: 'itm_res_space_4',
        parentType: 'space',
        parentId: 'residencies',
        section: 'Open Calls',
        kind: 'checklist',
        title: '2026 Residencies & Grants Application Tracker',
        status: '📋 Radar',
        url: '',
        notes: '[x] Update master portfolio PDF with 2026 3D & VJ works\n[x] Prepare 100-word and 250-word artist statements\n[ ] Submit BBK Studio Grant application\n[ ] Prepare video links (password-free Vimeo/private links) for jury',
        tags: ['Tracker', 'Checklist'],
        link: '~/Desktop/PDF Documents',
        createdAt: now - 110000
      }
    ]
  };
}

/* ==========================================================================
   RUNTIME STATE & PERSISTENCE
   ========================================================================== */
let vault = loadVault();
let state = {
  viewType: 'space',       // 'space' | 'project'
  activeSpaceId: 'projects',
  activeProjectId: null,
  activeCategory: 'All Disciplines',
  searchQuery: '',
  sidebarOpen: true,
  sectionDrawerOpen: false,
  editingItemId: null,
  editingProjectId: null,
  pendingDelete: null,
  finlandProjects: [],
  gdriveBatches: [],
  gdriveStats: { totalBatches: 75, totalFiles: 2421, driveRoot: '', loading: false, loaded: false },
  gdriveOffsets: {},
  sphereActiveIndex: 0,
  sphereViewStyle: 'constellation', // 'constellation' (Hero + Satellites) | 'grid' (All Spheres Side-by-Side)
  sphereZoom: 1,
  spherePanX: 0,
  spherePanY: 0,
  sphereLockedNodeId: null,
  igStatusFilter: 'all', // 'all' | 'queued' | 'published' | 'website'
  projectsLifecycleFilter: 'active', // 'active' | 'delivered'
  eagleDisplayStyle: 'waterfall', // 'waterfall' | 'uniform'
  eagleScopeMode: 'batches', // 'batches' | 'files' | 'closed_projects'
  eagleFormatFilter: 'all', // 'all' | 'psd' | 'image' | 'video' | '3d'
  giantWallZoom: 1,
  giantWallPanX: 0,
  giantWallPanY: 0,
  hoveredAssetForQuickLook: null,
  launchpadIconSize: 165,
  rdLabFilter: 'all', // 'all' | 'explore' | 'subs' | 'build'
  selectedCompareAssets: [], // [{ id, title, url, kind, status, igStatus, section, vaultItemId }]
  compareState: {
    mode: 'stack', // 'stack' | 'split'
    activeIndex: 0,
    diffBlend: false,
    zoom: 1,
    panX: 0,
    panY: 0
  },
  draggedId: null,
  draggedKind: null
};

function isValidV5Vault(v) {
  return Boolean(
    v &&
    v.version === CURRENT_VAULT_VERSION &&
    v.customization &&
    typeof v.customization === 'object' &&
    Array.isArray(v.spaces) &&
    v.spaces.length >= 6 &&
    typeof v.spaces[0].code === 'string' &&
    Array.isArray(v.projects) &&
    v.projects.length >= 5 &&
    Array.isArray(v.items)
  );
}

function getExtraSphereSeedItems() {
  const now = Date.now();
  return [
    /* Extra visual & outer-layer nodes for Project 1 (3D Character Sculpt) so its sphere is lush */
    {
      id: 'itm_sculpt_sph_5',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Sculpt Stages',
      kind: 'image',
      title: 'Clay Silhouette & Primary Forms Study 02',
      status: '🗿 Clay Pass',
      url: 'vault_media/sphere_sculpt_clay.png',
      notes: 'Exaggerate collar bone and orbital ridge before subdividing to level 5. Keep clay strokes visible around neck.',
      tags: ['ZBrush', 'Clay Study'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 498000
    },
    {
      id: 'itm_sculpt_sph_6',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Turntable & Shaders',
      kind: 'image',
      title: 'Iridescent Liquid Chrome Shader Test (Cycles)',
      status: '✨ Shader Pass',
      url: 'vault_media/sphere_sculpt_chrome.png',
      notes: 'Anisotropic roughness 0.08 + thin-film interference IOR 1.45. Great candidate for final Instagram turntable loop.',
      tags: ['Cycles', 'Chrome Shader'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 497000
    },
    {
      id: 'itm_sculpt_sph_7',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Sculpt Stages',
      kind: 'image',
      title: 'Tangent-Space Normal & Cavity Bake Check',
      status: '🟣 Normal Map',
      url: 'vault_media/sphere_sculpt_normal.png',
      notes: 'Baked 4K 16-bit TIFF normal map from 12M poly sculpt onto 18K low-poly cage. Zero UV seam artifacts.',
      tags: ['Normal Map', 'Bake'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 496000
    },
    {
      id: 'itm_sculpt_sph_8',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Sculpt Stages',
      kind: 'image',
      title: 'Red Wax MatCap — Micro-Pore & Eyelid Crease Detail',
      status: '🔥 Subdiv Lvl 6',
      url: 'vault_media/sphere_sculpt_zbrush.png',
      notes: 'Used DamStandard + custom skin alpha at ZIntensity 14. Ready to export displacement map.',
      tags: ['MatCap', 'Detail'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 495000
    },
    {
      id: 'itm_sculpt_sph_9',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Turntable & Shaders',
      kind: 'image',
      title: 'Subsurface Glass & Chrome Refraction Lighting Test',
      status: '💎 Refraction',
      url: 'vault_media/test_ref_glass.png',
      notes: 'Key light at 45° warm rim + cool fill. Transmission bounces set to 12 in Blender.',
      tags: ['Lighting', 'Refraction'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 494000
    },
    {
      id: 'itm_sculpt_sph_10',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Sculpt Stages',
      kind: 'image',
      title: 'Profile Proportions & Cranial Volume Check',
      status: '📐 Proportion',
      url: 'vault_media/test_unsorted_sketch.png',
      notes: 'Check ear placement and jawline angle from 3/4 camera view before locking pose.',
      tags: ['Proportions', 'Camera'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 493000
    },
    {
      id: 'itm_sculpt_sph_11',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Turntable & Shaders',
      kind: 'image',
      title: 'Studio Hero Render — Specular Rim Pass',
      status: '📸 Still 04',
      url: 'vault_media/test_ig_slide1.png',
      notes: 'High-contrast studio still for website portfolio header and Instagram slide 1.',
      tags: ['Hero Still', '4K'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 492000
    },
    {
      id: 'itm_sculpt_sph_12',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Turntable & Shaders',
      kind: 'image',
      title: 'Vertical 9:16 Close-Up Orbit Loop',
      status: '🎬 9:16 Cut',
      url: 'vault_media/test_reel_vertical.gif',
      notes: 'Slow 6-second camera dolly into metallic iris details.',
      tags: ['9:16', 'Close-Up'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 491000
    },
    {
      id: 'itm_sculpt_sph_note2',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Notes & Next Steps',
      kind: 'note',
      title: 'Blender Cycles Render Settings & Camera Focal Length',
      status: '📝 Render Spec',
      url: '',
      notes: 'Camera: 85mm telephoto, f/2.8 DOF focused on left eye.\nSamples: 1024 with OpenImageDenoise (Albedo + Normal passes enabled).\nOutput: 16-bit PNG sequence @ 30fps.',
      tags: ['Render Spec', 'Camera'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 490500
    },
    {
      id: 'itm_sculpt_sph_link1',
      parentType: 'project',
      parentId: 'proj_test_sculpt',
      section: 'Notes & Next Steps',
      kind: 'link',
      title: '3D Projects 2026 Master Folder (ZTL + BLEND)',
      status: '📁 Local Folder',
      url: '',
      notes: 'Contains Head_Blockout_v04.ztl, Chrome_Shader_Rig.blend, and 4K Displacement maps.',
      tags: ['Finder Path', 'Source Files'],
      link: '~/Desktop/3d projects 2026',
      createdAt: now - 490200
    },

    /* Extra visual & outer-layer nodes for Project 2 (Instagram Post & Reel) */
    {
      id: 'itm_ig_sph_5',
      parentType: 'project',
      parentId: 'proj_test_ig',
      section: 'Carousel Slides',
      kind: 'image',
      title: 'Slide 02 — Warm Halftone & Chrome Detail Crop (4:5)',
      status: '📸 Slide 02',
      url: 'vault_media/sphere_ig_portrait2.png',
      notes: '4:5 vertical crop (1080x1350) focusing on warm metallic gradient and grain texture.',
      tags: ['4:5 Slide', 'Carousel'],
      link: '~/Desktop/socials',
      createdAt: now - 429000
    },
    {
      id: 'itm_ig_sph_6',
      parentType: 'project',
      parentId: 'proj_test_ig',
      section: 'Carousel Slides',
      kind: 'image',
      title: 'Slide 03 — Editorial Frame & Center Emblem Study',
      status: '📸 Slide 03',
      url: 'vault_media/sphere_ig_carousel3.png',
      notes: 'Clean gallery mat border around central red sculptural emblem to pace the carousel swipe.',
      tags: ['Slide 03', 'Editorial'],
      link: '~/Desktop/socials',
      createdAt: now - 428000
    },
    {
      id: 'itm_ig_sph_7',
      parentType: 'project',
      parentId: 'proj_test_ig',
      section: 'Carousel Slides',
      kind: 'image',
      title: 'Slide 04 — Wireframe & Clay Split Breakdown',
      status: '📸 Slide 04',
      url: 'vault_media/test_sculpt_wire.png',
      notes: 'Behind-the-scenes topology view — always gets high saves on Instagram.',
      tags: ['BTS', 'Wireframe'],
      link: '~/Desktop/socials',
      createdAt: now - 427000
    },
    {
      id: 'itm_ig_sph_8',
      parentType: 'project',
      parentId: 'proj_test_ig',
      section: 'Carousel Slides',
      kind: 'image',
      title: 'Slide 05 — Riso Halftone Typography Back Cover',
      status: '📸 Slide 05',
      url: 'vault_media/sphere_riso_poster1.png',
      notes: 'Final slide with credits, software stack (ZBrush / Blender / After Effects), and sound credit.',
      tags: ['Credits Slide', 'Riso'],
      link: '~/Desktop/socials',
      createdAt: now - 426000
    },
    {
      id: 'itm_ig_sph_9',
      parentType: 'project',
      parentId: 'proj_test_ig',
      section: 'Reel Cut',
      kind: 'image',
      title: 'IG Story Teaser — 9:16 WIP Behind-The-Scenes',
      status: '📱 Story Cut',
      url: 'vault_media/test_ig_story_wip.png',
      notes: 'Share to Stories 15 mins after publishing main carousel with "New Work" link sticker.',
      tags: ['Story', 'Teaser'],
      link: '~/Desktop/socials',
      createdAt: now - 425000
    },
    {
      id: 'itm_ig_sph_10',
      parentType: 'project',
      parentId: 'proj_test_ig',
      section: 'Carousel Slides',
      kind: 'image',
      title: 'Profile 9-Grid Color Harmony Preview',
      status: '🟣 Grid Check',
      url: 'vault_media/test_ig_grid_plan.png',
      notes: 'Verified that Slide 01 balances the dark chrome and warm paper tones on the top row of the grid.',
      tags: ['Grid Plan', 'Aesthetic'],
      link: '~/Desktop/socials',
      createdAt: now - 424000
    },

    /* Extra visual & outer-layer nodes for Project 3 (Website Updates) */
    {
      id: 'itm_web_sph_4',
      parentType: 'project',
      parentId: 'proj_test_web',
      section: 'Layout Mockups',
      kind: 'image',
      title: 'Dark Mode Index Grid — Hover Video Preview State',
      status: '🌙 Dark UI',
      url: 'vault_media/sphere_web_grid_dark.png',
      notes: 'When hovering a project thumbnail on desktop, play muted WebM loop at 60fps with zero layout shift.',
      tags: ['Dark Mode', 'Hover State'],
      link: '~/Desktop/website files',
      createdAt: now - 399000
    },
    {
      id: 'itm_web_sph_5',
      parentType: 'project',
      parentId: 'proj_test_web',
      section: 'Layout Mockups',
      kind: 'image',
      title: 'Case Study Hero Banner — Noods Radio Full-Bleed',
      status: '🖼 Case Hero',
      url: 'vault_media/test_ig_slide1.png',
      notes: 'Use 2560px WebP @ quality 92 + fetchpriority="high" for instant LCP on portfolio case page.',
      tags: ['Case Study', 'Hero'],
      link: '~/Desktop/molly upload to site',
      createdAt: now - 398000
    },
    {
      id: 'itm_web_sph_6',
      parentType: 'project',
      parentId: 'proj_test_web',
      section: 'Layout Mockups',
      kind: 'image',
      title: 'Exhibition & Club Visuals Archive Table Layout',
      status: '📐 Archive UI',
      url: 'vault_media/sphere_grant_install.png',
      notes: 'Chronological index of 2024–2026 club visuals, radio residencies, and group exhibitions.',
      tags: ['Archive', 'Index'],
      link: '~/Desktop/website files',
      createdAt: now - 397000
    },
    {
      id: 'itm_web_sph_7',
      parentType: 'project',
      parentId: 'proj_test_web',
      section: 'Layout Mockups',
      kind: 'image',
      title: 'Typography & Monospace Spec Sheet for Dev',
      status: '🔤 Type Spec',
      url: 'vault_media/test_ref_type.png',
      notes: 'Heading: Space Grotesk 500 (-0.02em) • Index & Meta: IBM Plex Mono 400 (11.5px).',
      tags: ['Typography', 'CSS Spec'],
      link: '~/Desktop/website files',
      createdAt: now - 396000
    },

    /* Extra visual nodes for Project 4 (Foggy — Party Work VJ Visuals) */
    {
      id: 'itm_foggy_sph_4',
      parentType: 'project',
      parentId: 'proj_foggy_vj',
      section: 'VJ Loops',
      kind: 'image',
      title: 'Aurora Acid Shader — Peak-Time Wide LED Wall Loop',
      status: '🟢 138 BPM',
      url: 'vault_media/sphere_vj_aurora.png',
      notes: 'Rendered at 3840x1200 ultra-wide for main booth LED ribbon. Reacts to sub-bass kick in Resolume.',
      tags: ['LED Wall', 'Aurora Shader'],
      link: '~/Desktop/VJ',
      createdAt: now - 379000
    },
    {
      id: 'itm_foggy_sph_5',
      parentType: 'project',
      parentId: 'proj_foggy_vj',
      section: 'VJ Loops',
      kind: 'image',
      title: 'Radial Tunnel Strobe — High-Contrast Mask Layer',
      status: '⚡ Strobe Mask',
      url: 'vault_media/sphere_vj_strobe.png',
      notes: 'Use as Luma Key mask over 3D chrome head loops during breakdowns.',
      tags: ['Luma Mask', 'Tunnel'],
      link: '~/Desktop/VJ',
      createdAt: now - 378000
    },
    {
      id: 'itm_foggy_sph_6',
      parentType: 'project',
      parentId: 'proj_foggy_vj',
      section: 'Stage Renders',
      kind: 'image',
      title: 'Liquid Chrome Bumper — Foggy 3D Emblem Spin',
      status: '🎛 Bumper 02',
      url: 'vault_media/sphere_sculpt_chrome.png',
      notes: 'Alpha-channel ProRes 4444 bumper overlaid on live camera feed.',
      tags: ['Alpha Channel', 'Bumper'],
      link: '~/Desktop/foggy general',
      createdAt: now - 377000
    },
    {
      id: 'itm_foggy_sph_7',
      parentType: 'project',
      parentId: 'proj_foggy_vj',
      section: 'Stage Renders',
      kind: 'image',
      title: 'UV Normal Reactive Mesh — Audio Displacement Pass',
      status: '🟣 Audio Mesh',
      url: 'vault_media/sphere_sculpt_normal.png',
      notes: 'TouchDesigner FFT spectrum driving vertex displacement on 3D sculpt.',
      tags: ['TouchDesigner', 'Audio Reactive'],
      link: '~/Desktop/VJ',
      createdAt: now - 376000
    },

    /* Extra visual nodes for Project 5 (Noods Radio — The Fly) & Project 6 (SHUT THE FUGWUB) */
    {
      id: 'itm_noods_sph_3',
      parentType: 'project',
      parentId: 'proj_noods_fly',
      section: 'Final Stills',
      kind: 'image',
      title: 'The Fly — Chrome Wing & Compound Eye Macro Still',
      status: '🔬 Macro Still',
      url: 'vault_media/sphere_sculpt_chrome.png',
      notes: 'Extreme macro render showing iridescent compound lens shader for Noods Radio tracklist slide.',
      tags: ['Macro', 'Noods Radio'],
      link: '~/Desktop/The Fly',
      createdAt: now - 364000
    },
    {
      id: 'itm_noods_sph_4',
      parentType: 'project',
      parentId: 'proj_noods_fly',
      section: 'Final Stills',
      kind: 'image',
      title: 'Noods Radio Broadcast Flyer — Riso Cobalt & Black',
      status: '🖨 Flyer Print',
      url: 'vault_media/sphere_riso_poster2.png',
      notes: '2-color Riso print test (Medium Blue + Black) with broadcast date and Bristol/Berlin timezones.',
      tags: ['Riso', 'Broadcast Flyer'],
      link: '~/Desktop/The Fly',
      createdAt: now - 363000
    },
    {
      id: 'itm_noods_sph_5',
      parentType: 'project',
      parentId: 'proj_noods_fly',
      section: 'Notes',
      kind: 'note',
      title: 'Noods Radio — Tracklist & Visual Cue Sheet',
      status: '📝 Cue Sheet',
      url: '',
      notes: '00:00 Intro Glass Refraction Loop\n14:20 Metallic Wing Morph (132 BPM)\n38:00 Dark Strobe Breakdown\n52:10 Outro Halftone Credits',
      tags: ['Cue Sheet', 'Broadcast'],
      link: '~/Desktop/The Fly',
      createdAt: now - 362000
    },
    {
      id: 'itm_fugwub_sph_2',
      parentType: 'project',
      parentId: 'proj_fugwub',
      section: 'Print & Poster',
      kind: 'image',
      title: 'SHUT THE FUGWUB — Riso Crimson Halftone Flyer Study',
      status: '🔴 Riso Red',
      url: 'vault_media/sphere_riso_poster1.png',
      notes: '300dpi halftone screen @ 45lpi for punky Tempelhof open-air print handout.',
      tags: ['Halftone', 'Tempelhof'],
      link: '~/Desktop/fubwog',
      createdAt: now - 359000
    },
    {
      id: 'itm_fugwub_sph_3',
      parentType: 'project',
      parentId: 'proj_fugwub',
      section: 'Print & Poster',
      kind: 'image',
      title: 'THF Radio Lineup Back-Print & Timetable Specimen',
      status: '🔵 Riso Blue',
      url: 'vault_media/sphere_riso_poster2.png',
      notes: 'Back of A5 flyer featuring set times, map pin at Tempelhof Field, and THF Radio frequency.',
      tags: ['Lineup', 'A5 Flyer'],
      link: '~/Desktop/fubwog',
      createdAt: now - 358000
    }
  ];
}

function ensureVaultSleekAndGDrive(v) {
  if (!v || typeof v !== 'object') return v;
  v.customization = v.customization || {};
  v.customization.cardBorderWidth = 0;
  v.customization.cardRadius = 5;
  v.customization.gridGap = 28;
  v.customization.showIndexBadge = true;
  v.customization.showStatusBadge = true;
  v.customization.showCountBadge = true;

  v.projects = Array.isArray(v.projects) ? v.projects : [];
  v.items = Array.isArray(v.items) ? v.items : [];

  // 1. Keep all user boards (including TEST boards — 8 boards total); only fold legacy proj_idea_incubator into 02 Incubator
  v.projects = v.projects.filter(p => p && p.id !== 'proj_idea_incubator');
  v.items = v.items.filter(it => Boolean(it));

  // 2. Remap any legacy space IDs on items
  v.items.forEach(it => {
    if (
      (it.parentType === 'space' && (it.parentId === 'quick_drop' || it.parentId === 'drop_table')) ||
      (it.parentType === 'project' && it.parentId === 'proj_idea_incubator')
    ) {
      it.parentType = 'space';
      it.parentId = 'incubator';
      if (!it.section || it.section === 'All' || it.section === 'Visual Sparks') {
        it.section = 'Hatching Up';
      }
    }
    if (it.parentType === 'space' && it.parentId === 'gdrive_vault') {
      it.parentId = 'gdrive_assets';
    }
  });

  // 3. Seed 02 Incubator with starter cards if empty
  const existingIncubatorItems = v.items.filter(it => it.parentType === 'space' && it.parentId === 'incubator');
  if (existingIncubatorItems.length === 0) {
    const now = Date.now();
    v.items.unshift(
      {
        id: 'inc_seed_1',
        parentType: 'space',
        parentId: 'incubator',
        title: 'Hatching Up — Next Visual & 3D Directions',
        kind: 'note',
        section: 'Hatching Up',
        status: '✦ Hatching',
        url: '',
        link: '',
        notes: 'Drop early concepts, rough renders, shader tests, or voice/text sparks that you are hatching up or trying to start working on.',
        tags: ['Incubator', 'Sparks'],
        wallX: 288,
        wallY: 120,
        wallW: 288,
        createdAt: now - 3000
      },
      {
        id: 'inc_seed_2',
        parentType: 'space',
        parentId: 'incubator',
        title: 'IG Not Ready Yet — Cuts & Drafts to Refine',
        kind: 'todo',
        section: 'IG Not Ready Yet',
        status: '◈ Pre-IG WIP',
        url: '',
        link: '',
        notes: '[ ] Test color grading on sculpt turntable before staging to IG\n[ ] Trim 15s club loop hook\n[ ] Pick cover frame once render finishes',
        tags: ['Instagram WIP', 'Drafts'],
        wallX: 600,
        wallY: 120,
        wallW: 288,
        createdAt: now - 2000
      },
      {
        id: 'inc_seed_3',
        parentType: 'space',
        parentId: 'incubator',
        title: 'Trying to Start — Unstructured Studio Experiments',
        kind: 'folder',
        section: 'Starting / WIP',
        status: 'Folder',
        url: '',
        link: '',
        notes: 'Sub-board for experiments in early gestation',
        tags: ['WIP'],
        wallX: 912,
        wallY: 120,
        wallW: 264,
        createdAt: now - 1000
      }
    );
  }

  // 4. Ensure all board items have clean coordinates inside safe viewport bounds (Sidebar on left = 236px, Dock on right)
  const groupedByParent = {};
  v.items.forEach(it => {
    const key = `${it.parentType || 'project'}:${it.parentId || ''}:${it.folderId || 'root'}`;
    groupedByParent[key] = groupedByParent[key] || [];
    groupedByParent[key].push(it);
  });
  Object.values(groupedByParent).forEach(group => {
    const hasBlockedCoords = group.some(it => typeof it.wallX === 'number' && it.wallX < 250);
    group.forEach((it, idx) => {
      if (hasBlockedCoords || typeof it.wallX !== 'number' || it.wallX < 250) {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        it.wallX = 288 + col * 312;
        it.wallY = 120 + row * 312;
      } else if (typeof it.wallY !== 'number' || it.wallY < 96) {
        it.wallY = 120;
      }
    });
  });

  // 5. Ensure all Studio Projects default to Giant Wall or Clear Drawers (never Eagle) and have safe coordinates
  const deliveredSeedIds = new Set(['proj_noods_fly', 'proj_fugwub']);
  v.projects.forEach((p, idx) => {
    p.code = '#' + String(idx + 1).padStart(2, '0');
    if (!p.lifecycleState) {
      p.lifecycleState = deliveredSeedIds.has(p.id) ? 'delivered' : 'active';
    }
    p.ui = p.ui || {};
    if (!p.ui.layoutMode || p.ui.layoutMode === 'eagle' || p.ui.layoutMode === 'sphere') {
      p.ui.layoutMode = 'giant_wall';
    }
    if (!p.ui.cardSize || p.ui.cardSize < 240) {
      p.ui.cardSize = 300;
    }
    if (p.category === 'Idea Incubator') {
      p.category = '3D & Motion';
    }
    if (typeof p.boardX !== 'number' || p.boardX < 250 || typeof p.boardY !== 'number' || p.boardY < 96) {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      p.boardX = 288 + col * 408;
      p.boardY = 120 + row * 336;
    }
  });

  // 6. Enforce the exact 10 canonical Sidebar Spaces while preserving user custom titles & codes
  const oldSpacesMap = {};
  (v.spaces || []).forEach(s => {
    if (!s || !s.id) return;
    let normId = s.id;
    if (normId === 'gdrive_vault') normId = 'gdrive_assets';
    if (normId === 'tools_lab') normId = 'tool_dock';
    oldSpacesMap[normId] = s;
  });

  const keepTitle = (id, fallback, badScriptTitles = []) => {
    const t = oldSpacesMap[id]?.title;
    if (t && typeof t === 'string' && t.trim() && !badScriptTitles.includes(t.trim())) {
      return t.trim();
    }
    return fallback;
  };
  const keepCode = (_id, fallback) => fallback;

  v.spaces = [
    {
      id: 'projects',
      code: keepCode('projects', '01'),
      world: 'I. Creative Studio',
      title: keepTitle('projects', 'Studio Projects'),
      kicker: 'I. CREATIVE STUDIO / 01',
      heading: keepTitle('projects', 'Studio Projects'),
      categories: ['All', 'VJ & Club Visuals', '3D & Motion', 'Graphic Design', 'Mixed Media'],
      ui: {
        layoutMode: (oldSpacesMap.projects?.ui?.layoutMode === 'sphere' || oldSpacesMap.projects?.ui?.layoutMode === 'giant_wall') ? oldSpacesMap.projects.ui.layoutMode : 'wall',
        cardSize: Math.max(320, Number(oldSpacesMap.projects?.ui?.cardSize) || 360),
        aspectRatio: '16 / 10.5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'incubator',
      code: keepCode('incubator', '02'),
      world: 'I. Creative Studio',
      title: keepTitle('incubator', 'Incubator'),
      kicker: 'I. CREATIVE STUDIO / 02',
      heading: keepTitle('incubator', 'Incubator'),
      categories: ['All', 'Hatching Up', 'Starting / WIP', 'IG Not Ready Yet', 'Sparks & Notes'],
      ui: {
        layoutMode: (oldSpacesMap.incubator?.ui?.layoutMode === 'sphere' || oldSpacesMap.incubator?.ui?.layoutMode === 'wall') ? oldSpacesMap.incubator.ui.layoutMode : 'giant_wall',
        cardSize: Math.max(260, Number(oldSpacesMap.incubator?.ui?.cardSize) || 300),
        aspectRatio: '16 / 10.5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'instagram',
      code: keepCode('instagram', '03'),
      world: 'I. Creative Studio',
      title: keepTitle('instagram', 'Instagram', ['Instagram & Highlights']),
      kicker: 'I. CREATIVE STUDIO / 03',
      heading: 'Instagram — Next Up (◈ Ready) & Published (● Live)',
      categories: ['All', 'IG Ready', 'IG Live', 'Reels & Motion', 'Highlights'],
      ui: {
        layoutMode: (oldSpacesMap.instagram?.ui?.layoutMode === 'giant_wall' || oldSpacesMap.instagram?.ui?.layoutMode === 'list') ? oldSpacesMap.instagram.ui.layoutMode : 'wall',
        cardSize: 320,
        aspectRatio: '4 / 5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'website',
      code: keepCode('website', '04'),
      world: 'I. Creative Studio',
      title: keepTitle('website', 'Website & Portfolio', ['For My Website']),
      kicker: 'I. CREATIVE STUDIO / 04',
      heading: keepTitle('website', 'Website & Portfolio Staging', ['For My Website']),
      categories: ['All', 'Portfolio Cases', 'Homepage & Bio', 'Layout & Notes'],
      ui: {
        layoutMode: (oldSpacesMap.website?.ui?.layoutMode === 'giant_wall' || oldSpacesMap.website?.ui?.layoutMode === 'list') ? oldSpacesMap.website.ui.layoutMode : 'wall',
        cardSize: 340,
        aspectRatio: '16 / 10.5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'gdrive_assets',
      code: keepCode('gdrive_assets', '05'),
      world: 'II. Lab & Assets',
      title: keepTitle('gdrive_assets', 'Drive & PSD Assets', ['Google Drive & PSD Vault']),
      kicker: 'II. LAB & ASSETS / 05',
      heading: keepTitle('gdrive_assets', 'Drive & PSD Assets', ['Google Drive & PSD Vault']),
      categories: ['All', 'Mockups (PSD)', 'Textures & Overlays', 'Fonts & Type', '3D & Motion', 'Graphic Stocks'],
      ui: { layoutMode: 'eagle', cardSize: 235, aspectRatio: '1 / 1', imageFit: 'cover', sortOrder: 'manual' }
    },
    {
      id: 'tool_dock',
      code: keepCode('tool_dock', '06'),
      world: 'II. Lab & Assets',
      title: keepTitle('tool_dock', 'Tool Dock & R&D Lab', ['Tools & Web Lab']),
      kicker: 'II. LAB & ASSETS / 06',
      heading: keepTitle('tool_dock', 'Tool Dock & R&D Lab', ['Tools & Web Lab']),
      categories: ['All', 'AI Pipelines', '3D & Render', 'Typography & Foundries', 'Motion & VJ', 'Admin & Utils'],
      ui: { layoutMode: 'wall', cardSize: 240, aspectRatio: '1 / 1', imageFit: 'cover', sortOrder: 'manual' }
    },
    {
      id: 'residencies',
      code: keepCode('residencies', '07'),
      world: 'III. Moving Forward',
      title: keepTitle('residencies', 'Residencies & Awards', ['Residencies & Grants']),
      kicker: 'III. MOVING FORWARD / 07',
      heading: keepTitle('residencies', 'Residencies & Awards', ['Residencies & Grants']),
      categories: ['All', 'Residencies', 'Grants & Fellowships', 'Awards & Open Calls'],
      ui: {
        layoutMode: (oldSpacesMap.residencies?.ui?.layoutMode === 'giant_wall' || oldSpacesMap.residencies?.ui?.layoutMode === 'kanban') ? oldSpacesMap.residencies.ui.layoutMode : 'wall',
        cardSize: 340,
        aspectRatio: '16 / 10.5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'work_apps',
      code: keepCode('work_apps', '08'),
      world: 'III. Moving Forward',
      title: keepTitle('work_apps', 'Work Applications', ['Showcases & Residencies']),
      kicker: 'III. MOVING FORWARD / 08',
      heading: keepTitle('work_apps', 'Work Applications & Studio Roles', ['Showcases & Residencies']),
      categories: ['All', 'Design & 3D Studios', 'Creative Direction', 'Tech & Freelance Rosters'],
      ui: {
        layoutMode: (oldSpacesMap.work_apps?.ui?.layoutMode === 'giant_wall' || oldSpacesMap.work_apps?.ui?.layoutMode === 'kanban') ? oldSpacesMap.work_apps.ui.layoutMode : 'wall',
        cardSize: 340,
        aspectRatio: '16 / 10.5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'dream_clients',
      code: keepCode('dream_clients', '09'),
      world: 'III. Moving Forward',
      title: keepTitle('dream_clients', 'Clients I Want to Work With'),
      kicker: 'III. MOVING FORWARD / 09',
      heading: keepTitle('dream_clients', 'Clients I Want to Work With'),
      categories: ['All', 'Music & Labels', 'Clubs & Festivals', 'Fashion & Brands', 'Cultural Institutions'],
      ui: {
        layoutMode: (oldSpacesMap.dream_clients?.ui?.layoutMode === 'giant_wall' || oldSpacesMap.dream_clients?.ui?.layoutMode === 'kanban') ? oldSpacesMap.dream_clients.ui.layoutMode : 'wall',
        cardSize: 340,
        aspectRatio: '16 / 10.5',
        imageFit: 'cover',
        sortOrder: 'manual'
      }
    },
    {
      id: 'customize',
      code: keepCode('customize', '10'),
      world: 'Customize',
      title: keepTitle('customize', 'Customize & Design'),
      kicker: 'STUDIO SETTINGS / 10',
      heading: keepTitle('customize', 'Customize & Design'),
      categories: ['Typography, Themes & Layout'],
      ui: { layoutMode: 'wall', cardSize: 340, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' }
    }
  ];

  // 7. Ensure Pitch Engine, Tool Dock, and Showcase Rollouts are populated
  if (!v.pitchEngine || (!Array.isArray(v.pitchEngine.pitches) && !Array.isArray(v.pitchEngine.cards))) {
    v.pitchEngine = createDefaultPitchEngineSeed();
  }
  if (!Array.isArray(v.pitchEngine.cards)) {
    v.pitchEngine.cards = (v.pitchEngine.pitches || []).map(p => ({
      id: p.id,
      spaceId: p.spaceId || 'residencies',
      title: p.title,
      category: p.category || 'Residencies',
      deadline: p.deadline || 'Rolling',
      status: p.outcome === 'sent' ? '✓ Sent' : (p.outcome === 'rejected' ? '🔥 Rejection Logged' : (p.outcome === 'accepted' ? '★ Accepted' : '🎯 Drafting')),
      link: p.link || '',
      requirements: p.requirements || { portfolioPdf: true, websiteLink: true, cv: true, artistStatement: false, projectProposal: false },
      notes: p.notes || ''
    }));
  }
  const existingPitchIds = new Set(v.pitchEngine.cards.map(c => c.id));
  getExtraMovingForwardSeedCards().forEach(card => {
    if (!existingPitchIds.has(card.id)) {
      v.pitchEngine.cards.push(card);
    }
  });
  v.pitchEngine.cards.forEach(c => {
    if (!c.spaceId) {
      if (c.id === 'pitch_trauma_bar') c.spaceId = 'dream_clients';
      else c.spaceId = 'residencies';
    }
  });

  if (!v.toolDock || (!Array.isArray(v.toolDock.tools) && !Array.isArray(v.toolDock.launchpad))) {
    v.toolDock = createDefaultToolDockSeed();
  }
  const tdSeed = createDefaultToolDockSeed();
  if ((!Array.isArray(v.toolDock.rdLab) || v.toolDock.rdLab.length === 0) && (!Array.isArray(v.toolDock.rdItems) || v.toolDock.rdItems.length === 0)) {
    v.toolDock.rdItems = tdSeed.rdItems;
  }
  (v.toolDock.tools || []).forEach(t => {
    if (t.link && t.link.includes('GoogleDrive-origold97@gmail.com')) {
      t.link = t.link.replace('GoogleDrive-origold97@gmail.com', 'GoogleDrive-omg.ori.gold@gmail.com');
    }
  });
  (v.toolDock.launchpad || []).forEach(t => {
    if (t.url && t.url.includes('GoogleDrive-origold97@gmail.com')) {
      t.url = t.url.replace('GoogleDrive-origold97@gmail.com', 'GoogleDrive-omg.ori.gold@gmail.com');
    }
  });
  if (!Array.isArray(v.showcaseRollouts) || v.showcaseRollouts.length === 0) {
    v.showcaseRollouts = createDefaultShowcaseRolloutsSeed(v);
  }

  v.customization.v23ConnectedStudioMigrated = true;
  v.v25CleanUnifiedVault = true;
  v.gdriveFileNotes = v.gdriveFileNotes || {};
  v.gdriveTitles = v.gdriveTitles || {};
  v.gdriveBatchTitles = v.gdriveBatchTitles || {};
  return v;
}

function getExtraMovingForwardSeedCards() {
  return [
    // 07 Work Applications
    {
      id: 'pitch_work_zeitguised',
      spaceId: 'work_apps',
      title: 'ZEITGUISED / foam Studio Berlin — Senior 3D & Synthetic Art Direction',
      category: 'Design & 3D Studios',
      deadline: 'Rolling / Cold Pitch',
      status: '🎯 Drafting',
      link: 'https://zeitguised.com',
      requirements: { portfolioPdf: true, websiteLink: true, cv: true, artistStatement: false, projectProposal: false },
      notes: 'What I need for this email:\n• Custom 6-slide PDF highlighting sculptural materiality & procedural shaders\n• Direct link to Website 3D reel\n• Short 4-sentence intro referencing their recent synthetic textile sculptures'
    },
    {
      id: 'pitch_work_builders_club',
      spaceId: 'work_apps',
      title: 'Builders Club London/Berlin — Freelance 3D & Motion Director Roster',
      category: 'Design & 3D Studios',
      deadline: 'Sent Nov 2',
      status: '✓ Sent',
      link: 'https://builders-club.com',
      requirements: { portfolioPdf: true, websiteLink: true, cv: true, artistStatement: false, projectProposal: false },
      notes: 'What I needed for this email:\n• Sent link to Noods Radio "The Fly" + Chrome Sculpt loop\n• Day rate & availability for Q4/Q1 commercial campaigns included'
    },
    {
      id: 'pitch_work_manvs',
      spaceId: 'work_apps',
      title: 'ManvsMachine — 3D Generalist & Lookdev Specialist',
      category: 'Design & 3D Studios',
      deadline: 'Logged Oct 28',
      status: '🔥 Rejection Logged (Good!)',
      link: 'https://mvsm.com',
      requirements: { portfolioPdf: true, websiteLink: true, cv: true, artistStatement: false, projectProposal: false },
      notes: 'Rejection logged (+1 toward 100-email quota!). Producer replied that roster is full for Nov but bookmarked reel for January.'
    },
    // 08 Clients I Want to Work With
    {
      id: 'pitch_client_warp',
      spaceId: 'dream_clients',
      title: 'Warp Records — 12" Vinyl Sleeve, 3D Visualiser & Tour Canvas Loops',
      category: 'Music & Labels',
      deadline: 'Pitching This Week',
      status: '🎯 Drafting',
      link: 'https://warp.net',
      requirements: { portfolioPdf: true, websiteLink: true, cv: false, artistStatement: false, projectProposal: true },
      notes: 'What I need for this email:\n• Attach 3 high-contrast Riso + 3D chrome specimens ("The Fly" & "Alien Dotwork")\n• Offer a ready-to-go package: Vinyl jacket + Spotify Canvas + 4K club VJ pack\n• Address to Art Direction / Commissioning desk'
    },
    {
      id: 'pitch_client_tresor',
      spaceId: 'dream_clients',
      title: 'Tresor / Kraftwerk Berlin — Festival Artwork & Live A/V Stage Visuals',
      category: 'Clubs & Festivals',
      deadline: 'Follow-up Thu',
      status: '✓ Sent',
      link: 'https://tresorberlin.com',
      requirements: { portfolioPdf: true, websiteLink: true, cv: false, artistStatement: true, projectProposal: true },
      notes: 'What I needed for this email:\n• 45-second uncut club screen capture from Foggy VJ set\n• 2-color Riso poster archive PDF\n• Note on availability for upcoming winter showcase nights'
    },
    {
      id: 'pitch_client_acne',
      spaceId: 'dream_clients',
      title: 'Acne Studios / Gentle Monster — Custom 3D Sculptural Campaign & Store Loop',
      category: 'Fashion & Brands',
      deadline: 'Prep / Researching Contact',
      status: '🎯 Drafting',
      link: 'https://www.gentlemonster.com',
      requirements: { portfolioPdf: true, websiteLink: true, cv: false, artistStatement: false, projectProposal: true },
      notes: 'What I need for this email:\n• Curate 5 hyper-tactile organic/chrome sculpt renders from TEST 1\n• Keep email under 80 words with 1 inline GIF preview + direct portfolio link'
    }
  ];
}

function createDefaultShowcaseRolloutsSeed(v) {
  const now = Date.now();
  return [
    {
      id: 'rollout_noods_fly',
      projectId: 'proj_noods_fly',
      projectTitle: 'Noods Radio — "The Fly" Broadcast & Visual Identity',
      clientStatus: '✓ Client Delivered (Archived in Eagle)',
      promoStatus: '◈ Staged for IG & Website Case Study',
      igStatus: 'queued',
      websiteStatus: 'website',
      captionDraft: 'THE FLY — Live A/V broadcast identity & macro chrome compound-eye series for @noodsradio Bristol/Berlin.\n\nSculpted in ZBrush + rendered in Blender Cycles with 2-color Riso print specimen.\n\nSlide 1: Hero Chrome Compound Eye\nSlide 2: Riso Cobalt & Black Broadcast Flyer\nSlide 3: Tracklist & Cue Sheet\n\n#3dsculpt #noodsradio #risograph #clubvisuals #graphicdesign',
      caseStudyNotes: 'Website Case Study Layout: Hero 16:10 autoplay loop at top, followed by 2-column macro shader breakdown + Riso print scan.',
      slideItemIds: ['itm_noods_1', 'itm_noods_sph_3', 'itm_noods_sph_4', 'itm_web_space_3'],
      updatedAt: now - 36000
    },
    {
      id: 'rollout_fugwub',
      projectId: 'proj_fugwub',
      projectTitle: 'SHUT THE FUGWUB — THF Radio @ Tempelhof Open Air',
      clientStatus: '✓ Client Delivered (Archived in Eagle)',
      promoStatus: '● IG Live · Website Pending',
      igStatus: 'published',
      websiteStatus: 'queued',
      captionDraft: 'SHUT THE FUGWUB — Open-air visual identity & 2-color Riso A5 handout for THF Radio at Tempelhof Field.\n\n45lpi crimson halftone screen + cobalt timetable back-print.\n\n#thfradio #tempelhof #risoprint #posterdesign #berlinclub',
      caseStudyNotes: 'Add scanned front/back A5 Riso texture specimen to Graphic Design index on portfolio site.',
      slideItemIds: ['itm_fugwub_1', 'itm_fugwub_sph_2', 'itm_fugwub_sph_3'],
      updatedAt: now - 72000
    }
  ];
}

function createDefaultPitchEngineSeed() {
  return {
    quota: {
      title: '100 RESIDENCY & STUDIO PITCHES / MONTH',
      target: 100,
      sentCount: 28,
      rejectionsCount: 19,
      approvedCount: 4,
      timeframeLabel: 'NOVEMBER 2026 SPRINT',
      dailyPaceLabel: '3.4 / day pace • 72 remaining',
      manifestoTitle: 'FAILURE IS GOOD — REJECTIONS = VOLUME & MOMENTUM',
      manifestoSub: 'Every rejection is proof of high-output studio momentum. Collect rejections fearlessly to hit 100 outbound applications & studio pitches.'
    },
    pitches: [
      {
        id: 'pitch_bbk_berlin',
        title: 'BBK Berlin — Studio Grant & Sound/Vision Residency 2026',
        org: 'BBK Berlin / Kulturwerk',
        deadline: 'Nov 30, 2026',
        outcome: 'sent', // 'prep' | 'sent' | 'rejected' | 'accepted'
        link: 'https://www.bbk-berlin.de',
        requirements: {
          portfolioPdf: true,
          websiteLink: true,
          cv: true,
          artistStatement: true,
          projectProposal: false
        },
        notes: 'Stipend: €2,000/mo + subsidized studio space.\nAngle: Emphasize tactile bridge between hyper-glossy 3D digital sculpture and physical Riso/club architecture. Attach 10-page uncompressed PDF from ~/Desktop/PDF Documents.'
      },
      {
        id: 'pitch_ctm_transmediale',
        title: 'CTM / transmediale — Vorspiel Audiovisual Commission',
        org: 'CTM Festival Berlin',
        deadline: 'Dec 12, 2026',
        outcome: 'prep',
        link: 'https://www.ctm-festival.de',
        requirements: {
          portfolioPdf: true,
          websiteLink: true,
          cv: true,
          artistStatement: true,
          projectProposal: true
        },
        notes: 'Pitching live 3840x1200 audio-reactive chrome monolith + real-time TouchDesigner FFT shader set.\nNeed to finalize 1-page technical rider and private Vimeo showreel link.'
      },
      {
        id: 'pitch_villa_massimo',
        title: 'Akademie Schloss Solitude — Digital & Visual Arts Fellowship',
        org: 'Schloss Solitude Stuttgart',
        deadline: 'Nov 18, 2026',
        outcome: 'rejected',
        link: 'https://www.akademie-solitude.de',
        requirements: {
          portfolioPdf: true,
          websiteLink: true,
          cv: true,
          artistStatement: true,
          projectProposal: true
        },
        notes: 'Logged rejection #19 -> +1 Momentum! Jury feedback noted strong sculptural portfolio; reuse updated 250-word statement for Lightwork & Delfina calls.'
      },
      {
        id: 'pitch_eyebeam_ny',
        title: 'Eyebeam — Speculative Futures & Digital Craft Fellowship',
        org: 'Eyebeam NYC',
        deadline: 'Dec 20, 2026',
        outcome: 'sent',
        link: 'https://www.eyebeam.org',
        requirements: {
          portfolioPdf: true,
          websiteLink: true,
          cv: true,
          artistStatement: true,
          projectProposal: true
        },
        notes: 'Submitted full dossier with Noods Radio "The Fly" and 3D Sculpt Vault documentation.'
      },
      {
        id: 'pitch_trauma_bar',
        title: 'Trauma Bar und Kino — Resident VJ & Spatial Exhibition Pitch',
        org: 'Trauma Bar Berlin',
        deadline: 'Rolling / Follow-up Fri',
        outcome: 'accepted',
        link: '~/Desktop/VJ',
        requirements: {
          portfolioPdf: true,
          websiteLink: true,
          cv: false,
          artistStatement: true,
          projectProposal: true
        },
        notes: 'Curator replied! Scheduling studio visit + sending ProRes 4444 test loops from Foggy VJ set.'
      },
      {
        id: 'pitch_künstlerhaus_bethanien',
        title: 'Künstlerhaus Bethanien — International Studio Programme',
        org: 'Bethanien Berlin',
        deadline: 'Jan 15, 2027',
        outcome: 'prep',
        link: 'https://www.bethanien.de',
        requirements: {
          portfolioPdf: true,
          websiteLink: true,
          cv: true,
          artistStatement: false,
          projectProposal: false
        },
        notes: 'Tailor proposal around multi-screen sculptural installation + printed exhibition catalog.'
      }
    ]
  };
}

function createDefaultToolDockSeed() {
  return {
    categories: ['AI Pipelines', '3D & Render', 'Typography & Foundries', 'Motion & VJ', 'Admin & Utils'],
    tools: [
      { id: 'tl_comfy', title: 'ComfyUI Local Nodes', category: 'AI Pipelines', badge: 'LOCAL GPU', icon: '⚡', color: '#10B981', link: 'http://127.0.0.1:8188', desc: 'ControlNet, IPAdapter & custom shader pass workflows' },
      { id: 'tl_krea', title: 'Krea.ai Realtime', category: 'AI Pipelines', badge: 'AI UPSCALE', icon: '✦', color: '#8B5CF6', link: 'https://www.krea.ai', desc: 'Real-time 3D clay-to-chrome shader enhancement & upscale' },
      { id: 'tl_runway', title: 'Runway Gen-3 / Act-One', category: 'AI Pipelines', badge: 'VIDEO AI', icon: '🎬', color: '#EC4899', link: 'https://app.runwayml.com', desc: 'Motion brush & temporal texture synthesis for VJ loops' },
      { id: 'tl_fal', title: 'fal.ai Flux LoRA Studio', category: 'AI Pipelines', badge: 'API / LORA', icon: '◈', color: '#F59E0B', link: 'https://fal.ai', desc: 'Fast custom LoRA training on studio 3D sculpts' },

      { id: 'tl_sculpt_dir', title: '3D Projects 2026 Folder', category: '3D & Render', badge: 'MAC FINDER', icon: '🗿', color: '#C84B31', link: '~/Desktop/3d projects 2026', desc: 'Master ZBrush, Blender & OBJ/FBX sculpt directory' },
      { id: 'tl_polyhaven', title: 'Poly Haven HDRIs', category: '3D & Render', badge: '8K HDRI', icon: '🌐', color: '#0EA5E9', link: 'https://polyhaven.com', desc: 'Uncompressed studio reflection maps & PBR scans' },
      { id: 'tl_mixamo', title: 'Mixamo Auto-Rigger', category: '3D & Render', badge: 'RIGGING', icon: '🦴', color: '#F97316', link: 'https://www.mixamo.com', desc: 'Rapid biped rigging for club visual character loops' },

      { id: 'tl_dinamo', title: 'ABCDinamo Foundry', category: 'Typography & Foundries', badge: 'FOUNDRY', icon: 'Aa', color: '#111110', link: 'https://abcdinamo.com', desc: 'Variable grotesque & experimental display specimens' },
      { id: 'tl_pangram', title: 'Pangram Pangram', category: 'Typography & Foundries', badge: 'TRIAL FONTS', icon: '🔤', color: '#4F46E5', link: 'https://pangrampangram.com', desc: 'Editorial & kinetic poster typefaces' },
      { id: 'tl_velvetyne', title: 'Velvetyne Libre Foundry', category: 'Typography & Foundries', badge: 'OPEN TYPE', icon: '✺', color: '#E11D48', link: 'https://velvetyne.fr', desc: 'Radical open-source display & punk flyer typography' },

      { id: 'tl_vj_folder', title: 'Master VJ Loops Vault', category: 'Motion & VJ', badge: 'MAC FINDER', icon: '🎛', color: '#14B8A6', link: '~/Desktop/VJ', desc: 'Resolume Arena decks, DXV3 / ProRes 4444 stage packs' },
      { id: 'tl_shadertoy', title: 'Shadertoy GLSL Lab', category: 'Motion & VJ', badge: 'SHADERS', icon: '🌈', color: '#7C3AED', link: 'https://www.shadertoy.com', desc: 'Raymarching, chrome displacement & acid reaction shaders' },

      { id: 'tl_gdrive_local', title: 'Google Drive PSD Vault', category: 'Admin & Utils', badge: 'MAC FINDER', icon: '📁', color: '#2563EB', link: '~/Library/CloudStorage/GoogleDrive-omg.ori.gold@gmail.com/My Drive/ASSETS', desc: 'Direct Finder access to 74 PSD & texture asset batches' },
      { id: 'tl_finland_app', title: 'Finland Command Center', category: 'Admin & Utils', badge: 'SISTER APP', icon: '🇫🇮', color: '#059669', link: 'http://localhost:8000', desc: 'Financials, scheduling & administrative sister-app' },
      { id: 'tl_are_na', title: 'Are.na Research Channels', category: 'Admin & Utils', badge: 'RESEARCH', icon: '✴', color: '#52525B', link: 'https://www.are.na', desc: 'Exhibition curation & archival visual references' }
    ],
    rdItems: [
      {
        id: 'rd_1',
        lane: 'explore', // 'explore' | 'subs' | 'build'
        title: 'TouchDesigner + Spout/Syphon Live ZBrush Bridge',
        badge: 'TO TEST',
        category: 'Motion & VJ',
        priceNote: 'Free / Open-Source',
        link: 'https://derivative.ca',
        notes: 'Test streaming live ZBrush viewport directly into TouchDesigner FFT post-processing for real-time sculptural VJ sets.'
      },
      {
        id: 'rd_2',
        lane: 'explore',
        title: 'Hunyuan3D-2 / Trellis Image-to-3D Base Mesh Generator',
        badge: 'AI 3D LAB',
        category: 'AI Pipelines',
        priceNote: 'Local Weights',
        link: 'https://github.com/Tencent/Hunyuan3D-2',
        notes: 'Evaluate topology quality for rapid background prop generation before detailing in ZBrush.'
      },
      {
        id: 'rd_3',
        lane: 'explore',
        title: 'Cables.gl WebGL Interactive Case Study Embeds',
        badge: 'WEBGL',
        category: '3D & Render',
        priceNote: 'Free Web Tool',
        link: 'https://cables.gl',
        notes: 'Try embedding interactive 3D chrome headers on the new portfolio website.'
      },
      {
        id: 'rd_4',
        lane: 'subs',
        title: 'OctaneRender Studio+ / Cinema4D Bundle',
        badge: 'EVALUATING SUB',
        category: '3D & Render',
        priceNote: '€24/mo — Subscribe only on paid commercial sprint',
        link: 'https://home.otoy.com',
        notes: 'Pros: Spectral dispersion & glass caustics for "The Fly" sequel.\nCons: Blender Cycles + custom shader nodes covers 90% of current studio work for €0.'
      },
      {
        id: 'rd_5',
        lane: 'subs',
        title: 'Greyscalegorilla Plus Materials & Tactile Imperfections',
        badge: 'WAIT FOR CLIENT',
        category: '3D & Render',
        priceNote: '$49/mo — Bill to next client commission',
        link: 'https://greyscalegorilla.com',
        notes: 'Hold off until next commercial 3D bumper commission kicks off.'
      },
      {
        id: 'rd_6',
        lane: 'subs',
        title: 'Midjourney v7 Pro / Relax Mode Annual Check',
        badge: 'ACTIVE / REVIEW',
        category: 'AI Pipelines',
        priceNote: '$30/mo Standard',
        link: 'https://www.midjourney.com',
        notes: 'Compare monthly usage vs local Flux dev nodes in ComfyUI.'
      },
      {
        id: 'rd_7',
        lane: 'build',
        title: 'Auto-Riso Color Separation Action & Halftone Generator',
        badge: 'BUILD NEXT',
        category: 'Typography & Foundries',
        priceNote: 'Internal Python + Photoshop Script',
        link: '~/Desktop/fubwog',
        notes: 'Prompt Antigravity to build a 1-click script that splits any poster PNG into 45lpi Riso Red + Cobalt Blue grayscale drums.'
      },
      {
        id: 'rd_8',
        lane: 'build',
        title: 'Batch ProRes 4444 → WebM + MP4 Social Exporter',
        badge: 'FFMPEG TOOL',
        category: 'Motion & VJ',
        priceNote: 'Local macOS Dropplet',
        link: '~/Desktop/VJ',
        notes: 'Automate converting heavy VJ master loops into IG-ready 4:5 MP4 (CRF 18) and lightweight website loops.'
      },
      {
        id: 'rd_9',
        lane: 'build',
        title: 'Residency Dossier PDF Compiler (Auto-Stitches Selected Stills)',
        badge: 'PIPELINE IDEA',
        category: 'Admin & Utils',
        priceNote: 'Ideal Micro-Tool',
        link: '~/Desktop/PDF Documents',
        notes: 'Select 10 artworks inside Ideal and export a clean, typeset 10-page grant PDF with artist statement.'
      }
    ]
  };
}

function loadVault() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidV5Vault(parsed)) {
        return ensureVaultSleekAndGDrive(parsed);
      }
    }
  } catch (e) {
    console.warn('Could not read local vault, using seed:', e);
  }
  const seed = ensureVaultSleekAndGDrive(createSeedVault());
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(seed));
  } catch (e) {}
  return seed;
}

let saveTimer = null;
function saveVault(statusMsg = 'SAVED') {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(vault));
  } catch (e) {
    console.error('Local save error:', e);
  }
  const syncText = document.getElementById('syncStatusText');
  const syncDot = document.getElementById('syncStatusDot');
  if (syncText) syncText.textContent = 'SYNCING…';
  if (syncDot) syncDot.style.background = 'var(--accent)';

  const shortStatus = (!statusMsg || statusMsg.length > 10) ? 'SAVED' : statusMsg;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vault)
      });
      if (syncText) syncText.textContent = shortStatus;
      if (syncDot) syncDot.style.background = 'var(--ok)';
    } catch (err) {
      if (syncText) syncText.textContent = 'LOCAL';
    }
  }, 220);
}

async function fetchGDriveAssets(forceRefresh = false) {
  if (state.gdriveStats.loading) return;
  if (state.gdriveStats.loaded && !forceRefresh) return;
  state.gdriveStats.loading = true;
  try {
    const res = await fetch('/api/gdrive-assets');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.batches)) {
        state.gdriveBatches = data.batches;
        state.gdriveStats = {
          totalBatches: data.totalBatches || data.batches.length,
          totalFiles: data.totalFiles || 0,
          driveRoot: data.driveRoot || '',
          loading: false,
          loaded: true
        };
        // Dynamically sync Drive & PSD Assets category filter tabs with real indexed categories so tabs never return 0
        const gdriveSp = vault.spaces.find(s => s.id === 'gdrive_assets');
        if (gdriveSp && data.batches.length > 0) {
          const realCats = Array.from(new Set(data.batches.map(b => b.category).filter(Boolean)));
          const firstTab = 'All';
          if (realCats.length > 0) {
            gdriveSp.categories = [firstTab, ...realCats];
            if (!gdriveSp.categories.includes(state.activeCategory) && state.activeSpaceId === 'gdrive_assets') {
              state.activeCategory = firstTab;
            }
          }
        }
        renderSidebar();
        if (state.viewType === 'space' && state.activeSpaceId === 'gdrive_assets') {
          renderFilterActionRow();
          renderWorkspace();
        }
        return;
      }
    }
  } catch (e) {
    console.warn('Google Drive index fetch error:', e);
  }
  state.gdriveStats.loading = false;
}

async function syncFromServerOnBoot() {
  let localSaved = null;
  try {
    const rawLocal = localStorage.getItem('ideal_vault_v5');
    if (rawLocal) localSaved = JSON.parse(rawLocal);
  } catch (e) {}

  try {
    const res = await fetch('/api/vault');
    if (res.ok) {
      const resJson = await res.json();
      const serverVault = (resJson && resJson.vault) ? resJson.vault : resJson;
      if (isValidV5Vault(serverVault)) {
        const staleTitles = new Set(['For My Website', 'Instagram & Highlights', 'Google Drive & PSD Vault', 'Tools & Web Lab', 'Residencies & Grants', 'Showcases & Residencies']);
        if (localSaved && Array.isArray(localSaved.spaces)) {
          const localSpaceMap = {};
          localSaved.spaces.forEach(ls => {
            if (ls && ls.id) localSpaceMap[ls.id] = ls;
          });
          (serverVault.spaces || []).forEach(ss => {
            const ls = localSpaceMap[ss.id];
            if (ls && ls.title && !staleTitles.has(ls.title.trim())) ss.title = ls.title;
          });
        }
        const seedItemMap = {};
        (createSeedVault().items || []).forEach(si => { if (si && si.id) seedItemMap[si.id] = si; });
        (serverVault.items || []).forEach(it => {
          if (seedItemMap[it.id] && seedItemMap[it.id].url) {
            it.url = seedItemMap[it.id].url;
          }
        });
        if (localSaved && localSaved.customization?.worldTitles) {
          serverVault.customization = serverVault.customization || {};
          serverVault.customization.worldTitles = {
            ...(serverVault.customization.worldTitles || {}),
            ...localSaved.customization.worldTitles
          };
        }
        if (localSaved && Array.isArray(localSaved.projects)) {
          const serverProjIds = new Set((serverVault.projects || []).map(p => p.id));
          localSaved.projects.forEach(lp => {
            if (lp && lp.id && !serverProjIds.has(lp.id)) {
              serverVault.projects.push(lp);
            }
          });
        }
        if (localSaved && Array.isArray(localSaved.items)) {
          const serverItemIds = new Set((serverVault.items || []).map(i => i.id));
          localSaved.items.forEach(li => {
            if (li && li.id && !serverItemIds.has(li.id)) {
              serverVault.items.push(li);
            }
          });
        }
        vault = ensureVaultSleekAndGDrive(serverVault);
        localStorage.setItem(LS_KEY, JSON.stringify(vault));
        fetch('/api/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vault)
        }).catch(() => {});
      } else {
        vault = createSeedVault();
        localStorage.setItem(LS_KEY, JSON.stringify(vault));
        await fetch('/api/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vault)
        });
      }
    }
  } catch (e) {
    // Offline fallback is already loaded
  }

  try {
    const fRes = await fetch('/api/finland-projects');
    if (fRes.ok) {
      const fData = await fRes.json();
      if (fData && Array.isArray(fData.projects)) {
        state.finlandProjects = fData.projects;
      }
    }
  } catch (e) {}

  fetchGDriveAssets(false);
  applyCustomizationToDOM();
  renderAll();
}

/* ==========================================================================
   HELPERS: ACTIVE CONTAINER & UI SETTINGS
   ========================================================================== */
function getActiveContainer() {
  if (state.viewType === 'project') {
    const proj = vault.projects.find(p => p.id === state.activeProjectId);
    if (proj) {
      if (!proj.ui) {
        proj.ui = { layoutMode: 'wall', cardSize: 320, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' };
      }
      return { type: 'project', obj: proj };
    }
  }
  const sp = vault.spaces.find(s => s.id === state.activeSpaceId) || vault.spaces[0];
  if (!sp.ui) {
    sp.ui = { layoutMode: 'wall', cardSize: 330, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' };
  }
  return { type: 'space', obj: sp };
}

function applyCustomizationToDOM() {
  const c = vault.customization || {};
  const root = document.documentElement;

  root.style.setProperty('--font-heading', c.fontHeading || "'Inter', sans-serif");
  root.style.setProperty('--font-typewriter', c.fontBody || "'IBM Plex Mono', monospace");
  root.style.setProperty('--font-mono', c.fontMono || "'IBM Plex Mono', monospace");
  root.style.setProperty('--base-font-size', (c.baseFontSize || 13.5) + 'px');
  root.style.setProperty('--heading-scale', c.headingScale || 1);
  root.style.setProperty('--card-radius', (c.cardRadius ?? 5) + 'px');
  root.style.setProperty('--card-border-width', (c.cardBorderWidth ?? 0) + 'px');
  root.style.setProperty('--grid-gap', (c.gridGap ?? 28) + 'px');

  // Theme preset or custom palette
  const presetKey = c.themePreset || 'warm_gallery';
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (presetKey === 'custom' && c.customColors) {
    const cc = c.customColors;
    const bgHex = cc.bg || '#F6F4EF';
    const textHex = cc.text || '#181715';
    const isDarkCustom = /^#[0-3]/i.test(bgHex.trim());
    const modeStr = isDarkCustom ? 'dark' : 'light';
    root.style.colorScheme = modeStr;
    if (metaScheme) {
      metaScheme.content = modeStr;
      try { localStorage.setItem('color-scheme', modeStr); } catch (e) {}
    }
    root.style.setProperty('--bg', bgHex);
    root.style.setProperty('--surface', cc.surface || '#FAF8F5');
    root.style.setProperty('--surface-stage', cc.stage || '#E8E4DC');
    root.style.setProperty('--surface-pill', cc.surface || '#FFFFFF');
    root.style.setProperty('--text', textHex);
    root.style.setProperty('--accent', cc.accent || '#C84B31');
    root.style.setProperty('--border', `color-mix(in srgb, ${textHex} 11%, ${bgHex})`);
    root.style.setProperty('--border-strong', textHex);
    root.style.setProperty('--text-mid', `color-mix(in srgb, ${textHex} 62%, ${bgHex})`);
    root.style.setProperty('--text-faint', `color-mix(in srgb, ${textHex} 40%, ${bgHex})`);
  } else {
    const p = THEME_PRESETS[presetKey] || THEME_PRESETS.warm_gallery;
    root.style.colorScheme = p.mode || 'light';
    if (metaScheme) {
      metaScheme.content = p.mode;
      try { localStorage.setItem('color-scheme', p.mode); } catch (e) {}
    }
    root.style.setProperty('--bg', p.bg);
    root.style.setProperty('--surface', p.surface);
    root.style.setProperty('--surface-stage', p.stage);
    root.style.setProperty('--surface-pill', p.pill);
    root.style.setProperty('--border', p.border);
    root.style.setProperty('--border-strong', p.strong);
    root.style.setProperty('--text', p.text);
    root.style.setProperty('--text-mid', p.textMid);
    root.style.setProperty('--text-faint', p.textFaint);
    root.style.setProperty('--accent', p.accent);
  }

  // Card badge visibility classes
  document.body.classList.toggle('hide-index-badges', c.showIndexBadge === false);
  document.body.classList.toggle('hide-status-badges', c.showStatusBadge === false);
  document.body.classList.toggle('hide-count-badges', c.showCountBadge === false);
  document.body.classList.toggle('hide-card-tags', c.showCardTags === false);

  // Per-section UI tokens
  const { obj } = getActiveContainer();
  const ui = obj.ui || {};
  root.style.setProperty('--grid-size', (ui.cardSize || 330) + 'px');
  root.style.setProperty('--stage-aspect', ui.aspectRatio || '16 / 10.5');
  root.style.setProperty('--stage-fit', ui.imageFit || 'cover');

  // Sync sidebar open/collapsed state (open on entry, pushable to the side)
  const appShell = document.getElementById('appShell');
  const drawer = document.getElementById('sidebarDrawer');
  const restoreEdge = document.getElementById('btnRestoreSidebarEdge');

  const isOpen = Boolean(state.sidebarOpen);
  if (appShell) appShell.classList.toggle('sidebar-open', isOpen);
  if (drawer) drawer.classList.toggle('open', isOpen);
  if (restoreEdge) restoreEdge.hidden = isOpen;
}

/* ==========================================================================
   SIDEBAR NAVIGATION & INLINE COPY CUSTOMIZATION
   ========================================================================== */
function toggleSidebar(forceOpen) {
  state.sidebarOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.sidebarOpen;
  applyCustomizationToDOM();
}

function getSpaceCount(spaceId) {
  if (spaceId === 'projects') return vault.projects.length;
  if (spaceId === 'instagram') {
    const tagged = vault.items.filter(i => i.parentType === 'project' && (i.igStatus === 'queued' || i.igStatus === 'published')).length;
    const direct = vault.items.filter(i => i.parentType === 'space' && i.parentId === 'instagram').length;
    return tagged + direct;
  }
  if (spaceId === 'website') {
    const tagged = vault.items.filter(i => i.parentType === 'project' && i.igStatus === 'website').length;
    const direct = vault.items.filter(i => i.parentType === 'space' && i.parentId === 'website').length;
    return tagged + direct;
  }
  if (spaceId === 'gdrive_assets') return state.gdriveBatches.length || state.gdriveStats.totalBatches || 75;
  if (spaceId === 'tool_dock') return (vault.toolDock?.tools?.length || 15);
  if (['residencies', 'work_apps', 'dream_clients'].includes(spaceId)) {
    const cards = (vault.pitchEngine?.cards || []).filter(c => (c.spaceId || 'residencies') === spaceId).length;
    const notes = vault.items.filter(i => i.parentType === 'space' && i.parentId === spaceId).length;
    return cards + notes;
  }
  return vault.items.filter(i => i.parentType === 'space' && i.parentId === spaceId).length;
}

function renderSidebar() {
  const brandTitle = document.getElementById('sidebarBrandTitle') || document.getElementById('sidebarBrandName');
  const brandBadge = document.getElementById('sidebarBrandBadge');
  const tagline = document.getElementById('sidebarTagline');

  if (brandTitle) {
    brandTitle.textContent = vault.brand?.title || 'IDEAL';
    brandTitle.dataset.editableTitle = '1';
    brandTitle.title = 'Click or double-click to rename studio brand title';
  }
  if (brandBadge) brandBadge.textContent = vault.brand?.badge || 'STUDIO VAULT';
  if (tagline) tagline.textContent = vault.brand?.tagline || 'Visual Archive • Original Quality';

  vault.customization = vault.customization || {};
  vault.customization.worldTitles = vault.customization.worldTitles || {};

  const nav = document.getElementById('sidebarNav');
  if (nav) {
    nav.innerHTML = '';
    let lastWorld = null;

    vault.spaces.forEach(sp => {
      const worldKey = sp.world || '';
      if (worldKey && worldKey !== lastWorld) {
        lastWorld = worldKey;
        if (worldKey === 'Customize') {
          const sep = document.createElement('div');
          sep.className = 'sidebar-world-sep';
          nav.appendChild(sep);
        } else {
          const hdr = document.createElement('div');
          hdr.className = 'sidebar-world-header';
          const customWorldTitle = vault.customization.worldTitles[worldKey] || worldKey;
          hdr.textContent = customWorldTitle;
          hdr.dataset.editableTitle = '1';
          hdr.title = 'Click to rename section group header';
          hdr.addEventListener('click', (e) => {
            e.stopPropagation();
            promptInlineRename(hdr, vault.customization.worldTitles[worldKey] || worldKey, (newVal) => {
              if (newVal.trim()) {
                vault.customization.worldTitles[worldKey] = newVal.trim();
                saveVault('SAVED WORLD HEADER');
                renderSidebar();
              }
            });
          });
          nav.appendChild(hdr);
        }
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = state.viewType === 'space' && state.activeSpaceId === sp.id;
      btn.className = 'sidebar-item-btn' + (isActive ? ' active' : '');
      btn.title = 'Click to open • Double-click title or click ✎ to rename';

      const count = getSpaceCount(sp.id);
      const showCountPill = sp.id !== 'customize';
      btn.innerHTML = `
        <span class="sidebar-item-left">
          <span class="sidebar-code" data-editable-title="1" title="Double-click to edit code">${escapeHtml(sp.code)}</span>
          <span class="sidebar-label" data-editable-title="1">${escapeHtml(sp.title)}</span>
        </span>
        <span class="sidebar-right-meta" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="sidebar-rename-pen" title="Rename section">✎</span>
          ${showCountPill ? `<span class="sidebar-count-pill">${escapeHtml(String(count))}</span>` : ''}
        </span>
      `;

      const triggerRenameSpace = (e) => {
        e.stopPropagation();
        const labelSpan = btn.querySelector('.sidebar-label');
        promptInlineRename(labelSpan, sp.title, (newVal) => {
          if (newVal.trim()) {
            const clean = newVal.trim();
            sp.title = clean;
            sp.heading = clean;
            saveVault('RENAMED SECTION');
            renderAll();
          }
        });
      };

      btn.querySelector('.sidebar-rename-pen')?.addEventListener('click', triggerRenameSpace);
      btn.querySelector('.sidebar-label')?.addEventListener('dblclick', triggerRenameSpace);
      btn.querySelector('.sidebar-code')?.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const codeSpan = btn.querySelector('.sidebar-code');
        promptInlineRename(codeSpan, sp.code, (newVal) => {
          if (newVal.trim()) {
            sp.code = newVal.trim();
            saveVault('UPDATED CODE');
            renderAll();
          }
        });
      });

      btn.addEventListener('click', (e) => {
        if (e.target.closest('.inline-rename-field') || e.target.closest('.sidebar-rename-pen')) return;
        state.viewType = 'space';
        state.activeSpaceId = sp.id;
        state.activeProjectId = null;
        state.activeCategory = (sp.categories && sp.categories[0]) || 'All';
        state.sphereActiveIndex = 0;
        state.sphereLockedNodeId = null;
        state.sphereZoom = 1;
        state.spherePanX = 0;
        state.spherePanY = 0;
        applyCustomizationToDOM();
        renderAll();
      });

      nav.appendChild(btn);
    });
  }

  // Scalable Board Command Label in Sidebar (No 800-item sidebar list!)
  const jumpLabel = document.getElementById('sidebarBoardJumpLabel');
  if (jumpLabel) {
    if (state.viewType === 'project') {
      const p = vault.projects.find(proj => proj.id === state.activeProjectId);
      jumpLabel.textContent = p ? `⌕ ${p.title}` : `⌕ Jump to Board (${vault.projects.length})`;
    } else {
      jumpLabel.textContent = `⌕ Jump to Board (${vault.projects.length})`;
    }
  }
}

/* ==========================================================================
   INSTANT ⌘K BOARD SWITCHER (SCALES TO 800+ BOARDS)
   ========================================================================== */
function openBoardSwitcherModal() {
  const dlg = document.getElementById('boardSwitcherDialog');
  const inp = document.getElementById('boardSwitcherInput');
  if (!dlg) return;
  state.boardSwitcherActiveIdx = 0;
  if (inp) inp.value = '';
  renderBoardSwitcherList('');
  if (!dlg.open) dlg.showModal();
  if (inp) {
    setTimeout(() => inp.focus(), 15);
  }
}

function renderBoardSwitcherList(rawQuery) {
  const listEl = document.getElementById('boardSwitcherList');
  const dlg = document.getElementById('boardSwitcherDialog');
  if (!listEl) return;
  const q = (rawQuery || '').trim().toLowerCase();

  const matches = [];
  vault.projects.forEach((proj, idx) => {
    const numCode = '#' + String(idx + 1).padStart(2, '0');
    if (q) {
      const hay = `${numCode} ${proj.title || ''} ${proj.category || ''} ${proj.subtitle || ''} ${proj.status || ''}`.toLowerCase();
      if (!hay.includes(q)) return;
    }
    matches.push({ proj, idx, numCode });
  });

  if (typeof state.boardSwitcherActiveIdx !== 'number' || state.boardSwitcherActiveIdx >= matches.length) {
    state.boardSwitcherActiveIdx = 0;
  }

  const visible = matches.slice(0, 80);
  if (visible.length === 0) {
    listEl.innerHTML = `<div class="board-switcher-empty">No matching boards found · Press <strong>+ New Board</strong> to create one</div>`;
    return;
  }

  listEl.innerHTML = visible.map((m, vIdx) => {
    const count = vault.items.filter(i => i.parentType === 'project' && i.parentId === m.proj.id).length;
    const isAct = vIdx === state.boardSwitcherActiveIdx;
    const isCur = state.viewType === 'project' && state.activeProjectId === m.proj.id;
    return `
      <button type="button" class="board-switcher-row ${isAct ? 'is-focused' : ''} ${isCur ? 'is-current' : ''}" data-proj-id="${escapeHtml(m.proj.id)}" data-row-idx="${vIdx}">
        <span class="bs-code">${m.numCode}</span>
        <span class="bs-title">${escapeHtml(m.proj.title)}</span>
        <span class="bs-cat">${escapeHtml(m.proj.category || '')}</span>
        <span class="bs-count">${count}</span>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('.board-switcher-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.projId;
      dlg?.close();
      openProjectBoard(pid);
    });
  });
}

const MILANOTE_GRID_SIZE = 24;

function snapCoord(val, disableSnap = false) {
  if (disableSnap || state.snapToGrid === false) return Math.round(val);
  return Math.round(val / MILANOTE_GRID_SIZE) * MILANOTE_GRID_SIZE;
}

function getActiveBoardCamera() {
  const { type, obj } = getActiveContainer();
  if (type === 'space' && obj.id === 'projects') {
    if (typeof state.overviewZoom !== 'number') state.overviewZoom = 1;
    if (typeof state.overviewPanX !== 'number') state.overviewPanX = 0;
    if (typeof state.overviewPanY !== 'number') state.overviewPanY = 0;
    return {
      get zoom() { return state.overviewZoom; },
      set zoom(v) { state.overviewZoom = v; },
      get panX() { return state.overviewPanX; },
      set panX(v) { state.overviewPanX = v; },
      get panY() { return state.overviewPanY; },
      set panY(v) { state.overviewPanY = v; }
    };
  }
  if (typeof state.giantWallZoom !== 'number') state.giantWallZoom = 1;
  if (typeof state.giantWallPanX !== 'number') state.giantWallPanX = 0;
  if (typeof state.giantWallPanY !== 'number') state.giantWallPanY = 0;
  return {
    get zoom() { return state.giantWallZoom; },
    set zoom(v) { state.giantWallZoom = v; },
    get panX() { return state.giantWallPanX; },
    set panX(v) { state.giantWallPanX = v; },
    get panY() { return state.giantWallPanY; },
    set panY(v) { state.giantWallPanY = v; }
  };
}

function applyActiveBoardCameraTransform() {
  const plane = document.getElementById('giantWallPlane');
  const cam = getActiveBoardCamera();
  if (plane) {
    plane.style.transform = `translate3d(${cam.panX.toFixed(1)}px, ${cam.panY.toFixed(1)}px, 0) scale(${cam.zoom.toFixed(3)})`;
  }
  const resetBtn = document.getElementById('btnResetWallCamera');
  if (resetBtn) {
    resetBtn.textContent = `${Math.round(cam.zoom * 100)}%`;
  }
  const sizeSlider = document.getElementById('sizeSlider');
  if (sizeSlider && plane) {
    sizeSlider.value = String(Math.round(Math.max(150, Math.min(520, cam.zoom * 260))));
  }
}

/* ==========================================================================
   SINGLE-ROW HEADER, FILTER PILLS & PER-SECTION UI DRAWER
   ========================================================================== */
function renderHeaderAndToolbar() {
  const { type, obj } = getActiveContainer();
  const ui = obj.ui || (obj.ui = {});

  // Enforce strict Eagle-only on Drive & PSD Assets, and remove Eagle from other sections
  if (type === 'space' && obj.id === 'gdrive_assets') {
    ui.layoutMode = 'eagle';
  } else if (ui.layoutMode === 'eagle') {
    ui.layoutMode = (type === 'project') ? 'giant_wall' : 'wall';
  }

  const codeEl = document.getElementById('menuCurrentCode');
  const backBtn = document.getElementById('btnBackToProjects');
  const crumbEl = document.getElementById('boardBreadcrumbTrail');
  const titleEl = document.getElementById('viewTitle');
  const mainStage = document.getElementById('mainStage');
  const railEl = document.getElementById('milanoteToolRail');
  const hudViewModeGroup = document.getElementById('hudViewModeGroup');
  const btnViewSphere = document.getElementById('btnViewSphere');

  if (type === 'project') {
    const idx = vault.projects.findIndex(p => p.id === obj.id);
    const codeStr = '#' + String(idx + 1).padStart(2, '0');
    if (codeEl) codeEl.textContent = codeStr;
    if (backBtn) backBtn.hidden = false;

    // Build folder breadcrumb chain if inside a nested Board / Folder
    const folderChain = [];
    let curFolderId = state.activeFolderId || null;
    const seen = new Set();
    while (curFolderId && !seen.has(curFolderId)) {
      seen.add(curFolderId);
      const fItem = vault.items.find(i => i.id === curFolderId);
      if (!fItem) break;
      folderChain.unshift(fItem);
      curFolderId = fItem.folderId || null;
    }

    if (crumbEl) {
      crumbEl.hidden = false;
      let html = `<button type="button" class="crumb-link" data-crumb-action="projects">Projects</button><span class="crumb-sep">/</span>`;
      if (folderChain.length > 0) {
        html += `<button type="button" class="crumb-link" data-crumb-action="root-project" data-folder-drop="">${escapeHtml(obj.title)}</button><span class="crumb-sep">/</span>`;
        folderChain.slice(0, -1).forEach(f => {
          html += `<button type="button" class="crumb-link" data-crumb-folder="${escapeHtml(f.id)}" data-folder-drop="${escapeHtml(f.id)}">${escapeHtml(f.title)}</button><span class="crumb-sep">/</span>`;
        });
      }
      crumbEl.innerHTML = html;
      crumbEl.querySelectorAll('.crumb-link').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.crumbAction === 'projects') {
            state.activeFolderId = null;
            state.viewType = 'space';
            state.activeSpaceId = 'projects';
            state.activeProjectId = null;
            renderAll();
          } else if (btn.dataset.crumbAction === 'root-project') {
            state.activeFolderId = null;
            state.giantWallPanX = 0;
            state.giantWallPanY = 0;
            renderAll();
          } else if (btn.dataset.crumbFolder) {
            state.activeFolderId = btn.dataset.crumbFolder;
            state.giantWallPanX = 0;
            state.giantWallPanY = 0;
            renderAll();
          }
        });
      });
    }

    if (titleEl) {
      const activeFolder = folderChain.length > 0 ? folderChain[folderChain.length - 1] : null;
      titleEl.textContent = activeFolder ? activeFolder.title : obj.title;
    }
  } else {
    state.activeFolderId = null;
    const fallbackCode = obj.code || '01';
    if (codeEl) codeEl.textContent = fallbackCode;
    if (backBtn) backBtn.hidden = true;
    if (crumbEl) {
      crumbEl.hidden = true;
      crumbEl.innerHTML = '';
    }
    if (titleEl) titleEl.textContent = obj.title;
  }

  const mode = ui.layoutMode || 'wall';

  // Show Sphere button on Studio Projects and Incubator
  if (btnViewSphere) {
    btnViewSphere.hidden = !(type === 'space' && (obj.id === 'projects' || obj.id === 'incubator'));
  }

  // Hide view switcher group on Drive & PSD Assets (Eagle-only), Tool Dock, and Customize
  if (hudViewModeGroup) {
    hudViewModeGroup.hidden = (type === 'space' && ['gdrive_assets', 'tool_dock', 'customize'].includes(obj.id));
  }

  // Milanote / Miro Creation Rail (on the Right): shown across Creative Studio & Moving Forward, NEVER in Drive & PSD Assets, Tool Dock, Customize, or Sphere mode
  const showMilanoteRail = (
    mode !== 'sphere' && (
      type === 'project' ||
      (type === 'space' && ['projects', 'incubator', 'instagram', 'website', 'residencies', 'work_apps', 'dream_clients'].includes(obj.id))
    )
  );
  if (railEl) {
    railEl.hidden = !showMilanoteRail;
  }
  if (!showMilanoteRail) {
    const morePop = document.getElementById('milanoteMorePopover');
    if (morePop) morePop.hidden = true;
  }
  const appShellEl = document.getElementById('appShell');
  if (appShellEl) {
    appShellEl.classList.toggle('has-milanote-rail', showMilanoteRail);
  }

  const isSpatialBoard = (
    mode === 'sphere' ||
    (type === 'project' && (mode === 'wall' || mode === 'giant_wall')) ||
    (type === 'space' && (obj.id === 'projects' || obj.id === 'incubator') && (mode === 'wall' || mode === 'giant_wall' || mode === 'sphere')) ||
    mode === 'giant_wall'
  );
  if (mainStage) {
    mainStage.classList.toggle('is-canvas-mode', isSpatialBoard);
  }

  ['btnViewSphere', 'btnViewGiantWall', 'btnViewWall', 'btnViewList', 'btnViewKanban'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('active', b.dataset.mode === mode);
  });

  // Sync HUD Scale / Zoom Slider
  const hudDensityPill = document.getElementById('hudDensityPill');
  if (hudDensityPill) {
    hudDensityPill.hidden = (type === 'space' && obj.id === 'customize');
  }
  const sizeSlider = document.getElementById('sizeSlider');
  if (sizeSlider) {
    if (isSpatialBoard) {
      const cam = getActiveBoardCamera();
      sizeSlider.value = String(Math.round(Math.max(150, Math.min(520, (cam.zoom || 1) * 260))));
    } else {
      sizeSlider.value = String(ui.cardSize || 260);
    }
  }

  // Sync IG Status Filter Pill (ONLY shown in Creative Studio spaces & Project boards)
  const igFilterBar = document.getElementById('igStatusFilterBar');
  const showIgFilter = (
    type === 'project' ||
    (type === 'space' && ['projects', 'incubator', 'instagram', 'website'].includes(obj.id))
  );
  if (igFilterBar) {
    igFilterBar.hidden = !showIgFilter;
    if (!showIgFilter && state.igStatusFilter && state.igStatusFilter !== 'all') {
      state.igStatusFilter = 'all';
    }
    igFilterBar.querySelectorAll('.ig-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.igFilter === (state.igStatusFilter || 'all'));
    });
  }

  const btnSectionDesign = document.getElementById('btnSectionDesign');
  if (btnSectionDesign) btnSectionDesign.classList.toggle('active', state.sectionDrawerOpen);

  const btnTheme = document.getElementById('btnThemeToggle');
  if (btnTheme) {
    const preset = (vault.customization && vault.customization.themePreset) ? vault.customization.themePreset : 'warm_gallery';
    const isDark = preset.includes('dark') || preset.includes('oled');
    btnTheme.textContent = isDark ? '☀ Switch to Light Theme' : '☾ Switch to Dark Theme';
  }
}

function renderFilterActionRow() {
  const row = document.getElementById('filterActionRow');
  if (!row) return;

  const { type, obj } = getActiveContainer();

  // Hide filter bar on 09 Customize view
  if (type === 'space' && obj.id === 'customize') {
    row.innerHTML = '';
    row.style.display = 'none';
    return;
  }
  row.style.display = 'inline-flex';

  const list = type === 'project' ? (obj.sections || ['All']) : (obj.categories || ['All']);
  if (!list.includes(state.activeCategory)) {
    state.activeCategory = list[0] || 'All';
  }

  const pillsHtml = list.map((cat, idx) => {
    const count = getCategoryCount(type, obj, cat, idx === 0);
    const isActive = state.activeCategory === cat;
    const shortCat = cat
      .replace(/^All\s+.*/, 'All')
      .replace('VJ & Club Visuals', 'VJ')
      .replace('3D & Motion', '3D')
      .replace('Graphic Design', 'Design');
    return `
      <button type="button" class="filter-pill ${isActive ? 'active' : ''}" data-cat="${escapeHtml(cat)}" title="${escapeHtml(cat)} (${count}) • Click to filter • Double-click to rename">
        <span>${escapeHtml(shortCat)}</span>
        <span class="filter-pill-count">${count}</span>
      </button>
    `;
  }).join('');

  const isGDriveAssets = type === 'space' && obj.id === 'gdrive_assets';
  const isProjectsSpace = type === 'space' && obj.id === 'projects';
  const deliveredCount = isProjectsSpace ? vault.projects.filter(p => p.lifecycleState === 'delivered').length : 0;
  const lcFilter = state.projectsLifecycleFilter || 'active';

  const lifecycleInlineHtml = isProjectsSpace && deliveredCount > 0 ? `
    <span class="quiet-sep">·</span>
    <button type="button" class="filter-pill ${lcFilter === 'delivered' ? 'active' : ''}" id="btnToggleDeliveredInline" title="Toggle Delivered / Archived Projects">
      <span>Delivered</span>
      <span class="filter-pill-count">${deliveredCount}</span>
    </button>
  ` : '';

  row.innerHTML = `
    <div class="pills-scroll-row" id="pillsContainer" style="display:inline-flex;align-items:center;gap:2px;">
      ${pillsHtml}
      ${lifecycleInlineHtml}
      ${!isGDriveAssets ? `<button type="button" class="filter-pill" id="btnAddCategoryTab" title="Add Tab">+</button>` : ''}
      ${isGDriveAssets ? `<button type="button" class="filter-pill" id="btnOpenGDriveRoot" title="Open Google Drive Root in Finder">↗</button>` : ''}
    </div>
  `;

  const delivBtn = document.getElementById('btnToggleDeliveredInline');
  if (delivBtn) {
    delivBtn.addEventListener('click', () => {
      state.projectsLifecycleFilter = (state.projectsLifecycleFilter === 'delivered') ? 'active' : 'delivered';
      renderWorkspace();
      renderFilterActionRow();
    });
  }

  // Bind filter pill clicks & double-click rename
  row.querySelectorAll('.filter-pill[data-cat]').forEach(btn => {
    const catName = btn.dataset.cat;
    btn.addEventListener('click', () => {
      state.activeCategory = catName;
      renderWorkspace();
      renderFilterActionRow();
    });
    btn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      promptInlineRename(btn, catName, (newVal) => {
        const clean = newVal.trim();
        if (!clean || clean === catName) return;
        const arr = type === 'project' ? obj.sections : obj.categories;
        const i = arr.indexOf(catName);
        if (i !== -1) arr[i] = clean;
        if (type === 'project') {
          vault.items.forEach(it => {
            if (it.parentType === 'project' && it.parentId === obj.id && it.section === catName) it.section = clean;
          });
        } else if (obj.id === 'projects') {
          vault.projects.forEach(p => { if (p.category === catName) p.category = clean; });
        } else {
          vault.items.forEach(it => {
            if (it.parentType === 'space' && it.parentId === obj.id && it.section === catName) it.section = clean;
          });
        }
        state.activeCategory = clean;
        saveVault();
        renderAll();
      });
    });
  });

  // Add new tab button
  const addTabBtn = document.getElementById('btnAddCategoryTab');
  if (addTabBtn) {
    addTabBtn.addEventListener('click', () => {
      promptInlineRename(addTabBtn, 'New Tab', (newVal) => {
        const clean = newVal.trim();
        if (!clean || clean === 'New Tab') return;
        const arr = type === 'project' ? (obj.sections = obj.sections || ['All']) : (obj.categories = obj.categories || ['All']);
        if (!arr.includes(clean)) arr.push(clean);
        state.activeCategory = clean;
        saveVault();
        renderAll();
      });
    });
  }

  // Google Drive buttons
  const rescanBtn = document.getElementById('btnRescanGDrive');
  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      rescanBtn.textContent = 'Scanning Drive...';
      fetchGDriveAssets(true);
    });
  }
  const openRootBtn = document.getElementById('btnOpenGDriveRoot');
  if (openRootBtn) {
    openRootBtn.addEventListener('click', async () => {
      const targetFolder = state.gdriveStats.driveRoot || '~/Library/CloudStorage/GoogleDrive-origold97@gmail.com/My Drive/ASSETS';
      try {
        await fetch('/api/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localPath: targetFolder, openFolder: true })
        });
      } catch (e) {}
    });
  }

  // Action buttons
  const newProjBtn = document.getElementById('btnNewProjectMain');
  if (newProjBtn) newProjBtn.addEventListener('click', () => openProjectModal(null));

  const upBtn = document.getElementById('btnBarUpload');
  if (upBtn) upBtn.addEventListener('click', () => document.getElementById('globalFileInput')?.click());

  const noteBtn = document.getElementById('btnBarNote');
  if (noteBtn) noteBtn.addEventListener('click', () => openQuickComposer('note'));

  const linkBtn = document.getElementById('btnBarLink');
  if (linkBtn) linkBtn.addEventListener('click', () => openQuickComposer('link'));
}

function getCategoryCount(type, obj, cat, isFirstAll) {
  if (type === 'project') {
    const all = vault.items.filter(i => i.parentType === 'project' && i.parentId === obj.id);
    if (isFirstAll) return all.length;
    return all.filter(i => i.section === cat).length;
  }
  if (obj.id === 'projects') {
    if (isFirstAll) return vault.projects.length;
    return vault.projects.filter(p => p.category === cat).length;
  }
  if (obj.id === 'gdrive_assets') {
    if (isFirstAll) return state.gdriveBatches.length || state.gdriveStats.totalBatches || 75;
    return state.gdriveBatches.filter(b => b.category === cat).length;
  }
  if (obj.id === 'tool_dock') {
    const tools = vault.toolDock?.tools || [];
    if (isFirstAll) return tools.length;
    return tools.filter(t => t.category === cat).length;
  }
  if (['residencies', 'work_apps', 'dream_clients'].includes(obj.id)) {
    const cards = (vault.pitchEngine?.cards || []).filter(c => (c.spaceId || 'residencies') === obj.id);
    if (isFirstAll) return cards.length;
    return cards.filter(c => (c.category || c.type || '') === cat).length;
  }
  const all = vault.items.filter(i => i.parentType === 'space' && i.parentId === obj.id);
  if (isFirstAll) return all.length;
  return all.filter(i => i.section === cat).length;
}

function renderSectionDesignDrawer() {
  const drawer = document.getElementById('sectionDesignDrawer');
  if (!drawer) return;
  if (!state.sectionDrawerOpen) {
    drawer.hidden = true;
    return;
  }
  drawer.hidden = false;

  const { type, obj } = getActiveContainer();
  const ui = obj.ui || {};
  const isProjectsSpace = (type === 'space' && (obj.id === 'projects' || obj.id === 'incubator'));
  const isGDrive = (type === 'space' && obj.id === 'gdrive_assets');

  drawer.innerHTML = `
    <div class="design-drawer-group">
      <span class="kicker-mono" style="color:var(--text);">SECTION UI (${escapeHtml(obj.title)}):</span>
      <label class="kicker-mono">LAYOUT</label>
      <select id="secUiLayout" class="toolbar-select" style="border:1px solid var(--border);padding:4px 8px;border-radius:4px;background:var(--surface-pill);">
        ${isGDrive ? `<option value="eagle" selected>🦅 Eagle Dense Asset Browser</option>` : `
          ${isProjectsSpace ? `<option value="sphere" ${ui.layoutMode === 'sphere' ? 'selected' : ''}>◎ 3D Sphere Stage</option>` : ''}
          <option value="giant_wall" ${ui.layoutMode === 'giant_wall' ? 'selected' : ''}>✥ Giant Wall (Freeform Spatial Board)</option>
          <option value="wall" ${ui.layoutMode === 'wall' ? 'selected' : ''}>⊞ Clear Drawers / Bento Grid</option>
          <option value="list" ${ui.layoutMode === 'list' ? 'selected' : ''}>☰ Visual List Rows</option>
          <option value="kanban" ${ui.layoutMode === 'kanban' ? 'selected' : ''}>▤ Category Columns</option>
        `}
      </select>

      <label class="kicker-mono">STAGE RATIO</label>
      <select id="secUiAspect" class="toolbar-select" style="border:1px solid var(--border);padding:4px 8px;border-radius:4px;background:var(--surface-pill);">
        <option value="16 / 10.5" ${ui.aspectRatio === '16 / 10.5' ? 'selected' : ''}>16:10 Studio Frame</option>
        <option value="4 / 3" ${ui.aspectRatio === '4 / 3' ? 'selected' : ''}>4:3 Classic</option>
        <option value="1 / 1" ${ui.aspectRatio === '1 / 1' ? 'selected' : ''}>1:1 Square Grid</option>
        <option value="4 / 5" ${ui.aspectRatio === '4 / 5' ? 'selected' : ''}>4:5 Instagram Portrait</option>
        <option value="9 / 16" ${ui.aspectRatio === '9 / 16' ? 'selected' : ''}>9:16 Vertical Reel</option>
      </select>

      <label class="kicker-mono">IMAGE FIT</label>
      <select id="secUiFit" class="toolbar-select" style="border:1px solid var(--border);padding:4px 8px;border-radius:4px;background:var(--surface-pill);">
        <option value="cover" ${ui.imageFit === 'cover' ? 'selected' : ''}>Fill Stage (Cover)</option>
        <option value="contain" ${ui.imageFit === 'contain' ? 'selected' : ''}>Show Whole Image (Contain)</option>
      </select>
    </div>

    <div class="design-drawer-group">
      <button type="button" class="outline-btn" id="btnOpenFullCustomizer">Open 09 Full Studio Customizer →</button>
      <button type="button" class="icon-chip" id="btnCloseSecDrawer" title="Close">✕</button>
    </div>
  `;

  drawer.querySelector('#secUiLayout')?.addEventListener('change', (e) => {
    obj.ui.layoutMode = e.target.value;
    saveVault();
    applyCustomizationToDOM();
    renderAll();
  });
  drawer.querySelector('#secUiAspect')?.addEventListener('change', (e) => {
    obj.ui.aspectRatio = e.target.value;
    saveVault();
    applyCustomizationToDOM();
  });
  drawer.querySelector('#secUiFit')?.addEventListener('change', (e) => {
    obj.ui.imageFit = e.target.value;
    saveVault();
    applyCustomizationToDOM();
  });
  drawer.querySelector('#btnOpenFullCustomizer')?.addEventListener('click', () => {
    state.viewType = 'space';
    state.activeSpaceId = 'customize';
    state.sectionDrawerOpen = false;
    renderAll();
  });
  drawer.querySelector('#btnCloseSecDrawer')?.addEventListener('click', () => {
    state.sectionDrawerOpen = false;
    renderHeaderAndToolbar();
    renderSectionDesignDrawer();
  });
}

/* ==========================================================================
   WORKSPACE RENDERING (SECTION-SPECIFIC VIEW ENGINES — MODULES 1–6)
   ========================================================================== */
function renderAll() {
  applyCustomizationToDOM();
  renderSidebar();
  renderHeaderAndToolbar();
  renderFilterActionRow();
  renderSectionDesignDrawer();
  renderWorkspace();
  renderCompareFloatingBar();
}

function renderWorkspace() {
  const ws = document.getElementById('workspace');
  if (!ws) return;

  const { type, obj } = getActiveContainer();

  if (type === 'space' && obj.id === 'customize') {
    renderCustomizeView(ws);
    return;
  }

  if (type === 'space' && obj.id === 'tool_dock') {
    renderToolDockAndRdLab(ws, obj);
    return;
  }

  if (type === 'space' && ['residencies', 'work_apps', 'dream_clients'].includes(obj.id)) {
    renderOutreachPitchEngine(ws, obj);
    return;
  }

  if (type === 'space' && obj.id === 'gdrive_assets') {
    renderGDriveAssetsView(ws, obj);
    return;
  }

  if (type === 'space' && obj.id === 'projects') {
    renderProjectsOverview(ws, obj);
    return;
  }

  renderItemsCollection(ws, type, obj);
}

/* ==========================================================================
   SOOT-INSPIRED TACTILE SPHERICAL BATCH STAGE & SPATIAL ZOOM HUD
   - Inner Sphere (0%–60% radius, Golden-Angle Phyllotaxis Spiral): Images, Videos, 3D Renders, PSDs
   - Outer Circle Layer (79% radius, Circumference Ring): Notes, Checklists, Links, Mac Paths, Audio
   - Proximity Fisheye Hover: Smoothly magnifies cluster under cursor + pops target file up to 2.35x
   - Spatial Zoom-In (Wheel/Pinch/Click): Spreads files spatially & displays Frosted-Glass Attached Note Card
   ========================================================================== */
function renderSphericalStage(ws, batches, stageConfig = {}) {
  if (!batches || batches.length === 0) {
    ws.innerHTML = `
      <div class="sphere-stage-viewport">
        <div style="text-align:center;padding:48px;">
          <div class="kicker-mono">EMPTY SPHERICAL STAGE</div>
          <p class="typewriter" style="font-size:12.5px;color:var(--text-mid);margin-top:6px;">Drop images, videos, notes, or links anywhere to form a spherical batch.</p>
        </div>
      </div>
    `;
    return;
  }

  // Clamp active sphere index
  if (typeof state.sphereActiveIndex !== 'number' || state.sphereActiveIndex < 0 || state.sphereActiveIndex >= batches.length) {
    state.sphereActiveIndex = 0;
  }

  const isMultiGrid = state.sphereViewStyle === 'grid' && batches.length > 1;
  const activeBatch = batches[state.sphereActiveIndex] || batches[0];

  const viewport = document.createElement('div');
  viewport.className = 'sphere-stage-viewport';

  if (isMultiGrid) {
    const multiGrid = document.createElement('div');
    multiGrid.className = 'spheres-multi-grid';
    batches.forEach((b, idx) => {
      const orbEl = buildSingleSphereOrb(b, idx, false, stageConfig);
      multiGrid.appendChild(orbEl);
    });
    viewport.appendChild(multiGrid);
  } else {
    // Constellation Hero Stage (Center Hero Sphere + Peripheral Satellite Spheres + Camera Zoom/Pan World)
    const cameraWorld = document.createElement('div');
    cameraWorld.className = 'sphere-camera-world';

    // Peripheral Satellite Spheres (like the surrounding clusters on spiral.soot.com)
    const satellitePositions = [
      { left: '8%', top: '22%' },
      { left: '92%', top: '22%' },
      { left: '8%', top: '71%' },
      { left: '92%', top: '70%' }
    ];

    let satSlot = 0;
    batches.forEach((b, idx) => {
      if (idx === state.sphereActiveIndex) return;
      if (satSlot >= satellitePositions.length) return;
      const pos = satellitePositions[satSlot++];
      const satEl = buildSatelliteSphereEl(b, idx, pos, stageConfig);
      cameraWorld.appendChild(satEl);
    });

    // Hero Center Sphere Orb
    const heroOrb = buildSingleSphereOrb(activeBatch, state.sphereActiveIndex, true, stageConfig);
    cameraWorld.appendChild(heroOrb);
    viewport.appendChild(cameraWorld);

    // Apply current zoom & pan transform
    const updateCameraTransform = () => {
      const z = state.sphereZoom || 1;
      const px = state.spherePanX || 0;
      const py = state.spherePanY || 0;
      cameraWorld.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) scale(${z.toFixed(3)})`;
      viewport.classList.toggle('is-zoomed-in', z > 1.12);
      const zoomBtn = viewport.querySelector('#sphereZoomPctBtn');
      if (zoomBtn) zoomBtn.textContent = `${Math.round(z * 100)}%`;

      // Update mini-map radar viewport box
      const radarVp = viewport.querySelector('#minimapRadarViewport');
      if (radarVp) {
        const wPct = Math.min(100, Math.max(22, 64 / z));
        const hPct = Math.min(100, Math.max(22, 64 / z));
        const cx = 50 - (px / 18);
        const cy = 50 - (py / 18);
        radarVp.style.width = `${wPct.toFixed(1)}%`;
        radarVp.style.height = `${hPct.toFixed(1)}%`;
        radarVp.style.left = `${Math.max(4, Math.min(96 - wPct, cx - wPct / 2)).toFixed(1)}%`;
        radarVp.style.top = `${Math.max(4, Math.min(96 - hPct, cy - hPct / 2)).toFixed(1)}%`;
      }

      // Trigger spatial spread update inside hero orb when zoomed in
      if (heroOrb._updateSpatialPositions) {
        heroOrb._updateSpatialPositions();
      }
    };

    // Wheel / Trackpad Pinch Zoom & Pan on Stage
    viewport.addEventListener('wheel', (e) => {
      if (e.target.closest('.spatial-attached-hud') || e.target.closest('.sphere-stage-switcher-bar')) {
        return;
      }
      e.preventDefault();
      const zoomFactor = e.ctrlKey ? -e.deltaY * 0.012 : -e.deltaY * 0.0022;
      const nextZoom = Math.min(3.5, Math.max(0.75, (state.sphereZoom || 1) + zoomFactor));
      state.sphereZoom = nextZoom;
      if (nextZoom <= 1.04) {
        state.spherePanX *= 0.82;
        state.spherePanY *= 0.82;
      }
      updateCameraTransform();
    }, { passive: false });

    // Click-and-drag panning on stage background using Pointer Capture (no global window listener leak)
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let origPanX = 0;
    let origPanY = 0;

    viewport.addEventListener('pointerdown', (e) => {
      if (
        e.button !== 0 ||
        e.target.closest('.sphere-node') ||
        e.target.closest('.spatial-attached-hud') ||
        e.target.closest('.sphere-bottom-capsule') ||
        e.target.closest('.sphere-stage-switcher-bar') ||
        e.target.closest('.satellite-sphere')
      ) {
        return;
      }
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      origPanX = state.spherePanX || 0;
      origPanY = state.spherePanY || 0;
      try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      state.spherePanX = origPanX + dx;
      state.spherePanY = origPanY + dy;
      updateCameraTransform();
    });

    const endSpherePan = (e) => {
      if (!isPanning) return;
      isPanning = false;
      try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    viewport.addEventListener('pointerup', endSpherePan);
    viewport.addEventListener('pointercancel', endSpherePan);

    // Clicking empty background unlocks focused node if clicked without dragging
    viewport.addEventListener('click', (e) => {
      if (
        !e.target.closest('.sphere-node') &&
        !e.target.closest('.spatial-attached-hud') &&
        !e.target.closest('.sphere-stage-switcher-bar') &&
        state.sphereLockedNodeId
      ) {
        state.sphereLockedNodeId = null;
        if (heroOrb._refreshAttachedHud) heroOrb._refreshAttachedHud(null);
        if (heroOrb._updateSpatialPositions) heroOrb._updateSpatialPositions();
      }
    });

    viewport._updateCameraTransform = updateCameraTransform;
    requestAnimationFrame(updateCameraTransform);
  }

  // Bottom Floating Sphere Switcher Strip + Clean Zoom Controls
  const switcherBar = document.createElement('div');
  switcherBar.className = 'sphere-stage-switcher-bar';

  if (batches.length > 1) {
    const viewToggleBtn = document.createElement('button');
    viewToggleBtn.type = 'button';
    viewToggleBtn.className = `sphere-switch-pill ${isMultiGrid ? 'active' : ''}`;
    viewToggleBtn.title = isMultiGrid ? 'Switch to Hero Sphere + Satellites Constellation' : 'Show All Spheres Side-by-Side';
    viewToggleBtn.innerHTML = isMultiGrid ? `◎ Hero Sphere` : `⊞ All Spheres (${batches.length})`;
    viewToggleBtn.addEventListener('click', () => {
      state.sphereViewStyle = isMultiGrid ? 'constellation' : 'grid';
      state.sphereZoom = 1;
      state.spherePanX = 0;
      state.spherePanY = 0;
      renderWorkspace();
    });
    switcherBar.appendChild(viewToggleBtn);
  }

  batches.slice(0, 12).forEach((b, idx) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `sphere-switch-pill ${!isMultiGrid && idx === state.sphereActiveIndex ? 'active' : ''}`;
    const totalCount = (b.visualNodes?.length || 0) + (b.outerNodes?.length || 0);
    pill.innerHTML = `
      <span class="pill-dot"></span>
      <span>${escapeHtml(b.code || ('#' + String(idx + 1).padStart(2, '0')))} ${escapeHtml(b.title.length > 22 ? b.title.slice(0, 22) + '…' : b.title)}</span>
      <span style="opacity:0.62;">(${totalCount})</span>
    `;
    pill.addEventListener('click', () => {
      state.sphereActiveIndex = idx;
      state.sphereViewStyle = 'constellation';
      state.sphereLockedNodeId = null;
      state.sphereZoom = 1;
      state.spherePanX = 0;
      state.spherePanY = 0;
      renderWorkspace();
    });
    switcherBar.appendChild(pill);
  });

  if (!isMultiGrid) {
    const zoomCluster = document.createElement('div');
    zoomCluster.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding-left:8px;border-left:1px solid var(--border);';
    zoomCluster.innerHTML = `
      <button type="button" class="sphere-switch-pill" id="btnSphereZoomOut" title="Zoom Out">−</button>
      <button type="button" class="sphere-switch-pill" id="sphereZoomPctBtn" title="Toggle Zoom">${Math.round((state.sphereZoom || 1) * 100)}%</button>
      <button type="button" class="sphere-switch-pill" id="btnSphereZoomIn" title="Zoom In">+</button>
      <button type="button" class="sphere-switch-pill" id="btnSphereZoomReset" title="Reset Camera">Reset</button>
    `;
    zoomCluster.querySelector('#btnSphereZoomOut')?.addEventListener('click', () => {
      state.sphereZoom = Math.max(0.75, (state.sphereZoom || 1) - 0.3);
      if (state.sphereZoom <= 1.05) { state.spherePanX = 0; state.spherePanY = 0; }
      viewport._updateCameraTransform?.();
    });
    zoomCluster.querySelector('#btnSphereZoomIn')?.addEventListener('click', () => {
      state.sphereZoom = Math.min(3.5, (state.sphereZoom || 1) + 0.35);
      viewport._updateCameraTransform?.();
    });
    zoomCluster.querySelector('#sphereZoomPctBtn')?.addEventListener('click', () => {
      if ((state.sphereZoom || 1) > 1.3) {
        state.sphereZoom = 1;
        state.spherePanX = 0;
        state.spherePanY = 0;
      } else {
        state.sphereZoom = 1.75;
      }
      viewport._updateCameraTransform?.();
    });
    zoomCluster.querySelector('#btnSphereZoomReset')?.addEventListener('click', () => {
      state.sphereZoom = 1;
      state.spherePanX = 0;
      state.spherePanY = 0;
      state.sphereLockedNodeId = null;
      const heroOrb = viewport.querySelector('.spherical-batch-orb');
      heroOrb?._refreshAttachedHud?.(null);
      viewport._updateCameraTransform?.();
    });
    switcherBar.appendChild(zoomCluster);
  }

  viewport.appendChild(switcherBar);

  ws.innerHTML = '';
  ws.appendChild(viewport);
}

function buildSatelliteSphereEl(batch, idx, pos, stageConfig) {
  const sat = document.createElement('div');
  sat.className = 'satellite-sphere';
  sat.style.left = pos.left;
  sat.style.top = pos.top;
  sat.title = `Click to bring "${batch.title}" to Center Sphere Stage`;

  const visuals = (batch.visualNodes || []).slice(0, 16);

  const goldenAngle = 2.399963229728653;
  const total = Math.max(1, visuals.length);
  const maxSatRadius = total <= 3 ? 18 : (total <= 7 ? 24 : 31);

  const thumbsHtml = visuals.map((v, i) => {
    const rPct = total === 1 ? 0 : Math.sqrt((i + 0.42) / total) * maxSatRadius;
    const theta = i * goldenAngle;
    const xPct = 50 + Math.cos(theta) * rPct;
    const yPct = 50 + Math.sin(theta) * rPct;
    return `
      <div class="sat-mini-thumb" style="left:${xPct.toFixed(1)}%;top:${yPct.toFixed(1)}%;">
        <img src="${escapeHtml(v.thumbSrc || v.url)}" alt="" loading="lazy">
      </div>
    `;
  }).join('');

  const totalFiles = (batch.visualNodes?.length || 0) + (batch.outerNodes?.length || 0);
  sat.innerHTML = `
    ${thumbsHtml}
    <div class="satellite-sphere-label" data-editable-title="1" title="Double-click to rename">${escapeHtml(batch.code || ('#' + String(idx + 1).padStart(2, '0')))} ${escapeHtml(batch.title.slice(0, 18))} (${totalFiles})</div>
  `;

  const satLbl = sat.querySelector('.satellite-sphere-label');
  satLbl?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    promptInlineRename(satLbl, batch.title, (newVal) => {
      if (newVal.trim() && batch.onRename) {
        batch.onRename(newVal.trim());
      }
    });
  });

  sat.addEventListener('click', (e) => {
    if (e.target.closest('.inline-rename-field')) return;
    e.stopPropagation();
    state.sphereActiveIndex = idx;
    state.sphereLockedNodeId = null;
    state.sphereZoom = 1;
    state.spherePanX = 0;
    state.spherePanY = 0;
    renderWorkspace();
  });

  return sat;
}

function buildSingleSphereOrb(batch, idx, isHeroStage, stageConfig = {}) {
  const orb = document.createElement('div');
  orb.className = 'spherical-batch-orb';
  if (!isHeroStage) {
    orb.style.setProperty('--sphere-diameter', '490px');
  }

  const visualNodes = batch.visualNodes || [];
  const outerNodes = batch.outerNodes || [];
  const totalCount = batch.totalCountOverride || (visualNodes.length + outerNodes.length);

  orb.innerHTML = `
    <div class="sphere-inner-divider-ring" title="Inner Core: Visual Files • Outer Ring: Notes, Links & Checklists"></div>

    <!-- BOTTOM SCULPTED CAPSULE: Batch Title, Count & Open Board Action -->
    <div class="sphere-bottom-capsule" title="Click title to rename • Click Open Board to enter">
      <span class="capsule-kicker">${escapeHtml(batch.code || ('#' + String(idx + 1).padStart(2, '0')))} · ${totalCount} items</span>
      <span class="capsule-title-row" style="display:inline-flex;align-items:center;gap:6px;">
        <span class="capsule-title" data-editable-title="1" title="Click to rename">${escapeHtml(batch.title)}</span>
        ${batch.onRename ? `<button type="button" class="capsule-edit-pen" title="Rename title">✎</button>` : ''}
      </span>
      <span class="capsule-sub" style="display:inline-flex;align-items:center;gap:8px;">
        <span>${visualNodes.length} visuals · ${outerNodes.length} notes/links</span>
        ${(batch.onPrimaryOpen || batch.onPrimaryAction) ? `<button type="button" class="btn-sphere-open-board" style="background:var(--text);color:var(--bg);border:none;border-radius:999px;padding:2px 9px;font-size:10px;font-weight:600;cursor:pointer;">Open Board →</button>` : ''}
      </span>
    </div>

    <!-- NODES LAYER (Inner Visual Spiral + Outer Note/Link Ring) -->
    <div class="sphere-nodes-container" style="position:absolute;inset:0;pointer-events:none;"></div>

    <!-- ATTACHED FROSTED-GLASS FILE NOTE & LINK HUD (Positioned beside focused file) -->
    <div class="spatial-attached-hud" hidden></div>
  `;

  const nodesContainer = orb.querySelector('.sphere-nodes-container');
  const attachedHud = orb.querySelector('.spatial-attached-hud');
  const allPlacedNodes = [];

  // 1. Place ONLY the real visual files (1:1 — never duplicate/clone uploaded files)
  const displayVisualNodes = visualNodes.slice(0, 60);
  const totalVisuals = Math.max(1, displayVisualNodes.length);

  // Adaptive tile size & spiral radius based on how many real files are in this batch
  if (totalVisuals <= 4) {
    orb.style.setProperty('--node-w-land', '114px');
    orb.style.setProperty('--node-h-land', '82px');
    orb.style.setProperty('--node-w-sq', '96px');
    orb.style.setProperty('--node-h-sq', '96px');
    orb.style.setProperty('--node-w-port', '82px');
    orb.style.setProperty('--node-h-port', '112px');
  } else if (totalVisuals <= 10) {
    orb.style.setProperty('--node-w-land', '78px');
    orb.style.setProperty('--node-h-land', '56px');
    orb.style.setProperty('--node-w-sq', '66px');
    orb.style.setProperty('--node-h-sq', '66px');
    orb.style.setProperty('--node-w-port', '56px');
    orb.style.setProperty('--node-h-port', '76px');
  } else if (totalVisuals <= 20) {
    orb.style.setProperty('--node-w-land', '56px');
    orb.style.setProperty('--node-h-land', '40px');
    orb.style.setProperty('--node-w-sq', '48px');
    orb.style.setProperty('--node-h-sq', '48px');
    orb.style.setProperty('--node-w-port', '40px');
    orb.style.setProperty('--node-h-port', '54px');
  }

  const goldenAngle = 2.399963229728653; // 137.508 degrees in radians
  const maxInnerRadiusPct = totalVisuals === 1 ? 0 : (totalVisuals <= 4 ? 17.5 : (totalVisuals <= 10 ? 24.5 : (totalVisuals <= 20 ? 28.5 : 31.8)));
  const spiralSlots = [];

  for (let i = 0; i < displayVisualNodes.length; i++) {
    const normR = totalVisuals === 1 ? 0 : Math.sqrt((i + 0.45) / totalVisuals);
    const rPct = normR * maxInnerRadiusPct;
    const theta = i * goldenAngle;
    const xPct = 50 + Math.cos(theta) * rPct;
    const yPct = 50 + Math.sin(theta) * rPct;
    spiralSlots.push({ xPct, yPct, rPct });
  }

  const aspectClasses = ['shape-landscape', 'shape-square', 'shape-portrait', 'shape-landscape', 'shape-portrait', 'shape-square'];

  displayVisualNodes.forEach((vn, i) => {
    const slot = spiralSlots[i] || { xPct: 50, yPct: 50 };
    const baseXPct = slot.xPct;
    const baseYPct = slot.yPct;

    const nodeEl = document.createElement('div');
    const shapeCls = vn.shapeClass || aspectClasses[i % aspectClasses.length];
    const isSel = isAssetCompareSelected(vn.id);
    const igStat = vn.igStatus || vn.vaultItem?.igStatus || '';
    nodeEl.className = `sphere-node is-visual-node ${shapeCls} ${isSel ? 'is-compare-selected' : ''}`;
    nodeEl.style.pointerEvents = 'auto';
    nodeEl.style.left = `${baseXPct.toFixed(2)}%`;
    nodeEl.style.top = `${baseYPct.toFixed(2)}%`;
    nodeEl.dataset.nodeId = vn.id;

    const isLcp = idx === 0 && i === 0;
    const prioAttr = isLcp ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
    const hasAttachedNote = Boolean((vn.notes || '').trim());

    const igBadgeHtml = igStat === 'published'
      ? `<span class="ig-status-badge is-published" title="Published (IG Live) — Click to cycle status">● IG LIVE</span>`
      : (igStat === 'queued'
          ? `<span class="ig-status-badge is-queued" title="Queued (IG Ready / Next Up) — Click to cycle status">◈ IG READY</span>`
          : '');

    const igQuickBtnHtml = vn.vaultItem ? `
      <button type="button" class="node-ig-quick-btn ${igStat === 'published' ? 'is-published' : (igStat === 'queued' ? 'is-queued' : '')}" title="1-Click Toggle IG Status (WIP → IG Ready → IG Live)">
        ${igStat === 'published' ? '●' : '◈'}
      </button>
    ` : '';

    const selectChkHtml = `
      <button type="button" class="asset-select-check ${isSel ? 'is-selected' : ''}" title="Select to Compare (1:1 Layer Stack / Split View)">✓</button>
    `;

    if (vn.kind === 'video' && vn.url) {
      nodeEl.innerHTML = `
        <video src="${escapeHtml(vn.url)}#t=0.1" preload="metadata" muted loop playsinline></video>
        <span class="node-kind-badge">▶ VID</span>
        ${selectChkHtml}
        ${igQuickBtnHtml}
        ${igBadgeHtml}
        ${hasAttachedNote ? `<span class="node-note-dot" title="Has attached note"></span>` : ''}
      `;
    } else {
      nodeEl.innerHTML = `
        <img src="${escapeHtml(vn.thumbSrc || vn.url)}" data-fallback="${escapeHtml(vn.fallbackSrc || '')}" alt="${escapeHtml(vn.title)}" ${prioAttr}>
        ${vn.badge ? `<span class="node-kind-badge">${escapeHtml(vn.badge)}</span>` : ''}
        ${selectChkHtml}
        ${igQuickBtnHtml}
        ${igBadgeHtml}
        ${hasAttachedNote ? `<span class="node-note-dot" title="Has attached note"></span>` : ''}
      `;
      const imgEl = nodeEl.querySelector('img');
      imgEl?.addEventListener('error', () => {
        const fb = imgEl.dataset.fallback;
        if (fb && imgEl.src !== fb && !imgEl.dataset.triedFb) {
          imgEl.dataset.triedFb = '1';
          imgEl.src = fb;
        }
      });
    }

    // Bind Compare multi-select checkbox on sphere node
    nodeEl.querySelector('.asset-select-check')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompareSelect({
        id: vn.id,
        title: vn.title || 'Visual',
        url: vn.url || vn.thumbSrc,
        kind: vn.kind || 'image',
        igStatus: vn.vaultItem?.igStatus || vn.igStatus || '',
        vaultItemId: vn.vaultItem?.id || null,
        notes: vn.notes || ''
      });
    });

    // Bind 1-click IG status toggle & badge click on sphere node
    nodeEl.querySelector('.node-ig-quick-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (vn.vaultItem) cycleItemIgStatus(vn.vaultItem.id);
    });
    nodeEl.querySelector('.ig-status-badge')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (vn.vaultItem) cycleItemIgStatus(vn.vaultItem.id);
    });

    nodesContainer.appendChild(nodeEl);
    allPlacedNodes.push({
      id: vn.id,
      data: vn,
      el: nodeEl,
      layer: 'inner',
      baseXPct,
      baseYPct,
      curXPct: baseXPct,
      curYPct: baseYPct
    });
  });

  // 2. Place OUTER CIRCLE LAYER Notes, Checklists, Web Links, Mac Paths & Audio along safe diagonal arcs (never colliding with top/bottom/left/right controls)
  const outerRingRadiusPct = 42.2;
  const safeOuterAnglesDeg = [-148, -44, 146, 44, -126, -62, 124, 62, -162, 162];
  outerNodes.slice(0, 10).forEach((on, i) => {
    const deg = safeOuterAnglesDeg[i % safeOuterAnglesDeg.length];
    const theta = (deg * Math.PI) / 180;

    const baseXPct = 50 + Math.cos(theta) * outerRingRadiusPct;
    const baseYPct = 50 + Math.sin(theta) * outerRingRadiusPct;

    const nodeEl = document.createElement('div');
    nodeEl.className = 'sphere-node is-outer-node';
    nodeEl.style.pointerEvents = 'auto';
    nodeEl.style.left = `${baseXPct.toFixed(2)}%`;
    nodeEl.style.top = `${baseYPct.toFixed(2)}%`;
    nodeEl.dataset.nodeId = on.id;

    let iconSym = '📝';
    let subTag = 'NOTE';
    if (on.kind === 'checklist' || (on.notes || '').includes('[ ]') || (on.notes || '').includes('[x]')) {
      iconSym = '☑';
      const done = ((on.notes || '').match(/\[x\]/gi) || []).length;
      const all = done + ((on.notes || '').match(/\[ \]/g) || []).length;
      subTag = `${done}/${all}`;
    } else if (on.kind === 'link' || on.link) {
      const isMacPath = (on.link || '').startsWith('~') || (on.link || '').startsWith('/');
      iconSym = isMacPath ? '📁' : '🌐';
      subTag = isMacPath ? 'MAC' : 'URL';
    } else if (on.kind === 'audio') {
      iconSym = '🔊';
      subTag = 'WAV';
    }

    const shortLabel = (on.title || 'Note').length > 16 ? (on.title || 'Note').slice(0, 16) + '…' : (on.title || 'Note');

    nodeEl.innerHTML = `
      <span class="outer-node-icon">${iconSym}</span>
      <span class="outer-node-label">${escapeHtml(shortLabel)}</span>
      <span class="outer-node-sub">${escapeHtml(subTag)}</span>
    `;

    nodesContainer.appendChild(nodeEl);
    allPlacedNodes.push({
      id: on.id,
      data: on,
      el: nodeEl,
      layer: 'outer',
      baseXPct,
      baseYPct,
      curXPct: baseXPct,
      curYPct: baseYPct
    });
  });

  // Helper: Render & Position the Frosted-Glass Attached Note Card + Link Pill beside the focused node (Screenshot 5!)
  const refreshAttachedHud = (targetNodeData) => {
    if (!targetNodeData) {
      attachedHud.hidden = true;
      attachedHud.innerHTML = '';
      allPlacedNodes.forEach(p => p.el.classList.remove('is-locked-focus'));
      return;
    }

    const placed = allPlacedNodes.find(p => p.id === targetNodeData.id);
    if (!placed) {
      attachedHud.hidden = true;
      return;
    }

    allPlacedNodes.forEach(p => p.el.classList.toggle('is-locked-focus', p.id === targetNodeData.id));

    // Position HUD right alongside the focused file (to the right if file is on left/center, or to the left if near right edge)
    const xPct = placed.curXPct;
    const yPct = placed.curYPct;
    const placeOnLeft = xPct > 64;
    const hudLeftPct = placeOnLeft ? Math.max(4, xPct - 36) : Math.min(68, xPct + 6.5);
    const hudTopPct = Math.max(8, Math.min(78, yPct - 6));

    attachedHud.style.left = `${hudLeftPct.toFixed(1)}%`;
    attachedHud.style.top = `${hudTopPct.toFixed(1)}%`;
    attachedHud.hidden = false;

    // Resolve note text (either from vault item or custom Google Drive note dictionary)
    const rawNote = getAttachedNoteForNode(targetNodeData);
    const hasChecklist = rawNote.includes('[ ]') || rawNote.includes('[x]') || rawNote.includes('[X]');

    // Resolve link / domain label for bottom frosted pill
    let linkLabel = '';
    if (targetNodeData.link) {
      if (targetNodeData.link.startsWith('~') || targetNodeData.link.startsWith('/')) {
        const parts = targetNodeData.link.split('/').filter(Boolean);
        linkLabel = parts.slice(-2).join('/');
      } else {
        linkLabel = targetNodeData.link.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      }
    } else if (targetNodeData.localPath) {
      const parts = targetNodeData.localPath.split('/').filter(Boolean);
      linkLabel = 'My Drive/' + parts.slice(-2).join('/');
    } else if (targetNodeData.section) {
      linkLabel = `${batch.title.slice(0, 18)} · ${targetNodeData.section}`;
    }

    const noteBodyHtml = hasChecklist
      ? `<div class="spatial-note-checklist">${renderChecklistHtml(rawNote)}</div>`
      : `
        <div
          class="spatial-note-body"
          contenteditable="true"
          spellcheck="false"
          data-placeholder="Click here to write a note or [ ] task attached to this file..."
          title="Click to edit note directly on this file"
        >${escapeHtml(rawNote)}</div>
      `;

    const curIgStat = targetNodeData.vaultItem?.igStatus || targetNodeData.igStatus || '';
    const isCmpSelected = isAssetCompareSelected(targetNodeData.id);

    attachedHud.innerHTML = `
      <!-- TOP FROSTED-GLASS NOTE CARD (Matches Screenshot 5) -->
      <div class="spatial-note-card">
        <div class="spatial-note-title" contenteditable="${targetNodeData.vaultItem ? 'true' : 'false'}" spellcheck="false" title="File Title">${escapeHtml(targetNodeData.title)}</div>
        ${noteBodyHtml}
      </div>

      <!-- BOTTOM FROSTED-GLASS LINK & ACTION PILL (Matches Screenshot 5) -->
      <div class="spatial-link-pill-row">
        ${targetNodeData.url ? `
          <button type="button" class="spatial-link-pill" id="btnHudSelectCompare" style="${isCmpSelected ? 'background:#111110;color:#FFF;' : ''}" title="Select this file for 1:1 Layer Stack / Split Comparison">
            <span>${isCmpSelected ? '✓ Selected' : '+ Compare'}</span>
          </button>
        ` : ''}
        ${targetNodeData.vaultItem && targetNodeData.url ? `
          <button type="button" class="spatial-link-pill" id="btnHudIgQueued" style="${curIgStat === 'queued' ? 'background:#D97706;color:#FFF;' : ''}" title="Flag as Queued (IG Ready / Next Up)">
            <span>◈ IG Ready</span>
          </button>
          <button type="button" class="spatial-link-pill" id="btnHudIgPublished" style="${curIgStat === 'published' ? 'background:#10B981;color:#FFF;' : ''}" title="Flag as Published (IG Live)">
            <span>● IG Live</span>
          </button>
        ` : ''}
        ${(targetNodeData.link || targetNodeData.localPath) ? `
          <button type="button" class="spatial-link-pill" id="btnHudOpenLink" title="Open Link or Reveal in macOS Finder">
            <span class="pill-arrow">↗</span>
            <span>${escapeHtml(linkLabel || 'Open Reference')}</span>
          </button>
        ` : ''}
        ${targetNodeData.url ? `
          <a href="${escapeHtml(targetNodeData.url)}" download class="spatial-link-pill" title="Download Uncompressed Original File">
            <span class="pill-arrow">↓</span>
            <span>Original</span>
          </a>
        ` : ''}
        <button type="button" class="spatial-link-pill" id="btnHudAddChecklist" title="Append a [ ] checkbox task to this file's note">
          <span>+ [ ] Task</span>
        </button>
        ${targetNodeData.vaultItem ? `
          <button type="button" class="spatial-link-pill" id="btnHudFullInspect" title="Open Full Studio Inspector Modal">
            <span>⤢ Inspect</span>
          </button>
        ` : ''}
      </div>
    `;

    // Inline note editing directly inside the frosted-glass card!
    const noteBodyEl = attachedHud.querySelector('.spatial-note-body');
    if (noteBodyEl) {
      noteBodyEl.addEventListener('click', (e) => e.stopPropagation());
      noteBodyEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') noteBodyEl.blur();
      });
      noteBodyEl.addEventListener('blur', () => {
        const updatedText = noteBodyEl.innerText.trim();
        saveAttachedNoteForNode(targetNodeData, updatedText);
      });
    }

    // Inline title editing
    const titleEl = attachedHud.querySelector('.spatial-note-title');
    if (titleEl && targetNodeData.vaultItem) {
      titleEl.addEventListener('click', (e) => e.stopPropagation());
      titleEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
      });
      titleEl.addEventListener('blur', () => {
        const newT = titleEl.innerText.trim();
        if (newT && targetNodeData.vaultItem) {
          targetNodeData.vaultItem.title = newT;
          targetNodeData.title = newT;
          saveVault('SAVED FILE TITLE');
        }
      });
    }

    // Interactive checkboxes inside the frosted-glass note card
    attachedHud.querySelectorAll('.chk-row input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const lineIdx = parseInt(chk.dataset.line, 10);
        if (targetNodeData.vaultItem) {
          toggleChecklistLine(targetNodeData.vaultItem.id, lineIdx);
          targetNodeData.notes = targetNodeData.vaultItem.notes;
          refreshAttachedHud(targetNodeData);
        }
      });
    });

    // + [ ] Task button appends a checkbox line to this file's attached note
    attachedHud.querySelector('#btnHudAddChecklist')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = getAttachedNoteForNode(targetNodeData);
      const next = (cur ? cur + '\n' : '') + '[ ] Follow-up studio step';
      saveAttachedNoteForNode(targetNodeData, next);
      refreshAttachedHud(targetNodeData);
    });

    // Open Link or Reveal in Finder button
    attachedHud.querySelector('#btnHudOpenLink')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (targetNodeData.localPath) {
        openUrlOrMacPath(targetNodeData.localPath);
      } else if (targetNodeData.link) {
        openUrlOrMacPath(targetNodeData.link);
      }
    });

    // Full Inspect modal button
    attachedHud.querySelector('#btnHudFullInspect')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (targetNodeData.vaultItem) {
        openItemInspector(targetNodeData.vaultItem.id);
      }
    });

    // Compare select toggle inside HUD
    attachedHud.querySelector('#btnHudSelectCompare')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompareSelect({
        id: targetNodeData.id,
        title: targetNodeData.title || 'Visual',
        url: targetNodeData.url || targetNodeData.thumbSrc,
        kind: targetNodeData.kind || 'image',
        igStatus: targetNodeData.vaultItem?.igStatus || targetNodeData.igStatus || '',
        vaultItemId: targetNodeData.vaultItem?.id || null,
        notes: targetNodeData.notes || ''
      });
    });

    // 1-Click IG Ready & IG Live pills inside HUD
    attachedHud.querySelector('#btnHudIgQueued')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (targetNodeData.vaultItem) {
        const next = targetNodeData.vaultItem.igStatus === 'queued' ? '' : 'queued';
        setItemIgStatus(targetNodeData.vaultItem.id, next);
      }
    });

    attachedHud.querySelector('#btnHudIgPublished')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (targetNodeData.vaultItem) {
        const next = targetNodeData.vaultItem.igStatus === 'published' ? '' : 'published';
        setItemIgStatus(targetNodeData.vaultItem.id, next);
      }
    });
  };

  orb._refreshAttachedHud = refreshAttachedHud;

  // Spatial Spread + Proximity Fisheye Magnification Engine
  let pointerXPct = null;
  let pointerYPct = null;

  const updateSpatialPositions = () => {
    const zoom = isHeroStage ? (state.sphereZoom || 1) : 1;
    // As you zoom in past 1.0x, spread the files spatially outward so they breathe across the canvas like Screenshot 5
    const zoomSpread = 1 + Math.max(0, zoom - 1) * 0.58;

    let closestNode = null;
    let minDist = Infinity;

    if (pointerXPct !== null && pointerYPct !== null) {
      allPlacedNodes.forEach(n => {
        const sx = 50 + (n.baseXPct - 50) * zoomSpread;
        const sy = 50 + (n.baseYPct - 50) * zoomSpread;
        const d = Math.hypot(pointerXPct - sx, pointerYPct - sy);
        if (d < minDist) {
          minDist = d;
          closestNode = n;
        }
      });
    }

    const fisheyeRadiusPct = 25; // ~162px on a 650px sphere

    allPlacedNodes.forEach(n => {
      const spreadX = 50 + (n.baseXPct - 50) * zoomSpread;
      const spreadY = 50 + (n.baseYPct - 50) * zoomSpread;

      let tx = spreadX;
      let ty = spreadY;
      let scale = 1;
      let zIdx = n.layer === 'outer' ? 28 : 20;

      // Locked focus node stays prominently enlarged
      const isLocked = state.sphereLockedNodeId === n.id;

      if (pointerXPct !== null && pointerYPct !== null) {
        const dx = spreadX - pointerXPct;
        const dy = spreadY - pointerYPct;
        const dist = Math.hypot(dx, dy);

        if (dist < fisheyeRadiusPct) {
          const factor = 1 - (dist / fisheyeRadiusPct); // 0..1
          const eased = factor * factor * (3 - 2 * factor);

          if (n === closestNode && dist < 11.5) {
            // The exact file under your cursor pops up dramatically
            scale = n.layer === 'outer' ? 1.32 : 2.32;
            zIdx = 145;
          } else {
            // Neighboring batch files enlarge and push gently outward so nothing is hidden
            scale = 1 + eased * (n.layer === 'outer' ? 0.22 : 0.78);
            const pushPct = eased * 3.8;
            const angle = Math.atan2(dy, dx);
            tx += Math.cos(angle) * pushPct;
            ty += Math.sin(angle) * pushPct;
            zIdx = Math.round(45 + eased * 60);
          }
        }
      }

      if (isLocked) {
        scale = Math.max(scale, n.layer === 'outer' ? 1.28 : 1.95);
        zIdx = Math.max(zIdx, 138);
      }

      n.curXPct = tx;
      n.curYPct = ty;
      n.el.style.left = `${tx.toFixed(2)}%`;
      n.el.style.top = `${ty.toFixed(2)}%`;
      n.el.style.scale = scale.toFixed(3);
      n.el.style.zIndex = String(zIdx);
      n.el.classList.toggle('is-hovered-hero', n === closestNode && minDist < 11.5);
    });

    // Update attached HUD position if locked or if hovering while zoomed in
    if (state.sphereLockedNodeId) {
      const lockedData = allPlacedNodes.find(p => p.id === state.sphereLockedNodeId)?.data;
      if (lockedData && !attachedHud.contains(document.activeElement)) {
        refreshAttachedHud(lockedData);
      }
    } else if (closestNode && minDist < 10.5) {
      refreshAttachedHud(closestNode.data);
    } else if (!attachedHud.matches(':hover') && !attachedHud.contains(document.activeElement)) {
      refreshAttachedHud(null);
    }
  };

  orb._updateSpatialPositions = updateSpatialPositions;

  // Mousemove over the sphere drives the real-time proximity fisheye lens
  orb.addEventListener('mousemove', (e) => {
    if (e.target.closest('.spatial-attached-hud')) return;
    const rect = orb.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerXPct = ((e.clientX - rect.left) / rect.width) * 100;
    pointerYPct = ((e.clientY - rect.top) / rect.height) * 100;
    updateSpatialPositions();
  });

  orb.addEventListener('mouseleave', () => {
    pointerXPct = null;
    pointerYPct = null;
    updateSpatialPositions();
  });

  // Node click behavior:
  // - Single click locks focus onto that file, zooms in smoothly if not yet zoomed so you see its attached note & link pill clearly!
  // - Clicking an already-focused file (or Double-clicking) opens the full Inspector / Finder / Link.
  allPlacedNodes.forEach(placed => {
    placed.el.addEventListener('click', (e) => {
      e.stopPropagation();

      // If this orb is in the multi-grid view, switch to Hero Constellation focused on this file
      if (!isHeroStage) {
        state.sphereActiveIndex = idx;
        state.sphereViewStyle = 'constellation';
        state.sphereLockedNodeId = placed.id;
        state.sphereZoom = 1.85;
        renderWorkspace();
        return;
      }

      if (state.sphereLockedNodeId === placed.id) {
        // Second click on the already-focused node opens full view or reveals in Finder
        if (placed.data.vaultItem) {
          openItemInspector(placed.data.vaultItem.id);
        } else if (placed.data.localPath) {
          openUrlOrMacPath(placed.data.localPath);
        } else if (placed.data.link) {
          openUrlOrMacPath(placed.data.link);
        }
        return;
      }

      state.sphereLockedNodeId = placed.id;
      if ((state.sphereZoom || 1) < 1.45) {
        state.sphereZoom = 1.75;
      }
      // Gently center camera toward the clicked node when zoomed in
      state.spherePanX = (50 - placed.baseXPct) * 3.2;
      state.spherePanY = (50 - placed.baseYPct) * 3.2;

      const viewport = orb.closest('.sphere-stage-viewport');
      if (viewport && viewport._updateCameraTransform) {
        viewport._updateCameraTransform();
      } else {
        updateSpatialPositions();
      }
      refreshAttachedHud(placed.data);
    });
  });

  const capTitleEl = orb.querySelector('.capsule-title');
  const capPenBtn = orb.querySelector('.capsule-edit-pen');
  const triggerCapsuleRename = (e) => {
    e.stopPropagation();
    if (!batch.onRename || !capTitleEl) return;
    promptInlineRename(capTitleEl, batch.title, (newVal) => {
      if (newVal.trim()) batch.onRename(newVal.trim());
    });
  };
  capPenBtn?.addEventListener('click', triggerCapsuleRename);
  capTitleEl?.addEventListener('click', triggerCapsuleRename);

  orb.querySelector('.btn-sphere-open-board')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (batch.onPrimaryOpen) batch.onPrimaryOpen();
    else if (batch.onPrimaryAction) batch.onPrimaryAction();
  });

  orb.querySelector('.sphere-bottom-capsule')?.addEventListener('click', (e) => {
    if (e.target.closest('.inline-rename-field') || e.target.closest('.capsule-edit-pen') || e.target.closest('.capsule-title')) return;
    e.stopPropagation();
    if (batch.onPrimaryOpen) batch.onPrimaryOpen();
    else if (batch.onPrimaryAction) batch.onPrimaryAction();
  });

  // If a node is already locked on boot/render, show its attached note HUD
  if (isHeroStage && state.sphereLockedNodeId) {
    const locked = allPlacedNodes.find(p => p.id === state.sphereLockedNodeId);
    if (locked) {
      requestAnimationFrame(() => refreshAttachedHud(locked.data));
    }
  }

  return orb;
}

function getAttachedNoteForNode(nodeData) {
  if (!nodeData) return '';
  if (nodeData.vaultItem) {
    return nodeData.vaultItem.notes || '';
  }
  if (nodeData.isGDrive && nodeData.localPath) {
    vault.gdriveNotes = vault.gdriveNotes || {};
    return vault.gdriveNotes[nodeData.localPath] || nodeData.notes || '';
  }
  return nodeData.notes || '';
}

function saveAttachedNoteForNode(nodeData, newNoteText) {
  if (!nodeData) return;
  nodeData.notes = newNoteText;
  if (nodeData.vaultItem) {
    nodeData.vaultItem.notes = newNoteText;
    saveVault('SAVED ATTACHED FILE NOTE');
  } else if (nodeData.isGDrive && nodeData.localPath) {
    vault.gdriveNotes = vault.gdriveNotes || {};
    vault.gdriveNotes[nodeData.localPath] = newNoteText;
    saveVault('SAVED NOTE ON DRIVE ASSET');
  }
}

function convertItemsToSphereLayerNodes(items) {
  const visualNodes = [];
  const outerNodes = [];
  (items || []).forEach(it => {
    const isVisual = Boolean(it.url && it.kind !== 'audio');
    if (isVisual) {
      visualNodes.push({
        id: it.id,
        kind: it.kind || 'image',
        title: it.title || 'Studio Visual',
        url: it.url,
        thumbSrc: it.url,
        notes: it.notes || '',
        link: it.link || '',
        section: it.section || '',
        igStatus: it.igStatus || '',
        badge: it.kind === 'video' ? '▶ VID' : '',
        vaultItem: it
      });
    } else {
      outerNodes.push({
        id: it.id,
        kind: it.kind || 'note',
        title: it.title || 'Studio Note',
        url: it.url || '',
        notes: it.notes || '',
        link: it.link || '',
        section: it.section || '',
        vaultItem: it
      });
    }
  });
  return { visualNodes, outerNodes };
}

/* --------------------------------------------------------------------------
   02 GOOGLE DRIVE, PSD ASSETS & ARCHIVE (Eagle-Style Visual Browser)
   -------------------------------------------------------------------------- */
function renderGDriveAssetsView(ws, spaceObj) {
  if (!state.gdriveStats.loaded && !state.gdriveStats.loading) {
    fetchGDriveAssets(false);
  }
  if (state.gdriveStats.loading && state.gdriveBatches.length === 0) {
    ws.innerHTML = `
      <div style="padding:48px 0;text-align:center;">
        <div class="kicker-mono">INDEXING GOOGLE DRIVE ASSET BATCHES (READ-ONLY)...</div>
      </div>
    `;
    return;
  }

  const ui = spaceObj.ui || {};
  const mode = ui.layoutMode || 'eagle';
  const sortOrder = ui.sortOrder || 'manual';
  const firstCat = (spaceObj.categories && spaceObj.categories[0]) || 'All Asset Batches';

  let list = state.gdriveBatches.filter(b => {
    if (state.activeCategory && state.activeCategory !== firstCat && b.category !== state.activeCategory) {
      return false;
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const exNames = (b.examples || []).map(e => e.name).join(' ');
      const hay = `${b.title} ${b.relPath} ${b.category} ${b.description} ${(b.fileTypes || []).join(' ')} ${exNames}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (sortOrder === 'alpha') {
    list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortOrder === 'newest' || sortOrder === 'updated') {
    list = [...list].sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));
  }

  if (mode === 'list') {
    ws.innerHTML = `<div class="visual-list-table" id="gdriveListTable"></div>`;
    const table = ws.querySelector('#gdriveListTable');
    list.forEach((batch, idx) => {
      const firstEx = (batch.examples || [])[0];
      const thumbSrc = firstEx ? firstEx.thumbUrl : '';
      const batchTitle = (vault.gdriveBatchTitles && vault.gdriveBatchTitles[batch.id]) || batch.title;
      const row = document.createElement('div');
      row.className = 'list-row-item';
      row.innerHTML = `
        <div class="list-thumb">${thumbSrc ? `<img src="${escapeHtml(thumbSrc)}" alt="" loading="lazy">` : `<span class="kicker-mono">#${String(idx + 1).padStart(2, '0')}</span>`}</div>
        <div>
          <div class="card-title" data-editable-title="1" title="Click to rename batch title">${escapeHtml(batchTitle)}</div>
          <span class="kicker-mono">${escapeHtml(batch.category)} · ${batch.totalCount} files</span>
        </div>
        <div class="card-desc">My Drive/${escapeHtml(batch.relPath)}</div>
        <div class="card-tags-row">${(batch.fileTypes || []).slice(0, 3).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="card-footer-actions" style="justify-content:flex-end;">
          <button type="button" class="outline-btn btn-finder">Finder ↗</button>
          <a href="${escapeHtml(batch.driveFolderUrl)}" target="_blank" rel="noopener" class="outline-btn">Drive ↗</a>
        </div>
      `;
      row.querySelector('.btn-finder')?.addEventListener('click', () => revealFolderInFinder(batch.localFolder));
      const rowTitleEl = row.querySelector('.card-title');
      rowTitleEl?.addEventListener('click', (e) => {
        e.stopPropagation();
        promptInlineRename(rowTitleEl, batchTitle, (newVal) => {
          if (newVal.trim()) {
            vault.gdriveBatchTitles = vault.gdriveBatchTitles || {};
            vault.gdriveBatchTitles[batch.id] = newVal.trim();
            batch.title = newVal.trim();
            saveVault('RENAMED ASSET BATCH');
            renderWorkspace();
          }
        });
      });
      table.appendChild(row);
    });
    return;
  }

  if (mode === 'wall') {
    ws.innerHTML = `<div class="cards-wall" id="gdriveBatchesWall"></div>`;
    const grid = ws.querySelector('#gdriveBatchesWall');
    list.forEach((batch, idx) => {
      grid.appendChild(buildGDriveBatchCardEl(batch, idx));
    });
    return;
  }

  // Default for 05 Drive & PSD Assets: Eagle-Style Dense Visual Browser
  renderEagleAssetBrowser(ws, list, spaceObj);
}

function renderEagleAssetBrowser(ws, driveBatches, spaceObj) {
  const scope = state.eagleScopeMode || 'files'; // 'files' | 'batches' | 'closed_projects'
  const disp = state.eagleDisplayStyle || 'masonry'; // 'masonry' | 'uniform'
  const fmt = state.eagleFormatFilter || 'all';
  const colWidth = Math.max(160, Math.min(460, spaceObj?.ui?.cardSize || 235));

  vault.gdriveTitles = vault.gdriveTitles || {};
  vault.gdriveBatchTitles = vault.gdriveBatchTitles || {};

  // Build individual asset items from Drive batches + Vault items + Closed Projects
  let allFiles = [];
  if (scope === 'closed_projects') {
    const deliveredProjs = vault.projects.filter(p => p.lifecycleState === 'delivered');
    deliveredProjs.forEach(p => {
      const pItems = vault.items.filter(i => i.parentType === 'project' && i.parentId === p.id && i.url && i.kind !== 'audio');
      pItems.forEach(it => {
        const ext = (it.url || '').split('.').pop().toUpperCase() || 'IMG';
        allFiles.push({
          id: it.id,
          vaultItemId: it.id,
          title: it.title || p.title,
          category: p.title,
          ext,
          kind: it.kind || 'image',
          thumbSrc: it.url,
          fallbackSrc: it.url,
          localPath: it.link || '',
          driveWebUrl: '',
          igStatus: it.igStatus || '',
          sizeLabel: it.status || 'Delivered Archive',
          notes: it.notes || `${p.title} (${p.subtitle || 'Delivered Client Project'})`
        });
      });
    });
  } else {
    driveBatches.forEach(b => {
      const batchCustomTitle = vault.gdriveBatchTitles[b.id] || b.title;
      (b.examples || []).forEach((ex, idx) => {
        // Always use local server thumbnail endpoint first so thumbnails never fail with 403 on Google Drive cloud URLs
        const primarySrc = ex.thumbUrl || `${ex.thumbUrl}&fallback=1`;
        const fallbackSrc = `${ex.thumbUrl}&fallback=1`;
        const ext = (ex.ext || '').replace('.', '').toUpperCase() || 'FILE';
        const fileId = `${b.id}_ex_${idx}`;
        const customFileTitle = vault.gdriveTitles[fileId] || vault.gdriveTitles[ex.localPath] || ex.name;
        allFiles.push({
          id: fileId,
          vaultItemId: null,
          title: customFileTitle,
          rawName: ex.name,
          category: batchCustomTitle,
          batchId: b.id,
          ext,
          kind: ['MP4', 'MOV', 'WEBM'].includes(ext) ? 'video' : 'image',
          thumbSrc: primarySrc,
          fallbackSrc,
          localPath: ex.localPath,
          driveWebUrl: ex.driveWebUrl || b.driveFolderUrl,
          igStatus: '',
          sizeLabel: ex.sizeLabel || ext,
          notes: (vault.gdriveNotes && vault.gdriveNotes[ex.localPath]) || `My Drive/${b.relPath}`
        });
      });
    });
  }

  if (fmt !== 'all') {
    allFiles = allFiles.filter(f => {
      const e = (f.ext || '').toUpperCase();
      if (fmt === 'PSD') return e === 'PSD' || e === 'PSB';
      if (fmt === 'IMG') return ['PNG', 'JPG', 'JPEG', 'WEBP', 'TIF', 'TIFF'].includes(e);
      if (fmt === 'MOTION') return ['GIF', 'MP4', 'MOV', 'WEBM'].includes(e);
      if (fmt === '3D') return ['OBJ', 'FBX', 'GLB', 'C4D', 'BLEND', 'STL'].includes(e);
      return true;
    });
  }

  const deliveredCount = vault.projects.filter(p => p.lifecycleState === 'delivered').length;

  ws.innerHTML = `
    <div class="eagle-browser-shell">
      <div class="minimal-inline-subbar">
        <div class="subbar-group">
          <button type="button" class="quiet-subbar-link ${scope === 'files' ? 'active' : ''}" data-eagle-scope="files">Files <span>${allFiles.length}</span></button>
          <button type="button" class="quiet-subbar-link ${scope === 'batches' ? 'active' : ''}" data-eagle-scope="batches">Batches <span>${driveBatches.length}</span></button>
          <button type="button" class="quiet-subbar-link ${scope === 'closed_projects' ? 'active' : ''}" data-eagle-scope="closed_projects">Delivered <span>${deliveredCount}</span></button>
        </div>

        <span class="quiet-sep">·</span>

        <div class="subbar-group">
          <button type="button" class="quiet-subbar-link ${fmt === 'all' ? 'active' : ''}" data-eagle-fmt="all">All</button>
          <button type="button" class="quiet-subbar-link ${fmt === 'PSD' ? 'active' : ''}" data-eagle-fmt="PSD">PSD</button>
          <button type="button" class="quiet-subbar-link ${fmt === 'IMG' ? 'active' : ''}" data-eagle-fmt="IMG">Image</button>
          <button type="button" class="quiet-subbar-link ${fmt === 'MOTION' ? 'active' : ''}" data-eagle-fmt="MOTION">Motion</button>
          <button type="button" class="quiet-subbar-link ${fmt === '3D' ? 'active' : ''}" data-eagle-fmt="3D">3D</button>
        </div>

        <div class="subbar-group" style="margin-left:auto;">
          <button type="button" class="quiet-subbar-link ${disp === 'masonry' ? 'active' : ''}" data-eagle-disp="masonry">Masonry</button>
          <button type="button" class="quiet-subbar-link ${disp === 'uniform' ? 'active' : ''}" data-eagle-disp="uniform">Grid</button>
        </div>
      </div>

      <div id="eagleMainStage"></div>
    </div>
  `;

  ws.querySelectorAll('[data-eagle-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.eagleScopeMode = btn.dataset.eagleScope;
      renderWorkspace();
    });
  });

  ws.querySelectorAll('[data-eagle-fmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.eagleFormatFilter = btn.dataset.eagleFmt;
      renderWorkspace();
    });
  });

  ws.querySelectorAll('[data-eagle-disp]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.eagleDisplayStyle = btn.dataset.eagleDisp;
      renderWorkspace();
    });
  });

  const stage = ws.querySelector('#eagleMainStage');
  if (!stage) return;

  if (scope === 'batches') {
    stage.innerHTML = `<div class="cards-wall" id="eagleBatchesGrid"></div>`;
    const grid = stage.querySelector('#eagleBatchesGrid');
    driveBatches.forEach((b, idx) => grid.appendChild(buildGDriveBatchCardEl(b, idx)));
    return;
  }

  if (allFiles.length === 0) {
    stage.innerHTML = `
      <div style="padding:48px 24px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:14px;">
        <div class="kicker-mono">NO MATCHING ASSETS IN THIS EAGLE FILTER</div>
        <p class="typewriter" style="font-size:12px;color:var(--text-mid);margin-top:6px;">Switch format filter to ALL FORMATS or deliver a studio project to populate the Closed Project Archive.</p>
      </div>
    `;
    return;
  }

  const gridEl = document.createElement('div');
  gridEl.className = disp === 'masonry' ? 'eagle-waterfall' : 'eagle-uniform-grid';
  gridEl.style.setProperty('--eagle-col-width', `${colWidth}px`);

  state.currentEagleAssetList = allFiles;

  allFiles.forEach((file, idx) => {
    const tile = document.createElement('div');
    tile.className = 'eagle-tile';
    const isCmp = isAssetCompareSelected(file.id);
    if (isCmp) tile.classList.add('is-compare-selected');

    const prioAttr = idx < 8 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
    const mediaHtml = file.kind === 'video'
      ? `<video src="${escapeHtml(file.thumbSrc)}" muted loop playsinline preload="metadata"></video><span class="eagle-video-scrub-bar"></span>`
      : `<img src="${escapeHtml(file.thumbSrc)}" data-fallback="${escapeHtml(file.fallbackSrc)}" alt="${escapeHtml(file.title)}" ${prioAttr}>`;

    const igBadge = file.igStatus === 'published'
      ? `<span class="ig-status-badge is-published">● IG LIVE</span>`
      : (file.igStatus === 'queued'
          ? `<span class="ig-status-badge is-queued">◈ IG READY</span>`
          : (file.igStatus === 'website' ? `<span class="ig-status-badge" style="background:rgba(59,130,246,0.92);color:#FFF;">🌐 ON SITE</span>` : ''));

    tile.innerHTML = `
      <div class="eagle-tile-media" title="Click to preview high-res · Spacebar Quick-Look · Cmd+Click for Drive">
        ${mediaHtml}
        <button type="button" class="asset-select-check ${isCmp ? 'is-selected' : ''}" title="Select to Compare (1:1 Layer Stack / Split View)">✓</button>
        <span class="eagle-ext-chip">${escapeHtml(file.ext)}</span>
        ${igBadge}
        <div class="eagle-tile-hover-actions">
          <button type="button" class="eagle-mini-btn btn-tile-send-studio" title="Send asset to a Studio Project or Incubator">+ Studio</button>
          ${file.localPath ? `<button type="button" class="eagle-mini-btn btn-tile-finder" title="Reveal in macOS Finder">Finder ↗</button>` : ''}
          ${file.driveWebUrl ? `<a href="${escapeHtml(file.driveWebUrl)}" target="_blank" rel="noopener" class="eagle-mini-btn" title="Open in Google Drive">Drive ↗</a>` : ''}
        </div>
      </div>
      <div class="eagle-tile-meta">
        <div class="eagle-tile-title" data-editable-title="1" title="Click to rename asset title">${escapeHtml(file.title)}</div>
        <div class="eagle-tile-sub">
          <span class="eagle-tile-cat" data-editable-title="1" title="Click to rename batch">${escapeHtml(file.category)}</span>
          <span>${escapeHtml(file.sizeLabel)}</span>
        </div>
      </div>
    `;

    const imgEl = tile.querySelector('img');
    if (imgEl) {
      imgEl.addEventListener('error', () => {
        const fb = imgEl.dataset.fallback;
        if (fb && imgEl.src !== fb && !imgEl.dataset.triedFb) {
          imgEl.dataset.triedFb = '1';
          imgEl.src = fb;
        }
      });
    }

    // Video hover-scrubbing + Quick-Look hover target
    const vidEl = tile.querySelector('video');
    const scrubBar = tile.querySelector('.eagle-video-scrub-bar');
    tile.addEventListener('mouseenter', () => {
      state.hoveredAssetForQuickLook = file;
      if (vidEl) vidEl.play().catch(() => {});
    });
    tile.addEventListener('mousemove', (e) => {
      if (vidEl && vidEl.duration) {
        const rect = tile.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        vidEl.currentTime = ratio * vidEl.duration;
        if (scrubBar) scrubBar.style.width = `${Math.round(ratio * 100)}%`;
      }
    });
    tile.addEventListener('mouseleave', () => {
      if (state.hoveredAssetForQuickLook && state.hoveredAssetForQuickLook.id === file.id) {
        state.hoveredAssetForQuickLook = null;
      }
      if (vidEl) vidEl.pause();
    });

    tile.querySelector('.asset-select-check')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompareSelect({
        id: file.id,
        title: file.title,
        url: file.thumbSrc,
        kind: file.kind || 'image',
        igStatus: file.igStatus || '',
        vaultItemId: file.vaultItemId || file.id,
        notes: file.notes || ''
      });
    });

    tile.querySelector('.btn-tile-send-studio')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sendDriveAssetToStudio(file);
    });

    tile.querySelector('.btn-tile-finder')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (file.localPath) revealFolderInFinder(file.localPath);
    });

    // Click title to rename asset inline!
    const titleEl = tile.querySelector('.eagle-tile-title');
    titleEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      promptInlineRename(titleEl, file.title, (newVal) => {
        if (!newVal.trim()) return;
        const clean = newVal.trim();
        file.title = clean;
        if (file.vaultItemId) {
          const vIt = vault.items.find(i => i.id === file.vaultItemId);
          if (vIt) vIt.title = clean;
        } else {
          vault.gdriveTitles = vault.gdriveTitles || {};
          vault.gdriveTitles[file.id] = clean;
          if (file.localPath) vault.gdriveTitles[file.localPath] = clean;
        }
        saveVault('RENAMED ASSET');
        renderWorkspace();
      });
    });

    // Click category subtitle to rename batch inline!
    const catEl = tile.querySelector('.eagle-tile-cat');
    catEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!file.batchId) return;
      promptInlineRename(catEl, file.category, (newVal) => {
        if (!newVal.trim()) return;
        vault.gdriveBatchTitles = vault.gdriveBatchTitles || {};
        vault.gdriveBatchTitles[file.batchId] = newVal.trim();
        const bObj = state.gdriveBatches.find(x => x.id === file.batchId);
        if (bObj) bObj.title = newVal.trim();
        saveVault('RENAMED ASSET BATCH');
        renderWorkspace();
      });
    });

    tile.querySelector('.eagle-tile-media')?.addEventListener('click', (e) => {
      if (e.target.closest('.asset-select-check') || e.target.closest('.eagle-mini-btn')) return;
      if ((e.metaKey || e.shiftKey) && file.driveWebUrl) {
        window.open(file.driveWebUrl, '_blank', 'noopener');
      } else {
        openSpacebarPreview(file);
      }
    });

    gridEl.appendChild(tile);
  });

  stage.appendChild(gridEl);
}

function ensureVaultItemForAsset(asset, defaultParentType = 'space', defaultParentId = 'incubator') {
  if (!asset) return null;
  if (asset.vaultItemId) {
    const existing = vault.items.find(i => i.id === asset.vaultItemId);
    if (existing) return existing;
  }
  const byUrl = vault.items.find(i => i.url && (i.url === asset.thumbSrc || i.url === asset.url));
  if (byUrl) {
    asset.vaultItemId = byUrl.id;
    return byUrl;
  }
  const newItem = {
    id: uid('item'),
    parentType: defaultParentType,
    parentId: defaultParentId,
    title: asset.title || 'Studio Asset',
    kind: asset.kind === 'video' ? 'video' : 'image',
    section: defaultParentType === 'space' && defaultParentId === 'incubator' ? 'Hatching Up' : 'WIP',
    status: 'Asset',
    url: asset.thumbSrc || asset.url || '',
    link: asset.driveWebUrl || '',
    localPath: asset.localPath || '',
    notes: asset.notes || `Imported from ${asset.category || 'Drive & PSD Assets'}`,
    tags: [asset.ext || 'ASSET', asset.category || 'Drive'].filter(Boolean),
    wallX: 336 + ((vault.items.length % 3) * 312),
    wallY: 144 + ((Math.floor(vault.items.length / 3) % 3) * 312),
    wallW: 264,
    createdAt: Date.now()
  };
  vault.items.unshift(newItem);
  asset.vaultItemId = newItem.id;
  return newItem;
}

function sendDriveAssetToStudio(asset) {
  if (!asset) return;
  // Build quick destination menu dialog or prompt with Studio Projects + 02 Incubator
  let picker = document.getElementById('sendAssetToStudioDialog');
  if (!picker) {
    picker = document.createElement('dialog');
    picker.id = 'sendAssetToStudioDialog';
    picker.className = 'modal-dialog';
    picker.setAttribute('closedby', 'any');
    document.body.appendChild(picker);
  }
  const projOptions = (vault.projects || []).map(p =>
    `<button type="button" class="outline-btn" data-dest-type="project" data-dest-id="${escapeHtml(p.id)}" style="justify-content:flex-start;padding:8px 12px;text-align:left;width:100%;">
      <span class="kicker-mono" style="min-width:32px;">${escapeHtml(p.code || '')}</span>
      <span style="font-weight:600;color:var(--text);">${escapeHtml(p.title)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-dim);">${escapeHtml(p.category || '')}</span>
    </button>`
  ).join('');

  picker.innerHTML = `
    <div class="modal-shell" style="max-width:440px;">
      <header class="modal-header">
        <div>
          <span class="kicker-mono">CONNECT LAB &amp; ASSETS → CREATIVE STUDIO</span>
          <h3 class="modal-title" style="font-size:15px;">Send "${escapeHtml(asset.title || 'Asset')}" To Board</h3>
        </div>
        <button type="button" class="icon-close-btn" id="btnCloseSendStudio">✕</button>
      </header>
      <div style="padding:14px 18px;display:flex;flex-direction:column;gap:8px;max-height:65vh;overflow-y:auto;">
        <button type="button" class="solid-btn" data-dest-type="space" data-dest-id="incubator" style="justify-content:space-between;padding:10px 14px;width:100%;">
          <span>02 · Incubator (Hatching Up / WIP Board)</span>
          <span>Send →</span>
        </button>
        <div class="kicker-mono" style="margin-top:6px;">OR SEND TO A STUDIO PROJECT (01):</div>
        ${projOptions}
      </div>
    </div>
  `;

  picker.querySelector('#btnCloseSendStudio')?.addEventListener('click', () => picker.close());
  picker.querySelectorAll('[data-dest-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const destType = btn.dataset.destType;
      const destId = btn.dataset.destId;
      const destItems = vault.items.filter(i => i.parentType === destType && i.parentId === destId && !i.folderId);
      const col = destItems.length % 3;
      const row = Math.floor(destItems.length / 3);
      const created = {
        id: uid('item'),
        parentType: destType,
        parentId: destId,
        title: asset.title || 'Studio Asset',
        kind: asset.kind === 'video' ? 'video' : 'image',
        section: destType === 'space' ? 'Hatching Up' : 'References',
        status: 'Asset',
        url: asset.thumbSrc || asset.url || '',
        link: asset.driveWebUrl || '',
        localPath: asset.localPath || '',
        notes: asset.notes || `Pinned from Drive & PSD Assets (${asset.category || 'Asset'})`,
        tags: [asset.ext || 'ASSET', asset.category || 'Drive'].filter(Boolean),
        wallX: 336 + col * 312,
        wallY: 144 + row * 312,
        wallW: 264,
        createdAt: Date.now()
      };
      vault.items.unshift(created);
      saveVault('SENT ASSET TO STUDIO');
      picker.close();
      const dlg = document.getElementById('spacebarPreviewDialog');
      if (dlg && dlg.open) dlg.close();
      if (destType === 'project') {
        openProjectBoard(destId);
      } else {
        switchNav('space', destId);
      }
    });
  });

  if (!picker.open) picker.showModal();
}

function openSpacebarPreview(asset) {
  if (!asset) return;
  state.currentQuickLookAsset = asset;
  const dlg = document.getElementById('spacebarPreviewDialog');
  const stage = document.getElementById('spacebarPreviewStage') || document.getElementById('spacebarPreviewMediaStage');
  const badgeEl = document.getElementById('spacebarPreviewBadge');
  const titleEl = document.getElementById('spacebarPreviewTitle');
  const btnQueued = document.getElementById('btnQuickLookQueued');
  const btnPublished = document.getElementById('btnQuickLookPublished');
  const btnWebsite = document.getElementById('btnQuickLookWebsite');
  const btnPinToBoard = document.getElementById('btnQuickLookPinToBoard');
  const btnFinder = document.getElementById('btnQuickLookFinder');
  const btnInspect = document.getElementById('btnQuickLookInspect');
  const btnClose = document.getElementById('btnCloseSpacebarPreview');
  if (!dlg || !stage) return;

  const src = asset.thumbSrc || asset.url || '';
  if (asset.kind === 'video') {
    stage.innerHTML = `<video src="${escapeHtml(src)}" controls autoplay loop playsinline></video>`;
  } else {
    stage.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(asset.title || '')}">`;
  }

  if (badgeEl) {
    badgeEl.textContent = `${asset.category || asset.ext || 'STUDIO ASSET'}${asset.sizeLabel ? ' · ' + asset.sizeLabel : ''}`;
  }

  if (titleEl) {
    titleEl.textContent = asset.title || 'Asset Preview';
    titleEl.dataset.editableTitle = '1';
    titleEl.title = 'Click to rename asset title';
    titleEl.onclick = (e) => {
      e.stopPropagation();
      promptInlineRename(titleEl, asset.title || 'Asset', (newVal) => {
        if (!newVal.trim()) return;
        const clean = newVal.trim();
        asset.title = clean;
        if (asset.vaultItemId) {
          const it = vault.items.find(i => i.id === asset.vaultItemId);
          if (it) it.title = clean;
        } else if (asset.id) {
          vault.gdriveTitles = vault.gdriveTitles || {};
          vault.gdriveTitles[asset.id] = clean;
          if (asset.localPath) vault.gdriveTitles[asset.localPath] = clean;
        }
        saveVault('RENAMED ASSET');
        renderWorkspace();
      });
    };
  }

  const syncQuickLookStatusButtons = () => {
    const vItem = asset.vaultItemId ? vault.items.find(i => i.id === asset.vaultItemId) : null;
    const st = vItem ? (vItem.igStatus || '') : (asset.igStatus || '');
    btnQueued?.classList.toggle('active', st === 'queued');
    btnPublished?.classList.toggle('active', st === 'published');
    btnWebsite?.classList.toggle('active', st === 'website');
  };
  syncQuickLookStatusButtons();

  const toggleAssetStatus = (targetStatus) => {
    const vItem = ensureVaultItemForAsset(asset);
    if (!vItem) return;
    vItem.igStatus = vItem.igStatus === targetStatus ? '' : targetStatus;
    asset.igStatus = vItem.igStatus;
    saveVault(vItem.igStatus === 'queued' ? 'MARKED IG READY' : (vItem.igStatus === 'published' ? 'MARKED IG LIVE' : (vItem.igStatus === 'website' ? 'STAGED FOR WEBSITE' : 'CLEARED TAG')));
    syncQuickLookStatusButtons();
    renderSidebar();
    renderWorkspace();
  };

  if (btnQueued) btnQueued.onclick = () => toggleAssetStatus('queued');
  if (btnPublished) btnPublished.onclick = () => toggleAssetStatus('published');
  if (btnWebsite) btnWebsite.onclick = () => toggleAssetStatus('website');
  if (btnPinToBoard) btnPinToBoard.onclick = () => sendDriveAssetToStudio(asset);

  if (btnFinder) {
    btnFinder.onclick = () => {
      if (asset.localPath) revealFolderInFinder(asset.localPath);
      else if (asset.driveWebUrl) window.open(asset.driveWebUrl, '_blank', 'noopener');
      else if (asset.url) openUrlOrMacPath(asset.url);
    };
  }

  if (btnInspect) {
    btnInspect.onclick = () => {
      const vItem = ensureVaultItemForAsset(asset);
      dlg.close();
      if (vItem) openItemInspector(vItem.id);
    };
  }

  if (btnClose) {
    btnClose.onclick = () => dlg.close();
  }

  if (!dlg._hasKeyNavListener) {
    dlg._hasKeyNavListener = true;
    dlg.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      const list = state.currentEagleAssetList || [];
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && list.length > 1 && state.currentQuickLookAsset) {
        e.preventDefault();
        const curIdx = list.findIndex(x => x.id === state.currentQuickLookAsset.id);
        if (curIdx !== -1) {
          const nextIdx = (curIdx + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
          openSpacebarPreview(list[nextIdx]);
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        dlg.close();
      }
    });
  }

  if (!dlg.open) dlg.showModal();
}

function buildGDriveBatchCardEl(batch, idx) {
  const numStr = '#' + String(idx + 1).padStart(2, '0');
  const card = document.createElement('article');
  card.className = 'studio-card';
  card.dataset.id = batch.id;
  const batchCustomTitle = (vault.gdriveBatchTitles && vault.gdriveBatchTitles[batch.id]) || batch.title;

  const exList = batch.examples || [];
  const offset = state.gdriveOffsets[batch.id] || 0;
  const visibleSix = [];
  if (exList.length > 0) {
    const count = Math.min(6, exList.length);
    for (let i = 0; i < count; i++) {
      visibleSix.push(exList[(offset + i) % exList.length]);
    }
  }

  const tilesHtml = visibleSix.map((ex, tIdx) => {
    const primarySrc = ex.thumbUrl || `${ex.thumbUrl}&fallback=1`;
    const fallbackSrc = `${ex.thumbUrl}&fallback=1`;
    const extBadge = (ex.ext || '').replace('.', '').toUpperCase() || 'FILE';
    const isLcpImg = idx === 0 && tIdx === 0;
    const priorityAttr = isLcpImg ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';

    return `
      <div class="gdrive-preview-tile" data-local-path="${escapeHtml(ex.localPath)}" data-drive-url="${escapeHtml(ex.driveWebUrl)}" title="${escapeHtml(ex.name)} (${escapeHtml(ex.sizeLabel || '')}) • Click to preview • Cmd+Click for Google Drive">
        <img src="${escapeHtml(primarySrc)}" data-fallback="${escapeHtml(fallbackSrc)}" alt="${escapeHtml(ex.name)}" ${priorityAttr}>
        <span class="gdrive-ext-tag">${escapeHtml(extBadge)}</span>
        <span class="gdrive-tile-caption">${escapeHtml(ex.name)}</span>
      </div>
    `;
  }).join('');

  const typesStr = (batch.fileTypes || []).slice(0, 3).join(', ');
  const tagsHtml = (batch.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');

  card.innerHTML = `
    <div class="gdrive-six-grid">
      ${tilesHtml}
    </div>
    <div class="card-body">
      <div class="card-meta-kicker-row">
        <div class="card-inline-meta">
          <span class="meta-index">${numStr}</span>
          <span class="meta-sep">·</span>
          <span class="meta-status">${escapeHtml(batch.category)}</span>
          <span class="meta-sep">·</span>
          <span class="meta-count">${batch.totalCount} files (${escapeHtml(typesStr)})</span>
        </div>
        <div class="card-hover-toolbar" style="opacity:0.92;pointer-events:auto;">
          ${exList.length > 6 ? `<button type="button" class="hover-act-btn btn-shuffle-six" title="Cycle through next 6 examples in this folder">↻ Next 6</button>` : ''}
          <button type="button" class="hover-act-btn primary-act btn-finder-folder" title="Open folder in macOS Finder">Finder ↗</button>
          <a href="${escapeHtml(batch.driveFolderUrl)}" target="_blank" rel="noopener" class="hover-act-btn" title="Open folder in Google Drive Web">Drive ↗</a>
        </div>
      </div>
      <div class="card-title-row">
        <h3 class="card-title" data-editable-title="1" title="Click to rename batch title">${escapeHtml(batchCustomTitle)}</h3>
      </div>
      <p class="card-desc">My Drive/${escapeHtml(batch.relPath)}</p>
      <div class="card-tags-row">${tagsHtml}</div>
    </div>
  `;

  card.querySelectorAll('.gdrive-preview-tile img').forEach(img => {
    img.addEventListener('error', () => {
      const fb = img.dataset.fallback;
      if (fb && img.src !== fb && !img.dataset.triedFallback) {
        img.dataset.triedFallback = '1';
        img.src = fb;
      }
    });
  });

  card.querySelectorAll('.gdrive-preview-tile').forEach((tile, tIdx) => {
    tile.addEventListener('click', (e) => {
      e.stopPropagation();
      const ex = visibleSix[tIdx];
      const localPath = tile.dataset.localPath;
      const driveUrl = tile.dataset.driveUrl;
      if ((e.metaKey || e.shiftKey) && driveUrl) {
        window.open(driveUrl, '_blank', 'noopener');
        return;
      }
      if (ex) {
        openSpacebarPreview({
          id: `${batch.id}_ex_${tIdx}`,
          title: ex.name,
          category: batchCustomTitle,
          ext: (ex.ext || '').replace('.', '').toUpperCase(),
          kind: 'image',
          thumbSrc: ex.thumbUrl,
          localPath,
          driveWebUrl: driveUrl,
          sizeLabel: ex.sizeLabel || ''
        });
      }
    });
  });

  card.querySelector('.btn-shuffle-six')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.gdriveOffsets[batch.id] = ((state.gdriveOffsets[batch.id] || 0) + 6) % exList.length;
    const replacement = buildGDriveBatchCardEl(batch, idx);
    card.replaceWith(replacement);
  });

  card.querySelector('.btn-finder-folder')?.addEventListener('click', (e) => {
    e.stopPropagation();
    revealFolderInFinder(batch.localFolder);
  });
  const cardTitleEl = card.querySelector('.card-title');
  cardTitleEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    promptInlineRename(cardTitleEl, batchCustomTitle, (newVal) => {
      if (newVal.trim()) {
        vault.gdriveBatchTitles = vault.gdriveBatchTitles || {};
        vault.gdriveBatchTitles[batch.id] = newVal.trim();
        batch.title = newVal.trim();
        saveVault('RENAMED ASSET BATCH');
        renderWorkspace();
      }
    });
  });

  return card;
}

async function revealFolderInFinder(folderPath) {
  if (!folderPath) return;
  try {
    await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localPath: folderPath, openFolder: true })
    });
  } catch (e) {}
}

/* --------------------------------------------------------------------------
   SHARED SPATIAL CAMERA ENGINE (Zoom, Pan, 24px Snap Grid, Tidy)
   -------------------------------------------------------------------------- */
function bindSpatialStageCamera(stage, plane, onTidy) {
  if (!stage || !plane) return;
  applyActiveBoardCameraTransform();

  const cam = getActiveBoardCamera();

  document.getElementById('btnWallZoomIn')?.addEventListener('click', () => {
    cam.zoom = Math.min(3.5, +(cam.zoom * 1.18).toFixed(3));
    applyActiveBoardCameraTransform();
  });

  document.getElementById('btnWallZoomOut')?.addEventListener('click', () => {
    cam.zoom = Math.max(0.25, +(cam.zoom / 1.18).toFixed(3));
    applyActiveBoardCameraTransform();
  });

  document.getElementById('btnResetWallCamera')?.addEventListener('click', () => {
    cam.zoom = 1;
    cam.panX = 0;
    cam.panY = 0;
    applyActiveBoardCameraTransform();
  });

  document.getElementById('btnToggleGridSnap')?.addEventListener('click', (e) => {
    state.snapToGrid = state.snapToGrid === false ? true : false;
    e.currentTarget.classList.toggle('is-active', state.snapToGrid !== false);
    e.currentTarget.textContent = state.snapToGrid !== false ? '⊞ Snap: ON' : '⊞ Snap: OFF';
  });

  document.getElementById('btnAutoArrangeWall')?.addEventListener('click', () => {
    if (typeof onTidy === 'function') onTidy();
  });

  // Trackpad two-finger pan & pinch/Cmd/Alt wheel zoom anchored to cursor
  stage.addEventListener('wheel', (e) => {
    // Allow internal scrolling inside a large note or table if cursor is over a scrollable child without modifier
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const scrollChild = e.target.closest('.mn-inline-note-editor, .mn-table-wrap');
      if (scrollChild && scrollChild.scrollHeight > scrollChild.clientHeight) {
        return;
      }
    }
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const rect = stage.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const prevZoom = cam.zoom || 1;
      const factor = Math.exp(-e.deltaY * 0.0045);
      const nextZoom = Math.min(3.5, Math.max(0.25, prevZoom * factor));
      const worldX = (cursorX - cam.panX) / prevZoom;
      const worldY = (cursorY - cam.panY) / prevZoom;
      cam.zoom = nextZoom;
      cam.panX = cursorX - worldX * nextZoom;
      cam.panY = cursorY - worldY * nextZoom;
    } else {
      cam.panX -= e.deltaX;
      cam.panY -= e.deltaY;
    }
    applyActiveBoardCameraTransform();
  }, { passive: false });

  // Background pan via pointerdown + setPointerCapture on empty canvas (or middle mouse / Spacebar)
  stage.addEventListener('pointerdown', (e) => {
    const isMiddle = e.button === 1;
    const isEmptyCanvas = (e.target === stage || e.target === plane) && e.button === 0;
    if (!isEmptyCanvas && !isMiddle) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-panning');
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = cam.panX || 0;
    const origY = cam.panY || 0;

    const onMove = (ev) => {
      cam.panX = origX + (ev.clientX - startX);
      cam.panY = origY + (ev.clientY - startY);
      applyActiveBoardCameraTransform();
    };
    const onStop = () => {
      stage.classList.remove('is-panning');
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('lostpointercapture', onStop);
    };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('lostpointercapture', onStop);
  });
}

/* --------------------------------------------------------------------------
   01 STUDIO PROJECTS OVERVIEW ("Clear Drawers" on Spatial Milanote Board)
   -------------------------------------------------------------------------- */
function renderProjectsOverview(ws, spaceObj) {
  const ui = spaceObj.ui || {};
  const mode = ui.layoutMode || 'wall';
  const sortOrder = ui.sortOrder || 'manual';
  const firstCat = (spaceObj.categories && spaceObj.categories[0]) || 'All Disciplines';
  const lifecycleFilter = state.projectsLifecycleFilter || 'active';

  let list = vault.projects.filter(p => {
    const pState = p.lifecycleState || 'active';
    if (lifecycleFilter === 'active' && pState === 'delivered') return false;
    if (lifecycleFilter === 'delivered' && pState !== 'delivered') return false;
    if (state.activeCategory && state.activeCategory !== firstCat && p.category !== state.activeCategory) {
      return false;
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const hay = `${p.title} ${p.subtitle} ${p.status} ${(p.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (sortOrder === 'updated') {
    list = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } else if (sortOrder === 'newest') {
    list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortOrder === 'alpha') {
    list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  if (mode === 'sphere') {
    const allProjItems = [];
    list.forEach(proj => {
      const pItems = vault.items.filter(i => i.parentType === 'project' && i.parentId === proj.id);
      pItems.forEach(it => allProjItems.push({ ...it, _projTitle: proj.title }));
    });
    const allSphere = convertItemsToSphereLayerNodes(allProjItems);
    const sphereBatches = [
      {
        id: 'all_projects_sphere',
        code: '00',
        title: spaceObj.heading || spaceObj.title || 'All Studio Projects',
        subtitle: `${list.length} Project Boards · ${allProjItems.length} Total Elements`,
        category: 'Creative Studio',
        status: 'Unified 3D Constellation',
        visualNodes: allSphere.visualNodes,
        outerNodes: allSphere.outerNodes,
        totalCount: allProjItems.length,
        primaryActionLabel: 'Spatial Wall →',
        onPrimaryOpen: () => {
          spaceObj.ui = spaceObj.ui || {};
          spaceObj.ui.layoutMode = 'giant_wall';
          saveVault();
          renderAll();
        },
        onRightTopAction: () => {
          spaceObj.ui = spaceObj.ui || {};
          spaceObj.ui.layoutMode = 'giant_wall';
          saveVault();
          renderAll();
        },
        onRightBottomAction: () => openProjectModal(null),
        onRename: (newTitle) => {
          spaceObj.title = newTitle;
          spaceObj.heading = newTitle;
          saveVault('RENAMED SECTION');
          renderAll();
        }
      },
      ...list.map((proj, idx) => {
        const pItems = vault.items.filter(i => i.parentType === 'project' && i.parentId === proj.id);
        const { visualNodes, outerNodes } = convertItemsToSphereLayerNodes(pItems);
        return {
          id: proj.id,
          code: '#' + String(idx + 1).padStart(2, '0'),
          title: proj.title,
          subtitle: proj.subtitle || proj.category || 'Studio Project',
          category: proj.category || 'Studio',
          status: proj.status || '',
          visualNodes,
          outerNodes,
          totalCount: pItems.length,
          primaryActionLabel: 'Open Board →',
          onPrimaryAction: () => openProjectBoard(proj.id),
          onPrimaryOpen: () => openProjectBoard(proj.id),
          onRightTopAction: () => openProjectBoard(proj.id),
          secondaryActionLabel: 'Edit',
          onSecondaryAction: () => openProjectModal(proj.id),
          onRightBottomAction: () => openProjectModal(proj.id),
          onRename: (newTitle) => {
            proj.title = newTitle;
            saveVault('RENAMED PROJECT');
            renderAll();
          }
        };
      })
    ];
    renderSphericalStage(ws, sphereBatches, { isProjectsOverview: true });
    return;
  }

  if (mode === 'list') {
    ws.innerHTML = `<div class="visual-list-table" id="projListTable"></div>`;
    const table = ws.querySelector('#projListTable');
    list.forEach((proj, idx) => {
      const items = vault.items.filter(i => i.parentType === 'project' && i.parentId === proj.id);
      const mediaItem = items.find(i => i.url);
      const isDelivered = proj.lifecycleState === 'delivered';
      const row = document.createElement('div');
      row.className = 'list-row-item';
      row.innerHTML = `
        <div class="list-thumb">${mediaItem ? `<img src="${escapeHtml(mediaItem.url)}" alt="">` : `<span class="kicker-mono">${String(idx + 1).padStart(2, '0')}</span>`}</div>
        <div>
          <div class="card-title" data-editable-title="1" title="Click to rename project">${escapeHtml(proj.title)}</div>
          <span class="kicker-mono">${items.length}</span>
        </div>
        <div class="card-desc">${escapeHtml(proj.subtitle || '')}</div>
        <div class="card-tags-row"></div>
        <div class="card-footer-actions" style="justify-content:flex-end;">
          <button type="button" class="quiet-action-link btn-deliver">${isDelivered ? 'Reopen' : 'Deliver'}</button>
          <button type="button" class="quiet-action-link btn-open">Open →</button>
          <button type="button" class="quiet-action-link btn-edit">Edit</button>
        </div>
      `;
      row.querySelector('.list-thumb').addEventListener('click', () => openProjectBoard(proj.id));
      row.querySelector('.card-title').addEventListener('click', (e) => {
        e.stopPropagation();
        promptInlineRename(e.currentTarget, proj.title, (val) => {
          proj.title = val;
          saveVault('RENAMED PROJECT');
          renderAll();
        });
      });
      row.querySelector('.btn-open').addEventListener('click', () => openProjectBoard(proj.id));
      row.querySelector('.btn-edit').addEventListener('click', () => openProjectModal(proj.id));
      row.querySelector('.btn-deliver').addEventListener('click', () => deliverProjectAndSpawnShowcase(proj.id));
      table.appendChild(row);
    });
    return;
  }

  if (mode === 'kanban') {
    const cols = (spaceObj.categories || []).slice(1);
    ws.innerHTML = `<div class="kanban-board" id="projKanban"></div>`;
    const kb = ws.querySelector('#projKanban');
    cols.forEach(cat => {
      const colProjs = list.filter(p => p.category === cat);
      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      colEl.innerHTML = `
        <div class="kanban-col-header">
          <span class="kanban-col-title" data-editable-title="1" title="Click to rename column">${escapeHtml(cat)}</span>
          <span class="sidebar-count-pill">${colProjs.length}</span>
        </div>
        <div class="kanban-cards" style="display:flex;flex-direction:column;gap:24px;"></div>
      `;
      colEl.querySelector('.kanban-col-title')?.addEventListener('click', (e) => {
        e.stopPropagation();
        promptInlineRename(e.currentTarget, cat, (val) => {
          const catIdx = (spaceObj.categories || []).indexOf(cat);
          if (catIdx !== -1) spaceObj.categories[catIdx] = val;
          vault.projects.forEach(p => { if (p.category === cat) p.category = val; });
          saveVault('RENAMED COLUMN');
          renderAll();
        });
      });
      const container = colEl.querySelector('.kanban-cards');
      colProjs.forEach((proj, idx) => {
        container.appendChild(buildClearDrawerProjectEl(proj, idx, false));
      });
      kb.appendChild(colEl);
    });
    return;
  }

  if (mode === 'giant_wall') {
    renderProjectsSpatialBoard(ws, list);
    return;
  }

  // Mode 'wall' (⊞): Clean, responsive auto-arranged Clear Drawers Grid (never overlaps sidebar or HUD)
  ws.innerHTML = `<div class="clear-drawers-grid" id="projectsClearDrawersWall"></div>`;
  const wallGrid = ws.querySelector('#projectsClearDrawersWall');
  list.forEach((proj, idx) => {
    wallGrid?.appendChild(buildClearDrawerProjectEl(proj, idx, false));
  });
  const looseOverviewItems = vault.items.filter(i => i.parentType === 'space' && i.parentId === 'projects' && !i.folderId && !i.columnId);
  looseOverviewItems.forEach((it, idx) => {
    wallGrid?.appendChild(buildItemCardEl(it, idx));
  });
}

function renderProjectsSpatialBoard(ws, list) {
  const snapOn = state.snapToGrid !== false;
  const cam = getActiveBoardCamera();
  ws.innerHTML = `
    <div class="giant-wall-stage" id="giantWallStage">
      <div class="giant-wall-plane" id="giantWallPlane">
        <div class="wall-snap-preview" id="wallSnapPreview" hidden></div>
      </div>
      <div class="giant-wall-hud">
        <div class="giant-wall-hud-pill">
          <button type="button" id="btnWallZoomOut" title="Zoom Out (⌘-)">−</button>
          <button type="button" id="btnResetWallCamera" title="Reset Zoom &amp; Pan (⌘0)">${Math.round((cam.zoom || 1) * 100)}%</button>
          <button type="button" id="btnWallZoomIn" title="Zoom In (⌘+)">+</button>
          <button type="button" id="btnToggleGridSnap" class="${snapOn ? 'is-active' : ''}" title="Toggle 24px Magnetic Grid Snapping">${snapOn ? '⊞ Snap: ON' : '⊞ Snap: OFF'}</button>
          <button type="button" id="btnAutoArrangeWall" title="Tidy project boards into clean grid">⊞ Tidy</button>
        </div>
      </div>
    </div>
  `;

  const stage = ws.querySelector('#giantWallStage');
  const plane = ws.querySelector('#giantWallPlane');
  const snapBox = ws.querySelector('#wallSnapPreview');

  bindSpatialStageCamera(stage, plane, () => {
    list.forEach((proj, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      proj.boardX = snapCoord(264 + col * 356);
      proj.boardY = snapCoord(108 + row * 336);
      proj.boardW = 336;
    });
    saveVault('TIDIED BOARD');
    renderWorkspace();
  });

  list.forEach((proj, idx) => {
    if (typeof proj.boardX !== 'number' || typeof proj.boardY !== 'number' || proj.boardY < 80 || proj.boardX < 240 || proj.boardX > 990) {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      proj.boardX = snapCoord(264 + col * 356);
      proj.boardY = snapCoord(108 + row * 336);
      proj.boardW = Math.min(336, proj.boardW || 336);
    }
    const card = buildClearDrawerProjectEl(proj, idx, true, snapBox);
    plane.appendChild(card);
  });

  // Also render any Milanote items created directly on the 01 Studio Projects spatial canvas
  const looseItems = vault.items.filter(i => i.parentType === 'space' && i.parentId === 'projects' && !i.folderId && !i.columnId);
  looseItems.forEach((it, idx) => {
    if (typeof it.wallX !== 'number' || typeof it.wallY !== 'number' || it.wallY < 80 || it.wallX < 240) {
      it.wallX = snapCoord(264 + (idx % 3) * 312);
      it.wallY = snapCoord(108 + Math.ceil(list.length / 3) * 336 + Math.floor(idx / 3) * 240);
    }
    const itemCard = buildItemCardEl(it, idx);
    itemCard.style.position = 'absolute';
    itemCard.style.left = `${it.wallX}px`;
    itemCard.style.top = `${it.wallY}px`;
    itemCard.style.width = `${it.wallW || 288}px`;
    plane.appendChild(itemCard);
  });
}

function bindProjectLifecycleBar(ws) {
  ws.querySelectorAll('[data-proj-lifecycle]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.projectsLifecycleFilter = btn.dataset.projLifecycle;
      renderWorkspace();
    });
  });
}

function buildClearDrawerProjectEl(proj, idx, isSpatial = false, snapBox = null) {
  let items = vault.items.filter(i => i.parentType === 'project' && i.parentId === proj.id);
  if (state.igStatusFilter && state.igStatusFilter !== 'all') {
    items = items.filter(i => i.igStatus === state.igStatusFilter);
  }
  const numStr = String(idx + 1).padStart(2, '0');
  const isDelivered = proj.lifecycleState === 'delivered';
  const drawer = document.createElement('article');
  drawer.className = 'clear-drawer-card' + (isSpatial ? ' spatial-project-cluster' : '');
  drawer.dataset.id = proj.id;

  if (isSpatial) {
    const w = proj.boardW || 360;
    drawer.style.left = `${proj.boardX}px`;
    drawer.style.top = `${proj.boardY}px`;
    drawer.style.width = `${w}px`;
  }

  const previewItems = items.slice(0, 6);
  const cellsHtml = previewItems.map((it, cIdx) => {
    const isCmp = isAssetCompareSelected(it.id);
    const igStat = it.igStatus || '';
    const igBadge = igStat === 'published'
      ? `<span class="ig-status-badge is-published">●</span>`
      : (igStat === 'queued'
          ? `<span class="ig-status-badge is-queued">◈</span>`
          : (igStat === 'website' ? `<span class="ig-status-badge" style="background:rgba(59,130,246,0.92);color:#FFF;">🌐</span>` : ''));

    if (it.url && it.kind !== 'audio') {
      const prio = idx === 0 && cIdx < 2 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
      const mediaTag = it.kind === 'video'
        ? `<video src="${escapeHtml(it.url)}#t=0.1" muted loop playsinline preload="metadata" draggable="false"></video>`
        : `<img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.title)}" draggable="false" ${prio}>`;
      return `
        <div class="clear-drawer-thumb ${isCmp ? 'is-compare-selected' : ''}" data-item-id="${escapeHtml(it.id)}" title="${escapeHtml(it.title)} — Click to inspect · Drag to move board">
          ${mediaTag}
          <button type="button" class="asset-select-check ${isCmp ? 'is-selected' : ''}" data-check-item="${escapeHtml(it.id)}" title="Select to Compare">✓</button>
          ${igBadge}
        </div>
      `;
    }
    return `
      <div class="clear-drawer-thumb is-note-thumb" data-item-id="${escapeHtml(it.id)}" title="${escapeHtml(it.title)}">
        <div class="note-preview-mini"><strong>${escapeHtml(it.title)}</strong><br>${escapeHtml((it.notes || it.link || '').slice(0, 65))}</div>
      </div>
    `;
  }).join('');

  drawer.innerHTML = `
    <div class="clear-drawer-header">
      <div class="clear-drawer-title-line">
        <span class="cluster-board-glyph" title="Double-click to open Milanote Board">⊞</span>
        <span class="cluster-index">${numStr}</span>
        <h3 class="clear-drawer-title" data-editable-title="1" title="Click ✎ or double-click title to rename project">${escapeHtml(proj.title)}</h3>
        <button type="button" class="cluster-rename-btn" title="Rename project title">✎</button>
        <span class="cluster-count">${items.length}</span>
        ${proj.finlandLinked ? `<span class="cluster-finland-dot" title="Synced with Finland">●</span>` : ''}
      </div>
      <div class="cluster-hover-actions">
        <button type="button" class="quiet-action-link btn-open-wall" title="Open Milanote Board">Open →</button>
        <button type="button" class="quiet-action-link btn-deliver-proj" title="Deliver &amp; stage showcase">${isDelivered ? 'Reopen' : 'Deliver'}</button>
        <button type="button" class="quiet-action-link btn-edit-board" title="Edit details">Edit</button>
        <button type="button" class="quiet-action-link danger btn-del-board" title="Delete project">×</button>
      </div>
    </div>

    <div class="clear-drawer-bento">
      ${cellsHtml || `<div class="cluster-empty-drop">Double-click to open board</div>`}
    </div>
    ${isSpatial ? `<div class="wall-resize-handle" title="Drag corner to resize cluster"></div>` : ''}
  `;

  const triggerProjRename = (e) => {
    e.stopPropagation();
    const titleEl = drawer.querySelector('.clear-drawer-title');
    if (titleEl) {
      promptInlineRename(titleEl, proj.title, (val) => {
        if (val.trim()) {
          proj.title = val.trim();
          saveVault('RENAMED PROJECT');
          renderAll();
        }
      });
    }
  };
  drawer.querySelector('.cluster-rename-btn')?.addEventListener('click', triggerProjRename);
  drawer.querySelector('.clear-drawer-title')?.addEventListener('click', triggerProjRename);
  drawer.querySelector('.clear-drawer-title')?.addEventListener('dblclick', triggerProjRename);

  drawer.querySelector('.cluster-board-glyph')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectBoard(proj.id);
  });
  drawer.querySelector('.cluster-empty-drop')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectBoard(proj.id);
  });
  drawer.querySelector('.btn-open-wall')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectBoard(proj.id);
  });
  drawer.querySelector('.btn-edit-board')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectModal(proj.id);
  });
  drawer.querySelector('.btn-del-board')?.addEventListener('click', (e) => {
    e.stopPropagation();
    requestDelete('project', proj.id, proj.title);
  });
  drawer.querySelector('.btn-deliver-proj')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deliverProjectAndSpawnShowcase(proj.id);
  });

  drawer.addEventListener('dblclick', (e) => {
    if (e.target.closest('button') || e.target.closest('.inline-rename-field')) return;
    openProjectBoard(proj.id);
  });

  drawer.querySelectorAll('.clear-drawer-thumb').forEach(thumb => {
    const itemId = thumb.dataset.itemId;
    const it = vault.items.find(i => i.id === itemId);
    if (!it) return;

    if (!isSpatial) {
      thumb.addEventListener('click', (e) => {
        if (e.target.closest('.asset-select-check')) return;
        e.stopPropagation();
        openItemInspector(it.id);
      });
    }

    thumb.addEventListener('mouseenter', () => {
      if (it.url && it.kind !== 'audio') {
        state.hoveredAssetForQuickLook = {
          id: it.id,
          title: it.title,
          category: proj.title,
          kind: it.kind || 'image',
          thumbSrc: it.url,
          sizeLabel: it.status || 'Project File'
        };
      }
      const v = thumb.querySelector('video');
      if (v) v.play().catch(() => {});
    });
    thumb.addEventListener('mouseleave', () => {
      if (state.hoveredAssetForQuickLook && state.hoveredAssetForQuickLook.id === it.id) {
        state.hoveredAssetForQuickLook = null;
      }
      const v = thumb.querySelector('video');
      if (v) v.pause();
    });

    thumb.querySelector('.asset-select-check')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompareSelect({
        id: it.id,
        title: it.title || 'Visual',
        url: it.url,
        kind: it.kind || 'image',
        igStatus: it.igStatus || '',
        vaultItemId: it.id,
        notes: it.notes || ''
      });
    });
  });

  if (isSpatial) {
    // True Pointer-Capture Grab & Move on the Spatial Board (with 4px click-vs-drag threshold & 24px grid snap)
    drawer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('.wall-resize-handle') || e.target.closest('.clear-drawer-title') || e.target.closest('.inline-rename-field')) return;
      e.stopPropagation();

      const cam = getActiveBoardCamera();
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = proj.boardX || 336;
      const origY = proj.boardY || 144;
      const clickedThumb = e.target.closest('.clear-drawer-thumb');
      const clickedTitle = e.target.closest('.cluster-board-glyph');
      let moved = false;
      const trashZone = document.getElementById('milanoteTrashDropZone');

      drawer.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dxScreen = ev.clientX - startX;
        const dyScreen = ev.clientY - startY;
        if (!moved && Math.hypot(dxScreen, dyScreen) < 4) return;
        if (!moved) {
          moved = true;
          drawer.classList.add('dragging');
        }
        const z = cam.zoom || 1;
        const rawX = origX + dxScreen / z;
        const rawY = origY + dyScreen / z;
        const snappedX = snapCoord(rawX, ev.altKey);
        const snappedY = snapCoord(rawY, ev.altKey);

        proj.boardX = snappedX;
        proj.boardY = snappedY;
        drawer.style.left = `${snappedX}px`;
        drawer.style.top = `${snappedY}px`;

        if (snapBox) {
          snapBox.hidden = false;
          snapBox.style.left = `${snappedX}px`;
          snapBox.style.top = `${snappedY}px`;
          snapBox.style.width = `${drawer.offsetWidth}px`;
          snapBox.style.height = `${drawer.offsetHeight}px`;
        }

        if (trashZone) {
          const tr = trashZone.getBoundingClientRect();
          const overTrash = ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom;
          trashZone.classList.toggle('is-trash-hot', overTrash);
        }
      };

      const onStop = (ev) => {
        drawer.removeEventListener('pointermove', onMove);
        drawer.removeEventListener('lostpointercapture', onStop);
        drawer.classList.remove('dragging');
        if (snapBox) snapBox.hidden = true;

        if (trashZone && trashZone.classList.contains('is-trash-hot')) {
          trashZone.classList.remove('is-trash-hot');
          requestDelete('project', proj.id, proj.title);
          return;
        }

        if (moved) {
          saveVault('BOARD POSITION SAVED');
        } else {
          if (clickedTitle) {
            openProjectBoard(proj.id);
          } else if (clickedThumb && clickedThumb.dataset.itemId) {
            openItemInspector(clickedThumb.dataset.itemId);
          }
        }
      };

      drawer.addEventListener('pointermove', onMove);
      drawer.addEventListener('lostpointercapture', onStop);
    });

    // Corner Resize Handle for Project Cluster
    const rHandle = drawer.querySelector('.wall-resize-handle');
    rHandle?.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      rHandle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const origW = drawer.offsetWidth;
      const cam = getActiveBoardCamera();

      const onResizeMove = (ev) => {
        const z = cam.zoom || 1;
        const rawW = origW + (ev.clientX - startX) / z;
        const nw = Math.max(240, Math.min(768, snapCoord(rawW, ev.altKey)));
        proj.boardW = nw;
        drawer.style.width = `${nw}px`;
      };
      const onResizeStop = () => {
        rHandle.removeEventListener('pointermove', onResizeMove);
        rHandle.removeEventListener('lostpointercapture', onResizeStop);
        saveVault('BOARD SIZE SAVED');
      };
      rHandle.addEventListener('pointermove', onResizeMove);
      rHandle.addEventListener('lostpointercapture', onResizeStop);
    });
  }

  return drawer;
}

function buildProjectCardEl(proj, idx) {
  return buildClearDrawerProjectEl(proj, idx, false);
}

function deliverProjectAndSpawnShowcase(projId) {
  const proj = vault.projects.find(p => p.id === projId);
  if (!proj) return;

  if (proj.lifecycleState === 'delivered') {
    proj.lifecycleState = 'active';
    proj.status = '🔥 In Progress';
    saveVault('REOPENED IN ACTIVE STUDIO');
    renderAll();
    return;
  }

  proj.lifecycleState = 'delivered';
  proj.status = '✓ Client Delivered';
  proj.updatedAt = Date.now();

  vault.showcaseRollouts = vault.showcaseRollouts || [];
  let rollout = vault.showcaseRollouts.find(r => r.projectId === proj.id);
  if (!rollout) {
    const pVisuals = vault.items.filter(i => i.parentType === 'project' && i.parentId === proj.id && i.url && i.kind !== 'audio');
    pVisuals.slice(0, 3).forEach((it, idx) => {
      if (!it.igStatus) {
        it.igStatus = idx === 0 ? 'queued' : 'website';
      }
    });
    rollout = {
      id: 'rollout_' + proj.id,
      projectId: proj.id,
      title: `${proj.title} — Self-Promo & Portfolio Rollout`,
      clientStatus: 'Client Delivered · Raw Assets Archived to Eagle View',
      promoStatus: '◈ Staged for IG & Website',
      captionDraft: `${proj.title} — ${proj.subtitle || 'Selected studio visuals & process breakdown.'}\n\n#3ddesign #artdirection #motiondesign #visualvault`,
      websiteCaseStudyNotes: `Hero visual + process breakdown for portfolio website (${proj.category || 'Studio'}).`,
      carouselItemIds: pVisuals.slice(0, 6).map(i => i.id),
      updatedAt: Date.now()
    };
    vault.showcaseRollouts.unshift(rollout);
  }

  saveVault('PROJECT DELIVERED → SHOWCASE ROLLOUT SPAWNED');
  renderAll();
}

function openProjectBoard(projId, folderId = null) {
  const proj = vault.projects.find(p => p.id === projId);
  if (!proj) return;
  state.viewType = 'project';
  state.activeProjectId = proj.id;
  state.activeFolderId = folderId || null;
  state.activeCategory = (proj.sections && proj.sections[0]) || 'All';
  state.giantWallZoom = 1;
  state.giantWallPanX = 0;
  state.giantWallPanY = 0;
  if (!proj.ui || !proj.ui.layoutMode || proj.ui.layoutMode === 'sphere') {
    proj.ui = proj.ui || {};
    proj.ui.layoutMode = 'giant_wall';
  }
  applyCustomizationToDOM();
  renderAll();
}

function moveProjectOrder(projId, delta) {
  const idx = vault.projects.findIndex(p => p.id === projId);
  if (idx === -1) return;
  const target = idx + delta;
  if (target < 0 || target >= vault.projects.length) return;
  const [moved] = vault.projects.splice(idx, 1);
  vault.projects.splice(target, 0, moved);
  saveVault();
  renderAll();
}

/* --------------------------------------------------------------------------
   ITEMS COLLECTION VIEW (Inside Any Project Board or Sidebar Section 03–06)
   -------------------------------------------------------------------------- */
function renderItemsCollection(ws, parentType, parentObj) {
  const ui = parentObj.ui || {};
  const isSpatialParent = (parentType === 'project' || parentObj.id === 'incubator' || parentObj.id === 'drop_table');
  const defaultMode = isSpatialParent ? 'giant_wall' : 'wall';
  let mode = ui.layoutMode || defaultMode;

  const sortOrder = ui.sortOrder || 'manual';
  const tabs = parentType === 'project' ? (parentObj.sections || ['All']) : (parentObj.categories || ['All']);
  const firstTab = tabs[0] || 'All';

  let items = vault.items.filter(it => {
    if (it.parentType !== parentType || it.parentId !== parentObj.id) return false;
    // Folder scope filtering: only show items at the current folder level (unless searching globally)
    if (!state.searchQuery) {
      const itemFolder = it.folderId || null;
      const activeFolder = state.activeFolderId || null;
      if (itemFolder !== activeFolder) return false;
    }
    // Exclude items parked inside a Column container from freeform root rendering
    if (mode === 'giant_wall' && it.columnId) return false;

    if (state.activeCategory && state.activeCategory !== firstTab && it.section !== state.activeCategory) {
      return false;
    }
    if (state.igStatusFilter && state.igStatusFilter !== 'all') {
      if (it.igStatus !== state.igStatusFilter) return false;
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const hay = `${it.title} ${it.notes} ${it.status} ${(it.tags || []).join(' ')} ${it.link || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (sortOrder === 'newest' || sortOrder === 'updated') {
    items = [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortOrder === 'alpha') {
    items = [...items].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  // 3D Sphere View support for 02 Incubator and any Project/Space
  if (mode === 'sphere') {
    const allSphere = convertItemsToSphereLayerNodes(items);
    const sphereBatches = [
      {
        id: `${parentObj.id}_all_sphere`,
        code: '00',
        title: parentObj.heading || parentObj.title || 'Incubator',
        subtitle: `${items.length} Elements · Hatching Up & WIP`,
        category: parentObj.title || 'Incubator',
        status: '3D Sphere View',
        visualNodes: allSphere.visualNodes,
        outerNodes: allSphere.outerNodes,
        totalCount: items.length,
        primaryActionLabel: 'Spatial Wall →',
        onPrimaryOpen: () => {
          parentObj.ui = parentObj.ui || {};
          parentObj.ui.layoutMode = 'giant_wall';
          saveVault();
          renderAll();
        },
        onRightTopAction: () => {
          parentObj.ui = parentObj.ui || {};
          parentObj.ui.layoutMode = 'giant_wall';
          saveVault();
          renderAll();
        },
        onRightBottomAction: () => openQuickComposer('note'),
        onRename: (newTitle) => {
          parentObj.title = newTitle;
          if (parentType === 'space') parentObj.heading = newTitle;
          saveVault('RENAMED SECTION');
          renderAll();
        }
      }
    ];
    tabs.slice(1).forEach((secName, idx) => {
      const secItems = items.filter(i => i.section === secName);
      if (secItems.length > 0) {
        const secSphere = convertItemsToSphereLayerNodes(secItems);
        sphereBatches.push({
          id: `${parentObj.id}_sec_${idx}`,
          code: '0' + (idx + 1),
          title: secName,
          subtitle: `${secItems.length} Elements in ${secName}`,
          category: secName,
          status: 'Cluster',
          visualNodes: secSphere.visualNodes,
          outerNodes: secSphere.outerNodes,
          totalCount: secItems.length,
          primaryActionLabel: 'Filter Wall →',
          onPrimaryOpen: () => {
            state.activeCategory = secName;
            parentObj.ui = parentObj.ui || {};
            parentObj.ui.layoutMode = 'giant_wall';
            saveVault();
            renderAll();
          },
          onRightTopAction: () => {
            state.activeCategory = secName;
            parentObj.ui = parentObj.ui || {};
            parentObj.ui.layoutMode = 'giant_wall';
            saveVault();
            renderAll();
          },
          onRename: (newTitle) => {
            const catIdx = tabs.indexOf(secName);
            if (catIdx !== -1) tabs[catIdx] = newTitle;
            vault.items.forEach(it => {
              if (it.parentType === parentType && it.parentId === parentObj.id && it.section === secName) {
                it.section = newTitle;
              }
            });
            saveVault('RENAMED CATEGORY');
            renderAll();
          }
        });
      }
    });
    renderSphericalStage(ws, sphereBatches, { isIncubator: parentObj.id === 'incubator' });
    return;
  }

  // Module 3: 03 Instagram and 04 Website & Portfolio -> Post-Delivery Showcase & Rollout Staging Board
  if (parentType === 'space' && (parentObj.id === 'instagram' || parentObj.id === 'website')) {
    const connectedProjItems = vault.items.filter(it => {
      const isFromCreativeStudio = it.parentType === 'project' || (it.parentType === 'space' && it.parentId === 'incubator');
      if (!isFromCreativeStudio) return false;
      if (parentObj.id === 'instagram') return it.igStatus === 'queued' || it.igStatus === 'published';
      if (parentObj.id === 'website') return it.igStatus === 'website';
      return false;
    });
    const combinedItems = [...items];
    connectedProjItems.forEach(ci => {
      if (!combinedItems.some(x => x.id === ci.id)) combinedItems.push(ci);
    });

    if (mode === 'wall') {
      renderShowcaseStagingBoard(ws, parentObj, combinedItems);
      return;
    }
    if (mode === 'giant_wall') {
      renderGiantWallView(ws, parentType, parentObj, combinedItems);
      return;
    }
  }

  // Module 1: The "Giant Wall" (Milanote-Style Spatial Board with Nested Folders, Columns, Snap Grid & Inline Cards)
  if (mode === 'giant_wall') {
    renderGiantWallView(ws, parentType, parentObj, items);
    return;
  }

  if (mode === 'list') {
    ws.innerHTML = `<div class="visual-list-table" id="itemsListTable"></div>`;
    const table = ws.querySelector('#itemsListTable');
    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'list-row-item';
      row.innerHTML = `
        <div class="list-thumb">${it.url && it.kind !== 'audio' ? `<img src="${escapeHtml(it.url)}" alt="">` : `<span class="kicker-mono">${escapeHtml(it.kind.toUpperCase())}</span>`}</div>
        <div>
          <div class="card-title" data-editable-title="1" title="Click to rename">${escapeHtml(it.title)}</div>
          <span class="kicker-mono">${escapeHtml(it.status || it.section || '')}</span>
        </div>
        <div class="card-desc">${escapeHtml(it.notes || it.link || '')}</div>
        <div class="card-tags-row">${(it.tags || []).slice(0, 2).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="card-footer-actions" style="justify-content:flex-end;">
          ${it.url ? `<a href="${escapeHtml(it.url)}" download class="outline-btn">↓ Original</a>` : ''}
          ${(it.parentType === 'space' && it.parentId === 'incubator') ? `<button type="button" class="text-act-btn btn-promote-proj" title="Promote to Studio Project">↗ Project</button>` : ''}
          <button type="button" class="text-act-btn btn-inspect">Inspect</button>
          <button type="button" class="text-act-btn danger btn-del">×</button>
        </div>
      `;
      row.querySelector('.list-thumb').addEventListener('click', () => {
        if (it.kind === 'folder') {
          state.activeFolderId = it.id;
          renderAll();
        } else {
          openItemInspector(it.id);
        }
      });
      row.querySelector('.card-title').addEventListener('click', (e) => {
        e.stopPropagation();
        promptInlineRename(e.currentTarget, it.title, (val) => {
          it.title = val;
          saveVault('RENAMED ITEM');
          renderWorkspace();
        });
      });
      row.querySelector('.btn-promote-proj')?.addEventListener('click', () => promoteIncubatorItemToProject(it.id));
      row.querySelector('.btn-inspect').addEventListener('click', () => openItemInspector(it.id));
      row.querySelector('.btn-del').addEventListener('click', () => requestDelete('item', it.id, it.title));
      table.appendChild(row);
    });
    return;
  }

  if (mode === 'kanban') {
    const cols = tabs.length > 1 ? tabs.slice(1) : ['All'];
    ws.innerHTML = `<div class="kanban-board" id="itemsKanban"></div>`;
    const kb = ws.querySelector('#itemsKanban');
    cols.forEach(secName => {
      const colItems = items.filter(i => secName === 'All' || i.section === secName);
      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      colEl.innerHTML = `
        <div class="kanban-col-header">
          <span class="kanban-col-title" data-editable-title="1" title="Click to rename column">${escapeHtml(secName)}</span>
          <span class="sidebar-count-pill">${colItems.length}</span>
        </div>
        <div class="kanban-cards" style="display:flex;flex-direction:column;gap:20px;"></div>
      `;
      colEl.querySelector('.kanban-col-title')?.addEventListener('click', (e) => {
        e.stopPropagation();
        promptInlineRename(e.currentTarget, secName, (val) => {
          const catIdx = tabs.indexOf(secName);
          if (catIdx !== -1) tabs[catIdx] = val;
          vault.items.forEach(it => {
            if (it.parentType === parentType && it.parentId === parentObj.id && it.section === secName) {
              it.section = val;
            }
          });
          saveVault('RENAMED COLUMN');
          renderAll();
        });
      });
      const container = colEl.querySelector('.kanban-cards');
      colItems.forEach((it, idx) => container.appendChild(buildItemCardEl(it, idx)));
      kb.appendChild(colEl);
    });
    return;
  }

  ws.innerHTML = `<div class="cards-wall" id="itemsWallGrid"></div>`;
  const grid = ws.querySelector('#itemsWallGrid');
  items.forEach((it, idx) => {
    grid.appendChild(buildItemCardEl(it, idx));
  });
}

/* --------------------------------------------------------------------------
   INCUBATOR → STUDIO PROJECT PROMOTION BRIDGE
   -------------------------------------------------------------------------- */
function promoteIncubatorItemToProject(itemId) {
  const it = vault.items.find(x => x.id === itemId);
  if (!it) return;

  if (it.kind === 'folder') {
    const newProjId = 'proj_' + uid();
    const childItems = vault.items.filter(c => c.parentType === it.parentType && c.parentId === it.parentId && c.folderId === it.id);
    const firstVisual = childItems.find(c => c.url && c.kind !== 'audio');
    const newProj = {
      id: newProjId,
      title: it.title || 'Promoted Studio Project',
      category: 'Active Work',
      status: 'Active',
      lifecycleState: 'active',
      summary: it.notes || `Promoted from Incubator (${childItems.length} items)`,
      coverUrl: firstVisual ? firstVisual.url : '',
      sections: ['All', 'WIP', 'References', 'Notes', 'Final'],
      tags: it.tags || [],
      boardX: 336,
      boardY: 144,
      boardW: 360,
      ui: { layoutMode: 'giant_wall', sortOrder: 'manual' },
      createdAt: Date.now()
    };
    vault.projects.unshift(newProj);
    childItems.forEach((c, idx) => {
      c.parentType = 'project';
      c.parentId = newProjId;
      delete c.folderId;
      c.wallX = 336 + (idx % 3) * 312;
      c.wallY = 144 + Math.floor(idx / 3) * 312;
    });
    vault.items = vault.items.filter(x => x.id !== it.id);
    saveVault(`PROMOTED "${newProj.title.toUpperCase()}" TO 01 STUDIO PROJECTS`);
    openProjectBoard(newProjId);
    return;
  }

  let modal = document.getElementById('promoteIncubatorModal');
  if (modal) modal.remove();

  modal = document.createElement('dialog');
  modal.id = 'promoteIncubatorModal';
  modal.className = 'modal-dialog';
  const projOptions = (vault.projects || []).map(p => `<option value="${escapeHtml(p.id)}">Move into: ${escapeHtml(p.title)}</option>`).join('');

  modal.innerHTML = `
    <div class="modal-card" style="max-width:460px;">
      <div class="modal-header">
        <div>
          <span class="kicker-mono">02 INCUBATOR → 01 STUDIO PROJECTS</span>
          <h2>Promote to Studio Project</h2>
        </div>
        <button type="button" class="icon-close-btn" id="btnClosePromoteModal">×</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;padding-top:8px;">
        <div style="font-size:12px;color:var(--text-mid);">
          Item: <strong style="color:var(--text);">${escapeHtml(it.title)}</strong>
        </div>
        <label class="form-field">
          <span>Action</span>
          <select id="promoteActionSelect">
            <option value="__new__">✦ Create a New Studio Project Board from this idea</option>
            ${projOptions}
          </select>
        </label>
        <label class="form-field" id="promoteNewTitleWrap">
          <span>New Project Title</span>
          <input type="text" id="promoteNewTitleInput" value="${escapeHtml(it.title || 'New Studio Project')}">
        </label>
        <div class="modal-footer" style="margin-top:6px;">
          <button type="button" class="ghost-btn" id="btnCancelPromoteModal">Cancel</button>
          <button type="button" class="primary-pill-btn" id="btnConfirmPromoteModal">Promote &amp; Open Board →</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.showModal();

  const sel = modal.querySelector('#promoteActionSelect');
  const titleWrap = modal.querySelector('#promoteNewTitleWrap');
  sel?.addEventListener('change', () => {
    if (titleWrap) titleWrap.style.display = sel.value === '__new__' ? '' : 'none';
  });

  const close = () => {
    modal.close();
    modal.remove();
  };
  modal.querySelector('#btnClosePromoteModal')?.addEventListener('click', close);
  modal.querySelector('#btnCancelPromoteModal')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  modal.querySelector('#btnConfirmPromoteModal')?.addEventListener('click', () => {
    const targetVal = sel.value;
    let targetProjId = targetVal;
    if (targetVal === '__new__') {
      const newTitle = (modal.querySelector('#promoteNewTitleInput')?.value || it.title || 'New Studio Project').trim();
      targetProjId = 'proj_' + uid();
      vault.projects.unshift({
        id: targetProjId,
        title: newTitle,
        category: 'Active Work',
        status: 'Active',
        lifecycleState: 'active',
        summary: it.notes || 'Promoted from 02 Incubator',
        coverUrl: (it.url && it.kind !== 'audio') ? it.url : '',
        sections: ['All', 'WIP', 'References', 'Notes', 'Final'],
        tags: it.tags || [],
        boardX: 336,
        boardY: 144,
        boardW: 360,
        ui: { layoutMode: 'giant_wall', sortOrder: 'manual' },
        createdAt: Date.now()
      });
    }
    it.parentType = 'project';
    it.parentId = targetProjId;
    delete it.folderId;
    it.wallX = 336;
    it.wallY = 144;
    close();
    saveVault('PROMOTED TO STUDIO PROJECT');
    openProjectBoard(targetProjId);
  });
}

/* --------------------------------------------------------------------------
   MODULE 1: THE "GIANT WALL" (Milanote-Style Spatial Board + Nested Folders)
   -------------------------------------------------------------------------- */
function renderGiantWallView(ws, parentType, parentObj, items) {
  const isProject = parentType === 'project';
  const isIncubator = parentType === 'space' && parentObj.id === 'incubator';
  const isDelivered = isProject && parentObj.lifecycleState === 'delivered';

  ws.innerHTML = `
    <div class="giant-wall-stage" id="giantWallStage">
      <div class="giant-wall-plane" id="giantWallPlane">
        <div class="wall-snap-preview" id="wallSnapPreview" hidden></div>
      </div>
      <div class="giant-wall-hud">
        <div class="giant-wall-hud-pill">
          ${isProject ? `
            <button type="button" id="btnWallDeliverProj" title="Deliver project &amp; spawn IG/Website Showcase">
              ${isDelivered ? '📦 Delivered' : '✓ Deliver'}
            </button>
          ` : ''}
          <button type="button" id="btnToggleGridSnap" class="${state.snapToGrid !== false ? 'is-active' : ''}" title="Toggle 24px Magnetic Grid Snap">${state.snapToGrid !== false ? '⊞ Snap: ON' : '⊞ Snap: OFF'}</button>
          <button type="button" id="btnAutoArrangeWall" title="Tidy elements into clean 24px grid">⊞ Tidy</button>
          <button type="button" id="btnWallZoomOut" title="Zoom Out (Cmd -)">−</button>
          <button type="button" id="btnResetWallCamera" title="Reset zoom &amp; pan (Cmd 0)">100%</button>
          <button type="button" id="btnWallZoomIn" title="Zoom In (Cmd +)">+</button>
        </div>
      </div>
    </div>
  `;

  const stage = ws.querySelector('#giantWallStage');
  const plane = ws.querySelector('#giantWallPlane');
  if (!stage || !plane) return;

  ws.querySelector('#btnWallDeliverProj')?.addEventListener('click', () => {
    deliverProjectAndSpawnShowcase(parentObj.id);
  });

  bindSpatialStageCamera(stage, plane, () => {
    items.forEach((it, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      it.wallX = 264 + col * 312;
      it.wallY = 108 + row * 312;
      it.wallW = it.wallW || 264;
    });
    saveVault('TIDIED BOARD TO GRID');
    renderWorkspace();
  });

  // Render each freeform pinned element on the Milanote Spatial Board
  items.forEach((it, idx) => {
    if (typeof it.wallX !== 'number' || typeof it.wallY !== 'number' || it.wallY < 80 || it.wallX < 240) {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      it.wallX = 264 + col * 312;
      it.wallY = 108 + row * 312;
    }

    const isFolder = it.kind === 'folder';
    const isColumn = it.kind === 'column';
    const isHeading = it.kind === 'heading';
    const isColor = it.kind === 'color';
    const isLine = it.kind === 'line';
    const isVisual = Boolean(it.url && it.kind !== 'audio' && !isFolder);
    const isTodo = it.kind === 'todo' || it.kind === 'checklist' || ((it.notes || '').includes('[ ]') || (it.notes || '').includes('[x]'));
    const isSticky = !isVisual && !isFolder && !isColumn && (it.kind === 'note' || it.kind === 'comment' || isTodo);
    const isCmp = isAssetCompareSelected(it.id);
    const igStat = it.igStatus || '';

    const defaultW = isFolder ? 240 : (isColumn ? 288 : (isHeading ? 360 : (isColor ? 192 : (isVisual ? 264 : 264))));
    const w = it.wallW || defaultW;

    const pin = document.createElement('div');
    pin.className = [
      'wall-pin-item',
      isVisual ? 'is-visual-pin' : '',
      isSticky ? 'is-sticky-note' : '',
      isFolder ? 'is-folder-pin' : '',
      isColumn ? 'is-column-pin' : '',
      isHeading ? 'is-heading-pin' : '',
      isColor ? 'is-color-pin' : '',
      isLine ? 'is-line-pin' : '',
      isCmp ? 'is-compare-selected' : ''
    ].filter(Boolean).join(' ');

    pin.dataset.itemId = it.id;
    pin.dataset.itemKind = it.kind || 'note';
    pin.style.left = `${it.wallX}px`;
    pin.style.top = `${it.wallY}px`;
    pin.style.width = `${w}px`;
    if (it.wallH) pin.style.height = `${it.wallH}px`;

    const igBadge = igStat === 'published'
      ? `<span class="ig-status-badge is-published">● IG LIVE</span>`
      : (igStat === 'queued'
          ? `<span class="ig-status-badge is-queued">◈ IG READY</span>`
          : (igStat === 'website' ? `<span class="ig-status-badge" style="background:rgba(59,130,246,0.92);color:#FFF;">🌐 ON SITE</span>` : ''));

    if (isFolder) {
      const childItems = vault.items.filter(c => c.parentType === parentType && c.parentId === parentObj.id && c.folderId === it.id);
      const childVisuals = childItems.filter(c => c.url && c.kind !== 'audio').slice(0, 4);
      pin.innerHTML = `
        <div class="mn-folder-card">
          <div class="mn-folder-preview-grid">
            ${childVisuals.length ? childVisuals.map(v => `<div class="mn-folder-mini-cell"><img src="${escapeHtml(v.url)}" alt="" draggable="false"></div>`).join('') : `
              <div class="mn-folder-empty-glyph">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
              </div>
            `}
          </div>
          <div class="mn-folder-footer">
            <div class="mn-folder-meta">
              <span class="mn-folder-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Untitled Folder')}</span>
              <span class="mn-folder-count">${childItems.length} ${childItems.length === 1 ? 'item' : 'items'}</span>
            </div>
            <div style="display:flex;gap:4px;align-items:center;">
              ${isIncubator ? `<button type="button" class="mn-folder-open-btn btn-promote-folder" title="Promote Folder to 01 Studio Project">↗ Project</button>` : ''}
              <button type="button" class="mn-folder-open-btn btn-open-folder" title="Open Sub-Board">Open →</button>
            </div>
          </div>
        </div>
        <div class="wall-resize-handle" title="Drag corner to resize"></div>
      `;
      const titleEl = pin.querySelector('.mn-folder-title');
      titleEl?.addEventListener('pointerdown', (e) => e.stopPropagation());
      titleEl?.addEventListener('blur', () => {
        const nextTitle = (titleEl.textContent || '').trim() || 'Untitled Folder';
        if (nextTitle !== it.title) {
          it.title = nextTitle;
          saveVault('FOLDER RENAMED');
        }
      });
      pin.querySelector('.btn-promote-folder')?.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.querySelector('.btn-promote-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        promoteIncubatorItemToProject(it.id);
      });
      pin.querySelector('.btn-open-folder')?.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.querySelector('.btn-open-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.activeFolderId = it.id;
        renderAll();
      });
    } else if (isColumn) {
      const colChildren = vault.items.filter(c => c.parentType === parentType && c.parentId === parentObj.id && c.columnId === it.id);
      pin.innerHTML = `
        <div class="mn-column-card">
          <div class="mn-column-header">
            <span class="mn-column-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Column')}</span>
            <span class="mn-column-count">${colChildren.length}</span>
          </div>
          <div class="mn-column-dropzone" data-column-id="${escapeHtml(it.id)}">
            ${colChildren.length ? colChildren.map(c => `
              <div class="mn-column-child-card" data-child-id="${escapeHtml(c.id)}">
                ${c.url && c.kind !== 'audio' ? `<img src="${escapeHtml(c.url)}" alt="" draggable="false">` : ''}
                <div class="mn-column-child-body">
                  <strong>${escapeHtml(c.title)}</strong>
                  ${c.notes ? `<p>${escapeHtml(c.notes)}</p>` : ''}
                </div>
                <button type="button" class="mn-column-eject-btn" data-eject-id="${escapeHtml(c.id)}" title="Pop out onto board">↗</button>
              </div>
            `).join('') : `<div class="mn-column-placeholder">Drag any card here or click + Note below</div>`}
          </div>
          <button type="button" class="mn-column-add-btn">+ Add card to column</button>
        </div>
        <div class="wall-resize-handle" title="Drag corner to resize"></div>
      `;
      const colTitle = pin.querySelector('.mn-column-title');
      colTitle?.addEventListener('pointerdown', (e) => e.stopPropagation());
      colTitle?.addEventListener('blur', () => {
        it.title = (colTitle.textContent || '').trim() || 'Column';
        saveVault('COLUMN RENAMED');
      });
      pin.querySelectorAll('.mn-column-eject-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const child = vault.items.find(x => x.id === btn.dataset.ejectId);
          if (child) {
            delete child.columnId;
            child.wallX = (it.wallX || 336) + (it.wallW || 288) + 24;
            child.wallY = it.wallY || 144;
            saveVault('CARD POPPED FROM COLUMN');
            renderWorkspace();
          }
        });
      });
      pin.querySelector('.mn-column-add-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        vault.items.unshift({
          id: 'item_' + uid(),
          parentType,
          parentId: parentObj.id,
          folderId: state.activeFolderId || null,
          columnId: it.id,
          title: 'Column Note',
          kind: 'note',
          section: 'Notes',
          status: 'Active',
          url: '',
          link: '',
          notes: 'Double-click to edit details…',
          tags: [],
          createdAt: Date.now()
        });
        saveVault('ADDED CARD TO COLUMN');
        renderWorkspace();
      });
    } else if (isHeading) {
      pin.innerHTML = `
        <div class="mn-heading-card">
          <div class="mn-heading-editable" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Section Heading')}</div>
          <button type="button" class="hover-act-btn btn-pin-inspect" title="Edit or Delete">•••</button>
        </div>
        <div class="wall-resize-handle" title="Drag corner to resize"></div>
      `;
      const hEl = pin.querySelector('.mn-heading-editable');
      hEl?.addEventListener('pointerdown', (e) => e.stopPropagation());
      hEl?.addEventListener('blur', () => {
        it.title = (hEl.textContent || '').trim() || 'Section Heading';
        saveVault('HEADING SAVED');
      });
    } else if (isColor) {
      const hex = (it.notes || it.title || '#FF3B24').trim();
      const validHex = /^#[0-9A-Fa-f]{3,8}$/.test(hex) ? hex : '#FF3B24';
      pin.innerHTML = `
        <div class="mn-color-card">
          <label class="mn-color-swatch" style="background:${escapeHtml(validHex)};" title="Click to pick color">
            <input type="color" class="mn-color-input" value="${escapeHtml(validHex.length === 7 ? validHex : '#FF3B24')}">
          </label>
          <div class="mn-color-info">
            <span class="mn-color-hex" contenteditable="true" spellcheck="false">${escapeHtml(validHex.toUpperCase())}</span>
            <span class="mn-color-label" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Swatch')}</span>
          </div>
        </div>
      `;
      const colorInp = pin.querySelector('.mn-color-input');
      colorInp?.addEventListener('pointerdown', (e) => e.stopPropagation());
      colorInp?.addEventListener('input', (e) => {
        it.notes = e.target.value.toUpperCase();
        pin.querySelector('.mn-color-swatch').style.background = it.notes;
        pin.querySelector('.mn-color-hex').textContent = it.notes;
      });
      colorInp?.addEventListener('change', () => saveVault('SWATCH UPDATED'));
    } else if (isLine) {
      pin.innerHTML = `
        <div class="mn-line-card" style="display:flex;align-items:center;gap:8px;padding:10px 12px;">
          <svg width="100%" height="18" viewBox="0 0 200 18" preserveAspectRatio="none" style="flex:1;overflow:visible;">
            <line x1="2" y1="9" x2="192" y2="9" stroke="var(--text)" stroke-width="2" stroke-linecap="round"/>
            <polyline points="184,3 194,9 184,15" fill="none" stroke="var(--text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="pin-title" contenteditable="true" spellcheck="false" style="font-size:11px;font-family:var(--font-mono);white-space:nowrap;">${escapeHtml(it.title || 'Connector')}</span>
          <button type="button" class="hover-act-btn btn-pin-inspect" style="opacity:1;padding:1px 6px;">•••</button>
        </div>
        <div class="wall-resize-handle" title="Drag to change line length"></div>
      `;
      const lTitle = pin.querySelector('.pin-title');
      lTitle?.addEventListener('pointerdown', (e) => e.stopPropagation());
      lTitle?.addEventListener('blur', () => {
        it.title = (lTitle.textContent || '').trim() || 'Connector';
        saveVault('LINE LABEL SAVED');
      });
    } else {
      let bodyHtml = '';
      if (it.kind === 'video' && it.url) {
        bodyHtml = `<div class="wall-pin-media"><video src="${escapeHtml(it.url)}#t=0.1" muted loop playsinline preload="metadata"></video></div>`;
      } else if (it.kind === 'audio' && it.url) {
        bodyHtml = `
          <div class="wall-pin-body" style="display:flex;flex-direction:column;gap:8px;">
            <div class="kicker-mono" style="color:var(--accent);">🔊 AUDIO CLIP</div>
            <audio src="${escapeHtml(it.url)}" controls style="width:100%;height:32px;"></audio>
          </div>
        `;
      } else if (isVisual) {
        bodyHtml = `<div class="wall-pin-media"><img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.title)}" draggable="false"></div>`;
      } else if (it.kind === 'sketch') {
        bodyHtml = `
          <div class="wall-pin-body mn-sketch-body" style="display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div class="mn-card-inline-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Sketch Pad')}</div>
              <button type="button" class="hover-act-btn btn-sketch-clear" style="opacity:1;font-size:10px;padding:1px 6px;">Clear</button>
            </div>
            <canvas class="mn-sketch-canvas" width="240" height="150" style="width:100%;height:150px;background:#FAF8F5;border:1px solid var(--border);border-radius:6px;cursor:crosshair;touch-action:none;"></canvas>
          </div>
        `;
      } else if (isTodo) {
        const rawTodo = (it.notes && (it.notes.includes('[ ]') || it.notes.includes('[x]')))
          ? it.notes
          : `[ ] ${it.notes || 'First task'}\n[ ] Second task`;
        it.notes = rawTodo;
        bodyHtml = `
          <div class="wall-pin-body mn-todo-body">
            <div class="mn-card-inline-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'To-do List')}</div>
            <div class="checklist-box">${renderChecklistHtml(rawTodo)}</div>
            <input type="text" class="mn-todo-add-input" placeholder="+ Add task &amp; press Enter…">
          </div>
        `;
      } else if (it.kind === 'table') {
        const rows = (it.notes || 'Column A | Column B\nValue 1 | Value 2').split('\n').map(r => r.split('|').map(c => c.trim()));
        bodyHtml = `
          <div class="wall-pin-body mn-table-body">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <div class="mn-card-inline-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Table')}</div>
              <button type="button" class="hover-act-btn btn-table-add-row" style="opacity:1;font-size:10px;padding:1px 6px;">+ Row</button>
            </div>
            <table class="mn-inline-table">
              ${rows.map((r, rIdx) => `<tr>${r.map(c => `<${rIdx === 0 ? 'th' : 'td'} contenteditable="true" spellcheck="false">${escapeHtml(c)}</${rIdx === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}
            </table>
          </div>
        `;
      } else if (it.kind === 'link' || it.kind === 'map' || it.link) {
        const isMap = it.kind === 'map' || (it.link || '').includes('maps.google');
        bodyHtml = `
          <div class="wall-pin-body" style="display:flex;flex-direction:column;gap:6px;">
            <div class="kicker-mono" style="color:var(--accent);">${isMap ? '📍 LOCATION / MAP PIN' : ((it.link || '').startsWith('~') || (it.link || '').startsWith('/') ? '📁 LOCAL MAC PATH' : '🌐 WEB LINK')}</div>
            <div class="mn-card-inline-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || 'Reference Link')}</div>
            <div style="display:flex;gap:4px;align-items:center;">
              <input type="text" class="mn-inline-link-input inspector-input" value="${escapeHtml(it.link || '')}" placeholder="Paste URL or ~/ path…" style="font-size:11px;padding:4px 7px;flex:1;">
              <button type="button" class="hover-act-btn btn-pin-link" style="opacity:1;padding:4px 7px;">Open ↗</button>
            </div>
            <div class="mn-note-editable" contenteditable="true" spellcheck="false" data-placeholder="Add notes…">${escapeHtml(it.notes || '')}</div>
          </div>
        `;
      } else {
        bodyHtml = `
          <div class="wall-pin-body mn-note-body">
            ${it.kind === 'comment' ? `<div class="kicker-mono" style="color:var(--accent);margin-bottom:2px;">💬 STUDIO COMMENT</div>` : ''}
            <div class="mn-card-inline-title" contenteditable="true" spellcheck="false">${escapeHtml(it.title || (it.kind === 'comment' ? 'Comment' : 'Note'))}</div>
            <div class="mn-note-editable" contenteditable="true" spellcheck="false" data-placeholder="Write a note…">${escapeHtml(it.notes || '')}</div>
          </div>
        `;
      }

      const sourceProj = (!isProject && it.parentType === 'project') ? (vault.projects || []).find(p => p.id === it.parentId) : null;

      pin.innerHTML = `
        ${isVisual ? `<button type="button" class="asset-select-check ${isCmp ? 'is-selected' : ''}" title="Select to Compare">✓</button>` : ''}
        ${isVisual ? `<button type="button" class="node-ig-quick-btn ${igStat === 'published' ? 'is-published' : (igStat === 'queued' ? 'is-queued' : '')}" title="Cycle IG / Website Status">${igStat === 'published' ? '●' : (igStat === 'website' ? '🌐' : '◈')}</button>` : ''}
        ${igBadge}
        ${bodyHtml}
        <div class="wall-pin-caption">
          ${isVisual ? `<span class="pin-title" data-editable-title="1" title="Click to rename: ${escapeHtml(it.title)}">${escapeHtml(it.title)}</span>` : `<span class="kicker-mono" style="font-size:9px;opacity:0.55;">${escapeHtml((it.kind || 'NOTE').toUpperCase())}</span>`}
          <div style="display:flex;gap:4px;align-items:center;">
            ${isIncubator ? `<button type="button" class="hover-act-btn btn-pin-promote" style="opacity:1;padding:1px 6px;" title="Promote to 01 Studio Project">↗ Project</button>` : ''}
            ${sourceProj ? `<button type="button" class="hover-act-btn btn-pin-source-board" style="opacity:1;padding:1px 6px;" title="Open ${escapeHtml(sourceProj.title)}">Board ↗</button>` : ''}
            ${(it.link && it.kind !== 'link' && it.kind !== 'map') ? `<button type="button" class="hover-act-btn btn-pin-link" style="opacity:1;padding:1px 6px;">↗</button>` : ''}
            <button type="button" class="hover-act-btn btn-pin-inspect" style="opacity:1;padding:1px 6px;">•••</button>
          </div>
        </div>
        <div class="wall-resize-handle" title="Drag corner to resize card"></div>
      `;

      pin.querySelector('.btn-pin-source-board')?.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.querySelector('.btn-pin-source-board')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sourceProj) openProjectBoard(sourceProj.id);
      });

      pin.querySelector('.btn-pin-promote')?.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.querySelector('.btn-pin-promote')?.addEventListener('click', (e) => {
        e.stopPropagation();
        promoteIncubatorItemToProject(it.id);
      });

      // Interactive inline link input
      const linkInp = pin.querySelector('.mn-inline-link-input');
      linkInp?.addEventListener('pointerdown', (e) => e.stopPropagation());
      linkInp?.addEventListener('change', () => {
        it.link = linkInp.value.trim();
        saveVault('LINK UPDATED');
      });
      linkInp?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          it.link = linkInp.value.trim();
          saveVault('LINK UPDATED');
          linkInp.blur();
        }
      });

      // Interactive inline table cells & +Row button
      const tableEl = pin.querySelector('.mn-inline-table');
      if (tableEl) {
        const serializeTable = () => {
          const serialized = Array.from(tableEl.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('th, td')).map(cell => (cell.textContent || '').trim()).join(' | ')
          ).join('\n');
          it.notes = serialized;
          saveVault('TABLE UPDATED');
        };
        tableEl.querySelectorAll('th, td').forEach(cell => {
          cell.addEventListener('pointerdown', (e) => e.stopPropagation());
          cell.addEventListener('blur', serializeTable);
        });
        pin.querySelector('.btn-table-add-row')?.addEventListener('pointerdown', (e) => e.stopPropagation());
        pin.querySelector('.btn-table-add-row')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const colCount = tableEl.querySelector('tr')?.children.length || 2;
          const emptyRow = Array(colCount).fill('—').join(' | ');
          it.notes = `${(it.notes || '').trim()}\n${emptyRow}`.trim();
          saveVault('TABLE ROW ADDED');
          renderWorkspace();
        });
      }

      // Interactive HTML5 Sketch Pad Canvas
      const sketchCanvas = pin.querySelector('.mn-sketch-canvas');
      if (sketchCanvas) {
        const ctx = sketchCanvas.getContext('2d');
        ctx.strokeStyle = '#181715';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (it.sketchData && it.sketchData.startsWith('data:image/')) {
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0);
          img.src = it.sketchData;
        }
        let drawing = false;
        sketchCanvas.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          drawing = true;
          const r = sketchCanvas.getBoundingClientRect();
          const sx = sketchCanvas.width / r.width;
          const sy = sketchCanvas.height / r.height;
          ctx.beginPath();
          ctx.moveTo((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
          try { sketchCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        });
        sketchCanvas.addEventListener('pointermove', (e) => {
          if (!drawing) return;
          e.stopPropagation();
          const r = sketchCanvas.getBoundingClientRect();
          const sx = sketchCanvas.width / r.width;
          const sy = sketchCanvas.height / r.height;
          ctx.lineTo((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
          ctx.stroke();
        });
        const endSketch = (e) => {
          if (!drawing) return;
          drawing = false;
          e?.stopPropagation();
          try { it.sketchData = sketchCanvas.toDataURL('image/png'); saveVault('SKETCH SAVED'); } catch (_) {}
        };
        sketchCanvas.addEventListener('pointerup', endSketch);
        sketchCanvas.addEventListener('lostpointercapture', endSketch);
        pin.querySelector('.btn-sketch-clear')?.addEventListener('pointerdown', (e) => e.stopPropagation());
        pin.querySelector('.btn-sketch-clear')?.addEventListener('click', (e) => {
          e.stopPropagation();
          ctx.clearRect(0, 0, sketchCanvas.width, sketchCanvas.height);
          it.sketchData = '';
          saveVault('SKETCH CLEARED');
        });
      }

      const capTitleEl = pin.querySelector('.pin-title');
      capTitleEl?.addEventListener('pointerdown', (e) => e.stopPropagation());
      capTitleEl?.addEventListener('click', (e) => {
        e.stopPropagation();
        promptInlineRename(capTitleEl, it.title, (val) => {
          it.title = val;
          const inl = pin.querySelector('.mn-card-inline-title');
          if (inl) inl.textContent = val;
          saveVault('PIN TITLE RENAMED');
        });
      });

      const inlineTitle = pin.querySelector('.mn-card-inline-title');
      inlineTitle?.addEventListener('pointerdown', (e) => e.stopPropagation());
      inlineTitle?.addEventListener('blur', () => {
        const nextT = (inlineTitle.textContent || '').trim();
        if (nextT && nextT !== it.title) {
          it.title = nextT;
          const capTitle = pin.querySelector('.pin-title');
          if (capTitle) capTitle.textContent = nextT;
          saveVault('CARD TITLE SAVED');
        }
      });

      const inlineNote = pin.querySelector('.mn-note-editable');
      inlineNote?.addEventListener('pointerdown', (e) => e.stopPropagation());
      inlineNote?.addEventListener('blur', () => {
        const nextN = (inlineNote.innerText || '').trim();
        if (nextN !== (it.notes || '')) {
          it.notes = nextN;
          saveVault('NOTE SAVED');
        }
      });

      const todoAddInput = pin.querySelector('.mn-todo-add-input');
      todoAddInput?.addEventListener('pointerdown', (e) => e.stopPropagation());
      todoAddInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && todoAddInput.value.trim()) {
          e.preventDefault();
          it.notes = `${(it.notes || '').trim()}\n[ ] ${todoAddInput.value.trim()}`.trim();
          saveVault('TASK ADDED');
          renderWorkspace();
        }
      });
    }

    // Hover Quick-Look + video play
    pin.addEventListener('mouseenter', () => {
      if (isVisual) {
        state.hoveredAssetForQuickLook = {
          id: it.id,
          title: it.title,
          category: parentObj.title,
          kind: it.kind || 'image',
          thumbSrc: it.url,
          sizeLabel: it.status || 'Board Pin'
        };
      }
      const v = pin.querySelector('video');
      if (v) v.play().catch(() => {});
    });
    pin.addEventListener('mouseleave', () => {
      if (state.hoveredAssetForQuickLook && state.hoveredAssetForQuickLook.id === it.id) {
        state.hoveredAssetForQuickLook = null;
      }
      const v = pin.querySelector('video');
      if (v) v.pause();
    });

    pin.querySelector('.asset-select-check')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompareSelect({
        id: it.id,
        title: it.title || 'Visual',
        url: it.url,
        kind: it.kind || 'image',
        igStatus: it.igStatus || '',
        vaultItemId: it.id,
        notes: it.notes || ''
      });
    });

    pin.querySelector('.node-ig-quick-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleItemIgStatus(it.id);
    });

    pin.querySelector('.btn-pin-inspect')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openItemInspector(it.id);
    });

    pin.querySelector('.btn-pin-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openUrlOrMacPath(it.link);
    });

    pin.querySelectorAll('.chk-row input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('pointerdown', (e) => e.stopPropagation());
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChecklistLine(it.id, parseInt(chk.dataset.line, 10));
      });
    });

    // Pointer Capture Dragging + 24px Snap Grid + Drop-into-Folder / Drop-into-Column / Drop-into-Trash
    let draggingPin = false;
    let movedPin = false;
    let dStartX = 0;
    let dStartY = 0;
    let origPinX = 0;
    let origPinY = 0;
    let hoveredFolderEl = null;
    let hoveredColumnEl = null;
    let hoveredBreadcrumbEl = null;

    pin.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (
        e.target.closest('.wall-resize-handle') ||
        e.target.closest('button') ||
        e.target.closest('input') ||
        e.target.closest('[contenteditable="true"]')
      ) return;
      e.stopPropagation();
      draggingPin = true;
      movedPin = false;
      dStartX = e.clientX;
      dStartY = e.clientY;
      origPinX = it.wallX || 144;
      origPinY = it.wallY || 168;
      pin.classList.add('is-dragging');
      try { pin.setPointerCapture(e.pointerId); } catch (_) {}
    });

    pin.addEventListener('pointermove', (e) => {
      if (!draggingPin) return;
      const cam = getActiveBoardCamera();
      const dx = (e.clientX - dStartX) / (cam.zoom || 1);
      const dy = (e.clientY - dStartY) / (cam.zoom || 1);
      if (Math.hypot(dx, dy) > 3) movedPin = true;

      const rawX = Math.max(24, origPinX + dx);
      const rawY = Math.max(72, origPinY + dy);
      const snappedX = snapCoord(rawX);
      const snappedY = snapCoord(rawY);

      it.wallX = snappedX;
      it.wallY = snappedY;
      pin.style.left = `${snappedX}px`;
      pin.style.top = `${snappedY}px`;

      const snapPreview = document.getElementById('wallSnapPreview');
      if (snapPreview && state.snapToGrid && movedPin) {
        snapPreview.hidden = false;
        snapPreview.style.left = `${snappedX}px`;
        snapPreview.style.top = `${snappedY}px`;
        snapPreview.style.width = `${pin.offsetWidth}px`;
        snapPreview.style.height = `${pin.offsetHeight}px`;
      }

      // Highlight Folder / Column / Breadcrumb / Trash drop targets under cursor
      pin.style.pointerEvents = 'none';
      const underEl = document.elementFromPoint(e.clientX, e.clientY);
      pin.style.pointerEvents = '';

      const folderTarget = underEl?.closest('.wall-pin-item.is-folder-pin');
      if (hoveredFolderEl && hoveredFolderEl !== folderTarget) hoveredFolderEl.classList.remove('is-drop-target');
      if (folderTarget && folderTarget !== pin) {
        folderTarget.classList.add('is-drop-target');
        hoveredFolderEl = folderTarget;
      } else {
        hoveredFolderEl = null;
      }

      const colTarget = underEl?.closest('.wall-pin-item.is-column-pin');
      if (hoveredColumnEl && hoveredColumnEl !== colTarget) hoveredColumnEl.classList.remove('is-drop-target');
      if (colTarget && colTarget !== pin && !isFolder && !isColumn) {
        colTarget.classList.add('is-drop-target');
        hoveredColumnEl = colTarget;
      } else {
        hoveredColumnEl = null;
      }

      const crumbTarget = underEl?.closest('.crumb-folder-drop');
      if (hoveredBreadcrumbEl && hoveredBreadcrumbEl !== crumbTarget) hoveredBreadcrumbEl.classList.remove('is-drop-target');
      if (crumbTarget) {
        crumbTarget.classList.add('is-drop-target');
        hoveredBreadcrumbEl = crumbTarget;
      } else {
        hoveredBreadcrumbEl = null;
      }

      const trashBtn = document.getElementById('milanoteTrashDropZone');
      if (trashBtn) {
        const r = trashBtn.getBoundingClientRect();
        const overTrash = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        trashBtn.classList.toggle('is-drag-over', overTrash);
      }
    });

    const finishPinDrag = (e) => {
      if (!draggingPin) return;
      draggingPin = false;
      pin.classList.remove('is-dragging');
      const snapPreview = document.getElementById('wallSnapPreview');
      if (snapPreview) snapPreview.hidden = true;

      if (hoveredFolderEl) {
        const targetFolderId = hoveredFolderEl.dataset.itemId;
        hoveredFolderEl.classList.remove('is-drop-target');
        hoveredFolderEl = null;
        if (targetFolderId && targetFolderId !== it.id) {
          it.folderId = targetFolderId;
          saveVault('MOVED INTO FOLDER');
          renderAll();
          return;
        }
      }

      if (hoveredColumnEl) {
        const targetColId = hoveredColumnEl.dataset.itemId;
        hoveredColumnEl.classList.remove('is-drop-target');
        hoveredColumnEl = null;
        if (targetColId && targetColId !== it.id) {
          it.columnId = targetColId;
          saveVault('ADDED TO COLUMN');
          renderWorkspace();
          return;
        }
      }

      if (hoveredBreadcrumbEl) {
        const destFolderId = hoveredBreadcrumbEl.dataset.crumbFolder || null;
        hoveredBreadcrumbEl.classList.remove('is-drop-target');
        hoveredBreadcrumbEl = null;
        it.folderId = destFolderId || null;
        saveVault('MOVED TO PARENT BOARD');
        renderAll();
        return;
      }

      const trashBtn = document.getElementById('milanoteTrashDropZone');
      if (trashBtn) {
        const r = trashBtn.getBoundingClientRect();
        trashBtn.classList.remove('is-drag-over');
        if (e && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          requestDelete('item', it.id, it.title);
          return;
        }
      }

      if (movedPin) {
        saveVault('PIN POSITION SAVED');
      }
    };

    pin.addEventListener('pointerup', finishPinDrag);
    pin.addEventListener('lostpointercapture', finishPinDrag);

    pin.addEventListener('dblclick', (e) => {
      if (e.target.closest('[contenteditable="true"]') || e.target.closest('input')) return;
      if (isFolder) {
        state.activeFolderId = it.id;
        renderAll();
      } else {
        openItemInspector(it.id);
      }
    });

    // Corner resize handle with pointer capture + 24px snap
    const rHandle = pin.querySelector('.wall-resize-handle');
    let resizingPin = false;
    let rStartX = 0;
    let origW = w;
    rHandle?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      resizingPin = true;
      rStartX = e.clientX;
      origW = pin.offsetWidth;
      try { rHandle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    rHandle?.addEventListener('pointermove', (e) => {
      if (!resizingPin) return;
      const cam = getActiveBoardCamera();
      const rawW = Math.max(168, Math.min(768, origW + (e.clientX - rStartX) / (cam.zoom || 1)));
      const nw = snapCoord(rawW);
      it.wallW = nw;
      pin.style.width = `${nw}px`;
    });
    const finishResize = () => {
      if (!resizingPin) return;
      resizingPin = false;
      saveVault('PIN SIZE SAVED');
    };
    rHandle?.addEventListener('pointerup', finishResize);
    rHandle?.addEventListener('lostpointercapture', finishResize);

    plane.appendChild(pin);
  });
}

/* --------------------------------------------------------------------------
   MODULE 3: POST-DELIVERY SHOWCASE & INSTAGRAM / WEBSITE STAGING BOARD
   -------------------------------------------------------------------------- */
function renderShowcaseStagingBoard(ws, spaceObj, spaceItems) {
  vault.showcaseRollouts = vault.showcaseRollouts || [];
  const isWebsiteSpace = spaceObj.id === 'website';

  const stageFilter = state.igStatusFilter || 'all';
  const filteredSpaceItems = spaceItems.filter(it => {
    if (stageFilter === 'all') return true;
    return it.igStatus === stageFilter;
  });

  // Show rollouts relevant to this staging channel
  const visibleRollouts = vault.showcaseRollouts.filter(r => {
    if (r.channel && r.channel !== spaceObj.id) return false;
    return true;
  });

  const rolloutsHtml = visibleRollouts.map(r => {
    const proj = vault.projects.find(p => p.id === r.projectId);
    const pVisuals = vault.items.filter(i => i.parentType === 'project' && i.parentId === r.projectId && i.url && i.kind !== 'audio');
    const feedCells = pVisuals.slice(0, 9).map(v => `
      <div class="ig-feed-sim-cell" data-item-id="${escapeHtml(v.id)}" title="${escapeHtml(v.title)}">
        <img src="${escapeHtml(v.url)}" alt="">
      </div>
    `).join('');

    const carouselHtml = pVisuals.slice(0, 6).map((v, sIdx) => `
      <div class="carousel-slide-chip" data-item-id="${escapeHtml(v.id)}" style="${isWebsiteSpace ? 'width:118px;aspect-ratio:16/10;' : ''}">
        <img src="${escapeHtml(v.url)}" alt="">
        <span class="slide-num">${isWebsiteSpace ? `HERO 0${sIdx + 1}` : `SLIDE 0${sIdx + 1}`}</span>
      </div>
    `).join('');

    const rightPreviewHtml = isWebsiteSpace ? `
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg);padding:8px;display:flex;flex-direction:column;gap:6px;">
        <div class="kicker-mono" style="font-size:9px;display:flex;justify-content:space-between;">
          <span>🌐 CASE STUDY PREVIEW</span>
          <span>16:10 WEB</span>
        </div>
        ${pVisuals[0] ? `<img src="${escapeHtml(pVisuals[0].url)}" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:4px;">` : ''}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
          ${pVisuals.slice(1, 4).map(v => `<img src="${escapeHtml(v.url)}" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:3px;">`).join('')}
        </div>
      </div>
    ` : `<div class="ig-feed-sim-grid">${feedCells}</div>`;

    return `
      <article class="showcase-rollout-card" data-rollout-id="${escapeHtml(r.id)}">
        <div class="showcase-rollout-header">
          <h3 class="rollout-title-el" data-editable-title="1" data-rollout-id="${escapeHtml(r.id)}" title="Click to rename rollout" style="font-family:var(--font-heading);font-size:14px;font-weight:600;margin:0;cursor:text;">${escapeHtml(r.title || r.projectTitle || 'Showcase Rollout')}</h3>
          <div style="display:flex;gap:10px;align-items:center;">
            <span class="kicker-mono">${escapeHtml(isWebsiteSpace ? (r.websiteLayout || '🌐 Portfolio Case Study') : (r.promoStatus || '◈ IG Carousel Staged'))}</span>
            ${proj ? `<button type="button" class="quiet-action-link btn-open-source-proj" data-proj-id="${escapeHtml(proj.id)}">Source Board →</button>` : ''}
            <button type="button" class="hover-act-btn danger btn-del-rollout" data-rollout-id="${escapeHtml(r.id)}" style="opacity:1;" title="Remove rollout card">×</button>
          </div>
        </div>
        <div class="showcase-rollout-body">
          <div>
            <div class="carousel-sequence-strip">${carouselHtml || '<span class="kicker-mono">Tag project visuals with ◈ Ready or 🌐 Site to populate</span>'}</div>
            <textarea class="pitch-scratchpad rollout-caption-in" style="margin-top:10px;" data-rollout-id="${escapeHtml(r.id)}" data-field="${isWebsiteSpace ? 'caseStudyNotes' : 'captionDraft'}" placeholder="${isWebsiteSpace ? 'Case study text, project credits, embed links...' : 'Instagram caption, @mentions, hashtags, release notes...'}">${escapeHtml(isWebsiteSpace ? (r.caseStudyNotes || r.captionDraft || '') : (r.captionDraft || ''))}</textarea>
          </div>
          <div>
            ${rightPreviewHtml}
          </div>
        </div>
      </article>
    `;
  }).join('');

  ws.innerHTML = `
    <div class="showcase-staging-shell">
      <div class="minimal-inline-subbar" style="justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span class="kicker-mono">${isWebsiteSpace ? '🌐 WEBSITE &amp; PORTFOLIO STAGING' : '◈ INSTAGRAM FEED &amp; REELS PIPELINE'}</span>
          <span class="quiet-sep">·</span>
          <span class="kicker-mono" style="color:var(--text-mid);">${filteredSpaceItems.length} ${filteredSpaceItems.length === 1 ? 'item' : 'items'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="quiet-action-link" id="btnAddStagedVisual">+ Stage from Projects / Upload</button>
          <button type="button" class="quiet-action-link" id="btnSwitchShowcaseToWall">✥ Freeform Canvas</button>
        </div>
      </div>

      ${rolloutsHtml ? `<div class="showcase-rollouts-grid">${rolloutsHtml}</div>` : ''}

      <div class="cards-wall" id="showcaseItemsWall"></div>
    </div>
  `;

  ws.querySelector('#btnAddStagedVisual')?.addEventListener('click', () => openStageFromProjectsDialog(spaceObj.id));
  ws.querySelector('#btnSwitchShowcaseToWall')?.addEventListener('click', () => {
    spaceObj.ui = spaceObj.ui || {};
    spaceObj.ui.layoutMode = 'giant_wall';
    saveVault();
    renderAll();
  });

  ws.querySelectorAll('.btn-del-rollout').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      vault.showcaseRollouts = (vault.showcaseRollouts || []).filter(x => x.id !== btn.dataset.rolloutId);
      saveVault('REMOVED SHOWCASE ROLLOUT');
      renderWorkspace();
    });
  });

  ws.querySelectorAll('.rollout-title-el').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = vault.showcaseRollouts.find(x => x.id === el.dataset.rolloutId);
      if (!r) return;
      promptInlineRename(el, r.title || 'Showcase Rollout', (val) => {
        r.title = val;
        saveVault('RENAMED ROLLOUT');
        renderWorkspace();
      });
    });
  });

  ws.querySelectorAll('.btn-open-source-proj').forEach(btn => {
    btn.addEventListener('click', () => openProjectBoard(btn.dataset.projId));
  });

  ws.querySelectorAll('.rollout-caption-in').forEach(area => {
    area.addEventListener('change', () => {
      const r = vault.showcaseRollouts.find(x => x.id === area.dataset.rolloutId);
      if (r) {
        const field = area.dataset.field || 'captionDraft';
        r[field] = area.value;
        r.updatedAt = Date.now();
        saveVault('SAVED');
      }
    });
  });

  ws.querySelectorAll('.ig-feed-sim-cell, .carousel-slide-chip').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.itemId) openItemInspector(el.dataset.itemId);
    });
  });

  const grid = ws.querySelector('#showcaseItemsWall');
  filteredSpaceItems.forEach((it, idx) => {
    grid?.appendChild(buildItemCardEl(it, idx));
  });
}

function openStageFromProjectsDialog(targetSpaceId) {
  let dlg = document.getElementById('stageFromProjectsDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'stageFromProjectsDialog';
    dlg.className = 'inspector-dialog';
    dlg.setAttribute('closedby', 'any');
    document.body.appendChild(dlg);
  }
  const isWeb = targetSpaceId === 'website';
  const targetBadge = isWeb ? 'website' : 'queued';
  const projectVisuals = vault.items.filter(i => i.parentType === 'project' && i.url && i.kind !== 'audio');

  dlg.innerHTML = `
    <div class="sheet-card" style="max-width:720px;width:92vw;">
      <div class="sheet-header">
        <span class="kicker-mono">${isWeb ? '🌐 STAGE VISUAL TO WEBSITE & PORTFOLIO' : '◈ STAGE VISUAL TO INSTAGRAM PIPELINE'}</span>
        <button type="button" class="icon-btn" id="btnCloseStagePicker">✕</button>
      </div>
      <div class="sheet-body" style="display:flex;flex-direction:column;gap:14px;max-height:70vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
          <span style="font-size:12.5px;color:var(--text-mid);">Click any artwork from your Studio Projects below to toggle it onto <strong>${isWeb ? '04 Website & Portfolio' : '03 Instagram'}</strong>, or upload a new file directly:</span>
          <button type="button" class="primary-btn" id="btnStageUploadNew">+ Upload File</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;">
          ${projectVisuals.map(v => {
            const p = vault.projects.find(x => x.id === v.parentId);
            const active = v.igStatus === targetBadge || ( !isWeb && v.igStatus === 'published' );
            return `
              <div class="stage-picker-item" data-vid="${escapeHtml(v.id)}" style="border:2px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:8px;overflow:hidden;cursor:pointer;background:var(--bg-surface);">
                <div style="height:104px;background:#141312;position:relative;">
                  <img src="${escapeHtml(v.url)}" alt="" style="width:100%;height:100%;object-fit:cover;">
                  <span style="position:absolute;top:6px;right:6px;font-size:10px;padding:2px 6px;border-radius:4px;background:${active ? 'var(--accent)' : 'rgba(20,19,18,0.75)'};color:#FFF;font-family:var(--font-mono);">${active ? '✓ Staged' : '+ Stage'}</span>
                </div>
                <div style="padding:7px 8px;">
                  <div style="font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(v.title)}</div>
                  <div class="kicker-mono" style="font-size:9.5px;color:var(--text-mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p ? p.title : 'Project')}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  dlg.querySelector('#btnCloseStagePicker')?.addEventListener('click', () => dlg.close());
  dlg.querySelector('#btnStageUploadNew')?.addEventListener('click', () => {
    dlg.close();
    document.getElementById('globalFileInput')?.click();
  });
  dlg.querySelectorAll('.stage-picker-item').forEach(card => {
    card.addEventListener('click', () => {
      const it = vault.items.find(x => x.id === card.dataset.vid);
      if (!it) return;
      it.igStatus = (it.igStatus === targetBadge) ? '' : targetBadge;
      saveVault(it.igStatus ? `STAGED TO ${isWeb ? 'WEBSITE' : 'INSTAGRAM'}` : 'UNSTAGED ITEM');
      renderAll();
      openStageFromProjectsDialog(targetSpaceId);
    });
  });

  if (!dlg.open) dlg.showModal();
}

function buildItemCardEl(it, idx) {
  const numStr = '#' + String(idx + 1).padStart(2, '0');
  const card = document.createElement('article');
  card.className = 'studio-card';
  card.draggable = true;
  card.dataset.id = it.id;

  const isFolder = it.kind === 'folder';
  const isIncubatorItem = it.parentType === 'space' && it.parentId === 'incubator';
  const sourceProj = it.parentType === 'project' ? (vault.projects || []).find(p => p.id === it.parentId) : null;
  const hasChecklist = (it.notes || '').includes('[ ]') || (it.notes || '').includes('[x]') || (it.notes || '').includes('[X]');
  const prioAttr = idx === 0 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';

  let stageHtml = '';
  if (isFolder) {
    const childItems = vault.items.filter(c => c.parentType === it.parentType && c.parentId === it.parentId && c.folderId === it.id);
    const childVisuals = childItems.filter(c => c.url && c.kind !== 'audio').slice(0, 4);
    stageHtml = `
      <div class="stage-note-pad" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:12px;">
        ${childVisuals.length ? childVisuals.map(v => `<img src="${escapeHtml(v.url)}" alt="" style="width:100%;height:74px;object-fit:cover;border-radius:6px;">`).join('') : `
          <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:18px;color:var(--text-mid);">
            <span class="kicker-mono">📂 SUB-FOLDER (${childItems.length} ITEMS)</span>
            <span style="font-size:11.5px;">Click card to open folder</span>
          </div>
        `}
      </div>
    `;
  } else if (it.kind === 'video' && it.url) {
    stageHtml = `<video src="${escapeHtml(it.url)}#t=0.1" preload="metadata" muted playsinline></video>`;
  } else if (it.url && it.kind !== 'audio') {
    stageHtml = `<img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.title)}" ${prioAttr}>`;
  } else if (it.kind === 'audio' && it.url) {
    stageHtml = `
      <div class="stage-note-pad" style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;text-align:center;">
        <div class="kicker-mono" style="color:var(--accent);">🔊 ORIGINAL STUDIO AUDIO (WAV / MP3)</div>
        <audio src="${escapeHtml(it.url)}" controls style="width:90%;max-width:280px;"></audio>
        <div class="typewriter" style="font-size:11.5px;color:var(--text-mid);">${escapeHtml(it.notes || '')}</div>
      </div>
    `;
  } else if (hasChecklist) {
    stageHtml = `<div class="stage-note-pad"><div class="checklist-box" data-item-id="${escapeHtml(it.id)}">${renderChecklistHtml(it.notes)}</div></div>`;
  } else if (it.kind === 'link' || (it.link && !it.notes)) {
    stageHtml = `
      <div class="stage-note-pad" style="display:flex;flex-direction:column;justify-content:center;gap:8px;">
        <div class="kicker-mono">${it.link.startsWith('~') || it.link.startsWith('/') ? '📁 LOCAL MAC PATH' : '🌐 WEB REFERENCE LINK'}</div>
        <div class="typewriter" style="font-size:13px;word-break:break-all;color:var(--accent);">${escapeHtml(it.link)}</div>
        <div class="typewriter" style="font-size:11.5px;color:var(--text-mid);">${escapeHtml(it.notes || '')}</div>
      </div>
    `;
  } else {
    stageHtml = `<div class="stage-note-pad">${escapeHtml(it.notes || it.title)}</div>`;
  }

  const tagsHtml = (it.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
  const isVisualAsset = Boolean(it.url && it.kind !== 'audio' && !isFolder);
  const isCmpSel = isAssetCompareSelected(it.id);
  const igStat = it.igStatus || '';

  const igBadgeCardHtml = igStat === 'published'
    ? `<span class="ig-status-badge is-published" title="Published (IG Live) — Click to cycle">● IG LIVE</span>`
    : (igStat === 'queued'
        ? `<span class="ig-status-badge is-queued" title="Queued (IG Ready / Next Up) — Click to cycle">◈ IG READY</span>`
        : (igStat === 'website'
            ? `<span class="ig-status-badge" style="background:rgba(59,130,246,0.92);color:#FFF;" title="On Portfolio Website — Click to cycle">🌐 ON SITE</span>`
            : ''));

  const cardControlsHtml = isVisualAsset ? `
    <button type="button" class="asset-select-check ${isCmpSel ? 'is-selected' : ''}" title="Select to Compare (1:1 Layer Stack / Split View)">✓</button>
    <button type="button" class="node-ig-quick-btn ${igStat === 'published' ? 'is-published' : (igStat === 'queued' ? 'is-queued' : '')}" title="1-Click Toggle Status (WIP → ◈ IG Ready → ● IG Live → 🌐 Website)">${igStat === 'published' ? '●' : (igStat === 'website' ? '🌐' : '◈')}</button>
    ${igBadgeCardHtml}
  ` : igBadgeCardHtml;

  if (isCmpSel) card.classList.add('is-compare-selected');

  card.innerHTML = `
    <div class="card-stage">
      ${stageHtml}
      ${cardControlsHtml}
    </div>
    <div class="card-body">
      <div class="card-meta-kicker-row">
        <div class="card-inline-meta">
          <span class="meta-index">${numStr}</span>
          <span class="meta-sep">·</span>
          <span class="meta-status">${escapeHtml(it.status || it.kind.toUpperCase())}</span>
          <span class="meta-sep">·</span>
          <span class="meta-count">${escapeHtml(sourceProj ? sourceProj.title : (it.section || 'Vault'))}</span>
        </div>
        <div class="card-hover-toolbar">
          ${isFolder ? `<button type="button" class="hover-act-btn primary-act btn-open-folder-card">Open →</button>` : `<button type="button" class="hover-act-btn primary-act btn-inspect">Inspect</button>`}
          ${isIncubatorItem ? `<button type="button" class="hover-act-btn btn-promote-to-proj" title="Promote to 01 Studio Project">↗ Project</button>` : ''}
          ${(sourceProj && state.viewType === 'space') ? `<button type="button" class="hover-act-btn btn-jump-source-proj" title="Open Source Project Board">Board ↗</button>` : ''}
          ${it.url ? `<a href="${escapeHtml(it.url)}" download class="hover-act-btn" title="Download uncompressed original">↓ Orig</a>` : ''}
          ${it.link ? `<button type="button" class="hover-act-btn btn-open-link" title="${escapeHtml(it.link)}">${it.link.startsWith('~') || it.link.startsWith('/') ? 'Finder ↗' : 'Link ↗'}</button>` : ''}
          <button type="button" class="hover-act-btn btn-up" title="Move earlier">↑</button>
          <button type="button" class="hover-act-btn btn-down" title="Move later">↓</button>
          <button type="button" class="hover-act-btn danger btn-del-item" title="Delete item">×</button>
        </div>
      </div>
      <div class="card-title-row">
        <h3 class="card-title" data-editable-title="1" title="Click to rename">${escapeHtml(it.title)}</h3>
      </div>
      ${(it.url && it.notes && it.kind !== 'audio') ? `<p class="card-desc">${escapeHtml(it.notes)}</p>` : ''}
      <div class="card-tags-row">${tagsHtml}</div>
    </div>
  `;

  // Hover Spacebar Quick-Look support
  card.addEventListener('mouseenter', () => {
    if (isVisualAsset) {
      state.hoveredAssetForQuickLook = {
        id: it.id,
        title: it.title,
        category: it.section || 'Studio Asset',
        kind: it.kind || 'image',
        thumbSrc: it.url,
        sizeLabel: it.status || ''
      };
    }
  });
  card.addEventListener('mouseleave', () => {
    if (state.hoveredAssetForQuickLook && state.hoveredAssetForQuickLook.id === it.id) {
      state.hoveredAssetForQuickLook = null;
    }
  });

  // Interactive Checkboxes right on the card stage!
  card.querySelectorAll('.chk-row input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      const lineIdx = parseInt(chk.dataset.line, 10);
      toggleChecklistLine(it.id, lineIdx);
    });
  });

  // Open Inspector or Folder when clicking stage
  card.querySelector('.card-stage').addEventListener('click', (e) => {
    if (e.target.closest('audio') || e.target.closest('.chk-row') || e.target.closest('.asset-select-check') || e.target.closest('.node-ig-quick-btn') || e.target.closest('.ig-status-badge')) return;
    if (isFolder) {
      state.activeFolderId = it.id;
      renderAll();
    } else {
      openItemInspector(it.id);
    }
  });
  card.querySelector('.btn-open-folder-card')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.activeFolderId = it.id;
    renderAll();
  });
  card.querySelector('.btn-promote-to-proj')?.addEventListener('click', (e) => {
    e.stopPropagation();
    promoteIncubatorItemToProject(it.id);
  });
  card.querySelector('.btn-jump-source-proj')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sourceProj) openProjectBoard(sourceProj.id);
  });
  card.querySelector('.asset-select-check')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCompareSelect({
      id: it.id,
      title: it.title || 'Visual',
      url: it.url,
      kind: it.kind || 'image',
      igStatus: it.igStatus || '',
      vaultItemId: it.id,
      notes: it.notes || ''
    });
  });
  card.querySelector('.node-ig-quick-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleItemIgStatus(it.id);
  });
  card.querySelector('.ig-status-badge')?.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleItemIgStatus(it.id);
  });
  card.querySelector('.card-title').addEventListener('click', (e) => {
    e.stopPropagation();
    promptInlineRename(e.currentTarget, it.title, (val) => {
      it.title = val;
      saveVault('RENAMED ITEM');
      renderWorkspace();
    });
  });
  card.querySelector('.btn-inspect')?.addEventListener('click', () => openItemInspector(it.id));
  card.querySelector('.btn-del-item').addEventListener('click', () => requestDelete('item', it.id, it.title));

  const openLinkBtn = card.querySelector('.btn-open-link');
  if (openLinkBtn) {
    openLinkBtn.addEventListener('click', () => openUrlOrMacPath(it.link));
  }

  // Manual arrow ordering
  card.querySelector('.btn-up').addEventListener('click', () => moveItemOrder(it.id, -1));
  card.querySelector('.btn-down').addEventListener('click', () => moveItemOrder(it.id, 1));

  // Drag & drop reorder
  card.addEventListener('dragstart', () => {
    state.draggedId = it.id;
    state.draggedKind = 'item';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', (e) => e.preventDefault());
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    if (state.draggedKind === 'item' && state.draggedId && state.draggedId !== it.id) {
      reorderArrayById(vault.items, state.draggedId, it.id);
      saveVault();
      renderWorkspace();
    }
  });

  return card;
}

function renderChecklistHtml(text) {
  const lines = (text || '').split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[ ]') || trimmed.startsWith('[x]') || trimmed.startsWith('[X]')) {
      const checked = trimmed.toLowerCase().startsWith('[x]');
      const label = trimmed.slice(3).trim();
      return `
        <label class="chk-row ${checked ? 'checked' : ''}">
          <input type="checkbox" data-line="${idx}" ${checked ? 'checked' : ''}>
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    }
    if (!trimmed) return `<div style="height:4px;"></div>`;
    return `<div class="typewriter" style="font-size:11.5px;color:var(--text-mid);margin-top:4px;">${escapeHtml(line)}</div>`;
  }).join('');
}

function toggleChecklistLine(itemId, lineIdx) {
  const it = vault.items.find(i => i.id === itemId);
  if (!it || !it.notes) return;
  const lines = it.notes.split('\n');
  if (lineIdx < 0 || lineIdx >= lines.length) return;
  const line = lines[lineIdx];
  if (line.includes('[ ]')) {
    lines[lineIdx] = line.replace('[ ]', '[x]');
  } else if (line.includes('[x]')) {
    lines[lineIdx] = line.replace('[x]', '[ ]');
  } else if (line.includes('[X]')) {
    lines[lineIdx] = line.replace('[X]', '[ ]');
  }
  it.notes = lines.join('\n');
  saveVault();
  renderWorkspace();
}

function moveItemOrder(itemId, delta) {
  const idx = vault.items.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const target = idx + delta;
  if (target < 0 || target >= vault.items.length) return;
  const [moved] = vault.items.splice(idx, 1);
  vault.items.splice(target, 0, moved);
  saveVault();
  renderWorkspace();
}

/* --------------------------------------------------------------------------
   08 FINLAND LINK VIEW (100% Read-Only Bridge — Clear Drawers Bento)
   -------------------------------------------------------------------------- */
function renderFinlandView(ws) {
  const linkedBoards = vault.projects.filter(p => p.finlandLinked);

  ws.innerHTML = `
    <div style="margin-bottom:18px;padding:14px 18px;background:var(--surface);border:1px solid var(--border);border-radius:var(--card-radius);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div>
        <div class="kicker-mono" style="color:var(--ok);">● 100% READ-ONLY FINLAND BRIDGE</div>
        <p class="typewriter" style="font-size:12px;color:var(--text-mid);margin-top:2px;">Ideal reads active projects from Finland without ever modifying or touching your Finland database.</p>
      </div>
      <span class="stage-badge">${linkedBoards.length} Linked Studio Clear Drawers</span>
    </div>
    <div class="clear-drawers-grid" id="finlandBoardsWall"></div>
  `;
  const grid = ws.querySelector('#finlandBoardsWall');
  linkedBoards.forEach((proj, idx) => {
    grid.appendChild(buildClearDrawerProjectEl(proj, idx));
  });
}

/* --------------------------------------------------------------------------
   MODULE 5: 07–09 MOVING FORWARD — OUTREACH, 100-PITCH QUOTA & "FAILURE IS GOOD" ENGINE
   -------------------------------------------------------------------------- */
function renderOutreachPitchEngine(ws, spaceObj) {
  if (!vault.pitchEngine) {
    vault.pitchEngine = createDefaultPitchEngineSeed();
  }
  const pe = vault.pitchEngine;
  if (!Array.isArray(pe.cards) && Array.isArray(pe.pitches)) {
    pe.cards = pe.pitches.map(p => ({
      id: p.id,
      spaceId: p.spaceId || 'residencies',
      title: p.title,
      category: p.category || 'Residencies',
      deadline: p.deadline || 'Rolling',
      status: p.status || 'Drafting',
      link: p.url || p.link || '',
      linkedProjectId: p.linkedProjectId || '',
      requirements: p.checklist ? {
        portfolioPdf: Boolean(p.checklist.portfolioPdf),
        websiteLink: Boolean(p.checklist.websiteLink),
        cv: Boolean(p.checklist.cv),
        artistStatement: Boolean(p.checklist.artistStatement),
        projectProposal: Boolean(p.checklist.projectProposal)
      } : (p.requirements || {}),
      notes: p.notes || ''
    }));
  }
  pe.cards = pe.cards || [];

  // Ensure all 3 Moving Forward sections are seeded if missing
  if (typeof getExtraMovingForwardSeedCards === 'function') {
    const extraSeeds = getExtraMovingForwardSeedCards();
    extraSeeds.forEach(sc => {
      if (!pe.cards.some(c => c.id === sc.id)) pe.cards.push(sc);
    });
  }

  const spaceItems = vault.items.filter(i => i.parentType === 'space' && i.parentId === spaceObj.id);
  if (spaceObj.ui?.layoutMode === 'giant_wall') {
    renderGiantWallView(ws, 'space', spaceObj, spaceItems);
    return;
  }

  if (pe.quota) {
    if (typeof pe.sentCount !== 'number') pe.sentCount = pe.quota.sentCount || 28;
    if (typeof pe.goalTarget !== 'number') pe.goalTarget = pe.quota.target || 100;
    if (typeof pe.rejectionCount !== 'number') pe.rejectionCount = pe.quota.rejectionsCount || 19;
    if (!pe.goalLabel) pe.goalLabel = pe.quota.title || '100 Monthly Outreach Emails';
    if (!pe.timeframeLabel) pe.timeframeLabel = pe.quota.timeframeLabel || 'Monthly Target';
  }
  const pct = Math.min(100, Math.round(((pe.sentCount || 0) / Math.max(1, pe.goalTarget || 100)) * 100));
  const firstCat = (spaceObj.categories && spaceObj.categories[0]) || 'All';

  let cards = (pe.cards || []).filter(c => {
    const cardSpace = c.spaceId || 'residencies';
    if (cardSpace !== spaceObj.id) return false;
    if (state.activeCategory && state.activeCategory !== firstCat && c.category !== state.activeCategory) {
      return false;
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const hay = `${c.title} ${c.category} ${c.status} ${c.deadline} ${c.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const cardsHtml = cards.map(c => {
    const req = c.requirements || {};
    const reqKeys = [
      { key: 'portfolioPdf', label: 'Portfolio PDF' },
      { key: 'websiteLink', label: 'Website Link' },
      { key: 'cv', label: 'Artist CV' },
      { key: 'artistStatement', label: 'Artist Statement' },
      { key: 'projectProposal', label: 'Proposal / Custom Reel' }
    ];
    const reqPills = reqKeys.map(rk => {
      const done = Boolean(req[rk.key]);
      return `
        <button type="button" class="req-check-pill ${done ? 'is-done' : ''}" data-pitch-id="${escapeHtml(c.id)}" data-req-key="${rk.key}">
          <span>${done ? '✓' : '○'}</span>
          <span>${escapeHtml(rk.label)}</span>
        </button>
      `;
    }).join('');

    const linkedProj = c.linkedProjectId ? (vault.projects || []).find(p => p.id === c.linkedProjectId) : null;
    const projSelectOptions = `<option value="">Link Studio Project…</option>` + (vault.projects || []).map(p =>
      `<option value="${escapeHtml(p.id)}" ${c.linkedProjectId === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`
    ).join('');

    return `
      <article class="pitch-card" data-pitch-id="${escapeHtml(c.id)}">
        <div class="pitch-card-header" style="align-items:flex-start;gap:10px;">
          <div style="min-width:0;flex:1 1 auto;">
            <div class="kicker-mono">${escapeHtml(c.category || 'Outreach')} · ${escapeHtml(c.deadline || 'Rolling')}</div>
            <h3 class="pitch-card-title" data-editable-title="1" data-pitch-id="${escapeHtml(c.id)}" title="Click to rename">${escapeHtml(c.title)}</h3>
          </div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:nowrap;flex-shrink:0;white-space:nowrap;">
            <span class="kicker-mono" style="font-size:10px;">${escapeHtml(c.status || 'Drafting')}</span>
            <button type="button" class="quiet-action-link btn-pitch-mark-sent" style="padding:2px 5px;font-size:11px;" data-pitch-id="${escapeHtml(c.id)}">+ Sent</button>
            <button type="button" class="quiet-action-link btn-pitch-mark-rej" style="padding:2px 5px;font-size:11px;" data-pitch-id="${escapeHtml(c.id)}">🔥 Reject</button>
            ${c.link ? `<a href="${escapeHtml(c.link)}" target="_blank" rel="noopener" class="quiet-action-link" style="padding:2px 5px;font-size:11px;">Portal ↗</a>` : ''}
            <button type="button" class="quiet-action-link danger btn-del-pitch" style="padding:2px 5px;font-size:12px;" data-pitch-id="${escapeHtml(c.id)}">×</button>
          </div>
        </div>

        <div class="pitch-req-checklist">${reqPills}</div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <select class="pitch-linked-proj-select" data-pitch-id="${escapeHtml(c.id)}" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elev);color:var(--text);">
            ${projSelectOptions}
          </select>
          ${linkedProj ? `<button type="button" class="quiet-action-link btn-open-linked-proj" data-proj-id="${escapeHtml(linkedProj.id)}">Open Board ↗</button>` : ''}
        </div>

        <textarea class="pitch-scratchpad pitch-notes-in" data-pitch-id="${escapeHtml(c.id)}" placeholder="Notes for this email: what to attach (PDF, reel, link), contact name, angle, and follow-up...">${escapeHtml(c.notes || '')}</textarea>
      </article>
    `;
  }).join('');

  const sectionGoalDefault = spaceObj.id === 'work_apps'
    ? 'STUDIO APPLICATIONS & ROLES TRACKER'
    : (spaceObj.id === 'dream_clients'
        ? 'DREAM CLIENTS & COLD OUTREACH ENGINE'
        : (pe.goalLabel || '100 RESIDENCY & STUDIO PITCHES / MONTH'));

  ws.innerHTML = `
    <div class="outreach-engine-shell">
      <div class="minimal-inline-subbar" style="justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <strong style="font-size:12px;cursor:text;" id="btnEditQuotaLabel" data-editable-title="1" title="Click to rename goal title">${escapeHtml(sectionGoalDefault)}</strong>
          <span class="kicker-mono" id="btnEditQuotaTarget" style="cursor:pointer;" title="Click to change target number">${pe.sentCount || 0}/${pe.goalTarget || 100} Sent (${pct}%) ✎</span>
          <span class="quiet-sep">·</span>
          <span class="kicker-mono" style="color:var(--accent);">Failure is Good — <strong>🔥 ${pe.rejectionCount || 0} Rejections</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button type="button" class="quiet-action-link" id="btnIncrementPitchSent">+1 Email Sent</button>
          <button type="button" class="quiet-action-link" id="btnLogRejectionTrophy">+1 Rejection 🔥</button>
          <button type="button" class="quiet-action-link" id="btnAddPitchCard">+ New Entry</button>
        </div>
      </div>
      <div class="quota-progress-track" style="height:3px;margin-bottom:14px;">
        <div class="quota-progress-fill" style="width:${pct}%;"></div>
      </div>

      <div class="pitch-matrix-grid">${cardsHtml}</div>

      ${spaceItems.length > 0 ? `
        <div class="minimal-inline-subbar" style="margin-top:22px;">
          <span class="kicker-mono">Pinned Notes, Links &amp; Visual References (${spaceItems.length})</span>
        </div>
        <div class="cards-wall" id="movingForwardPinboard"></div>
      ` : ''}
    </div>
  `;

  const pinGrid = ws.querySelector('#movingForwardPinboard');
  if (pinGrid) {
    spaceItems.forEach((it, idx) => {
      pinGrid.appendChild(buildItemCardEl(it, idx));
    });
  }

  ws.querySelector('#btnLogRejectionTrophy')?.addEventListener('click', () => {
    pe.rejectionCount = (pe.rejectionCount || 0) + 1;
    saveVault('🔥 +1 REJECTION TROPHY LOGGED — MOMENTUM UP');
    renderWorkspace();
  });

  ws.querySelector('#btnIncrementPitchSent')?.addEventListener('click', () => {
    pe.sentCount = (pe.sentCount || 0) + 1;
    saveVault('+1 EMAIL SENT');
    renderWorkspace();
  });

  ws.querySelector('#btnEditQuotaLabel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    promptInlineRename(e.currentTarget, pe.goalLabel || '100 Monthly Outreach Emails', (val) => {
      pe.goalLabel = val;
      saveVault('UPDATED GOAL TITLE');
      renderWorkspace();
    });
  });

  ws.querySelector('#btnEditQuotaTarget')?.addEventListener('click', (e) => {
    e.stopPropagation();
    promptInlineRename(e.currentTarget, String(pe.goalTarget || 100), (val) => {
      const parsed = parseInt(val.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsed) && parsed > 0) {
        pe.goalTarget = parsed;
        pe.weeklyPaceTarget = Math.max(1, Math.round(pe.goalTarget / 4));
        saveVault('UPDATED QUOTA TARGET');
        renderWorkspace();
      }
    });
  });

  ws.querySelectorAll('.pitch-card-title').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = pe.cards.find(x => x.id === el.dataset.pitchId);
      if (!card) return;
      promptInlineRename(el, card.title, (val) => {
        card.title = val;
        saveVault('RENAMED OUTREACH CARD');
        renderWorkspace();
      });
    });
  });

  ws.querySelectorAll('.pitch-linked-proj-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const card = pe.cards.find(x => x.id === sel.dataset.pitchId);
      if (card) {
        card.linkedProjectId = sel.value || '';
        saveVault('LINKED STUDIO PROJECT TO PITCH');
        renderWorkspace();
      }
    });
  });

  ws.querySelectorAll('.btn-open-linked-proj').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.projId) openProjectBoard(btn.dataset.projId);
    });
  });

  ws.querySelector('#btnAddPitchCard')?.addEventListener('click', () => {
    const defaultTitle = spaceObj.id === 'work_apps'
      ? 'New Studio / Role Application'
      : (spaceObj.id === 'dream_clients' ? 'New Dream Client Pitch' : 'New Residency / Grant Application');
    const defaultCat = (state.activeCategory && state.activeCategory !== firstCat)
      ? state.activeCategory
      : ((spaceObj.categories && spaceObj.categories[1]) || 'Residencies');
    const newId = 'pitch_' + Date.now();
    pe.cards.unshift({
      id: newId,
      spaceId: spaceObj.id,
      title: defaultTitle,
      category: defaultCat,
      deadline: 'Rolling',
      status: '🎯 Drafting',
      link: '',
      linkedProjectId: '',
      requirements: { portfolioPdf: false, websiteLink: true, cv: false, artistStatement: false, projectProposal: false },
      notes: ''
    });
    saveVault('ADDED OUTREACH ENTRY');
    renderAll();
    requestAnimationFrame(() => {
      const titleEl = document.querySelector(`.pitch-card-title[data-pitch-id="${newId}"]`);
      if (titleEl) {
        promptInlineRename(titleEl, defaultTitle, (val) => {
          const c = pe.cards.find(x => x.id === newId);
          if (c) { c.title = val; saveVault('RENAMED OUTREACH CARD'); renderWorkspace(); }
        });
      }
    });
  });

  ws.querySelectorAll('.req-check-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = pe.cards.find(x => x.id === btn.dataset.pitchId);
      if (!card) return;
      card.requirements = card.requirements || {};
      const k = btn.dataset.reqKey;
      card.requirements[k] = !card.requirements[k];
      saveVault('UPDATED PITCH CHECKLIST');
      renderWorkspace();
    });
  });

  ws.querySelectorAll('.pitch-notes-in').forEach(area => {
    area.addEventListener('change', () => {
      const card = pe.cards.find(x => x.id === area.dataset.pitchId);
      if (card) {
        card.notes = area.value;
        saveVault('SAVED PITCH NOTES');
      }
    });
  });

  ws.querySelectorAll('.btn-pitch-mark-sent').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = pe.cards.find(x => x.id === btn.dataset.pitchId);
      if (card) {
        card.status = '✓ Submitted';
        pe.sentCount = (pe.sentCount || 0) + 1;
        saveVault('PITCH SUBMITTED (+1 QUOTA)');
        renderWorkspace();
      }
    });
  });

  ws.querySelectorAll('.btn-pitch-mark-rej').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = pe.cards.find(x => x.id === btn.dataset.pitchId);
      if (card) {
        card.status = '🔥 Rejection Logged (Good!)';
        pe.rejectionCount = (pe.rejectionCount || 0) + 1;
        saveVault('🔥 REJECTION LOGGED — VOLUME PROOF');
        renderWorkspace();
      }
    });
  });

  ws.querySelectorAll('.btn-del-pitch').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pitchId;
      pe.cards = pe.cards.filter(x => x.id !== id);
      saveVault('REMOVED PITCH CARD');
      renderAll();
    });
  });
}

/* --------------------------------------------------------------------------
   MODULE 6: 05 TOOL DOCK & R&D LAB (Visual Icon Launchpad + 3-Lane Wishlist)
   -------------------------------------------------------------------------- */
function renderToolDockAndRdLab(ws, spaceObj) {
  if (!vault.toolDock) {
    vault.toolDock = createDefaultToolDockSeed();
  }
  const td = vault.toolDock;
  if ((!Array.isArray(td.launchpad) || td.launchpad.some(x => !x.name)) && Array.isArray(td.tools)) {
    td.launchpad = td.tools.map(t => {
      const titleStr = t.name || t.title || 'Studio Tool';
      return {
        id: t.id,
        name: titleStr,
        sub: t.sub || t.badge || t.desc || 'Studio Tool',
        cluster: t.cluster || t.category || 'AI Pipelines',
        icon: t.icon || t.monogram || titleStr.slice(0, 2).toUpperCase(),
        color: t.color || '#181715',
        url: t.url || t.link || ''
      };
    });
  }
  if ((!Array.isArray(td.rdLab) || td.rdLab.length === 0) && Array.isArray(td.rdItems) && td.rdItems.length > 0) {
    td.rdLab = td.rdItems.map(r => ({
      id: r.id,
      lane: r.lane || 'explore',
      title: r.title || r.name || 'R&D Item',
      priceOrTag: r.priceOrTag || r.priceNote || 'R&D',
      notes: r.notes || '',
      url: r.url || r.link || '',
      targetCluster: r.targetCluster || r.category || 'AI Pipelines'
    }));
  }
  if (!Array.isArray(td.rdLab) || td.rdLab.length === 0) {
    td.rdLab = (createDefaultToolDockSeed().rdItems || []).map(r => ({
      id: r.id,
      lane: r.lane || 'explore',
      title: r.title || r.name || 'R&D Item',
      priceOrTag: r.priceOrTag || r.priceNote || 'R&D',
      notes: r.notes || '',
      url: r.url || r.link || '',
      targetCluster: r.targetCluster || r.category || 'AI Pipelines'
    }));
  }
  td.launchpad = td.launchpad || [];
  td.rdLab = td.rdLab || [];
  const firstCat = (spaceObj.categories && spaceObj.categories[0]) || 'All Tools & Lab';

  const clusterNames = ['AI Pipelines', '3D & Render', 'Typography & Foundries', 'Motion & VJ', 'Admin & Utils'];
  const visibleClusters = clusterNames.filter(cn => {
    if (state.activeCategory && state.activeCategory !== firstCat && state.activeCategory !== 'R&D Lab' && state.activeCategory !== cn) {
      return false;
    }
    return true;
  });

  const clustersHtml = visibleClusters.map(clusterName => {
    const tools = (td.launchpad || []).filter(t => {
      if (t.cluster !== clusterName) return false;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        if (!`${t.name} ${t.sub} ${t.cluster}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const tilesHtml = tools.map(t => `
      <div class="tool-icon-tile" data-tool-id="${escapeHtml(t.id)}" data-tool-url="${escapeHtml(t.url)}" title="1-Click Launch: ${escapeHtml(t.url)} · Double-click title to rename">
        <div class="tool-icon-monogram" style="background:${escapeHtml(t.color || '#181715')};">${escapeHtml(t.icon || '⚡')}</div>
        <div class="tool-icon-name" data-editable-title="1" data-tool-id="${escapeHtml(t.id)}" title="Click to rename tool">${escapeHtml(t.name)}</div>
        <div class="tool-icon-sub">${escapeHtml(t.sub || '')}</div>
      </div>
    `).join('');

    return `
      <div class="tool-cluster-drawer">
        <div class="tool-cluster-header">
          <span class="tool-cluster-title" data-editable-title="1" data-cluster-name="${escapeHtml(clusterName)}" title="Click to rename cluster">${escapeHtml(clusterName)}</span>
          <span class="sidebar-count-pill">${tools.length}</span>
        </div>
        <div class="tool-icon-grid">${tilesHtml}</div>
      </div>
    `;
  }).join('');

  const laneTitles = td.laneTitles || {};
  const lanes = [
    { key: 'explore', title: laneTitles.explore || '01 / TO TEST & EXPLORE', badge: 'AI / Shaders / Plugins' },
    { key: 'subs', title: laneTitles.subs || '02 / SUBSCRIPTIONS & BUY LIST', badge: 'Pricing & Value Tracker' },
    { key: 'build', title: laneTitles.build || '03 / TO BUILD & IMPLEMENT', badge: 'Antigravity / Scripts / Nodes' }
  ];

  const lanesHtml = lanes.map(lane => {
    const lItems = (td.rdLab || []).filter(x => x.lane === lane.key);
    const cardsHtml = lItems.map(item => `
      <div class="rd-lab-item-card" data-rd-id="${escapeHtml(item.id)}">
        <div class="rd-item-top">
          <div class="rd-item-title" data-editable-title="1" data-rd-id="${escapeHtml(item.id)}" title="Click to rename">${escapeHtml(item.title)}</div>
          <span class="rd-item-price-tag">${escapeHtml(item.priceOrTag || '')}</span>
        </div>
        <div class="rd-item-notes">${escapeHtml(item.notes || '')}</div>
        <div class="rd-item-actions">
          <button type="button" class="btn-promote-tool" data-rd-id="${escapeHtml(item.id)}" title="Promote this item directly onto your active Visual Launchpad">↑ Promote to Launchpad</button>
          <div style="display:flex;gap:6px;">
            ${item.url ? `<button type="button" class="hover-act-btn btn-open-rd-url" data-url="${escapeHtml(item.url)}" style="opacity:1;">Open ↗</button>` : ''}
            <button type="button" class="hover-act-btn danger btn-del-rd" data-rd-id="${escapeHtml(item.id)}" style="opacity:1;">×</button>
          </div>
        </div>
      </div>
    `).join('');

    return `
      <div class="rd-lane-col">
        <div class="rd-lane-header">
          <div>
            <div class="rd-lane-title" data-editable-title="1" data-lane-key="${escapeHtml(lane.key)}" title="Click to rename lane">${escapeHtml(lane.title)}</div>
            <div class="kicker-mono" style="font-size:9.5px;">${escapeHtml(lane.badge)}</div>
          </div>
          <button type="button" class="outline-btn btn-add-rd-item" data-lane="${lane.key}" style="padding:3px 9px;font-size:10px;">+ Add</button>
        </div>
        ${cardsHtml}
      </div>
    `;
  }).join('');

  ws.innerHTML = `
    <div class="tool-dock-shell">
      <div class="minimal-inline-subbar" style="justify-content:space-between;">
        <span class="kicker-mono">Active Launchpad</span>
        <button type="button" class="quiet-action-link" id="btnAddLaunchpadTool">+ Add Tool</button>
      </div>

      <div class="launchpad-clusters-grid">${clustersHtml}</div>

      <div class="minimal-inline-subbar" style="margin-top:16px;">
        <span class="kicker-mono">R&amp;D Lab &amp; Wishlist</span>
      </div>

      <div class="rd-lab-lanes-grid">${lanesHtml}</div>
    </div>
  `;

  ws.querySelectorAll('.tool-icon-name').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const tool = (td.launchpad || []).find(t => t.id === el.dataset.toolId);
      if (!tool) return;
      promptInlineRename(el, tool.name, (val) => {
        tool.name = val;
        saveVault('RENAMED TOOL');
        renderWorkspace();
      });
    });
  });

  ws.querySelectorAll('.tool-cluster-title').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const oldName = el.dataset.clusterName;
      promptInlineRename(el, oldName, (val) => {
        (td.launchpad || []).forEach(t => { if (t.cluster === oldName) t.cluster = val; });
        const catIdx = (spaceObj.categories || []).indexOf(oldName);
        if (catIdx !== -1) spaceObj.categories[catIdx] = val;
        saveVault('RENAMED TOOL CLUSTER');
        renderAll();
      });
    });
  });

  ws.querySelectorAll('.rd-lane-title').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.dataset.laneKey;
      promptInlineRename(el, el.textContent.trim(), (val) => {
        td.laneTitles = td.laneTitles || {};
        td.laneTitles[key] = val;
        saveVault('RENAMED R&D LANE');
        renderWorkspace();
      });
    });
  });

  ws.querySelectorAll('.rd-item-title').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const rdItem = (td.rdLab || []).find(r => r.id === el.dataset.rdId);
      if (!rdItem) return;
      promptInlineRename(el, rdItem.title, (val) => {
        rdItem.title = val;
        saveVault('RENAMED R&D ITEM');
        renderWorkspace();
      });
    });
  });

  // 1-Click External Launch or Local Mac Path reveal
  ws.querySelectorAll('.tool-icon-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const url = tile.dataset.toolUrl;
      if (url) openUrlOrMacPath(url);
    });
  });

  ws.querySelector('#btnAddLaunchpadTool')?.addEventListener('click', () => {
    const defaultCluster = (state.activeCategory && clusterNames.includes(state.activeCategory))
      ? state.activeCategory
      : 'AI Pipelines';
    const newId = 'tl_' + Date.now();
    td.launchpad.unshift({
      id: newId,
      name: 'New Studio Tool',
      sub: 'Click title to rename',
      cluster: defaultCluster,
      icon: '⚡',
      color: '#C84B31',
      url: 'https://'
    });
    saveVault('ADDED TOOL TO LAUNCHPAD');
    renderAll();
    requestAnimationFrame(() => {
      const nameEl = document.querySelector(`.tool-icon-name[data-tool-id="${newId}"]`);
      if (nameEl) {
        promptInlineRename(nameEl, 'New Studio Tool', (val) => {
          const t = (td.launchpad || []).find(x => x.id === newId);
          if (t) {
            t.name = val;
            t.icon = val.slice(0, 2).toUpperCase();
            saveVault('RENAMED TOOL');
            renderWorkspace();
          }
        });
      }
    });
  });

  ws.querySelectorAll('.btn-add-rd-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const lane = btn.dataset.lane;
      const newId = 'rd_' + Date.now();
      td.rdLab.unshift({
        id: newId,
        lane,
        title: 'New R&D / Wishlist Item',
        priceOrTag: lane === 'subs' ? 'Subscription' : (lane === 'build' ? 'Workflow' : 'R&D'),
        notes: 'Click title to rename…',
        url: '',
        targetCluster: lane === 'build' ? 'Admin & Utils' : 'AI Pipelines'
      });
      saveVault('ADDED R&D LAB ITEM');
      renderAll();
      requestAnimationFrame(() => {
        const titleEl = document.querySelector(`.rd-item-title[data-rd-id="${newId}"]`);
        if (titleEl) {
          promptInlineRename(titleEl, 'New R&D / Wishlist Item', (val) => {
            const r = (td.rdLab || []).find(x => x.id === newId);
            if (r) { r.title = val; saveVault('RENAMED R&D ITEM'); renderWorkspace(); }
          });
        }
      });
    });
  });

  // 1-Click Promotion Flow from R&D Lab to Active Visual Launchpad!
  ws.querySelectorAll('.btn-promote-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = td.rdLab.findIndex(x => x.id === btn.dataset.rdId);
      if (idx === -1) return;
      const [promoted] = td.rdLab.splice(idx, 1);
      td.launchpad.unshift({
        id: 'tl_prom_' + Date.now(),
        name: promoted.title.split('—')[0].trim(),
        sub: promoted.priceOrTag || 'Promoted from R&D',
        cluster: promoted.targetCluster || 'AI Pipelines',
        icon: promoted.title.slice(0, 2).toUpperCase(),
        color: '#0D9488',
        url: promoted.url || 'https://google.com'
      });
      saveVault('↑ PROMOTED TO ACTIVE LAUNCHPAD');
      renderAll();
    });
  });

  ws.querySelectorAll('.btn-open-rd-url').forEach(btn => {
    btn.addEventListener('click', () => openUrlOrMacPath(btn.dataset.url));
  });

  ws.querySelectorAll('.btn-del-rd').forEach(btn => {
    btn.addEventListener('click', () => {
      td.rdLab = td.rdLab.filter(x => x.id !== btn.dataset.rdId);
      saveVault('REMOVED R&D ITEM');
      renderAll();
    });
  });
}

/* --------------------------------------------------------------------------
   09 CUSTOMIZE & DESIGN STUDIO VIEW (Full Typography, Palette & Section UI)
   -------------------------------------------------------------------------- */
function renderCustomizeView(ws) {
  const c = vault.customization;

  const headingButtons = FONT_OPTIONS_HEADING.map(f => `
    <button type="button" class="font-option-btn ${c.fontHeading === f.value ? 'active' : ''}" data-font-heading="${escapeHtml(f.value)}" style="font-family:${escapeHtml(f.value)};">
      <span style="font-size:14px;font-weight:600;">${escapeHtml(f.label.split(' (')[0])}</span>
      <span class="kicker-mono">${escapeHtml(f.label.split(' (')[1]?.replace(')', '') || 'Heading')}</span>
    </button>
  `).join('');

  const bodyButtons = FONT_OPTIONS_BODY.map(f => `
    <button type="button" class="font-option-btn ${c.fontBody === f.value ? 'active' : ''}" data-font-body="${escapeHtml(f.value)}" style="font-family:${escapeHtml(f.value)};">
      <span style="font-size:13px;">${escapeHtml(f.label.split(' (')[0])}</span>
      <span class="kicker-mono">${escapeHtml(f.label.split(' (')[1]?.replace(')', '') || 'Notes')}</span>
    </button>
  `).join('');

  const monoButtons = FONT_OPTIONS_MONO.map(f => `
    <button type="button" class="font-option-btn ${c.fontMono === f.value ? 'active' : ''}" data-font-mono="${escapeHtml(f.value)}" style="font-family:${escapeHtml(f.value)};">
      <span style="font-size:12.5px;">${escapeHtml(f.label)}</span>
      <span class="kicker-mono">01 / BADGE &amp; UI</span>
    </button>
  `).join('');

  const themeButtons = Object.entries(THEME_PRESETS).map(([key, p]) => `
    <button type="button" class="theme-preset-btn ${c.themePreset === key ? 'active' : ''}" data-theme-key="${key}">
      <span style="width:12px;height:12px;border-radius:50%;background:${p.bg};border:1px solid ${p.strong};display:inline-block;"></span>
      <span>${escapeHtml(p.name)}</span>
    </button>
  `).join('');

  const sectionsRowsHtml = vault.spaces.filter(s => s.id !== 'customize').map(sp => {
    const isGDrive = sp.id === 'gdrive_assets';
    const hasSphere = sp.id === 'projects' || sp.id === 'incubator';
    return `
      <div style="display:grid;grid-template-columns:50px 1.2fr 1.2fr 1fr 1fr;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <input type="text" class="inspector-input sec-code-in" data-sec-id="${sp.id}" value="${escapeHtml(sp.code)}" title="Section code">
        <input type="text" class="inspector-input sec-title-in" data-sec-id="${sp.id}" value="${escapeHtml(sp.title)}" title="Sidebar label">
        <input type="text" class="inspector-input sec-heading-in" data-sec-id="${sp.id}" value="${escapeHtml(sp.heading || sp.title)}" title="Page heading">
        <select class="inspector-input sec-layout-in" data-sec-id="${sp.id}">
          ${isGDrive ? `<option value="eagle" selected>🦅 Eagle Asset Browser</option>` : `
            ${hasSphere ? `<option value="sphere" ${sp.ui?.layoutMode === 'sphere' ? 'selected' : ''}>◎ 3D Sphere Stage</option>` : ''}
            <option value="giant_wall" ${sp.ui?.layoutMode === 'giant_wall' ? 'selected' : ''}>✥ Giant Wall (Spatial)</option>
            <option value="wall" ${sp.ui?.layoutMode === 'wall' ? 'selected' : ''}>⊞ Clear Drawers / Wall</option>
            <option value="list" ${sp.ui?.layoutMode === 'list' ? 'selected' : ''}>☰ Visual List</option>
            <option value="kanban" ${sp.ui?.layoutMode === 'kanban' ? 'selected' : ''}>▤ Columns</option>
          `}
        </select>
        <select class="inspector-input sec-aspect-in" data-sec-id="${sp.id}">
          <option value="16 / 10.5" ${sp.ui?.aspectRatio === '16 / 10.5' ? 'selected' : ''}>16:10 Stage</option>
          <option value="4 / 3" ${sp.ui?.aspectRatio === '4 / 3' ? 'selected' : ''}>4:3 Stage</option>
          <option value="1 / 1" ${sp.ui?.aspectRatio === '1 / 1' ? 'selected' : ''}>1:1 Square</option>
          <option value="4 / 5" ${sp.ui?.aspectRatio === '4 / 5' ? 'selected' : ''}>4:5 Portrait</option>
        </select>
      </div>
    `;
  }).join('');

  ws.innerHTML = `
    <div class="customizer-grid">
      <!-- PANEL 1: TYPOGRAPHY & FONTS -->
      <section class="customizer-panel">
        <div class="panel-header">
          <div class="kicker-mono">01 / TYPOGRAPHY &amp; TYPEWRITER PAIRING</div>
          <h3>Fonts &amp; Scale</h3>
        </div>

        <div>
          <div class="kicker-mono" style="margin-bottom:6px;">PROJECT &amp; PAGE HEADING FONT</div>
          <div class="font-preset-grid">${headingButtons}</div>
        </div>

        <div>
          <div class="kicker-mono" style="margin-bottom:6px;">NOTES &amp; DESCRIPTION FONT (TYPEWRITER / EDITORIAL)</div>
          <div class="font-preset-grid">${bodyButtons}</div>
        </div>

        <div>
          <div class="kicker-mono" style="margin-bottom:6px;">BADGES, NUMBERS &amp; BUTTONS MONO FONT</div>
          <div class="font-preset-grid">${monoButtons}</div>
        </div>

        <div class="setting-row">
          <span class="kicker-mono">BASE TEXT SIZE (${c.baseFontSize}px)</span>
          <input type="range" id="custFontSize" min="12" max="16" step="0.5" value="${c.baseFontSize}" style="width:160px;">
        </div>

        <div class="setting-row">
          <span class="kicker-mono">HEADING SCALE (${Math.round((c.headingScale || 1) * 100)}%)</span>
          <input type="range" id="custHeadingScale" min="0.85" max="1.35" step="0.05" value="${c.headingScale || 1}" style="width:160px;">
        </div>
      </section>

      <!-- PANEL 2: COLOR PALETTE, THEME & CARDS -->
      <section class="customizer-panel">
        <div class="panel-header">
          <div class="kicker-mono">02 / GALLERY ATMOSPHERE &amp; CARD GEOMETRY</div>
          <h3>Theme Presets, Custom Colors &amp; Cards</h3>
        </div>

        <div>
          <div class="kicker-mono" style="margin-bottom:8px;">GALLERY VIBE PRESETS</div>
          <div class="color-swatch-row">${themeButtons}</div>
        </div>

        <div>
          <div class="kicker-mono" style="margin-bottom:8px;">CUSTOM COLOR OVERRIDES (CLICK TO PICK)</div>
          <div class="color-swatch-row">
            <label class="outline-btn">BG <input type="color" id="colBg" value="${c.customColors?.bg || '#F6F4EF'}"></label>
            <label class="outline-btn">Card <input type="color" id="colSurface" value="${c.customColors?.surface || '#FAF8F5'}"></label>
            <label class="outline-btn">Stage <input type="color" id="colStage" value="${c.customColors?.stage || '#E8E4DC'}"></label>
            <label class="outline-btn">Ink <input type="color" id="colText" value="${c.customColors?.text || '#181715'}"></label>
            <label class="outline-btn">Accent <input type="color" id="colAccent" value="${c.customColors?.accent || '#C84B31'}"></label>
          </div>
        </div>

        <div class="setting-row">
          <span class="kicker-mono">CARD CORNER RADIUS (${c.cardRadius}px)</span>
          <input type="range" id="custCardRadius" min="0" max="18" step="2" value="${c.cardRadius ?? 6}" style="width:160px;">
        </div>

        <div class="setting-row">
          <span class="kicker-mono">GRID SPACING GAP (${c.gridGap}px)</span>
          <input type="range" id="custGridGap" min="10" max="36" step="2" value="${c.gridGap ?? 20}" style="width:160px;">
        </div>

        <div class="setting-row">
          <span class="kicker-mono">SIDEBAR BEHAVIOR</span>
          <label class="chk-row">
            <input type="checkbox" id="custSidebarPinned" ${c.sidebarPinned !== false ? 'checked' : ''}>
            <span>Dock sidebar permanently on left (uncheck for pop-up drawer)</span>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:6px;border-top:1px solid var(--border);">
          <label class="chk-row"><input type="checkbox" id="togIndex" ${c.showIndexBadge !== false ? 'checked' : ''}> <span>Show #01 Index Numbers</span></label>
          <label class="chk-row"><input type="checkbox" id="togStatus" ${c.showStatusBadge !== false ? 'checked' : ''}> <span>Show Status Badges</span></label>
          <label class="chk-row"><input type="checkbox" id="togCount" ${c.showCountBadge !== false ? 'checked' : ''}> <span>Show Item Count Pill</span></label>
          <label class="chk-row"><input type="checkbox" id="togTags" ${c.showCardTags !== false ? 'checked' : ''}> <span>Show Card Tag Chips</span></label>
        </div>
      </section>

      <!-- PANEL 3: PER-SECTION COPY & UX/UI EDITOR -->
      <section class="customizer-panel" style="grid-column: 1 / -1;">
        <div class="panel-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="kicker-mono">03 / SIDEBAR COPY &amp; PER-SECTION UX/UI DEFAULTS</div>
            <h3>Customize Every Section's Text, Layout Mode &amp; Aspect Ratio</h3>
          </div>
          <button type="button" class="outline-btn" id="btnResetDefaults">Reset Visual Defaults</button>
        </div>

        <div style="display:grid;grid-template-columns:50px 1.2fr 1.2fr 1fr 1fr;gap:8px;" class="kicker-mono">
          <span>CODE</span>
          <span>SIDEBAR NAME</span>
          <span>TOP PAGE HEADING</span>
          <span>DEFAULT VIEW</span>
          <span>STAGE ASPECT</span>
        </div>
        <div>${sectionsRowsHtml}</div>
      </section>
    </div>
  `;

  // Bind font buttons
  ws.querySelectorAll('[data-font-heading]').forEach(btn => {
    btn.addEventListener('click', () => {
      c.fontHeading = btn.dataset.fontHeading;
      saveVault();
      renderAll();
    });
  });
  ws.querySelectorAll('[data-font-body]').forEach(btn => {
    btn.addEventListener('click', () => {
      c.fontBody = btn.dataset.fontBody;
      saveVault();
      renderAll();
    });
  });
  ws.querySelectorAll('[data-font-mono]').forEach(btn => {
    btn.addEventListener('click', () => {
      c.fontMono = btn.dataset.fontMono;
      saveVault();
      renderAll();
    });
  });

  // Sliders
  ws.querySelector('#custFontSize')?.addEventListener('input', (e) => {
    c.baseFontSize = parseFloat(e.target.value);
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#custHeadingScale')?.addEventListener('input', (e) => {
    c.headingScale = parseFloat(e.target.value);
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#custCardRadius')?.addEventListener('input', (e) => {
    c.cardRadius = parseInt(e.target.value, 10);
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#custGridGap')?.addEventListener('input', (e) => {
    c.gridGap = parseInt(e.target.value, 10);
    saveVault();
    applyCustomizationToDOM();
  });

  // Theme presets
  ws.querySelectorAll('[data-theme-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      c.themePreset = btn.dataset.themeKey;
      saveVault();
      renderAll();
    });
  });

  // Custom color pickers
  const bindColor = (id, key) => {
    ws.querySelector(id)?.addEventListener('input', (e) => {
      c.themePreset = 'custom';
      c.customColors = c.customColors || {};
      c.customColors[key] = e.target.value;
      saveVault();
      applyCustomizationToDOM();
    });
  };
  bindColor('#colBg', 'bg');
  bindColor('#colSurface', 'surface');
  bindColor('#colStage', 'stage');
  bindColor('#colText', 'text');
  bindColor('#colAccent', 'accent');

  // Checkboxes
  ws.querySelector('#custSidebarPinned')?.addEventListener('change', (e) => {
    c.sidebarPinned = e.target.checked;
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#togIndex')?.addEventListener('change', (e) => {
    c.showIndexBadge = e.target.checked;
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#togStatus')?.addEventListener('change', (e) => {
    c.showStatusBadge = e.target.checked;
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#togCount')?.addEventListener('change', (e) => {
    c.showCountBadge = e.target.checked;
    saveVault();
    applyCustomizationToDOM();
  });
  ws.querySelector('#togTags')?.addEventListener('change', (e) => {
    c.showCardTags = e.target.checked;
    saveVault();
    applyCustomizationToDOM();
  });

  // Per-section rows
  ws.querySelectorAll('.sec-code-in').forEach(inp => {
    inp.addEventListener('change', () => {
      const sp = vault.spaces.find(s => s.id === inp.dataset.secId);
      if (sp) { sp.code = inp.value.trim(); saveVault(); renderSidebar(); }
    });
  });
  ws.querySelectorAll('.sec-title-in').forEach(inp => {
    inp.addEventListener('change', () => {
      const sp = vault.spaces.find(s => s.id === inp.dataset.secId);
      if (sp) { sp.title = inp.value.trim(); saveVault(); renderSidebar(); }
    });
  });
  ws.querySelectorAll('.sec-heading-in').forEach(inp => {
    inp.addEventListener('change', () => {
      const sp = vault.spaces.find(s => s.id === inp.dataset.secId);
      if (sp) { sp.heading = inp.value.trim(); saveVault(); }
    });
  });
  ws.querySelectorAll('.sec-layout-in').forEach(sel => {
    sel.addEventListener('change', () => {
      const sp = vault.spaces.find(s => s.id === sel.dataset.secId);
      if (sp) { sp.ui = sp.ui || {}; sp.ui.layoutMode = sel.value; saveVault(); }
    });
  });
  ws.querySelectorAll('.sec-aspect-in').forEach(sel => {
    sel.addEventListener('change', () => {
      const sp = vault.spaces.find(s => s.id === sel.dataset.secId);
      if (sp) { sp.ui = sp.ui || {}; sp.ui.aspectRatio = sel.value; saveVault(); }
    });
  });

  ws.querySelector('#btnResetDefaults')?.addEventListener('click', () => {
    vault.customization = createSeedVault().customization;
    vault = ensureVaultSleekAndGDrive(vault);
    saveVault();
    renderAll();
  });
}

/* ==========================================================================
   QUICK INLINE COMPOSER, FILE UPLOADS, MODALS & EVENT LISTENERS
   ========================================================================== */
function openQuickComposer(kind = 'note') {
  const bar = document.getElementById('quickComposerBar');
  if (!bar) return;
  bar.hidden = false;

  const { type, obj } = getActiveContainer();
  const targetParentType = (type === 'space' && obj.id === 'projects') ? 'project' : type;
  const targetParentId = (type === 'space' && obj.id === 'projects') ? (vault.projects[0]?.id || 'proj_test_sculpt') : obj.id;
  const secDefault = (state.activeCategory && !state.activeCategory.startsWith('All')) ? state.activeCategory : 'Notes';

  bar.innerHTML = `
    <span class="kicker-mono" style="color:var(--accent);">${kind === 'link' ? '+ ADD LINK / LOCAL MAC PATH' : '+ ADD NOTE / INTERACTIVE CHECKLIST'}</span>
    <input type="text" id="qcTitle" class="inspector-input" style="max-width:240px;" placeholder="${kind === 'link' ? 'Title (e.g. Render Folder)...' : 'Title (e.g. Sculpting To-Do)...'}">
    ${kind === 'link'
      ? `<input type="text" id="qcLink" class="inspector-input" style="flex:1;min-width:220px;" placeholder="https://... or ~/Desktop/3d projects 2026">`
      : `<input type="text" id="qcNotes" class="inspector-input" style="flex:1;min-width:240px;" placeholder="Write note or use [ ] Task 1  [ ] Task 2 for checkboxes...">`
    }
    <input type="text" id="qcStatus" class="inspector-input" style="max-width:140px;" placeholder="Badge (e.g. WIP)">
    <button type="button" class="primary-block-btn" id="btnQcSave" style="width:auto;padding:7px 16px;">Add to Vault</button>
    <button type="button" class="outline-btn" id="btnQcChecklistTpl" title="Insert [ ] checkboxes">+ [ ] Task</button>
    <button type="button" class="icon-chip" id="btnQcCancel">✕</button>
  `;

  const titleIn = bar.querySelector('#qcTitle');
  titleIn?.focus();

  bar.querySelector('#btnQcChecklistTpl')?.addEventListener('click', () => {
    const notesIn = bar.querySelector('#qcNotes');
    if (notesIn) {
      notesIn.value = (notesIn.value ? notesIn.value + '\n' : '') + '[ ] First task\n[ ] Second task';
      notesIn.focus();
    }
  });

  bar.querySelector('#btnQcCancel')?.addEventListener('click', () => {
    bar.hidden = true;
  });

  bar.querySelector('#btnQcSave')?.addEventListener('click', () => {
    const title = (bar.querySelector('#qcTitle')?.value || '').trim() || (kind === 'link' ? 'Saved Link / Path' : 'Studio Note');
    const link = (bar.querySelector('#qcLink')?.value || '').trim();
    const rawNotes = (bar.querySelector('#qcNotes')?.value || '').trim();
    const status = (bar.querySelector('#qcStatus')?.value || '').trim() || (kind === 'link' ? '🔗 Link' : '📝 Note');

    const newItem = {
      id: 'itm_' + Date.now(),
      parentType: targetParentType,
      parentId: targetParentId,
      section: secDefault,
      kind: rawNotes.includes('[ ]') ? 'checklist' : kind,
      title,
      status,
      url: '',
      notes: rawNotes,
      tags: [secDefault],
      link,
      createdAt: Date.now()
    };

    vault.items.unshift(newItem);
    bar.hidden = true;
    saveVault();
    renderAll();
  });
}

async function handleFilesUpload(fileList) {
  if (!fileList || fileList.length === 0) return;

  const { type, obj } = getActiveContainer();
  let targetParentType = type;
  let targetParentId = obj.id;
  if (type === 'space' && (obj.id === 'projects' || obj.id === 'customize' || obj.id === 'finland')) {
    targetParentType = 'project';
    targetParentId = vault.projects[0]?.id || 'proj_test_sculpt';
  }
  const secDefault = (state.activeCategory && !state.activeCategory.startsWith('All')) ? state.activeCategory : 'Uploaded';

  const syncText = document.getElementById('syncStatusText');
  if (syncText) syncText.textContent = `UPLOADING ${fileList.length} FILE(S) IN ORIGINAL QUALITY...`;

  try {
    for (const file of Array.from(fileList)) {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'X-File-Name': encodeURIComponent(file.name)
        },
        body: file
      });
      if (res.ok) {
        const u = await res.json();
        const ext = (u.fileName || file.name || '').split('.').pop().toLowerCase();
        let kind = 'image';
        if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) kind = 'video';
        else if (['wav', 'mp3', 'aiff', 'flac', 'm4a', 'ogg'].includes(ext)) kind = 'audio';

        const cleanUrl = (u.fileUrl || '').replace(/^\//, '');
        vault.items.unshift({
          id: 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          parentType: targetParentType,
          parentId: targetParentId,
          section: secDefault,
          kind,
          title: u.fileName || file.name,
          status: '✨ Original',
          url: cleanUrl,
          notes: `Original quality file (${formatBytes(u.fileSize || file.size || 0)}) stored uncompressed in vault_media.`,
          tags: [kind.toUpperCase(), 'Original Quality'],
          link: '',
          createdAt: Date.now()
        });
      }
    }
    saveVault('UPLOADED • ORIGINAL QUALITY SAVED');
    renderAll();
  } catch (err) {
    console.error('Upload failed:', err);
  }
}

/* --------------------------------------------------------------------------
   ITEM INSPECTOR MODAL & PROJECT BOARD EDITOR MODAL
   -------------------------------------------------------------------------- */
function openItemInspector(itemId) {
  const it = vault.items.find(i => i.id === itemId);
  if (!it) return;
  state.editingItemId = it.id;

  const dlg = document.getElementById('itemDialog');
  const stage = document.getElementById('sheetMedia');
  const meta = document.getElementById('sheetFileMeta');
  const titleIn = document.getElementById('sheetTitle');
  const statusIn = document.getElementById('sheetStatusInput');
  const notesIn = document.getElementById('sheetNotes');
  const parentSel = document.getElementById('sheetParentSelect');
  const secIn = document.getElementById('sheetSectionInput');
  const tagsIn = document.getElementById('sheetTagsInput');
  const linkIn = document.getElementById('sheetLinkInput');
  const dlRow = document.getElementById('sheetDownloadRow');

  if (meta) meta.textContent = `${(it.kind || 'ITEM').toUpperCase()} • ${it.section || 'VAULT'}`;
  if (titleIn) titleIn.value = it.title || '';
  if (statusIn) statusIn.value = it.status || '';
  if (notesIn) notesIn.value = it.notes || '';
  if (secIn) secIn.value = it.section || '';
  if (tagsIn) tagsIn.value = (it.tags || []).join(', ');
  if (linkIn) linkIn.value = it.link || '';

  if (parentSel) {
    const projOpts = vault.projects.map(p => `<option value="project:${p.id}" ${it.parentType === 'project' && it.parentId === p.id ? 'selected' : ''}>Project: ${escapeHtml(p.title)}</option>`).join('');
    const spaceOpts = vault.spaces.filter(s => !['projects', 'finland', 'customize'].includes(s.id)).map(s => `<option value="space:${s.id}" ${it.parentType === 'space' && it.parentId === s.id ? 'selected' : ''}>Section: ${escapeHtml(s.code)} ${escapeHtml(s.title)}</option>`).join('');
    parentSel.innerHTML = `<optgroup label="Project Boards">${projOpts}</optgroup><optgroup label="Sidebar Sections">${spaceOpts}</optgroup>`;
  }

  if (stage) {
    if (it.kind === 'video' && it.url) {
      stage.innerHTML = `<video src="${escapeHtml(it.url)}" controls autoplay loop playsinline></video>`;
    } else if (it.url && it.kind !== 'audio') {
      stage.innerHTML = `<img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.title)}">`;
    } else if (it.kind === 'audio' && it.url) {
      stage.innerHTML = `
        <div style="text-align:center;width:100%;padding:32px;">
          <div class="kicker-mono" style="margin-bottom:12px;">🔊 ORIGINAL QUALITY AUDIO</div>
          <audio src="${escapeHtml(it.url)}" controls autoplay style="width:100%;max-width:360px;"></audio>
        </div>
      `;
    } else {
      stage.innerHTML = `<div class="stage-note-pad" style="max-width:520px;height:auto;border:1px solid var(--border);border-radius:6px;padding:24px;">${renderChecklistHtml(it.notes || it.title)}</div>`;
      stage.querySelectorAll('.chk-row input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', () => {
          const lineIdx = parseInt(chk.dataset.line, 10);
          toggleChecklistLine(it.id, lineIdx);
          if (notesIn) notesIn.value = it.notes;
        });
      });
    }
  }

  if (dlRow) {
    dlRow.innerHTML = it.url
      ? `<a href="${escapeHtml(it.url)}" download class="outline-btn">↓ Download Original Uncompressed File</a>`
      : '';
  }

  // Sync IG Publishing Status segmented pill inside Inspector
  const igGroup = document.getElementById('sheetIgStatusGroup');
  if (igGroup) {
    const curIg = it.igStatus || '';
    igGroup.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.igSet || '') === curIg);
    });
  }

  dlg?.showModal();
}

function saveInspectorChanges() {
  const it = vault.items.find(i => i.id === state.editingItemId);
  if (!it) return;

  it.title = (document.getElementById('sheetTitle')?.value || '').trim() || it.title;
  it.status = (document.getElementById('sheetStatusInput')?.value || '').trim();
  it.notes = document.getElementById('sheetNotes')?.value || '';
  it.section = (document.getElementById('sheetSectionInput')?.value || '').trim() || 'All';
  it.tags = (document.getElementById('sheetTagsInput')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  it.link = (document.getElementById('sheetLinkInput')?.value || '').trim();

  const activeIgBtn = document.querySelector('#sheetIgStatusGroup .seg-btn.active');
  if (activeIgBtn) {
    it.igStatus = activeIgBtn.dataset.igSet || '';
    if (it.igStatus === 'published' && !it.status.includes('IG Live')) {
      it.status = '● IG Live';
    } else if (it.igStatus === 'queued' && !it.status.includes('IG Ready')) {
      it.status = '◈ IG Ready';
    } else if (it.igStatus === 'website' && !it.status.includes('On Site')) {
      it.status = '🌐 On Site';
    }
  }

  const parentVal = document.getElementById('sheetParentSelect')?.value || '';
  if (parentVal.includes(':')) {
    const [pType, pId] = parentVal.split(':');
    it.parentType = pType;
    it.parentId = pId;
  }

  document.getElementById('itemDialog')?.close();
  saveVault();
  renderAll();
}

function openProjectModal(projId) {
  state.editingProjectId = projId;
  const dlg = document.getElementById('projectDialog');
  const heading = document.getElementById('projectDialogHeading');
  const delBtn = document.getElementById('btnProjDialogDelete');

  const proj = projId ? vault.projects.find(p => p.id === projId) : null;
  if (heading) heading.textContent = proj ? 'CUSTOMIZE PROJECT BOARD' : 'CREATE NEW PROJECT BOARD';
  if (delBtn) delBtn.style.visibility = proj ? 'visible' : 'hidden';

  document.getElementById('projEditTitle').value = proj ? proj.title : '';
  document.getElementById('projEditStatus').value = proj ? (proj.status || '🔥 In Progress') : '🔥 In Progress';
  document.getElementById('projEditCategory').value = proj ? (proj.category || '3D & Motion') : '3D & Motion';
  document.getElementById('projEditSubtitle').value = proj ? (proj.subtitle || '') : '';
  document.getElementById('projEditSections').value = proj ? (proj.sections || ['All', 'WIP', 'Final', 'Notes']).join(', ') : 'All, WIP, References, Notes';
  document.getElementById('projEditTags').value = proj ? (proj.tags || []).join(', ') : '3D & Motion, Studio';

  dlg?.showModal();
}

function saveProjectModal() {
  const title = (document.getElementById('projEditTitle')?.value || '').trim() || 'Untitled Studio Board';
  const status = (document.getElementById('projEditStatus')?.value || '').trim() || 'Active';
  const category = (document.getElementById('projEditCategory')?.value || '').trim() || '3D & Motion';
  const subtitle = (document.getElementById('projEditSubtitle')?.value || '').trim();
  const sections = (document.getElementById('projEditSections')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!sections.includes('All')) sections.unshift('All');
  const tags = (document.getElementById('projEditTags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

  if (state.editingProjectId) {
    const proj = vault.projects.find(p => p.id === state.editingProjectId);
    if (proj) {
      proj.title = title;
      proj.status = status;
      proj.category = category;
      proj.subtitle = subtitle;
      proj.sections = sections;
      proj.tags = tags;
      proj.updatedAt = Date.now();
    }
  } else {
    const newProj = {
      id: 'proj_' + Date.now(),
      title,
      status,
      category,
      subtitle,
      sections,
      tags,
      finlandLinked: false,
      boardX: 264,
      boardY: 108,
      boardW: 360,
      ui: { layoutMode: 'giant_wall', cardSize: 280, aspectRatio: '16 / 10.5', imageFit: 'cover', sortOrder: 'manual' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    vault.projects.unshift(newProj);
  }

  const projectsSpace = vault.spaces.find(s => s.id === 'projects');
  if (projectsSpace && category && !projectsSpace.categories.includes(category)) {
    projectsSpace.categories.push(category);
  }

  document.getElementById('projectDialog')?.close();
  saveVault();
  renderAll();
}

/* --------------------------------------------------------------------------
   EXPLICIT DELETE CONFIRMATION (Soft-Moves to Trash on Server)
   -------------------------------------------------------------------------- */
function requestDelete(kind, id, title) {
  state.pendingDelete = { kind, id, title };
  const dlg = document.getElementById('confirmDeleteDialog');
  const titleEl = document.getElementById('confirmDeleteTitle');
  const msgEl = document.getElementById('confirmDeleteMessage');

  if (titleEl) titleEl.textContent = `Delete "${title}"?`;
  if (msgEl) {
    msgEl.textContent = kind === 'project'
      ? 'This will remove the project board and move any attached items to vault_trash. Nothing is ever deleted without your confirmation.'
      : 'This item will be soft-moved to vault_trash so your original files remain recoverable.';
  }
  dlg?.showModal();
}

async function executeConfirmedDelete() {
  const pd = state.pendingDelete;
  if (!pd) return;

  if (pd.kind === 'project') {
    vault.projects = vault.projects.filter(p => p.id !== pd.id);
    vault.items = vault.items.filter(i => !(i.parentType === 'project' && i.parentId === pd.id));
    if (state.viewType === 'project' && state.activeProjectId === pd.id) {
      state.viewType = 'space';
      state.activeSpaceId = 'projects';
      state.activeProjectId = null;
    }
  } else if (pd.kind === 'item') {
    const it = vault.items.find(i => i.id === pd.id);
    if (it && it.url && it.url.includes('vault_media/')) {
      try {
        await fetch('/api/trash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storedName: it.url.replace(/^\/?vault_media\//, '') })
        });
      } catch (e) {}
    }
    vault.items = vault.items.filter(i => i.id !== pd.id);
  }

  state.pendingDelete = null;
  document.getElementById('confirmDeleteDialog')?.close();
  document.getElementById('itemDialog')?.close();
  document.getElementById('projectDialog')?.close();
  saveVault();
  renderAll();
}

/* --------------------------------------------------------------------------
   UTILITIES & INLINE RENAMING
   -------------------------------------------------------------------------- */
function promptInlineRename(targetEl, currentText, onCommit) {
  if (!targetEl || targetEl.querySelector('.inline-rename-field')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-field';
  input.value = currentText || '';
  const origHtml = targetEl.innerHTML;
  targetEl.innerHTML = '';
  targetEl.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const val = (input.value || '').trim();
    targetEl.innerHTML = origHtml;
    if (save && val) onCommit(val);
  };

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function openUrlOrMacPath(raw) {
  if (!raw) return;
  const val = raw.trim();
  if (val.startsWith('~') || val.startsWith('/')) {
    try {
      await fetch('/api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPath: val })
      });
    } catch (e) {}
  } else {
    const href = val.startsWith('http') ? val : 'https://' + val;
    window.open(href, '_blank', 'noopener');
  }
}

function reorderArrayById(arr, fromId, toId) {
  const fromIdx = arr.findIndex(x => x.id === fromId);
  const toIdx = arr.findIndex(x => x.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* --------------------------------------------------------------------------
   BOOT & EVENT BINDINGS
   -------------------------------------------------------------------------- */
function initEvents() {
  // Sidebar collapse & restore controls
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => toggleSidebar(true));
  document.getElementById('btnRestoreSidebarEdge')?.addEventListener('click', () => toggleSidebar(true));
  document.getElementById('btnCloseSidebar')?.addEventListener('click', () => toggleSidebar(false));

  document.getElementById('brandHomeBtn')?.addEventListener('click', (e) => {
    if (e.target.closest('#sidebarBrandName') && e.detail > 1) return;
    state.viewType = 'space';
    state.activeSpaceId = 'projects';
    state.activeProjectId = null;
    renderAll();
  });

  document.getElementById('sidebarBrandName')?.addEventListener('click', (e) => {
    e.stopPropagation();
    promptInlineRename(e.currentTarget, vault.brand?.title || 'IDEAL', (val) => {
      vault.brand = vault.brand || {};
      vault.brand.title = val;
      saveVault('RENAMED BRAND');
      renderSidebar();
    });
  });

  // Inline rename of tagline, kicker, and page title
  document.getElementById('sidebarTagline')?.addEventListener('click', (e) => {
    promptInlineRename(e.currentTarget, vault.brand?.tagline || '', (val) => {
      vault.brand = vault.brand || {};
      vault.brand.tagline = val;
      saveVault();
      renderSidebar();
    });
  });

  document.getElementById('viewKicker')?.addEventListener('click', (e) => {
    const { type, obj } = getActiveContainer();
    const cur = type === 'project' ? (obj.status || '') : (obj.kicker || '');
    promptInlineRename(e.currentTarget, cur, (val) => {
      if (type === 'project') obj.status = val;
      else obj.kicker = val;
      saveVault();
      renderAll();
    });
  });

  document.getElementById('viewTitle')?.addEventListener('click', (e) => {
    const { type, obj } = getActiveContainer();
    if (state.activeFolderId) {
      const fItem = vault.items.find(i => i.id === state.activeFolderId);
      if (fItem) {
        promptInlineRename(e.currentTarget, fItem.title || 'Folder', (val) => {
          fItem.title = val;
          saveVault('RENAMED FOLDER');
          renderAll();
        });
        return;
      }
    }
    const cur = type === 'project' ? obj.title : (obj.heading || obj.title);
    promptInlineRename(e.currentTarget, cur, (val) => {
      if (type === 'project') {
        obj.title = val;
      } else {
        obj.title = val;
        obj.heading = val;
      }
      saveVault('RENAMED TITLE');
      renderAll();
    });
  });

  // Back to Projects / Parent Folder button
  document.getElementById('btnBackToProjects')?.addEventListener('click', () => {
    if (state.activeFolderId) {
      const curFolder = vault.items.find(i => i.id === state.activeFolderId);
      state.activeFolderId = curFolder?.folderId || null;
      renderAll();
      return;
    }
    state.viewType = 'space';
    state.activeSpaceId = 'projects';
    state.activeProjectId = null;
    state.activeFolderId = null;
    const sp = vault.spaces.find(s => s.id === 'projects');
    state.activeCategory = (sp?.categories && sp.categories[0]) || 'All';
    renderAll();
  });

  // Top single-row toolbar controls
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    renderWorkspace();
  });

  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
    const { obj } = getActiveContainer();
    obj.ui = obj.ui || {};
    obj.ui.sortOrder = e.target.value;
    saveVault();
    renderWorkspace();
  });

  ['btnViewSphere', 'btnViewGiantWall', 'btnViewWall', 'btnViewList', 'btnViewKanban'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const mode = e.currentTarget.dataset.mode;
      const { obj } = getActiveContainer();
      obj.ui = obj.ui || {};
      obj.ui.layoutMode = mode;
      saveVault();
      renderHeaderAndToolbar();
      renderWorkspace();
    });
  });

  document.getElementById('sizeSlider')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    const { obj } = getActiveContainer();
    obj.ui = obj.ui || {};
    obj.ui.cardSize = val;

    // If on a spatial board (#giantWallPlane), map the slider directly to smooth canvas zoom!
    const plane = document.getElementById('giantWallPlane');
    if (plane) {
      const cam = getActiveBoardCamera();
      cam.zoom = Math.min(3.5, Math.max(0.25, val / 260));
      applyActiveBoardCameraTransform(plane);
      return;
    }

    document.documentElement.style.setProperty('--grid-size', val + 'px');
    document.documentElement.style.setProperty('--eagle-col-width', val + 'px');
    document.querySelectorAll('.eagle-waterfall, .eagle-uniform-grid').forEach(el => {
      el.style.setProperty('--eagle-col-width', val + 'px');
    });
    saveVault();
  });

  document.getElementById('btnSectionDesign')?.addEventListener('click', () => {
    state.sectionDrawerOpen = !state.sectionDrawerOpen;
    renderHeaderAndToolbar();
    renderSectionDesignDrawer();
  });

  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    const cur = vault.customization.themePreset || 'warm_gallery';
    vault.customization.themePreset = cur.includes('dark') || cur.includes('oled') ? 'warm_gallery' : 'dark_studio';
    saveVault();
    renderAll();
  });

  // Compact Board Switcher (⌘K) for 800+ Boards
  document.getElementById('btnOpenBoardSwitcher')?.addEventListener('click', () => openBoardSwitcherModal());
  document.getElementById('btnCloseBoardSwitcher')?.addEventListener('click', () => document.getElementById('boardSwitcherDialog')?.close());
  document.getElementById('boardSwitcherInput')?.addEventListener('input', (e) => {
    renderBoardSwitcherList(e.target.value);
  });
  document.getElementById('btnBoardSwitcherNew')?.addEventListener('click', () => {
    document.getElementById('boardSwitcherDialog')?.close();
    openProjectModal(null);
  });

  // Global keyboard shortcuts: Cmd/Ctrl + K (Board Switcher) & Cmd/Ctrl + =/-/0 (Spatial Zoom)
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openBoardSwitcherModal();
      return;
    }
    const plane = document.getElementById('giantWallPlane');
    if (plane && (e.metaKey || e.ctrlKey)) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        const cam = getActiveBoardCamera();
        cam.zoom = Math.min(3.5, (cam.zoom || 1) * 1.15);
        applyActiveBoardCameraTransform(plane);
      } else if (e.key === '-') {
        e.preventDefault();
        const cam = getActiveBoardCamera();
        cam.zoom = Math.max(0.25, (cam.zoom || 1) / 1.15);
        applyActiveBoardCameraTransform(plane);
      } else if (e.key === '0') {
        e.preventDefault();
        const cam = getActiveBoardCamera();
        cam.zoom = 1;
        cam.panX = 0;
        cam.panY = 0;
        applyActiveBoardCameraTransform(plane);
      }
    }
  });

  // Initialize Milanote Tool Rail (Click-to-Add AND Drag-from-Rail to Board)
  initMilanoteToolRailEvents();

  // Sidebar footer & floating HUD quick actions
  document.getElementById('btnSidebarAddProject')?.addEventListener('click', () => openProjectModal(null));
  document.getElementById('btnSidebarUpload')?.addEventListener('click', () => document.getElementById('globalFileInput')?.click());
  document.getElementById('btnSidebarQuickNote')?.addEventListener('click', () => openQuickComposer('note'));
  document.getElementById('btnSidebarQuickLink')?.addEventListener('click', () => openQuickComposer('link'));

  document.getElementById('btnHudUpload')?.addEventListener('click', () => document.getElementById('globalFileInput')?.click());
  document.getElementById('btnHudNote')?.addEventListener('click', () => openQuickComposer('note'));
  document.getElementById('btnHudLink')?.addEventListener('click', () => openQuickComposer('link'));

  // IG Status Quick Filter Bar in Floating HUD
  document.querySelectorAll('#igStatusFilterBar .ig-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.igStatusFilter = btn.dataset.igFilter || 'all';
      renderHeaderAndToolbar();
      renderWorkspace();
    });
  });

  // Inspector IG Status Segmented Buttons
  document.querySelectorAll('#sheetIgStatusGroup .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sheetIgStatusGroup .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Multi-Select Compare Floating Bar Controls
  document.getElementById('btnOpenCompareModal')?.addEventListener('click', () => openCompareDialog());
  document.getElementById('btnClearCompareSelection')?.addEventListener('click', () => {
    state.selectedCompareAssets = [];
    renderWorkspace();
    renderCompareFloatingBar();
  });
  document.getElementById('btnBatchMarkQueued')?.addEventListener('click', () => {
    batchSetSelectedIgStatus('queued');
  });
  document.getElementById('btnBatchMarkPublished')?.addEventListener('click', () => {
    batchSetSelectedIgStatus('published');
  });
  document.getElementById('btnBatchMarkWebsite')?.addEventListener('click', () => {
    batchSetSelectedIgStatus('website');
  });

  // Spacebar High-Res Quick-Look Preview Modal
  const spaceDlg = document.getElementById('spacebarPreviewDialog');
  document.getElementById('btnCloseSpacebarPreview')?.addEventListener('click', () => spaceDlg?.close());
  if (spaceDlg && !('closedBy' in HTMLDialogElement.prototype)) {
    spaceDlg.addEventListener('click', (e) => {
      if (e.target === spaceDlg) spaceDlg.close();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ') return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)) return;
    if (e.target && e.target.isContentEditable) return;
    const anyDialogOpen = Array.from(document.querySelectorAll('dialog')).some(d => d.open && d.id !== 'spacebarPreviewDialog');
    if (anyDialogOpen) return;

    if (spaceDlg && spaceDlg.open) {
      e.preventDefault();
      spaceDlg.close();
      return;
    }

    if (state.hoveredAssetForQuickLook) {
      e.preventDefault();
      openSpacebarPreview(state.hoveredAssetForQuickLook);
    }
  });

  // Contextual Asset Comparison Lightbox Modal Controls
  initCompareDialogEvents();

  document.getElementById('globalFileInput')?.addEventListener('change', (e) => {
    handleFilesUpload(e.target.files);
    e.target.value = '';
  });

  // Global file Drag & Drop + Clipboard Paste
  const dropOverlay = document.getElementById('globalDropOverlay');
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      if (dropOverlay) dropOverlay.hidden = false;
    }
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null && dropOverlay) dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (dropOverlay) dropOverlay.hidden = true;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      handleFilesUpload(e.dataTransfer.files);
    }
  });
  window.addEventListener('paste', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.target && e.target.isContentEditable) return;
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFilesUpload(e.clipboardData.files);
    }
  });

  // Inspector & Project Dialog bindings
  document.getElementById('btnCloseSheet')?.addEventListener('click', () => document.getElementById('itemDialog')?.close());
  document.getElementById('btnSheetSave')?.addEventListener('click', saveInspectorChanges);
  document.getElementById('btnSheetDelete')?.addEventListener('click', () => {
    const it = vault.items.find(i => i.id === state.editingItemId);
    if (it) requestDelete('item', it.id, it.title);
  });
  document.getElementById('btnSheetOpenLink')?.addEventListener('click', () => {
    const val = document.getElementById('sheetLinkInput')?.value;
    openUrlOrMacPath(val);
  });

  document.getElementById('btnCloseProjectDialog')?.addEventListener('click', () => document.getElementById('projectDialog')?.close());
  document.getElementById('btnProjDialogCancel')?.addEventListener('click', () => document.getElementById('projectDialog')?.close());
  document.getElementById('btnProjDialogSave')?.addEventListener('click', saveProjectModal);
  document.getElementById('btnProjDialogDelete')?.addEventListener('click', () => {
    const proj = vault.projects.find(p => p.id === state.editingProjectId);
    if (proj) requestDelete('project', proj.id, proj.title);
  });

  document.getElementById('btnCancelDelete')?.addEventListener('click', () => document.getElementById('confirmDeleteDialog')?.close());
  document.getElementById('btnConfirmDeleteYes')?.addEventListener('click', executeConfirmedDelete);
}

/* ==========================================================================
   MILANOTE TOOL RAIL: CLICK-TO-ADD OR DRAG-FROM-RAIL ONTO SPATIAL BOARD
   ========================================================================== */
function findNextOpenBoardSpot() {
  const cam = getActiveBoardCamera();
  const baseX = snapCoord(Math.max(264, Math.round((264 - (cam.panX || 0)) / (cam.zoom || 1))));
  const baseY = snapCoord(Math.max(108, Math.round((108 - (cam.panY || 0)) / (cam.zoom || 1))));
  const { type, obj } = getActiveContainer();

  if (type === 'space' && obj.id === 'projects') {
    const count = vault.projects.length;
    return {
      x: snapCoord(baseX + (count % 3) * 48),
      y: snapCoord(baseY + Math.floor(count / 3) * 48)
    };
  }

  const existing = vault.items.filter(i => i.parentType === type && i.parentId === obj.id && (i.folderId || null) === (state.activeFolderId || null));
  for (let step = 0; step < 30; step++) {
    const candX = snapCoord(baseX + (step % 3) * 288);
    const candY = snapCoord(baseY + Math.floor(step / 3) * 240);
    const collision = existing.some(it => Math.abs((it.wallX || 0) - candX) < 120 && Math.abs((it.wallY || 0) - candY) < 96);
    if (!collision) return { x: candX, y: candY };
  }
  return { x: baseX, y: baseY };
}

function createMilanoteElementAt(toolKind, canvasX, canvasY) {
  if (toolKind === 'image' || toolKind === 'upload' || toolKind === 'document' || toolKind === 'audio' || toolKind === 'video') {
    document.getElementById('globalFileInput')?.click();
    return;
  }

  const { type, obj } = getActiveContainer();
  const spot = (typeof canvasX === 'number' && typeof canvasY === 'number')
    ? { x: snapCoord(Math.max(264, canvasX)), y: snapCoord(Math.max(96, canvasY)) }
    : findNextOpenBoardSpot();

  // If on the main 01 Studio Projects wall and user clicks/drags "Board", create a new top-level Project Board right at that spot!
  if (type === 'space' && obj.id === 'projects' && toolKind === 'folder') {
    const firstAllCat = (obj.categories && obj.categories[0]) || 'All';
    const chosenCat = (state.activeCategory && state.activeCategory !== firstAllCat)
      ? state.activeCategory
      : ((obj.categories && obj.categories[1]) || '3D & Motion');
    const newProj = {
      id: 'proj_' + Date.now(),
      title: 'New Studio Board',
      status: '🔥 In Progress',
      category: chosenCat,
      subtitle: 'Spatial Board',
      sections: ['All', 'WIP', 'References', 'Notes'],
      tags: ['Studio'],
      finlandLinked: false,
      boardX: spot.x,
      boardY: spot.y,
      boardW: 360,
      wallX: spot.x,
      wallY: spot.y,
      wallW: 360,
      ui: { layoutMode: 'giant_wall', cardSize: 280, sortOrder: 'manual' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    vault.projects.unshift(newProj);
    saveVault('NEW STUDIO BOARD CREATED');
    renderAll();
    return;
  }

  const targetParentType = type;
  const targetParentId = obj.id;

  const defaultsByKind = {
    note: { title: 'Note', kind: 'note', section: 'Notes', notes: '', wallW: 264 },
    comment: { title: 'Comment', kind: 'comment', section: 'Notes', notes: '', wallW: 264 },
    link: { title: 'Web / Mac Link', kind: 'link', section: 'References', link: 'https://', notes: '', wallW: 264 },
    todo: { title: 'To-do List', kind: 'todo', section: 'Notes', notes: '[ ] First step\n[ ] Second step', wallW: 264 },
    line: { title: 'Connector', kind: 'line', section: 'Notes', notes: '', wallW: 336 },
    folder: { title: 'New Board', kind: 'folder', section: 'All', notes: 'Sub-board folder', wallW: 216 },
    column: { title: 'Column', kind: 'column', section: 'All', notes: 'Vertical card stack', wallW: 288 },
    heading: { title: 'Section Heading', kind: 'heading', section: 'Notes', notes: '', wallW: 360 },
    color: { title: 'Accent Swatch', kind: 'color', section: 'References', notes: '#FF3B24', wallW: 192 },
    table: { title: 'Specs Table', kind: 'table', section: 'Notes', notes: 'Part | Status\nSculpt | Ready\nRender | WIP', wallW: 312 },
    sketch: { title: 'Sketch Pad', kind: 'sketch', section: 'WIP', notes: '', wallW: 264 },
    map: { title: 'Location Pin', kind: 'map', section: 'References', link: 'https://maps.google.com', notes: 'Venue / exhibition coordinates', wallW: 264 }
  };

  const spec = defaultsByKind[toolKind] || defaultsByKind.note;
  const newItem = {
    id: 'item_' + uid(),
    parentType: targetParentType,
    parentId: targetParentId,
    folderId: state.activeFolderId || null,
    title: spec.title,
    kind: spec.kind,
    section: spec.section,
    status: 'Active',
    url: '',
    link: spec.link || '',
    notes: spec.notes || '',
    tags: [],
    wallX: spot.x,
    wallY: spot.y,
    wallW: spec.wallW || 264,
    createdAt: Date.now()
  };

  vault.items.unshift(newItem);
  saveVault(`ADDED ${spec.title.toUpperCase()}`);
  renderAll();

  // Auto-focus inline editable area if it's a note, heading, or folder
  requestAnimationFrame(() => {
    const pinEl = document.querySelector(`.wall-pin-item[data-item-id="${newItem.id}"]`);
    const editable = pinEl?.querySelector('.mn-note-editable, .mn-heading-editable, .mn-folder-title, .mn-column-title');
    if (editable) {
      editable.focus();
    }
  });
}

function initMilanoteToolRailEvents() {
  const rail = document.getElementById('milanoteToolRail');
  const moreBtn = document.getElementById('btnMilanoteMore');
  const morePop = document.getElementById('milanoteMorePopover');
  if (!rail) return;

  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!morePop) return;
    morePop.hidden = !morePop.hidden;
  });

  window.addEventListener('pointerdown', (e) => {
    if (morePop && !morePop.hidden && !e.target.closest('#milanoteMorePopover') && !e.target.closest('#btnMilanoteMore')) {
      morePop.hidden = true;
    }
  });

  // Bind both Click-to-Add and Drag-from-Rail onto the Spatial Board for all tool buttons
  const toolButtons = document.querySelectorAll('#milanoteToolRail .mn-tool-btn[data-mn-tool], #milanoteMorePopover .mn-more-item[data-mn-tool]');
  toolButtons.forEach(btn => {
    const toolKind = btn.dataset.mnTool;
    if (!toolKind) return;

    let draggingTool = false;
    let movedTool = false;
    let startX = 0;
    let startY = 0;
    let ghostEl = null;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      draggingTool = true;
      movedTool = false;
      startX = e.clientX;
      startY = e.clientY;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    });

    btn.addEventListener('pointermove', (e) => {
      if (!draggingTool) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
        if (!movedTool) {
          movedTool = true;
          if (morePop) morePop.hidden = true;
          ghostEl = document.createElement('div');
          ghostEl.className = 'mn-drag-ghost';
          ghostEl.textContent = `+ ${btn.querySelector('span')?.textContent || toolKind}`;
          document.body.appendChild(ghostEl);
        }
      }
      if (movedTool && ghostEl) {
        ghostEl.style.left = `${e.clientX + 12}px`;
        ghostEl.style.top = `${e.clientY + 12}px`;

        const stage = document.getElementById('giantWallStage');
        const snapPreview = document.getElementById('wallSnapPreview');
        if (stage && snapPreview) {
          const rect = stage.getBoundingClientRect();
          const cam = getActiveBoardCamera();
          const cx = snapCoord((e.clientX - rect.left - (cam.panX || 0)) / (cam.zoom || 1) - 110);
          const cy = snapCoord((e.clientY - rect.top - (cam.panY || 0)) / (cam.zoom || 1) - 40);
          snapPreview.hidden = false;
          snapPreview.style.left = `${Math.max(72, cx)}px`;
          snapPreview.style.top = `${Math.max(96, cy)}px`;
          snapPreview.style.width = `264px`;
          snapPreview.style.height = `144px`;
        }
      }
    });

    const finishToolGesture = (e) => {
      if (!draggingTool) return;
      draggingTool = false;
      if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
      }
      const snapPreview = document.getElementById('wallSnapPreview');
      if (snapPreview) snapPreview.hidden = true;

      if (morePop) morePop.hidden = true;

      if (!movedTool) {
        // Simple click -> add at next clean snapped spot on board
        createMilanoteElementAt(toolKind);
        return;
      }

      // Dropped onto canvas -> compute exact snapped board coordinates (or add to active view if not in Giant Wall)
      const stage = document.getElementById('giantWallStage');
      if (stage && e && e.clientX < window.innerWidth - 88) {
        const rect = stage.getBoundingClientRect();
        const cam = getActiveBoardCamera();
        const dropX = snapCoord((e.clientX - rect.left - (cam.panX || 0)) / (cam.zoom || 1) - 110);
        const dropY = snapCoord((e.clientY - rect.top - (cam.panY || 0)) / (cam.zoom || 1) - 40);
        createMilanoteElementAt(toolKind, Math.max(264, dropX), Math.max(96, dropY));
      } else if (e && e.clientX < window.innerWidth - 88) {
        createMilanoteElementAt(toolKind);
      }
    };

    btn.addEventListener('pointerup', finishToolGesture);
    btn.addEventListener('lostpointercapture', finishToolGesture);
  });
}

/* ==========================================================================
   MODULES 3 & 4: CONTEXTUAL ASSET COMPARISON MODAL (1:1 STACK & SPLIT VIEW)
   & ONE-CLICK PUBLISHING STATUS (IG READY / IG LIVE / ON WEBSITE)
   ========================================================================== */
function isAssetCompareSelected(id) {
  return (state.selectedCompareAssets || []).some(a => a.id === id);
}

function toggleCompareSelect(assetObj) {
  if (!assetObj || !assetObj.id) return;
  state.selectedCompareAssets = state.selectedCompareAssets || [];
  const idx = state.selectedCompareAssets.findIndex(a => a.id === assetObj.id);
  if (idx !== -1) {
    state.selectedCompareAssets.splice(idx, 1);
  } else {
    state.selectedCompareAssets.push(assetObj);
  }
  renderWorkspace();
  renderCompareFloatingBar();
}

function renderCompareFloatingBar() {
  const bar = document.getElementById('compareFloatingBar');
  if (!bar) return;
  const sel = state.selectedCompareAssets || [];
  if (sel.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const thumbsEl = document.getElementById('compareBarThumbs');
  if (thumbsEl) {
    thumbsEl.innerHTML = sel.slice(0, 6).map(a => `<img src="${escapeHtml(a.url)}" alt="">`).join('');
  }
  const countEl = document.getElementById('compareActionCount');
  if (countEl) {
    countEl.textContent = sel.length >= 2
      ? `Compare (${sel.length})`
      : `Select 1 more to Compare (${sel.length}/2)`;
  }
}

function setItemIgStatus(itemId, nextStatus) {
  const it = vault.items.find(i => i.id === itemId);
  if (!it) return;
  it.igStatus = nextStatus || '';
  if (nextStatus === 'published') {
    it.status = '● IG Live';
  } else if (nextStatus === 'queued') {
    it.status = '◈ IG Ready';
  } else if (nextStatus === 'website') {
    it.status = '🌐 On Site';
  } else if (it.status === '● IG Live' || it.status === '◈ IG Ready' || it.status === '🌐 On Site') {
    it.status = '✨ WIP / Edit';
  }

  // Keep selectedCompareAssets in sync if this item is currently in the comparison tray
  (state.selectedCompareAssets || []).forEach(a => {
    if (a.id === itemId || a.vaultItemId === itemId) {
      a.igStatus = it.igStatus;
    }
  });

  const label = nextStatus === 'published'
    ? 'FLAGGED ● IG LIVE'
    : (nextStatus === 'queued'
        ? 'FLAGGED ◈ IG READY'
        : (nextStatus === 'website' ? 'FLAGGED 🌐 ON WEBSITE' : 'CLEARED PUBLISHING STATUS'));
  saveVault(label);
  renderAll();
  const cmpDlg = document.getElementById('compareDialog');
  if (cmpDlg && cmpDlg.open) {
    renderCompareModal();
  }
}

function cycleItemIgStatus(itemId) {
  const it = vault.items.find(i => i.id === itemId);
  if (!it) return;
  const cur = it.igStatus || '';
  const next = cur === '' ? 'queued' : (cur === 'queued' ? 'published' : (cur === 'published' ? 'website' : ''));
  setItemIgStatus(itemId, next);
}

function batchSetSelectedIgStatus(targetStatus) {
  const sel = state.selectedCompareAssets || [];
  let changed = 0;
  sel.forEach(a => {
    const itemId = a.vaultItemId || a.id;
    const it = vault.items.find(i => i.id === itemId);
    if (it) {
      it.igStatus = targetStatus;
      it.status = targetStatus === 'published' ? '● IG Live' : (targetStatus === 'website' ? '🌐 On Site' : '◈ IG Ready');
      a.igStatus = targetStatus;
      changed++;
    }
  });
  if (changed > 0) {
    const label = targetStatus === 'published' ? '● IG LIVE' : (targetStatus === 'website' ? '🌐 ON SITE' : '◈ IG READY');
    saveVault(`FLAGGED ${changed} ASSETS ${label}`);
    renderAll();
  }
}

function openCompareDialog() {
  const sel = state.selectedCompareAssets || [];
  if (sel.length < 2) {
    // If only 1 asset is selected, auto-pair it with the next visual asset in the active board so 1-click Compare always works smoothly
    const { type, obj } = getActiveContainer();
    const boardVisuals = vault.items.filter(i => i.parentType === type && i.parentId === obj.id && i.url && i.kind !== 'audio');
    for (const v of boardVisuals) {
      if (state.selectedCompareAssets.length >= 2) break;
      if (!isAssetCompareSelected(v.id)) {
        state.selectedCompareAssets.push({
          id: v.id,
          title: v.title || 'Visual',
          url: v.url,
          kind: v.kind || 'image',
          igStatus: v.igStatus || '',
          vaultItemId: v.id,
          notes: v.notes || ''
        });
      }
    }
    renderCompareFloatingBar();
    renderWorkspace();
  }
  if ((state.selectedCompareAssets || []).length === 0) return;

  state.compareState.activeIndex = 0;
  state.compareState.zoom = 1;
  state.compareState.panX = 0;
  state.compareState.panY = 0;
  state.compareState.diffBlend = false;

  const dlg = document.getElementById('compareDialog');
  if (!dlg) return;
  renderCompareModal();
  dlg.showModal();
}

function renderCompareModal() {
  const sel = state.selectedCompareAssets || [];
  if (sel.length === 0) return;

  // Refresh live igStatus from vault items
  sel.forEach(a => {
    const it = vault.items.find(i => i.id === (a.vaultItemId || a.id));
    if (it) {
      a.igStatus = it.igStatus || '';
      a.title = it.title || a.title;
      a.notes = it.notes || a.notes;
    }
  });

  const cs = state.compareState;
  if (cs.activeIndex >= sel.length) cs.activeIndex = 0;
  const activeAsset = sel[cs.activeIndex] || sel[0];

  // Mode buttons
  document.getElementById('btnCmpModeStack')?.classList.toggle('active', cs.mode === 'stack');
  document.getElementById('btnCmpModeSplit')?.classList.toggle('active', cs.mode === 'split');
  document.getElementById('btnCmpDiffToggle')?.classList.toggle('active', Boolean(cs.diffBlend));

  // Layer number switcher pills (1..N)
  const layerPills = document.getElementById('compareLayerPills');
  if (layerPills) {
    layerPills.innerHTML = sel.map((a, idx) => {
      const statusDot = a.igStatus === 'published'
        ? '<span style="color:#34D399;margin-left:3px;">●</span>'
        : (a.igStatus === 'queued'
            ? '<span style="color:#FBBF24;margin-left:3px;">◈</span>'
            : (a.igStatus === 'website' ? '<span style="color:#60A5FA;margin-left:3px;">🌐</span>' : ''));
      const shortName = (a.title || `Edit ${idx + 1}`).slice(0, 16);
      return `
        <button type="button" class="cmp-layer-pill ${idx === cs.activeIndex ? 'active' : ''}" data-layer-idx="${idx}" title="Press [${idx + 1}] to view ${escapeHtml(a.title)}">
          <span class="layer-key">${idx + 1}</span>
          <span>${escapeHtml(shortName)}</span>
          ${statusDot}
        </button>
      `;
    }).join('');

    layerPills.querySelectorAll('.cmp-layer-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        cs.activeIndex = parseInt(btn.dataset.layerIdx, 10) || 0;
        renderCompareModal();
      });
    });
  }

  // Active asset IG status buttons in top bar
  const qBtn = document.getElementById('btnCmpToggleQueued');
  const pBtn = document.getElementById('btnCmpTogglePublished');
  const wBtn = document.getElementById('btnCmpToggleWebsite');
  if (qBtn) qBtn.classList.toggle('is-active-queued', activeAsset.igStatus === 'queued');
  if (pBtn) pBtn.classList.toggle('is-active-published', activeAsset.igStatus === 'published');
  if (wBtn) wBtn.classList.toggle('is-active-website', activeAsset.igStatus === 'website');

  // Zoom button label
  const zBtn = document.getElementById('btnCmpZoomReset');
  if (zBtn) zBtn.textContent = `${Math.round((cs.zoom || 1) * 100)}%`;

  // Stage rendering (1:1 Layer Stack vs Synchronized N-Up Split View)
  const stage = document.getElementById('compareStage');
  if (!stage) return;

  const transformCss = `translate3d(${cs.panX.toFixed(1)}px, ${cs.panY.toFixed(1)}px, 0) scale(${cs.zoom.toFixed(3)})`;

  if (cs.mode === 'stack') {
    const prevIdx = (cs.activeIndex - 1 + sel.length) % sel.length;
    const layersHtml = sel.map((a, idx) => {
      const isAct = idx === cs.activeIndex;
      const isDiff = cs.diffBlend && idx === prevIdx && idx !== cs.activeIndex;
      const cls = `cmp-stack-layer ${isAct ? 'is-active-layer' : ''} ${isDiff ? 'is-diff-blend' : ''}`;
      const mediaHtml = a.kind === 'video'
        ? `<video src="${escapeHtml(a.url)}" autoplay loop muted playsinline></video>`
        : `<img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.title)}" draggable="false">`;
      return `<div class="${cls}" data-layer-idx="${idx}">${mediaHtml}</div>`;
    }).join('');

    const badgeHtml = activeAsset.igStatus === 'published'
      ? `<span class="ig-status-badge is-published" style="position:static;">● IG LIVE</span>`
      : (activeAsset.igStatus === 'queued'
          ? `<span class="ig-status-badge is-queued" style="position:static;">◈ IG READY</span>`
          : (activeAsset.igStatus === 'website'
              ? `<span class="ig-status-badge is-website" style="position:static;">🌐 ON SITE</span>`
              : ''));

    stage.innerHTML = `
      <div class="cmp-stack-viewport" id="cmpTransformTarget" style="transform:${transformCss};">
        ${layersHtml}
      </div>
      <div class="cmp-bottom-hud">
        <span class="cmp-layer-tag">[${cs.activeIndex + 1}/${sel.length}]</span>
        <span class="cmp-asset-name">${escapeHtml(activeAsset.title)}</span>
        ${badgeHtml}
        <span class="cmp-hint-keys">Click stage or press 1–${Math.min(9, sel.length)} / ← → to flip 1:1 layers</span>
      </div>
    `;
  } else {
    const cols = sel.length <= 2 ? sel.length : (sel.length === 3 ? 3 : (sel.length === 4 ? 2 : 3));
    const cellsHtml = sel.map((a, idx) => {
      const isAct = idx === cs.activeIndex;
      const mediaHtml = a.kind === 'video'
        ? `<video src="${escapeHtml(a.url)}" autoplay loop muted playsinline></video>`
        : `<img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.title)}" draggable="false">`;
      const badgeHtml = a.igStatus === 'published'
        ? `<span class="ig-status-badge is-published" style="position:static;">● IG LIVE</span>`
        : (a.igStatus === 'queued'
            ? `<span class="ig-status-badge is-queued" style="position:static;">◈ IG READY</span>`
            : (a.igStatus === 'website'
                ? `<span class="ig-status-badge is-website" style="position:static;">🌐 ON SITE</span>`
                : ''));
      return `
        <div class="cmp-split-cell ${isAct ? 'is-focused-cell' : ''}" data-cell-idx="${idx}">
          <div class="cmp-split-cell-header">
            <span><strong style="color:#FFF;">[${idx + 1}]</strong> ${escapeHtml(a.title.slice(0, 22))}</span>
            <div style="display:flex;gap:6px;align-items:center;">
              ${badgeHtml}
              <button type="button" class="cmp-pill-btn btn-cell-ig-queue" data-idx="${idx}" style="height:22px;padding:0 7px;font-size:10px;${a.igStatus === 'queued' ? 'background:#D97706;color:#FFF;' : ''}" title="Flag as IG Ready">◈ Ready</button>
              <button type="button" class="cmp-pill-btn btn-cell-ig-pub" data-idx="${idx}" style="height:22px;padding:0 7px;font-size:10px;${a.igStatus === 'published' ? 'background:#10B981;color:#FFF;' : ''}" title="Flag as IG Live">● Live</button>
              <button type="button" class="cmp-pill-btn btn-cell-ig-web" data-idx="${idx}" style="height:22px;padding:0 7px;font-size:10px;${a.igStatus === 'website' ? 'background:#2563EB;color:#FFF;' : ''}" title="Flag as On Website">🌐 Site</button>
            </div>
          </div>
          <div class="cmp-split-media-wrap" style="transform:${transformCss};">
            ${mediaHtml}
          </div>
        </div>
      `;
    }).join('');

    stage.innerHTML = `
      <div class="cmp-split-grid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
        ${cellsHtml}
      </div>
    `;

    stage.querySelectorAll('.cmp-split-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        cs.activeIndex = parseInt(cell.dataset.cellIdx, 10) || 0;
        renderCompareModal();
      });
    });

    stage.querySelectorAll('.btn-cell-ig-queue').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = sel[parseInt(btn.dataset.idx, 10)];
        if (a) {
          const itemId = a.vaultItemId || a.id;
          setItemIgStatus(itemId, a.igStatus === 'queued' ? '' : 'queued');
        }
      });
    });

    stage.querySelectorAll('.btn-cell-ig-pub').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = sel[parseInt(btn.dataset.idx, 10)];
        if (a) {
          const itemId = a.vaultItemId || a.id;
          setItemIgStatus(itemId, a.igStatus === 'published' ? '' : 'published');
        }
      });
    });

    stage.querySelectorAll('.btn-cell-ig-web').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = sel[parseInt(btn.dataset.idx, 10)];
        if (a) {
          const itemId = a.vaultItemId || a.id;
          setItemIgStatus(itemId, a.igStatus === 'website' ? '' : 'website');
        }
      });
    });
  }
}

function updateCompareStageTransformOnly() {
  const cs = state.compareState;
  const transformCss = `translate3d(${cs.panX.toFixed(1)}px, ${cs.panY.toFixed(1)}px, 0) scale(${cs.zoom.toFixed(3)})`;
  const zBtn = document.getElementById('btnCmpZoomReset');
  if (zBtn) zBtn.textContent = `${Math.round((cs.zoom || 1) * 100)}%`;

  const stackTarget = document.getElementById('cmpTransformTarget');
  if (stackTarget) stackTarget.style.transform = transformCss;

  document.querySelectorAll('#compareStage .cmp-split-media-wrap').forEach(el => {
    el.style.transform = transformCss;
  });
}

function initCompareDialogEvents() {
  const dlg = document.getElementById('compareDialog');
  const stage = document.getElementById('compareStage');
  if (!dlg || !stage) return;

  // Progressive enhancement fallback for closedby="any"
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  document.getElementById('btnCloseCompareDialog')?.addEventListener('click', () => dlg.close());

  document.getElementById('btnCmpModeStack')?.addEventListener('click', () => {
    state.compareState.mode = 'stack';
    renderCompareModal();
  });

  document.getElementById('btnCmpModeSplit')?.addEventListener('click', () => {
    state.compareState.mode = 'split';
    renderCompareModal();
  });

  document.getElementById('btnCmpDiffToggle')?.addEventListener('click', () => {
    state.compareState.mode = 'stack';
    state.compareState.diffBlend = !state.compareState.diffBlend;
    renderCompareModal();
  });

  document.getElementById('btnCmpToggleQueued')?.addEventListener('click', () => {
    const sel = state.selectedCompareAssets || [];
    const active = sel[state.compareState.activeIndex];
    if (!active) return;
    const itemId = active.vaultItemId || active.id;
    setItemIgStatus(itemId, active.igStatus === 'queued' ? '' : 'queued');
  });

  document.getElementById('btnCmpTogglePublished')?.addEventListener('click', () => {
    const sel = state.selectedCompareAssets || [];
    const active = sel[state.compareState.activeIndex];
    if (!active) return;
    const itemId = active.vaultItemId || active.id;
    setItemIgStatus(itemId, active.igStatus === 'published' ? '' : 'published');
  });

  document.getElementById('btnCmpToggleWebsite')?.addEventListener('click', () => {
    const sel = state.selectedCompareAssets || [];
    const active = sel[state.compareState.activeIndex];
    if (!active) return;
    const itemId = active.vaultItemId || active.id;
    setItemIgStatus(itemId, active.igStatus === 'website' ? '' : 'website');
  });

  document.getElementById('btnCmpZoomIn')?.addEventListener('click', () => {
    state.compareState.zoom = Math.min(6, (state.compareState.zoom || 1) + 0.35);
    updateCompareStageTransformOnly();
  });

  document.getElementById('btnCmpZoomOut')?.addEventListener('click', () => {
    state.compareState.zoom = Math.max(0.5, (state.compareState.zoom || 1) - 0.35);
    if (state.compareState.zoom <= 1.02) {
      state.compareState.panX = 0;
      state.compareState.panY = 0;
    }
    updateCompareStageTransformOnly();
  });

  document.getElementById('btnCmpZoomReset')?.addEventListener('click', () => {
    state.compareState.zoom = 1;
    state.compareState.panX = 0;
    state.compareState.panY = 0;
    updateCompareStageTransformOnly();
  });

  // Synchronized Wheel Zoom inside Comparison Stage
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.ctrlKey ? -e.deltaY * 0.015 : -e.deltaY * 0.0025;
    state.compareState.zoom = Math.min(6, Math.max(0.5, (state.compareState.zoom || 1) + delta));
    if (state.compareState.zoom <= 1.02) {
      state.compareState.panX *= 0.8;
      state.compareState.panY *= 0.8;
    }
    updateCompareStageTransformOnly();
  }, { passive: false });

  // Synchronized Drag Pan + Rapid Click-Toggle in Stack Mode
  let isDragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  stage.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('.cmp-bottom-hud')) return;
    isDragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    origX = state.compareState.panX || 0;
    origY = state.compareState.panY || 0;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 4) moved = true;
    state.compareState.panX = origX + dx;
    state.compareState.panY = origY + dy;
    updateCompareStageTransformOnly();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    // Rapid click-toggling in 1:1 Stack Mode when clicking without dragging!
    if (!moved && state.compareState.mode === 'stack') {
      const sel = state.selectedCompareAssets || [];
      if (sel.length > 1) {
        state.compareState.activeIndex = (state.compareState.activeIndex + 1) % sel.length;
        renderCompareModal();
      }
    }
  });

  // Keyboard shortcuts inside Comparison Modal: 1–9 layer flip, Left/Right arrows, Spacebar rapid A/B flip, S for Split/Stack
  window.addEventListener('keydown', (e) => {
    if (!dlg.open) return;
    const sel = state.selectedCompareAssets || [];
    if (sel.length === 0) return;

    if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < sel.length) {
        e.preventDefault();
        state.compareState.activeIndex = idx;
        renderCompareModal();
      }
    } else if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      state.compareState.activeIndex = (state.compareState.activeIndex + 1) % sel.length;
      renderCompareModal();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      state.compareState.activeIndex = (state.compareState.activeIndex - 1 + sel.length) % sel.length;
      renderCompareModal();
    } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      state.compareState.mode = state.compareState.mode === 'stack' ? 'split' : 'stack';
      renderCompareModal();
    } else if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      state.compareState.mode = 'stack';
      state.compareState.diffBlend = !state.compareState.diffBlend;
      renderCompareModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  applyCustomizationToDOM();
  renderAll();
  syncFromServerOnBoot();
});
