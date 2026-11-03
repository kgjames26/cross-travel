# Cross Travel

PWA en français pour préparer des itinéraires VTT et motocross/enduro sur une carte OpenStreetMap.

## Fonctionnalités

- Recherche assistée de lieux et adresses par Photon, avec suggestions pendant la saisie et choix de résultat sans adresse exacte.
- Départ depuis le GPS, saisie d’un lieu ou choix manuel sur la carte; même choix pour l’arrivée.
- Profil VTT calculé par BRouter (profil `trekking`) pour privilégier les pistes, chemins et voies cyclables présents dans OSM.
- Profil motocross/enduro calculé par Valhalla (`motorcycle`), avec réglages pour éviter les grands axes et favoriser les voies adaptées aux véhicules motorisés selon les attributs OSM.
- Affichage du tracé, guidage GPS, recalcul après écart, favoris locaux et maintien de l’écran si le navigateur autorise Wake Lock.
- Export du tracé en GPX pour import manuel dans OsmAnd; lien vers Wikiloc pour la recherche externe de traces.
- Interface installable comme PWA.

## Sources de données et limites

La carte est dessinée avec Leaflet et les tuiles standards `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; l’attribution OpenStreetMap reste visible. Les tuiles et les services de calcul nécessitent une connexion et ne sont pas téléchargés pour l’usage hors ligne.

La recherche d’adresse utilise l’API Photon publique de Komoot avec une limite de résultats et un biais vers le centre de carte. Le service public peut limiter les requêtes et n’offre pas de garantie de disponibilité.

BRouter est appelé via `https://brouter.de/brouter` avec le profil `trekking` pour le VTT. Le profil et les cartes sont basés sur OSM et ne garantissent pas qu’un passage soit praticable ou ouvert à la date de sortie.

Le calcul motocross/enduro utilise Valhalla et le profil moto. Le réglage pistes ajuste les préférences du moteur; le profil doit respecter les accès motorisés connus dans les données OSM. Un chemin autorisé aux vélos, un RAVeL ou un sentier forestier n’est pas automatiquement autorisé aux motos. Cross Travel n’ajoute pas volontairement de voies interdites aux véhicules motorisés. Vérifiez les panneaux, arrêtés, autorisations privées et conditions sur place.

Wikiloc ne fournit pas d’API publique d’import de traces à l’application : le lien ouvre sa recherche dans un nouvel onglet. L’export GPX sert à importer le parcours dans OsmAnd (ou une application compatible). OsmAnd n’est pas lancé automatiquement par le site.

Les indications de guidage se basent sur les manœuvres envoyées par Valhalla. Le profil BRouter renvoie une géométrie de parcours; le guidage VTT de cette version affiche une instruction de suivi du tracé et la progression GPS, sans annonces détaillées de chaque virage.

## Configuration

Le serveur Valhalla par défaut est `https://valhalla1.openstreetmap.de/route`. Il est fourni sans garantie de disponibilité ou de capacité. L’adresse peut être remplacée dans **Paramètres**. BRouter et Photon utilisent leurs services publics par défaut.

Les favoris et les préférences de mode restent dans le stockage local du navigateur. Les requêtes transmettent les lieux recherchés à Photon et les coordonnées choisies au moteur de calcul correspondant.

## Lancer et publier

Application statique sans compilation. Pour le développement local, servez le dossier sur `localhost`; le GPS, Wake Lock et les fonctionnalités PWA demandent HTTPS (ou `localhost`). Le workflow `.github/workflows/pages.yml` publie le site sur GitHub Pages après activation de **Settings → Pages → Build and deployment → GitHub Actions**.

Ne manipulez pas l’écran en roulant. Le GPS, le maintien de l’écran et la réception des données dépendent du téléphone, du navigateur, du réseau et de la batterie.
