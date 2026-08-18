# Carte des points d'intérêt à Toulouse

Ce projet affiche une carte interactive des structures d'inclusion et services sociaux situés à Toulouse, extraits du fichier GeoJSON `structures-inclusion-2026-08-17.geojson`.

## Structure du projet

- **index.html** : Page principale avec la carte Leaflet
- **app.js** : Script JavaScript pour la gestion de la carte et des marqueurs
- **styles.css** : Styles CSS personnalisés
- **toulouse_points.json** : Données GeoJSON filtrées pour Toulouse uniquement (592 points)
- **structures-inclusion-2026-08-17.geojson** : Fichier source complet

## Fonctionnalités

- Carte interactive centrée sur Toulouse
- Affichage de 592 points d'intérêt (structures d'inclusion)
- Regroupement des marqueurs (clustering) pour une meilleure lisibilité
- Popups détaillés avec informations sur chaque point :
  - Nom de la structure
  - Adresse et code postal
  - Téléphone, email, site web
  - Description (si disponible)
  - Source des données
- Icônes colorées selon la source des données
- Design responsive

## Technologies utilisées

- **Leaflet** : Bibliothèque de cartographie open source
- **Leaflet.markercluster** : Plugin pour le regroupement des marqueurs
- **OpenStreetMap** : Fond de carte
- **Vanilla JavaScript** : Pas de framework nécessaire

## Comment utiliser

1. Ouvrez simplement le fichier `index.html` dans un navigateur web
2. La carte se chargera automatiquement et affichera tous les points d'intérêt à Toulouse
3. Zoomez pour voir les marqueurs individuels
4. Cliquez sur un marqueur pour voir les détails

## Personnalisation

Pour modifier les données affichées :
- Modifiez le fichier `toulouse_points.json` ou régénérez-le à partir du fichier source
- Vous pouvez aussi modifier le script d'extraction dans le code Node.js

Pour changer le style :
- Modifiez le fichier `styles.css`

Pour ajouter des fonctionnalités :
- Modifiez le fichier `app.js`

## Génération des données

Les données ont été extraites avec la commande :
```javascript
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('structures-inclusion-2026-08-17.geojson', 'utf8'));
const toulousePoints = data.features.filter(f => f.properties.commune === 'Toulouse');
fs.writeFileSync('toulouse_points.json', JSON.stringify(toulousePoints, null, 2));
```

## Auteur

Créé par Vibe Code pour le projet carte_fatou
