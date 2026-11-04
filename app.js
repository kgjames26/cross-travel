const $ = (selector) => document.querySelector(selector);
const DEFAULT_ROUTER = 'https://valhalla1.openstreetmap.de/route';
const BROUTER_URL = 'https://brouter.de/brouter';
function readNavigationResumeSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem('ct_navigation_resume') || 'null');
    return snapshot?.route?.path?.length > 1 && snapshot?.origin && snapshot?.destination ? snapshot : null;
  } catch { return null; }
}
const state = {
  map: null, tileLayer: null, streetLayer: null, satelliteLayer: null, mapStyle: localStorage.getItem('ct_map_style') || "osm", satelliteErrors: 0, satelliteLoaded: false, satelliteLoadTimer: null, route: null, routeLayer: null, stepLayers: [], markers: [],
  origin: null, destination: null, currentStep: 0, watchId: null, wakeLock: null,
  lastPosition: null, navigationMarker: null, rerouting: false, lastRerouteAt: 0,
  lastGeocodeAt: 0, routeServer: localStorage.getItem('ct_route_server') || DEFAULT_ROUTER,
  mode: localStorage.getItem('ct_mode') || 'vtt', mapPickTarget: null, manualMode: false, manualReturnToStart: false, manualPoints: [], manualLegs: [], manualMarkers: [], manualLine: null, manualController: null, manualRoutingVersion: 0,
  seekIntense: localStorage.getItem('ct_seek_intense') === 'true',
  familyFast: localStorage.getItem('ct_family_fast') === 'true',
  voiceEnabled: localStorage.getItem('ct_voice_enabled') !== 'false', lastSpokenStep: -1,
  distanceTravelledMeters: 0, movingDistanceMeters: 0, movingSeconds: 0,
  currentSpeedKmh: 0, previousGpsSample: null, routeStartDistanceTravelled: 0, lastHeading: null, lastMapBearing: 0, navigationHeading: null, lastNavigationZoomAt: 0, navigationFollow: true, programmaticNavigationZoom: false,
  searchTimers: {}, searchControllers: {}, suggestions: {origin: [], destination: []},
  navigationAvoids: [], navigationViaPoints: [], navigationSegments: [], navigationManualRoute: false, navigationPointLayers: [], navigationRerouteController: null, navigationRerouteVersion: 0,
  navigationResumeSnapshot: readNavigationResumeSnapshot(), lastResumeSaveAt: 0, manualUndo: null,
  saved: JSON.parse(localStorage.getItem('ct_saved_routes') || '[]')
};

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.remove('has-action'); node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

function toastWithAction(message, label, action) {
  const node = $('#toast');
  node.replaceChildren(document.createTextNode(message));
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'toast-undo-button'; button.textContent = label;
  button.addEventListener('click', () => { clearTimeout(toast.timer); node.classList.remove('show', 'has-action'); action(); });
  node.append(button); node.classList.add('show', 'has-action');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show', 'has-action'), 6500);
}

function resumeRouteTitle(snapshot) {
  return snapshot.title || [snapshot.originLabel, snapshot.destinationLabel].filter(Boolean).join(' → ') || 'Votre itinéraire';
}

function renderResumeTripCard() {
  const card = $('#resume-trip-card');
  if (!card) return;
  const snapshot = state.navigationResumeSnapshot || readNavigationResumeSnapshot();
  state.navigationResumeSnapshot = snapshot;
  card.classList.toggle('hidden', !snapshot || document.body.classList.contains('nav-active'));
  if (!snapshot) return;
  $('#resume-trip-title').textContent = resumeRouteTitle(snapshot);
  $('#resume-trip-progress').textContent = `Dernière position enregistrée · ${formatDistance(snapshot.distanceTravelledMeters || 0)} parcourus`;
}

function persistNavigationResume(force = false) {
  if (!state.route || !document.body.classList.contains('nav-active')) return;
  const now = Date.now();
  if (!force && now - state.lastResumeSaveAt < 5000) return;
  const compactSteps = steps => (steps || []).map(step => ({
    instructions: step.instructions, distanceMeters: step.distanceMeters, endLocation: step.endLocation
  }));
  const compactSegments = state.navigationSegments.map(segment => ({
    path: segment.path, distanceMeters: segment.distanceMeters, durationSeconds: segment.durationSeconds,
    legs: [{steps: compactSteps(segment.legs?.[0]?.steps)}]
  }));
  const route = {
    manual: Boolean(state.route.manual), path: state.route.path, distanceMeters: state.route.distanceMeters,
    durationSeconds: state.route.durationSeconds, legs: [{steps: compactSteps(state.route.legs?.[0]?.steps)}],
    navigationAvoids: state.navigationAvoids, navigationViaPoints: state.navigationViaPoints,
    navigationSegments: compactSegments
  };
  const snapshot = {
    version: 1, savedAt: now, title: [$('#origin-input').value.trim(), $('#destination-input').value.trim()].filter(Boolean).join(' → '),
    mode: state.mode, familyFast: state.familyFast, seekIntense: state.seekIntense,
    route, origin: state.origin, destination: state.destination,
    originLabel: $('#origin-input').value, destinationLabel: $('#destination-input').value,
    lastPosition: state.lastPosition, currentStep: state.currentStep,
    distanceTravelledMeters: state.distanceTravelledMeters, movingDistanceMeters: state.movingDistanceMeters,
    movingSeconds: state.movingSeconds, routeStartDistanceTravelled: state.routeStartDistanceTravelled,
    manualPoints: state.manualPoints, manualLegs: state.manualLegs, manualReturnToStart: state.manualReturnToStart,
    navigationHeading: state.navigationHeading, lastSpokenStep: state.lastSpokenStep
  };
  try {
    localStorage.setItem('ct_navigation_resume', JSON.stringify(snapshot));
    state.navigationResumeSnapshot = snapshot; state.lastResumeSaveAt = now;
  } catch {}
}
function openModal(id) {
  $('#'+id).classList.remove('hidden');
  if (id === 'settings-modal') $('#route-server-input').value = state.routeServer;
}
function closeModal(id) { $('#'+id).classList.add('hidden'); }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatDistance(meters) {
  const kilometers = Math.max(0, Number(meters) || 0) / 1000;
  const precision = kilometers < 10 ? 2 : 1;
  return `${kilometers.toFixed(precision).replace('.', ',')} km`;
}
function formatProximity(meters) {
  return meters < 1000 ? `${Math.max(0, Math.round(meters))} m` : formatDistance(meters);
}
function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
function toMeters(kilometers) { return Number(kilometers || 0) * 1000; }
function routeLabel() { return `${$('#origin-input').value.trim()} → ${$('#destination-input').value.trim()}`; }
function startMarkerIcon() {
  return L.divIcon({
    className: 'start-logo-shell',
    html: '<span class="start-logo-marker"><img src="assets/start-flag.svg" alt="" /></span>',
    iconSize: [82, 42], iconAnchor: [41, 21]
  });
}

function createStartMarker(point) {
  return L.marker([point.lat, point.lon], {
    icon: startMarkerIcon(), interactive: false, keyboard: false, zIndexOffset: 1400
  });
}

function setPoint(which, point, label) {
  state[which] = {lat: Number(point.lat), lon: Number(point.lon)};
  $(`#${which}-input`).value = label || 'Point choisi sur la carte';
  closeSuggestions(which);
  if (state.map) {
    state.markers = state.markers.filter(marker => { state.map.removeLayer(marker); return false; });
    const modeColor = getComputedStyle(document.body).getPropertyValue('--mode-strong').trim() || '#80a943';
    for (const [key, color] of [['origin', modeColor], ['destination', '#252e29']]) {
      const selected = state[key];
      if (!selected) continue;
      if (key === 'origin') state.markers.push(createStartMarker(selected).addTo(state.map));
      else state.markers.push(L.circleMarker([selected.lat, selected.lon], {radius: 7, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1}).addTo(state.map));
    }
  }
  if (which === 'origin' && (state.manualMode || state.route?.manual)) resetManualTrack();
}

function closeSuggestions(which) {
  const list = $(`#${which}-suggestions`);
  list.classList.add('hidden'); list.replaceChildren(); state.suggestions[which] = [];
}

function useBasemap(style, announce = false) {
  if (!state.map || !state.streetLayer || !state.satelliteLayer) return;
  const nextStyle = style === true || style === 'satellite' ? 'satellite' : 'osm';
  state.mapStyle = nextStyle;
  state.satelliteErrors = 0;
  state.satelliteLoaded = false;
  clearTimeout(state.satelliteLoadTimer);
  for (const layer of [state.streetLayer, state.satelliteLayer]) {
    if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
  }
  const layer = nextStyle === 'satellite' ? state.satelliteLayer : state.streetLayer;
  state.tileLayer = layer;
  layer.addTo(state.map);
  localStorage.setItem('ct_map_style', nextStyle);
  document.querySelectorAll('#map-style-toggle, #map-style-toggle-home').forEach(button => {
    button.textContent = nextStyle === 'satellite' ? 'Carte normale' : 'Satellite';
    button.setAttribute('aria-pressed', String(nextStyle === 'satellite'));
  });
  if (nextStyle === 'satellite') {
    state.satelliteLoadTimer = setTimeout(() => {
      if (state.mapStyle === 'satellite' && !state.satelliteLoaded) useBasemap('osm', true);
    }, 6000);
  }
  if (announce) toast(nextStyle === 'satellite' ? 'Imagerie satellite activée.' : 'Satellite indisponible : retour à la carte OSM.');
}
function updateMapBearing(position) {
  const reported = position.coords.heading;
  let heading = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? reported : null;
  if (heading === null && state.previousGpsSample && state.currentSpeedKmh >= 3) {
    const a = state.previousGpsSample.point, b = {lat: position.coords.latitude, lon: position.coords.longitude};
    const radians = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * radians) * Math.cos(b.lat * radians);
    const x = Math.cos(a.lat * radians) * Math.sin(b.lat * radians) - Math.sin(a.lat * radians) * Math.cos(b.lat * radians) * Math.cos((b.lon - a.lon) * radians);
    heading = (Math.atan2(y, x) / radians + 360) % 360;
  }
  if (heading !== null) state.navigationHeading = heading;
  if (heading === null || state.currentSpeedKmh < 1.5 || !state.navigationFollow || typeof state.map?.setBearing !== 'function') return;
  const difference = ((heading - state.lastMapBearing + 540) % 360) - 180;
  if (Math.abs(difference) < 4) return;
  state.lastMapBearing = (state.lastMapBearing + difference * 0.35 + 360) % 360;
  state.map.setBearing(state.lastMapBearing);
}
function initializeMap() {
  if (state.map) { state.map.invalidateSize(); return true; }
  if (!window.L) { toast('La bibliothèque de carte n’a pas pu se charger. Réessayez avec une connexion active.'); return false; }
  $('.map-panel').classList.add('map-ready');
  state.map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true, rotate: true, bearing: 0, touchRotate: false, zoomSnap: 0.25, dragging: true, touchZoom: true, doubleClickZoom: true })
    .setView([50.337, 4.52], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  state.map.on('dragstart', () => setNavigationFollow(false));
  state.map.on('zoomstart', () => {
    if (document.body.classList.contains('nav-active') && !state.programmaticNavigationZoom) setNavigationFollow(false);
  });
  state.streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  });
  state.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 22, maxNativeZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });
  state.tileLayer = state.streetLayer;
  state.streetLayer.addTo(state.map);
  state.streetLayer.on('tileerror', () => { if (state.mapStyle === 'osm') toast('Certaines tuiles OpenStreetMap ne sont pas disponibles.'); });
  state.satelliteLayer.on('load', () => { state.satelliteLoaded = true; clearTimeout(state.satelliteLoadTimer); });
  state.satelliteLayer.on('tileerror', () => {
    if (state.mapStyle !== 'satellite') return;
    state.satelliteErrors++;
    if (state.satelliteErrors >= 3) useBasemap('osm', true);
  });
  document.querySelectorAll('#map-style-toggle, #map-style-toggle-home').forEach(button => {
    button.onclick = () => useBasemap(state.mapStyle !== 'satellite');
  });
  useBasemap(state.mapStyle, false);
  state.map.on('click', event => {
    const point = {lat: event.latlng.lat, lon: event.latlng.lng};
    if (document.body.classList.contains('nav-active')) { handleNavigationMapClick(point); return; }
    if (state.mapPickTarget) {
      const target = state.mapPickTarget;
      setPoint(target, point);
      state.mapPickTarget = null; $('#map-pick-hint').classList.add('hidden');
      toast(`${target === 'origin' ? 'Départ' : 'Arrivée'} placé sur la carte.`);
      return;
    }
    if ((state.manualMode || state.route?.manual) && state.watchId === null) {
      if (removeManualWaypointAtMap(point)) return;
      if (state.manualMode) { addManualWaypoint(point); return; }
    }
    const target = !state.origin ? 'origin' : 'destination';
    setPoint(target, point);
    toast(`${target === 'origin' ? 'Départ' : 'Arrivée'} placé. Utilisez ⌖ pour choisir précisément chaque point.`);
  });
  requestAnimationFrame(() => state.map.invalidateSize());
  return true;
}

function photonLabel(feature) {
  const p = feature.properties || {};
  return [p.name, p.street && [p.housenumber, p.street].filter(Boolean).join(' '), p.postcode, p.city || p.town || p.village || p.county, p.country].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(', ');
}

async function searchAddresses(query, mapCenter = true, signal) {
  const params = new URLSearchParams({q: query, limit: '6', lang: 'fr'});
  if (mapCenter && state.map) {
    const center = state.map.getCenter();
    params.set('lat', String(center.lat)); params.set('lon', String(center.lng)); params.set('zoom', String(state.map.getZoom()));
  }
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, {signal, headers: {'Accept': 'application/json'}});
  if (!response.ok) throw new Error(`Recherche d’adresse indisponible (${response.status}).`);
  return (await response.json()).features || [];
}

function renderSuggestions(which, features) {
  const list = $(`#${which}-suggestions`); state.suggestions[which] = features;
  list.innerHTML = features.map((feature, index) => `<button type="button" class="suggestion-option" role="option" data-suggestion="${index}"><strong>${escapeHtml(photonLabel(feature) || 'Lieu sans nom')}</strong><span>${escapeHtml([feature.properties?.type, feature.properties?.country].filter(Boolean).join(' · '))}</span></button>`).join('');
  list.classList.toggle('hidden', features.length === 0);
  list.querySelectorAll('[data-suggestion]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
  list.querySelectorAll('[data-suggestion]').forEach(button => button.addEventListener('click', () => {
    const chosen = state.suggestions[which][Number(button.dataset.suggestion)];
    if (!chosen) return;
    const [lon, lat] = chosen.geometry.coordinates;
    setPoint(which, {lat, lon}, photonLabel(chosen));
    if (state.map) state.map.setView([lat, lon], 15);
  }));
}

function attachAddressSearch(which) {
  const input = $(`#${which}-input`);
  input.addEventListener('input', () => {
    state[which] = null;
    clearTimeout(state.searchTimers[which]);
    state.searchControllers[which]?.abort();
    const query = input.value.trim();
    if (query.length < 3) { closeSuggestions(which); return; }
    state.searchTimers[which] = setTimeout(async () => {
      const controller = new AbortController(); state.searchControllers[which] = controller;
      try { renderSuggestions(which, await searchAddresses(query, true, controller.signal)); }
      catch (error) { if (error.name !== 'AbortError') closeSuggestions(which); }
    }, 300);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSuggestions(which);
    if (event.key === 'Enter' && state.suggestions[which].length) {
      event.preventDefault(); $(`#${which}-suggestions [data-suggestion="0"]`)?.click();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => closeSuggestions(which), 150));
}

async function resolvePoint(input, point) {
  if (point) return point;
  const query = input.value.trim();
  if (!query) throw new Error('Renseignez le départ et l’arrivée.');
  const results = await searchAddresses(query, true);
  if (!results.length) throw new Error(`Lieu introuvable : ${query}. Choisissez une suggestion ou un point sur la carte.`);
  const feature = results[0], [lon, lat] = feature.geometry.coordinates;
  input.value = photonLabel(feature);
  return {lat, lon};
}

function decodePolyline(encoded, precision = 6) {
  let index = 0, lat = 0, lon = 0;
  const factor = Math.pow(10, precision), points = [];
  while (index < encoded.length) {
    let result = 0, shift = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

function parseShape(shape) {
  if (shape?.type === 'LineString' && Array.isArray(shape.coordinates)) return shape.coordinates.map(([lon, lat]) => [lat, lon]);
  if (typeof shape === 'string') return decodePolyline(shape, 6);
  return [];
}

function normalizeValhalla(payload) {
  const trip = payload.trip;
  const leg = trip?.legs?.[0];
  if (!leg) throw new Error(payload.error || payload.status_message || 'Aucun itinéraire disponible.');
  const path = parseShape(leg.shape);
  if (!path.length) throw new Error('Le moteur n’a pas renvoyé la géométrie du parcours.');
  const maneuvers = (leg.maneuvers || []).map(maneuver => {
    const start = Math.max(0, maneuver.begin_shape_index || 0);
    const end = Math.min(path.length - 1, maneuver.end_shape_index ?? start);
    return {
      instructions: maneuver.instruction || 'Continuez sur le parcours',
      distanceMeters: toMeters(maneuver.length),
      endLocation: {lat: path[end][0], lon: path[end][1]},
      path: path.slice(start, end + 1),
      maneuverType: maneuver.type
    };
  });
  return {
    path,
    distanceMeters: toMeters(trip.summary?.length),
    durationSeconds: Number(trip.summary?.time || 0),
    legs: [{steps: maneuvers}]
  };
}

function normalizeBRouter(payload) {
  const feature = payload.features?.find(item => item.geometry?.type === 'LineString');
  if (!feature) throw new Error(payload.error || 'BRouter n’a pas trouvé de parcours pour ces points.');
  const path = parseShape(feature.geometry);
  if (path.length < 2) throw new Error('BRouter n’a pas renvoyé de tracé exploitable.');
  let distanceMeters = 0;
  for (let i = 1; i < path.length; i++) distanceMeters += L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
  const props = feature.properties || {};
  if (Number(props['track-length']) > 0) distanceMeters = Number(props['track-length']);
  const durationSeconds = Number(props['total-time']) > 0 ? Number(props['total-time']) : distanceMeters / 1000 / 10 * 3600;
  const steps = [];
  let previousIndex = 0, lastTurnAt = 0;
  const distanceAt = [0];
  for (let i = 1; i < path.length; i++) distanceAt[i] = distanceAt[i - 1] + L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
  const nearestBefore = (index, meters) => {
    let cursor = index;
    while (cursor > 0 && distanceAt[index] - distanceAt[cursor] < meters) cursor--;
    return cursor;
  };
  const nearestAfter = (index, meters) => {
    let cursor = index;
    while (cursor < path.length - 1 && distanceAt[cursor] - distanceAt[index] < meters) cursor++;
    return cursor;
  };
  const bearing = (a, b) => {
    const rad = value => value * Math.PI / 180;
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  for (let i = 1; i < path.length - 1; i++) {
    if (distanceAt[i] - lastTurnAt < 120 || distanceAt[i] - distanceAt[previousIndex] < 80) continue;
    const before = nearestBefore(i, 25), after = nearestAfter(i, 25);
    if (before === i || after === i) continue;
    const delta = ((bearing(path[before], path[after]) - bearing(path[before], path[i]) + 540) % 360) - 180;
    if (Math.abs(delta) < 55) continue;
    const end = path[i];
    steps.push({
      instructions: Math.abs(delta) > 135 ? 'Prenez le virage serré' : delta > 0 ? 'Tournez à droite' : 'Tournez à gauche',
      distanceMeters: distanceAt[i] - distanceAt[previousIndex],
      endLocation: {lat: end[0], lon: end[1]}, path: path.slice(previousIndex, i + 1)
    });
    previousIndex = i; lastTurnAt = distanceAt[i];
  }
  const finalPoint = path.at(-1);
  steps.push({instructions: 'Continuez jusqu’à l’arrivée', distanceMeters: distanceAt.at(-1) - distanceAt[previousIndex], endLocation: {lat: finalPoint[0], lon: finalPoint[1]}, path: path.slice(previousIndex)});
  return {
    path, distanceMeters, durationSeconds,
    legs: [{steps}]
  };
}

async function requestBRouter(origin, destination) {
  const familyFast = state.mode === 'family' && state.familyFast;
  const params = new URLSearchParams({
    lonlats: `${origin.lon},${origin.lat}|${destination.lon},${destination.lat}`,
    profile: familyFast ? 'fastbike-verylowtraffic' : 'mtb',
    alternativeidx: '0', format: 'geojson'
  });
  if (!familyFast) {
    params.set('profile:path_preference', state.mode === 'family' ? '100' : state.seekIntense ? '160' : $('#favor-trails').checked ? '80' : '20');
    params.set('profile:cycleroutes_pref', state.mode === 'family' ? '1.0' : state.mode === 'vtt' && state.seekIntense ? '0.2' : $('#favor-trails').checked ? '3.0' : '0.2');
    params.set('profile:MTB_factor', state.mode === 'vtt' && state.seekIntense ? '2.0' : '0.0');
    params.set('profile:isbike_for_mainroads', state.mode === 'family' ? '0' : '1');
    params.set('profile:hills', state.mode === 'family' ? '2' : '0');
    params.set('profile:avoid_unsafe', '1');
  }
  const response = await fetch(`${BROUTER_URL}?${params}`);
  const responseText = await response.text();
  let payload;
  try { payload = JSON.parse(responseText); } catch { payload = {}; }
  if (!response.ok) {
    const detail = payload.error || responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(detail || `Erreur du moteur BRouter (${response.status}).`);
  }
  return normalizeBRouter(payload);
}





function manualStepName(index) {
  let value = index + 1, label = '';
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function clearManualLayers() {
  if (state.map && state.manualLine && state.map.hasLayer(state.manualLine)) state.map.removeLayer(state.manualLine);
  state.manualMarkers.forEach(marker => { if (state.map?.hasLayer(marker)) state.map.removeLayer(marker); });
  state.manualMarkers = [];
  state.manualLine = null;
}

function clearDisplayedRoute() {
  if (state.manualController) state.manualController.abort();
  state.manualController = null;
  state.manualRoutingVersion++;
  if (state.map && state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  state.stepLayers.forEach(layer => { if (state.map?.hasLayer(layer)) state.map.removeLayer(layer); });
  state.stepLayers = [];
  state.markers.forEach(marker => { if (state.map?.hasLayer(marker)) state.map.removeLayer(marker); });
  state.markers = [];
  clearManualLayers();
  state.route = null;
  $('#route-result').classList.add('hidden');
  $('#route-result').classList.remove('manual-result');
}

function updateManualModeUI() {
  const toggle = $('#manual-mode-toggle');
  toggle.textContent = state.manualMode ? 'Terminer le tracé manuel' : (state.manualPoints.length > 1 ? 'Reprendre le tracé manuel' : 'Tracer manuellement sur la carte');
  toggle.setAttribute('aria-pressed', String(state.manualMode));
  toggle.classList.toggle('is-active', state.manualMode);
  $('#origin-input').readOnly = state.manualMode;
  $('#destination-input').readOnly = state.manualMode;
  $('#use-location').disabled = state.manualMode;
  document.querySelectorAll('[data-pick]').forEach(button => { button.disabled = state.manualMode; });
  document.querySelectorAll('.mode-button').forEach(button => { button.disabled = state.manualMode || state.manualPoints.length > 1; });
  $('#route-button').classList.toggle('hidden', state.manualMode);
  $('#api-note').classList.toggle('hidden', state.manualMode || state.manualPoints.length > 1);
  $('#manual-map-hint').classList.toggle('hidden', !state.manualMode);
  $('#manual-route-panel').classList.toggle('hidden', !(state.manualMode || state.manualPoints.length > 1));
  if (state.manualMode) {
    $('#manual-route-note').textContent = state.manualLegs.some(leg => leg.status === 'pending')
      ? 'Calcul des chemins entre les étapes en cours…'
      : 'Touchez la carte pour ajouter des étapes. Chaque tronçon suit le réseau de chemins disponible.';
    $('#manual-map-hint-text').textContent = `Touchez la carte pour ajouter l’étape ${manualStepName(Math.max(0, state.manualPoints.length - 1))}.`;
  } else if (state.manualPoints.length > 1) {
    $('#manual-route-note').textContent = state.manualLegs.some(leg => leg.status === 'error')
      ? 'Un tronçon n’a pas pu être calculé. Reprenez le tracé pour réessayer ou déplacez le point concerné.'
      : 'Tracé en pause. Reprenez-le pour ajouter des étapes ou supprimez un point dans la liste.';
  }
}

async function requestManualSegment(origin, destination, signal, shortest = false) {
  const params = new URLSearchParams({
    lonlats: `${origin.lon},${origin.lat}|${destination.lon},${destination.lat}`,
    profile: shortest ? 'shortest' : 'trekking', alternativeidx: '0', format: 'geojson'
  });
  const response = await fetch(`${BROUTER_URL}?${params}`, {signal, headers: {'Accept': 'application/geo+json'}});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `BRouter indisponible (${response.status}).`);
  return normalizeBRouter(payload);
}

function manualExpectedLegCount() {
  return Math.max(0, state.manualPoints.length - 1) + (state.manualReturnToStart && state.manualPoints.length > 1 ? 1 : 0);
}

function renderManualTrack() {
  if (!state.map || !state.manualPoints.length) return;
  clearManualLayers();
  const points = state.manualPoints;
  const themeRoute = getComputedStyle(document.body).getPropertyValue('--mode-strong').trim() || '#24382b';
  const readyLegs = state.manualLegs.filter(leg => leg.status === 'ready' && leg.path?.length > 1);
  if (readyLegs.length) {
    const lines = readyLegs.map(leg => L.polyline(leg.path, {color: themeRoute, weight: 5, opacity: .96, lineCap: 'round', lineJoin: 'round'}));
    state.manualLine = L.featureGroup(lines).addTo(state.map);
  }
  points.forEach((point, index) => {
    const isFinish = index === points.length - 1 && index > 0;
    const label = index === 0 ? 'D' : isFinish ? '🏁' : manualStepName(index - 1);
    if (index === 0) {
      state.manualMarkers.push(createStartMarker(point).addTo(state.map));
      return;
    }
    const markerClass = isFinish ? ' manual-marker-finish' : '';
    const icon = L.divIcon({className: 'manual-marker-shell', html: `<span class="manual-marker${markerClass}">${label}</span>`, iconSize: [34, 34], iconAnchor: [17, 17]});
    state.manualMarkers.push(L.marker([point.lat, point.lon], {icon, interactive: false, keyboard: false, zIndexOffset: 900}).addTo(state.map));
  });

  const expectedLegCount = manualExpectedLegCount();
  let total = 0, cumulativeKnown = 0, complete = state.manualLegs.length === expectedLegCount;
  const cumulative = [0];
  state.manualLegs.forEach(leg => {
    if (leg.status === 'ready') { total += leg.distanceMeters; cumulativeKnown += leg.distanceMeters; }
    else complete = false;
    cumulative.push(leg.status === 'ready' && cumulative.at(-1) !== null ? cumulativeKnown : null);
  });
  $('#manual-total-distance').textContent = points.length === 1 ? formatDistance(0) : complete ? formatDistance(total) : state.manualLegs.some(leg => leg.status === 'error') ? 'Incomplet' : 'Calcul…';

  const startLabel = $('#origin-input').value.trim() || `${points[0].lat.toFixed(5)}, ${points[0].lon.toFixed(5)}`;
  const rows = [`<li class="manual-stage-row"><span class="manual-stage-badge manual-stage-start">D</span><div class="manual-stage-copy"><strong>Départ</strong><span>${escapeHtml(startLabel)}</span><small>Cumul : 0,00 km</small></div></li>`];
  for (let i = 1; i < points.length; i++) {
    const label = manualStepName(i - 1), leg = state.manualLegs[i - 1];
    let details = 'En attente du calcul du chemin…', cumulativeLabel = 'Cumul : —';
    if (leg?.status === 'ready') {
      details = `Tronçon : ${formatDistance(leg.distanceMeters)}`;
      cumulativeLabel = cumulative[i] === null ? 'Cumul incomplet' : `Cumul : ${formatDistance(cumulative[i])}`;
    } else if (leg?.status === 'error') details = 'Chemin introuvable. Déplacez ce point.';
    const isFinish = i === points.length - 1;
    const badge = isFinish ? '🏁' : label;
    const stageName = isFinish ? 'Arrivée' : `Étape ${label}`;
    rows.push(`<li class="manual-stage-row"><span class="manual-stage-badge${isFinish ? ' manual-stage-finish' : ''}">${badge}</span><div class="manual-stage-copy"><strong>${stageName}</strong><span>${points[i].lat.toFixed(5)}, ${points[i].lon.toFixed(5)} · ${details}</span><small>${cumulativeLabel}</small></div><div class="manual-stage-controls"><button class="manual-stage-order" type="button" data-move-manual="${i}" data-direction="-1" aria-label="Monter ${stageName}" ${i === 1 ? 'disabled' : ''}>↑</button><button class="manual-stage-order" type="button" data-move-manual="${i}" data-direction="1" aria-label="Descendre ${stageName}" ${i === points.length - 1 ? 'disabled' : ''}>↓</button><button class="manual-remove-step" type="button" data-manual-remove="${i}" aria-label="Supprimer ${stageName}">×</button></div></li>`);
  }
  if (points.length > 1) {
    const returnLeg = state.manualReturnToStart ? state.manualLegs.at(-1) : null;
    const returnDetail = !state.manualReturnToStart ? 'Rallier le départ par le chemin le plus court' : returnLeg?.status === 'ready' ? `Retour : ${formatDistance(returnLeg.distanceMeters)}` : returnLeg?.status === 'error' ? 'Retour introuvable, réessayez' : 'Calcul du retour vers le départ…';
    rows.push(`<li class="manual-stage-row manual-return-row"><span class="manual-stage-badge manual-return-badge">${state.manualReturnToStart ? '↻' : '＋'}</span><div class="manual-stage-copy"><strong>Terminer automatiquement le parcours</strong><span>${returnDetail}</span></div><button class="manual-return-toggle${state.manualReturnToStart ? ' is-active' : ''}" type="button" data-manual-return aria-pressed="${state.manualReturnToStart}" aria-label="${state.manualReturnToStart ? 'Désactiver' : 'Activer'} le retour automatique au départ">${state.manualReturnToStart ? 'Activé' : 'Ajouter'}</button></li>`);
  }
  $('#manual-stage-list').innerHTML = rows.join('');
  $('#manual-stage-list').querySelector('[data-manual-return]')?.addEventListener('click', () => {
    state.manualReturnToStart = !state.manualReturnToStart;
    updateManualTrack();
  });
  $('#manual-stage-list').querySelectorAll('[data-manual-remove]').forEach(button => button.addEventListener('click', () => {
    removeManualWaypoint(Number(button.dataset.manualRemove));
  }));
  $('#manual-stage-list').querySelectorAll('[data-move-manual]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.moveManual), next = index + Number(button.dataset.direction);
    if (index < 1 || next < 1 || next >= state.manualPoints.length) return;
    [state.manualPoints[index], state.manualPoints[next]] = [state.manualPoints[next], state.manualPoints[index]];
    updateManualTrack();
  }));

  if (points.length > 1) {
    state.destination = state.manualReturnToStart ? points[0] : points.at(-1);
    $('#destination-input').value = state.manualReturnToStart ? 'Retour au départ' : `Étape ${manualStepName(points.length - 2)}`;
  } else {
    state.destination = null;
    $('#destination-input').value = '';
  }

  if (complete && points.length > 1 && state.manualLegs.length === expectedLegCount && state.manualLegs.every(leg => leg.status === 'ready')) {
    const path = [];
    state.manualLegs.forEach((leg, index) => path.push(...(index ? leg.path.slice(1) : leg.path)));
    const speedKmh = state.mode === 'road' ? 22 : state.mode === 'moto' ? 20 : state.mode === 'family' ? state.familyFast ? 16 : 12 : 10;
    const steps = state.manualLegs.map((leg, index) => ({
      instructions: state.manualReturnToStart && index === points.length - 1
        ? 'Retournez au point de départ'
        : index === points.length - 2 ? 'Suivez le chemin jusqu’à l’arrivée' : `Suivez le chemin jusqu’à l’étape ${manualStepName(index)}`,
      distanceMeters: leg.distanceMeters,
      endLocation: {lat: leg.path.at(-1)[0], lon: leg.path.at(-1)[1]},
      path: leg.path
    }));
    state.route = {manual: true, path, distanceMeters: total, durationSeconds: total / (speedKmh / 3.6), legs: [{steps}]};
    state.currentStep = Math.min(state.currentStep, steps.length - 1);
    state.routeStartDistanceTravelled = state.distanceTravelledMeters;
    $('#route-title').textContent = 'Tracé manuel';
    $('#route-alert-text').textContent = 'Tronçons calculés sur les chemins cartographiés. Vérifiez les accès et la signalisation sur place.';
    $('#route-result').classList.remove('hidden'); $('#route-result').classList.add('manual-result');
    $('#route-distance').textContent = formatDistance(total);
    $('#route-duration').textContent = formatDuration(state.route.durationSeconds);
    $('#route-steps-count').textContent = String(steps.length);
    $('#api-note').classList.add('hidden');
    $('#export-manual-gpx').disabled = false;
    $('#map-mode-label').textContent = 'TRACÉ MANUEL · ' + (state.mode === 'family' ? 'VÉLO FAMILIAL' : state.mode === 'road' ? 'VÉLO DE ROUTE' : state.mode === 'moto' ? 'MOTOCROSS' : 'VTT');
  } else {
    state.route = null;
    state.currentStep = 0;
    $('#route-result').classList.add('hidden'); $('#route-result').classList.remove('manual-result');
    $('#export-manual-gpx').disabled = true;
  }
  updateManualModeUI();
}

async function recalculateManualLegs(generation, controller) {
  const points = state.manualPoints;
  const expectedLegCount = manualExpectedLegCount();
  for (let i = 0; i < expectedLegCount; i++) {
    const isReturnLeg = state.manualReturnToStart && i === points.length - 1;
    const origin = points[i], destination = isReturnLeg ? points[0] : points[i + 1];
    try {
      const route = await requestManualSegment(origin, destination, controller.signal, isReturnLeg);
      if (controller.signal.aborted || generation !== state.manualRoutingVersion) return;
      state.manualLegs[i] = {status: 'ready', path: route.path, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds};
    } catch (error) {
      if (controller.signal.aborted || generation !== state.manualRoutingVersion) return;
      state.manualLegs[i] = {status: 'error', error: error.message};
    }
    renderManualTrack();
  }
}

function updateManualTrack() {
  if (!state.map || !state.manualPoints.length) return;
  if (state.manualController) state.manualController.abort();
  const generation = ++state.manualRoutingVersion;
  state.manualController = new AbortController();
  state.manualLegs = Array.from({length: manualExpectedLegCount()}, () => ({status: 'pending', path: [], distanceMeters: 0, durationSeconds: 0}));
  renderManualTrack();
  if (state.manualLegs.length) recalculateManualLegs(generation, state.manualController);
}

async function toggleManualMode() {
  if (state.manualMode) { finishManualMode(); return; }
  if (state.watchId !== null) { toast('Terminez la navigation avant de modifier le tracé.'); return; }
  if (!initializeMap()) return;
  try {
    const origin = await resolvePoint($('#origin-input'), state.origin);
    state.origin = origin;
    const resumeTrack = Boolean(state.manualPoints.length > 1 && state.manualLegs.length === manualExpectedLegCount());
    if (!resumeTrack) {
      state.manualUndo = null;
      clearDisplayedRoute(); state.destination = null; state.manualReturnToStart = false;
      $('#destination-input').value = ''; state.manualPoints = [origin]; state.manualLegs = []; state.currentStep = 0;
    } else if (state.manualPoints[0].lat !== origin.lat || state.manualPoints[0].lon !== origin.lon) {
      state.manualPoints = [origin]; state.manualLegs = []; clearDisplayedRoute();
    }
    state.mapPickTarget = null; $('#map-pick-hint').classList.add('hidden');
    state.manualMode = true;
    state.map.setView([origin.lat, origin.lon], Math.max(16, state.map.getZoom()));
    $('#api-note').classList.add('hidden');
    if (resumeTrack && state.manualLegs.every(leg => leg.status === 'ready')) renderManualTrack();
    else updateManualTrack();
    updateManualModeUI();
    if (window.matchMedia('(max-width: 680px)').matches) $('#map').scrollIntoView({behavior: 'smooth', block: 'center'});
  } catch (error) {
    toast(error.message || 'Choisissez un départ avant de tracer manuellement.');
  }
}

function finishManualMode() {
  state.manualMode = false;
  updateManualModeUI();
}

function resetManualTrack() {
  if (state.manualController) state.manualController.abort();
  clearDisplayedRoute();
  state.destination = null; $('#destination-input').value = ''; state.currentStep = 0;
  state.manualUndo = null;
  state.manualReturnToStart = false;
  state.manualPoints = state.origin ? [state.origin] : [];
  state.manualLegs = [];
  if (state.manualPoints.length) updateManualTrack();
  else {
    $('#manual-stage-list').replaceChildren();
    $('#manual-total-distance').textContent = formatDistance(0);
    $('#export-manual-gpx').disabled = true;
    updateManualModeUI();
  }
}

function removeManualWaypointAtMap(point) {
  let nearestIndex = -1, nearestDistance = Infinity;
  for (let i = 1; i < state.manualPoints.length; i++) {
    const candidate = state.manualPoints[i];
    const distance = state.map.distance([candidate.lat, candidate.lon], [point.lat, point.lon]);
    if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = i; }
  }
  if (nearestIndex < 0 || nearestDistance > 15) return false;
  removeManualWaypoint(nearestIndex);
  return true;
}

function removeManualWaypoint(index) {
  if (index < 1 || index >= state.manualPoints.length) return;
  const point = state.manualPoints.splice(index, 1)[0];
  const undo = {point, index, time: Date.now()};
  state.manualUndo = undo;
  updateManualTrack();
  toastWithAction('Point de passage supprimé.', 'Annuler', () => {
    if (state.manualUndo !== undo) return;
    state.manualPoints.splice(Math.min(index, state.manualPoints.length), 0, point);
    state.manualUndo = null;
    updateManualTrack();
    toast('Suppression annulée.');
  });
}

function addManualWaypoint(point) {
  if (!state.manualMode || !state.manualPoints.length) return;
  const previous = state.manualPoints.at(-1);
  if (state.map.distance([previous.lat, previous.lon], [point.lat, point.lon]) < 3) {
    toast('Ce point est trop proche de l’étape précédente.'); return;
  }
  state.manualPoints.push({lat: point.lat, lon: point.lon});
  updateManualTrack();
  toast(`Étape ${manualStepName(state.manualPoints.length - 2)} ajoutée. Calcul du chemin en cours.`);
}

async function calculateRoute(fromOverride = null, toOverride = null) {
  if (state.manualMode) { toast('Terminez le tracé manuel avant de lancer le calcul automatique.'); return; }
  if (state.manualController) state.manualController.abort();
  state.manualController = null; state.manualRoutingVersion++;
  const button = $('#route-button'); button.disabled = true;
  button.querySelector('span').textContent = 'Calcul en cours…';
  try {
    if (!initializeMap()) throw new Error('La carte est indisponible.');
    const origin = fromOverride || await resolvePoint($('#origin-input'), state.origin);
    const destination = toOverride || await resolvePoint($('#destination-input'), state.destination);
    state.origin = origin; state.destination = destination;
    if (state.mode === 'family' || state.mode === 'vtt') {
      state.route = await requestBRouter(origin, destination);
    } else {
      const routeRequest = {
        locations: [{lat: origin.lat, lon: origin.lon, type: 'break'}, {lat: destination.lat, lon: destination.lon, type: 'break'}],
        alternates: state.mode === 'moto' ? 5 : 0,
        costing: state.mode === 'moto' ? 'motorcycle' : 'bicycle',
        costing_options: state.mode === 'moto'
          ? {motorcycle: {use_highways: 0, use_trails: 1, use_tracks: 1, use_distance: 0.9, top_speed: 30, speed_penalty_factor: 0.5, use_tolls: 0, use_living_streets: 0}}
          : {bicycle: {bicycle_type: 'road', cycling_speed: 25, use_roads: 1, use_hills: 1, use_ferry: 0.3, use_living_streets: 0, avoid_bad_surfaces: 0.85}},
        directions_options: {units: 'kilometers', language: 'fr-FR'},
        shape_format: 'geojson'
      };
      const routeHeaders = {'Content-Type': 'application/json', 'X-Client-Id': 'cross-travel (github.com/kgjames26/cross-travel)'};
      const response = await fetch(state.routeServer, {method: 'POST', headers: routeHeaders, body: JSON.stringify(routeRequest)});
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.status_message || `Erreur du moteur Valhalla (${response.status}).`);
      if (state.mode === 'moto') {
        const variants = [payload.trip, ...(payload.alternates || []).map(alternative => alternative.trip || alternative)]
          .filter(trip => trip?.legs?.length);
        const scored = variants.map(trip => {
          let length = Number(trip.summary?.length) || 0;
          let totalLength = 0, roughLength = 0, highwayLength = 0;
          for (const leg of trip.legs || []) {
            for (const maneuver of leg.maneuvers || []) {
              const segmentLength = Math.max(0, Number(maneuver.length) || 0);
              totalLength += segmentLength;
              if (maneuver.rough) roughLength += segmentLength;
              if (maneuver.highway) highwayLength += segmentLength;
            }
          }
          if (!length) length = totalLength;
          return {
            trip, length,
            roughShare: totalLength ? roughLength / totalLength : 0,
            highwayShare: totalLength ? highwayLength / totalLength : (trip.summary?.has_highway ? 1 : 0)
          };
        });
        const longest = Math.max(1, ...scored.map(item => item.length));
        scored.sort((a, b) => {
          const score = item => item.roughShare * 20
            - item.highwayShare * 50
            + item.length / longest * 0.5;
          return score(b) - score(a);
        });
        if (scored.length) payload.trip = scored[0].trip;
      }
      state.route = normalizeValhalla(payload);
    }
    state.currentStep = 0;
    state.lastSpokenStep = -1;
    state.routeStartDistanceTravelled = state.distanceTravelledMeters;
    state.manualPoints = []; state.manualLegs = []; state.manualReturnToStart = false;
    updateManualModeUI();
    drawRoute(); showRoute();
    $('#route-result').classList.remove('manual-result');
    $('#map-mode-label').textContent = state.mode === 'family' ? state.familyFast ? 'OSM · VÉLO FAMILIAL · RAPIDE' : 'OSM · RAVeL & CHEMINS' : state.mode === 'road' ? 'OSM · VÉLO DE ROUTE · RAPIDE' : state.mode === 'vtt' ? 'OSM · BROUTER · PROFIL VTT' : 'OSM · MOTO · PETITES ROUTES';
    $('#route-alert-text').textContent = state.mode === 'family'
      ? state.familyFast ? 'Vélo familial rapide : profil vélo à faible trafic, autoroutes exclues et axes très fréquentés pénalisés. Vérifiez le parcours et les accès avant de partir.' : 'Vélo familial : RAVeL balisés prioritaires; voies cyclables en bord de route fortement pénalisées. Les routes ne servent qu’aux raccordements nécessaires.'
      : state.mode === 'road'
        ? 'Vélo de route : trajet rapide sur routes adaptées et pistes cyclables; surfaces peu roulantes pénalisées.'
        : state.mode === 'moto'
          ? 'Motocross homologuée : variantes moto compatibles comparées; chemins, pistes et surfaces rugueuses favorisés, centres-villes et grands axes pénalisés. Les accès suivent OpenStreetMap.'
          : state.seekIntense ? 'VTT sensations : le calcul cherche des sentiers plus engagés et accepte les détours. Vérifiez le niveau technique et l’accès.' : 'VTT : priorité aux sentiers, RAVeL et voies cyclables; les routes fréquentées sont pénalisées.';
    const wikilocQuery = encodeURIComponent(`${$('#origin-input').value} ${$('#destination-input').value} ${state.mode === 'family' ? 'vélo familial RAVeL' : state.mode === 'road' ? 'vélo de route' : state.mode === 'moto' ? 'moto' : 'VTT'}`);
    $('#wikiloc-link').href = `https://www.wikiloc.com/search?query=${wikilocQuery}`;
    if (state.watchId !== null) {
      if (state.mode === 'moto') announceStep(0);
      else speakText(state.mode === 'family' ? 'Parcours vélo familial recalculé.' : state.mode === 'road' ? 'Itinéraire vélo de route recalculé.' : 'Parcours VTT recalculé. Suivez le nouveau tracé.');
    }
    if (fromOverride) toast('Itinéraire recalculé depuis votre position.');
  } catch (error) {
    toast(error.message || 'Le calcul a échoué. Vérifiez le serveur et la connexion.');
  } finally {
    button.disabled = false; button.querySelector('span').textContent = state.mode === 'family' ? 'Calculer mon itinéraire familial' : state.mode === 'road' ? 'Calculer l’itinéraire rapide' : state.mode === 'moto' ? 'Calculer mon itinéraire moto' : 'Calculer mon itinéraire VTT';
  }
}

function drawRoute() {
  if (!state.map || !state.route) return;
  clearManualLayers();
  if (state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  state.stepLayers.forEach(layer => state.map.removeLayer(layer));
  state.markers.forEach(marker => state.map.removeLayer(marker));
  state.stepLayers = []; state.markers = [];
  const path = state.route.path;
  const themeRoute = getComputedStyle(document.body).getPropertyValue('--mode-strong').trim() || '#24382b';
  const themeStep = getComputedStyle(document.body).getPropertyValue('--mode-accent-strong').trim() || '#d08b42';
  state.routeLayer = L.polyline(path, {color: themeRoute, weight: 5, opacity: .94}).addTo(state.map);
  state.map.fitBounds(state.routeLayer.getBounds(), {padding: [55, 55]});
  if (state.origin) state.markers.push(createStartMarker(state.origin).addTo(state.map));
  if (state.destination && (!state.origin || state.map.distance([state.origin.lat, state.origin.lon], [state.destination.lat, state.destination.lon]) > 3)) {
    state.markers.push(L.circleMarker([state.destination.lat, state.destination.lon], {radius: 7, color: '#fff', weight: 3, fillColor: '#252e29', fillOpacity: 1}).addTo(state.map));
  }
  (state.route.legs[0]?.steps || []).forEach(step => {
    if (step.path?.length > 1) state.stepLayers.push(L.polyline(step.path, {color: themeStep, weight: 3, opacity: .5, dashArray: '5 7'}).addTo(state.map));
  });
}

function showRoute() {
  const route = state.route;
  $('#route-distance').textContent = formatDistance(route.distanceMeters);
  $('#route-duration').textContent = formatDuration(route.durationSeconds);
  $('#route-steps-count').textContent = route.legs[0]?.steps.length || '—';
  $('#route-result').classList.remove('hidden');
  $('#api-note').classList.add('hidden');
}

function currentStep() {
  const steps = state.route?.legs?.[0]?.steps || [];
  return steps[Math.min(state.currentStep, Math.max(steps.length - 1, 0))];
}

function speakText(message) {
  if (!state.voiceEnabled || !message) return;
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'fr-FR'; utterance.rate = 0.96; utterance.pitch = 1; utterance.volume = 1;
  const voice = window.speechSynthesis.getVoices().find(item => item.lang?.toLowerCase().startsWith('fr'));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function announceStep(index) {
  if (index < 0 || index === state.lastSpokenStep) return;
  const step = state.route?.legs?.[0]?.steps?.[index];
  if (!step?.instructions) return;
  state.lastSpokenStep = index;
  speakText(step.instructions);
}

function updateVoiceButton() {
  const button = $('#voice-toggle');
  button.textContent = state.voiceEnabled ? 'Voix activée' : 'Voix coupée';
  button.setAttribute('aria-pressed', String(state.voiceEnabled));
  button.setAttribute('aria-label', state.voiceEnabled ? 'Couper le guidage vocal' : 'Activer le guidage vocal');
}

function toggleVoice() {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    toast('La synthèse vocale n’est pas disponible dans ce navigateur.'); return;
  }
  state.voiceEnabled = !state.voiceEnabled;
  localStorage.setItem('ct_voice_enabled', String(state.voiceEnabled));
  if (!state.voiceEnabled) window.speechSynthesis.cancel();
  updateVoiceButton();
  if (state.voiceEnabled && state.watchId !== null) {
    state.lastSpokenStep = -1;
    speakText('Guidage vocal activé.');
  }
}

function offsetPointMeters(origin, distanceMeters, bearingDegrees) {
  const radius = 6371000, bearing = bearingDegrees * Math.PI / 180;
  const lat1 = origin.lat * Math.PI / 180, lon1 = origin.lon * Math.PI / 180;
  const angularDistance = distanceMeters / radius;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

function nearestPathProgress(point) {
  const path = state.route?.path || [];
  if (!path.length) return 0;
  let bestDistance = Infinity, bestIndex = 0, total = 0, bestProgress = 0;
  const distances = [0];
  for (let i = 1; i < path.length; i++) distances[i] = distances[i - 1] + L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
  for (let i = 0; i < path.length; i++) {
    const distance = L.latLng(path[i]).distanceTo([point.lat, point.lon]);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
  }
  total = distances.at(-1) || 1;
  bestProgress = distances[bestIndex] / total;
  return bestProgress;
}

function clearNavigationPointLayers() {
  state.navigationPointLayers.forEach(layer => { if (state.map?.hasLayer(layer)) state.map.removeLayer(layer); });
  state.navigationPointLayers = [];
}

function renderNavigationPoints() {
  if (!state.map || !document.body.classList.contains('nav-active')) return;
  clearNavigationPointLayers();
  state.navigationAvoids.forEach(point => {
    const ring = L.circle([point.lat, point.lon], {radius: 60, color: '#bd2630', weight: 2, fillColor: '#f4444c', fillOpacity: .16, interactive: false});
    const icon = L.divIcon({className: 'nav-point-shell', html: '<span class="nav-point-marker nav-point-forbidden">×</span>', iconSize: [30, 30], iconAnchor: [15, 15]});
    state.navigationPointLayers.push(ring, L.marker([point.lat, point.lon], {icon, interactive: false, keyboard: false, zIndexOffset: 1200}));
  });
  state.navigationViaPoints.forEach((item, index) => {
    const icon = L.divIcon({className: 'nav-point-shell', html: '<span class="nav-point-marker nav-point-via">V</span>', iconSize: [30, 30], iconAnchor: [15, 15]});
    state.navigationPointLayers.push(L.marker([item.lat, item.lon], {icon, interactive: false, keyboard: false, zIndexOffset: 1100}));
  });
  state.navigationPointLayers.forEach(layer => layer.addTo(state.map));
}

function syncNavigationRouteEdits() {
  if (state.route) {
    state.route.navigationAvoids = [...state.navigationAvoids];
    state.route.navigationViaPoints = [...state.navigationViaPoints];
  }
  renderNavigationPoints();
}

function combineNavigationSegments(segments) {
  const path = [], steps = [];
  let distanceMeters = 0, durationSeconds = 0;
  segments.forEach((segment, index) => {
    if (segment.path?.length) path.push(...(index ? segment.path.slice(1) : segment.path));
    distanceMeters += Number(segment.distanceMeters) || 0;
    durationSeconds += Number(segment.durationSeconds) || 0;
    steps.push(...(segment.legs?.[0]?.steps || []));
  });
  return {manual: state.navigationManualRoute, path, distanceMeters, durationSeconds, legs: [{steps}],
    navigationAvoids: [...state.navigationAvoids], navigationViaPoints: [...state.navigationViaPoints], navigationSegments: segments};
}

function refreshViaProgressFromSegments() {
  const lengths = state.navigationSegments.map(segment => Number(segment.distanceMeters) || 0);
  const total = lengths.reduce((sum, value) => sum + value, 0) || 1;
  let passed = 0;
  state.navigationViaPoints = state.navigationViaPoints
    .map((point, index) => {
      passed += lengths[index] || 0;
      return {...point, progress: passed / total};
    })
    .sort((a, b) => a.progress - b.progress);
}

function nearestNavigationSegmentIndex(point) {
  let bestDistance = Infinity, bestIndex = 0;
  state.navigationSegments.forEach((segment, index) => {
    (segment.path || []).forEach(coordinate => {
      const distance = state.map.distance(coordinate, [point.lat, point.lon]);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
  });
  return bestIndex;
}

async function insertNavigationVia(point) {
  const previousVias = state.navigationViaPoints.map(item => ({...item}));
  state.navigationViaPoints = [...state.navigationViaPoints].sort((a, b) => a.progress - b.progress);
  const progress = nearestPathProgress(point);
  const index = nearestNavigationSegmentIndex(point);
  const via = {lat: point.lat, lon: point.lon, progress};
  const segmentIndex = index;
  const currentSegment = state.navigationSegments[segmentIndex];
  if (!currentSegment || state.navigationSegments.length !== state.navigationViaPoints.length + 1) {
    state.navigationViaPoints.push(via);
    state.navigationViaPoints.sort((a, b) => a.progress - b.progress);
    syncNavigationRouteEdits();
    await recalculateNavigationRoute('Étape ajoutée au parcours.');
    return;
  }
  const start = index > 0
    ? state.navigationViaPoints[index - 1]
    : {lat: currentSegment.path[0][0], lon: currentSegment.path[0][1]};
  const end = index < state.navigationViaPoints.length
    ? state.navigationViaPoints[index]
    : state.destination;
  state.navigationViaPoints.splice(index, 0, via);
  syncNavigationRouteEdits();
  state.navigationRerouteController?.abort();
  const controller = new AbortController();
  state.navigationRerouteController = controller;
  const version = ++state.navigationRerouteVersion;
  const center = state.map.getCenter(), zoom = state.map.getZoom();
  try {
    const [toVia, fromVia] = await Promise.all([
      requestNavigationSegment(start, point, controller.signal),
      requestNavigationSegment(point, end, controller.signal)
    ]);
    if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
    state.navigationSegments.splice(segmentIndex, 1, toVia, fromVia);
    refreshViaProgressFromSegments();
    state.route = combineNavigationSegments(state.navigationSegments);
    state.currentStep = 0;
    state.routeStartDistanceTravelled = state.distanceTravelledMeters;
    drawRoute();
    state.map.setView(center, zoom, {animate: false});
    renderNavigationPoints();
    persistNavigationResume(true);
    toast('Étape ajoutée entre les deux passages voisins.');
  } catch (error) {
    if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
    state.navigationViaPoints = previousVias;
    syncNavigationRouteEdits();
    toast('Impossible de relier les étapes : ' + error.message);
  }
}

function handleNavigationMapClick(point) {
  if (!state.route || !state.map) return;
  state.map.closePopup();
  const nearbyAvoid = state.navigationAvoids.findIndex(item => state.map.distance([item.lat, item.lon], [point.lat, point.lon]) < 55);
  if (nearbyAvoid >= 0) {
    state.navigationAvoids.splice(nearbyAvoid, 1);
    syncNavigationRouteEdits();
    recalculateNavigationRoute('Passage interdit supprimé.');
    return;
  }
  const nearbyVia = state.navigationViaPoints.findIndex(item => state.map.distance([item.lat, item.lon], [point.lat, point.lon]) < 45);
  if (nearbyVia >= 0) {
    state.navigationViaPoints.splice(nearbyVia, 1);
    syncNavigationRouteEdits();
    recalculateNavigationRoute('Étape supprimée.');
    return;
  }
  const routePoints = state.routeLayer?.getLatLngs() || [];
  const onRoute = routePoints.some(item => state.map.distance(item, [point.lat, point.lon]) < 65);
  const popup = L.popup({closeButton: true, className: 'nav-map-actions', offset: [0, -8]})
    .setLatLng([point.lat, point.lon])
    .setContent(`<div class="nav-map-action-card"><strong>${onRoute ? 'Modifier le parcours' : 'Ajouter une étape'}</strong>${onRoute ? '<button type="button" data-nav-action="avoid">Interdire ce passage</button>' : ''}<button type="button" data-nav-action="via">Ajouter comme étape</button></div>`)
    .openOn(state.map);
  document.body.classList.add('nav-action-open');
  state.map.once('popupclose', () => document.body.classList.remove('nav-action-open'));
  {
    const element = popup.getElement();
    element?.querySelectorAll('[data-nav-action]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.navAction;
      if (action === 'avoid' && onRoute) {
        state.navigationAvoids.push({lat: point.lat, lon: point.lon});
        syncNavigationRouteEdits();
        recalculateNavigationRoute('Passage interdit ajouté. Recherche d’un détour.');
      } else if (action === 'via') {
        insertNavigationVia(point);
      }
      state.map.closePopup();
    }));
  }
}

function navigationBRouterProfile() {
  if (state.navigationManualRoute) return 'trekking';
  if (state.mode === 'road' || (state.mode === 'family' && state.familyFast)) return 'fastbike-verylowtraffic';
  return 'mtb';
}

async function requestNavigationSegment(origin, destination, signal) {
  const profile = navigationBRouterProfile();
  const params = new URLSearchParams({
    lonlats: `${origin.lon},${origin.lat}|${destination.lon},${destination.lat}`,
    profile, alternativeidx: '0', format: 'geojson'
  });
  if (profile === 'mtb' && !state.navigationManualRoute) {
    params.set('profile:path_preference', state.mode === 'family' ? '100' : state.seekIntense ? '160' : $('#favor-trails').checked ? '80' : '20');
    params.set('profile:cycleroutes_pref', state.mode === 'family' ? '1.0' : state.mode === 'vtt' && state.seekIntense ? '0.2' : $('#favor-trails').checked ? '3.0' : '0.2');
    params.set('profile:MTB_factor', state.mode === 'vtt' && state.seekIntense ? '2.0' : '0.0');
    params.set('profile:isbike_for_mainroads', state.mode === 'family' ? '0' : '1');
    params.set('profile:hills', state.mode === 'family' ? '2' : '0');
    params.set('profile:avoid_unsafe', '1');
  }
  if (state.navigationAvoids.length) {
    params.set('nogos', state.navigationAvoids.map(point => `${point.lon},${point.lat},60`).join('|'));
  }
  const response = await fetch(`${BROUTER_URL}?${params}`, {signal, headers: {'Accept': 'application/geo+json'}});
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || text.replace(/<[^>]*>/g, ' ').trim().slice(0, 180) || `BRouter indisponible (${response.status}).`);
  return normalizeBRouter(payload);
}

async function recalculateNavigationRoute(message = 'Parcours recalculé.') {
  if (!state.route || !state.destination || !state.map || !document.body.classList.contains('nav-active')) return;
  state.navigationRerouteController?.abort();
  const controller = new AbortController();
  state.navigationRerouteController = controller;
  const version = ++state.navigationRerouteVersion;
  const center = state.map.getCenter(), zoom = state.map.getZoom();
  const origin = state.lastPosition || state.origin;
  // Repositionne les étapes sur le tracé courant avant de les trier : une nouvelle étape s’insère ainsi entre les deux passages qui l’encadrent.
  state.navigationViaPoints = state.navigationViaPoints.map(item => ({...item, progress: nearestPathProgress(item)})).sort((a, b) => a.progress - b.progress);
  const targets = [...state.navigationViaPoints.map(item => ({lat: item.lat, lon: item.lon})), state.destination];
  try {
    const routes = [];
    let cursor = origin;
    for (const target of targets) {
      const segment = await requestNavigationSegment(cursor, target, controller.signal);
      if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
      routes.push(segment); cursor = target;
    }
    const path = [];
    const steps = [];
    let distanceMeters = 0, durationSeconds = 0;
    routes.forEach((route, index) => {
      path.push(...(index ? route.path.slice(1) : route.path));
      distanceMeters += route.distanceMeters; durationSeconds += route.durationSeconds;
      steps.push(...(route.legs[0]?.steps || []));
    });
    if (!steps.length) throw new Error('Le moteur n’a pas fourni d’étapes de navigation.');
    state.origin = origin;
    state.navigationSegments = routes;
    refreshViaProgressFromSegments();
    state.route = combineNavigationSegments(state.navigationSegments);
    state.currentStep = 0;
    state.routeStartDistanceTravelled = state.distanceTravelledMeters;
    drawRoute();
    state.map.setView(center, zoom, {animate: false});
    renderNavigationPoints();
    updateNavigation({coords: {latitude: origin.lat, longitude: origin.lon, accuracy: 10, speed: 0}, timestamp: Date.now()});
    persistNavigationResume(true);
    toast(message);
  } catch (error) {
    if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
    toast('Détour impossible : ' + error.message);
  }
}

function updateNavigation(position) {
  if (!state.route || !state.map) return;
  const point = {lat: position.coords.latitude, lon: position.coords.longitude};
  state.lastPosition = point;
  const sampleTime = Number(position.timestamp) || Date.now();
  const accuracy = Number(position.coords.accuracy) || 10;
  let deltaMeters = 0, elapsedSeconds = 0, hasMoved = false;
  if (state.previousGpsSample) {
    elapsedSeconds = Math.min(10, Math.max(0, (sampleTime - state.previousGpsSample.time) / 1000));
    deltaMeters = state.map.distance([state.previousGpsSample.point.lat, state.previousGpsSample.point.lon], [point.lat, point.lon]);
    const movementThreshold = Math.max(2.5, Math.min(10, accuracy * 0.3));
    hasMoved = elapsedSeconds > 0 && deltaMeters > movementThreshold && deltaMeters < Math.max(100, elapsedSeconds * 45);
  }
  const gpsSpeed = Number.isFinite(position.coords.speed) && position.coords.speed >= 0 ? position.coords.speed * 3.6 : null;
  let measuredSpeed = gpsSpeed === null ? (hasMoved && elapsedSeconds ? deltaMeters / elapsedSeconds * 3.6 : 0) : gpsSpeed;
  if (!hasMoved && (gpsSpeed === null || gpsSpeed < 2)) measuredSpeed = 0;
  measuredSpeed = Math.min(220, Math.max(0, measuredSpeed));
  state.currentSpeedKmh = measuredSpeed < 1.4 ? 0 : (state.currentSpeedKmh ? state.currentSpeedKmh * 0.45 + measuredSpeed * 0.55 : measuredSpeed);
  if (hasMoved) state.distanceTravelledMeters += deltaMeters;
  if (elapsedSeconds && state.currentSpeedKmh >= 1.5) {
    state.movingSeconds += elapsedSeconds;
    state.movingDistanceMeters += hasMoved ? deltaMeters : state.currentSpeedKmh / 3.6 * elapsedSeconds;
  }
  updateMapBearing(position);
  state.previousGpsSample = {point, time: sampleTime};

  const steps = state.route.legs[0]?.steps || [];
  let step = currentStep();
  if (!step) return;
  let distance = state.map.distance([point.lat, point.lon], [step.endLocation.lat, step.endLocation.lon]);
  const announcementIndex = state.route.manual ? state.currentStep : state.mode === 'moto' ? state.currentStep + 1 : state.currentStep;
  if (distance <= 150) announceStep(announcementIndex);
  if (distance < 35 && state.currentStep < steps.length - 1) {
    state.currentStep++; step = currentStep();
    distance = state.map.distance([point.lat, point.lon], [step.endLocation.lat, step.endLocation.lon]);
  }
  $('#nav-instruction').textContent = step.instructions;
  $('#nav-distance').textContent = formatProximity(distance) + ' avant la prochaine étape';
  $('#nav-step-count').textContent = 'Étape ' + (state.currentStep + 1) + ' / ' + steps.length;
  const routeMeters = Math.max(0, state.route.distanceMeters || 0);
  const riddenThisRoute = Math.max(0, state.distanceTravelledMeters - state.routeStartDistanceTravelled);
  const remainingMeters = Math.max(0, routeMeters - riddenThisRoute);
  const progress = routeMeters ? Math.min(100, Math.round(riddenThisRoute / routeMeters * 100)) : 0;
  $('#nav-progress-bar').style.width = Math.max(5, progress) + '%';
  $('#nav-speed').textContent = String(Math.round(state.currentSpeedKmh));
  $('#nav-travelled').textContent = formatDistance(state.distanceTravelledMeters);
  $('#nav-remaining').textContent = formatDistance(remainingMeters);
  $('#nav-rider').classList.toggle('is-moving', state.currentSpeedKmh >= 1.5);
  const averageSpeed = state.movingSeconds >= 20 && state.movingDistanceMeters >= 60
    ? state.movingDistanceMeters / state.movingSeconds * 3.6 : 0;
  $('#nav-speed-average').textContent = averageSpeed
    ? 'Moyenne roulée · ' + Math.round(averageSpeed) + ' km/h' : 'Analyse de votre vitesse…';
  $('#nav-arrival').textContent = averageSpeed && remainingMeters > 0
    ? new Date(sampleTime + remainingMeters / (averageSpeed / 3.6) * 1000).toLocaleTimeString('fr-BE', {hour: '2-digit', minute: '2-digit'})
    : remainingMeters === 0 ? 'Arrivée' : 'Calcul en cours';
  $('#nav-gps-status').textContent = (state.currentSpeedKmh >= 1.5 ? 'En mouvement' : 'À l’arrêt') + ' · GPS ±' + Math.round(accuracy) + ' m';
  const arrowHeading = state.navigationHeading ?? state.lastMapBearing;
  // Flèche directionnelle évidée, inspirée de l’icône GPS fournie.
  const arrowPoints = [
    offsetPointMeters(point, 11.5, arrowHeading),
    offsetPointMeters(point, 6.7, arrowHeading + 145),
    offsetPointMeters(point, 2.2, arrowHeading + 180),
    offsetPointMeters(point, 6.7, arrowHeading + 215)
  ];
  const arrowStyle = {
    color: '#fff', weight: 3,
    fillColor: getComputedStyle(document.body).getPropertyValue('--mode-accent').trim() || '#86b83e',
    fillOpacity: .98, opacity: 1, interactive: false
  };
  if (state.navigationMarker) state.navigationMarker.setLatLngs(arrowPoints);
  else state.navigationMarker = L.polygon(arrowPoints, arrowStyle).addTo(state.map);
  const now = Date.now();
  if (state.navigationFollow) {
    // Le zoom automatique ne reprend qu’en suivi GPS, pour laisser le contrôle tactile libre.
    const targetZoom = Math.max(17.5, Math.min(18.5, 18.5 - state.currentSpeedKmh * 0.025));
    const currentZoom = state.map.getZoom();
    if (currentZoom < 17 || (now - state.lastNavigationZoomAt > 2200 && Math.abs(currentZoom - targetZoom) >= 0.25)) {
      state.programmaticNavigationZoom = true;
      state.map.setZoom(targetZoom, {animate: currentZoom >= 17, duration: 0.65});
      state.programmaticNavigationZoom = false;
      state.lastNavigationZoomAt = now;
    }
    state.map.panTo([point.lat, point.lon], {animate: false});
  }
  const routePoints = state.routeLayer?.getLatLngs() || [];
  let nearestRouteDistance = Infinity;
  const sampleEvery = Math.max(1, Math.floor(routePoints.length / 250));
  for (let i = 0; i < routePoints.length; i += sampleEvery) nearestRouteDistance = Math.min(nearestRouteDistance, state.map.distance(routePoints[i], [point.lat, point.lon]));
  if (state.routeLayer && !state.rerouting && now - state.lastRerouteAt > 15000 && nearestRouteDistance > 120) {
    state.rerouting = true; state.lastRerouteAt = now;
    toast('Écart détecté. Recalcul du parcours.');
    if (document.body.classList.contains('nav-active')) recalculateNavigationRoute('Itinéraire adapté à votre position.');
    else calculateRoute(point, state.destination).finally(() => { state.rerouting = false; });
    if (document.body.classList.contains('nav-active')) setTimeout(() => { state.rerouting = false; }, 5000);
  }
  persistNavigationResume(false);
}
async function resumeNavigationFromSnapshot() {
  const snapshot = state.navigationResumeSnapshot || readNavigationResumeSnapshot();
  if (!snapshot?.route?.path?.length) { toast('Aucun trajet à reprendre.'); return; }
  state.navigationResumeSnapshot = snapshot;
  state.mode = snapshot.mode || 'vtt';
  state.familyFast = Boolean(snapshot.familyFast);
  state.seekIntense = Boolean(snapshot.seekIntense);
  localStorage.setItem('ct_family_fast', String(state.familyFast));
  localStorage.setItem('ct_seek_intense', String(state.seekIntense));
  setMode(state.mode);
  state.origin = snapshot.origin; state.destination = snapshot.destination;
  $('#origin-input').value = snapshot.originLabel || 'Départ enregistré';
  $('#destination-input').value = snapshot.destinationLabel || 'Arrivée enregistrée';
  state.manualMode = false;
  state.manualReturnToStart = Boolean(snapshot.manualReturnToStart);
  state.manualPoints = Array.isArray(snapshot.manualPoints) ? snapshot.manualPoints : [];
  state.manualLegs = Array.isArray(snapshot.manualLegs) ? snapshot.manualLegs : [];
  state.route = snapshot.route;
  state.navigationSegments = Array.isArray(snapshot.navigationSegments)
    ? snapshot.navigationSegments : (snapshot.route.navigationSegments || []);
  state.navigationAvoids = snapshot.navigationAvoids || snapshot.route.navigationAvoids || [];
  state.navigationViaPoints = snapshot.navigationViaPoints || snapshot.route.navigationViaPoints || [];
  state.lastPosition = snapshot.lastPosition || snapshot.origin;
  state.currentStep = Math.max(0, Math.min(Number(snapshot.currentStep) || 0, (state.route.legs?.[0]?.steps?.length || 1) - 1));
  state.distanceTravelledMeters = Number(snapshot.distanceTravelledMeters) || 0;
  state.movingDistanceMeters = Number(snapshot.movingDistanceMeters) || 0;
  state.movingSeconds = Number(snapshot.movingSeconds) || 0;
  state.routeStartDistanceTravelled = Number(snapshot.routeStartDistanceTravelled) || 0;
  state.navigationHeading = Number.isFinite(snapshot.navigationHeading) ? snapshot.navigationHeading : null;
  state.lastSpokenStep = Number(snapshot.lastSpokenStep) || -1;
  if (!initializeMap()) return;
  if (state.route.manual && state.manualPoints.length > 1 && state.manualLegs.length) renderManualTrack();
  state.route = snapshot.route;
  state.navigationSegments = Array.isArray(snapshot.navigationSegments)
    ? snapshot.navigationSegments : (snapshot.route.navigationSegments || []);
  state.navigationAvoids = snapshot.navigationAvoids || snapshot.route.navigationAvoids || [];
  state.navigationViaPoints = snapshot.navigationViaPoints || snapshot.route.navigationViaPoints || [];
  updateManualModeUI();
  drawRoute(); showRoute();
  $('#route-title').textContent = state.route.manual ? 'Tracé manuel' : 'Votre parcours';
  $('#route-result').classList.toggle('manual-result', Boolean(state.route.manual));
  await startNavigation(true);
}

function forgetNavigationResume() {
  localStorage.removeItem('ct_navigation_resume');
  state.navigationResumeSnapshot = null;
  renderResumeTripCard();
  toast('Trajet précédent oublié.');
}

async function startNavigation(resuming = false) {
  if (!state.route) { toast(state.manualMode ? 'Ajoutez au moins une étape sur la carte.' : 'Calculez d’abord un itinéraire.'); return; }
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible sur cet appareil.'); return; }
  if (state.manualMode) finishManualMode();
  if (!resuming) {
    localStorage.removeItem('ct_navigation_resume');
    state.navigationResumeSnapshot = null;
    state.lastResumeSaveAt = 0;
  }
  state.navigationManualRoute = Boolean(state.route.manual);
  state.navigationAvoids = [...(state.route.navigationAvoids || [])];
  state.navigationViaPoints = [...(state.route.navigationViaPoints || (state.route.manual
    ? state.manualPoints.slice(1, state.manualReturnToStart ? undefined : -1).map((point, index) => ({...point, progress: (index + 1) / Math.max(1, state.manualPoints.length - 1)}))
    : []))];
  if (Array.isArray(state.route.navigationSegments) && state.route.navigationSegments.length === state.navigationViaPoints.length + 1) {
    state.navigationSegments = state.route.navigationSegments;
  } else if (state.route.manual && state.manualLegs.length === state.navigationViaPoints.length + 1) {
    state.navigationSegments = state.manualLegs.map((leg, index) => ({
      path: leg.path, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds,
      legs: [{steps: [state.route.legs[0].steps[index]]}]
    }));
  } else {
    state.navigationSegments = [{path: state.route.path, distanceMeters: state.route.distanceMeters, durationSeconds: state.route.durationSeconds, legs: state.route.legs}];
  }
  refreshViaProgressFromSegments();
  $('#nav-panel').classList.remove('hidden');
  document.body.classList.add('nav-active');
  state.navigationFollow = true;
  state.map.dragging.enable(); state.map.touchZoom.enable(); state.map.doubleClickZoom.enable();
  setNavigationFollow(true);
  $('#map-mode-label').textContent = 'NAVIGATION ' + (state.mode === 'family' ? 'VÉLO FAMILIAL' : state.mode === 'road' ? 'VÉLO DE ROUTE' : state.mode === 'moto' ? 'MOTOCROSS' : 'VTT') + ' ACTIVE';
  $('#nav-mode-pill').textContent = (state.mode === 'family' ? state.familyFast ? 'VÉLO FAMILIAL · RAPIDE' : 'VÉLO FAMILIAL · RAVeL' : state.mode === 'road' ? 'VÉLO DE ROUTE' : state.mode === 'moto' ? 'MOTOCROSS · PETITES ROUTES' : 'VTT') + ' · GPS ACTIF';
  $('#nav-rider-image').src = state.mode === 'family' ? 'assets/velo-familial.webp' : state.mode === 'road' ? 'assets/velo-route.webp' : state.mode === 'moto' ? 'assets/motocross-calme.webp' : 'assets/vtt-dynamique.webp';
  if (!resuming) {
    state.distanceTravelledMeters = 0; state.movingDistanceMeters = 0; state.movingSeconds = 0;
    state.currentStep = 0; state.routeStartDistanceTravelled = 0; state.navigationHeading = null;
  }
  state.currentSpeedKmh = 0; state.previousGpsSample = resuming && state.lastPosition ? {point: {...state.lastPosition}, time: Date.now()} : null; state.lastNavigationZoomAt = 0;
  state.lastSpokenStep = resuming ? Math.max(-1, state.currentStep - 1) : -1;
  if (state.mode === 'moto' && !resuming) announceStep(0);
  else speakText(state.mode === 'family' ? state.familyFast ? 'Navigation vélo familial rapide démarrée. Suivez l’itinéraire.' : 'Navigation vélo familial démarrée. Suivez le RAVeL.' : state.mode === 'road' ? 'Navigation vélo de route démarrée. Suivez l’itinéraire rapide.' : 'Navigation VTT démarrée. Suivez le tracé.');
  if ('wakeLock' in navigator) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); }
    catch { toast('Le maintien de l’écran n’a pas été autorisé par l’appareil.'); }
  }
  renderNavigationPoints();
  persistNavigationResume(true);
  renderResumeTripCard();
  state.watchId = navigator.geolocation.watchPosition(updateNavigation, error => {
    $('#nav-gps-status').textContent = 'GPS indisponible';
    toast('GPS : ' + error.message);
  }, {enableHighAccuracy: true, maximumAge: 2000, timeout: 15000});
  toast('Navigation active. Ne manipulez pas l’écran en roulant.');
}
async function stopNavigation() {
  persistNavigationResume(true);
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  document.body.classList.remove('nav-active', 'nav-action-open');
  state.navigationRerouteController?.abort(); state.navigationRerouteController = null; clearNavigationPointLayers();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.wakeLock) { try { await state.wakeLock.release(); } catch {} state.wakeLock = null; }
  $('#nav-panel').classList.add('hidden'); $('#map-mode-label').textContent = state.mode === 'family' ? state.familyFast ? 'OSM · VÉLO FAMILIAL · RAPIDE' : 'OSM · RAVeL & CHEMINS' : state.mode === 'road' ? 'OSM · VÉLO DE ROUTE · RAPIDE' : state.mode === 'vtt' ? 'OSM · ROUTE VTT' : 'OSM · MOTO · PETITES ROUTES';
  renderResumeTripCard();
  toast('Navigation terminée.');
}

function savedItem(route, index) {
  return `<div class="saved-item" data-route-index="${index}" role="button" tabindex="0" aria-label="Charger le trajet ${escapeHtml(route.title)}"><span class="saved-route-icon" aria-hidden="true">⌁</span><div class="saved-route-copy"><strong title="${escapeHtml(route.title)}">${escapeHtml(route.title)}</strong><span>${formatDistance(route.distance || 0)} · ${new Date(route.savedAt).toLocaleDateString('fr-BE')}</span></div><button class="delete-saved" data-delete="${index}" aria-label="Supprimer ${escapeHtml(route.title)}">×</button></div>`;
}

function loadSavedRoute(index) {
  const route = state.saved[index]; if (!route?.origin || !route?.destination) return;
  state.manualUndo = null;
  if (route.mode) setMode(route.mode);
  if (Array.isArray(route.manualPoints) && route.manualPoints.length > 1) {
    state.manualMode = false;
    state.origin = route.origin; state.destination = route.destination;
    state.manualPoints = route.manualPoints.map(point => ({lat: Number(point.lat), lon: Number(point.lon)}));
    state.manualReturnToStart = Boolean(route.manualReturnToStart);
    $('#origin-input').value = route.originLabel || 'Point enregistré';
    closeModal('saved-modal');
    clearDisplayedRoute();
    updateManualTrack(); updateManualModeUI();
    state.map.fitBounds(state.manualPoints.map(point => [point.lat, point.lon]), {padding: [55, 55], maxZoom: 16});
    toast('Tracé manuel chargé.');
    return;
  }
  if (state.manualMode) finishManualMode();
  clearDisplayedRoute();
  state.manualPoints = [];
  state.manualReturnToStart = false;
  if (route.mode === 'family' && typeof route.familyFast === 'boolean') {
    state.familyFast = route.familyFast; localStorage.setItem('ct_family_fast', String(state.familyFast)); setMode('family');
  }
  $('#origin-input').value = route.originLabel || 'Point enregistré'; $('#destination-input').value = route.destinationLabel || 'Point enregistré';
  state.origin = route.origin; state.destination = route.destination; closeModal('saved-modal'); calculateRoute();
}

function renderSaved() {
  const empty = '<p class="empty-saved">Aucun parcours enregistré.</p>';
  $('#saved-list').innerHTML = state.saved.length ? state.saved.map(savedItem).join('') : '<p class="empty-saved">Vos itinéraires favoris apparaîtront ici.</p>';
  $('#saved-modal-list').innerHTML = state.saved.length ? state.saved.map(savedItem).join('') : empty;
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation(); state.saved.splice(Number(button.dataset.delete), 1); saveSaved(); toast('Parcours supprimé.');
  }));
  document.querySelectorAll('.saved-item').forEach(item => {
    item.addEventListener('click', event => {
      if (event.target.closest('[data-delete]')) return;
      loadSavedRoute(Number(item.dataset.routeIndex));
    });
    item.addEventListener('keydown', event => {
      if (event.target.closest('[data-delete]')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        loadSavedRoute(Number(item.dataset.routeIndex));
      }
    });
  });
}
function saveSaved() { localStorage.setItem('ct_saved_routes', JSON.stringify(state.saved)); renderSaved(); }

function saveRoute() {
  if (!state.route) { toast('Aucun parcours à enregistrer.'); return; }
  state.saved.unshift({title: routeLabel(), distance: state.route.distanceMeters, savedAt: new Date().toISOString(), mode: state.mode, familyFast: state.mode === 'family' ? state.familyFast : undefined, manualPoints: state.route.manual ? state.manualPoints.map(point => ({lat: point.lat, lon: point.lon})) : undefined, manualReturnToStart: state.route.manual ? state.manualReturnToStart : undefined, origin: state.origin, destination: state.destination, originLabel: $('#origin-input').value, destinationLabel: $('#destination-input').value});
  state.saved = state.saved.slice(0, 20); saveSaved(); toast('Parcours enregistré sur cet appareil.');
}

function useCurrentLocation() {
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible.'); return; }
  navigator.geolocation.getCurrentPosition(position => {
    setPoint('origin', {lat: position.coords.latitude, lon: position.coords.longitude}, 'Ma position actuelle');
    if (state.map) state.map.setView([state.origin.lat, state.origin.lon], 15);
    toast('Position de départ définie.');
  }, error => toast(`Position indisponible : ${error.message}`), {enableHighAccuracy: true, timeout: 12000});
}

function setNavigationFollow(follow) {
  if (!document.body.classList.contains('nav-active')) return;
  state.navigationFollow = follow;
  const button = $('#center-map');
  button.title = follow ? 'Suivi GPS actif · Recentrer' : 'Recentrer et reprendre le suivi GPS';
  button.setAttribute('aria-label', button.title);
  button.classList.toggle('follow-paused', !follow);
}

function centerMap() {
  if (!state.map) { initializeMap(); return; }
  const point = state.lastPosition || state.origin;
  if (point) state.map.setView([point.lat, point.lon], Math.max(state.map.getZoom(), 14), {animate: true});
  else useCurrentLocation();
  if (document.body.classList.contains('nav-active')) setNavigationFollow(true);
}

function setMode(mode) {
  state.mode = ['family', 'road', 'vtt', 'moto'].includes(mode) ? mode : 'vtt';
  document.body.dataset.mode = state.mode;
  localStorage.setItem('ct_mode', state.mode);
  document.querySelectorAll('.mode-button').forEach(button => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#favor-trails-row').classList.toggle('hidden', state.mode !== 'vtt');
  $('#family-fast-row').classList.toggle('hidden', state.mode !== 'family');
  $('#family-fast').checked = state.familyFast;
  $('#sensation-row').classList.toggle('hidden', state.mode !== 'vtt');
  $('#seek-intense').checked = state.seekIntense;
  $('#mode-hint').textContent = state.mode === 'family' ? state.familyFast ? 'VÉLO FAMILIAL · RAPIDE' : 'RAVeL · PENTES DOUCES' : state.mode === 'road' ? 'ROUTES · RAPIDE' : state.mode === 'vtt' ? state.seekIntense ? 'VTT · SENSATIONS' : 'VTT · CHEMINS' : 'MOTO · SENSATIONS';
  $('#routing-note').textContent = state.mode === 'family'
    ? state.familyFast ? 'Trajet plus direct avec le profil vélo à faible trafic. Autoroutes exclues, axes fréquentés pénalisés; le RAVeL peut ne plus être prioritaire.' : 'Vélo familial : RAVeL balisés prioritaires; voies cyclables en bord de route fortement pénalisées. Les routes ne servent qu’aux raccordements nécessaires.'
    : state.mode === 'road'
      ? 'Vélo de route : itinéraire le plus rapide possible sur routes adaptées et pistes cyclables, avec préférence pour les surfaces roulantes.'
      : state.mode === 'vtt'
        ? state.seekIntense ? 'VTT sensations : les chemins plus engagés sont favorisés, avec des détours acceptés.' : 'VTT : priorité forte aux sentiers et RAVeL; les routes de centre-ville sont pénalisées.'
        : 'Motocross homologuée : priorité maximale aux pistes et chemins moto-accessibles, détour accepté pour éviter les grands axes et les centres-villes.';
  $('#route-button').disabled = false;
  $('#route-button span').textContent = state.mode === 'family' ? 'Calculer mon itinéraire familial' : state.mode === 'road' ? 'Calculer l’itinéraire rapide' : state.mode === 'moto' ? 'Calculer mon itinéraire moto' : 'Calculer mon itinéraire VTT';
}

function beginMapPick(target) {
  if (state.manualMode) { toast('Terminez le tracé manuel avant de choisir un point isolé.'); return; }
  state.mapPickTarget = target;
  initializeMap();
  $('#map-pick-label').textContent = target === 'origin' ? 'départ' : 'arrivée';
  $('#map-pick-hint').classList.remove('hidden');
  if (window.matchMedia('(max-width: 680px)').matches) $('#map').scrollIntoView({behavior: 'smooth', block: 'center'});
}

function exportGpx() {
  if (!state.route?.path?.length) { toast('Calculez un itinéraire avant de l’exporter.'); return; }
  const trackSegments = state.route.manual && state.route.legs?.[0]?.steps?.length
    ? state.route.legs[0].steps.map(step => step.path).filter(path => path?.length > 1)
    : [state.route.path];
  const trackXml = trackSegments.map(segment => {
    const points = segment.map(([lat, lon]) => `    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`).join('\n');
    return `  <trkseg>\n${points}\n  </trkseg>`;
  }).join('\n');
  const modeName = state.mode === 'family' ? 'Vélo familial' : state.mode === 'road' ? 'Vélo de route' : state.mode === 'moto' ? 'Motocross' : 'VTT';
  const name = escapeHtml(`${state.route.manual ? 'Tracé manuel' : modeName} - ${routeLabel()}`);
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Cross Travel" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name>\n${trackXml}\n</trk></gpx>`;
  const url = URL.createObjectURL(new Blob([gpx], {type: 'application/gpx+xml'}));
  const link = document.createElement('a'); link.href = url; link.download = 'cross-travel.gpx'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('GPX exporté. Ouvrez le fichier avec OsmAnd pour l’importer.');
}
function saveRouterSettings() {
  const value = $('#route-server-input').value.trim() || DEFAULT_ROUTER;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error('Utilisez une adresse HTTPS pour le moteur.');
    state.routeServer = parsed.href.replace(/\/$/, '');
    localStorage.setItem('ct_route_server', state.routeServer);
    closeModal('settings-modal'); toast('Adresse du moteur enregistrée.');
  } catch (error) { toast(error.message || 'Adresse de moteur invalide.'); }
}

$('#settings-open').addEventListener('click', () => openModal('settings-modal'));
$('#map-settings').addEventListener('click', initializeMap);
$('#save-route-server').addEventListener('click', saveRouterSettings);
$('#route-button').addEventListener('click', () => calculateRoute());
$('#manual-mode-toggle').addEventListener('click', toggleManualMode);
$('#manual-map-finish').addEventListener('click', finishManualMode);
$('#manual-reset').addEventListener('click', resetManualTrack);
$('#export-manual-gpx').addEventListener('click', exportGpx);
$('#use-location').addEventListener('click', useCurrentLocation);
$('#center-map').addEventListener('click', centerMap);
$('#start-navigation').addEventListener('click', () => startNavigation(false));
$('#resume-navigation').addEventListener('click', resumeNavigationFromSnapshot);
$('#forget-resume').addEventListener('click', forgetNavigationResume);
$('#stop-navigation').addEventListener('click', stopNavigation);
$('#voice-toggle').addEventListener('click', toggleVoice);
$('#save-route').addEventListener('click', saveRoute);
$('#saved-open').addEventListener('click', () => openModal('saved-modal'));
$('#saved-open-2').addEventListener('click', () => openModal('saved-modal'));
$('#help-open').addEventListener('click', () => openModal('help-modal'));
document.querySelectorAll('.mode-button').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('#family-fast').addEventListener('change', () => {
  state.familyFast = $('#family-fast').checked;
  localStorage.setItem('ct_family_fast', String(state.familyFast));
  setMode(state.mode);
  if (state.route && state.mode === 'family' && state.origin && state.destination) calculateRoute(state.origin, state.destination);
});
$('#seek-intense').addEventListener('change', () => {
  state.seekIntense = $('#seek-intense').checked;
  localStorage.setItem('ct_seek_intense', String(state.seekIntense));
  setMode(state.mode);
  if (state.route && state.origin && state.destination) calculateRoute(state.origin, state.destination);
});
document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => beginMapPick(button.dataset.pick)));
$('#cancel-map-pick').addEventListener('click', () => { state.mapPickTarget = null; $('#map-pick-hint').classList.add('hidden'); });
$('#export-gpx').addEventListener('click', exportGpx);
attachAddressSearch('origin'); attachAddressSearch('destination');
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
window.addEventListener('online', () => { $('#connection-label').textContent = 'En ligne'; });
window.addEventListener('offline', () => { $('#connection-label').textContent = 'Hors ligne'; });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') persistNavigationResume(true);
  if (document.visibilityState === 'visible' && state.watchId !== null && 'wakeLock' in navigator && !state.wakeLock) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
});


const arrivalIntro = $('#arrival-intro');
if (arrivalIntro) {
  const removeArrivalIntro = () => arrivalIntro.remove();
  arrivalIntro.addEventListener('animationend', event => {
    if (event.animationName === 'arrival-intro-exit') removeArrivalIntro();
  });
  window.setTimeout(removeArrivalIntro, 2800);
}

renderSaved();
setMode(state.mode);
renderResumeTripCard();
updateVoiceButton();
window.addEventListener('pagehide', () => persistNavigationResume(true));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
initializeMap();
