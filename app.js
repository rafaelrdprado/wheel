(() => {
  "use strict";

  const COLORS = [
    "#e05a5a", "#4fa3e0", "#5ec98a", "#e0b84f", "#a074e0",
    "#e07ac0", "#4fd0c9", "#e08a4f", "#7a8ce0", "#c9d04f",
  ];

  const SEARCH_CACHE = new Map();
  const IMAGE_CACHE = new Map();
  const STORAGE_KEY = "roleta-comandantes.setores.v1";

  const state = {
    setores: [], // { id, card: {name, artUrl, imageUrl} | null, requestSeq }
  };
  const rowApiById = new Map(); // setor.id -> { input, loadName }

  let isSpinning = false;
  let currentRotation = 0;

  const setoresListEl = document.getElementById("setores-list");
  const addSetorBtn = document.getElementById("add-setor-btn");
  const spinBtn = document.getElementById("spin-btn");
  const canvas = document.getElementById("wheel-canvas");
  const ctx = canvas.getContext("2d");
  const resultEl = document.getElementById("result");
  const resultImg = document.getElementById("result-img");
  const resultName = document.getElementById("result-name");
  const pointerEl = document.querySelector(".pointer");
  const bulkTextarea = document.getElementById("bulk-textarea");
  const bulkLoadBtn = document.getElementById("bulk-load-btn");
  const bulkStatus = document.getElementById("bulk-status");
  const navConfigBtn = document.getElementById("nav-config-btn");
  const navWheelBtn = document.getElementById("nav-wheel-btn");
  const pageConfig = document.getElementById("page-config");
  const pageWheel = document.getElementById("page-wheel");
  const goWheelBtn = document.getElementById("go-wheel-btn");
  const backConfigBtn = document.getElementById("back-config-btn");

  // ---------- Persistence (localStorage) ----------

  function persistSetores() {
    try {
      const data = state.setores.filter((s) => s.card).map((s) => ({ card: s.card }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn("Não foi possível salvar os setores:", err);
    }
  }

  function loadPersistedSetores() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return null;
      return data.filter((entry) => entry && entry.card && entry.card.name);
    } catch (err) {
      console.warn("Não foi possível carregar os setores salvos:", err);
      return null;
    }
  }

  // ---------- View navigation ----------

  function showView(view) {
    const isWheel = view === "wheel";
    pageConfig.classList.toggle("active", !isWheel);
    pageWheel.classList.toggle("active", isWheel);
    navConfigBtn.classList.toggle("active", !isWheel);
    navWheelBtn.classList.toggle("active", isWheel);
    if (isWheel) {
      // The wheel-wrapper has no rendered size while its page is hidden
      // (display: none), so the canvas can only be sized correctly now.
      requestAnimationFrame(drawWheel);
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function debounce(fn, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  function cardToSlim(card) {
    let art = card.image_uris && card.image_uris.art_crop;
    let normal = card.image_uris && card.image_uris.normal;
    if ((!art || !normal) && Array.isArray(card.card_faces)) {
      const face = card.card_faces.find((f) => f.image_uris) || {};
      if (face.image_uris) {
        art = art || face.image_uris.art_crop;
        normal = normal || face.image_uris.normal;
      }
    }
    return { name: card.name, artUrl: art, imageUrl: normal };
  }

  async function searchCommanders(fragment) {
    const key = fragment.trim().toLowerCase();
    if (key.length < 2) return [];
    if (SEARCH_CACHE.has(key)) return SEARCH_CACHE.get(key);
    const query = `is:commander ${fragment}`;
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        SEARCH_CACHE.set(key, []);
        return [];
      }
      const data = await res.json();
      const results = (data.data || []).slice(0, 8).map(cardToSlim);
      SEARCH_CACHE.set(key, results);
      return results;
    } catch (err) {
      console.error("Falha ao buscar comandantes:", err);
      return [];
    }
  }

  function getImage(url) {
    if (!url) return null;
    if (IMAGE_CACHE.has(url)) return IMAGE_CACHE.get(url);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => drawWheel();
    IMAGE_CACHE.set(url, img);
    return img;
  }

  // ---------- Sound effects (synthesized, no external audio files) ----------

  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioCtx = new AudioCtor();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTick(intensity) {
    const ctx2 = ensureAudio();
    if (!ctx2) return;
    const now = ctx2.currentTime;
    const osc = ctx2.createOscillator();
    const gain = ctx2.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(620 + Math.random() * 90, now);
    const peak = 0.12 + 0.18 * intensity;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(gain).connect(ctx2.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  function playWinChime() {
    const ctx2 = ensureAudio();
    if (!ctx2) return;
    const now = ctx2.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((freq, i) => {
      const osc = ctx2.createOscillator();
      const gain = ctx2.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.1;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      osc.connect(gain).connect(ctx2.destination);
      osc.start(t0);
      osc.stop(t0 + 0.6);
    });
  }

  // ---------- Pointer flex animation ----------

  let pointerAnim = null;

  function flexPointer(intensity) {
    if (!pointerEl || !pointerEl.animate) return;
    if (pointerAnim) pointerAnim.cancel();
    const deflect = 14 + 12 * intensity;
    pointerAnim = pointerEl.animate(
      [
        { transform: "translateX(-50%) rotate(0deg)" },
        { transform: `translateX(-50%) rotate(${-deflect}deg)`, offset: 0.4 },
        { transform: "translateX(-50%) rotate(5deg)", offset: 0.75 },
        { transform: "translateX(-50%) rotate(0deg)" },
      ],
      { duration: 160, easing: "ease-out" }
    );
  }

  // ---------- Setor row creation ----------

  function createSetor() {
    const setor = { id: uid(), card: null, requestSeq: 0 };
    state.setores.push(setor);
    const rowApi = buildSetorRow(setor);
    rowApiById.set(setor.id, rowApi);
    updateSpinButtonState();
    drawWheel();
    return rowApi;
  }

  function buildSetorRow(setor) {
    const row = document.createElement("div");
    row.className = "setor-row";
    row.dataset.id = setor.id;

    const dot = document.createElement("div");
    dot.className = "setor-color-dot";
    row.appendChild(dot);

    const inputWrap = document.createElement("div");
    inputWrap.className = "setor-input-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "commander-input";
    input.placeholder = "Nome do comandante...";
    input.autocomplete = "off";
    inputWrap.appendChild(input);

    const suggestList = document.createElement("div");
    suggestList.className = "autocomplete-list hidden";
    inputWrap.appendChild(suggestList);

    row.appendChild(inputWrap);

    const thumb = document.createElement("img");
    thumb.className = "setor-thumb hidden";
    row.appendChild(thumb);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-setor-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remover setor";
    row.appendChild(removeBtn);

    setoresListEl.appendChild(row);

    let activeIndex = -1;
    let currentSuggestions = [];

    function closeSuggestions() {
      suggestList.classList.add("hidden");
      suggestList.innerHTML = "";
      activeIndex = -1;
      currentSuggestions = [];
    }

    function selectCard(card) {
      setor.card = card;
      input.value = card.name;
      thumb.src = card.artUrl || card.imageUrl || "";
      thumb.classList.toggle("hidden", !card.artUrl && !card.imageUrl);
      row.classList.remove("setor-unresolved");
      closeSuggestions();
      updateSpinButtonState();
      drawWheel();
    }

    // Used by bulk import: resolves a pasted name against Scryfall and
    // auto-selects the top match, without requiring the user to interact
    // with the autocomplete dropdown.
    async function loadName(name) {
      input.value = name;
      const results = await searchCommanders(name);
      if (results.length > 0) {
        selectCard(results[0]);
      } else {
        row.classList.add("setor-unresolved");
      }
    }

    function renderSuggestions(list) {
      currentSuggestions = list;
      activeIndex = -1;
      suggestList.innerHTML = "";
      if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "autocomplete-empty";
        empty.textContent = "Nenhum comandante encontrado";
        suggestList.appendChild(empty);
        suggestList.classList.remove("hidden");
        return;
      }
      list.forEach((card, idx) => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.dataset.idx = String(idx);

        const img = document.createElement("img");
        img.src = card.artUrl || card.imageUrl || "";
        item.appendChild(img);

        const span = document.createElement("span");
        span.textContent = card.name;
        item.appendChild(span);

        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectCard(card);
        });

        suggestList.appendChild(item);
      });
      suggestList.classList.remove("hidden");
    }

    const debouncedSearch = debounce(async (fragment) => {
      const seq = ++setor.requestSeq;
      const results = await searchCommanders(fragment);
      if (seq !== setor.requestSeq) return; // stale response
      renderSuggestions(results);
    }, 300);

    input.addEventListener("input", () => {
      setor.card = null;
      thumb.classList.add("hidden");
      thumb.src = "";
      row.classList.remove("setor-unresolved");
      updateSpinButtonState();
      drawWheel();
      const fragment = input.value.trim();
      if (fragment.length < 2) {
        closeSuggestions();
        return;
      }
      debouncedSearch(fragment);
    });

    input.addEventListener("keydown", (e) => {
      if (suggestList.classList.contains("hidden") || currentSuggestions.length === 0) return;
      const items = Array.from(suggestList.querySelectorAll(".autocomplete-item"));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        items.forEach((it, i) => it.classList.toggle("active", i === activeIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        items.forEach((it, i) => it.classList.toggle("active", i === activeIndex));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && currentSuggestions[activeIndex]) {
          selectCard(currentSuggestions[activeIndex]);
        }
      } else if (e.key === "Escape") {
        closeSuggestions();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(closeSuggestions, 120);
    });

    removeBtn.addEventListener("click", () => {
      const idx = state.setores.findIndex((s) => s.id === setor.id);
      if (idx !== -1) state.setores.splice(idx, 1);
      rowApiById.delete(setor.id);
      row.remove();
      updateSpinButtonState();
      drawWheel();
    });

    return { input, loadName, applyCard: selectCard };
  }

  function updateSpinButtonState() {
    const validCount = state.setores.filter((s) => s.card).length;
    spinBtn.disabled = validCount < 2 || isSpinning;
    persistSetores();
  }

  // ---------- Bulk import (paste list) ----------

  async function bulkLoad(rawText) {
    const names = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    bulkLoadBtn.disabled = true;
    const remaining = names.slice();

    // Reuse a single pristine, empty starter setor instead of leaving it blank.
    let firstApi = null;
    if (state.setores.length === 1 && !state.setores[0].card) {
      const existingApi = rowApiById.get(state.setores[0].id);
      if (existingApi && existingApi.input.value.trim() === "") {
        firstApi = existingApi;
      }
    }

    for (let i = 0; i < remaining.length; i++) {
      bulkStatus.textContent = `Carregando ${i + 1} de ${remaining.length}...`;
      const api = i === 0 && firstApi ? firstApi : createSetor();
      await api.loadName(remaining[i]);
    }

    bulkStatus.textContent = `${names.length} setor(es) carregado(s).`;
    bulkTextarea.value = "";
    bulkLoadBtn.disabled = false;
    setTimeout(() => {
      bulkStatus.textContent = "";
    }, 4000);
  }

  // ---------- Wheel drawing ----------

  function drawImageCover(context, img, x, y, w, h) {
    if (!img || !img.width || !img.height) return;
    const imgRatio = img.width / img.height;
    const boxRatio = w / h;
    let sw, sh, sx, sy;
    if (imgRatio > boxRatio) {
      sh = img.height;
      sw = sh * boxRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / boxRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    context.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetSize = Math.round(rect.width * dpr);
    if (targetSize > 0 && canvas.width !== targetSize) {
      canvas.width = targetSize;
      canvas.height = targetSize;
      return true;
    }
    return false;
  }

  function drawWheel() {
    resizeCanvasToDisplaySize();
    const size = canvas.width;
    const radius = size / 2;
    ctx.clearRect(0, 0, size, size);

    const validSetores = state.setores.filter((s) => s.card);
    const n = validSetores.length;

    if (n === 0) {
      ctx.beginPath();
      ctx.arc(radius, radius, radius - 4, 0, Math.PI * 2);
      ctx.fillStyle = "#20202b";
      ctx.fill();
      ctx.fillStyle = "#666";
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Configure setores para começar", radius, radius);
      return;
    }

    const anglePer = (Math.PI * 2) / n;

    validSetores.forEach((setor, i) => {
      const startAngle = i * anglePer - Math.PI / 2;
      const endAngle = startAngle + anglePer;
      const midAngle = startAngle + anglePer / 2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(radius, radius);
      ctx.arc(radius, radius, radius - 4, startAngle, endAngle);
      ctx.closePath();
      ctx.clip();

      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(0, 0, size, size);

      const img = getImage(setor.card.artUrl || setor.card.imageUrl);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.translate(radius, radius);
        // Orient the art radially: the top of the image (usually the
        // commander's head) points outward toward the rim, the bottom
        // (feet) points toward the hub. Only meaningful with 2+ setores.
        if (n > 1) {
          ctx.rotate(midAngle + Math.PI / 2);
        }
        drawImageCover(ctx, img, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(radius, radius);
      ctx.arc(radius, radius, radius - 4, startAngle, endAngle);
      ctx.closePath();
      ctx.strokeStyle = "#0a0a10";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    });

    // Pegs sit exactly on the boundary between two setores, one per boundary,
    // so the wheel can never rest ambiguously between two outcomes.
    if (n > 1) {
      const pegRadius = Math.max(4, size * 0.011);
      const pegOrbit = radius - 4;
      for (let i = 0; i < n; i++) {
        const boundaryAngle = i * anglePer - Math.PI / 2;
        const px = radius + pegOrbit * Math.cos(boundaryAngle);
        const py = radius + pegOrbit * Math.sin(boundaryAngle);
        ctx.beginPath();
        ctx.arc(px, py, pegRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#f0c419";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#7a5c0a";
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(radius, radius, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#0a0a10";
    ctx.fill();
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // ---------- Spin logic ----------

  function spin() {
    if (isSpinning) return;
    const validSetores = state.setores.filter((s) => s.card);
    const n = validSetores.length;
    if (n < 2) return;

    ensureAudio();

    isSpinning = true;
    spinBtn.disabled = true;
    resultEl.classList.add("hidden");
    canvas.classList.remove("landed");

    const anglePer = 360 / n;
    const targetIndex = Math.floor(Math.random() * n);
    const setorMidAngle = targetIndex * anglePer + anglePer / 2;
    const jitter = (Math.random() - 0.5) * (anglePer * 0.6);

    // Resting rotation (mod 360) needed so the setor's midpoint (+ jitter) lands under the
    // fixed top pointer. Must be computed relative to the wheel's CURRENT resting angle,
    // not from zero, since rotation accumulates across spins.
    const desiredRestingMod = (((360 - setorMidAngle + jitter) % 360) + 360) % 360;
    const currentMod = ((currentRotation % 360) + 360) % 360;
    const deltaToTarget = (((desiredRestingMod - currentMod) % 360) + 360) % 360;

    const extraSpins = 6 + Math.floor(Math.random() * 3);
    const rotationAmount = extraSpins * 360 + deltaToTarget;
    const startRotation = currentRotation;
    const finalRotation = currentRotation + rotationAmount;

    const duration = 5200;
    const startTime = performance.now();
    let lastPegStep = Math.floor(startRotation / anglePer);

    canvas.style.transition = "none";

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      const rotation = startRotation + (finalRotation - startRotation) * eased;
      canvas.style.transform = `rotate(${rotation}deg)`;

      const pegStep = Math.floor(rotation / anglePer);
      if (pegStep !== lastPegStep) {
        const crossed = Math.min(pegStep - lastPegStep, 4);
        const speedIntensity = Math.max(0.2, 1 - t); // harder ticks while fast, softer near the end
        for (let k = 0; k < crossed; k++) {
          playTick(speedIntensity);
        }
        flexPointer(speedIntensity);
        lastPegStep = pegStep;
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        currentRotation = finalRotation;
        isSpinning = false;
        updateSpinButtonState();
        canvas.classList.add("landed");
        playWinChime();
        showResult(validSetores[targetIndex]);
      }
    }

    requestAnimationFrame(frame);
  }

  function showResult(setor) {
    resultImg.src = setor.card.imageUrl || setor.card.artUrl || "";
    resultName.textContent = setor.card.name;
    resultEl.classList.remove("hidden");
  }

  // ---------- Init ----------

  addSetorBtn.addEventListener("click", () => createSetor());
  spinBtn.addEventListener("click", () => spin());
  bulkLoadBtn.addEventListener("click", () => bulkLoad(bulkTextarea.value));

  navConfigBtn.addEventListener("click", () => showView("config"));
  navWheelBtn.addEventListener("click", () => showView("wheel"));
  goWheelBtn.addEventListener("click", () => showView("wheel"));
  backConfigBtn.addEventListener("click", () => showView("config"));
  resultEl.addEventListener("click", () => resultEl.classList.add("hidden"));

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (pageWheel.classList.contains("active")) drawWheel();
    }, 150);
  });

  const persisted = loadPersistedSetores();
  if (persisted && persisted.length > 0) {
    persisted.forEach((entry) => {
      const api = createSetor();
      api.applyCard(entry.card);
    });
  } else {
    createSetor();
  }
  drawWheel();
  showView("config");
})();
