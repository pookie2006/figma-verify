/**
 * Inlined viewer logic for the self-contained HTML report.
 *
 * Runs entirely client-side with zero dependencies: pan/zoom canvas, three
 * compare modes (side-by-side / onion-skin overlay / swipe), a layers tree,
 * a contextual inspect panel, root-cause-first severity summaries, and live
 * score profiles. Also drives the responsive overlay panels / mobile tab
 * bar and small accessibility affordances (radiogroup + slider roles,
 * a copy toast).
 *
 * NOTE: this string is embedded in a <script> tag, so it must not contain
 * backticks or "$" + "{" sequences.
 */
export const VIEWER_JS = `
(function () {
  var payload = JSON.parse(document.getElementById('fv-data').textContent);
  var report = payload.report;
  var design = payload.design;
  var frame = design[0];
  var W = frame.bounds.w, H = frame.bounds.h;
  var GAP = 96;

  var DEDUCTIONS = { critical: 15, high: 5, medium: 2, low: 0.5 };
  var CASCADE_DISCOUNT = 0.25;
  var CAPS = { critical: 40, high: 75 };
  var SIMILARITY_FLOOR = (report.similarity && report.similarity.floor) || 0;
  var SEV_HEX = { critical: '#F0472A', high: '#E8890C', medium: '#C99A02', low: '#8B5CF6', clean: '#12966B' };
  var SEV_INK = { critical: '#C3341C', high: '#A8620A', medium: '#8A6C00', low: '#6D3FD6', clean: '#0B7A56' };
  var SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  var CHIP_DARK = { medium: true, high: true };
  var PROFILES = {
    balanced: { label: 'Balanced', desc: '100 minus flat weighted deductions (critical -15, high -5, medium -2, low -0.5). Default; comparable run-to-run.' },
    strict: { label: 'Strict', desc: 'Balanced deductions, but any critical caps the score at 40 and any high at 75, and it skips the resemblance floor other profiles get. Good as a CI release gate.' },
    perElement: { label: 'Per-element', desc: 'Each element scored 0-100 on its own diffs (missing = 0); final score is the mean. Robust to page size.' },
    rootCause: { label: 'Root cause', desc: 'Cascade diffs (caused by a parent\\u2019s drift) count at 25% weight, so one bad padding value reads as one problem.' }
  };
  var CATEGORIES = [
    { name: 'Typography', props: ['text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight'] },
    { name: 'Color & Theming', props: ['backgroundColor', 'textColor', 'borderColor'] },
    { name: 'Spacing & Layout', props: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'borderRadius', 'borderWidth', 'x', 'y', 'width', 'height'] },
    { name: 'Components', props: ['existence'] }
  ];

  // ---------- helpers ----------
  function round1(v) { return Math.round(v * 10) / 10; }
  function px(v) { return v + 'px'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function ded(diff, discount) {
    var base = DEDUCTIONS[diff.severity];
    return discount && diff.cascade ? base * CASCADE_DISCOUNT : base;
  }
  function allDiffs() {
    var out = [];
    report.elements.forEach(function (el) {
      el.diffs.forEach(function (d) { out.push({ el: el, diff: d }); });
    });
    return out;
  }
  function computeScore(profile) {
    var items = allDiffs();
    if (profile === 'perElement') {
      if (report.elements.length === 0) return 100;
      var sum = 0;
      report.elements.forEach(function (el) {
        if (!el.matched) return;
        var t = 0;
        el.diffs.forEach(function (d) { t += ded(d, false); });
        sum += Math.max(0, 100 - t);
      });
      return Math.max(round1(sum / report.elements.length), SIMILARITY_FLOOR);
    }
    var discount = profile === 'rootCause';
    var total = 0;
    items.forEach(function (it) { total += ded(it.diff, discount); });
    var score = Math.max(0, 100 - total);
    if (profile === 'strict') {
      Object.keys(CAPS).forEach(function (sev) {
        if (items.some(function (it) { return it.diff.severity === sev; })) score = Math.min(score, CAPS[sev]);
      });
      return round1(score); // strict is exempt from the resemblance floor — see SCORING_PROFILES.strict.
    }
    return Math.max(round1(score), SIMILARITY_FLOOR);
  }
  function grade(score) {
    return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  }
  function gradeHex(score) {
    return score >= 80 ? SEV_HEX.clean : score >= 60 ? SEV_HEX.medium : score >= 40 ? SEV_HEX.high : SEV_HEX.critical;
  }
  /** Category deduction color: never "healthy green" when a category has any deduction. */
  function catColor(catDed) {
    if (catDed <= 0) return { hex: SEV_HEX.clean, ink: SEV_INK.clean };
    if (catDed >= 15) return { hex: SEV_HEX.critical, ink: SEV_INK.critical };
    if (catDed >= 5) return { hex: SEV_HEX.high, ink: SEV_INK.high };
    return { hex: SEV_HEX.medium, ink: SEV_INK.medium };
  }
  function worstSeverity(el) {
    if (!el.matched) return 'critical';
    var order = ['critical', 'high', 'medium', 'low'];
    for (var i = 0; i < order.length; i++) {
      if (el.diffs.some(function (d) { return d.severity === order[i]; })) return order[i];
    }
    return 'clean';
  }
  var reportById = {};
  report.elements.forEach(function (el) { reportById[el.designId] = el; });
  var instructions = report.fixInstructions || [];

  // ---------- toast ----------
  var toastTimer;
  function showToast(msg) {
    var t = document.getElementById('fv-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------- toolbar meta ----------
  var sources = { code: null, figma: null };
  function updateMeta(score) {
    var meta = document.getElementById('fv-meta');
    meta.innerHTML = '<strong>' + esc(frame.name) + '</strong>' +
      '<span class="meta-sep">\\u00b7</span>Fidelity <strong>' + score + '</strong>/100' +
      '<span class="meta-sep">\\u00b7</span><span class="agent-chip">Agent-loop ready</span>';
    var srcBits = [];
    if (sources.code) srcBits.push('code: ' + sources.code);
    if (sources.figma) srcBits.push('figma: ' + sources.figma);
    meta.title = (srcBits.length ? srcBits.join('  \\u00b7  ') + '  \\u00b7  ' : '') +
      (report.liveUrl || 'no live URL') + '  \\u00b7  viewport ' + report.viewportWidth + 'px  \\u00b7  generated ' + report.generatedAt;
  }

  // ---------- frames + stage content ----------
  var designBlock = document.getElementById('fv-design-block');
  var implBlock = document.getElementById('fv-impl-block');
  var designStage = document.getElementById('fv-design-stage');
  var implStage = document.getElementById('fv-impl-stage');
  [designStage, implStage].forEach(function (s) { s.style.width = px(W); s.style.height = px(H); });
  [designBlock, implBlock].forEach(function (b) { b.style.width = px(W); b.style.height = px(H); });
  document.getElementById('fv-design-label').textContent = frame.name + ' \\u2014 Design';
  document.getElementById('fv-impl-label').textContent = frame.name + ' \\u2014 Implementation';

  // ---------- source inserters (code folder + Figma mockup) ----------
  // Real compares require the local studio server (npm run studio). Images are
  // preview-only; fixture JSON + a code folder drive Playwright verification.
  var codeInput = document.getElementById('fv-code-input');
  var codeFileTrigger = document.getElementById('fv-code-file-trigger');
  var codeUrlInput = document.getElementById('fv-code-url');
  var codeModeToggle = document.getElementById('fv-code-mode-toggle');
  var figmaInput = document.getElementById('fv-figma-input');
  var figmaFileTrigger = document.getElementById('fv-figma-file-trigger');
  var figmaUrlInput = document.getElementById('fv-figma-url');
  var figmaModeToggle = document.getElementById('fv-figma-mode-toggle');
  var figmaSaveFixtureBtn = document.getElementById('fv-figma-save-fixture');
  var codeValue = document.getElementById('fv-code-value');
  var figmaValue = document.getElementById('fv-figma-value');
  var codeInserter = document.getElementById('fv-code-inserter');
  var figmaInserter = document.getElementById('fv-figma-inserter');
  var compareBtn = document.getElementById('fv-compare');
  var pendingCodeFiles = [];
  var pendingLiveUrl = '';
  var pendingFixtureFile = null;
  var pendingFigmaUrl = '';
  var pendingPreviewOnly = false;
  var studioReady = null;
  var FIGMA_URL_RE = /^https?:\\/\\/([a-z0-9-]+\\.)*figma\\.com\\//i;
  var LIVE_URL_RE = /^(https?|file):\\/\\//i;
  var EXCLUDED_SEGMENT_RE = /^(node_modules|\\.git|\\.hg|\\.svn|\\.next|\\.turbo|\\.cache|\\.parcel-cache|coverage|\\.nyc_output)$/i;
  var MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
  var MAX_UPLOAD_FILES = 4000;

  function hasCodeSource() {
    return !!pendingLiveUrl || pendingCodeFiles.length > 0;
  }

  function isExcludedPath(relPath) {
    var segs = relPath.replace(/\\\\/g, '/').split('/');
    for (var i = 0; i < segs.length; i++) { if (EXCLUDED_SEGMENT_RE.test(segs[i])) return true; }
    var base = segs[segs.length - 1];
    return base === '.DS_Store' || base === 'Thumbs.db';
  }

  function humanSize(bytes) {
    if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + 'KB';
    return bytes + 'B';
  }

  function hasDesignSource() {
    return (pendingFigmaUrl && !pendingPreviewOnly) || (pendingFixtureFile && !pendingPreviewOnly);
  }

  function syncCompareBtn() {
    var ready = hasCodeSource() && hasDesignSource();
    compareBtn.disabled = !ready || compareBtn.classList.contains('busy');
    compareBtn.title = pendingPreviewOnly
      ? 'Images are preview-only — paste a Figma link or upload a fixture JSON to compare'
      : !ready
        ? 'Choose a code folder (or paste a live URL) and a Figma link or fixture JSON, then Compare'
        : 'Run a real compare via the local studio server';
  }

  // ---------- Code inserter: toggle between folder upload and paste-a-live-URL ----------
  function setCodeMode(mode) {
    var isUrl = mode === 'url';
    codeModeToggle.setAttribute('aria-pressed', isUrl ? 'true' : 'false');
    codeModeToggle.textContent = isUrl ? 'File' : 'Link';
    codeModeToggle.title = isUrl ? 'Upload a folder instead' : 'Paste a live URL instead of uploading a folder';
    codeFileTrigger.hidden = isUrl;
    codeUrlInput.hidden = !isUrl;
    if (isUrl) {
      pendingCodeFiles = [];
      codeValue.textContent = 'Choose folder\\u2026';
      codeInserter.classList.remove('has-file');
      codeUrlInput.focus();
    } else {
      pendingLiveUrl = '';
      codeUrlInput.value = '';
      codeInserter.classList.remove('has-file');
    }
    updateMeta(activeScore);
    syncCompareBtn();
  }

  codeModeToggle.addEventListener('click', function () {
    var isUrl = codeModeToggle.getAttribute('aria-pressed') === 'true';
    setCodeMode(isUrl ? 'file' : 'url');
  });

  function commitCodeUrl() {
    var raw = codeUrlInput.value.trim();
    if (!raw) {
      pendingLiveUrl = '';
      sources.code = null;
      codeInserter.classList.remove('has-file');
      syncCompareBtn();
      return;
    }
    if (!LIVE_URL_RE.test(raw)) {
      showToast('Use an http://, https://, or file:// URL');
      return;
    }
    pendingLiveUrl = raw;
    sources.code = raw;
    codeInserter.classList.add('has-file');
    updateMeta(activeScore);
    showToast('Live URL set \\u2014 ready to compare');
    syncCompareBtn();
  }

  codeUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commitCodeUrl(); }
  });
  codeUrlInput.addEventListener('blur', commitCodeUrl);

  // ---------- Figma inserter: toggle between file upload and paste-a-link ----------
  function syncFigmaSaveFixtureBtn() {
    figmaSaveFixtureBtn.hidden = !pendingFigmaUrl;
  }

  function setFigmaMode(mode) {
    var isUrl = mode === 'url';
    figmaModeToggle.setAttribute('aria-pressed', isUrl ? 'true' : 'false');
    figmaModeToggle.textContent = isUrl ? 'File' : 'Link';
    figmaModeToggle.title = isUrl ? 'Upload a fixture file instead' : 'Paste a Figma link instead of a file';
    figmaFileTrigger.hidden = isUrl;
    figmaUrlInput.hidden = !isUrl;
    if (isUrl) {
      pendingFixtureFile = null;
      figmaValue.textContent = 'Choose file\\u2026';
      figmaInserter.classList.remove('has-file');
      var oldPrev = document.getElementById('fv-mockup-preview');
      if (oldPrev) oldPrev.remove();
      pendingPreviewOnly = false;
      figmaUrlInput.focus();
    } else {
      pendingFigmaUrl = '';
      sources.figma = null;
      figmaUrlInput.value = '';
      figmaInserter.classList.remove('has-file');
    }
    syncFigmaSaveFixtureBtn();
    updateMeta(activeScore);
    syncCompareBtn();
  }

  figmaModeToggle.addEventListener('click', function () {
    var isUrl = figmaModeToggle.getAttribute('aria-pressed') === 'true';
    setFigmaMode(isUrl ? 'file' : 'url');
  });

  function commitFigmaUrl() {
    var raw = figmaUrlInput.value.trim();
    if (!raw) {
      pendingFigmaUrl = '';
      sources.figma = null;
      figmaInserter.classList.remove('has-file');
      syncFigmaSaveFixtureBtn();
      syncCompareBtn();
      return;
    }
    if (!FIGMA_URL_RE.test(raw)) {
      showToast('That doesn\\u2019t look like a figma.com link');
      return;
    }
    pendingFigmaUrl = raw;
    sources.figma = raw;
    figmaInserter.classList.add('has-file');
    syncFigmaSaveFixtureBtn();
    updateMeta(activeScore);
    showToast('Figma link set \\u2014 ready to compare');
    syncCompareBtn();
  }

  figmaUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commitFigmaUrl(); }
  });

  function downloadJsonFile(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  figmaSaveFixtureBtn.addEventListener('click', function () {
    if (!pendingFigmaUrl) {
      showToast('Paste and set a Figma link first');
      return;
    }
    figmaSaveFixtureBtn.disabled = true;
    var prevText = figmaSaveFixtureBtn.textContent;
    figmaSaveFixtureBtn.textContent = 'Saving\\u2026';
    fetch('/api/figma-fixture?url=' + encodeURIComponent(pendingFigmaUrl))
      .catch(function () {
        throw new Error('Lost the connection to the studio server (npm run studio).');
      })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.fixture) {
          throw new Error((res.body && res.body.error) || 'Could not fetch this Figma link');
        }
        var filename = res.body.suggestedFilename || 'design-fixture.json';
        downloadJsonFile(res.body.fixture, filename);
        showToast('Saved ' + filename + ' \\u2014 use File mode to compare offline without hitting the Figma API again');
      })
      .catch(function (err) {
        showToast(err.message || 'Could not save this Figma link as a fixture');
      })
      .then(function () {
        figmaSaveFixtureBtn.disabled = false;
        figmaSaveFixtureBtn.textContent = prevText;
      });
  });
  figmaUrlInput.addEventListener('blur', commitFigmaUrl);

  // If this report came from a live Figma-URL compare, the link that was
  // just fetched is already known — surface "Save fixture" immediately so
  // it can be saved offline without having to re-paste the same URL (and
  // without spending another API call just to re-enter it).
  if (report.figmaUrl) {
    pendingFigmaUrl = report.figmaUrl;
    sources.figma = report.figmaUrl;
    syncFigmaSaveFixtureBtn();
  }

  function probeStudio() {
    if (studioReady !== null) return Promise.resolve(studioReady);
    return fetch('/api/health', { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        studioReady = !!(j && j.studio);
        return studioReady;
      })
      .catch(function () {
        studioReady = false;
        return false;
      });
  }

  codeInput.addEventListener('change', function () {
    var rawFiles = Array.prototype.slice.call(codeInput.files || []);
    if (!rawFiles.length) return;
    var root = '';
    var firstPath = rawFiles[0].webkitRelativePath || rawFiles[0].name;
    if (firstPath.indexOf('/') !== -1) root = firstPath.split('/')[0];
    else root = rawFiles[0].name;

    var kept = [];
    var skippedCount = 0;
    var skippedBytes = 0;
    var keptBytes = 0;
    for (var i = 0; i < rawFiles.length; i++) {
      var f = rawFiles[i];
      var rel = f.webkitRelativePath || f.name;
      if (isExcludedPath(rel)) {
        skippedCount++;
        skippedBytes += f.size;
      } else {
        kept.push(f);
        keptBytes += f.size;
      }
    }

    if (!kept.length) {
      pendingCodeFiles = [];
      codeValue.textContent = 'No usable files (all excluded)';
      codeInserter.classList.remove('has-file');
      showToast('Everything in that folder was excluded (node_modules/.git/etc.) \\u2014 pick a build output folder');
      updateMeta(activeScore);
      syncCompareBtn();
      return;
    }

    var limitMsg = kept.length > MAX_UPLOAD_FILES
      ? 'Too many files (' + kept.length + ', limit ' + MAX_UPLOAD_FILES + ') \\u2014 upload your built/static output (npm run build), not raw source'
      : keptBytes > MAX_UPLOAD_BYTES
        ? 'Folder is ' + humanSize(keptBytes) + ' (limit ' + humanSize(MAX_UPLOAD_BYTES) + ') \\u2014 upload your built/static output instead'
        : null;

    if (limitMsg) {
      pendingCodeFiles = [];
      codeValue.textContent = 'Too large \\u2014 see toast';
      codeInserter.classList.remove('has-file');
      showToast(limitMsg);
      updateMeta(activeScore);
      syncCompareBtn();
      return;
    }

    pendingCodeFiles = kept;
    sources.code = root + ' (' + kept.length + ' file' + (kept.length === 1 ? '' : 's') + ', ' + humanSize(keptBytes) + ')';
    codeValue.textContent = sources.code;
    codeInserter.classList.add('has-file');
    showToast(
      skippedCount
        ? 'Loaded ' + root + ' \\u2014 skipped ' + skippedCount + ' file' + (skippedCount === 1 ? '' : 's') + ' (node_modules/.git/etc., ' + humanSize(skippedBytes) + ')'
        : 'Loaded code folder \\u2014 ' + sources.code
    );
    updateMeta(activeScore);
    syncCompareBtn();
  });

  figmaInput.addEventListener('change', function () {
    var file = (figmaInput.files || [])[0];
    if (!file) return;
    sources.figma = file.name;
    figmaValue.textContent = file.name;
    figmaInserter.classList.add('has-file');
    var old = document.getElementById('fv-mockup-preview');
    if (old) old.remove();
    pendingPreviewOnly = (file.type && file.type.indexOf('image/') === 0) ||
      /\\.(png|jpe?g|webp|svg)$/i.test(file.name);
    pendingFixtureFile = pendingPreviewOnly ? null : file;
    if (pendingPreviewOnly) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = document.createElement('img');
        img.id = 'fv-mockup-preview';
        img.alt = 'Uploaded Figma mockup preview';
        img.src = String(reader.result);
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0.35;pointer-events:none;z-index:1;';
        designStage.appendChild(img);
        showToast('Preview only \\u2014 upload fixture JSON to compare');
      };
      reader.readAsDataURL(file);
    } else {
      showToast('Loaded fixture \\u2014 ' + file.name + ' (ready to compare)');
    }
    updateMeta(activeScore);
    syncCompareBtn();
  });

  compareBtn.addEventListener('click', function () {
    if (compareBtn.disabled) return;
    if (codeUrlInput && !codeUrlInput.hidden) commitCodeUrl();
    if (figmaUrlInput && !figmaUrlInput.hidden) commitFigmaUrl();
    if (!hasCodeSource() || !hasDesignSource()) {
      showToast('Choose a code folder (or paste a live URL) and a Figma link or fixture JSON first');
      return;
    }
    compareBtn.classList.add('busy');
    compareBtn.disabled = true;
    compareBtn.textContent = 'Comparing\\u2026';
    probeStudio().then(function (ok) {
      if (!ok) {
        showToast('Start the studio: npm run studio (then open localhost:4174)');
        compareBtn.classList.remove('busy');
        compareBtn.textContent = 'Compare';
        syncCompareBtn();
        return;
      }
      var fd = new FormData();
      if (pendingFigmaUrl) {
        fd.append('figmaUrl', pendingFigmaUrl);
      } else {
        fd.append('fixture', pendingFixtureFile, pendingFixtureFile.name);
      }
      if (pendingLiveUrl) {
        fd.append('liveUrl', pendingLiveUrl);
      } else {
        pendingCodeFiles.forEach(function (f) {
          var rel = f.webkitRelativePath || f.name;
          fd.append('files', f, rel);
        });
      }
      var profileEl = document.getElementById('fv-profile');
      if (profileEl && profileEl.value) fd.append('scoring', profileEl.value);
      return fetch('/api/verify', { method: 'POST', body: fd })
        .catch(function () {
          // fetch() itself rejected: the connection died mid-request, most often
          // because the studio server crashed or was restarted (e.g. an upload
          // too large) or was never running in the first place.
          throw new Error(
            'Lost the connection to the studio server. If it crashed mid-upload, restart it (npm run studio) ' +
            'and make sure the code folder is a built/static output, not raw source with node_modules.'
          );
        })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.body || !res.body.html) {
            throw new Error((res.body && res.body.error) || 'Compare failed');
          }
          showToast('Compare complete \\u2014 reloading report');
          document.open();
          document.write(res.body.html);
          document.close();
        })
        .catch(function (err) {
          showToast(err.message || 'Compare failed');
          compareBtn.classList.remove('busy');
          compareBtn.textContent = 'Compare';
          syncCompareBtn();
        });
    });
  });
  syncCompareBtn();
  probeStudio();

  // Paint the design from the normalized spec (parents come before children).
  designStage.style.background = (frame.styles.backgroundColor || '#ffffff');
  design.slice(1).forEach(function (el) {
    var d = document.createElement('div');
    d.className = 'fv-el';
    d.style.left = px(el.bounds.x); d.style.top = px(el.bounds.y);
    d.style.width = px(el.bounds.w); d.style.height = px(el.bounds.h);
    var st = el.styles || {};
    if (st.backgroundColor) d.style.background = st.backgroundColor;
    if (st.borderRadius) d.style.borderRadius = px(st.borderRadius);
    if (st.borderWidth && st.borderColor) d.style.border = st.borderWidth + 'px solid ' + st.borderColor;
    if (st.opacity != null) d.style.opacity = String(st.opacity);
    if (el.role === 'text' && el.text) {
      d.textContent = el.text;
      if (st.textColor) d.style.color = st.textColor;
      if (st.fontFamily) d.style.fontFamily = st.fontFamily;
      if (st.fontSize) d.style.fontSize = px(st.fontSize);
      if (st.fontWeight) d.style.fontWeight = String(st.fontWeight);
      d.style.lineHeight = st.lineHeight ? px(st.lineHeight) : px(el.bounds.h);
      d.style.whiteSpace = 'nowrap';
    }
    designStage.appendChild(d);
  });

  if (payload.screenshot) {
    var img = document.createElement('img');
    img.src = 'data:image/png;base64,' + payload.screenshot;
    img.width = W;
    img.alt = 'Screenshot of the live implementation of ' + frame.name;
    implStage.appendChild(img);
  } else {
    implStage.style.background = '#fafafa';
    var msg = document.createElement('p');
    msg.className = 'hint';
    msg.style.padding = '12px';
    msg.textContent = 'No screenshot captured for this run.';
    implStage.appendChild(msg);
  }

  // ---------- markers ----------
  var markerNo = {};
  var nextMarker = 1;
  report.elements.forEach(function (el) {
    if (!el.matched || el.diffs.length) markerNo[el.designId] = nextMarker++;
  });
  var regOv = {};   // designId -> [overlay nodes]
  var regChip = {}; // designId -> [chip nodes]

  function addOverlay(stage, bounds, el, missing) {
    var sev = worstSeverity(el);
    var o = document.createElement('div');
    o.className = 'fv-ov fv-sev-' + sev + (missing ? ' fv-missing' : '');
    o.style.left = px(bounds.x); o.style.top = px(bounds.y);
    o.style.width = px(bounds.w); o.style.height = px(bounds.h);
    o.dataset.designId = el.designId;
    o.dataset.name = el.designName + (missing ? ' (missing)' : '');
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
      var hnd = document.createElement('span');
      hnd.className = 'h ' + c;
      o.appendChild(hnd);
    });
    o.addEventListener('click', function (e) { e.stopPropagation(); select(el.designId); });
    o.addEventListener('mouseenter', function () { setHover(el.designId, true); });
    o.addEventListener('mouseleave', function () { setHover(el.designId, false); });
    stage.appendChild(o);
    (regOv[el.designId] = regOv[el.designId] || []).push(o);
    if (markerNo[el.designId]) {
      var chip = document.createElement('div');
      chip.className = 'fv-chip' + (CHIP_DARK[sev] ? ' chip-dark' : '');
      chip.textContent = String(markerNo[el.designId]);
      chip.style.left = px(Math.max(0, bounds.x - 4));
      chip.style.top = px(Math.max(0, bounds.y - 8));
      chip.style.background = SEV_HEX[sev] || SEV_HEX.clean;
      chip.title = el.designName;
      chip.addEventListener('click', function (e) { e.stopPropagation(); select(el.designId); });
      stage.appendChild(chip);
      (regChip[el.designId] = regChip[el.designId] || []).push(chip);
    }
  }
  report.elements.forEach(function (el) {
    addOverlay(designStage, el.designBounds, el, !el.matched);
    if (el.matched && el.domBounds) addOverlay(implStage, el.domBounds, el, false);
  });

  function setHover(id, on) {
    (regOv[id] || []).forEach(function (n) { n.classList.toggle('hovered', on); });
  }

  // ---------- legend ----------
  var lg = '<span>Legend</span>';
  ['critical', 'high', 'medium', 'low'].forEach(function (sev) {
    lg += '<span class="lg"><span class="sw" style="border-color:' + SEV_HEX[sev] + ';background:' + SEV_HEX[sev] + '22"></span>' + SEV_LABEL[sev] + '</span>';
  });
  lg += '<span class="lg"><span class="sw" style="border-color:' + SEV_HEX.critical + ';border-style:dashed;background:transparent"></span>Missing</span>';
  document.getElementById('fv-legend').innerHTML = lg;

  // ---------- layers tree ----------
  var kids = {};
  design.forEach(function (el) {
    if (el.parentId) (kids[el.parentId] = kids[el.parentId] || []).push(el);
  });
  var tree = document.getElementById('fv-tree');
  var treeRows = {}; // designId -> row node

  function buildTreeRow(el, depth) {
    var wrap = document.createElement('div');
    var row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = px(4 + depth * 14);
    var children = kids[el.id] || [];

    var chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = children.length ? '\\u25be' : '';
    row.appendChild(chev);

    var ic = document.createElement('span');
    ic.className = 'layer-ic' + (el.role === 'text' ? '' : ' ic-frame');
    if (el.role === 'text') ic.textContent = 'T';
    row.appendChild(ic);

    var rep = reportById[el.id];
    var name = document.createElement('span');
    name.className = 'tree-name';
    name.innerHTML = esc(el.name) + (rep && !rep.matched ? ' <span class="missing-tag">missing</span>' : '');
    row.appendChild(name);

    if (rep && markerNo[el.id]) {
      var mk = document.createElement('span');
      var sev = worstSeverity(rep);
      mk.className = 'mk' + (CHIP_DARK[sev] ? ' chip-dark' : '');
      mk.textContent = String(markerNo[el.id]);
      mk.style.background = SEV_HEX[sev];
      if (CHIP_DARK[sev]) mk.style.color = '#1A1B1E';
      row.appendChild(mk);
    }
    if (rep) {
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = SEV_HEX[worstSeverity(rep)];
      row.appendChild(dot);
      row.dataset.designId = el.id;
      treeRows[el.id] = row;
      row.addEventListener('click', function () { select(el.id); closeOverlayPanelsOnSelect(); });
      row.addEventListener('mouseenter', function () { setHover(el.id, true); });
      row.addEventListener('mouseleave', function () { setHover(el.id, false); });
    }
    wrap.appendChild(row);

    if (children.length) {
      var kidBox = document.createElement('div');
      kidBox.className = 'tree-kids';
      children.forEach(function (c) { kidBox.appendChild(buildTreeRow(c, depth + 1)); });
      wrap.appendChild(kidBox);
      chev.addEventListener('click', function (e) {
        e.stopPropagation();
        var hidden = kidBox.classList.toggle('hidden');
        chev.textContent = hidden ? '\\u25b8' : '\\u25be';
      });
    }
    return wrap;
  }
  tree.appendChild(buildTreeRow(frame, 0));

  // ---------- selection + inspect panel ----------
  var selectedId = null;
  var inspectScore = document.getElementById('fv-inspect-score');
  var inspectEl = document.getElementById('fv-inspect-el');
  var activeScore = report.fidelityScore;

  function clearGhost() {
    var g = document.getElementById('fv-ghost');
    if (g) g.remove();
  }
  function drawGhost(el) {
    clearGhost();
    if (!el || !el.matched || !el.domBounds) return;
    var db = el.designBounds, ib = el.domBounds;
    var parts = [];
    if (Math.abs(ib.x - db.x) > 0.5) parts.push('\\u0394x ' + Math.round(ib.x - db.x) + 'px');
    if (Math.abs(ib.y - db.y) > 0.5) parts.push('\\u0394y ' + Math.round(ib.y - db.y) + 'px');
    if (Math.abs(ib.w - db.w) > 0.5) parts.push('\\u0394w ' + Math.round(ib.w - db.w) + 'px');
    if (Math.abs(ib.h - db.h) > 0.5) parts.push('\\u0394h ' + Math.round(ib.h - db.h) + 'px');
    if (!parts.length) return;
    var g = document.createElement('div');
    g.id = 'fv-ghost';
    g.style.left = px(db.x); g.style.top = px(db.y);
    g.style.width = px(db.w); g.style.height = px(db.h);
    var lbl = document.createElement('span');
    lbl.className = 'ghost-label';
    lbl.textContent = 'expected \\u00b7 ' + parts.join(' \\u00b7 ');
    g.appendChild(lbl);
    implStage.appendChild(g);
  }

  function select(id) {
    selectedId = id;
    Object.keys(regOv).forEach(function (k) {
      regOv[k].forEach(function (n) { n.classList.toggle('selected', k === id); });
    });
    Object.keys(treeRows).forEach(function (k) {
      treeRows[k].classList.toggle('selected', k === id);
    });
    var el = id ? reportById[id] : null;
    drawGhost(el);
    if (el) {
      renderInspect(el);
      inspectScore.hidden = true;
      inspectEl.hidden = false;
      if (treeRows[id]) treeRows[id].scrollIntoView({ block: 'nearest' });
    } else {
      inspectScore.hidden = false;
      inspectEl.hidden = true;
    }
  }

  function closeOverlayPanelsOnSelect() {
    if (window.matchMedia('(max-width: 1199.98px)').matches) closePanels();
  }

  function copyChip(value, label) {
    return '<code class="copy" data-copy="' + esc(value).replace(/"/g, '&quot;') + '" title="Click to copy">' + esc(label == null ? value : label) + '</code>';
  }

  function renderInspect(el) {
    var no = markerNo[el.designId] ? markerNo[el.designId] + '. ' : '';
    var h = '<button id="fv-back" type="button">\\u2190 Back to score <span class="mini-score">' + activeScore + '/100</span></button>';
    h += '<div class="insp-title">' + no + esc(el.designName) + '</div>';
    h += '<div class="insp-meta">' + el.role + ' \\u00b7 matched by ' + el.matchMethod + '</div>';
    if (el.selector) h += '<div class="insp-selector">' + copyChip(el.selector) + '</div>';
    if (!el.matched) {
      h += '<p class="insp-meta" style="color:var(--critical-ink);font-weight:600;">Missing \\u2014 not found in the DOM.</p>';
      h += '<p class="insp-meta">Expected at x=' + el.designBounds.x + ' y=' + el.designBounds.y + ', ' + el.designBounds.w + '\\u00d7' + el.designBounds.h + 'px. See the fix instructions below for the full build spec.</p>';
    } else if (!el.diffs.length) {
      h += '<p class="insp-clean">Clean \\u2014 no drift beyond tolerances.</p>';
    } else {
      el.diffs.forEach(function (d) {
        h += '<div class="insp-row">';
        h += '<div class="insp-prop"><span class="dot" style="background:' + SEV_HEX[d.severity] + '"></span>' + esc(d.property) +
          ' <span style="color:' + SEV_INK[d.severity] + ';font-weight:600;font-size:10px;text-transform:uppercase;">' + d.severity + '</span></div>';
        h += '<div class="insp-vals">' +
          '<code>' + (d.actual == null ? '\\u2014' : esc(String(d.actual))) + '</code>' +
          '<span class="arrow">\\u2192</span>' +
          copyChip(String(d.expected)) +
          '</div>';
        if (d.delta || d.cascade) {
          h += '<div class="insp-delta">' + esc(d.delta || '') + (d.cascade ? ' <span class="cascade-tag">(cascade \\u2014 fix the parent instead)</span>' : '') + '</div>';
        }
        h += '</div>';
      });
      h += '<p class="insp-delta" style="margin-top:8px;">Click a value chip to copy the expected CSS value.</p>';
    }
    var box = document.getElementById('fv-detail');
    box.innerHTML = h;
    document.getElementById('fv-back').addEventListener('click', function () { select(null); });
  }

  document.getElementById('fv-detail').addEventListener('click', function (e) {
    var chip = e.target.closest('.copy');
    if (!chip) return;
    var val = chip.dataset.copy || chip.textContent;
    function flash() {
      chip.classList.add('copied');
      setTimeout(function () { chip.classList.remove('copied'); }, 900);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(flash, flash);
    } else { flash(); }
    showToast('Copied "' + val + '"');
  });

  // ---------- filters ----------
  var hiddenSevs = {};
  var showCascade = false; // default: hide cascade-only markers, count root diffs only
  function isCascadeOnly(el) {
    return el.matched && el.diffs.length > 0 && el.diffs.every(function (d) { return d.cascade; });
  }
  function applyFilters() {
    report.elements.forEach(function (el) {
      var hide = !!hiddenSevs[worstSeverity(el)] || (!showCascade && isCascadeOnly(el));
      (regOv[el.designId] || []).forEach(function (n) { n.classList.toggle('flt-hidden', hide); });
      (regChip[el.designId] || []).forEach(function (n) { n.classList.toggle('flt-hidden', hide); });
    });
  }
  document.getElementById('fv-show-cascade').addEventListener('change', function () {
    showCascade = this.checked;
    applyFilters();
    renderPills();
  });
  applyFilters();

  // ---------- companion line + plain-English summary (computed once) ----------
  function buildSummarySentence() {
    var missingCount = report.missing.length;
    var createSteps = instructions.filter(function (i) { return i.kind === 'create'; }).length;
    var otherSteps = instructions.length - createSteps;
    var cascadeCount = allDiffs().filter(function (it) { return it.diff.cascade; }).length;
    if (!missingCount && !otherSteps) {
      return 'Implementation matches the design within tolerance \\u2014 nothing to fix.';
    }
    var clauses = [];
    if (missingCount) clauses.push(missingCount + ' missing element' + (missingCount === 1 ? '' : 's'));
    if (otherSteps) clauses.push(otherSteps + ' style/layout root cause' + (otherSteps === 1 ? '' : 's'));
    var sentence = clauses.join(' and ') + '.';
    if (cascadeCount) {
      sentence += ' ' + cascadeCount + ' marker diff' + (cascadeCount === 1 ? ' is' : 's are') + ' cascade side effect' + (cascadeCount === 1 ? '' : 's') + '.';
    }
    return sentence;
  }
  function renderCompanion() {
    var rc = computeScore('rootCause');
    var companionText = instructions.length
      ? 'Root cause ' + rc + '/100 \\u00b7 ' + instructions.length + ' ordered fix' + (instructions.length === 1 ? '' : 'es')
      : 'Root cause ' + rc + '/100 \\u00b7 No fixes needed';
    var summaryText = buildSummarySentence();
    document.getElementById('fv-companion').textContent = companionText;
    document.getElementById('fv-summary').textContent = summaryText;
    document.getElementById('fv-m-companion').textContent = summaryText;
  }
  renderCompanion();

  // ---------- severity pills (root-cause counts by default) ----------
  function renderPills() {
    var items = allDiffs();
    var basis = showCascade ? items : items.filter(function (it) { return !it.diff.cascade; });
    var counts = { critical: 0, high: 0, medium: 0, low: 0 };
    basis.forEach(function (it) { counts[it.diff.severity]++; });
    var pills = document.getElementById('fv-sev-pills');
    pills.innerHTML = '';
    var any = false;
    Object.keys(counts).forEach(function (sev) {
      if (!counts[sev]) return;
      any = true;
      var p = document.createElement('span');
      p.className = 'sev-count' + (hiddenSevs[sev] ? ' off' : '');
      p.style.color = SEV_INK[sev];
      p.style.borderColor = SEV_HEX[sev];
      p.textContent = counts[sev] + ' ' + SEV_LABEL[sev];
      p.title = 'Click to show/hide these markers';
      p.addEventListener('click', function () {
        hiddenSevs[sev] = !hiddenSevs[sev];
        p.classList.toggle('off', !!hiddenSevs[sev]);
        applyFilters();
      });
      pills.appendChild(p);
    });
    if (!any) {
      var ok = document.createElement('span');
      ok.className = 'sev-count';
      ok.style.color = SEV_INK.clean;
      ok.style.borderColor = SEV_HEX.clean;
      ok.textContent = 'No issues';
      pills.appendChild(ok);
    }
    document.getElementById('fv-pill-hint').textContent = 'Click a pill to filter markers \\u00b7 showing ' + (showCascade ? 'all diffs' : 'root causes');
  }

  // ---------- category breakdown (never green for a nonzero deduction) ----------
  function renderCategories(profile) {
    var items = allDiffs();
    var discount = profile === 'rootCause';
    var ch = '';
    CATEGORIES.forEach(function (cat) {
      var catDed = 0, n = 0;
      items.forEach(function (it) {
        if (cat.props.indexOf(it.diff.property) === -1) return;
        catDed += ded(it.diff, discount);
        n++;
      });
      catDed = round1(catDed);
      var c = catColor(catDed);
      var pct = Math.max(0, Math.min(100, round1(100 - catDed)));
      ch += '<div class="cat-row"><div class="cat-top"><span>' + cat.name +
        (n ? ' <span style="color:var(--muted)">\\u00b7 ' + n + '</span>' : '') +
        '</span><span class="cat-val" style="color:' + c.ink + '">' +
        (catDed ? '\\u2212' + catDed : '\\u2014') + '</span></div>' +
        '<div class="cat-bar"><span style="width:' + pct + '%;background:' + c.hex + '"></span></div></div>';
    });
    document.getElementById('fv-categories').innerHTML = ch;
  }

  // ---------- score panel ----------
  var profileSel = document.getElementById('fv-profile');
  Object.keys(PROFILES).forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p;
    opt.textContent = PROFILES[p].label + ' \\u2014 ' + computeScore(p) + '/100';
    profileSel.appendChild(opt);
  });
  profileSel.value = report.scoringProfile || 'balanced';
  profileSel.addEventListener('change', renderScore);

  var GAUGE_C = 2 * Math.PI * 40;
  function renderGauge(score) {
    var arc = document.getElementById('fv-gauge-arc');
    arc.style.stroke = gradeHex(score);
    arc.setAttribute('stroke-dasharray', (GAUGE_C * score / 100) + ' ' + GAUGE_C);
    document.getElementById('fv-score').textContent = String(score);
    document.getElementById('fv-grade').textContent = grade(score);
    document.getElementById('fv-m-score').textContent = String(score);
    document.getElementById('fv-m-grade').textContent = grade(score);
    updateMeta(score);
    activeScore = score;
  }

  function renderWalkthroughRootFirst(profile) {
    var discount = profile === 'rootCause';
    var items = allDiffs();
    var root = items.filter(function (it) { return !it.diff.cascade; });
    var cascade = items.filter(function (it) { return it.diff.cascade; });
    root.sort(function (a, b) { return ded(b.diff, discount) - ded(a.diff, discount); });

    var h = '';
    var total = 0;
    root.forEach(function (it) {
      var v = ded(it.diff, discount);
      total += v;
      h += row(it.el.designName + ' \\u00b7 ' + it.diff.property, '\\u2212' + round1(v));
    });
    if (cascade.length) {
      var cTotal = 0;
      var inner = '';
      cascade.forEach(function (it) {
        var v = ded(it.diff, discount);
        cTotal += v;
        inner += row(it.el.designName + ' \\u00b7 ' + it.diff.property + (discount ? ' (\\u00d70.25)' : ''), '\\u2212' + round1(v));
      });
      total += cTotal;
      h += '<details class="bd-group"><summary><span>' + cascade.length + ' cascade side-effect diff' + (cascade.length === 1 ? '' : 's') +
        (discount ? ' (25% weight)' : ' \\u2014 same root cause') + '</span><span class="bd-val">\\u2212' + round1(cTotal) + '</span></summary>' +
        '<div class="bd-group-inner">' + inner + '</div></details>';
    }
    if (!items.length) h += '<div class="bd-note">No issues found.</div>';
    return { html: h, total: total };
  }

  function renderScore() {
    var profile = profileSel.value;
    var score = computeScore(profile);
    renderGauge(score);
    renderPills();
    renderCategories(profile);
    document.getElementById('fv-profile-desc').textContent = PROFILES[profile].desc;

    var bd = document.getElementById('fv-breakdown');
    var h = '';
    if (profile === 'perElement') {
      report.elements.forEach(function (el) {
        var t = 0;
        el.diffs.forEach(function (d) { t += ded(d, false); });
        var s = el.matched ? Math.max(0, round1(100 - t)) : 0;
        h += row(el.designName + (el.matched ? '' : ' (missing)'), s + '/100');
      });
      h += row('Mean of ' + report.elements.length + ' elements', score + '/100', true);
      h += similarityFloorNote(score);
    } else {
      var result = renderWalkthroughRootFirst(profile);
      h += result.html;
      h += row('100 \\u2212 ' + round1(result.total), String(round1(Math.max(0, 100 - result.total))), true);
      if (profile === 'strict') {
        var items = allDiffs();
        Object.keys(CAPS).forEach(function (sev) {
          if (items.some(function (it) { return it.diff.severity === sev; })) {
            h += '<div class="bd-note">has ' + sev + ' issues \\u2192 capped at ' + CAPS[sev] + '</div>';
          }
        });
        h += row('Final (after caps)', String(score), true);
      }
      h += similarityFloorNote(score);
    }
    bd.innerHTML = h;
  }
  function row(what, val, total) {
    return '<div class="bd-row' + (total ? ' bd-total' : '') + '"><span class="bd-what">' + esc(what) + '</span><span class="bd-val">' + esc(val) + '</span></div>';
  }
  function similarityFloorNote(score) {
    if (!SIMILARITY_FLOOR || score !== SIMILARITY_FLOOR) return '';
    var sim = report.similarity || {};
    var parts = [];
    if (sim.structuralCoverage !== null && sim.structuralCoverage !== undefined) parts.push(Math.round(sim.structuralCoverage * 100) + '% of elements matched something');
    if (sim.textOverlap !== null && sim.textOverlap !== undefined) parts.push('text ' + Math.round(sim.textOverlap * 100) + '% similar');
    if (sim.colorOverlap !== null && sim.colorOverlap !== undefined) parts.push('colors ' + Math.round(sim.colorOverlap * 100) + '% shared');
    if (sim.fontOverlap !== null && sim.fontOverlap !== undefined) parts.push('fonts ' + Math.round(sim.fontOverlap * 100) + '% shared');
    return '<div class="bd-note">Raised to the ' + SIMILARITY_FLOOR + '/100 resemblance floor \\u2014 ' +
      (parts.length ? parts.join(', ') : 'shares real visual language with the design') + ', even where deductions alone would say 0. Not shown for Strict.</div>';
  }
  renderScore();

  // ---------- markers on/off ----------
  var togBtn = document.getElementById('fv-overlay-toggle');
  togBtn.addEventListener('click', function () {
    var on = togBtn.getAttribute('aria-pressed') === 'true';
    togBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    togBtn.lastChild.textContent = on ? 'Markers off' : 'Markers on';
    document.body.classList.toggle('overlays-off', on);
  });

  // ---------- responsive overlay panels (layers/inspect at ≤1199px) ----------
  var layersPanel = document.getElementById('fv-layers');
  var inspectPanel = document.getElementById('fv-inspect');
  var scrim = document.getElementById('fv-scrim');
  var btnToggleLayers = document.getElementById('fv-toggle-layers');
  var btnToggleInspect = document.getElementById('fv-toggle-inspect');

  function closePanels() {
    layersPanel.classList.remove('open');
    inspectPanel.classList.remove('open');
    btnToggleLayers.setAttribute('aria-expanded', 'false');
    btnToggleInspect.setAttribute('aria-expanded', 'false');
    scrim.classList.remove('show');
  }
  function togglePanel(which) {
    var panel = which === 'layers' ? layersPanel : inspectPanel;
    var btn = which === 'layers' ? btnToggleLayers : btnToggleInspect;
    var willOpen = !panel.classList.contains('open');
    closePanels();
    if (willOpen) {
      panel.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      scrim.classList.add('show');
    }
  }
  btnToggleLayers.addEventListener('click', function () { togglePanel('layers'); });
  btnToggleInspect.addEventListener('click', function () { togglePanel('inspect'); });
  document.getElementById('fv-close-layers').addEventListener('click', closePanels);
  document.getElementById('fv-close-inspect').addEventListener('click', closePanels);
  scrim.addEventListener('click', closePanels);

  // ---------- mobile canvas/fixes tabs (≤799px) ----------
  var tabCanvas = document.getElementById('fv-tab-canvas');
  var tabFixes = document.getElementById('fv-tab-fixes');
  tabCanvas.addEventListener('click', function () {
    document.body.classList.remove('mobile-fixes');
    tabCanvas.classList.add('active');
    tabFixes.classList.remove('active');
  });
  tabFixes.addEventListener('click', function () {
    document.body.classList.add('mobile-fixes');
    tabFixes.classList.add('active');
    tabCanvas.classList.remove('active');
    drawer.classList.remove('collapsed');
    drawerToggle.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('fv-tab-fixes-count').textContent = instructions.length ? '(' + instructions.length + ')' : '';

  // ---------- compare modes (accessible radiogroup) ----------
  var mode = 'side';
  var swipeP = 0.5;
  var modeSeg = document.getElementById('fv-mode');
  var modeButtons = Array.prototype.slice.call(modeSeg.querySelectorAll('button'));
  var onionGroup = document.getElementById('fv-onion');
  var onionSlider = document.getElementById('fv-onion-slider');
  var swipeHandle = document.getElementById('fv-swipe-handle');
  swipeHandle.style.top = px(-12);
  swipeHandle.style.height = px(H + 24);

  function updateSwipe() {
    designBlock.style.clipPath = 'inset(0 ' + ((1 - swipeP) * 100) + '% 0 0)';
    swipeHandle.style.left = px(swipeP * W - 1);
    swipeHandle.setAttribute('aria-valuenow', String(Math.round(swipeP * 100)));
  }
  function applyMode(m) {
    mode = m;
    document.body.classList.remove('mode-side', 'mode-overlay', 'mode-swipe');
    document.body.classList.add('mode-' + m);
    modeButtons.forEach(function (b) {
      var active = b.dataset.mode === m;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      b.tabIndex = active ? 0 : -1;
    });
    implBlock.style.left = m === 'side' ? px(W + GAP) : '0px';
    designBlock.style.zIndex = m === 'side' ? '1' : '2';
    designBlock.style.opacity = m === 'overlay' ? String(onionSlider.value / 100) : '1';
    designBlock.style.clipPath = m === 'swipe' ? 'inset(0 ' + ((1 - swipeP) * 100) + '% 0 0)' : 'none';
    onionGroup.hidden = m !== 'overlay';
    swipeHandle.hidden = m !== 'swipe';
    if (m === 'swipe') updateSwipe();
    fitView();
  }
  modeSeg.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b && b.dataset.mode) applyMode(b.dataset.mode);
  });
  modeSeg.addEventListener('keydown', function (e) {
    var idx = modeButtons.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      var next = modeButtons[(idx + 1) % modeButtons.length];
      next.focus(); applyMode(next.dataset.mode);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = modeButtons[(idx - 1 + modeButtons.length) % modeButtons.length];
      prev.focus(); applyMode(prev.dataset.mode);
    }
  });
  onionSlider.addEventListener('input', function () {
    if (mode === 'overlay') designBlock.style.opacity = String(this.value / 100);
  });
  swipeHandle.addEventListener('mousedown', function (e) {
    e.preventDefault(); e.stopPropagation();
    var startX = e.clientX, startP = swipeP;
    function move(ev) {
      swipeP = Math.min(1, Math.max(0, startP + (ev.clientX - startX) / (pz.z * W)));
      updateSwipe();
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  swipeHandle.addEventListener('keydown', function (e) {
    if (mode !== 'swipe') return;
    if (e.key === 'ArrowLeft') { swipeP = Math.max(0, swipeP - 0.02); updateSwipe(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { swipeP = Math.min(1, swipeP + 0.02); updateSwipe(); e.preventDefault(); }
  });

  // ---------- pan / zoom ----------
  var canvas = document.getElementById('fv-canvas');
  var world = document.getElementById('fv-world');
  var pz = { x: 0, y: 0, z: 1 };
  function applyPz() {
    world.style.transform = 'translate(' + pz.x + 'px,' + pz.y + 'px) scale(' + pz.z + ')';
    document.getElementById('fv-zoom').textContent = Math.round(pz.z * 100) + '%';
  }
  function bbox() {
    return { w: mode === 'side' ? 2 * W + GAP : W, h: H };
  }
  function fitView() {
    var r = canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    var b = bbox();
    var z = Math.min((r.width - 120) / b.w, (r.height - 120) / b.h);
    pz.z = Math.min(4, Math.max(0.02, z));
    pz.x = (r.width - b.w * pz.z) / 2;
    pz.y = (r.height - b.h * pz.z) / 2 + 8;
    applyPz();
  }
  function zoomAt(cx, cy, factor) {
    var nz = Math.min(8, Math.max(0.05, pz.z * factor));
    pz.x = cx - (cx - pz.x) * (nz / pz.z);
    pz.y = cy - (cy - pz.y) * (nz / pz.z);
    pz.z = nz;
    applyPz();
  }
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    } else {
      pz.x -= e.deltaX;
      pz.y -= e.deltaY;
      applyPz();
    }
  }, { passive: false });
  canvas.addEventListener('mousedown', function (e) {
    if (e.target.closest('.fv-ov, .fv-chip, #fv-swipe-handle')) return;
    e.preventDefault();
    var sx = e.clientX, sy = e.clientY, ox = pz.x, oy = pz.y, moved = false;
    canvas.classList.add('panning');
    function move(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      pz.x = ox + dx; pz.y = oy + dy;
      applyPz();
    }
    function up() {
      canvas.classList.remove('panning');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!moved) select(null);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  function zoomCenter(factor) {
    var r = canvas.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }
  document.getElementById('fv-zoom-in').addEventListener('click', function () { zoomCenter(1.25); });
  document.getElementById('fv-zoom-out').addEventListener('click', function () { zoomCenter(0.8); });
  document.getElementById('fv-zoom-fit').addEventListener('click', fitView);
  document.getElementById('fv-zoom-100').addEventListener('click', function () {
    var r = canvas.getBoundingClientRect();
    var b = bbox();
    pz.z = 1;
    pz.x = (r.width - b.w) / 2;
    pz.y = 24;
    applyPz();
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(0.8);
    else if (e.key === '0') fitView();
    else if (e.key === '1') document.getElementById('fv-zoom-100').click();
    else if (e.key === 'Escape') { select(null); closePanels(); }
  });
  window.addEventListener('resize', fitView);

  // ---------- fix instructions drawer ----------
  var drawer = document.getElementById('fv-drawer');
  var drawerToggle = document.getElementById('fv-drawer-toggle');
  var drawerBody = document.getElementById('fv-drawer-body');
  var drawerResize = document.getElementById('fv-drawer-resize');
  var insBox = document.getElementById('fv-instructions');
  drawerToggle.addEventListener('click', function () {
    var collapsed = drawer.classList.toggle('collapsed');
    drawerToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  // Drag the top edge of the drawer to give more/less space to the canvas tools.
  (function setupDrawerResize() {
    var minH = 80;
    function maxH() { return Math.max(minH + 40, Math.round(window.innerHeight * 0.7)); }
    function setH(px) {
      var h = Math.max(minH, Math.min(maxH(), px));
      drawerBody.style.setProperty('--drawer-h', h + 'px');
      drawerBody.style.height = h + 'px';
      fitView();
    }
    function startDrag(clientY) {
      var startY = clientY;
      var startH = drawerBody.getBoundingClientRect().height;
      document.body.classList.add('drawer-resizing');
      function move(ev) {
        var y = ev.touches ? ev.touches[0].clientY : ev.clientY;
        // Dragging the handle down shrinks the drawer (more room for the tools above).
        setH(startH - (y - startY));
        if (ev.cancelable) ev.preventDefault();
      }
      function up() {
        document.body.classList.remove('drawer-resizing');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', up);
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', up);
    }
    drawerResize.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startDrag(e.clientY);
    });
    drawerResize.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return;
      startDrag(e.touches[0].clientY);
    }, { passive: true });
    drawerResize.addEventListener('keydown', function (e) {
      var cur = drawerBody.getBoundingClientRect().height;
      if (e.key === 'ArrowUp') { setH(cur + 24); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { setH(cur - 24); e.preventDefault(); }
    });
  })();
  var countBadge = document.getElementById('fv-drawer-count');
  countBadge.textContent = instructions.length ? instructions.length + ' step' + (instructions.length > 1 ? 's' : '') : 'none needed';
  if (!instructions.length) {
    insBox.innerHTML = '<p style="color:var(--clean-ink);font-weight:600;">No fixes needed \\u2014 the implementation matches the design within tolerances.</p>';
    document.getElementById('fv-copy-ins').style.display = 'none';
  } else {
    var oh = '<ol>';
    instructions.forEach(function (ins) {
      oh += '<li><span class="kind-pill">' + esc(ins.kind) + '</span>' + esc(ins.summary);
      if (ins.details.length) {
        oh += '<ul class="ins-details">';
        ins.details.forEach(function (d) { oh += '<li>' + esc(d) + '</li>'; });
        oh += '</ul>';
      }
      if (ins.note) oh += '<div class="ins-note">' + esc(ins.note) + '</div>';
      oh += '</li>';
    });
    oh += '</ol>';
    insBox.innerHTML = oh;

    document.getElementById('fv-copy-ins').addEventListener('click', function () {
      var currentScore = computeScore(profileSel.value);
      var lines = [];
      lines.push('The implementation at ' + (report.liveUrl || 'the live URL') +
        ' drifts from the Figma design "' + report.frameName + '" (fidelity ' + currentScore + '/100, ' + PROFILES[profileSel.value].label.toLowerCase() + ' profile).');
      lines.push('Apply the following ' + instructions.length + ' fix' + (instructions.length > 1 ? 'es' : '') + ' in order, then re-run verify_implementation until the score is 100:');
      lines.push('');
      instructions.forEach(function (ins) {
        lines.push(ins.step + '. ' + ins.summary);
        ins.details.forEach(function (d) { lines.push('   - ' + d); });
        if (ins.note) lines.push('   Note: ' + ins.note);
      });
      var text = lines.join('\\n');
      var btn = this;
      function done(ok) {
        btn.textContent = ok ? 'Copied!' : 'Copy failed';
        showToast(ok ? 'Copied agent prompt to clipboard' : 'Copy failed \\u2014 select and copy manually');
        setTimeout(function () { btn.textContent = 'Copy as agent prompt'; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(true); } catch (err) { done(false); }
        document.body.removeChild(ta);
      }
    });
  }

  // ---------- init ----------
  applyMode('side');
  requestAnimationFrame(fitView);
})();
`;
