# Cross Travel

PWA en français pour préparer des itinéraires VTT, vélo familial et motocross sur une carte OpenStreetMap.

## Fonctionnalités

- Recherche assistée de lieux et adresses par Photon, avec suggestions pendant la saisie et choix de résultat sans adresse exacte.
- Départ depuis le GPS, saisie d’un lieu ou choix manuel sur la carte; même choix pour l’arrivée.
- Profil Vélo familial calculé par BRouter avec les mêmes bases de calcul que le VTT. La préférence pour les itinéraires cyclables et les chemins faciles est renforcée, avec une forte pénalité pour les routes. Le moteur peut toutefois garder un tronçon routier lorsqu’aucune alternative praticable n’existe dans les données OSM.
- Profil VTT calculé par BRouter (`mtb`), profil dédié au mountain bike. L’option « Priorité aux chemins et pistes » augmente le coût des routes et renforce nettement la préférence pour les itinéraires cyclables répertoriés, dont les RAVeL quand ils sont correctement cartographiés.
- Profil motocross calculé par Valhalla (`motorcycle`), avec `use_trails` et `use_tracks` au maximum et `use_highways` à zéro quand la priorité chemins est activée. Les accès moto connus dans OSM continuent de s’appliquer.
- Affichage des distances en kilomètres (le `track-length` BRouter, renvoyé en mètres, est converti correctement), guidage GPS, recalcul après écart et favoris locaux.
- Navigation plein écran avec instruction agrandie, synthèse vocale française activable, vitesse GPS instantanée, distance parcourue/restante, animation adaptée au mode choisi et heure d’arrivée estimée selon la vitesse moyenne en mouvement.
- Choix carte OpenStreetMap ou imagerie satellite depuis la carte d’accueil et pendant la navigation.
- Maintien de l’écran si le navigateur autorise Wake Lock.
- Export du tracé en GPX pour import manuel dans OsmAnd; lien vers Wikiloc pour la recherche externe de traces.
- Interface installable comme PWA.

## Sources de données et limites

La carte d’accueil et la navigation proposent le fond OpenStreetMap ou l’imagerie satellite Esri. La carte est dessinée avec Leaflet et les tuiles standards `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; l’attribution OpenStreetMap reste visible. Les tuiles et les services de calcul nécessitent une connexion et ne sont pas téléchargés pour l’usage hors ligne.

La recherche d’adresse utilise l’API Photon publique de Komoot avec une limite de résultats et un biais vers le centre de carte. Le service public peut limiter les requêtes et n’offre pas de garantie de disponibilité.

Pour les trajets vélo familiaux, BRouter utilise le profil de calcul `mtb` avec `path_preference=100`, `cycleroutes_pref=5.0` et l’option `avoid_unsafe`. Ces préférences favorisent les itinéraires cyclables et chemins faciles tout en réduisant fortement l’usage des routes; elles ne garantissent pas l’absence totale de routes.

BRouter est appelé via `https://brouter.de/brouter` avec le profil `mtb` pour le VTT. Cross Travel augmente `path_preference` et `cycleroutes_pref` quand la priorité aux chemins est activée; cela peut favoriser les parcours RAVeL encodés comme itinéraires cyclables. Le profil `mtb` est distinct du profil `trekking` de randonnée à vélo. Le tracé dépend de la qualité des données OSM : il ne garantit ni l’ouverture actuelle, ni la praticabilité, ni l’adéquation du niveau technique.

Le calcul motocross/enduro utilise Valhalla et le profil moto. Les réglages pistes et grands axes ajustent les préférences du moteur; le profil doit respecter les accès motorisés connus dans les données OSM. Un chemin autorisé aux vélos, un RAVeL ou un sentier forestier n’est pas automatiquement autorisé aux motos. Cross Travel n’ajoute pas volontairement de voies interdites aux véhicules motorisés. Vérifiez les panneaux, arrêtés, autorisations privées et conditions sur place.

Wikiloc ne fournit pas d’API publique d’import de traces à l’application : le lien ouvre sa recherche dans un nouvel onglet. L’export GPX sert à importer le parcours dans OsmAnd (ou une application compatible). OsmAnd n’est pas lancé automatiquement par le site.

Les distances sont affichées en kilomètres. La propriété `track-length` de BRouter étant fournie en mètres, elle est conservée dans son unité avant l’affichage.

Les indications moto utilisent les manœuvres envoyées par Valhalla. Pour le VTT, Cross Travel déduit des indications de virage approximatives de la géométrie BRouter; elles ne remplacent pas l’observation du tracé sur la carte. La synthèse vocale française du navigateur annonce les instructions en approche; le bouton **Voix activée / Voix coupée** la contrôle. La durée VTT est une estimation lorsque le moteur ne fournit pas de temps. En navigation plein écran, le guidage vocal annonce les instructions en français; vitesse instantanée, distance parcourue/restante et heure d’arrivée estimée selon la vitesse moyenne en mouvement sont affichées. L’illustration correspondant au mode choisi s’anime pendant le déplacement et s’arrête à l’arrêt.

## Configuration

Le serveur Valhalla par défaut est `https://valhalla1.openstreetmap.de/route`. Il est fourni sans garantie de disponibilité ou de capacité. L’adresse peut être remplacée dans **Paramètres**. BRouter et Photon utilisent leurs services publics par défaut.

Les favoris et les préférences de mode restent dans le stockage local du navigateur. Les requêtes transmettent les lieux recherchés à Photon et les coordonnées choisies au moteur de calcul correspondant.

## Lancer et publier

Application statique sans compilation. Pour le développement local, servez le dossier sur `localhost`; le GPS, Wake Lock et les fonctionnalités PWA demandent HTTPS (ou `localhost`). Le workflow `.github/workflows/pages.yml` publie le site sur GitHub Pages après activation de **Settings → Pages → Build and deployment → GitHub Actions**.

Ne manipulez pas l’écran en roulant. Le GPS, le maintien de l’écran et la réception des données dépendent du téléphone, du navigateur, du réseau et de la batterie.
