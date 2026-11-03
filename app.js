const $ = (selector) => document.querySelector(selector);
const DEFAULT_ROUTER = 'https://valhalla1.openstreetmap.de/route';
const BROUTER_URL = 'https://brouter.de/brouter';
const state = {
  map: null, tileLayer: null, route: null, routeLayer: null, stepLayers: [], markers: [],
  origin: null, destination: null, currentStep: 0, watchId: null, wakeLock: null,
  lastPosition: null, navigationMarker: null, rerouting: false, lastRerouteAt: 0,
  lastGeocodeAt: 0, routeServer: localStorage.getItem('ct_route_server') || DEFAULT_ROUTER,
  mode: localStorage.getItem('ct_mode') || 'vtt', mapPickTarget: null,
  voiceEnabled: localStorage.getItem('ct_voice_enabled') !== 'false', lastSpokenStep: -1,
  searchTimers: {}, searchControllers: {}, suggestions: {origin: [], destination: []},
  saved: JSON.parse(localStorage.getItem('ct_saved_routes') || '[]')
};

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
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
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`;
}
function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
function toMeters(kilometers) { return Number(kilometers || 0) * 1000; }
function routeLabel() { return `${$('#origin-input').value.trim()} → ${$('#destination-input').value.trim()}`; }
function setPoint(which, point, label) {
  state[which] = {lat: Number(point.lat), lon: Number(point.lon)};
  $(`#${which}-input`).value = label || 'Point choisi sur la carte';
  closeSuggestions(which);
  if (state.map) {
    state.markers = state.markers.filter(marker => { state.map.removeLayer(marker); return false; });
    for (const [key, color] of [['origin', '#80a943'], ['destination', '#252e29']]) {
      const selected = state[key];
      if (selected) state.markers.push(L.circleMarker([selected.lat, selected.lon], {radius: 7, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1}).addTo(state.map));
    }
  }
}

function closeSuggestions(which) {
  const list = $(`#${which}-suggestions`);
  list.classList.add('hidden'); list.replaceChildren(); state.suggestions[which] = [];
}

function initializeMap() {
  if (state.map) { state.map.invalidateSize(); return true; }
  if (!window.L) { toast('La bibliothèque de carte n’a pas pu se charger. Réessayez avec une connexion active.'); return false; }
  $('.map-panel').classList.add('map-ready');
  state.map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true })
    .setView([50.337, 4.52], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  state.tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  }).addTo(state.map);
  state.tileLayer.on('tileerror', () => toast('Certaines tuiles OSM ne sont pas disponibles pour le moment.'));
  state.map.on('click', event => {
    const point = {lat: event.latlng.lat, lon: event.latlng.lng};
    const target = state.mapPickTarget || (!state.origin ? 'origin' : 'destination');
    setPoint(target, point);
    if (state.mapPickTarget) { state.mapPickTarget = null; $('#map-pick-hint').classList.add('hidden'); toast(`${target === 'origin' ? 'Départ' : 'Arrivée'} placé sur la carte.`); }
    else toast(`${target === 'origin' ? 'Départ' : 'Arrivée'} placé. Utilisez ⌖ pour choisir précisément chaque point.`);
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
  if (!feature) throw new Error(payload.error || 'BRouter n’a pas trouvé de parcours VTT pour ces points.');
  const path = parseShape(feature.geometry);
  if (path.length < 2) throw new Error('BRouter n’a pas renvoyé de tracé exploitable.');
  let distanceMeters = 0;
  for (let i = 1; i < path.length; i++) distanceMeters += L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
  const props = feature.properties || {};
  if (Number(props['track-length']) > 0) distanceMeters = Number(props['track-length']) * 1000;
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
  const params = new URLSearchParams({
    lonlats: `${origin.lon},${origin.lat}|${destination.lon},${destination.lat}`,
    profile: 'mtb', alternativeidx: '0', format: 'geojson',
    'profile:path_preference': $('#favor-trails').checked ? '40' : '20',
    'profile:cycleroutes_pref': $('#favor-trails').checked ? '3.0' : '0.2',
    'profile:avoid_unsafe': '1'
  });
  const response = await fetch(`${BROUTER_URL}?${params}`);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `Erreur du moteur BRouter (${response.status}).`);
  return normalizeBRouter(payload);
}

async function calculateRoute(fromOverride = null, toOverride = null) {
  const button = $('#route-button'); button.disabled = true;
  button.querySelector('span').textContent = 'Calcul en cours…';
  try {
    if (!initializeMap()) throw new Error('La carte est indisponible.');
    const origin = fromOverride || await resolvePoint($('#origin-input'), state.origin);
    const destination = toOverride || await resolvePoint($('#destination-input'), state.destination);
    state.origin = origin; state.destination = destination;
    if (state.mode === 'vtt') {
      state.route = await requestBRouter(origin, destination);
    } else {
      const preferPaths = $('#favor-trails').checked;
      const trailPreference = preferPaths ? 1 : 0;
      const trackPreference = preferPaths ? 1 : 0.5;
      const highwayPreference = preferPaths ? 0 : 0.5;
      const tollPreference = $('#avoid-tolls').checked ? 0 : 0.5;
      const response = await fetch(state.routeServer, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Client-Id': 'cross-travel (github.com/kgjames26/cross-travel)'},
        body: JSON.stringify({
          locations: [{lat: origin.lat, lon: origin.lon, type: 'break'}, {lat: destination.lat, lon: destination.lon, type: 'break'}],
          costing: 'motorcycle',
          costing_options: {motorcycle: {use_highways: highwayPreference, use_trails: trailPreference, use_tracks: trackPreference, use_tolls: tollPreference}},
          directions_options: {units: 'kilometers', language: 'fr-FR'},
          shape_format: 'geojson'
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.status_message || `Erreur du moteur Valhalla (${response.status}).`);
      state.route = normalizeValhalla(payload);
    }
    state.currentStep = 0;
    state.lastSpokenStep = -1;
    drawRoute(); showRoute();
    $('#map-mode-label').textContent = state.mode === 'vtt' ? 'OSM · BROUTER · PROFIL VTT' : 'OSM · VALHALLA · PROFIL MOTO';
    $('#route-alert-text').textContent = state.mode === 'vtt'
      ? 'Profil vélo BRouter. Il privilégie les voies cyclables et chemins, mais les données et permissions locales restent à vérifier.'
      : 'Profil moto Valhalla en bêta. Les chemins accessibles aux VTT peuvent être interdits aux motos : vérifiez la signalisation et l’autorisation réelle.';
    const wikilocQuery = encodeURIComponent(`${$('#origin-input').value} ${$('#destination-input').value} ${state.mode === 'vtt' ? 'VTT' : 'enduro motocross'}`);
    $('#wikiloc-link').href = `https://www.wikiloc.com/search?query=${wikilocQuery}`;
    if (state.watchId !== null) {
      if (state.mode === 'moto') announceStep(0);
      else speakText('Parcours VTT recalculé. Suivez le nouveau tracé.');
    }
    if (fromOverride) toast('Itinéraire recalculé depuis votre position.');
  } catch (error) {
    toast(error.message || 'Le calcul a échoué. Vérifiez le serveur et la connexion.');
  } finally {
    button.disabled = false; button.querySelector('span').textContent = `Calculer mon itinéraire ${state.mode === 'vtt' ? 'VTT' : 'moto'}`;
  }
}

function drawRoute() {
  if (!state.map || !state.route) return;
  if (state.routeLayer) state.map.removeLayer(state.routeLayer);
  state.stepLayers.forEach(layer => state.map.removeLayer(layer));
  state.markers.forEach(marker => state.map.removeLayer(marker));
  state.stepLayers = []; state.markers = [];
  const path = state.route.path;
  state.routeLayer = L.polyline(path, {color: '#24382b', weight: 5, opacity: .94}).addTo(state.map);
  state.map.fitBounds(state.routeLayer.getBounds(), {padding: [55, 55]});
  for (const point of [state.origin, state.destination]) {
    if (point) state.markers.push(L.circleMarker([point.lat, point.lon], {radius: 7, color: '#fff', weight: 3, fillColor: '#80a943', fillOpacity: 1}).addTo(state.map));
  }
  (state.route.legs[0]?.steps || []).forEach(step => {
    if (step.path.length > 1) state.stepLayers.push(L.polyline(step.path, {color: '#d08b42', weight: 3, opacity: .42, dashArray: '5 7'}).addTo(state.map));
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

function updateNavigation(position) {
  if (!state.route || !state.map) return;
  const point = {lat: position.coords.latitude, lon: position.coords.longitude};
  state.lastPosition = point;
  const steps = state.route.legs[0]?.steps || [];
  let step = currentStep();
  if (!step) return;
  let distance = state.map.distance([point.lat, point.lon], [step.endLocation.lat, step.endLocation.lon]);
  const announcementIndex = state.mode === 'vtt' ? state.currentStep : state.currentStep + 1;
  if (distance <= 150) announceStep(announcementIndex);
  if (distance < 35 && state.currentStep < steps.length - 1) { state.currentStep++; step = currentStep(); distance = state.map.distance([point.lat, point.lon], [step.endLocation.lat, step.endLocation.lon]); }
  $('#nav-instruction').textContent = step.instructions;
  $('#nav-distance').textContent = `${formatDistance(distance)} avant la prochaine étape`;
  $('#nav-step-count').textContent = `Étape ${state.currentStep + 1} / ${steps.length}`;
  const progress = Math.round(state.currentStep / Math.max(steps.length - 1, 1) * 100);
  $('#nav-progress-bar').style.width = `${Math.max(5, progress)}%`;
  const remaining = steps.slice(state.currentStep).reduce((sum, item) => sum + item.distanceMeters, 0);
  $('#nav-remaining').textContent = `${formatDistance(remaining)} · ${formatDuration(state.route.durationSeconds * (1 - progress / 100))}`;
  if (state.navigationMarker) state.navigationMarker.setLatLng([point.lat, point.lon]);
  else state.navigationMarker = L.circleMarker([point.lat, point.lon], {radius: 8, color: '#fff', weight: 3, fillColor: '#86b83e', fillOpacity: 1}).addTo(state.map);
  state.map.panTo([point.lat, point.lon]);
  const now = Date.now();
  const routePoints = state.routeLayer?.getLatLngs() || [];
  let nearestRouteDistance = Infinity;
  const sampleEvery = Math.max(1, Math.floor(routePoints.length / 250));
  for (let i = 0; i < routePoints.length; i += sampleEvery) nearestRouteDistance = Math.min(nearestRouteDistance, state.map.distance(routePoints[i], [point.lat, point.lon]));
  if (state.routeLayer && !state.rerouting && now - state.lastRerouteAt > 15000 && nearestRouteDistance > 120) {
    state.rerouting = true; state.lastRerouteAt = now;
    toast('Écart détecté. Recalcul du parcours.');
    calculateRoute(point, state.destination).finally(() => { state.rerouting = false; });
  }
}

async function startNavigation() {
  if (!state.route) { toast('Calculez d’abord un itinéraire.'); return; }
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible sur cet appareil.'); return; }
  $('#nav-panel').classList.remove('hidden');
  $('#map-mode-label').textContent = `NAVIGATION ${state.mode === 'vtt' ? 'VTT' : 'MOTO'} ACTIVE`;
  state.lastSpokenStep = -1;
  if (state.mode === 'moto') announceStep(0);
  else speakText('Navigation VTT démarrée. Suivez le tracé.');
  if ('wakeLock' in navigator) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); }
    catch { toast('Le maintien de l’écran n’a pas été autorisé par l’appareil.'); }
  }
  state.watchId = navigator.geolocation.watchPosition(updateNavigation, error => toast(`GPS : ${error.message}`), {enableHighAccuracy: true, maximumAge: 2000, timeout: 15000});
  toast('Navigation active. Ne manipulez pas l’écran en roulant.');
}

async function stopNavigation() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.wakeLock) { try { await state.wakeLock.release(); } catch {} state.wakeLock = null; }
  $('#nav-panel').classList.add('hidden'); $('#map-mode-label').textContent = `OSM · ROUTE ${state.mode === 'vtt' ? 'VTT' : 'MOTO'}`;
  toast('Navigation terminée.');
}

function savedItem(route, index) {
  return `<div class="saved-item"><span class="saved-route-icon">⌁</span><div class="saved-route-copy"><strong title="${escapeHtml(route.title)}">${escapeHtml(route.title)}</strong><span>${formatDistance(route.distance || 0)} · ${new Date(route.savedAt).toLocaleDateString('fr-BE')}</span></div><button class="delete-saved" data-delete="${index}" aria-label="Supprimer ${escapeHtml(route.title)}">×</button></div>`;
}

function renderSaved() {
  const empty = '<p class="empty-saved">Aucun parcours enregistré.</p>';
  $('#saved-list').innerHTML = state.saved.length ? state.saved.map(savedItem).join('') : '<p class="empty-saved">Vos itinéraires favoris apparaîtront ici.</p>';
  $('#saved-modal-list').innerHTML = state.saved.length ? state.saved.map(savedItem).join('') : empty;
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation(); state.saved.splice(Number(button.dataset.delete), 1); saveSaved(); toast('Parcours supprimé.');
  }));
  document.querySelectorAll('.saved-item').forEach((item, index) => item.addEventListener('click', event => {
    if (event.target.closest('[data-delete]')) return;
    const route = state.saved[index]; if (!route?.origin || !route?.destination) return;
    if (route.mode) setMode(route.mode);
    $('#origin-input').value = route.originLabel || 'Point enregistré'; $('#destination-input').value = route.destinationLabel || 'Point enregistré';
    state.origin = route.origin; state.destination = route.destination; closeModal('saved-modal'); calculateRoute();
  }));
}
function saveSaved() { localStorage.setItem('ct_saved_routes', JSON.stringify(state.saved)); renderSaved(); }

function saveRoute() {
  if (!state.route) { toast('Aucun parcours à enregistrer.'); return; }
  state.saved.unshift({title: routeLabel(), distance: state.route.distanceMeters, savedAt: new Date().toISOString(), mode: state.mode, origin: state.origin, destination: state.destination, originLabel: $('#origin-input').value, destinationLabel: $('#destination-input').value});
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

function centerMap() {
  if (!state.map) { initializeMap(); return; }
  const point = state.lastPosition || state.origin;
  if (point) state.map.setView([point.lat, point.lon], Math.max(state.map.getZoom(), 14));
  else useCurrentLocation();
}

function setMode(mode) {
  state.mode = mode === 'moto' ? 'moto' : 'vtt';
  localStorage.setItem('ct_mode', state.mode);
  document.querySelectorAll('.mode-button').forEach(button => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.moto-only').forEach(node => node.classList.toggle('hidden', state.mode !== 'moto'));
  $('#mode-hint').textContent = state.mode === 'vtt' ? 'VTT · MTB' : 'MOTO · VALHALLA';
  $('#routing-note').textContent = state.mode === 'vtt'
    ? 'BRouter MTB privilégie les sentiers et itinéraires cyclables OSM, dont les RAVeL, et augmente le coût des routes. Vérifiez le niveau et l’accès.'
    : 'Valhalla favorise au maximum pistes et chemins accessibles aux motos, et pénalise les grands axes. Les données OSM peuvent être incomplètes.';
  $('#route-button span').textContent = `Calculer mon itinéraire ${state.mode === 'vtt' ? 'VTT' : 'moto'}`;
}

function beginMapPick(target) {
  state.mapPickTarget = target;
  initializeMap();
  $('#map-pick-label').textContent = target === 'origin' ? 'départ' : 'arrivée';
  $('#map-pick-hint').classList.remove('hidden');
  if (window.matchMedia('(max-width: 680px)').matches) $('#map').scrollIntoView({behavior: 'smooth', block: 'center'});
}

function exportGpx() {
  if (!state.route?.path?.length) { toast('Calculez un itinéraire avant de l’exporter.'); return; }
  const points = state.route.path.map(([lat, lon]) => `    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`).join('\n');
  const name = escapeHtml(`${state.mode === 'vtt' ? 'VTT' : 'Motocross'} - ${routeLabel()}`);
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Cross Travel" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>\n${points}\n  </trkseg></trk></gpx>`;
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
$('#use-location').addEventListener('click', useCurrentLocation);
$('#center-map').addEventListener('click', centerMap);
$('#start-navigation').addEventListener('click', startNavigation);
$('#stop-navigation').addEventListener('click', stopNavigation);
$('#voice-toggle').addEventListener('click', toggleVoice);
$('#save-route').addEventListener('click', saveRoute);
$('#saved-open').addEventListener('click', () => openModal('saved-modal'));
$('#saved-open-2').addEventListener('click', () => openModal('saved-modal'));
$('#help-open').addEventListener('click', () => openModal('help-modal'));
document.querySelectorAll('.mode-button').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => beginMapPick(button.dataset.pick)));
$('#cancel-map-pick').addEventListener('click', () => { state.mapPickTarget = null; $('#map-pick-hint').classList.add('hidden'); });
$('#export-gpx').addEventListener('click', exportGpx);
attachAddressSearch('origin'); attachAddressSearch('destination');
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
window.addEventListener('online', () => { $('#connection-label').textContent = 'En ligne'; });
window.addEventListener('offline', () => { $('#connection-label').textContent = 'Hors ligne'; });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.watchId !== null && 'wakeLock' in navigator && !state.wakeLock) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
});

renderSaved();
setMode(state.mode);
updateVoiceButton();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
initializeMap();
