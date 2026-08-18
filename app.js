// Script principal pour la carte Leaflet

// Variables globales
let allMarkers = [];
let currentFilter = '';

// Configuration pour l'API Tisseo
const TISSEO_API_KEY = '46cb1cc7-907c-4d9a-a39a-00f4be153433';
const TISSEO_API_URL = 'https://api.tisseo.fr/v2';
const TRANSPORT_RADIUS = 300; // Rayon en mètres

// Proxy CORS pour contourner les restrictions
const CORS_PROXY = 'https://cors-anywhere.herokuapp.com/';

// Cache pour les requêtes de transport (éviter les doublons)
const transportCache = new Map();

// Initialisation de la carte
function initMap() {
    const map = L.map('map').setView([43.6045, 1.4442], 12);

    // Ajout du fond de carte OpenStreetMap France (pas de restriction referer)
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles by <a href="https://openstreetmap.fr">OSM France</a>'
    }).addTo(map);

    // Création d'un groupe de marqueurs avec clustering
    const markers = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        iconCreateFunction: function(cluster) {
            return L.divIcon({
                html: '<div><span>' + cluster.getChildCount() + '</span></div>',
                className: 'marker-cluster marker-cluster-' + getClusterSizeClass(cluster.getChildCount()),
                iconSize: L.point(40, 40)
            });
        }
    });

    // Chargement des données GeoJSON
    loadGeoJSONData(map, markers);

    // Initialisation des filtres
    initFilters(map, markers);

    return map;
}

// Détermine la classe de taille pour le cluster
function getClusterSizeClass(count) {
    if (count < 10) return 'small';
    if (count < 50) return 'medium';
    return 'large';
}

// Charge les données GeoJSON et crée les marqueurs
function loadGeoJSONData(map, markers) {
    fetch('toulouse_points.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Erreur de chargement des données');
            }
            return response.json();
        })
        .then(data => {
            processFeatures(data, markers);
            map.addLayer(markers);
            
            // Ajustement de la vue pour inclure tous les marqueurs
            if (markers.getLayers().length > 0) {
                map.fitBounds(markers.getBounds(), { padding: [50, 50] });
            }
            
            // Mise à jour des statistiques
            updateFilterStats(allMarkers.length, allMarkers.length);
        })
        .catch(error => {
            console.error('Erreur:', error);
            showErrorMessage(map);
        });
}

// Traite chaque feature et crée les marqueurs
function processFeatures(features, markers) {
    // D'abord créer tous les marqueurs sans attendre les infos de transport
    features.forEach(feature => {
        const props = feature.properties;
        
        // Vérification que geometry existe et a des coordinates
        if (!feature.geometry || !feature.geometry.coordinates) {
            console.warn('Feature sans geometry valide:', props.nom || props.id);
            return;
        }
        
        const coords = feature.geometry.coordinates;
        
        if (coords && coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
            const lat = coords[1];
            const lng = coords[0];
            
            // Créer le marqueur immédiatement
            const popupContent = createPopupContent(props);
            const marker = L.marker([lat, lng], {
                title: props.nom || 'Point d\'intérêt',
                icon: createCustomIcon(props),
                properties: props,
                feature: feature
            }).bindPopup(popupContent);

            // Stocker le marqueur et ses propriétés
            allMarkers.push({
                marker: marker,
                properties: props,
                layer: marker,
                lat: lat,
                lng: lng
            });

            markers.addLayer(marker);
        }
    });
    
    // Ensuite, charger les infos de transport pour chaque marqueur
    // On limite à 5 requêtes simultanées pour éviter de surcharger l'API
    let requestCount = 0;
    const maxSimultaneousRequests = 5;
    
    function loadTransportForMarker(index) {
        if (index >= allMarkers.length) return;
        
        const item = allMarkers[index];
        
        // Vérifier si on a déjà les infos en cache
        const cacheKey = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
        if (transportCache.has(cacheKey)) {
            item.properties.transport = transportCache.get(cacheKey);
            const popupContent = createPopupContent(item.properties);
            item.marker.setPopupContent(popupContent);
            
            // Passer au suivant
            if (index + 1 < allMarkers.length) {
                loadTransportForMarker(index + 1);
            }
            return;
        }
        
        requestCount++;
        
        fetchNearbyStops(item.lat, item.lng)
            .then(transportInfo => {
                // Mettre en cache
                transportCache.set(cacheKey, transportInfo);
                
                item.properties.transport = transportInfo;
                // Mettre à jour le popup avec les infos de transport
                const popupContent = createPopupContent(item.properties);
                item.marker.setPopupContent(popupContent);
            })
            .catch(error => {
                console.error('Erreur transport pour', item.properties.nom, ':', error);
            })
            .finally(() => {
                requestCount--;
                // Passer au suivant
                if (index + 1 < allMarkers.length && requestCount < maxSimultaneousRequests) {
                    loadTransportForMarker(index + 1);
                }
            });
        
        // Lancer la prochaine requête si possible
        if (requestCount < maxSimultaneousRequests) {
            setTimeout(() => loadTransportForMarker(index + 1), 100);
        }
    }
    
    // Démarrer le chargement des infos de transport
    if (allMarkers.length > 0) {
        loadTransportForMarker(0);
    }
}

// Récupère les arrêts de transport à proximité via l'API Tisseo avec proxy CORS
function fetchNearbyStops(lat, lng) {
    const url = `${TISSEO_API_URL}/stop_points.json?key=${TISSEO_API_KEY}&lat=${lat}&lon=${lng}&distance=${TRANSPORT_RADIUS}`;
    
    // Utiliser le proxy CORS
    const proxyUrl = CORS_PROXY + url;
    
    return fetch(proxyUrl, {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('Erreur API Tisseo: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            const lines = new Set();
            const stops = new Set();
            
            // Extraire les informations de transport
            if (data.physicalStops && data.physicalStops.physicalStop) {
                data.physicalStops.physicalStop.forEach(stop => {
                    // Ajouter le nom de l'arrêt
                    if (stop.name) {
                        stops.add(stop.name);
                    }
                    
                    // Ajouter les lignes (en filtrant les codes internes)
                    if (stop.lines) {
                        stop.lines.forEach(line => {
                            if (line && line.short_name) {
                                const lineName = line.short_name.trim();
                                // Filtrer les codes internes (comme CHAUM3, NAVES2, etc.)
                                if (isValidLineName(lineName)) {
                                    lines.add(lineName);
                                }
                            }
                        });
                    }
                });
            }
            
            return {
                stops: Array.from(stops).slice(0, 5), // Max 5 arrêts
                lines: Array.from(lines).sort().slice(0, 10) // Max 10 lignes
            };
        })
        .catch(error => {
            console.error('Erreur API Tisseo:', error);
            // Retourner des données vides en cas d'erreur
            return { stops: [], lines: [] };
        });
}

// Vérifie si un nom de ligne est valide (pas un code interne)
function isValidLineName(lineName) {
    // Garder les lignes numériques (1-999)
    if (/^[0-9]{1,3}$/.test(lineName)) {
        return true;
    }
    
    // Garder les lettres simples (A, B, C, etc.)
    if (/^[A-Z]$/.test(lineName)) {
        return true;
    }
    
    // Garder les lignes de type L1, L2, ..., L20
    if (/^L[0-9]{1,2}$/.test(lineName)) {
        return true;
    }
    
    // Garder les lignes de type T1, T2 (tram)
    if (/^T[0-9]$/.test(lineName)) {
        return true;
    }
    
    // Garder les lignes spéciales connues
    const specialLines = ['AERO', 'DIRECT', 'NFEN', 'CIMTR'];
    if (specialLines.includes(lineName)) {
        return true;
    }
    
    return false;
}

// Initialise les filtres
function initFilters(map, markers) {
    const filterInput = document.getElementById('reseaux-filter');
    const resetBtn = document.getElementById('reset-filter');
    
    // Écouteur pour le champ de recherche
    filterInput.addEventListener('input', function() {
        currentFilter = this.value.toLowerCase().trim();
        applyFilter(markers);
    });
    
    // Écouteur pour le bouton de réinitialisation
    resetBtn.addEventListener('click', function() {
        filterInput.value = '';
        currentFilter = '';
        applyFilter(markers);
    });
}

// Applique le filtre aux marqueurs
function applyFilter(markers) {
    const filterTerms = currentFilter.split(',').map(t => t.trim()).filter(t => t.length > 0);
    
    if (filterTerms.length === 0) {
        // Aucun filtre, tout afficher
        allMarkers.forEach(item => {
            markers.addLayer(item.marker);
        });
        updateFilterStats(allMarkers.length, allMarkers.length);
        return;
    }
    
    // Filtrer les marqueurs
    let visibleCount = 0;
    allMarkers.forEach(item => {
        const props = item.properties;
        const reseaux = props.reseaux_porteurs || [];
        
        // Vérifier si au moins un terme de filtre correspond exactement
        const matches = filterTerms.some(term => {
            return reseaux.some(r => r && r.toLowerCase() === term);
        });
        
        if (matches) {
            markers.addLayer(item.marker);
            visibleCount++;
        } else {
            markers.removeLayer(item.marker);
        }
    });
    
    // Mise à jour des statistiques
    updateFilterStats(visibleCount, allMarkers.length);
    
    // Rafraîchir les clusters
    markers.refreshClusters();
}

// Met à jour les statistiques de filtre
function updateFilterStats(visible, total) {
    const visibleEl = document.getElementById('total-count');
    const totalEl = document.getElementById('all-count');
    
    if (visibleEl) visibleEl.textContent = visible;
    if (totalEl) totalEl.textContent = total;
}

// Crée le contenu du popup
function createPopupContent(props) {
    let content = `<div class="popup-content">`;
    
    if (props.nom) {
        content += `<h3 style="margin: 0 0 10px 0; color: #2c3e50;">${escapeHtml(props.nom)}</h3>`;
    }
    
    if (props.adresse) {
        content += `<p style="margin: 5px 0;"><strong>Adresse:</strong> ${escapeHtml(props.adresse)}</p>`;
    }
    
    if (props.code_postal) {
        content += `<p style="margin: 5px 0;"><strong>Code postal:</strong> ${escapeHtml(props.code_postal)}</p>`;
    }
    
    if (props.telephone) {
        content += `<p style="margin: 5px 0;"><strong>Téléphone:</strong> ${escapeHtml(props.telephone)}</p>`;
    }
    
    if (props.courriel) {
        content += `<p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:${escapeHtml(props.courriel)}">${escapeHtml(props.courriel)}</a></p>`;
    }
    
    if (props.site_web) {
        content += `<p style="margin: 5px 0;"><strong>Site web:</strong> <a href="${escapeHtml(props.site_web)}" target="_blank">${escapeHtml(props.site_web)}</a></p>`;
    }
    
    if (props.reseaux_porteurs && props.reseaux_porteurs.length > 0) {
        content += `<p style="margin: 5px 0;"><strong>Réseaux porteurs:</strong> ${escapeHtml(props.reseaux_porteurs.join(', '))}</p>`;
    }
    
    // Ajouter les informations de transport si disponibles
    if (props.transport && props.transport.lines.length > 0) {
        content += `<p style="margin: 5px 0;"><strong>Lignes à proximité:</strong> ${escapeHtml(props.transport.lines.join(', '))}</p>`;
    } else if (props.transport && props.transport.stops.length > 0) {
        content += `<p style="margin: 5px 0;"><strong>Arrêts à proximité:</strong> ${escapeHtml(props.transport.stops.join(', '))}</p>`;
    }
    
    if (props.description) {
        const shortDesc = props.description.length > 300 
            ? props.description.substring(0, 300) + '...' 
            : props.description;
        content += `<p style="margin: 10px 0 0 0; font-size: 13px; color: #666;">${escapeHtml(shortDesc)}</p>`;
    }
    
    if (props.source) {
        content += `<p style="margin: 10px 0 0 0; font-size: 12px; color: #999;"><em>Source: ${escapeHtml(props.source)}</em></p>`;
    }
    
    content += `</div>`;
    return content;
}

// Échappe les caractères HTML pour éviter les problèmes de sécurité
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Crée une icône personnalisée pour les marqueurs
function createCustomIcon(props) {
    // Couleurs différentes selon la source
    let iconUrl = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-';
    
    switch(props.source) {
        case 'france-travail':
            iconUrl += 'blue.png';
            break;
        case 'dora':
            iconUrl += 'green.png';
            break;
        case 'emplois-de-linclusion':
            iconUrl += 'orange.png';
            break;
        case 'carif-oref':
            iconUrl += 'violet.png';
            break;
        case 'mediation-numerique':
            iconUrl += 'red.png';
            break;
        default:
            iconUrl += 'grey.png';
    }
    
    return L.icon({
        iconUrl: iconUrl,
        iconRetinaUrl: iconUrl,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });
}

// Affiche un message d'erreur
function showErrorMessage(map) {
    const errorMessage = L.divIcon({
        className: 'error-message',
        html: '<div style="background: white; padding: 20px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.2); text-align: center;"><h3 style="color: #e74c3c; margin: 0 0 10px 0;">Erreur de chargement</h3><p style="margin: 0; color: #666;">Impossible de charger les données GeoJSON</p></div>',
        iconSize: [300, 100]
    });
    
    L.marker(map.getCenter(), { icon: errorMessage }).addTo(map);
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    window.map = initMap();
});
