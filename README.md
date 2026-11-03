# Cross Travel

PWA en français pour préparer un itinéraire deux-roues motorisé et le suivre avec le GPS.

## Démarrer

Le site est statique : ouvrez `index.html` avec un serveur local ou déployez le dépôt avec GitHub Pages. Le service worker et les fonctions PWA nécessitent HTTPS (ou `localhost`).

## Google Maps Platform

Dans Google Cloud Console, activez la facturation et les API **Maps JavaScript API** et **Routes API**. Créez une clé limitée aux domaines de déploiement, puis ouvrez Paramètres dans Cross Travel et collez cette clé. Elle est stockée dans le stockage local de ce navigateur uniquement. Les requêtes Maps et Routes sont soumises aux tarifs, quotas et conditions Google.

Le calcul utilise `TWO_WHEELER` pour les motos, avec options pour éviter les grands axes et les péages. La disponibilité varie selon la région. Cette API calcule un itinéraire routier pour deux-roues ; elle ne fournit pas une base de pistes motocross et ne vérifie pas les droits de passage sur les chemins. L’application ne certifie donc ni la légalité ni l’état d’un sentier. Un chemin accessible aux vélos n’est pas nécessairement accessible aux motos.

## Fonctions

- Carte Google Maps, recherche de départ/arrivée par adresse, sélection de points sur la carte et départ depuis la position GPS.
- Calcul d’itinéraire deux-roues, évitement des grands axes et péages.
- Navigation GPS, instructions de direction, recentrage, recalcul après écart et verrouillage d’écran lorsque le navigateur le permet.
- Enregistrement local des parcours favoris.
- Cache de l’interface pour ouverture hors ligne. La carte et le calcul nécessitent une connexion et restent soumis aux règles Google Maps.
- Installation comme PWA sur les navigateurs compatibles.

## Déploiement GitHub Pages

Le workflow `.github/workflows/pages.yml` publie le contenu statique sur GitHub Pages à chaque mise à jour de `main`. Dans les réglages du dépôt, définissez **Pages → Build and deployment → Source: GitHub Actions** si le dépôt ne l’a pas déjà activé. Ensuite, configurez le domaine d’autorisation de la clé Google avec l’URL GitHub Pages.

## Limites et prudence

- Ce prototype n’a pas de fournisseur de données validées sur l’accès légal des motos aux chemins forestiers ou ruraux.
- Ne suivez pas une route sans vérifier la signalisation et les règles locales. Les routes générées sont indicatives et peuvent être inadaptées à l’état du terrain.
- Le GPS, l’écran allumé, la couverture réseau, la précision des instructions et l’autonomie dépendent du téléphone et du navigateur. Ne manipulez pas l’écran en roulant.
