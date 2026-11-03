const $ = (selector) => document.querySelector(selector);
const DEFAULT_ROUTER = 'https://valhalla1.openstreetmap.de/route';
const BROUTER_URL = 'https://brouter.de/brouter';
const state = {
  map: null, tileLayer: null, streetLayer: null, satelliteLayer: null, mapStyle: localStorage.getItem('ct_map_style') || "osm", satelliteErrors: 0, satelliteLoaded: false, satelliteLoadTimer: null, route: null, routeLayer: null, stepLayers: [], markers: [],
  origin: null, destination: null, currentStep: 0, watchId: null, wakeLock: null,
  lastPosition: null, navigationMarker: null, rerouting: false, lastRerouteAt: 0,
  lastGeocodeAt: 0, routeServer: localStorage.getItem('ct_route_server') || DEFAULT_ROUTER,
  mode: localStorage.getItem('ct_mode') || 'vtt', mapPickTarget: null,
  voiceEnabled: localStorage.getItem('ct_voice_enabled') !== 'false', lastSpokenStep: -1,
  distanceTravelledMeters: 0, movingDistanceMeters: 0, movingSeconds: 0,
  currentSpeedKmh: 0, previousGpsSample: null, routeStartDistanceTravelled: 0, lastHeading: null, lastMapBearing: 0,
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
  if (typeof state.map?.setBearing !== 'function') return;
  const reported = position.coords.heading;
  let heading = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? reported : null;
  if (heading === null && state.previousGpsSample && state.currentSpeedKmh >= 3) {
    const a = state.previousGpsSample.point, b = {lat: position.coords.latitude, lon: position.coords.longitude};
    const radians = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * radians) * Math.cos(b.lat * radians);
    const x = Math.cos(a.lat * radians) * Math.sin(b.lat * radians) - Math.sin(a.lat * radians) * Math.cos(b.lat * radians) * Math.cos((b.lon - a.lon) * radians);
    heading = (Math.atan2(y, x) / radians + 360) % 360;
  }
  if (heading === null || state.currentSpeedKmh < 1.5) return;
  const difference = ((heading - state.lastMapBearing + 540) % 360) - 180;
  if (Math.abs(difference) < 4) return;
  state.lastMapBearing = (state.lastMapBearing + difference * 0.35 + 360) % 360;
  state.map.setBearing(state.lastMapBearing);
}
function initializeMap() {
  if (state.map) { state.map.invalidateSize(); return true; }
  if (!window.L) { toast('La bibliothèque de carte n’a pas pu se charger. Réessayez avec une connexion active.'); return false; }
  $('.map-panel').classList.add('map-ready');
  state.map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true, rotate: true, bearing: 0, touchRotate: false })
    .setView([50.337, 4.52], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
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
  const params = new URLSearchParams({
    lonlats: `${origin.lon},${origin.lat}|${destination.lon},${destination.lat}`,
    profile: 'mtb', alternativeidx: '0', format: 'geojson',
    'profile:path_preference': $('#favor-trails').checked ? '80' : '20',
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


async function requestRavelRoute(origin, destination) {
  const latPad = Math.max(0.035, Math.abs(destination.lat - origin.lat) * 0.08);
  const lonPad = Math.max(0.05, Math.abs(destination.lon - origin.lon) * 0.08);
  const south = Math.min(origin.lat, destination.lat) - latPad;
  const north = Math.max(origin.lat, destination.lat) + latPad;
  const west = Math.min(origin.lon, destination.lon) - lonPad;
  const east = Math.max(origin.lon, destination.lon) + lonPad;
  const bbox = `(${south},${west},${north},${east})`;
  const query = `[out:json][timeout:25];(relation["route"="bicycle"]["name"~"RAVeL",i]${bbox};relation["route"="bicycle"]["ref"~"RAVeL",i]${bbox};way["name"~"RAVeL",i]${bbox};way["ref"~"RAVeL",i]${bbox};);(._;>;);out body;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body: 'data=' + encodeURIComponent(query), signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La recherche du réseau RAVeL a expiré. Réessayez avec une zone plus proche.');
    throw new Error('Le réseau RAVeL OpenStreetMap est momentanément inaccessible.');
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`Recherche RAVeL indisponible (${response.status}).`);
  const payload = await response.json();
  const elements = payload.elements || [];
  const relations = elements.filter(item => item.type === 'relation' && item.tags?.route === 'bicycle' && /ravel/i.test((item.tags?.name || '') + ' ' + (item.tags?.ref || '')));
  const relationWays = new Set(relations.flatMap(item => (item.members || []).filter(member => member.type === 'way').map(member => member.ref)));
  const nodes = new Map(elements.filter(item => item.type === 'node').map(item => [item.id, [item.lat, item.lon]]));
  const ways = elements.filter(item => {
    if (item.type !== 'way' || !Array.isArray(item.nodes)) return false;
    const tags = item.tags || {};
    const namedRavel = /ravel/i.test((tags.name || '') + ' ' + (tags.ref || ''));
    const onRavelRelation = relationWays.has(item.id);
    const bikeWay = ['cycleway','path','track','pedestrian','footway'].includes(tags.highway);
    return (namedRavel || onRavelRelation) && bikeWay &&
      !['no','private'].includes(tags.access) && !['no','private'].includes(tags.bicycle);
  });
  if (!ways.length) throw new Error('Aucun tronçon RAVeL cartographié dans cette zone. Le mode familial ne propose pas de trajet par les routes.');
  const graph = new Map();
  const addEdge = (from, to, meters) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({id: to, meters});
  };
  for (const way of ways) {
    const tags = way.tags || {};
    const forwardOnly = tags.oneway === 'yes' && tags.bicycle !== 'no';
    const reverseOnly = tags.oneway === '-1';
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1], b = way.nodes[i];
      const pa = nodes.get(a), pb = nodes.get(b);
      if (!pa || !pb) continue;
      const meters = L.latLng(pa).distanceTo(L.latLng(pb));
      if (meters > 2000) continue;
      if (!reverseOnly) addEdge(a, b, meters);
      if (!forwardOnly) addEdge(b, a, meters);
    }
  }
  const nearestNode = point => {
    let best = null, bestMeters = Infinity;
    for (const id of graph.keys()) {
      const coords = nodes.get(id);
      if (!coords) continue;
      const meters = L.latLng(point.lat, point.lon).distanceTo(L.latLng(coords));
      if (meters < bestMeters) { best = id; bestMeters = meters; }
    }
    return {id: best, meters: bestMeters};
  };
  const start = nearestNode(origin), goal = nearestNode(destination);
  if (!start.id || !goal.id || start.meters > 1200 || goal.meters > 1200) {
    throw new Error('Départ ou arrivée trop éloigné du RAVeL cartographié (maximum 1,2 km). Choisissez un point sur le réseau RAVeL.');
  }
  const distances = new Map([[start.id, 0]]), previous = new Map(), heap = [{id: start.id, cost: 0}];
  const push = item => { heap.push(item); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p].cost <= item.cost) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1].cost < heap[c].cost) c++; if (heap[c].cost >= last.cost) break; heap[i] = heap[c]; i = c; } heap[i] = last; }
    return first;
  };
  while (heap.length) {
    const current = pop();
    if (current.cost !== distances.get(current.id)) continue;
    if (current.id === goal.id) break;
    for (const edge of graph.get(current.id) || []) {
      const next = current.cost + edge.meters;
      if (next < (distances.get(edge.id) ?? Infinity)) {
        distances.set(edge.id, next); previous.set(edge.id, current.id); push({id: edge.id, cost: next});
      }
    }
  }
  if (!distances.has(goal.id)) throw new Error('Aucun parcours RAVeL continu ne relie ces points. Aucune route ordinaire ne sera ajoutée.');
  const ids = [goal.id];
  while (ids[0] !== start.id) { const parent = previous.get(ids[0]); if (parent === undefined) throw new Error('Le tracé RAVeL est discontinu dans OpenStreetMap.'); ids.unshift(parent); }
  const path = ids.map(id => nodes.get(id)).filter(Boolean);
  if (path.length < 2) throw new Error('Choisissez deux points distincts sur le réseau RAVeL.');
  let distanceMeters = 0, cumulative = [0];
  for (let i = 1; i < path.length; i++) { distanceMeters += L.latLng(path[i-1]).distanceTo(L.latLng(path[i])); cumulative[i] = distanceMeters; }
  const bearing = (a,b) => { const rad=v=>v*Math.PI/180, y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0])), x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1])); return (Math.atan2(y,x)*180/Math.PI+360)%360; };
  const steps=[]; let previousIndex=0, lastTurn=0;
  for(let i=3;i<path.length-3;i++){
    if(cumulative[i]-lastTurn<180) continue;
    const delta=((bearing(path[i-3],path[i+3])-bearing(path[i-3],path[i])+540)%360)-180;
    if(Math.abs(delta)<55) continue;
    steps.push({instructions:delta>0?'Suivez le RAVeL en tournant à droite':'Suivez le RAVeL en tournant à gauche',distanceMeters:cumulative[i]-cumulative[previousIndex],endLocation:{lat:path[i][0],lon:path[i][1]},path:path.slice(previousIndex,i+1)});
    previousIndex=i; lastTurn=cumulative[i];
  }
  const end=path.at(-1);
  steps.push({instructions:'Continuez sur le RAVeL jusqu’à l’arrivée',distanceMeters:distanceMeters-cumulative[previousIndex],endLocation:{lat:end[0],lon:end[1]},path:path.slice(previousIndex)});
  return {path,distanceMeters,durationSeconds:distanceMeters/1000/14*3600,legs:[{steps}]};
}

async function calculateRoute(fromOverride = null, toOverride = null) {
  const button = $('#route-button'); button.disabled = true;
  button.querySelector('span').textContent = 'Calcul en cours…';
  try {
    if (!initializeMap()) throw new Error('La carte est indisponible.');
    const origin = fromOverride || await resolvePoint($('#origin-input'), state.origin);
    const destination = toOverride || await resolvePoint($('#destination-input'), state.destination);
    state.origin = origin; state.destination = destination;
    if (state.mode === 'family') {
      state.route = await requestRavelRoute(origin, destination);
    } else if (state.mode === 'vtt') {
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
          costing_options: {motorcycle: {use_highways: highwayPreference, use_trails: trailPreference, use_tracks: trackPreference, use_living_streets: preferPaths ? 0 : 0.5, use_tolls: tollPreference}},
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
    state.routeStartDistanceTravelled = state.distanceTravelledMeters;
    drawRoute(); showRoute();
    $('#map-mode-label').textContent = state.mode === 'family' ? 'OSM · RAVeL EXCLUSIF' : state.mode === 'vtt' ? 'OSM · BROUTER · PROFIL VTT' : 'OSM · VALHALLA · PROFIL MOTO';
    $('#route-alert-text').textContent = state.mode === 'family'
      ? 'Vélo familial : tracé exclusivement sur les tronçons RAVeL cartographiés. Aucun tronçon routier de remplacement.'
      : state.mode === 'vtt'
        ? 'VTT : priorité renforcée aux sentiers, RAVeL et voies cyclables; les routes urbaines et axes fréquentés sont fortement pénalisés quand une alternative existe.'
        : 'Motocross : chemins accessibles aux motos favorisés, rues urbaines et grands axes évités autant que possible; vérifiez toujours signalisation et autorisations.';
    const wikilocQuery = encodeURIComponent(`${$('#origin-input').value} ${$('#destination-input').value} ${state.mode === 'family' ? 'vélo familial RAVeL' : state.mode === 'vtt' ? 'VTT' : 'enduro motocross'}`);
    $('#wikiloc-link').href = `https://www.wikiloc.com/search?query=${wikilocQuery}`;
    if (state.watchId !== null) {
      if (state.mode === 'moto') announceStep(0);
      else speakText(state.mode === 'family' ? 'Parcours RAVeL familial recalculé.' : 'Parcours VTT recalculé. Suivez le nouveau tracé.');
    }
    if (fromOverride) toast('Itinéraire recalculé depuis votre position.');
  } catch (error) {
    toast(error.message || 'Le calcul a échoué. Vérifiez le serveur et la connexion.');
  } finally {
    button.disabled = false; button.querySelector('span').textContent = state.mode === 'family' ? 'Calculer mon itinéraire familial' : `Calculer mon itinéraire ${state.mode === 'vtt' ? 'VTT' : 'moto'}`;
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
  const announcementIndex = state.mode === 'moto' ? state.currentStep + 1 : state.currentStep;
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
  if (state.navigationMarker) state.navigationMarker.setLatLng([point.lat, point.lon]);
  else state.navigationMarker = L.circleMarker([point.lat, point.lon], {radius: 8, color: '#fff', weight: 3, fillColor: '#86b83e', fillOpacity: 1}).addTo(state.map);
  if (state.map.getZoom() < 17) state.map.setZoom(18, {animate: false});
  state.map.panTo([point.lat, point.lon], {animate: false});
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
  document.body.classList.add('nav-active');
  $('#map-mode-label').textContent = 'NAVIGATION ' + (state.mode === 'family' ? 'RAVeL FAMILIAL' : state.mode === 'vtt' ? 'VTT' : 'MOTOCROSS') + ' ACTIVE';
  $('#nav-mode-pill').textContent = (state.mode === 'family' ? 'VÉLO FAMILIAL · RAVeL EXCLUSIF' : state.mode === 'vtt' ? 'VTT' : 'MOTOCROSS / ENDURO') + ' · GPS ACTIF';
  $('#nav-rider-image').src = state.mode === 'family' ? 'assets/velo-familial.webp' : state.mode === 'vtt' ? 'assets/vtt-dynamique.webp' : 'assets/motocross-calme.webp';
  state.distanceTravelledMeters = 0; state.movingDistanceMeters = 0; state.movingSeconds = 0;
  state.currentSpeedKmh = 0; state.previousGpsSample = null; state.routeStartDistanceTravelled = 0;
  state.lastSpokenStep = -1;
  if (state.mode === 'moto') announceStep(0);
  else speakText(state.mode === 'family' ? 'Navigation vélo familial démarrée. Suivez le RAVeL.' : 'Navigation VTT démarrée. Suivez le tracé.');
  if ('wakeLock' in navigator) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); }
    catch { toast('Le maintien de l’écran n’a pas été autorisé par l’appareil.'); }
  }
  state.watchId = navigator.geolocation.watchPosition(updateNavigation, error => {
    $('#nav-gps-status').textContent = 'GPS indisponible';
    toast('GPS : ' + error.message);
  }, {enableHighAccuracy: true, maximumAge: 2000, timeout: 15000});
  toast('Navigation active. Ne manipulez pas l’écran en roulant.');
}
async function stopNavigation() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  document.body.classList.remove('nav-active');
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.wakeLock) { try { await state.wakeLock.release(); } catch {} state.wakeLock = null; }
  $('#nav-panel').classList.add('hidden'); $('#map-mode-label').textContent = state.mode === 'family' ? 'OSM · RAVeL EXCLUSIF' : `OSM · ROUTE ${state.mode === 'vtt' ? 'VTT' : 'MOTO'}`;
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
  state.mode = mode === 'moto' ? 'moto' : mode === 'family' ? 'family' : 'vtt';
  localStorage.setItem('ct_mode', state.mode);
  document.querySelectorAll('.mode-button').forEach(button => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.moto-only').forEach(node => node.classList.toggle('hidden', state.mode !== 'moto'));
  $('#favor-trails-row').classList.toggle('hidden', state.mode === 'family');
  $('#mode-hint').textContent = state.mode === 'family' ? 'RAVeL · EXCLUSIF' : state.mode === 'vtt' ? 'VTT · MTB' : 'MOTO · VALHALLA';
  $('#routing-note').textContent = state.mode === 'family'
    ? 'Vélo familial : uniquement les tronçons RAVeL identifiés dans OpenStreetMap. Pas de route de remplacement; les points doivent rejoindre le réseau.'
    : state.mode === 'vtt'
      ? 'VTT : priorité forte aux sentiers et RAVeL; les routes de centre-ville sont pénalisées pour chercher un détour praticable.'
      : 'Motocross : priorité maximale aux pistes et chemins ouverts aux motos; grands axes et rues urbaines sont pénalisés, quitte à rallonger le trajet.';
  $('#route-button span').textContent = state.mode === 'family' ? 'Calculer mon itinéraire familial' : `Calculer mon itinéraire ${state.mode === 'vtt' ? 'VTT' : 'moto'}`;
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
