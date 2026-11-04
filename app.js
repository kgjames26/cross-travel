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
  mode: localStorage.getItem('ct_mode') || 'vtt', language: localStorage.getItem('ct_language') || 'fr', units: localStorage.getItem('ct_units') || 'metric', mapPickTarget: null, manualMode: false, manualReturnToStart: false, manualDestinationLocked: false, manualPoints: [], manualLegs: [], manualMarkers: [], manualLine: null, manualController: null, manualRoutingVersion: 0,
  seekIntense: localStorage.getItem('ct_seek_intense') === 'true',
  familyFast: localStorage.getItem('ct_family_fast') === 'true',
  voiceEnabled: localStorage.getItem('ct_voice_enabled') !== 'false', lastSpokenStep: -1,
  distanceTravelledMeters: 0, movingDistanceMeters: 0, movingSeconds: 0,
  currentSpeedKmh: 0, previousGpsSample: null, routeStartDistanceTravelled: 0, lastHeading: null, lastMapBearing: 0, navigationHeading: null, lastNavigationZoomAt: 0, navigationFollow: true, programmaticNavigationZoom: false,
  searchTimers: {}, searchControllers: {}, suggestions: {origin: [], destination: []},
  navigationAvoids: [], navigationViaPoints: [], navigationSegments: [], navigationManualRoute: false, navigationProgress: 0, navigationDetour: null, navigationPointLayers: [], navigationRerouteController: null, navigationRerouteVersion: 0,
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
    lastPosition: state.lastPosition, currentStep: state.currentStep, navigationProgress: state.navigationProgress,
    distanceTravelledMeters: state.distanceTravelledMeters, movingDistanceMeters: state.movingDistanceMeters,
    movingSeconds: state.movingSeconds, routeStartDistanceTravelled: state.routeStartDistanceTravelled,
    manualPoints: state.manualPoints, manualLegs: state.manualLegs, manualReturnToStart: state.manualReturnToStart, manualDestinationLocked: state.manualDestinationLocked, navigationDetour: state.navigationDetour,
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
function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat(LANGUAGE_LOCALES[state.language] || 'fr-BE', {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(value);
}
function formatDistance(meters) {
  const distance = Math.max(0, Number(meters) || 0);
  if (state.units === 'imperial') {
    const miles = distance / 1609.344;
    return formatNumber(miles, miles < 10 ? 2 : 1) + ' mi';
  }
  const kilometers = distance / 1000;
  return formatNumber(kilometers, kilometers < 10 ? 2 : 1) + ' km';
}
function formatProximity(meters) {
  const distance = Math.max(0, Number(meters) || 0);
  if (state.units === 'imperial') return distance < 1609.344 ? formatNumber(distance / 0.3048, 0) + ' ft' : formatDistance(distance);
  return distance < 1000 ? formatNumber(distance, 0) + ' m' : formatDistance(distance);
}
function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
function toMeters(kilometers) { return Number(kilometers || 0) * 1000; }
function routeLabel() { return `${$('#origin-input').value.trim()} → ${$('#destination-input').value.trim()}`; }
const LANGUAGE_LOCALES = {fr: 'fr-BE', en: 'en-US', zh: 'zh-CN', hi: 'hi-IN', es: 'es-ES', ar: 'ar'};
const I18N_ROWS = [
 ['Cross Travel — vélo familial, VTT & motocross','Cross Travel — family cycling, trail cycling & motocross','Cross Travel — 家庭骑行、山地车与越野摩托','Cross Travel — पारिवारिक साइकिल, माउंटेन बाइक और मोटोक्रॉस','Cross Travel — ciclismo familiar, ciclismo de montaña y motocross','Cross Travel — دراجات عائلية وجبلية وموتوكروس'],
 ['En ligne','Online','在线','ऑनलाइन','En línea','متصل'],['Hors ligne','Offline','离线','ऑफ़लाइन','Sin conexión','غير متصل'],
 ['QUATRE FAÇONS DE PRENDRE LA ROUTE','FOUR WAYS TO RIDE','四种出行方式','सवारी के चार तरीके','CUATRO FORMAS DE RODAR','أربع طرق للانطلاق'],
 ['Du bitume à la terre,','From tarmac to trail,','从柏油路到土路，','पक्की सड़क से कच्चे रास्ते तक,','Del asfalto a la tierra,','من الإسفلت إلى الطرق الترابية،'],
 ['trouvez votre itinéraire','find your route','找到你的路线','अपना रास्ता खोजें','encuentra tu ruta','اعثر على مسارك'],
 ['PLANIFICATEUR','ROUTE PLANNER','路线规划','मार्ग योजनाकार','PLANIFICADOR','مخطط المسار'],['Créer un itinéraire','Plan a route','创建路线','मार्ग बनाएँ','Crear una ruta','أنشئ مسارًا'],
 ['Départ','Start','出发点','प्रस्थान','Salida','الانطلاق'],['Arrivée','Finish','终点','आगमन','Llegada','الوصول'],['Pratique','Activity','运动方式','गतिविधि','Actividad','النشاط'],
 ['Vélo familial','Family cycling','家庭骑行','पारिवारिक साइकिल','Ciclismo familiar','دراجة عائلية'],['RAVeL & chemins','Greenways & trails','绿道与小径','ग्रीनवे और पगडंडियाँ','Vías verdes y caminos','المسارات الخضراء والدروب'],
 ['Vélo de route','Road cycling','公路骑行','रोड साइकिलिंग','Ciclismo de carretera','دراجة طريق'],['Rapide & roulant','Fast & smooth','快速平顺','तेज़ और सुगम','Rápido y fluido','سريع وسلس'],
 ['VTT','Trail cycling','山地车','माउंटेन बाइक','Bicicleta de montaña','دراجة جبلية'],['Chemins & pistes','Trails & tracks','小径与山道','पगडंडियाँ और ट्रैक','Caminos y senderos','الدروب والمسارات'],
 ['Motocross','Motocross','越野摩托','मोटोक्रॉस','Motocross','موتوكروس'],['Petites routes','Quiet roads','小路','शांत सड़कें','Carreteras tranquilas','طرق هادئة'],
 ['Trajet le plus rapide','Fastest route','最快路线','सबसे तेज़ मार्ग','Ruta más rápida','أسرع مسار'],['GRANDS AXES ÉVITÉS','AVOID MAIN ROADS','避开主干道','मुख्य सड़कों से बचें','EVITAR VÍAS PRINCIPALES','تجنب الطرق الرئيسية'],
 ['Priorité aux chemins et pistes','Trails and tracks first','优先选择小径与山道','पहले पगडंडियाँ और ट्रैक','Prioridad a caminos y senderos','الأولوية للدروب والمسارات'],
 ['SELON ACCÈS','WHERE ACCESSIBLE','依通行权限','जहाँ पहुँच संभव हो','SEGÚN ACCESO','بحسب السماح بالدخول'],
 ['Parcours sensations','Adventure route','刺激路线','रोमांचक मार्ग','Ruta de aventura','مسار مليء بالإثارة'],['DÉTOURS ACCEPTÉS','DETOURS OK','接受绕行','वैकल्पिक रास्ते स्वीकार्य','SE ACEPTAN DESVÍOS','التحويلات مقبولة'],
 ['Calculer mon itinéraire','Calculate my route','计算路线','मेरा मार्ग निकालें','Calcular mi ruta','احسب مساري'],
 ['Tracer manuellement sur la carte','Draw manually on the map','在地图上手动绘制','नक्शे पर स्वयं बनाएँ','Dibujar manualmente en el mapa','ارسم المسار يدويًا على الخريطة'],
 ['ITINÉRAIRE CALCULÉ','ROUTE READY','路线已计算','मार्ग तैयार','RUTA CALCULADA','المسار جاهز'],['Votre parcours','Your route','你的路线','आपका मार्ग','Tu ruta','مسارك'],
 ['＋ Enregistrer','＋ Save','＋ 保存','＋ सहेजें','＋ Guardar','＋ حفظ'],['Démarrer la navigation','Start navigation','开始导航','नेविगेशन शुरू करें','Iniciar navegación','ابدأ التنقل'],
 ['DISTANCE','DISTANCE','距离','दूरी','DISTANCIA','المسافة'],['DURÉE ESTIMÉE','ESTIMATED TIME','预计时长','अनुमानित समय','DURACIÓN ESTIMADA','المدة المقدرة'],['ÉTAPES','STEPS','步骤','चरण','ETAPAS','المراحل'],
 ['Exporter GPX · OsmAnd','Export GPX · OsmAnd','导出 GPX · OsmAnd','GPX निर्यात · OsmAnd','Exportar GPX · OsmAnd','تصدير GPX · OsmAnd'],['Chercher sur Wikiloc ↗','Search Wikiloc ↗','在 Wikiloc 搜索 ↗','Wikiloc पर खोजें ↗','Buscar en Wikiloc ↗','ابحث في Wikiloc ↗'],
 ['VOS REPÈRES','YOUR SAVED ROUTES','已保存路线','आपके सहेजे मार्ग','TUS RUTAS','مساراتك المحفوظة'],['Parcours enregistrés','Saved routes','已保存路线','सहेजे गए मार्ग','Rutas guardadas','المسارات المحفوظة'],
 ['Vos itinéraires favoris apparaîtront ici.','Your saved routes will appear here.','已保存的路线会显示在这里。','आपके सहेजे गए रास्ते यहाँ दिखेंगे।','Tus rutas guardadas aparecerán aquí.','ستظهر مساراتك المحفوظة هنا.'],
 ['Respectez la signalisation et les accès locaux. Une voie ouverte au VTT peut être interdite aux motos.','Follow local signs and access rules. A trail open to mountain bikes may be closed to motorcycles.','请遵守当地标志和通行规定。山地车可通行的路段可能禁止摩托车。','स्थानीय संकेतों और पहुँच नियमों का पालन करें। माउंटेन बाइक के लिए खुला रास्ता मोटरसाइकिल के लिए बंद हो सकता है।','Respeta las señales y los accesos locales. Un camino abierto a bicicleta de montaña puede estar cerrado a motos.','احترم الإشارات وقواعد الدخول المحلية. قد يُسمح بالدراجة الجبلية ويُمنع بالدراجة النارية.'],
 ['Votre terrain de jeu commence ici','Your next ride starts here','你的探索之旅从这里开始','आपकी सवारी यहीं से शुरू होती है','Tu próxima aventura empieza aquí','تبدأ مغامرتك هنا'],
 ['Chargement de la carte OpenStreetMap…','Loading OpenStreetMap…','正在加载 OpenStreetMap 地图…','OpenStreetMap लोड हो रहा है…','Cargando OpenStreetMap…','جارٍ تحميل خريطة OpenStreetMap…'],['Réessayer','Try again','重试','फिर कोशिश करें','Reintentar','حاول مجددًا'],
 ['CARTE DE REPÉRAGE','ROUTE MAP','路线地图','मार्ग का नक्शा','MAPA DE RUTA','خريطة المسار'],['Satellite','Satellite','卫星图','उपग्रह','Satélite','قمر صناعي'],
 ['Mode tracé manuel actif · touchez la carte pour ajouter une étape.','Manual drawing is active · tap the map to add a stop.','手动绘制已开启 · 点击地图添加途经点。','मैन्युअल ड्राइंग चालू है · पड़ाव जोड़ने के लिए नक्शे पर टैप करें。','Trazado manual activo · toca el mapa para añadir una etapa.','الرسم اليدوي نشط · اضغط على الخريطة لإضافة نقطة.'],
 ['Terminer','Finish','完成','समाप्त','Terminar','إنهاء'],['NAVIGATION ACTIVE','NAVIGATION ACTIVE','导航进行中','नेविगेशन सक्रिय','NAVEGACIÓN ACTIVA','التنقل نشط'],['Voix activée','Voice on','语音已开启','आवाज़ चालू','Voz activada','الصوت مفعّل'],
 ['Annuler le détour','Cancel detour','取消绕行','वैकल्पिक रास्ता रद्द करें','Cancelar desvío','إلغاء التحويلة'],['PROCHAINE INSTRUCTION','NEXT INSTRUCTION','下一条指示','अगला निर्देश','SIGUIENTE INDICACIÓN','التوجيه التالي'],
 ['Suivez le parcours','Follow the route','沿路线前行','मार्ग का अनुसरण करें','Sigue la ruta','اتبع المسار'],['En attente du GPS','Waiting for GPS','等待 GPS','GPS की प्रतीक्षा','Esperando GPS','بانتظار GPS'],
 ['VITESSE INSTANTANÉE','CURRENT SPEED','当前速度','वर्तमान गति','VELOCIDAD ACTUAL','السرعة الحالية'],['km/h','km/h','公里/小时','किमी/घंटा','km/h','كم/س'],['mph','mph','英里/小时','मील/घंटा','mph','ميل/س'],
 ['Analyse de votre vitesse…','Measuring your speed…','正在分析速度…','गति का विश्लेषण…','Analizando tu velocidad…','جارٍ تحليل السرعة…'],['PARCOURU','TRAVELLED','已行驶','तय दूरी','RECORRIDO','المقطوع'],
 ['RESTANT','REMAINING','剩余','शेष','RESTANTE','المتبقي'],['HEURE D’ARRIVÉE ESTIMÉE','ESTIMATED ARRIVAL','预计到达时间','अनुमानित आगमन','HORA ESTIMADA DE LLEGADA','وقت الوصول المتوقع'],
 ['Calcul en cours','Calculating','计算中','गणना जारी','Calculando','جارٍ الحساب'],['Recherche du GPS','Searching for GPS','正在搜索 GPS','GPS खोज रहे हैं','Buscando GPS','جارٍ البحث عن GPS'],
 ['Parcours calculé','Route calculated','路线已计算','मार्ग की गणना हुई','Ruta calculada','تم حساب المسار'],['Statut d’accès non vérifié','Access not verified','通行状态未核实','पहुँच की पुष्टि नहीं हुई','Acceso no verificado','لم يتم التحقق من السماح بالدخول'],
 ['Planifiez prudemment. Roulez responsablement.','Plan carefully. Ride responsibly.','谨慎规划，安全骑行。','सावधानी से योजना बनाएँ। ज़िम्मेदारी से चलाएँ।','Planifica con cuidado. Conduce con responsabilidad.','خطط بحذر وقد بأمان.'],['À propos & limites','About & limitations','关于与限制','जानकारी और सीमाएँ','Acerca de y límites','حول التطبيق والقيود'],
 ['CONFIGURATION','SETTINGS','设置','सेटिंग्स','CONFIGURACIÓN','الإعدادات'],['Moteur d’itinéraire OSM','OSM routing engine','OSM 路线引擎','OSM मार्ग इंजन','Motor de rutas OSM','محرك توجيه OSM'],
 ['Langue','Language','语言','भाषा','Idioma','اللغة'],['Unités','Units','单位','इकाइयाँ','Unidades','الوحدات'],['Métrique','Metric','公制','मीट्रिक','Métrico','متري'],['Impérial','Imperial','英制','इम्पीरियल','Imperial','إمبراطوري'],
 ['Ex. 5 km et 500 m','E.g. 5 km and 500 m','例如：5 km 和 500 m','उदाहरण: 5 km और 500 m','Ej.: 5 km y 500 m','مثال: 5 km و500 m'],
 ['Ex. 3,1 mi et 1 640 ft','E.g. 3.1 mi and 1,640 ft','例如：3.1 mi 和 1,640 ft','उदाहरण: 3.1 mi और 1,640 ft','Ej.: 3,1 mi y 1.640 ft','مثال: 3.1 mi و1,640 ft'],
 ['Annuler','Cancel','取消','रद्द करें','Cancelar','إلغاء'],['Enregistrer','Save','保存','सहेजें','Guardar','حفظ'],
 ['Moyenne roulée','Moving average','行驶平均速度','चलती औसत','Media en marcha','متوسط السرعة أثناء الحركة'],['En mouvement','Moving','行驶中','चल रहे हैं','En movimiento','متحرك'],['À l’arrêt','Stopped','已停下','रुके हुए','Parado','متوقف'],
 ['Calculer mon itinéraire familial','Calculate my family route','计算家庭路线','पारिवारिक मार्ग निकालें','Calcular mi ruta familiar','احسب مسار العائلة'],
 ['Calculer l’itinéraire rapide','Calculate the fastest route','计算最快路线','सबसे तेज़ मार्ग निकालें','Calcular la ruta más rápida','احسب أسرع مسار'],
 ['Calculer mon itinéraire moto','Calculate my motorcycle route','计算摩托车路线','मोटरसाइकिल मार्ग निकालें','Calcular mi ruta en moto','احسب مسار الدراجة النارية'],
 ['Calculer mon itinéraire VTT','Calculate my trail cycling route','计算山地车路线','माउंटेन बाइक मार्ग निकालें','Calcular mi ruta de montaña','احسب مسار الدراجة الجبلية'],
 ['VÉLO FAMILIAL · RAPIDE','FAMILY BIKE · FAST','家庭骑行 · 快速','पारिवारिक साइकिल · तेज़','BICI FAMILIAR · RÁPIDA','دراجة عائلية · سريع'],
 ['RAVeL · PENTES DOUCES','GREENWAY · GENTLE SLOPES','绿道 · 缓坡','ग्रीनवे · हल्की ढलान','VÍA VERDE · PENDIENTES SUAVES','مسار أخضر · منحدرات لطيفة'],
 ['ROUTES · RAPIDE','ROAD · FAST','公路 · 快速','सड़क · तेज़','CARRETERA · RÁPIDA','طريق · سريع'],
 ['VTT · SENSATIONS','TRAIL CYCLING · ADVENTURE','山地车 · 冒险','माउंटेन बाइक · रोमांच','BICI DE MONTAÑA · AVENTURA','جبلية · إثارة'],
 ['VTT · CHEMINS','TRAIL CYCLING · TRAILS','山地车 · 小径','माउंटेन बाइक · पगडंडियाँ','BICI DE MONTAÑA · CAMINOS','جبلية · دروب'],
 ['MOTO · SENSATIONS','MOTO · ADVENTURE','摩托 · 冒险','मोटो · रोमांच','MOTO · AVENTURA','دراجة نارية · إثارة'],
 ['Vélo familial : RAVeL balisés prioritaires; voies cyclables en bord de route fortement pénalisées. Les routes ne servent qu’aux raccordements nécessaires.','Family cycling: marked greenways come first; roadside cycle lanes are strongly penalized. Roads are used only when needed to connect paths.','家庭骑行：优先选择标记绿道；大幅降低沿路自行车道优先级。仅在必要时使用道路连接。','पारिवारिक साइकिल: चिह्नित ग्रीनवे को प्राथमिकता; सड़क किनारे साइकिल लेन को बहुत कम प्राथमिकता। सड़क केवल जोड़ने के लिए।','Ciclismo familiar: prioridad a vías verdes señalizadas; se penalizan mucho los carriles junto a carreteras. Las carreteras solo sirven para conectar.','الدراجة العائلية: الأولوية للمسارات الخضراء؛ تُخفض أولوية المسارات المحاذية للطرق بشدة. تُستخدم الطرق للوصل فقط.'],
 ['Vélo de route : itinéraire le plus rapide possible sur routes adaptées et pistes cyclables, avec préférence pour les surfaces roulantes.','Road cycling: fastest practical route on suitable roads and cycle paths, favoring smooth surfaces.','公路骑行：在适宜道路和自行车道上选择最快路线，并优先平坦路面。','रोड साइकिल: उपयुक्त सड़कों और साइकिल पथों पर तेज़ मार्ग, चिकनी सतहों को प्राथमिकता।','Ciclismo de carretera: ruta rápida por carreteras adecuadas y carriles bici, con preferencia por superficies lisas.','دراجة الطريق: أسرع مسار عملي عبر الطرق المناسبة ومسارات الدراجات، مع تفضيل الأسطح السلسة.'],
 ['VTT sensations : les chemins plus engagés sont favorisés, avec des détours acceptés.','Trail cycling adventure: more technical trails are favored, with detours allowed.','山地车冒险：优先选择更具挑战的小径，可接受绕行。','माउंटेन बाइक रोमांच: अधिक तकनीकी पगडंडियों को प्राथमिकता, चक्कर स्वीकार्य।','Ciclismo de montaña: aventura: prioridad a senderos más técnicos; se aceptan desvíos.','جبلية إثارة: تُفضّل الدروب الأكثر تحديًا مع قبول التحويلات.'],
 ['VTT : priorité forte aux sentiers et RAVeL; les routes de centre-ville sont pénalisées.','Mountain biking: strong preference for trails and greenways; city-center roads are penalized.','山地车：优先小径和绿道；降低市中心道路优先级。','माउंटेन बाइक: पगडंडियों और ग्रीनवे को प्राथमिकता; शहर की सड़कों से बचें।','Ciclismo de montaña: prioridad a senderos y vías verdes; se penalizan las calles céntricas.','جبلية: الأولوية للدروب والمسارات الخضراء؛ تُتجنب طرق وسط المدينة.'],
 ['Motocross homologuée : priorité maximale aux pistes et chemins moto-accessibles, détour accepté pour éviter les grands axes et les centres-villes.','Road-legal motocross: prioritize motorcycle-accessible tracks and trails; detours are allowed to avoid main roads and city centers.','合法上路的越野摩托：优先摩托可通行的小径和土路，可绕行以避开主干道和市中心。','पंजीकृत मोटोक्रॉस: मोटरसाइकिल के लिए खुले ट्रैक और रास्तों को प्राथमिकता; मुख्य सड़कों और शहरों से बचने हेतु चक्कर संभव।','Motocross homologada: prioridad a caminos accesibles en moto; se permiten desvíos para evitar vías principales y centros urbanos.','موتوكروس مرخصة: الأولوية للمسارات المتاحة للدراجات النارية؛ يُسمح بالتحويلات لتجنب الطرق الرئيسية ومراكز المدن.'],
 ['La carte utilise les tuiles OpenStreetMap. Le calcul moto passe par Valhalla, un moteur de routage fondé sur les données OSM.','The map uses OpenStreetMap tiles. Motorcycle routes use Valhalla, a routing engine based on OSM data.','地图使用 OpenStreetMap 瓦片。摩托车路线由基于 OSM 数据的 Valhalla 引擎计算。','नक्शा OpenStreetMap टाइल्स का उपयोग करता है। मोटरसाइकिल मार्ग OSM डेटा पर आधारित Valhalla से निकलते हैं।','El mapa usa teselas de OpenStreetMap. Las rutas en moto usan Valhalla, basado en datos OSM.','تستخدم الخريطة مربعات OpenStreetMap. تُحسب مسارات الدراجات النارية عبر Valhalla المبني على بيانات OSM.'],
 ['Adresse du moteur Valhalla','Valhalla routing server URL','Valhalla 路由服务器地址','Valhalla मार्ग सर्वर पता','Dirección del servidor Valhalla','عنوان خادم Valhalla'],
 ['Annuler','Cancel','取消','रद्द करें','Cancelar','إلغاء'],['Enregistrer','Save','保存','सहेजें','Guardar','حفظ'],
 ['Moteur d’itinéraire OSM','OSM routing engine','OSM 路线引擎','OSM मार्ग इंजन','Motor de rutas OSM','محرك توجيه OSM'],
 ['TRACÉ MANUEL','MANUAL ROUTE','手动路线','मैन्युअल मार्ग','TRAZADO MANUAL','مسار يدوي'],
 ['Étapes du parcours','Route stops','路线途经点','मार्ग के पड़ाव','Etapas de la ruta','نقاط المسار'],
 ['Réinitialiser','Reset','重置','रीसेट करें','Restablecer','إعادة تعيين'],
 ['Démarrer la navigation','Start navigation','开始导航','नेविगेशन शुरू करें','Iniciar navegación','ابدأ التنقل'],
 ['Aucun trajet à reprendre.','No route to resume.','没有可继续的路线。','फिर से शुरू करने के लिए कोई मार्ग नहीं।','No hay ninguna ruta para reanudar.','لا يوجد مسار لمتابعته.'],
 ['Navigation terminée.','Navigation ended.','导航结束。','नेविगेशन समाप्त।','Navegación finalizada.','انتهى التنقل.'],
 ['Adresse du moteur enregistrée.','Routing server saved.','路线服务器已保存。','मार्ग सर्वर सहेजा गया।','Servidor de rutas guardado.','تم حفظ خادم التوجيه.'],
 ['Votre itinéraire','Your route','你的路线','आपका मार्ग','Tu ruta','مسارك'],
 ['Dernière position enregistrée','Last saved position','上次保存的位置','अंतिम सहेजी स्थिति','Última posición guardada','آخر موقع محفوظ'],
 ['Reprendre le trajet','Resume route','继续路线','मार्ग फिर शुरू करें','Reanudar ruta','استئناف المسار'],
 ['Départ depuis le point choisi. Touchez la carte pour ajouter les étapes suivantes.','Start at the selected point. Tap the map to add more stops.','从所选点出发。点击地图添加后续途经点。','चुने हुए बिंदु से शुरू करें। अगले पड़ाव जोड़ने के लिए नक्शे पर टैप करें।','Empieza en el punto elegido. Toca el mapa para añadir más etapas.','ابدأ من النقطة المحددة. اضغط على الخريطة لإضافة نقاط أخرى.'],
 ['Les tronçons suivent les chemins cartographiés entre vos points. Le moteur ne garantit pas les autorisations d’accès ni l’état réel du terrain : vérifiez la signalisation et respectez les propriétés privées.','Segments follow mapped paths between your stops. Routing cannot guarantee access rights or trail conditions: check signs and respect private property.','各路段沿地图标记的道路连接。引擎不保证通行权限或实际路况：请查看标志并尊重私人土地。','खंड आपके बिंदुओं के बीच नक्शे के रास्तों का अनुसरण करते हैं। पहुँच की अनुमति या वास्तविक स्थिति की गारंटी नहीं; संकेत जाँचें और निजी संपत्ति का सम्मान करें।','Los tramos siguen caminos cartografiados. El motor no garantiza permisos ni el estado real del terreno: revisa las señales y respeta la propiedad privada.','تتبع المقاطع الطرق المرسومة بين نقاطك. لا يضمن المحرك حق الدخول أو حالة الطريق؛ تحقق من الإشارات واحترم الملكية الخاصة.'],
 ['Les données OSM peuvent être incomplètes. Vérifiez la signalisation et les accès réels avant de partir.','OSM data may be incomplete. Check signs and real access before setting off.','OSM 数据可能不完整。出发前请核实标志和实际通行权限。','OSM डेटा अधूरा हो सकता है। निकलने से पहले संकेत और वास्तविक पहुँच जाँचें।','Los datos de OSM pueden estar incompletos. Comprueba las señales y el acceso real antes de salir.','قد تكون بيانات OSM غير مكتملة. تحقق من الإشارات وإمكانية الدخول الفعلية قبل الانطلاق.'],
 ['La carte utilise les tuiles OpenStreetMap. Le calcul moto passe par Valhalla, un moteur de routage fondé sur les données OSM.','The map uses OpenStreetMap tiles. Motorcycle routes use Valhalla, a routing engine based on OSM data.','地图使用 OpenStreetMap 瓦片。摩托车路线由基于 OSM 数据的 Valhalla 引擎计算。','नक्शा OpenStreetMap टाइल्स का उपयोग करता है। मोटरसाइकिल मार्ग OSM डेटा पर आधारित Valhalla से निकलते हैं।','El mapa usa teselas de OpenStreetMap. Las rutas en moto usan Valhalla, basado en datos OSM.','تستخدم الخريطة مربعات OpenStreetMap. تُحسب مسارات الدراجات النارية عبر Valhalla المبني على بيانات OSM.'],
 ['Le serveur public est fourni sans garantie de disponibilité. L’attribution OSM reste affichée sur la carte. Les tuiles ne sont pas téléchargées pour un usage hors ligne. Les données d’accès peuvent être incomplètes ou anciennes.','The public server has no uptime guarantee. OSM attribution stays on the map. Tiles are not downloaded for offline use. Access data may be incomplete or outdated.','公共服务器不保证可用性。地图保留 OSM 署名。地图瓦片不会下载供离线使用。通行数据可能不完整或过时。','सार्वजनिक सर्वर की उपलब्धता की गारंटी नहीं। नक्शे पर OSM श्रेय रहता है। ऑफ़लाइन उपयोग के लिए टाइल डाउनलोड नहीं होतीं। पहुँच डेटा अधूरा या पुराना हो सकता है।','El servidor público no garantiza disponibilidad. La atribución OSM permanece en el mapa. No se descargan teselas para uso sin conexión. Los datos de acceso pueden ser incompletos o antiguos.','لا يوجد ضمان لتوفر الخادم العام. سيظل إسناد OSM ظاهرًا. لا تُنزّل الخرائط للاستخدام دون اتصال. قد تكون بيانات الدخول ناقصة أو قديمة.'],
 ['INFORMATIONS IMPORTANTES','IMPORTANT INFORMATION','重要信息','महत्वपूर्ण जानकारी','INFORMACIÓN IMPORTANTE','معلومات مهمة'],
 ['VTT, motocross et accès','Trail cycling, motocross & access','山地车、越野摩托与通行','माउंटेन बाइक, मोटोक्रॉस और पहुँच','Ciclismo de montaña, motocross y accesos','الدراجة الجبلية والموتوكروس والدخول'],
 ['Cross Travel utilise OpenStreetMap et BRouter pour les trajets à vélo. Le mode familial privilégie les chemins faciles et les itinéraires cyclables en évitant les routes autant que possible; le motocross passe par Valhalla et tient compte des accès motorisés connus.','Cross Travel uses OpenStreetMap and BRouter for cycling routes. Family mode favors easy trails and cycle routes while avoiding roads; motocross uses Valhalla and known motor access data.','Cross Travel 使用 OpenStreetMap 和 BRouter 规划自行车路线。家庭模式优先简单小径和自行车路线并尽量避开道路；越野摩托使用 Valhalla 和已知机动车通行数据。','Cross Travel साइकिल मार्गों के लिए OpenStreetMap और BRouter का उपयोग करता है। पारिवारिक मोड आसान रास्तों और साइकिल मार्गों को प्राथमिकता देता है; मोटोक्रॉस Valhalla और ज्ञात मोटर पहुँच डेटा का उपयोग करता है।','Cross Travel usa OpenStreetMap y BRouter para rutas en bici. El modo familiar prioriza caminos fáciles y vías ciclistas evitando carreteras; motocross usa Valhalla y datos de acceso motorizado conocidos.','يستخدم Cross Travel خرائط OpenStreetMap وBRouter لمسارات الدراجات. يفضل الوضع العائلي الطرق السهلة ومسارات الدراجات ويتجنب الطرق؛ يستخدم الموتوكروس Valhalla وبيانات الدخول المعروفة للمركبات.'],
 ['Pour le mode familial, les préférences de calcul favorisent les voies cyclables et les chemins faciles, et pénalisent fortement les routes; des routes peuvent rester présentes si les données ne proposent pas d’alternative praticable. Vérifiez la surface et les accès sur place.','Family routing favors cycle paths and easy trails and strongly penalizes roads. Roads may still appear if no practical alternative is mapped. Check surfaces and access on site.','家庭路线优先自行车道和简单小径，大幅降低道路优先级；若地图没有可行替代路线，仍可能经过道路。请现场检查路面和通行权限。','पारिवारिक मार्ग साइकिल पथ और आसान रास्तों को प्राथमिकता देता है और सड़कों से बचता है। विकल्प न होने पर सड़कें आ सकती हैं। सतह और पहुँच मौके पर जाँचें।','El modo familiar prioriza vías ciclistas y caminos fáciles y penaliza mucho las carreteras. Pueden aparecer si no hay alternativa práctica. Comprueba el terreno y los accesos.','يُفضّل الوضع العائلي مسارات الدراجات والطرق السهلة ويتجنب الطرق بشدة. قد تظهر الطرق عند غياب بديل مناسب. تحقق من السطح وإمكانية الدخول ميدانيًا.'],
 ['Le guidage vocal utilise la synthèse vocale de votre navigateur et la voix française installée sur votre appareil. Wikiloc est accessible en recherche externe; l’application ne télécharge pas ses traces. Un itinéraire GPX peut être importé dans OsmAnd. Les cartes et le calcul demandent une connexion. Le GPS et le maintien de l’écran dépendent de l’appareil et du navigateur. Ne manipulez pas l’écran en roulant.','Voice guidance uses your browser’s speech synthesis and installed voice. Wikiloc searches open externally; this app does not download its tracks. GPX routes can be imported into OsmAnd. Maps and routing need a connection. GPS and screen wake depend on your device and browser. Do not use the screen while riding.','语音导航使用浏览器语音合成和设备中已安装的语音。Wikiloc 搜索会在外部打开；应用不会下载其轨迹。GPX 路线可导入 OsmAnd。地图和路线规划需要网络。GPS 和屏幕常亮取决于设备与浏览器。骑行时请勿操作屏幕。','वॉइस निर्देश ब्राउज़र के वाक्-संश्लेषण का उपयोग करते हैं। Wikiloc खोज बाहर खुलेगी; ऐप ट्रैक डाउनलोड नहीं करता। GPX मार्ग OsmAnd में आयात किए जा सकते हैं। नक्शे और मार्ग के लिए इंटरनेट चाहिए। सवारी करते समय स्क्रीन न चलाएँ।','La guía por voz usa la síntesis del navegador. Las búsquedas de Wikiloc se abren fuera; la app no descarga sus trazas. Los GPX se pueden importar en OsmAnd. Mapas y rutas requieren conexión. No manipules la pantalla al circular.','يستخدم التوجيه الصوتي نطق المتصفح. تُفتح عمليات بحث Wikiloc خارجيًا ولا ينزّل التطبيق مساراتها. يمكن استيراد GPX إلى OsmAnd. تحتاج الخرائط والتوجيه إلى اتصال. لا تستخدم الشاشة أثناء القيادة.'],
 ['Carte normale','Street map','普通地图','सामान्य नक्शा','Mapa normal','خريطة عادية'],
 ['Départ placé sur la carte. Utilisez ⌖ pour choisir précisément chaque point.','Start placed. Use ⌖ to position each point precisely.','出发点已放置。使用 ⌖ 精确选择位置。','प्रस्थान रखा गया। हर बिंदु की सही जगह के लिए ⌖ दबाएँ।','Salida colocada. Usa ⌖ para precisar cada punto.','تم تحديد الانطلاق. استخدم ⌖ لضبط كل نقطة بدقة.'],
 ['Arrivée placée. Utilisez ⌖ pour choisir précisément chaque point.','Finish placed. Use ⌖ to position each point precisely.','终点已放置。使用 ⌖ 精确选择位置。','आगमन रखा गया। हर बिंदु की सही जगह के लिए ⌖ दबाएँ।','Llegada colocada. Usa ⌖ para precisar cada punto.','تم تحديد الوصول. استخدم ⌖ لضبط كل نقطة بدقة.'],
 ['Arrivée placée sur la carte.','Finish placed on the map.','已在地图上放置终点。','नक्शे पर आगमन रखा गया।','Llegada colocada en el mapa.','تم تحديد الوصول على الخريطة.'],
 ['Départ placé sur la carte.','Start placed on the map.','已在地图上放置出发点。','नक्शे पर प्रस्थान रखा गया।','Salida colocada en el mapa.','تم تحديد الانطلاق على الخريطة.'],
 ['Voix coupée','Voice off','语音已关闭','आवाज़ बंद','Voz desactivada','الصوت متوقف'],
 ['Fermer','Close','关闭','बंद करें','Cerrar','إغلاق'],
 ['Paramètres','Settings','设置','सेटिंग्स','Ajustes','الإعدادات'],
 ['Supprimer','Delete','删除','हटाएँ','Eliminar','حذف'],
 ['VTT · GPS ACTIF','TRAIL CYCLING · GPS ACTIVE','山地车 · GPS 已开启','माउंटेन बाइक · GPS सक्रिय','BICI DE MONTAÑA · GPS ACTIVO','جبلية · GPS نشط'],
 ['OSM · VÉLO FAMILIAL · RAPIDE','OSM · FAMILY BIKE · FAST','OSM · 家庭骑行 · 快速','OSM · पारिवारिक साइकिल · तेज़','OSM · BICI FAMILIAR · RÁPIDA','OSM · دراجة عائلية · سريع'],
 ['OSM · RAVeL & CHEMINS','OSM · GREENWAYS & TRAILS','OSM · 绿道与小径','OSM · ग्रीनवे और पगडंडियाँ','OSM · VÍAS VERDES Y CAMINOS','OSM · المسارات الخضراء والدروب'],
 ['OSM · VÉLO DE ROUTE · RAPIDE','OSM · ROAD BIKE · FAST','OSM · 公路骑行 · 快速','OSM · रोड साइकिल · तेज़','OSM · BICI DE CARRETERA · RÁPIDA','OSM · دراجة طريق · سريع'],
 ['OSM · ROUTE VTT','OSM · TRAIL CYCLING ROUTE','OSM · 山地车路线','OSM · माउंटेन बाइक मार्ग','OSM · RUTA DE MONTAÑA','OSM · مسار دراجة جبلية'],
 ['OSM · MOTO · PETITES ROUTES','OSM · MOTO · QUIET ROADS','OSM · 摩托 · 小路','OSM · मोटो · शांत सड़कें','OSM · MOTO · CARRETERAS TRANQUILAS','OSM · دراجة نارية · طرق هادئة'],
 ['Carte normale','Street map','普通地图','सामान्य नक्शा','Mapa normal','خريطة عادية'],
 ['Imagerie satellite activée.','Satellite imagery enabled.','卫星影像已启用。','उपग्रह दृश्य चालू।','Imagen satelital activada.','تم تفعيل صور الأقمار الصناعية.'],
 ['Satellite indisponible : retour à la carte OSM.','Satellite unavailable: returning to the OSM map.','卫星图不可用：返回 OSM 地图。','उपग्रह उपलब्ध नहीं: OSM नक्शे पर लौट रहे हैं।','Satélite no disponible: se vuelve al mapa OSM.','القمر الصناعي غير متاح: العودة إلى خريطة OSM.'],
 ['VÉLO FAMILIAL · GPS ACTIF','FAMILY BIKE · GPS ACTIVE','家庭骑行 · GPS 已开启','पारिवारिक साइकिल · GPS सक्रिय','BICI FAMILIAR · GPS ACTIVO','دراجة عائلية · GPS نشط'],
 ['VÉLO DE ROUTE · GPS ACTIF','ROAD BIKE · GPS ACTIVE','公路骑行 · GPS 已开启','रोड साइकिल · GPS सक्रिय','BICI DE CARRETERA · GPS ACTIVO','دراجة طريق · GPS نشط'],
 ['MOTO · GPS ACTIF','MOTO · GPS ACTIVE','摩托 · GPS 已开启','मोटो · GPS सक्रिय','MOTO · GPS ACTIVO','دراجة نارية · GPS نشط'],
 ['La synthèse vocale n’est pas disponible dans ce navigateur.','Speech synthesis is not available in this browser.','此浏览器不支持语音合成。','इस ब्राउज़र में वाक्-संश्लेषण उपलब्ध नहीं है।','La síntesis de voz no está disponible en este navegador.','ميزة تحويل النص إلى كلام غير متاحة في هذا المتصفح.'],
 ['Écart détecté. Recalcul du parcours.','Off route. Recalculating.','偏离路线，正在重新规划。','मार्ग से हटे। फिर से गणना हो रही है।','Fuera de ruta. Recalculando.','خارج المسار. جارٍ إعادة الحساب.']
 ,
 ['TRAJET EN COURS','ROUTE IN PROGRESS','路线进行中','मार्ग जारी है','RUTA EN CURSO','المسار قيد التنفيذ'],
 ['VTT · OSM','TRAIL CYCLING · OSM','山地车 · OSM','माउंटेन बाइक · OSM','CICLISMO DE MONTAÑA · OSM','دراجة جبلية · OSM'],
 ['VTT : itinéraires cyclables, sentiers et pistes; les routes fréquentées sont pénalisées quand une alternative existe. Vérifiez le niveau technique et l’accès.','Trail cycling: cycle routes, paths and tracks; busy roads are penalized when an alternative exists. Check technical difficulty and access.','山地车路线：自行车道、小径与山道；有替代路线时会降低繁忙道路优先级。请确认难度和通行权限。','माउंटेन बाइक: साइकिल मार्ग, रास्ते और ट्रैक; विकल्प होने पर व्यस्त सड़कों से बचें। कठिनाई और पहुँच जाँचें।','Ciclismo de montaña: vías ciclistas, caminos y senderos; se penalizan carreteras concurridas si hay alternativa. Comprueba dificultad y acceso.','دراجة جبلية: مسارات الدراجات والدروب؛ تُتجنب الطرق المزدحمة عند وجود بديل. تحقق من الصعوبة وإمكانية الدخول.'],
 ['Carte OpenStreetMap. Le vélo de route privilégie un trajet rapide sur chaussée adaptée et pistes cyclables. La moto favorise les routes secondaires et évite les grands axes selon les accès moto cartographiés.','OpenStreetMap. Road cycling favors a fast route on suitable roads and cycle paths. Motorcycles favor secondary roads and avoid main roads where mapped access allows.','OpenStreetMap 地图。公路骑行优先选择适宜道路和自行车道的快速路线。摩托车尽量使用支路并根据地图通行信息避开主干道。','OpenStreetMap नक्शा। रोड साइकिल उपयुक्त सड़कों और साइकिल पथों पर तेज़ मार्ग चुनती है। मोटरसाइकिल मुख्य सड़कों से बचती है।','OpenStreetMap. El ciclismo de carretera prioriza rutas rápidas por vías adecuadas y carriles bici. La moto favorece vías secundarias y evita las principales según el acceso cartografiado.','خريطة OpenStreetMap. تفضّل دراجة الطريق المسارات السريعة المناسبة. تفضّل الدراجة النارية الطرق الثانوية وتتجنب الرئيسية وفق بيانات الدخول.'],
 ['Exporter GPX','Export GPX','导出 GPX','GPX निर्यात','Exportar GPX','تصدير GPX'],
 ['Étape —','Step —','步骤 —','चरण —','Etapa —','المرحلة —'],
 ['COLLECTION','COLLECTION','收藏','संग्रह','COLECCIÓN','المجموعة'],
 ['Touchez la carte pour placer le','Tap the map to place the','点击地图放置','नक्शे पर रखने के लिए टैप करें','Toca el mapa para colocar la','اضغط على الخريطة لوضع'],
 ['départ','start','出发点','प्रस्थान','salida','الانطلاق']
];
const UI_TRANSLATIONS = Object.fromEntries(I18N_ROWS.map(row => [row[0], {en: row[1], zh: row[2], hi: row[3], es: row[4], ar: row[5]}]));
Object.assign(UI_TRANSLATIONS, {
  'Glisser pour déplacer': {en: 'Drag to move', zh: '拖动以移动', hi: 'खींचकर स्थान बदलें', es: 'Arrastra para mover', ar: 'اسحب للتحريك'},
  'Renommer le trajet': {en: 'Rename route', zh: '重命名路线', hi: 'मार्ग का नाम बदलें', es: 'Renombrar ruta', ar: 'إعادة تسمية المسار'},
  'Nouveau nom du trajet': {en: 'New route name', zh: '路线新名称', hi: 'मार्ग का नया नाम', es: 'Nuevo nombre de la ruta', ar: 'الاسم الجديد للمسار'},
  'Trajet renommé.': {en: 'Route renamed.', zh: '路线已重命名。', hi: 'मार्ग का नाम बदल दिया गया।', es: 'Ruta renombrada.', ar: 'تمت إعادة تسمية المسار.'}
});
const translationTextNodes = new WeakMap();
const translationAttributes = new WeakMap();
let languageObserver = null;
function localizedText(source, language = state.language) {
  if (language === 'fr') return source;
  const exact = UI_TRANSLATIONS[source];
  if (exact && exact[language]) return exact[language];
  if (source.startsWith('Étape ')) {
    const parts = source.slice(6).split(' / ');
    const prefixes = {en: 'Step ', zh: '步骤 ', hi: 'चरण ', es: 'Etapa ', ar: 'المرحلة '};
    if (parts.every(part => /^[0-9]+$/.test(part))) return prefixes[language] + parts.join(' / ');
  }
  const nextSuffix = ' avant la prochaine étape';
  if (source.endsWith(nextSuffix)) {
    const tail = {en: ' before next step', zh: ' 后到达下一点', hi: ' अगले पड़ाव तक', es: ' para la siguiente etapa', ar: ' حتى الخطوة التالية'}[language];
    return source.slice(0, -nextSuffix.length) + tail;
  }
  const averagePrefix = 'Moyenne roulée · ';
  if (source.startsWith(averagePrefix)) return localizedText('Moyenne roulée', language) + ' · ' + source.slice(averagePrefix.length);
  if (source === 'Écart détecté. Recalcul du parcours.') return {en: 'Off route. Recalculating.', zh: '偏离路线，正在重新规划。', hi: 'मार्ग से हटे। फिर से गणना हो रही है।', es: 'Fuera de ruta. Recalculando.', ar: 'خارج المسار. جارٍ إعادة الحساب.'}[language];
  return source;
}
function translateTextNode(node) {
  const current = node.nodeValue;
  if (!current || !current.trim() || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement?.tagName || '')) return;
  const previous = translationTextNodes.get(node);
  const source = previous && current === previous.output ? previous.source : current;
  const trimmed = source.trim();
  const start = source.indexOf(trimmed);
  const output = source.slice(0, start) + localizedText(trimmed) + source.slice(start + trimmed.length);
  translationTextNodes.set(node, {source, output});
  if (current !== output) node.nodeValue = output;
}
function translateElementAttributes(element) {
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    if (!element.hasAttribute?.(attr)) continue;
    const current = element.getAttribute(attr);
    const previous = translationAttributes.get(element)?.[attr];
    const source = previous && current === previous.output ? previous.source : current;
    const output = localizedText(source);
    const records = translationAttributes.get(element) || {};
    records[attr] = {source, output}; translationAttributes.set(element, records);
    if (current !== output) element.setAttribute(attr, output);
  }
}
function translateSubtree(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) translateTextNode(node);
  if (root.nodeType === 1) translateElementAttributes(root);
  root.querySelectorAll?.('*').forEach(translateElementAttributes);
}
function applyLanguage() {
  state.language = ['fr', 'en', 'zh', 'hi', 'es', 'ar'].includes(state.language) ? state.language : 'fr';
  document.documentElement.lang = LANGUAGE_LOCALES[state.language];
  document.documentElement.dir = state.language === 'ar' ? 'rtl' : 'ltr';
  $('#language-select').value = state.language;
  $('#units-select').value = state.units;
  $('#nav-speed-unit').textContent = localizedText(state.units === 'imperial' ? 'mph' : 'km/h');
  $('#units-example').textContent = localizedText(state.units === 'imperial' ? 'Ex. 3,1 mi et 1 640 ft' : 'Ex. 5 km et 500 m');
  document.title = localizedText('Cross Travel — vélo familial, VTT & motocross');
  translateSubtree();
  if (!languageObserver) {
    languageObserver = new MutationObserver(records => records.forEach(record => {
      if (record.type === 'characterData') translateTextNode(record.target);
      else if (record.type === 'attributes') translateElementAttributes(record.target);
      else record.addedNodes.forEach(node => {
        if (node.nodeType === 3) translateTextNode(node);
        else if (node.nodeType === 1) translateSubtree(node);
      });
    }));
    languageObserver.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder']});
  }
}
function updateLanguage(language) {
  state.language = ['fr', 'en', 'zh', 'hi', 'es', 'ar'].includes(language) ? language : 'fr';
  localStorage.setItem('ct_language', state.language);
  applyLanguage();
  updateUnits(state.units);
}
function updateUnits(units) {
  state.units = units === 'imperial' ? 'imperial' : 'metric';
  localStorage.setItem('ct_units', state.units);
  $('#units-select').value = state.units;
  $('#units-example').textContent = localizedText(state.units === 'imperial' ? 'Ex. 3,1 mi et 1 640 ft' : 'Ex. 5 km et 500 m');
  if (state.route) $('#route-distance').textContent = formatDistance(state.route.distanceMeters);
  $('#nav-speed').textContent = String(Math.round(state.units === 'imperial' ? state.currentSpeedKmh / 1.609344 : state.currentSpeedKmh));
  $('#nav-speed-unit').textContent = localizedText(state.units === 'imperial' ? 'mph' : 'km/h');
  const averageKmh = state.movingSeconds >= 20 && state.movingDistanceMeters >= 60 ? state.movingDistanceMeters / state.movingSeconds * 3.6 : 0;
  const averageDisplay = state.units === 'imperial' ? averageKmh / 1.609344 : averageKmh;
  $('#nav-speed-average').textContent = averageKmh ? localizedText('Moyenne roulée') + ' · ' + Math.round(averageDisplay) + (state.units === 'imperial' ? ' mph' : ' km/h') : localizedText('Analyse de votre vitesse…');
  $('#nav-travelled').textContent = formatDistance(state.distanceTravelledMeters);
  $('#nav-remaining').textContent = formatDistance(Math.max(0, (state.route?.distanceMeters || 0) - Math.max(0, state.distanceTravelledMeters - state.routeStartDistanceTravelled)));
  if (state.manualPoints.length && state.map) renderManualTrack();
  renderSaved();
  renderResumeTripCard();
}

function routePointMarkerIcon(asset) {
  return L.divIcon({
    className: 'start-logo-shell',
    html: `<span class="start-logo-marker"><img src="${asset}" alt="" /></span>`,
    iconSize: [60, 32], iconAnchor: [30, 16]
  });
}

function startMarkerIcon() { return routePointMarkerIcon('assets/start-flag.svg'); }
function finishMarkerIcon() { return routePointMarkerIcon('assets/finish-flag.svg'); }
function navigationVehicleAsset() {
  return ({family: 'assets/velo-familial.webp', road: 'assets/velo-route.webp', vtt: 'assets/vtt-dynamique.webp', moto: 'assets/motocross-calme.webp'})[state.mode] || 'assets/vtt-dynamique.webp';
}
function navigationVehicleClass() { return ({family: 'family', road: 'road', vtt: 'vtt', moto: 'moto'})[state.mode] || 'vtt'; }
function createNavigationVehicleMarker(point, heading) {
  const className = navigationVehicleClass();
  const angle = ((heading - 90) % 360 + 360) % 360;
  const icon = L.divIcon({
    className: 'nav-vehicle-shell',
    html: '<span class="nav-vehicle nav-vehicle-' + className + '" style="--vehicle-bearing:' + angle + 'deg"><img class="nav-vehicle-image" src="' + navigationVehicleAsset() + '" alt="' + className + '" /></span>',
    iconSize: [50, 50], iconAnchor: [25, 25]
  });
  return L.marker([point.lat, point.lon], {icon, interactive: false, keyboard: false, zIndexOffset: 1500}).addTo(state.map);
}
function updateNavigationVehicleMarker(point, heading) {
  if (!state.navigationMarker || !state.map.hasLayer(state.navigationMarker)) {
    state.navigationMarker = createNavigationVehicleMarker(point, heading);
  } else {
    state.navigationMarker.setLatLng([point.lat, point.lon]);
  }
  const icon = state.navigationMarker.getElement()?.querySelector('.nav-vehicle');
  if (icon) {
    icon.style.setProperty('--vehicle-bearing', (((heading - 90) % 360 + 360) % 360) + 'deg');
    icon.classList.toggle('is-moving', state.currentSpeedKmh >= 1.5);
  }
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
      else state.markers.push(L.marker([selected.lat, selected.lon], {icon: finishMarkerIcon(), interactive: false, keyboard: false, zIndexOffset: 1300}).addTo(state.map));
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
    if (index === 0) {
      state.manualMarkers.push(createStartMarker(point).addTo(state.map));
      return;
    }
    if (isFinish) {
      state.manualMarkers.push(L.marker([point.lat, point.lon], {icon: finishMarkerIcon(), interactive: false, keyboard: false, zIndexOffset: 1300}).addTo(state.map));
      return;
    }
    const label = manualStepName(index - 1);
    const icon = L.divIcon({className: 'manual-marker-shell', html: `<span class="manual-marker">${label}</span>`, iconSize: [34, 34], iconAnchor: [17, 17]});
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
    rows.push(`<li class="manual-stage-row" data-manual-stage data-point-index="${i}"><span class="manual-stage-badge${isFinish ? ' manual-stage-finish' : ''}">${badge}</span><div class="manual-stage-copy"><strong>${stageName}</strong><span>${points[i].lat.toFixed(5)}, ${points[i].lon.toFixed(5)} · ${details}</span><small>${cumulativeLabel}</small></div><div class="manual-stage-controls">${!(isFinish && state.manualDestinationLocked) ? `<button class="manual-stage-drag" type="button" data-drag-manual aria-label="${localizedText('Glisser pour déplacer')} ${stageName}" title="${localizedText('Glisser pour déplacer')}" aria-keyshortcuts="ArrowUp ArrowDown"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v16M10 2 6.5 5.5M10 2l3.5 3.5M10 18l-3.5-3.5M10 18l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}<button class="manual-remove-step" type="button" data-manual-remove="${i}" aria-label="Supprimer ${stageName}">×</button></div></li>`);
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
  const stageList = $('#manual-stage-list');
  stageList.querySelectorAll('[data-drag-manual]').forEach(handle => {
    handle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const row = handle.closest('[data-manual-stage]');
      const index = Number(row?.dataset.pointIndex);
      const next = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (!row || index < 1 || next < 1 || next >= state.manualPoints.length) return;
      if (state.manualDestinationLocked && next === state.manualPoints.length - 1) return;
      [state.manualPoints[index], state.manualPoints[next]] = [state.manualPoints[next], state.manualPoints[index]];
      updateManualTrack();
      requestAnimationFrame(() => stageList.querySelector(`[data-point-index="${next}"] [data-drag-manual]`)?.focus());
    });
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const row = handle.closest('[data-manual-stage]');
      const index = Number(row?.dataset.pointIndex);
      if (!row || index < 1 || (state.manualDestinationLocked && index === state.manualPoints.length - 1)) return;
      event.preventDefault();
      const drag = {pointerId: event.pointerId, row, startX: event.clientX, startY: event.clientY, moved: false};
      row.classList.add('is-dragging');
      stageList.classList.add('is-reordering');
      handle.setPointerCapture?.(event.pointerId);
      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onCancel);
        drag.row.classList.remove('is-dragging');
        stageList.classList.remove('is-reordering');
        stageList.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
      };
      const onMove = moveEvent => {
        if (moveEvent.pointerId !== drag.pointerId) return;
        const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
        if (distance < 5) return;
        drag.moved = true;
        moveEvent.preventDefault();
        const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-manual-stage]');
        if (!target || !stageList.contains(target) || target === drag.row) return;
        const targetIndex = Number(target.dataset.pointIndex);
        if (targetIndex < 1 || (state.manualDestinationLocked && targetIndex === state.manualPoints.length - 1)) return;
        stageList.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
        target.classList.add('is-drop-target');
        const after = moveEvent.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        const reference = after ? target.nextElementSibling : target;
        if (reference !== drag.row && reference !== drag.row.nextElementSibling) stageList.insertBefore(drag.row, reference);
      };
      const onEnd = endEvent => {
        if (endEvent.pointerId !== drag.pointerId) return;
        cleanup();
        if (!drag.moved) return;
        const orderedIndices = [...stageList.querySelectorAll('[data-manual-stage]')].map(row => Number(row.dataset.pointIndex));
        if (orderedIndices.length !== state.manualPoints.length - 1) { renderManualTrack(); return; }
        state.manualPoints = [state.manualPoints[0], ...orderedIndices.map(pointIndex => state.manualPoints[pointIndex])];
        updateManualTrack();
      };
      const onCancel = cancelEvent => {
        if (cancelEvent.pointerId !== drag.pointerId) return;
        cleanup();
        renderManualTrack();
      };
      document.addEventListener('pointermove', onMove, {passive: false});
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onCancel);
    });
  });

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
    const destinationText = $('#destination-input').value.trim();
    const selectedDestination = state.destination || (destinationText ? await resolvePoint($('#destination-input'), state.destination) : null);
    const resumeTrack = Boolean(state.manualPoints.length > 1 && state.manualLegs.length === manualExpectedLegCount());
    if (!resumeTrack) {
      state.manualUndo = null;
      clearDisplayedRoute(); state.destination = null; state.manualReturnToStart = false;
      state.manualDestinationLocked = Boolean(selectedDestination && state.map.distance([origin.lat, origin.lon], [selectedDestination.lat, selectedDestination.lon]) > 3);
      state.manualPoints = [origin];
      if (state.manualDestinationLocked) state.manualPoints.push(selectedDestination);
      else $('#destination-input').value = '';
      state.manualLegs = []; state.currentStep = 0;
    } else if (state.manualPoints[0].lat !== origin.lat || state.manualPoints[0].lon !== origin.lon) {
      state.manualPoints = [origin]; state.manualLegs = []; clearDisplayedRoute();
      state.manualDestinationLocked = false;
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
  state.manualDestinationLocked = false;
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
  const wasLockedDestination = state.manualDestinationLocked && index === state.manualPoints.length - 1;
  if (wasLockedDestination) state.manualDestinationLocked = false;
  const point = state.manualPoints.splice(index, 1)[0];
  const undo = {point, index, wasLockedDestination, time: Date.now()};
  state.manualUndo = undo;
  updateManualTrack();
  toastWithAction('Point de passage supprimé.', 'Annuler', () => {
    if (state.manualUndo !== undo) return;
    const restoreIndex = Math.min(index, state.manualPoints.length);
    state.manualPoints.splice(restoreIndex, 0, point);
    state.manualDestinationLocked = Boolean(wasLockedDestination && restoreIndex === state.manualPoints.length - 1);
    state.manualUndo = null;
    updateManualTrack();
    toast('Suppression annulée.');
  });
}

function addManualWaypoint(point) {
  if (!state.manualMode || !state.manualPoints.length) return;
  const insertionIndex = state.manualDestinationLocked && state.manualPoints.length > 1
    ? state.manualPoints.length - 1 : state.manualPoints.length;
  const previous = state.manualPoints[insertionIndex - 1];
  const next = state.manualPoints[insertionIndex];
  if (state.map.distance([previous.lat, previous.lon], [point.lat, point.lon]) < 3
    || (next && state.map.distance([next.lat, next.lon], [point.lat, point.lon]) < 3)) {
    toast('Ce point est trop proche d’une étape existante.'); return;
  }
  state.manualPoints.splice(insertionIndex, 0, {lat: point.lat, lon: point.lon});
  updateManualTrack();
  toast(`Étape ${manualStepName(insertionIndex - 1)} ajoutée. Calcul du chemin en cours.`);
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
        directions_options: {units: 'kilometers', language: state.language === 'fr' ? 'fr-FR' : (LANGUAGE_LOCALES[state.language] || 'en-US')},
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
    state.manualPoints = []; state.manualLegs = []; state.manualReturnToStart = false; state.manualDestinationLocked = false;
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
    state.markers.push(L.marker([state.destination.lat, state.destination.lon], {icon: finishMarkerIcon(), interactive: false, keyboard: false, zIndexOffset: 1300}).addTo(state.map));
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
  utterance.lang = LANGUAGE_LOCALES[state.language] || 'fr-BE'; utterance.rate = 0.96; utterance.pitch = 1; utterance.volume = 1;
  const voicePrefix = utterance.lang.toLowerCase().split('-')[0];
  const voice = window.speechSynthesis.getVoices().find(item => item.lang?.toLowerCase().startsWith(voicePrefix));
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

function routeCoordinate(value) {
  return Array.isArray(value) ? {lat: Number(value[0]), lon: Number(value[1])} : {lat: Number(value.lat), lon: Number(value.lon)};
}
function nearestRouteProjection(point, minimumProgress = 0) {
  const path = state.route?.path || [];
  if (path.length < 2) return null;
  const coordinates = path.map(routeCoordinate);
  const lengths = [0];
  for (let i = 1; i < coordinates.length; i++) lengths[i] = lengths[i - 1] + state.map.distance([coordinates[i - 1].lat, coordinates[i - 1].lon], [coordinates[i].lat, coordinates[i].lon]);
  const total = lengths.at(-1) || 1;
  let best = null;
  const minProgress = Math.max(0, Number(minimumProgress) || 0);
  for (let i = 0; i < coordinates.length - 1; i++) {
    const from = coordinates[i], to = coordinates[i + 1];
    const meanLat = ((from.lat + to.lat + point.lat) / 3) * Math.PI / 180;
    const scaleX = 111320 * Math.cos(meanLat), scaleY = 110540;
    const dx = (to.lon - from.lon) * scaleX, dy = (to.lat - from.lat) * scaleY;
    const px = (point.lon - from.lon) * scaleX, py = (point.lat - from.lat) * scaleY;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    const snapped = {lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t};
    const segmentLength = lengths[i + 1] - lengths[i];
    const progress = (lengths[i] + segmentLength * t) / total;
    if (progress + 0.002 < minProgress) continue;
    const distance = state.map.distance([snapped.lat, snapped.lon], [point.lat, point.lon]);
    if (!best || distance < best.distance) best = {...snapped, distance, progress, segmentIndex: i};
  }
  if (!best && minProgress > 0) return nearestRouteProjection(point, 0);
  return best;
}
function nearestPathProgress(point) {
  return nearestRouteProjection(point)?.progress || 0;
}
function routeBearingAtPoint(point) {
  const projection = nearestRouteProjection(point, Math.max(0, state.navigationProgress - 0.01));
  if (!projection) return state.navigationHeading ?? state.lastMapBearing ?? 0;
  const path = state.route?.path || [];
  const from = routeCoordinate(path[projection.segmentIndex]);
  const to = routeCoordinate(path[projection.segmentIndex + 1]);
  const radians = Math.PI / 180;
  const lat1 = from.lat * radians, lat2 = to.lat * radians, deltaLon = (to.lon - from.lon) * radians;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) / radians + 360) % 360;
}
function navigationLetterName(index) {
  let visibleBefore = 0;
  for (let i = 0; i < Math.min(index, state.navigationViaPoints.length); i++) {
    if (!state.navigationViaPoints[i].hidden) visibleBefore++;
  }
  return manualStepName(visibleBefore);
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
    if (item.hidden) return;
    const letter = navigationLetterName(index);
    const icon = L.divIcon({className: 'nav-point-shell', html: `<span class="nav-point-marker nav-point-via">${letter}</span>`, iconSize: [30, 30], iconAnchor: [15, 15]});
    state.navigationPointLayers.push(L.marker([item.lat, item.lon], {icon, interactive: false, keyboard: false, zIndexOffset: 1100}));
  });
  if (state.navigationDetour) {
    const draft = state.navigationDetour;
    const coords = [[draft.start.lat, draft.start.lon], ...draft.points.map(item => [item.lat, item.lon])];
    if (coords.length > 1) state.navigationPointLayers.push(L.polyline(coords, {color: '#fff', weight: 5, opacity: .92, dashArray: '6 7', interactive: false}));
    draft.points.forEach((item, index) => {
      const letter = navigationLetterName(draft.startViaIndex + index + 1);
      const icon = L.divIcon({className: 'nav-point-shell', html: `<span class="nav-point-marker nav-point-draft">${letter}</span>`, iconSize: [30, 30], iconAnchor: [15, 15]});
      state.navigationPointLayers.push(L.marker([item.lat, item.lon], {icon, interactive: false, keyboard: false, zIndexOffset: 1250}));
    });
  }
  const detourStatus = $('#nav-detour-status');
  if (detourStatus) {
    detourStatus.classList.toggle('hidden', !state.navigationDetour);
    if (state.navigationDetour) {
      const draft = state.navigationDetour;
      $('#nav-detour-copy').textContent = draft.calculating
        ? 'Calcul du détour en cours…'
        : 'Détour depuis le point choisi · ajoutez des points puis rejoignez une lettre ou le tracé.';
    }
  }
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

function nearestNavigationViaIndex(point) {
  let bestIndex = -1, bestDistance = Infinity;
  state.navigationViaPoints.forEach((item, index) => {
    if (item.hidden) return;
    const distance = state.map.distance([item.lat, item.lon], [point.lat, point.lon]);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  });
  return bestIndex;
}

function startNavigationDetour(point) {
  if (state.navigationDetour) return;
  const projection = nearestRouteProjection(point, Math.max(0, state.navigationProgress - 0.015));
  if (!projection || projection.distance > 100) {
    toast('Touchez le tracé pour choisir le départ du détour.');
    return;
  }
  const start = {lat: projection.lat, lon: projection.lon};
  let startViaIndex = -1;
  state.navigationViaPoints.forEach((item, index) => {
    const progress = Number.isFinite(Number(item.progress)) ? Number(item.progress) : nearestPathProgress(item);
    if (progress <= projection.progress + 0.001) startViaIndex = index;
  });
  const connectorStart = startViaIndex >= 0
    ? {lat: state.navigationViaPoints[startViaIndex].lat, lon: state.navigationViaPoints[startViaIndex].lon}
    : {...(state.origin || state.route.path?.[0] || start)};
  const startProgress = projection.progress;
  state.navigationDetour = {
    startViaIndex, startProgress, start, connectorStart,
    points: [], calculating: false
  };
  renderNavigationPoints();
  persistNavigationResume(true);
  toast('Détour commencé à cet endroit du tracé. Ajoutez des points puis rejoignez le tracé.');
}

function addNavigationDetourPoint(point) {
  const draft = state.navigationDetour;
  if (!draft || draft.calculating) return;
  const previous = draft.points.at(-1) || draft.start;
  if (state.map.distance([previous.lat, previous.lon], [point.lat, point.lon]) < 5) {
    toast('Ce point est trop proche du précédent.'); return;
  }
  draft.points.push({lat: point.lat, lon: point.lon});
  renderNavigationPoints();
  persistNavigationResume(true);
  toast(`Point de détour ${draft.points.length} ajouté. Rejoignez une lettre ou le tracé pour fermer le détour.`);
}

function cancelNavigationDetour() {
  if (!state.navigationDetour) return;
  state.navigationRerouteController?.abort();
  state.navigationDetour = null;
  renderNavigationPoints();
  persistNavigationResume(true);
  toast('Détour annulé.');
}

async function finishNavigationDetour(endViaIndex, endpointOverride = null) {
  const draft = state.navigationDetour;
  if (!draft || draft.calculating) return;
  const startViaIndex = draft.startViaIndex;
  if (endViaIndex <= startViaIndex) {
    toast('Fermez le détour sur une lettre ou le tracé situé après son départ.'); return;
  }
  const oldVias = state.navigationViaPoints.map(item => ({...item}));
  const oldSegments = [...state.navigationSegments];
  const isNewRouteJoin = Boolean(endpointOverride);
  const closesOnVia = !isNewRouteJoin && endViaIndex < oldVias.length;
  const end = endpointOverride || (closesOnVia ? oldVias[endViaIndex] : state.destination);
  if (!end) return;
  const center = state.map.getCenter(), zoom = state.map.getZoom();
  state.navigationRerouteController?.abort();
  const controller = new AbortController();
  state.navigationRerouteController = controller;
  const version = ++state.navigationRerouteVersion;
  draft.calculating = true;
  renderNavigationPoints();
  try {
    const targets = [...draft.points, {lat: end.lat, lon: end.lon}];
    let suffixVias = closesOnVia ? oldVias.slice(endViaIndex) : [];
    let suffixSegments = oldSegments.slice(endViaIndex + 1);
    if (isNewRouteJoin) {
      suffixVias = oldVias.slice(endViaIndex);
      if (endViaIndex < oldVias.length) targets.push(oldVias[endViaIndex]);
      else targets.push(state.destination);
      suffixSegments = endViaIndex < oldVias.length ? oldSegments.slice(endViaIndex + 1) : [];
    }
    const replacementSegments = [];
    let cursor = draft.start;
    for (const target of targets) {
      const segment = await requestNavigationSegment(cursor, target, controller.signal);
      if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
      replacementSegments.push(segment);
      cursor = target;
    }
    const prefixVias = oldVias.slice(0, startViaIndex + 1);
    const prefixSegments = oldSegments.slice(0, startViaIndex + 1);
    const connectorDistance = draft.connectorStart
      ? state.map.distance([draft.connectorStart.lat, draft.connectorStart.lon], [draft.start.lat, draft.start.lon]) : 0;
    if (connectorDistance > 3) {
      const connector = await requestNavigationSegment(draft.connectorStart, draft.start, controller.signal);
      if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
      prefixSegments.push(connector);
      prefixVias.push({...draft.start, progress: 0, hidden: true});
    }
    state.navigationViaPoints = [
      ...prefixVias,
      ...draft.points.map(item => ({...item, progress: 0})),
      ...(isNewRouteJoin ? [{...end, progress: 0}] : []),
      ...suffixVias
    ];
    state.navigationSegments = [
      ...prefixSegments,
      ...replacementSegments,
      ...suffixSegments
    ];
    refreshViaProgressFromSegments();
    state.navigationDetour = null;
    state.route = combineNavigationSegments(state.navigationSegments);
    const currentPosition = state.lastPosition || draft.start;
    state.navigationProgress = nearestPathProgress(currentPosition);
    state.routeStartDistanceTravelled = state.distanceTravelledMeters - state.route.distanceMeters * state.navigationProgress;
    const steps = state.route.legs[0]?.steps || [];
    const nextStepIndex = steps.findIndex(step => nearestPathProgress(step.endLocation) >= state.navigationProgress - 0.001);
    state.currentStep = nextStepIndex >= 0 ? nextStepIndex : Math.max(0, steps.length - 1);
    drawRoute();
    state.map.setView(center, zoom, {animate: false});
    renderNavigationPoints();
    persistNavigationResume(true);
    if (isNewRouteJoin) {
      const insertedIndex = state.navigationViaPoints.findIndex(item => state.map.distance([item.lat, item.lon], [end.lat, end.lon]) < 2);
      toast('Détour refermé sur le tracé. Nouvelle étape ' + navigationLetterName(insertedIndex >= 0 ? insertedIndex : prefixVias.length + draft.points.length) + ' ajoutée.');
    } else {
      const closedIndex = closesOnVia ? state.navigationViaPoints.findIndex(item => state.map.distance([item.lat, item.lon], [end.lat, end.lon]) < 2) : -1;
      toast('Détour fermé sur ' + (closedIndex >= 0 ? navigationLetterName(closedIndex) : 'l’arrivée') + '.');
    }
  } catch (error) {
    if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
    state.navigationViaPoints = oldVias;
    state.navigationSegments = oldSegments;
    if (state.navigationDetour) state.navigationDetour.calculating = false;
    renderNavigationPoints();
    toast('Détour impossible : ' + error.message);
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
  if (state.navigationDetour) {
    const draft = state.navigationDetour;
    if (draft.calculating) return;
    const nearbyViaIndex = state.navigationViaPoints.findIndex(item => !item.hidden && state.map.distance([item.lat, item.lon], [point.lat, point.lon]) < 38);
    if (nearbyViaIndex >= 0) {
      if (nearbyViaIndex > draft.startViaIndex) finishNavigationDetour(nearbyViaIndex);
      else toast('Touchez une lettre située après le départ du détour.');
      return;
    }
    const nearDestination = state.destination && state.map.distance([state.destination.lat, state.destination.lon], [point.lat, point.lon]) < 38;
    if (nearDestination && state.navigationViaPoints.length > draft.startViaIndex) {
      finishNavigationDetour(state.navigationViaPoints.length);
      return;
    }
    const startProgress = Number.isFinite(draft.startProgress) ? draft.startProgress : state.navigationProgress;
    const projection = nearestRouteProjection(point, startProgress + 0.002);
    if (projection && projection.distance <= 55 && projection.progress > startProgress + 0.002) {
      let insertionIndex = state.navigationViaPoints.findIndex(item => Number(item.progress) > projection.progress + 0.002);
      if (insertionIndex < 0) insertionIndex = state.navigationViaPoints.length;
      finishNavigationDetour(insertionIndex, {lat: projection.lat, lon: projection.lon});
      return;
    }
    addNavigationDetourPoint(point);
    return;
  }
  const nearbyVia = state.navigationViaPoints.findIndex(item => !item.hidden && state.map.distance([item.lat, item.lon], [point.lat, point.lon]) < 45);
  if (nearbyVia >= 0) {
    state.navigationViaPoints.splice(nearbyVia, 1);
    syncNavigationRouteEdits();
    recalculateNavigationRoute('Étape supprimée.');
    return;
  }
  const projection = nearestRouteProjection(point);
  const onRoute = Boolean(projection && projection.distance < 65);
  const startAction = onRoute ? 'Démarrer le détour ici'
    : projection && projection.distance <= 100 ? 'Démarrer depuis le tracé le plus proche' : 'Choisir un point près du tracé';
  const popup = L.popup({closeButton: true, className: 'nav-map-actions', offset: [0, -8]})
    .setLatLng([point.lat, point.lon])
    .setContent('<div class="nav-map-action-card"><strong>' + (onRoute ? 'Créer un détour' : 'Préparer un détour') + '</strong>' + (onRoute ? '<button type="button" data-nav-action="avoid">Interdire ce passage</button>' : '') + '<button type="button" data-nav-action="detour">' + startAction + '</button></div>')
    .openOn(state.map);
  document.body.classList.add('nav-action-open');
  state.map.once('popupclose', () => document.body.classList.remove('nav-action-open'));
  const element = popup.getElement();
  element?.querySelectorAll('[data-nav-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.navAction;
    if (action === 'avoid' && onRoute) {
      state.navigationAvoids.push({lat: point.lat, lon: point.lon});
      syncNavigationRouteEdits();
      recalculateNavigationRoute('Passage interdit ajouté. Recherche d’un détour.');
    } else if (action === 'detour') {
      startNavigationDetour(point);
    }
    state.map.closePopup();
  }));
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

async function recalculateNavigationRoute(message = 'Parcours recalculé.', rejoinNearestRoute = false) {
  if (!state.route || !state.destination || !state.map || !document.body.classList.contains('nav-active')) return;
  state.navigationRerouteController?.abort();
  const controller = new AbortController();
  state.navigationRerouteController = controller;
  const version = ++state.navigationRerouteVersion;
  const center = state.map.getCenter(), zoom = state.map.getZoom();
  const origin = state.lastPosition || state.origin;
  const previousViaPoints = state.navigationViaPoints.map(item => ({...item}));
  if (rejoinNearestRoute) {
    const projection = nearestRouteProjection(origin, Math.max(0, state.navigationProgress - 0.015));
    if (projection) {
      const laterVias = state.navigationViaPoints.filter(item => !item.hidden && Number(item.progress) > projection.progress + 0.002);
      state.navigationViaPoints = [{lat: projection.lat, lon: projection.lon, progress: projection.progress, hidden: true}, ...laterVias];
    }
  }
  // Les étapes sont remises en ordre le long du tracé pour garder les segments cohérents.
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
    state.navigationProgress = 0;
    state.routeStartDistanceTravelled = state.distanceTravelledMeters;
    drawRoute();
    state.map.setView(center, zoom, {animate: false});
    renderNavigationPoints();
    updateNavigation({coords: {latitude: origin.lat, longitude: origin.lon, accuracy: 10, speed: 0}, timestamp: Date.now()});
    persistNavigationResume(true);
    toast(message);
  } catch (error) {
    if (controller.signal.aborted || version !== state.navigationRerouteVersion) return;
    state.navigationViaPoints = previousViaPoints;
    syncNavigationRouteEdits();
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
  const routeProjectionNow = nearestRouteProjection(point, Math.max(0, state.navigationProgress - 0.015));
  if (routeProjectionNow && routeProjectionNow.distance < 180) state.navigationProgress = Math.max(state.navigationProgress, routeProjectionNow.progress);

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
  const displaySpeed = state.units === 'imperial' ? state.currentSpeedKmh / 1.609344 : state.currentSpeedKmh;
  $('#nav-speed').textContent = String(Math.round(displaySpeed));
  $('#nav-speed-unit').textContent = localizedText(state.units === 'imperial' ? 'mph' : 'km/h');
  $('#nav-travelled').textContent = formatDistance(state.distanceTravelledMeters);
  $('#nav-remaining').textContent = formatDistance(remainingMeters);
  $('#nav-rider').classList.toggle('is-moving', state.currentSpeedKmh >= 1.5);
  const averageSpeed = state.movingSeconds >= 20 && state.movingDistanceMeters >= 60
    ? state.movingDistanceMeters / state.movingSeconds * 3.6 : 0;
  const displayAverage = state.units === 'imperial' ? averageSpeed / 1.609344 : averageSpeed;
  $('#nav-speed-average').textContent = averageSpeed
    ? localizedText('Moyenne roulée') + ' · ' + Math.round(displayAverage) + (state.units === 'imperial' ? ' mph' : ' km/h')
    : localizedText('Analyse de votre vitesse…');
  $('#nav-arrival').textContent = averageSpeed && remainingMeters > 0
    ? new Date(sampleTime + remainingMeters / (averageSpeed / 3.6) * 1000).toLocaleTimeString(LANGUAGE_LOCALES[state.language] || 'fr-BE', {hour: '2-digit', minute: '2-digit'})
    : remainingMeters === 0 ? 'Arrivée' : 'Calcul en cours';
  $('#nav-gps-status').textContent = localizedText(state.currentSpeedKmh >= 1.5 ? 'En mouvement' : 'À l’arrêt') + ' · GPS ±' + formatProximity(accuracy);
  const routeHeading = routeBearingAtPoint(point);
  updateNavigationVehicleMarker(point, routeHeading);
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
  }
  // Le zoom peut rester manuel, mais dès que le GPS confirme un déplacement, la position revient au centre.
  if (state.navigationFollow || state.currentSpeedKmh >= 1.5) {
    state.map.panTo([point.lat, point.lon], {animate: false});
  }
  const closestRouteProjection = nearestRouteProjection(point, Math.max(0, state.navigationProgress - 0.015));
  const nearestRouteDistance = closestRouteProjection?.distance ?? Infinity;
  const offRouteThreshold = Math.max(65, accuracy * 2);
  if (state.routeLayer && !state.navigationDetour && !state.rerouting && now - state.lastRerouteAt > 8000 && nearestRouteDistance > offRouteThreshold) {
    state.rerouting = true; state.lastRerouteAt = now;
    toast('Écart détecté. Recalcul du parcours.');
    if (document.body.classList.contains('nav-active')) recalculateNavigationRoute('Itinéraire adapté à votre position.', true);
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
  state.manualDestinationLocked = Boolean(snapshot.manualDestinationLocked);
  state.navigationDetour = snapshot.navigationDetour || null;
  state.manualPoints = Array.isArray(snapshot.manualPoints) ? snapshot.manualPoints : [];
  state.manualLegs = Array.isArray(snapshot.manualLegs) ? snapshot.manualLegs : [];
  state.route = snapshot.route;
  state.navigationSegments = Array.isArray(snapshot.navigationSegments)
    ? snapshot.navigationSegments : (snapshot.route.navigationSegments || []);
  state.navigationAvoids = snapshot.navigationAvoids || snapshot.route.navigationAvoids || [];
  state.navigationViaPoints = snapshot.navigationViaPoints || snapshot.route.navigationViaPoints || [];
  state.lastPosition = snapshot.lastPosition || snapshot.origin;
  state.navigationProgress = Number(snapshot.navigationProgress) || 0;
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
    state.navigationProgress = 0;
    state.navigationDetour = null;
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
  if (state.navigationMarker && state.map?.hasLayer(state.navigationMarker)) state.map.removeLayer(state.navigationMarker);
  state.navigationMarker = null;
  document.body.classList.remove('nav-active', 'nav-action-open');
  state.navigationRerouteController?.abort(); state.navigationRerouteController = null; clearNavigationPointLayers();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.wakeLock) { try { await state.wakeLock.release(); } catch {} state.wakeLock = null; }
  $('#nav-panel').classList.add('hidden'); $('#map-mode-label').textContent = state.mode === 'family' ? state.familyFast ? 'OSM · VÉLO FAMILIAL · RAPIDE' : 'OSM · RAVeL & CHEMINS' : state.mode === 'road' ? 'OSM · VÉLO DE ROUTE · RAPIDE' : state.mode === 'vtt' ? 'OSM · ROUTE VTT' : 'OSM · MOTO · PETITES ROUTES';
  renderResumeTripCard();
  toast('Navigation terminée.');
}

function savedItem(route, index) {
  const safeTitle = escapeHtml(route.title);
  return `<div class="saved-item" data-route-index="${index}" role="button" tabindex="0" aria-label="Charger le trajet ${safeTitle}"><span class="saved-route-icon" aria-hidden="true">⌁</span><div class="saved-route-copy"><strong title="${safeTitle}">${safeTitle}</strong><span>${formatDistance(route.distance || 0)} · ${new Date(route.savedAt).toLocaleDateString(LANGUAGE_LOCALES[state.language] || 'fr-BE')}</span></div><button class="rename-saved" data-rename="${index}" aria-label="${localizedText('Renommer le trajet')} ${safeTitle}" title="${localizedText('Renommer le trajet')}">✎</button><button class="delete-saved" data-delete="${index}" aria-label="Supprimer ${safeTitle}">×</button></div>`;
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
    state.manualDestinationLocked = Boolean(route.manualDestinationLocked);
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
  state.manualDestinationLocked = false;
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
  document.querySelectorAll('[data-rename]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation(); renameSavedRoute(Number(button.dataset.rename));
  }));
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
function renameSavedRoute(index) {
  const route = state.saved[index];
  if (!route) return;
  const value = window.prompt(localizedText('Nouveau nom du trajet'), route.title);
  if (value === null) return;
  const title = value.trim();
  if (!title) return;
  route.title = title;
  saveSaved();
  toast(localizedText('Trajet renommé.'));
}
function saveSaved() { localStorage.setItem('ct_saved_routes', JSON.stringify(state.saved)); renderSaved(); }

function saveRoute() {
  if (!state.route) { toast('Aucun parcours à enregistrer.'); return; }
  state.saved.unshift({title: routeLabel(), distance: state.route.distanceMeters, savedAt: new Date().toISOString(), mode: state.mode, familyFast: state.mode === 'family' ? state.familyFast : undefined, manualPoints: state.route.manual ? state.manualPoints.map(point => ({lat: point.lat, lon: point.lon})) : undefined, manualReturnToStart: state.route.manual ? state.manualReturnToStart : undefined, manualDestinationLocked: state.route.manual ? state.manualDestinationLocked : undefined, origin: state.origin, destination: state.destination, originLabel: $('#origin-input').value, destinationLabel: $('#destination-input').value});
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
  button.title = follow ? 'Suivi GPS actif · Recentrer' : 'Zoom manuel · centrage automatique pendant le déplacement';
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
$('#language-select').addEventListener('change', event => updateLanguage(event.target.value));
$('#units-select').addEventListener('change', event => updateUnits(event.target.value));
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
$('#nav-detour-cancel').addEventListener('click', cancelNavigationDetour);
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
  const split = arrivalIntro.querySelector('.arrival-intro__split');
  const sourceScene = arrivalIntro.querySelector('.arrival-intro__scene');
  ['left', 'right'].forEach(side => {
    const pane = document.createElement('div');
    pane.className = 'arrival-intro__pane arrival-intro__pane--' + side;
    const sceneCopy = sourceScene.cloneNode(true);
    const gradient = sceneCopy.querySelector('linearGradient[id]');
    const track = sceneCopy.querySelector('.arrival-intro__track path');
    if (gradient) gradient.id = 'arrival-track-gradient-' + side;
    if (track) track.setAttribute('stroke', 'url(#arrival-track-gradient-' + side + ')');
    pane.append(sceneCopy);
    split.append(pane);
  });
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
applyLanguage();
updateUnits(state.units);
window.addEventListener('pagehide', () => persistNavigationResume(true));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
initializeMap();
