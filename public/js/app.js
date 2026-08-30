'use strict';

const state = {
  datasetId: null,
  networks: [],
  filtered: [],
  sortKey: 'pointCount',
  sortDir: -1,
  selectedBssid: null,
  markersLayer: null,
  triMarker: null,
  networkMarkers: new Map(), // bssid -> marker (for highlighting on select)
};

const ENCRYPTIONS = ['WPA3', 'WPA2', 'WPA', 'WEP', 'Offen', 'Unbekannt'];
const BANDS = ['2.4GHz', '5GHz', '6GHz', 'unknown'];

// --- Map setup ---------------------------------------------------------

const map = L.map('map', { zoomControl: true }).setView([51.1657, 10.4515], 6); // Deutschland als Default

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
}).addTo(map);

const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });
map.addLayer(clusterGroup);

let selectionLayer = L.layerGroup().addTo(map);

// --- Helpers -------------------------------------------------------------

function levelColor(level) {
  if (level === null || level === undefined) return '#888';
  if (level >= -50) return '#2ecc71';
  if (level >= -70) return '#f1c40f';
  return '#e74c3c';
}

function fmtTime(unixMs) {
  if (!unixMs) return '–';
  return new Date(unixMs).toLocaleString('de-DE');
}

function setUploadStatus(msg, isError) {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

// --- Filters UI ------------------------------------------------------

function populateSelect(id, values) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}
populateSelect('filter-encryption', ENCRYPTIONS);
populateSelect('filter-band', BANDS);

function getSelectedValues(id) {
  return Array.from(document.getElementById(id).selectedOptions).map((o) => o.value);
}

function currentFilters() {
  return {
    ssid: document.getElementById('filter-ssid').value.trim(),
    encryption: getSelectedValues('filter-encryption'),
    band: getSelectedValues('filter-band'),
    minPoints: Number(document.getElementById('filter-min-points').value || 0),
  };
}

async function fetchNetworks() {
  if (!state.datasetId) return;
  const f = currentFilters();
  const params = new URLSearchParams();
  if (f.ssid) params.set('ssid', f.ssid);
  if (f.encryption.length) params.set('encryption', f.encryption.join(','));
  if (f.band.length) params.set('band', f.band.join(','));
  if (f.minPoints) params.set('minPoints', String(f.minPoints));

  const res = await fetch(`/api/datasets/${state.datasetId}/networks?${params.toString()}`);
  const data = await res.json();
  state.networks = data.networks;
  applySortAndRender();
  renderMapMarkers();
}

document.getElementById('filter-ssid').addEventListener('input', debounce(fetchNetworks, 250));
document.getElementById('filter-encryption').addEventListener('change', fetchNetworks);
document.getElementById('filter-band').addEventListener('change', fetchNetworks);
document.getElementById('filter-min-points').addEventListener('input', debounce(fetchNetworks, 250));
document.getElementById('filter-reset').addEventListener('click', () => {
  document.getElementById('filter-ssid').value = '';
  document.getElementById('filter-min-points').value = 0;
  Array.from(document.getElementById('filter-encryption').options).forEach((o) => (o.selected = false));
  Array.from(document.getElementById('filter-band').options).forEach((o) => (o.selected = false));
  fetchNetworks();
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// --- Table -------------------------------------------------------------

function applySortAndRender() {
  const { sortKey, sortDir } = state;
  const list = [...state.networks].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return sortDir * av.localeCompare(bv);
    return sortDir * (av - bv);
  });
  state.filtered = list;
  renderTable();
}

document.querySelectorAll('#network-table th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir *= -1;
    } else {
      state.sortKey = key;
      state.sortDir = -1;
    }
    applySortAndRender();
  });
});

function renderTable() {
  const tbody = document.getElementById('network-table-body');
  tbody.innerHTML = '';
  document.getElementById('network-count').textContent = `(${state.filtered.length})`;

  if (state.filtered.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-state';
    td.textContent = state.datasetId ? 'Keine Netze für diese Filter.' : 'Bitte zuerst eine WiGLE-SQLite-Datei laden.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const n of state.filtered) {
    const tr = document.createElement('tr');
    tr.dataset.bssid = n.bssid;
    if (n.bssid === state.selectedBssid) tr.classList.add('selected');
    tr.innerHTML = `
      <td title="${escapeHtml(n.ssid)}">${escapeHtml(n.ssid)}</td>
      <td><span class="badge ${n.encryption}">${n.encryption}</span></td>
      <td>${n.band}</td>
      <td>${n.pointCount}</td>
      <td>${n.bestLevel ?? '–'} dBm</td>
    `;
    tr.addEventListener('click', () => selectNetwork(n.bssid));
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- Map markers ---------------------------------------------------------

function renderMapMarkers() {
  clusterGroup.clearLayers();
  state.networkMarkers.clear();
  for (const n of state.filtered) {
    if (!n.bestLat && !n.bestLon) continue;
    if (n.bestLat === 0 && n.bestLon === 0) continue;
    const marker = L.circleMarker([n.bestLat, n.bestLon], {
      radius: 6,
      color: levelColor(n.bestLevel),
      fillColor: levelColor(n.bestLevel),
      fillOpacity: 0.85,
      weight: 1,
    });
    marker.bindPopup(`<strong>${escapeHtml(n.ssid)}</strong><br>${n.bssid}<br>${n.encryption} · ${n.band}<br>${n.bestLevel} dBm`);
    marker.on('click', () => selectNetwork(n.bssid));
    state.networkMarkers.set(n.bssid, marker);
    clusterGroup.addLayer(marker);
  }
}

function fitToBounds(bounds) {
  if (!bounds) return;
  const b = L.latLngBounds(
    [bounds.minLat, bounds.minLon],
    [bounds.maxLat, bounds.maxLon]
  );
  if (b.isValid()) {
    map.fitBounds(b.pad(0.15));
  }
}

// --- Selection / detail panel -------------------------------------------

async function selectNetwork(bssid) {
  state.selectedBssid = bssid;
  renderTable();
  const network = state.networks.find((n) => n.bssid === bssid);
  if (!network) return;

  selectionLayer.clearLayers();
  const detailPanel = document.getElementById('detail-panel');
  detailPanel.classList.remove('hidden');
  document.getElementById('detail-ssid').textContent = network.ssid;

  const body = document.getElementById('detail-body');
  body.innerHTML = `
    <div class="detail-row"><span>BSSID</span><span>${network.bssid}</span></div>
    <div class="detail-row"><span>Verschlüsselung</span><span>${network.encryption}</span></div>
    <div class="detail-row"><span>Capabilities</span><span>${escapeHtml(network.capabilities)}</span></div>
    <div class="detail-row"><span>Frequenz</span><span>${network.frequency} MHz (${network.band})</span></div>
    <div class="detail-row"><span>Bestes Signal</span><span>${network.bestLevel} dBm</span></div>
    <div class="detail-row"><span>Messpunkte</span><span>${network.pointCount}</span></div>
    <div class="detail-row"><span>Zuletzt gesehen</span><span>${fmtTime(network.lastSeen)}</span></div>
    <button id="triangulate-btn">Triangulieren</button>
    <div id="tri-result"></div>
  `;

  const locRes = await fetch(`/api/datasets/${state.datasetId}/networks/${encodeURIComponent(bssid)}/locations`);
  const locData = await locRes.json();
  const points = locData.points || [];

  for (const p of points) {
    L.circleMarker([p.lat, p.lon], {
      radius: 4,
      color: '#4fb3ff',
      fillColor: '#4fb3ff',
      fillOpacity: 0.6,
      weight: 1,
    }).addTo(selectionLayer);
  }

  if (points.length) {
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    map.fitBounds(b.pad(0.3), { maxZoom: 18 });
  } else if (network.bestLat && network.bestLon) {
    map.setView([network.bestLat, network.bestLon], 17);
  }

  document.getElementById('triangulate-btn').addEventListener('click', () => triangulateNetwork(bssid));
}

async function triangulateNetwork(bssid) {
  const resultEl = document.getElementById('tri-result');
  resultEl.innerHTML = '<div class="tri-note">Berechne…</div>';
  const res = await fetch(`/api/datasets/${state.datasetId}/networks/${encodeURIComponent(bssid)}/triangulate`);
  if (!res.ok) {
    const err = await res.json();
    resultEl.innerHTML = `<div class="tri-note">${escapeHtml(err.error)}</div>`;
    return;
  }
  const data = await res.json();

  if (state.triMarker) {
    selectionLayer.removeLayer(state.triMarker);
  }
  state.triMarker = L.marker([data.lat, data.lon], {
    icon: L.divIcon({
      className: '',
      html: '<div style="background:#ffb454;width:14px;height:14px;border-radius:50%;border:2px solid #2b1c00;"></div>',
      iconSize: [14, 14],
    }),
  }).addTo(selectionLayer);
  if (data.accuracyM) {
    L.circle([data.lat, data.lon], { radius: data.accuracyM, color: '#ffb454', fillOpacity: 0.05 }).addTo(selectionLayer);
  }
  state.triMarker.bindPopup(`Geschätzte Position (${data.method})`).openPopup();
  map.panTo([data.lat, data.lon]);

  const methodLabel = {
    single: 'Nur ein Messpunkt vorhanden – Position entspricht diesem Punkt.',
    centroid: 'Zu geringe geometrische Streuung der Messpunkte für Multilateration – gewichteter Mittelpunkt verwendet.',
    multilateration: 'Multilateration auf Basis mehrerer Messpunkte und Signalstärken.',
  }[data.method] || '';

  resultEl.innerHTML = `
    <div class="detail-row"><span>Methode</span><span>${data.method}</span></div>
    <div class="detail-row"><span>Verw. Punkte</span><span>${data.pointsUsed}</span></div>
    <div class="detail-row"><span>Geschätzte Genauigkeit</span><span>${data.accuracyM ? data.accuracyM + ' m' : '–'}</span></div>
    <div class="tri-note">${methodLabel} Hinweis: WLAN-Signalstärke ist keine exakte Entfernungsmessung – das Ergebnis ist eine Schätzung.</div>
  `;
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.add('hidden');
  state.selectedBssid = null;
  selectionLayer.clearLayers();
  renderTable();
});

// --- Upload --------------------------------------------------------------

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setUploadStatus(`Lade ${file.name}…`, false);

  const formData = new FormData();
  formData.append('database', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      setUploadStatus(data.error || 'Fehler beim Import.', true);
      return;
    }
    state.datasetId = data.datasetId;
    setUploadStatus(`${data.networkCount} Netze aus "${data.fileName}" geladen.`, false);
    fitToBounds(data.bounds);
    await fetchNetworks();
  } catch (err) {
    setUploadStatus('Fehler beim Hochladen: ' + err.message, true);
  }
});

renderTable();
