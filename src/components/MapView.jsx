import React, { useState, useEffect, useRef, useCallback } from "react";
import georaster from "georaster";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  useMapEvents,
  Rectangle,
  Marker,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import geoblaze from "geoblaze";
import * as turf from "@turf/turf";
import axios from "axios";
import Sidebar from "./Sidebar";
import GeoRasterLayer from "georaster-layer-for-leaflet";

// --- NEW SEARCH IMPORTS ---
import "leaflet-control-geocoder/dist/Control.Geocoder.css";
import "leaflet-control-geocoder";

const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY;

// Fix for default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const categoryColors = {
  other: "#3b82f6",
  "neighbourhood shops": "#10b981",
  mobility: "#ffbf50",
  sports: "#8b5cf6",
  education: "#ff0101",
  "open leisure": "#f97316",
  healthcare: "#ff6bbc",
  "cultural entertainment": "#f1fd4b",
  "neighbourhood services": "#9600aa",
};

const getKdeColor = (val) => {
  if (val <= 0 || isNaN(val)) return "transparent";
  if (val < 0.0005) return "#3b0f70";
  if (val < 0.003) return "#1f6ae1";
  if (val < 0.007) return "#00b4d8";
  if (val < 0.02) return "#52c569";
  if (val < 0.05) return "#f4e61e";
  if (val < 0.1) return "#f8961e";
  return "#d62828";
};

const getLandUseColor = (val) => {
  if (val <= 0.0 || isNaN(val)) return "transparent";
  if (val < 0.23) return "#2b83ba";
  if (val < 0.43) return "#abdda4";
  if (val < 0.63) return "#ffffbf";
  if (val < 0.84) return "#fdae61";
  return "#d7191c";
};

const PROVINCE_LANDMIX_MAP = {
  "Baden-Württemberg": "Baden_LandMix_WGS84.tif",
  "Bayern": "Bayern_LandMix_WGS84.tif",
  "Berlin": "Land_Use_Mix_Grid_Berlin_WGS84.tif",
  "Brandenburg": "BrendenBerg_Land_Use_Mix_Grid_WGS84.tif",
  "Bremen": "Bermen_LandMix_WGS84.tif",
  "Hamburg": "Hamburg_LandMix_WGS84.tif",
  "Hessen": "Hessen_LandMix_WGS84.tif",
  "Mecklenburg-Vorpommern": "Mecklenburg_LandMix_WGS84.tif",
  "Niedersachsen": "Niedersachsen_LandMix_WGS84.tif",
  "Nordrhein-Westfalen": "Nordrhein_LandMix_WGS84.tif",
  "Rheinland-Pfalz": "Rheinland_Pfalz_LandMix_WGS84.tif",
  "Saarland": "Land_Use_Mix_Grid_WGS84.tif",
  "Sachsen": "Sachsen_LandMix_WGS84.tif",
  "Sachsen-Anhalt": "Sachsen_Anhalt_LandMix_WGS84.tif",
  "Schleswig-Holstein": "Schleswig_LandMix_WGS84.tif",
  "Thüringen": "Thüringen_LandMix_WGS84.tif",
};

const spinnerStyles = `
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .map-loader {
    width: 20px; height: 20px; border: 3px solid rgba(99, 102, 241, 0.2);
    border-top: 3px solid #6366f1; border-radius: 50%;
    animation: spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  .premium-badge {
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(8px);
    color: white;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    display: flex;
    alignItems: center;
    gap: 10px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.1);
  }
  .leaflet-control-geocoder { 
    border-radius: 12px !important; 
    box-shadow: 0 8px 16px rgba(0,0,0,0.1) !important;
    border: 1px solid rgba(0,0,0,0.05) !important;
  }
`;

const fetchIsochrone = async (latlng, travelMode, rangeValue) => {
  try {
    const res = await axios.post(
      `https://api.openrouteservice.org/v2/isochrones/${travelMode}`,
      {
        locations: [[latlng.lng, latlng.lat]],
        range: [rangeValue],
        range_type: "time",
      },
      {
        headers: {
          Authorization: ORS_API_KEY,
          "Content-Type": "application/json",
        },
      },
    );
    return res.data.features[0].geometry;
  } catch {
    return turf.circle([latlng.lng, latlng.lat], (rangeValue / 60) * 0.07, {
      units: "kilometers",
    }).geometry;
  }
};

const isochroneCache = new Map();
const rasterCache = new Map();

async function getCachedGeoRaster(url) {
  if (rasterCache.has(url)) return rasterCache.get(url);
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const data = await georaster(buf);
  rasterCache.set(url, data);
  return data;
}

function SearchField({
  onLocationFound,
  setSelectedProvince,
  travelMode,
  rangeValue,
}) {
  const map = useMap();
  useEffect(() => {
    const geocoder = L.Control.Geocoder.nominatim();
    const control = L.Control.geocoder({
      query: "",
      placeholder: "Search address...",
      defaultMarkGeocode: false,
      geocoder,
    })
      .on("markgeocode", async (e) => {
        const { center } = e.geocode;
        // FAST: reduce animation duration
        map.flyTo(center, 15, { animate: true, duration: 0.6 });
        try {
          const res = await axios.get(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}&zoom=5`,
          );
          const detectedState =
            res.data.address.state || res.data.address.region;
          if (detectedState) setSelectedProvince(detectedState);
        } catch (err) {
          console.error("Province detection failed", err);
        }
        const geometry = await fetchIsochrone(center, travelMode, rangeValue);
        onLocationFound(center, geometry);
      })
      .addTo(map);
    return () => map.removeControl(control);
  }, [map, onLocationFound, setSelectedProvince, travelMode, rangeValue]);
  return null;
}

function MapController({ batchResults, isBatchMode, provinceData }) {
  const map = useMap();
  useEffect(() => {
    if (isBatchMode && batchResults.length > 0) {
      const best = batchResults[0].coords;
      map.flyTo([best.lat, best.lng], 14, { animate: true, duration: 0.6 });
    }
  }, [batchResults, isBatchMode, map]);

  useEffect(() => {
    if (provinceData && provinceData.features.length > 0) {
      const bbox = turf.bbox(provinceData);
      map.fitBounds(
        [
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]],
        ],
        { padding: [20, 20], animate: true, duration: 0.6 },
      );
    }
  }, [provinceData, map]);
  return null;
}

// SINGLE OVERLAY CONTROLLER — one layer at a time, synchronous swap, zero race conditions.
const OverlayController = React.memo(({ activeOverlay, fullKdeRaster, landUseRaster }) => {
  const map = useMap();
  const layerRef = useRef(null);
  const generationRef = useRef(0); // increments on every overlay switch

  useEffect(() => {
    // Bump the generation — any tile callbacks still running from the OLD layer
    // will see a stale generation and paint transparent instead, killing ghost tiles.
    const generation = ++generationRef.current;

    // Step 1: Destroy the current active layer immediately and synchronously
    if (layerRef.current) {
      if (map.hasLayer(layerRef.current)) {
        map.removeLayer(layerRef.current);
      }
      layerRef.current = null;
    }

    // Step 2: Also scan and nuke any stray raster layers that may have leaked
    map.eachLayer((l) => {
      if (l.options && l.options.georaster) {
        try { map.removeLayer(l); } catch (_) { }
      }
    });

    // Step 3: Determine which data and color function to use
    const data = activeOverlay === 'kde' ? fullKdeRaster
      : activeOverlay === 'landuse' ? landUseRaster
        : null;
    const colorFn = activeOverlay === 'kde' ? getKdeColor : getLandUseColor;

    if (!data) return;

    // Step 4: Build and add the ONE correct layer, guarded by generation
    try {
      const layer = new GeoRasterLayer({
        georaster: data,
        opacity: 0.65,
        pixelValuesToColorFn: (v) => {
          // If the overlay has been switched again since this layer was created,
          // return transparent so stale in-flight tiles don't ghost on screen.
          if (generationRef.current !== generation) return 'transparent';
          return colorFn(v[0]);
        },
        resolution: 96, // Optimistic reduction for speed
      });
      layer.addTo(map);
      layerRef.current = layer;
    } catch (err) {
      console.error("Raster render error:", err);
    }

    return () => {
      if (layerRef.current && map.hasLayer(layerRef.current)) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [activeOverlay, fullKdeRaster, landUseRaster, map]);

  return null;
});


const GridLayer = React.memo(({ visible, servicePoints, onGridSelect }) => {
  const [gridPoints, setGridPoints] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const map = useMap();
  const timerRef = useRef(null);

  const refreshGrid = useCallback(() => {
    if (!visible) {
      setGridPoints([]);
      return;
    }
    const zoom = map.getZoom();
    if (zoom < 11) {
      setGridPoints([]);
      return;
    }
    setIsLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const b = map.getBounds();
        const center = map.getCenter();
        const aspectCorrection = Math.cos(center.lat * (Math.PI / 180));
        const sizeKm = zoom >= 15 ? 0.1 : zoom >= 13 ? 0.4 : 1.2;
        const latStep = sizeKm / 111;
        const lngStep = sizeKm / (111 * aspectCorrection);
        const cells = [];
        for (let lat = b.getSouth(); lat < b.getNorth(); lat += latStep) {
          for (let lng = b.getWest(); lng < b.getEast(); lng += lngStep) {
            cells.push({
              id: `c-${lat.toFixed(4)}-${lng.toFixed(4)}`,
              center: [lat + latStep / 2, lng + lngStep / 2],
              geometry: turf.bboxPolygon([
                lng,
                lat,
                lng + lngStep,
                lat + latStep,
              ]).geometry,
              bounds: [
                [lat, lng],
                [lat + latStep, lng + lngStep],
              ],
            });
          }
        }
        setGridPoints(cells);
      } finally {
        setIsLoading(false);
      }
    }, 100); // Shorter debounce
  }, [visible, map]);

  useMapEvents({ moveend: refreshGrid, zoomend: refreshGrid });
  useEffect(() => {
    refreshGrid();
  }, [visible, refreshGrid]);

  if (!visible) return null;
  return (
    <>
      <style>{spinnerStyles}</style>
      {isLoading && (
        <div className="premium-badge">
          <div className="map-loader"></div> <span>CALCULATING URBAN DENSITY...</span>
        </div>
      )}
      {gridPoints.map((cell) => (
        <Rectangle
          key={cell.id}
          bounds={cell.bounds}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              onGridSelect(cell.geometry, { lat: cell.center[0], lng: cell.center[1] });
            },
          }}
          pathOptions={{
            color: "#64748b",
            weight: 0.5,
            fillColor: "transparent",
            fillOpacity: 0,
          }}
        />
      ))}
    </>
  );
});


const runSpatialAnalysis = (geometry, servicePoints, fullKdeRaster, customWeights = {}, isCustomWeightMode = false, sandboxPoints = []) => {
  if (!geometry || !servicePoints?.features || !fullKdeRaster)
    return {
      score: 0,
      count: 0,
      dist: {},
      breakdown: { density: 0, quantity: 0, diversity: 0 },
    };
  const poly = turf.feature(geometry);
  const bbox = turf.bbox(poly);
  let totalWeightedScore = 0,
    physicalCount = 0;
  const distribution = {};

  const pointsInBox = servicePoints.features.filter((f) => {
    const [lng, lat] = f.geometry.coordinates;
    return lng >= bbox[0] && lat >= bbox[1] && lng <= bbox[2] && lat <= bbox[3];
  });

  pointsInBox.forEach((f) => {
    if (turf.booleanPointInPolygon(f, poly)) {
      const p = f.properties;
      const major = p.major_cat?.trim().toLowerCase() || "other";

      const effectiveMajorWt = isCustomWeightMode && customWeights[major] !== undefined
        ? customWeights[major]
        : (Number(p.major_wt) || 1);

      totalWeightedScore += effectiveMajorWt * (Number(p.minor_wt) || 1);
      physicalCount++;

      const sub = p.fclass?.trim() || "unspecified";
      if (!distribution[major])
        distribution[major] = { total: 0, major_wt: p.major_wt || 1, subs: {} };
      distribution[major].total++;
      if (!distribution[major].subs[sub])
        distribution[major].subs[sub] = { count: 0, weight: p.minor_wt || 1 };
      distribution[major].subs[sub].count += 1;
    }
  });

  let avgKDE = 0;
  try {
    avgKDE = geoblaze.mean(fullKdeRaster, poly)[0] || 0;
  } catch {
    avgKDE = 0;
  }

  const densityComp = Math.sqrt(Math.min(avgKDE / 0.15, 1)) * 40;
  const quantityComp = Math.min(15 * Math.log10(totalWeightedScore + 1), 30);
  const sigCats = Object.keys(distribution).filter(
    (c) => c !== "other" && distribution[c].total >= 1,
  ).length;
  const diversityComp = Math.min((sigCats / 6) * 30, 30);

  return {
    score: Number(
      Math.min(densityComp + quantityComp + diversityComp, 100).toFixed(1),
    ),
    count: physicalCount,
    dist: distribution,
    breakdown: {
      density: densityComp,
      quantity: quantityComp,
      diversity: diversityComp,
    },
  };
};

function FastPointLayer({ data }) {
  const map = useMap();
  const layerRef = useRef(null);
  useEffect(() => {
    if (!data || !map) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    const canvasRenderer = L.canvas({ padding: 0.2 });
    layerRef.current = L.geoJson(data, {
      pointToLayer: (f, latlng) =>
        L.circleMarker(latlng, {
          radius: 1.5,
          fillColor:
            categoryColors[f.properties.major_cat?.trim().toLowerCase()] ||
            "#999",
          color: "#fff",
          weight: 0.2,
          fillOpacity: 0.7,
          renderer: canvasRenderer,
        }),
      interactive: false,
    }).addTo(map);
    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [data, map]);
  return null;
}

function MapClickHandler({
  onIsochrone,
  setMarkerPos,
  travelMode,
  rangeValue,
  isBatchMode,
  gridActive,
}) {
  const map = useMap();
  const isFetchingRef = useRef(false);

  useMapEvents({
    click: async (e) => {
      if (isBatchMode || gridActive || isFetchingRef.current) return;

      // PARALLEL: Start both map move and data fetch
      map.flyTo(e.latlng, 14, { animate: true, duration: 0.6 });
      setMarkerPos(e.latlng);

      isFetchingRef.current = true;
      try {
        const geometry = await fetchIsochrone(e.latlng, travelMode, rangeValue);
        onIsochrone(geometry);
      } finally {
        isFetchingRef.current = false;
      }
    },
  });
  return null;
}

export default function MapView() {
  const [servicePoints, setServicePoints] = useState(null);
  const [fullKdeRaster, setFullKdeRaster] = useState(null);
  const [isochrone, setIsochrone] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const [activeOverlay, setActiveOverlay] = useState(null); // 'kde', 'landuse', null
  const [showGrid, setShowGrid] = useState(false);
  const [showPois, setShowPois] = useState(true);
  const [showProvinceBoundaries, setShowProvinceBoundaries] = useState(true);
  const [germanyGeoJson, setGermanyGeoJson] = useState(null);
  const [analysis, setAnalysis] = useState({
    score: 0,
    count: 0,
    dist: {},
    breakdown: { density: 0, quantity: 0, diversity: 0 },
  });
  const [travelMode, setTravelMode] = useState("foot-walking");
  const [rangeValue, setRangeValue] = useState(900);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [markerPos, setMarkerPos] = useState(null);
  const [selectedProvince, setSelectedProvince] = useState("Berlin");
  const [isLoadingProvince, setIsLoadingProvince] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [areaPersona, setAreaPersona] = useState(null);
  const [customWeights, setCustomWeights] = useState({});
  const [isCustomWeightMode, setIsCustomWeightMode] = useState(false);
  const [landUseRaster, setLandUseRaster] = useState(null);

  const handleWeightChange = (category, weight) => {
    setCustomWeights(prev => ({
      ...prev,
      [category.toLowerCase()]: weight
    }));
  };

  useEffect(() => {
    fetch("https://spectacular-platypus-74985c.netlify.app/Germany.geojson")
      .then((r) => r.json())
      .then(setGermanyGeoJson);

    getCachedGeoRaster("/data/kde5.tif").then(setFullKdeRaster);
  }, []);

  useEffect(() => {
    if (!selectedProvince) return;
    setIsLoadingProvince(true);
    const url = `https://jocular-lollipop-614828.netlify.app/${encodeURIComponent(selectedProvince)}.geojson`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const optimized = data.features.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: { ...f.properties },
        }));
        setServicePoints({ ...data, features: optimized });
        setIsLoadingProvince(false);
      })
      .catch(() => setIsLoadingProvince(false));
  }, [selectedProvince]);

  useEffect(() => {
    if (activeOverlay !== 'landuse' || !selectedProvince) {
      setLandUseRaster(null);
      return;
    }
    const filename = PROVINCE_LANDMIX_MAP[selectedProvince];
    if (!filename) return;

    getCachedGeoRaster(`/data/land_use_mix/${filename}`)
      .then(setLandUseRaster)
      .catch((err) => console.error("Land Use Mix load err:", err));
  }, [selectedProvince, activeOverlay]);

  useEffect(() => {
    if (isochrone && !isBatchMode && servicePoints && fullKdeRaster) {
      setAnalysis(runSpatialAnalysis(isochrone, servicePoints, fullKdeRaster, customWeights, isCustomWeightMode));
    }
  }, [isochrone, isBatchMode, servicePoints, fullKdeRaster, customWeights, isCustomWeightMode]);

  const handleBatchRun = (coordString) => {
    const pairs = coordString
      .split(";")
      .filter((s) => s.trim())
      .map((p) => p.trim().split(","));
    const results = pairs
      .map((p, idx) => {
        const lat = parseFloat(p[0]),
          lng = parseFloat(p[1]);
        if (isNaN(lat) || isNaN(lng)) return null;
        const circle = turf.circle([lng, lat], rangeValue / 1000, {
          units: "kilometers",
        }).geometry;
        return {
          id: idx,
          coords: { lat, lng },
          geometry: circle,
          ...runSpatialAnalysis(circle, servicePoints, fullKdeRaster, customWeights, isCustomWeightMode),
        };
      })
      .filter((r) => r)
      .sort((a, b) => b.score - a.score);
    setBatchResults(results);
    if (results.length > 0) setIsochrone(results[0].geometry);
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <style>{spinnerStyles}</style>
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer
          center={[51.1657, 10.4515]}
          zoom={6}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />

          <SearchField
            travelMode={travelMode}
            rangeValue={rangeValue}
            setSelectedProvince={setSelectedProvince}
            onLocationFound={(latlng, geo) => {
              setMarkerPos(latlng);
              setIsochrone(geo);
            }}
          />

          {showProvinceBoundaries && germanyGeoJson && (
            <GeoJSON
              data={germanyGeoJson}
              style={() => ({
                // Render all boundaries with a consistent, visible style
                color: "#64748b", // Slate grey for borders
                weight: 1.5, // Clean, medium-thin line
                fillColor: "#94a3b8", // Light slate fill
                fillOpacity: 0.1, // Subtle background tint
              })}
              eventHandlers={{
                click: (e) => {
                  // Keeps the functionality to switch provinces by clicking the map
                  const provinceName = e.propagatedFrom.feature.properties.name;
                  if (provinceName) setSelectedProvince(provinceName);
                },
                mouseover: (e) => {
                  // Subtle highlight on hover to show interactivity
                  const layer = e.target;
                  layer.setStyle({
                    fillOpacity: 0.3,
                    color: "#0fbb26",
                  });
                },
                mouseout: (e) => {
                  const layer = e.target;
                  layer.setStyle({
                    fillOpacity: 0.1,
                    color: "#64748b",
                  });
                },
              }}
            >
              <Tooltip sticky>
                {(layer) => layer.feature.properties.name}
              </Tooltip>
            </GeoJSON>
          )}

          <MapController
            batchResults={batchResults}
            isBatchMode={isBatchMode}
            provinceData={servicePoints}
          />

          {/* SINGLE OVERLAY CONTROLLER: Always mounted, manages one layer at a time. 
              No mount/unmount races — layer swap is fully synchronous inside the effect. */}
          <OverlayController
            activeOverlay={activeOverlay}
            fullKdeRaster={fullKdeRaster}
            landUseRaster={landUseRaster}
          />

          <GridLayer
            visible={showGrid}
            servicePoints={servicePoints}
            onGridSelect={(geo, center) => {
              setIsochrone(geo);
              if (center) setMarkerPos(center);
            }}
          />
          {showPois && <FastPointLayer data={servicePoints} />}

          {isochrone && !isBatchMode && (
            <GeoJSON
              key={JSON.stringify(isochrone)}
              data={isochrone}
              style={{ color: "#3b82f6", weight: 2, fillOpacity: 0.1 }}
            />
          )}
          {markerPos && !isBatchMode && (
            <Marker position={markerPos}>
              {areaPersona && (
                <Tooltip permanent direction="bottom" className="persona-tooltip">
                  <div style={{ padding: "4px", minWidth: "120px" }}>
                    <div style={{ fontSize: "10px", color: "#6366f1", fontWeight: "bold", textTransform: "uppercase" }}>Target Persona</div>
                    <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>{areaPersona.name}</div>
                    <div style={{ fontSize: "10px", color: "#64748b", marginTop: "2px", lineHeight: "1.2" }}>{areaPersona.reason}</div>
                  </div>
                </Tooltip>
              )}
            </Marker>
          )}
          {isBatchMode &&
            batchResults.map((r, i) => (
              <GeoJSON
                key={r.id}
                data={r.geometry}
                style={{
                  color: i === 0 ? "#10b981" : "#ef4444",
                  weight: i === 0 ? 3 : 1,
                  fillOpacity: 0.1,
                }}
              >
                <Tooltip sticky direction="top">
                  #{i + 1}
                </Tooltip>
              </GeoJSON>
            ))}
          {aiRecommendations.map((rec, i) => (
            <Marker
              key={`rec-${i}`}
              position={[rec.lat, rec.lng]}
              icon={new L.Icon({
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
              })}
            >
              <Tooltip permanent direction="top" className="rec-tooltip">
                <div style={{ padding: "4px" }}>
                  <b style={{ color: "#854d0e" }}>✨ SUGGESTION</b><br />
                  <b>{rec.type}</b><br />
                  <small style={{ fontSize: "10px", color: "#666" }}>{rec.reason}</small>
                </div>
              </Tooltip>
            </Marker>
          ))}
          <MapClickHandler
            onIsochrone={setIsochrone}
            setMarkerPos={setMarkerPos}
            travelMode={travelMode}
            rangeValue={rangeValue}
            isBatchMode={isBatchMode}
            gridActive={showGrid}
          />
        </MapContainer>
      </div>
      <Sidebar
        {...{
          accessibilityScore: analysis.score,
          serviceDistribution: analysis.dist,
          categoryColors,
          isKdeVisible: activeOverlay === 'kde',
          onToggleKdePalette: () => setActiveOverlay(activeOverlay === 'kde' ? null : 'kde'),
          showGrid,
          onToggleGrid: () => setShowGrid(!showGrid),
          showProvinceBoundaries,
          onToggleBoundaries: () =>
            setShowProvinceBoundaries(!showProvinceBoundaries),
          travelMode,
          setTravelMode,
          rangeValue,
          setRangeValue,
          isBatchMode,
          setIsBatchMode,
          batchResults,
          onBatchRun: handleBatchRun,
          selectedProvince,
          setSelectedProvince,
          isLoadingProvince,
          onReset: () => {
            setIsochrone(null);
            setBatchResults([]);
            setAnalysis({
              score: 0,
              dist: {},
              breakdown: { density: 0, quantity: 0, diversity: 0 },
            });
            setMarkerPos(null);
            setAiRecommendations([]);
            setAreaPersona(null);
            setActiveOverlay(null);
          },
          onAiRecommendations: setAiRecommendations,
          onPersonaUpdate: setAreaPersona,
          areaPersona,
          markerPos,
          aiRecommendations,
          customWeights,
          isCustomWeightMode,
          setIsCustomWeightMode,
          onWeightChange: handleWeightChange,
          showLandUseMix: activeOverlay === 'landuse',
          onToggleLandUseMix: () => setActiveOverlay(activeOverlay === 'landuse' ? null : 'landuse'),
          showPois,
          onTogglePois: () => setShowPois(!showPois),
        }}
        isIsochroneActive={!!isochrone || batchResults.length > 0}
      />
    </div>
  );
}
