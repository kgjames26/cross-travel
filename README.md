# Cross Travel

PWA en français pour préparer et suivre des itinéraires moto sur une carte OpenStreetMap.

## Carte et données

- La carte utilise Leaflet et les tuiles standards `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- L’attribution « © OpenStreetMap contributors » reste visible sur la carte.
- Les tuiles ne sont pas préchargées ni mises en cache par le service worker. Les tuiles standards OSM ne sont pas fournies pour les téléchargements hors ligne; la carte demande une connexion.
- La recherche d’adresses utilise Nominatim au moment du calcul uniquement, sans autocomplétion pendant la saisie, avec une pause entre requêtes.

## Calcul et navigation

Le calcul utilise le moteur de routage Valhalla avec le profil moto `motorcycle`. Le réglage « Favoriser pistes et chemins » ajuste `use_trails`; « Éviter les grands axes » ajuste `use_highways`. Le moteur respecte les règles d’accès présentes dans les données OpenStreetMap, mais le profil moto est en bêta et la base peut être incomplète ou ancienne. Aucun moteur ne peut garantir que le terrain, la signalisation ou une autorisation locale correspondent aux données. Vérifiez le passage avant de vous engager. Les chemins autorisés aux vélos ne sont pas automatiquement autorisés aux motos.

Le serveur public par défaut est `https://valhalla1.openstreetmap.de/route`. Il est fourni sans engagement de disponibilité ni de capacité. Pour un usage régulier ou public, configurez une instance Valhalla que vous contrôlez ou un fournisseur adapté. L’adresse du moteur peut être remplacée dans **Paramètres**.

La recherche d’adresse appelle le service public Nominatim. Elle se déclenche uniquement lors du calcul et respecte une cadence faible; ses règles d’usage et limites peuvent évoluer.

Fonctions incluses : choix des points par adresse, position GPS ou clic sur carte; calcul et affichage de route; instructions en direct; recalcul après écart; écran allumé si le navigateur permet Wake Lock; favoris stockés localement; interface installable comme PWA.

## Lancer et publier

Application statique sans compilation. Pour le développement local, servez le dossier sur `localhost`; les fonctions PWA et GPS demandent HTTPS (ou `localhost`). Le workflow `.github/workflows/pages.yml` publie le site sur GitHub Pages après activation de **Settings → Pages → Build and deployment → GitHub Actions**.

Les fichiers de l’application sont servis depuis GitHub Pages. Leaflet, les tuiles OSM, Nominatim et Valhalla sont des services externes; la carte et le calcul nécessitent une connexion. Le service worker met en cache uniquement l’interface Cross Travel.

## Vie privée et prudence

Les favoris et la configuration du moteur restent dans le stockage local du navigateur. Les coordonnées nécessaires à la recherche et au calcul sont envoyées à Nominatim et au serveur Valhalla configuré. Ne manipulez pas l’écran en roulant.
