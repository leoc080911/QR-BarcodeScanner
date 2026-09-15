(function () {
  "use strict";

  const STORAGE_KEY = "scanner_history_v1";
  const MAX_HISTORY = 100;

  const video = document.getElementById("video");
  const frame = document.getElementById("frame");
  const noCam = document.getElementById("noCam");
  const retryCam = document.getElementById("retryCam");
  const torchBtn = document.getElementById("torchBtn");
  const switchBtn = document.getElementById("switchBtn");
  const toast = document.getElementById("toast");

  const resultModal = document.getElementById("resultModal");
  const rType = document.getElementById("rType");
  const rThumb = document.getElementById("rThumb");
  const rContent = document.getElementById("rContent");
  const rActions = document.getElementById("rActions");
  const rClose = document.getElementById("rClose");

  const histList = document.getElementById("histList");
  const clearHist = document.getElementById("clearHist");

  const tabs = document.querySelectorAll(".tab");
  const paneHistory = document.getElementById("pane-history");
  const paneGenerate = document.getElementById("pane-generate");

  const genInput = document.getElementById("genInput");
  const genBtn = document.getElementById("genBtn");
  const genOut = document.getElementById("genOut");
  const genCanvas = document.getElementById("genCanvas");
  const genDownload = document.getElementById("genDownload");

  let reader = null;
  let currentDeviceId = null;
  let videoDevices = [];
  let torchOn = false;
  let currentTrack = null;
  let paused = false;
  let lastCode = null;
  let lastCodeTime = 0;

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  // ---------- History ----------
  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveHistory(list) {
    let trimmed = list.slice(0, MAX_HISTORY);
    while (trimmed.length) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        return;
      } catch (e) {
        // Storage full (images take space) — drop the oldest entries and retry.
        trimmed = trimmed.slice(0, Math.max(0, trimmed.length - 5));
      }
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }
  function addHistory(entry) {
    const list = loadHistory();
    list.unshift(entry);
    saveHistory(list);
    renderHistory();
  }

  function detectKind(text) {
    if (/^https?:\/\//i.test(text)) return { kind: "url", icon: "🔗", label: "LIEN" };
    if (/^BEGIN:VCARD/i.test(text)) return { kind: "vcard", icon: "👤", label: "CONTACT" };
    if (/^WIFI:/i.test(text)) return { kind: "wifi", icon: "📶", label: "WIFI" };
    if (/^mailto:/i.test(text)) return { kind: "email", icon: "✉️", label: "EMAIL" };
    if (/^tel:/i.test(text)) return { kind: "tel", icon: "📞", label: "TÉLÉPHONE" };
    if (/^smsto:|^sms:/i.test(text)) return { kind: "sms", icon: "💬", label: "SMS" };
    if (/^\d{8,14}$/.test(text)) return { kind: "barcode", icon: "▤", label: "CODE-BARRES" };
    return { kind: "text", icon: "✎", label: "TEXTE" };
  }

  function renderHistory() {
    const list = loadHistory();
    if (!list.length) {
      histList.innerHTML = '<div class="empty">Aucun scan pour le moment.</div>';
      return;
    }
    histList.innerHTML = "";
    list.forEach((item) => {
      const meta = detectKind(item.text);
      const row = document.createElement("div");
      row.className = "hrow";
      const thumb = item.img
        ? `<img src="${item.img}" alt="" class="hthumb">`
        : meta.icon;
      row.innerHTML = `
        <div class="htype">${thumb}</div>
        <div class="hbody">
          <div class="htext mono">${escapeHtml(item.text)}</div>
          <div class="hmeta">${meta.label} · ${formatTime(item.time)}</div>
        </div>
        <div class="hact">
          <button class="copyBtn" title="Copier">⧉</button>
          ${item.img ? '<button class="dlBtn" title="Télécharger l\'image">⬇</button>' : ""}
        </div>
      `;
      row.querySelector(".hbody").addEventListener("click", () => openResult(item));
      row.querySelector(".copyBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(item.text);
      });
      const dlBtn = row.querySelector(".dlBtn");
      if (dlBtn) {
        dlBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          downloadImage(item.img, item.time);
        });
      }
      histList.appendChild(row);
    });
  }

  function downloadImage(dataUrl, time) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `scan-${time}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return time;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + time;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  clearHist.addEventListener("click", () => {
    if (confirm("Effacer tout l'historique ?")) {
      saveHistory([]);
      renderHistory();
    }
  });

  // ---------- Tabs ----------
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("on"));
      tab.classList.add("on");
      const pane = tab.dataset.pane;
      paneHistory.style.display = pane === "history" ? "block" : "none";
      paneGenerate.style.display = pane === "generate" ? "block" : "none";
    });
  });

  // ---------- Copy / share ----------
  function copyText(text) {
    navigator.clipboard?.writeText(text).then(
      () => showToast("Copié dans le presse-papiers"),
      () => showToast("Impossible de copier")
    );
  }

  // ---------- Result modal ----------
  function openResult(itemOrText) {
    const item = typeof itemOrText === "string" ? { text: itemOrText, img: null } : itemOrText;
    const text = item.text;
    const meta = detectKind(text);
    rType.textContent = meta.label;
    rContent.textContent = text;
    rActions.innerHTML = "";

    if (item.img) {
      rThumb.src = item.img;
      rThumb.style.display = "block";
    } else {
      rThumb.style.display = "none";
    }

    const addAction = (label, handler, primary) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      if (primary) btn.classList.add("primary");
      btn.addEventListener("click", handler);
      rActions.appendChild(btn);
    };

    if (meta.kind === "url") {
      const a = document.createElement("a");
      a.href = text;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "primary";
      a.textContent = "Ouvrir le lien";
      rActions.appendChild(a);
    } else if (meta.kind === "tel") {
      const a = document.createElement("a");
      a.href = text;
      a.className = "primary";
      a.textContent = "Appeler";
      rActions.appendChild(a);
    } else if (meta.kind === "email") {
      const a = document.createElement("a");
      a.href = text;
      a.className = "primary";
      a.textContent = "Envoyer un email";
      rActions.appendChild(a);
    } else if (meta.kind === "wifi") {
      addAction("Copier les identifiants", () => copyText(text), true);
    }

    addAction("Copier", () => copyText(text), meta.kind === "text" || meta.kind === "vcard" || meta.kind === "barcode");
    if (item.img) {
      addAction("Télécharger l'image", () => downloadImage(item.img, item.time || Date.now()));
    }
    if (navigator.share) {
      addAction("Partager", () => navigator.share({ text }).catch(() => {}));
    }

    resultModal.classList.add("show");
    paused = true;
  }
  rClose.addEventListener("click", () => {
    resultModal.classList.remove("show");
    paused = false;
  });

  // ---------- Scan handling ----------
  function captureFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const size = Math.min(vw, vh);
    const sx = (vw - size) / 2, sy = (vh - size) / 2;
    const outSize = 260;
    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, sx, sy, size, size, 0, 0, outSize, outSize);
    try {
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch (e) {
      return null; // e.g. tainted canvas
    }
  }

  function onScanSuccess(text) {
    const now = Date.now();
    if (text === lastCode && now - lastCodeTime < 2500) return; // debounce repeats
    lastCode = text;
    lastCodeTime = now;

    frame.classList.add("hit");
    setTimeout(() => frame.classList.remove("hit"), 500);

    if (navigator.vibrate) navigator.vibrate(60);
    const img = captureFrame();
    const entry = { text, time: now, img };
    addHistory(entry);
    openResult(entry);
  }

  // ---------- Camera setup (ZXing) ----------
  async function listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter((d) => d.kind === "videoinput");
    } catch (e) {
      videoDevices = [];
    }
  }

  async function startCamera(deviceId) {
    if (!reader) reader = new ZXing.BrowserMultiFormatReader();
    try {
      noCam.style.display = "none";
      video.style.display = "block";

      const constraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } };

      await reader.decodeFromConstraints(
        { video: constraints, audio: false },
        video,
        (result, err) => {
          if (paused) return;
          if (result) onScanSuccess(result.getText());
        }
      );

      const stream = video.srcObject;
      currentTrack = stream?.getVideoTracks?.()[0] || null;
      currentDeviceId = currentTrack?.getSettings?.().deviceId || deviceId;

      const caps = currentTrack?.getCapabilities?.();
      torchBtn.style.display = caps && caps.torch ? "flex" : "none";

      if (!videoDevices.length) await listCameras();
      switchBtn.style.display = videoDevices.length > 1 ? "flex" : "none";
    } catch (err) {
      console.error(err);
      video.style.display = "none";
      noCam.style.display = "flex";
    }
  }

  retryCam.addEventListener("click", () => startCamera(currentDeviceId));

  switchBtn.addEventListener("click", async () => {
    if (videoDevices.length < 2) return;
    const idx = videoDevices.findIndex((d) => d.deviceId === currentDeviceId);
    const next = videoDevices[(idx + 1) % videoDevices.length];
    reader?.reset();
    await startCamera(next.deviceId);
  });

  torchBtn.addEventListener("click", async () => {
    if (!currentTrack) return;
    try {
      torchOn = !torchOn;
      await currentTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
      torchBtn.classList.toggle("active", torchOn);
    } catch (e) {
      showToast("Flash non disponible");
    }
  });

  // ---------- Generate QR ----------
  genBtn.addEventListener("click", () => {
    const text = genInput.value.trim();
    if (!text) {
      showToast("Entre du texte à encoder");
      return;
    }
    QRCode.toCanvas(genCanvas, text, { width: 220, margin: 1 }, (err) => {
      if (err) {
        showToast("Erreur de génération");
        return;
      }
      genOut.style.display = "flex";
      genDownload.href = genCanvas.toDataURL("image/png");
    });
  });

  // ---------- PWA install / service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- Init ----------
  renderHistory();
  startCamera();
})();
