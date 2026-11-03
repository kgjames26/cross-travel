const $ = (selector) => document.querySelector(selector);
const DEFAULT_ROUTER = 'https://valhalla1.openstreetmap.de/route';
const state = {
  map: null, tileLayer: null, route: null, routeLayer: null, stepLayers: [], markers: [],
  origin: null, destination: null, currentStep: 0, watchId: null, wakeLock: null,
  lastPosition: null, navigationMarker: null, rerouting: false, lastRerouteAt: 0,
  lastGeocodeAt: 0, routeServer: localStorage.getItem('ct_route_server') || DEFAULT_ROUTER,
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
    if (!state.origin) {
      state.origin = point; $('#origin-input').value = 'Point choisi sur la carte';
      toast('Départ choisi. Touchez la carte pour choisir l’arrivée.');
    } else if (!state.destination) {
      state.destination = point; $('#destination-input').value = 'Point choisi sur la carte';
      toast('Arrivée choisie. Lancez le calcul.');
    } else {
      state.destination = point; $('#destination-input').value = 'Point choisi sur la carte';
      toast('Point d’arrivée déplacé.');
    }
  });
  requestAnimationFrame(() => state.map.invalidateSize());
  return true;
}

async function geocodeAddress(query) {
  const wait = Math.max(0, 1100 - (Date.now() - state.lastGeocodeAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  const params = new URLSearchParams({q: query, format: 'jsonv2', limit: '1', 'accept-language': 'fr'});
  state.lastGeocodeAt = Date.now();
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!response.ok) throw new Error(`Recherche OSM indisponible (${response.status}).`);
  const results = await response.json();
  if (!results.length) throw new Error(`Adresse introuvable : ${query}`);
  return {lat: Number(results[0].lat), lon: Number(results[0].lon), label: results[0].display_name};
}

async function resolvePoint(input, point) {
  if (point) return point;
  const query = input.value.trim();
  if (!query) throw new Error('Renseignez le départ et l’arrivée.');
  const result = await geocodeAddress(query);
  input.value = result.label;
  return {lat: result.lat, lon: result.lon};
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

async function calculateRoute(fromOverride = null, toOverride = null) {
  const button = $('#route-button'); button.disabled = true;
  button.querySelector('span').textContent = 'Calcul en cours…';
  try {
    if (!initializeMap()) throw new Error('La carte est indisponible.');
    const origin = fromOverride || await resolvePoint($('#origin-input'), state.origin);
    const destination = toOverride || await resolvePoint($('#destination-input'), state.destination);
    state.origin = origin; state.destination = destination;
    const trailPreference = $('#favor-trails').checked ? 0.82 : 0.05;
    const highwayPreference = $('#avoid-highways').checked ? 0.08 : 0.5;
    const tollPreference = $('#avoid-tolls').checked ? 0 : 0.5;
    const response = await fetch(state.routeServer, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Client-Id': 'cross-travel (github.com/kgjames26/cross-travel)'},
      body: JSON.stringify({
        locations: [{lat: origin.lat, lon: origin.lon, type: 'break'}, {lat: destination.lat, lon: destination.lon, type: 'break'}],
        costing: 'motorcycle',
        costing_options: {motorcycle: {use_highways: highwayPreference, use_trails: trailPreference, use_tolls: tollPreference}},
        directions_options: {units: 'kilometers', language: 'fr-FR'},
        shape_format: 'geojson'
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.status_message || `Erreur du moteur Valhalla (${response.status}).`);
    state.route = normalizeValhalla(payload);
    state.currentStep = 0;
    drawRoute(); showRoute();
    $('#map-mode-label').textContent = 'OSM · PROFIL MOTO · PISTES FAVORISÉES';
    if (fromOverride) toast('Itinéraire recalculé depuis votre position.');
  } catch (error) {
    toast(error.message || 'Le calcul a échoué. Vérifiez le serveur et la connexion.');
  } finally {
    button.disabled = false; button.querySelector('span').textContent = 'Calculer mon itinéraire';
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

function updateNavigation(position) {
  if (!state.route || !state.map) return;
  const point = {lat: position.coords.latitude, lon: position.coords.longitude};
  state.lastPosition = point;
  const steps = state.route.legs[0]?.steps || [];
  let step = currentStep();
  if (!step) return;
  let distance = state.map.distance([point.lat, point.lon], [step.endLocation.lat, step.endLocation.lon]);
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
    toast('Écart détecté. Recalcul du parcours moto.');
    calculateRoute(point, state.destination).finally(() => { state.rerouting = false; });
  }
}

async function startNavigation() {
  if (!state.route) { toast('Calculez d’abord un itinéraire.'); return; }
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible sur cet appareil.'); return; }
  $('#nav-panel').classList.remove('hidden');
  $('#map-mode-label').textContent = 'NAVIGATION MOTO ACTIVE';
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
  if (state.wakeLock) { try { await state.wakeLock.release(); } catch {} state.wakeLock = null; }
  $('#nav-panel').classList.add('hidden'); $('#map-mode-label').textContent = 'OSM · ROUTE MOTO';
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
    $('#origin-input').value = route.originLabel || 'Point enregistré'; $('#destination-input').value = route.destinationLabel || 'Point enregistré';
    state.origin = route.origin; state.destination = route.destination; closeModal('saved-modal'); calculateRoute();
  }));
}
function saveSaved() { localStorage.setItem('ct_saved_routes', JSON.stringify(state.saved)); renderSaved(); }

function saveRoute() {
  if (!state.route) { toast('Aucun parcours à enregistrer.'); return; }
  state.saved.unshift({title: routeLabel(), distance: state.route.distanceMeters, savedAt: new Date().toISOString(), origin: state.origin, destination: state.destination, originLabel: $('#origin-input').value, destinationLabel: $('#destination-input').value});
  state.saved = state.saved.slice(0, 20); saveSaved(); toast('Parcours enregistré sur cet appareil.');
}

function useCurrentLocation() {
  if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible.'); return; }
  navigator.geolocation.getCurrentPosition(position => {
    state.origin = {lat: position.coords.latitude, lon: position.coords.longitude};
    $('#origin-input').value = 'Ma position actuelle';
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
$('#save-route').addEventListener('click', saveRoute);
$('#saved-open').addEventListener('click', () => openModal('saved-modal'));
$('#saved-open-2').addEventListener('click', () => openModal('saved-modal'));
$('#help-open').addEventListener('click', () => openModal('help-modal'));
$('#origin-input').addEventListener('input', () => { state.origin = null; });
$('#destination-input').addEventListener('input', () => { state.destination = null; });
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
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
initializeMap();
