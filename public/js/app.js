'use strict';

const state = {
  networkRows: [],       // rohe network-Tabelle
  locations: [],         // alle location-Punkte (ungefiltert)
  timeRange: null,       // {min, max} ueber alle locations
  timeFilter: null,      // {from, to} aktuell gewaehlt (ms), null = alles
  networks: [],          // aktuell gefilterte (inkl. Zeitfenster) Netz-Liste
  sortKey: 'pointCount',
  sortDir: -1,
  selectedBssid: null,
  showHeatmap: false,
};

const ENCRYPTIONS = ['WPA3', 'WPA2', 'WPA', 'WEP', 'Offen', 'Unbekannt'];
const BANDS = ['2.4GHz', '5GHz', '6GHz', 'unknown'];
const AUTO_TRIANGULATE_MIN_POINTS = WigleTriangulate.AUTO_TRIANGULATE_MIN_POINTS;

// --- Map setup ---------------------------------------------------------

const map = L.map('map', { zoomControl: true }).setView([51.1657, 10.4515], 6); // Deutschland als Default

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
}).addTo(map);

const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });
map.addLayer(clusterGroup);

let heatLayer = null;
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

function fmtDate(unixMs) {
  return new Date(unixMs).toLocaleDateString('de-DE');
}

function setUploadStatus(msg, isError) {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- Mobile sidebar ------------------------------------------------------

const sidebarEl = document.getElementById('sidebar');
const backdropEl = document.getElementById('sidebar-backdrop');

function openSidebar() {
  sidebarEl.classList.add('open');
  backdropEl.classList.add('visible');
}
function closeSidebar() {
  sidebarEl.classList.remove('open');
  backdropEl.classList.remove('visible');
}
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar();
});
backdropEl.addEventListener('click', closeSidebar);

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

// --- Time slider (noUiSlider) --------------------------------------------

let timeSlider = null;

function setupTimeSlider(range) {
  const el = document.getElementById('time-slider');
  if (timeSlider) {
    timeSlider.destroy();
    timeSlider = null;
  }
  if (!range || range.min === range.max) {
    el.style.display = 'none';
    document.getElementById('time-range-label').textContent = '';
    state.timeFilter = null;
    return;
  }
  el.style.display = '';
  noUiSlider.create(el, {
    start: [range.min, range.max],
    connect: true,
    range: { min: range.min, max: range.max },
    step: 60 * 60 * 1000, // 1h Schritte
  });
  timeSlider = el.noUiSlider;
  updateTimeLabel(range.min, range.max);
  timeSlider.on('update', (values) => {
    const from = Math.round(Number(values[0]));
    const to = Math.round(Number(values[1]));
    updateTimeLabel(from, to);
    state.timeFilter = (from <= range.min && to >= range.max) ? null : { from, to };
  });
  timeSlider.on('change', () => {
    applyAllFilters();
  });
}

function updateTimeLabel(from, to) {
  document.getElementById('time-range-label').textContent = `${fmtDate(from)} – ${fmtDate(to)}`;
}

// --- Filtering / aggregation (rein clientseitig, keine Server-Requests) --

function applyAllFilters() {
  const timeFiltered = state.timeFilter
    ? WigleData.filterLocationsByTime(state.locations, state.timeFilter.from, state.timeFilter.to)
    : state.locations;

  const locationsByBssid = WigleData.indexLocationsByBssid(timeFiltered);
  const allNetworks = WigleData.buildNetworks(state.networkRows, locationsByBssid);
  state.networks = WigleData.filterNetworks(allNetworks, currentFilters());
  state.currentLocationsByBssid = locationsByBssid;
  state.visiblePoints = timeFiltered;

  applySortAndRender();
  renderMapLayer();
}

document.getElementById('filter-ssid').addEventListener('input', debounce(applyAllFilters, 200));
document.getElementById('filter-encryption').addEventListener('change', applyAllFilters);
document.getElementById('filter-band').addEventListener('change', applyAllFilters);
document.getElementById('filter-min-points').addEventListener('input', debounce(applyAllFilters, 200));
document.getElementById('filter-heatmap').addEventListener('change', (e) => {
  state.showHeatmap = e.target.checked;
  renderMapLayer();
});
document.getElementById('filter-reset').addEventListener('click', () => {
  document.getElementById('filter-ssid').value = '';
  document.getElementById('filter-min-points').value = 0;
  Array.from(document.getElementById('filter-encryption').options).forEach((o) => (o.selected = false));
  Array.from(document.getElementById('filter-band').options).forEach((o) => (o.selected = false));
  if (timeSlider && state.timeRange) {
    timeSlider.set([state.timeRange.min, state.timeRange.max]);
  }
  applyAllFilters();
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
  state.networks = list;
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
  document.getElementById('network-count').textContent = `(${state.networks.length})`;

  if (state.networks.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty-state';
    td.textContent = state.networkRows.length ? 'Keine Netze für diese Filter.' : 'Bitte zuerst eine WiGLE-SQLite-Datei laden.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const n of state.networks) {
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
    tr.addEventListener('click', () => {
      selectNetwork(n.bssid);
      closeSidebar();
    });
    tbody.appendChild(tr);
  }
}

// --- Map layer (Marker-Cluster oder Heatmap) ------------------------------

function renderMapLayer() {
  clusterGroup.clearLayers();
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }

  if (state.showHeatmap) {
    const heatPoints = state.visiblePoints
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0))
      .map((p) => {
        // Intensitaet grob aus Signalstaerke: -30dBm=stark -> 1.0, -100dBm=schwach -> ~0.1
        const intensity = Math.min(1, Math.max(0.1, (p.level + 100) / 70));
        return [p.lat, p.lon, intensity];
      });
    if (heatPoints.length) {
      heatLayer = L.heatLayer(heatPoints, { radius: 20, blur: 18, maxZoom: 17 });
      heatLayer.addTo(map);
    }
    return;
  }

  for (const n of state.networks) {
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
    clusterGroup.addLayer(marker);
  }
}

function fitToBounds(bounds) {
  if (!bounds) return;
  const b = L.latLngBounds([bounds.minLat, bounds.minLon], [bounds.maxLat, bounds.maxLon]);
  if (b.isValid()) {
    map.fitBounds(b.pad(0.15));
  }
}

// --- Selection / detail panel -------------------------------------------

function selectNetwork(bssid) {
  state.selectedBssid = bssid;
  renderTable();
  const network = state.networks.find((n) => n.bssid === bssid)
    || WigleData.buildNetworks(state.networkRows.filter((r) => r.bssid === bssid), state.currentLocationsByBssid)[0];
  if (!network) return;

  selectionLayer.clearLayers();
  const detailPanel = document.getElementById('detail-panel');
  detailPanel.classList.remove('hidden');
  document.getElementById('detail-ssid').textContent = network.ssid;

  const points = (state.currentLocationsByBssid.get(bssid) || []).slice();

  const body = document.getElementById('detail-body');
  body.innerHTML = `
    <div class="detail-row"><span>BSSID</span><span>${network.bssid}</span></div>
    <div class="detail-row"><span>Verschlüsselung</span><span>${network.encryption}</span></div>
    <div class="detail-row"><span>Capabilities</span><span>${escapeHtml(network.capabilities)}</span></div>
    <div class="detail-row"><span>Frequenz</span><span>${network.frequency} MHz (${network.band})</span></div>
    <div class="detail-row"><span>Bestes Signal</span><span>${network.bestLevel} dBm</span></div>
    <div class="detail-row"><span>Messpunkte (Zeitfenster)</span><span>${points.length}</span></div>
    <div class="detail-row"><span>Zuletzt gesehen</span><span>${fmtTime(network.lastSeen)}</span></div>
    <button id="triangulate-btn">Triangulieren</button>
    <div id="tri-result"></div>
  `;

  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.lat === 0 && p.lon === 0)) continue;
    L.circleMarker([p.lat, p.lon], {
      radius: 4,
      color: '#4fb3ff',
      fillColor: '#4fb3ff',
      fillOpacity: 0.6,
      weight: 1,
    }).addTo(selectionLayer);
  }

  const validPoints = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0));
  if (validPoints.length) {
    const b = L.latLngBounds(validPoints.map((p) => [p.lat, p.lon]));
    map.fitBounds(b.pad(0.3), { maxZoom: 18 });
  } else if (network.bestLat && network.bestLon) {
    map.setView([network.bestLat, network.bestLon], 17);
  }

  document.getElementById('triangulate-btn').addEventListener('click', () => runTriangulation(bssid, false));

  // Automatische Triangulation ab ausreichend vielen Messpunkten (siehe
  // AUTO_TRIANGULATE_MIN_POINTS): mit >=4 raeumlich verteilten Punkten wird
  // das Gleichungssystem ueberbestimmt und die Genauigkeitsangabe
  // aussagekraeftig -- darunter bleibt es eine bewusst manuelle Aktion.
  if (validPoints.length >= AUTO_TRIANGULATE_MIN_POINTS) {
    runTriangulation(bssid, true);
  }
}

function runTriangulation(bssid, isAuto) {
  const resultEl = document.getElementById('tri-result');
  const points = state.currentLocationsByBssid.get(bssid) || [];
  const result = WigleTriangulate.triangulate(points);

  if (!result) {
    resultEl.innerHTML = '<div class="tri-note">Keine gültigen Standortdaten für dieses Netz (im aktuellen Zeitfenster) vorhanden.</div>';
    return;
  }

  const oldTriMarker = state.triMarker;
  if (oldTriMarker) selectionLayer.removeLayer(oldTriMarker);

  const triMarker = L.marker([result.lat, result.lon], {
    icon: L.divIcon({
      className: '',
      html: '<div style="background:#ffb454;width:14px;height:14px;border-radius:50%;border:2px solid #2b1c00;"></div>',
      iconSize: [14, 14],
    }),
  }).addTo(selectionLayer);
  state.triMarker = triMarker;

  if (result.accuracyM) {
    L.circle([result.lat, result.lon], { radius: result.accuracyM, color: '#ffb454', fillOpacity: 0.05 }).addTo(selectionLayer);
  }
  triMarker.bindPopup(`Geschätzte Position (${result.method})`);
  if (!isAuto) {
    triMarker.openPopup();
    map.panTo([result.lat, result.lon]);
  }

  const methodLabel = {
    single: 'Nur ein Messpunkt vorhanden – Position entspricht diesem Punkt.',
    centroid: 'Zu geringe geometrische Streuung der Messpunkte für Multilateration – gewichteter Mittelpunkt verwendet.',
    multilateration: 'Multilateration auf Basis mehrerer Messpunkte und Signalstärken.',
  }[result.method] || '';

  resultEl.innerHTML = `
    <div class="detail-row"><span>Methode ${isAuto ? '<span class="tri-auto-badge">automatisch</span>' : ''}</span><span>${result.method}</span></div>
    <div class="detail-row"><span>Verw. Punkte</span><span>${result.pointsUsed}</span></div>
    <div class="detail-row"><span>Geschätzte Genauigkeit</span><span>${result.accuracyM ? result.accuracyM + ' m' : '–'}</span></div>
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

  try {
    const arrayBuffer = await file.arrayBuffer();
    const { networkRows, locations } = await WigleDb.parseWigleFile(arrayBuffer);

    state.networkRows = networkRows;
    state.locations = locations;
    state.timeRange = WigleData.computeTimeRange(locations);
    state.selectedBssid = null;
    document.getElementById('detail-panel').classList.add('hidden');
    selectionLayer.clearLayers();

    setupTimeSlider(state.timeRange);
    applyAllFilters();

    const allNetworks = WigleData.buildNetworks(networkRows, WigleData.indexLocationsByBssid(locations));
    fitToBounds(WigleData.computeBounds(allNetworks));

    setUploadStatus(`${networkRows.length} Netze aus "${file.name}" geladen (${locations.length} Messpunkte).`, false);
  } catch (err) {
    setUploadStatus('Fehler beim Import: ' + err.message, true);
  }
});

renderTable();
