import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";

const DEFAULT_CENTER = [59.9139, 10.7522];
const DEFAULT_ZOOM = 10;

// --- Masterdata
const stations = [
  { id: "S1", name: "S1 Ski",         lat: 59.7195,    lng: 10.8350 },
  { id: "S2", name: "S2 Oppegård",    lat: 59.79516,   lng: 10.8235 },
  { id: "S3", name: "S3 Korsegården", lat: 59.6597191, lng: 10.7258981 },
  { id: "M1", name: "M1 Moss",        lat: 59.4425,    lng: 10.6831 },
  { id: "M2", name: "M2 Rygge",       lat: 59.394353,  lng: 10.732076 },
  { id: "M3", name: "M3 Såner",       lat: 59.5305779, lng: 10.7505367 },
];

const resourcesMaster = [
  { id: "S11", callSign: "S11", type: "Mannskapsbil", stationId: "S1" },
  { id: "S13", callSign: "S13", type: "Høyde",        stationId: "S1" },
  { id: "S14", callSign: "S14", type: "Tankbil",      stationId: "S1" },

  { id: "S21", callSign: "S21", type: "Mannskapsbil", stationId: "S2" },

  { id: "S31", callSign: "S31", type: "Mannskapsbil", stationId: "S3" },
  { id: "S34", callSign: "S34", type: "Tankbil",      stationId: "S3" },

  { id: "M11", callSign: "M11", type: "Mannskapsbil", stationId: "M1" },
  { id: "M13", callSign: "M13", type: "Høyde",        stationId: "M1" },
  { id: "M14", callSign: "M14", type: "Tankbil",      stationId: "M1" },

  { id: "M21", callSign: "M21", type: "Mannskapsbil", stationId: "M2" },
  { id: "M24", callSign: "M24", type: "Tankbil",      stationId: "M2" },

  { id: "M31", callSign: "M31", type: "Mannskapsbil", stationId: "M3" },
  { id: "M34", callSign: "M34", type: "Tankbil",      stationId: "M3" },
];

const C = {
  bg: "#0b1220",
  panel: "#0f172a",
  card: "#111c33",
  border: "rgba(255,255,255,0.10)",
  text: "#e5e7eb",
  muted: "rgba(229,231,235,0.70)",
  accent: "#93c5fd",
  danger: "rgba(248,113,113,0.95)",
  alarmBg: "rgba(220,38,38,0.18)",
  alarmBorder: "rgba(248,113,113,0.55)",
};

const ARRIVE_THRESHOLD_METERS = 80;
const INCIDENT_ASSIGN_RADIUS_METERS = 300;
const DRAG_START_PX = 6;

function labelBoxHtml(text, tone = "normal") {
  const solved = tone === "solved";
  return `
    <div style="
      font-weight:900;
      font-size:12px;
      line-height:1.1;
      color:${solved ? "rgba(17,24,39,0.60)" : "rgba(17,24,39,0.92)"};
      background:rgba(255,255,255,0.96);
      border:1px solid rgba(0,0,0,0.14);
      border-radius:8px;
      padding:2px 6px;
      box-shadow:0 1px 6px rgba(0,0,0,0.25);
      margin-bottom:4px;
      white-space:nowrap;
      max-width:320px;
      overflow:hidden;
      text-overflow:ellipsis;
    ">${text}</div>
  `;
}

function makeFireTruckIcon(callSign) {
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);user-select:none;pointer-events:none;">
        ${labelBoxHtml(callSign)}
        <div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.35));">🚒</div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

function makeStationIcon(code) {
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);user-select:none;pointer-events:none;">
        ${labelBoxHtml(code)}
        <div style="font-size:20px;line-height:1;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.35));">🏠</div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

function makeIncidentIcon(title, solved) {
  const text = solved ? `${title} (LØST)` : title;
  const glyph = solved ? "✅" : "🚨";
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);user-select:none;pointer-events:none;">
        ${labelBoxHtml(text, solved ? "solved" : "normal")}
        <div style="font-size:20px;line-height:1;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.35));opacity:${solved ? 0.8 : 1};">${glyph}</div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

function getSessionCodeFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("session");
}

function setSessionCodeInUrl(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("session", code);
  window.history.replaceState({}, "", url.toString());
}

function makeCode(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function upsertById(prev, payload) {
  const row = payload.new || payload.old;
  if (!row) return prev;
  if (payload.eventType === "DELETE") return prev.filter((x) => x.id !== row.id);
  const idx = prev.findIndex((x) => x.id === row.id);
  if (idx === -1) return [...prev, row];
  const next = prev.slice();
  next[idx] = row;
  return next;
}

function upsertByKey(prev, payload, keys) {
  const row = payload.new || payload.old;
  if (!row) return prev;
  const keyOf = (obj) => keys.map((k) => obj[k]).join("||");

  if (payload.eventType === "DELETE") {
    const k = keyOf(row);
    return prev.filter((x) => keyOf(x) !== k);
  }

  const k = keyOf(row);
  const idx = prev.findIndex((x) => keyOf(x) === k);
  if (idx === -1) return [...prev, row];
  const next = prev.slice();
  next[idx] = row;
  return next;
}

function playAlarmBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = "square";
    o1.frequency.setValueAtTime(880, now);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    o1.connect(g1).connect(ctx.destination);
    o1.start(now);
    o1.stop(now + 0.26);

    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = "square";
    o2.frequency.setValueAtTime(660, now + 0.30);
    g2.gain.setValueAtTime(0.0001, now + 0.30);
    g2.gain.exponentialRampToValueAtTime(0.25, now + 0.32);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    o2.connect(g2).connect(ctx.destination);
    o2.start(now + 0.30);
    o2.stop(now + 0.56);

    setTimeout(() => ctx.close(), 900);
  } catch {}
}

async function fetchRouteOSRM(fromLat, fromLng, toLat, toLng) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("OSRM route failed");
  const data = await res.json();

  const coords = data?.routes?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) throw new Error("No route geometry");
  return coords.map(([lng, lat]) => [lat, lng]);
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function buildDistances(points) {
  const d = [0];
  for (let i = 1; i < points.length; i++) {
    d.push(d[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return d;
}

function interpolateOnLine(points, cumDist, dist) {
  if (dist <= 0) return points[0];
  const total = cumDist[cumDist.length - 1];
  if (dist >= total) return points[points.length - 1];

  let i = 1;
  while (i < cumDist.length && cumDist[i] < dist) i++;
  const d0 = cumDist[i - 1];
  const d1 = cumDist[i];
  const t = (dist - d0) / (d1 - d0);
  const p0 = points[i - 1];
  const p1 = points[i];
  return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
}

function parseTs(ts) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

export default function App() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);

  const stationLayerRef = useRef(null);
  const resourceLayerRef = useRef(null);
  const incidentLayerRef = useRef(null);
  const searchLayerRef = useRef(null);

  const resourceMarkersRef = useRef(new Map());
  const routeCacheRef = useRef(new Map());
  const pendingRouteFetchesRef = useRef(new Map());
  const animHandleRef = useRef(null);

  const incidentsRef = useRef([]);
  const resourceStatesRef = useRef([]);

  const [sessionId, setSessionId] = useState(null);
  const [statusMsg, setStatusMsg] = useState("Kobler til økt…");

  const [resourceStates, setResourceStates] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [logs, setLogs] = useState([]);

  const [selectedResourceId, setSelectedResourceId] = useState(null);
  const selectedResourceIdRef = useRef(null);

  const [incidentMode, setIncidentMode] = useState(false);
  const incidentModeRef = useRef(false);

  const [expandedStations, setExpandedStations] = useState(() => {
    const obj = {};
    stations.forEach((s) => (obj[s.id] = true));
    return obj;
  });
  const [expandedIncidentId, setExpandedIncidentId] = useState(null);

  const [author, setAuthor] = useState("");
  const [logText, setLogText] = useState("");

  const [isInstructor, setIsInstructor] = useState(() => localStorage.getItem("isInstructor") === "1");
  const [abaAddress, setAbaAddress] = useState("");
  const [abaObjectName, setAbaObjectName] = useState("");

  const [addrStreet, setAddrStreet] = useState("");
  const [addrNo, setAddrNo] = useState("");
  const [addrMunicipality, setAddrMunicipality] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  const [incidentAddressMap, setIncidentAddressMap] = useState({});
  const [dragState, setDragState] = useState(null);

  useEffect(() => { selectedResourceIdRef.current = selectedResourceId; }, [selectedResourceId]);
  useEffect(() => { incidentModeRef.current = incidentMode; }, [incidentMode]);
  useEffect(() => { incidentsRef.current = incidents; }, [incidents]);
  useEffect(() => { resourceStatesRef.current = resourceStates; }, [resourceStates]);

  const resourcesByStation = useMemo(() => {
    const grouped = {};
    for (const s of stations) grouped[s.id] = [];
    for (const r of resourcesMaster) grouped[r.stationId].push(r);
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => a.callSign.localeCompare(b.callSign, "no"));
    }
    return grouped;
  }, []);

  const logsByIncident = useMemo(() => {
    const m = new Map();
    for (const l of logs) {
      if (!m.has(l.incident_id)) m.set(l.incident_id, []);
      m.get(l.incident_id).push(l);
    }
    return m;
  }, [logs]);

  const abaAlarms = useMemo(() => {
    return incidents
      .filter((x) => !x.solved && (x.title || "").trim().toUpperCase() === "ABA")
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [incidents]);

  const panelStyle = {
    background: C.panel,
    borderRadius: 14,
    padding: 12,
    overflow: "auto",
    boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
    border: `1px solid ${C.border}`,
    color: C.text,
  };

  const cardStyle = {
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 10,
    background: C.card,
  };

  const buttonStyle = (active = false) => ({
    border: `1px solid ${C.border}`,
    background: active ? "rgba(147,197,253,0.12)" : C.card,
    color: C.text,
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  });

  const zoomTo = (lat, lng, minZoom = 13) => {
    if (!mapRef.current) return;
    const z = Math.max(mapRef.current.getZoom(), minZoom);
    mapRef.current.setView([lat, lng], z);
  };

  const buildAddressQuery = ({ street, number, municipality }) => {
    const s = (street || "").trim();
    const n = (number || "").trim();
    const m = (municipality || "").trim();
    if (!s && !m) return "";
    const left = [s, n].filter(Boolean).join(" ").trim();
    const mid = [left, m].filter(Boolean).join(", ").trim();
    return /norge|norway/i.test(mid) ? mid : `${mid}, Norge`;
  };

  const geocodeAddress = async (rawOrParts, limit = 1) => {
    const raw = typeof rawOrParts === "string" ? rawOrParts : buildAddressQuery(rawOrParts);
    const q0 = (raw || "").trim();
    if (!q0) return null;

    const viewbox = "10.0,59.0,11.8,60.3";
    const url =
      "https://nominatim.openstreetmap.org/search" +
      `?format=jsonv2&limit=${limit}&addressdetails=1&countrycodes=no` +
      "&viewbox=" + encodeURIComponent(viewbox) +
      "&bounded=1&q=" + encodeURIComponent(q0);

    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "no" },
    });
    if (!res.ok) throw new Error("Nominatim failed");
    const data = await res.json();

    if (limit === 1) {
      const hit = (data || [])[0];
      if (!hit?.lat || !hit?.lon) return null;
      return { lat: Number(hit.lat), lng: Number(hit.lon), display: hit.display_name || q0 };
    }

    return (data || []).filter((x) => x.lat && x.lon).map((x) => ({
      display_name: x.display_name,
      lat: Number(x.lat),
      lon: Number(x.lon),
    }));
  };

  const reverseGeocode = async (lat, lng) => {
    const url =
      "https://nominatim.openstreetmap.org/reverse" +
      `?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;

    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "no" },
    });
    if (!res.ok) throw new Error("Reverse geocoding failed");

    const data = await res.json();
    const addr = data?.address || {};
    const road = addr.road || addr.pedestrian || addr.footway || addr.path || addr.cycleway || "";
    const houseNumber = addr.house_number || "";
    const suburb = addr.suburb || addr.city_district || addr.village || addr.town || addr.city || addr.municipality || "";
    const municipality = addr.municipality || addr.city || addr.town || addr.village || "";
    const parts = [
      [road, houseNumber].filter(Boolean).join(" ").trim(),
      suburb && suburb !== municipality ? suburb : "",
      municipality,
    ].filter(Boolean);

    return parts.join(", ") || data?.display_name || "";
  };

  const ensureRouteCached = async (resourceId, moveStartedAt, fromLat, fromLng, toLat, toLng) => {
    const key = `${resourceId}::${moveStartedAt}::${toLat},${toLng}`;
    if (routeCacheRef.current.has(key)) return key;
    if (pendingRouteFetchesRef.current.has(key)) return key;

    const p = (async () => {
      try {
        const line = await fetchRouteOSRM(fromLat, fromLng, toLat, toLng);
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        routeCacheRef.current.set(key, { line, cum, total, fallback: false });
      } catch {
        const line = [[fromLat, fromLng], [toLat, toLng]];
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        routeCacheRef.current.set(key, { line, cum, total, fallback: true });
      } finally {
        pendingRouteFetchesRef.current.delete(key);
      }
    })();

    pendingRouteFetchesRef.current.set(key, p);
    return key;
  };

  const getRouteSnapshotForState = (st) => {
    const key = `${st.resource_id}::${st.move_started_at}::${st.dest_lat},${st.dest_lng}`;
    const cached = routeCacheRef.current.get(key);
    if (cached) return cached;

    const fromLat = st.start_lat ?? st.lat ?? DEFAULT_CENTER[0];
    const fromLng = st.start_lng ?? st.lng ?? DEFAULT_CENTER[1];
    const toLat = st.dest_lat ?? DEFAULT_CENTER[0];
    const toLng = st.dest_lng ?? DEFAULT_CENTER[1];
    const line = [[fromLat, fromLng], [toLat, toLng]];
    const cum = buildDistances(line);
    const total = cum[cum.length - 1];
    return { line, cum, total, fallback: true };
  };

  const getCurrentMovingPosition = async (st) => {
    const t0 = parseTs(st.move_started_at);
    if (!t0) return null;

    const nowMs = Date.now();
    const speed = (st.speed_mps && Number(st.speed_mps) > 0) ? Number(st.speed_mps) : 20.0;
    const elapsedSec = Math.max(0, (nowMs - t0) / 1000);
    const dist = elapsedSec * speed;

    const route = getRouteSnapshotForState(st);
    return interpolateOnLine(route.line, route.cum, dist);
  };

  const isReturnToStationMove = (st) => {
    const master = resourcesMaster.find((x) => x.id === st.resource_id);
    const station = stations.find((s) => s.id === master?.stationId);
    if (!station) return false;
    if (st.dest_lat == null || st.dest_lng == null) return false;
    const d = haversineMeters([st.dest_lat, st.dest_lng], [station.lat, station.lng]);
    return d <= 60;
  };

  const findIncidentForResourceState = (st) => {
    if (!st) return null;
    if (st.status !== "MOVING" && st.status !== "DEPLOYED") return null;
    if (st.status === "MOVING" && isReturnToStationMove(st)) return null;

    let best = null;
    let bestDist = Infinity;

    for (const incident of incidentsRef.current) {
      let d = Infinity;

      if (st.status === "MOVING" && st.dest_lat != null && st.dest_lng != null) {
        d = haversineMeters([st.dest_lat, st.dest_lng], [incident.lat, incident.lng]);
      } else if (st.status === "DEPLOYED" && st.lat != null && st.lng != null) {
        d = haversineMeters([st.lat, st.lng], [incident.lat, incident.lng]);
      }

      if (d <= INCIDENT_ASSIGN_RADIUS_METERS && d < bestDist) {
        best = incident;
        bestDist = d;
      }
    }

    return best;
  };

  const getResourcesForIncident = (incident) => {
    if (!incident) return [];

    return resourceStates
      .filter((st) => {
        const linked = findIncidentForResourceState(st);
        return linked?.id === incident.id;
      })
      .map((st) => ({
        resourceId: st.resource_id,
        callSign: st.call_sign,
        status: st.status === "MOVING" ? "På vei" : "Fremme",
      }))
      .sort((a, b) => a.callSign.localeCompare(b.callSign, "no"));
  };

  const getIncidentHeadingText = (incident) => {
    const isABA = (incident.title || "").trim().toUpperCase() === "ABA";
    const baseTitle = isABA ? `ABA${incident.source ? ` – ${incident.source}` : ""}` : incident.title;
    const address = incidentAddressMap[incident.id]?.trim();
    const resources = getResourcesForIncident(incident);
    const resourceText = resources.length > 0 ? ` • ${resources.map((r) => r.callSign).join(", ")}` : "";
    return `${baseTitle}${address ? ` – ${address}` : ""}${resourceText}`;
  };

  const findNearestIncidentByLatLng = (lat, lng, maxMeters = INCIDENT_ASSIGN_RADIUS_METERS) => {
    let chosen = null;
    let bestDist = Infinity;

    for (const incident of incidentsRef.current.filter((x) => !x.solved)) {
      const d = haversineMeters([lat, lng], [incident.lat, incident.lng]);
      if (d <= maxMeters && d < bestDist) {
        chosen = incident;
        bestDist = d;
      }
    }
    return chosen;
  };

  const startResourceMovement = async (rid, toLat, toLng) => {
    if (!sessionId || !rid) return;

    const current = resourceStatesRef.current.find((x) => x.resource_id === rid);
    const master = resourcesMaster.find((x) => x.id === rid);
    const station = stations.find((s) => s.id === master?.stationId);
    let marker = resourceMarkersRef.current.get(rid);

    if (!current) return;

    let fromLat = null;
    let fromLng = null;

    if (current.status === "MOVING") {
      const pos = await getCurrentMovingPosition(current);
      if (pos) {
        fromLat = pos[0];
        fromLng = pos[1];
      }
    }

    if (fromLat == null || fromLng == null) {
      if (marker) {
        const ll = marker.getLatLng();
        fromLat = ll.lat;
        fromLng = ll.lng;
      }
    }

    if ((fromLat == null || fromLng == null) && current.lat != null && current.lng != null) {
      fromLat = current.lat;
      fromLng = current.lng;
    }

    if (fromLat == null || fromLng == null) {
      fromLat = station?.lat ?? DEFAULT_CENTER[0];
      fromLng = station?.lng ?? DEFAULT_CENTER[1];
    }

    if (!marker && resourceLayerRef.current) {
      marker = L.marker([fromLat, fromLng], {
        icon: makeFireTruckIcon(current.call_sign),
        interactive: true,
        zIndexOffset: 2000,
      })
        .bindPopup(`<b>${current.call_sign}</b><br/>${current.type}`)
        .addTo(resourceLayerRef.current);

      resourceMarkersRef.current.set(rid, marker);
    } else if (marker) {
      marker.setLatLng([fromLat, fromLng]);
    }

    const moveStartedAt = new Date().toISOString();
    const speedMps = 20.0;

    ensureRouteCached(rid, moveStartedAt, fromLat, fromLng, toLat, toLng);

    const { error } = await supabase
      .from("resource_states")
      .update({
        status: "MOVING",
        start_lat: fromLat,
        start_lng: fromLng,
        dest_lat: toLat,
        dest_lng: toLng,
        move_started_at: moveStartedAt,
        speed_mps: speedMps,
        lat: fromLat,
        lng: fromLng,
      })
      .eq("session_id", sessionId)
      .eq("resource_id", rid);

    if (error) {
      console.error("Start movement failed:", error);
      alert(`Kunne ikke starte bevegelse: ${error.message}`);
      return;
    }

    setSelectedResourceId(null);
  };

  const createIncidentAt = async (lat, lng) => {
    if (!sessionId) return;
    const title = window.prompt("Overskrift/hendelsestype (f.eks. 'Brann i bolig'):");
    if (!title || !title.trim()) return;

    await supabase.from("incidents").insert({
      session_id: sessionId,
      title: title.trim(),
      lat,
      lng,
      solved: false,
    });

    zoomTo(lat, lng, 14);
    setResults([]);
  };

  useEffect(() => {
    (async () => {
      let code = getSessionCodeFromUrl();
      if (!code) {
        code = makeCode(6);
        setSessionCodeInUrl(code);
      }

      setStatusMsg("Finner/oppretter økt…");

      const { data: existing, error: e1 } = await supabase
        .from("sessions")
        .select("id, code")
        .eq("code", code)
        .maybeSingle();

      if (e1) {
        setStatusMsg("Feil ved oppslag av økt.");
        return;
      }

      let sid = existing?.id;
      if (!sid) {
        const { data: created, error: e2 } = await supabase
          .from("sessions")
          .insert({ code })
          .select("id, code")
          .single();

        if (e2) {
          setStatusMsg("Feil ved opprettelse av økt.");
          return;
        }
        sid = created.id;
      }

      setSessionId(sid);
      setStatusMsg(`Økt: ${code}`);

      const seed = resourcesMaster.map((r) => ({
        session_id: sid,
        resource_id: r.id,
        call_sign: r.callSign,
        type: r.type,
        station_id: r.stationId,
        status: "ON_STATION",
        lat: null,
        lng: null,
        start_lat: null,
        start_lng: null,
        dest_lat: null,
        dest_lng: null,
        move_started_at: null,
        speed_mps: null,
      }));

      await supabase.from("resource_states").upsert(seed, { onConflict: "session_id,resource_id" });

      const [rs, inc, lg] = await Promise.all([
        supabase.from("resource_states").select("*").eq("session_id", sid),
        supabase.from("incidents").select("*").eq("session_id", sid).order("created_at", { ascending: true }),
        supabase.from("incident_logs").select("*").eq("session_id", sid).order("created_at", { ascending: true }),
      ]);

      if (!rs.error) setResourceStates(rs.data || []);
      if (!inc.error) setIncidents(inc.data || []);
      if (!lg.error) setLogs(lg.data || []);

      const ch = supabase.channel(`session:${sid}`);

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "resource_states", filter: `session_id=eq.${sid}` },
        (payload) => setResourceStates((prev) => upsertByKey(prev, payload, ["session_id", "resource_id"]))
      );

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents", filter: `session_id=eq.${sid}` },
        (payload) => setIncidents((prev) => upsertById(prev, payload))
      );

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incident_logs", filter: `session_id=eq.${sid}` },
        (payload) => setLogs((prev) => upsertById(prev, payload))
      );

      ch.subscribe();
      return () => { supabase.removeChannel(ch); };
    })();
  }, []);

  const seenIncidentIdsRef = useRef(new Set());
  useEffect(() => {
    const seen = seenIncidentIdsRef.current;
    for (const it of incidents) {
      if (!it?.id) continue;
      if (seen.has(it.id)) continue;
      seen.add(it.id);

      const isABA = (it.title || "").trim().toUpperCase() === "ABA";
      if (isABA && !it.solved) playAlarmBeep();
    }
  }, [incidents]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const missing = incidents.filter(
        (h) => h?.id && h.lat != null && h.lng != null && !incidentAddressMap[h.id]
      );

      if (missing.length === 0) return;

      for (const h of missing) {
        try {
          const addr = await reverseGeocode(h.lat, h.lng);
          if (cancelled) return;
          setIncidentAddressMap((prev) => ({ ...prev, [h.id]: addr || "" }));
        } catch {
          if (cancelled) return;
          setIncidentAddressMap((prev) => ({ ...prev, [h.id]: "" }));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [incidents, incidentAddressMap]);

  useEffect(() => {
    if (!dragState) return;

    const onMove = (e) => {
      setDragState((prev) => {
        if (!prev) return prev;
        const dx = e.clientX - prev.startX;
        const dy = e.clientY - prev.startY;
        const active = prev.active || Math.hypot(dx, dy) >= DRAG_START_PX;
        return { ...prev, x: e.clientX, y: e.clientY, active };
      });
    };

    const onUp = async (e) => {
      const currentDrag = dragState;
      setDragState(null);

      if (!currentDrag?.active) return;

      const map = mapRef.current;
      const mapEl = mapDivRef.current;
      if (!map || !mapEl) return;

      const rect = mapEl.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      if (!inside) return;

      const point = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const latlng = map.containerPointToLatLng(point);
      const incident = findNearestIncidentByLatLng(latlng.lat, latlng.lng);

      if (incident) {
        await startResourceMovement(currentDrag.resourceId, incident.lat, incident.lng);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState]);

  useEffect(() => {
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapDivRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    mapRef.current = map;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap-bidragsytere &copy; CARTO",
    }).addTo(map);

    stationLayerRef.current = L.layerGroup().addTo(map);
    resourceLayerRef.current = L.layerGroup().addTo(map);
    incidentLayerRef.current = L.layerGroup().addTo(map);
    searchLayerRef.current = L.layerGroup().addTo(map);

    stations.forEach((s) => {
      L.marker([s.lat, s.lng], {
        icon: makeStationIcon(s.id),
        interactive: true,
        zIndexOffset: 2600,
      })
        .bindPopup(`<b>${s.name}</b>`)
        .addTo(stationLayerRef.current);
    });

    map.on("click", async (e) => {
      if (!sessionId) return;

      if (incidentModeRef.current) {
        const title = window.prompt("Overskrift/hendelsestype (f.eks. 'Brann i bolig'):");
        if (!title || !title.trim()) return;

        await supabase.from("incidents").insert({
          session_id: sessionId,
          title: title.trim(),
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          solved: false,
        });

        setIncidentMode(false);
        return;
      }

      const rid = selectedResourceIdRef.current;
      if (!rid) return;

      const chosenIncident = findNearestIncidentByLatLng(e.latlng.lat, e.latlng.lng);

      if (chosenIncident) {
        await startResourceMovement(rid, chosenIncident.lat, chosenIncident.lng);
        return;
      }

      await startResourceMovement(rid, e.latlng.lat, e.latlng.lng);
    });

    setTimeout(() => map.invalidateSize(), 120);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!resourceLayerRef.current) return;

    const layer = resourceLayerRef.current;
    const mapMarkers = resourceMarkersRef.current;

    for (const [rid, m] of mapMarkers.entries()) {
      const st = resourceStates.find((x) => x.resource_id === rid);
      if (!st || st.status === "ON_STATION") {
        layer.removeLayer(m);
        mapMarkers.delete(rid);
      }
    }

    for (const st of resourceStates) {
      if (!st) continue;
      if (st.status !== "DEPLOYED" && st.status !== "MOVING") continue;

      let lat = st.lat;
      let lng = st.lng;

      if ((lat == null || lng == null) && st.status === "MOVING" && st.start_lat != null && st.start_lng != null) {
        lat = st.start_lat;
        lng = st.start_lng;
      }

      if (lat == null || lng == null) {
        const master = resourcesMaster.find((x) => x.id === st.resource_id);
        const station = stations.find((s) => s.id === master?.stationId);
        lat = station?.lat ?? DEFAULT_CENTER[0];
        lng = station?.lng ?? DEFAULT_CENTER[1];
      }

      const existing = mapMarkers.get(st.resource_id);
      if (!existing) {
        const m = L.marker([lat, lng], {
          icon: makeFireTruckIcon(st.call_sign),
          interactive: true,
          zIndexOffset: 2000,
        })
          .bindPopup(`<b>${st.call_sign}</b><br/>${st.type}`)
          .addTo(layer);

        mapMarkers.set(st.resource_id, m);
      } else if (st.status === "DEPLOYED" && st.lat != null && st.lng != null) {
        existing.setLatLng([st.lat, st.lng]);
      }
    }
  }, [resourceStates]);

  useEffect(() => {
    if (!incidentLayerRef.current) return;
    incidentLayerRef.current.clearLayers();

    incidents.forEach((h) => {
      const title = getIncidentHeadingText(h);
      const group = L.layerGroup().addTo(incidentLayerRef.current);

      L.circleMarker([h.lat, h.lng], {
        radius: 18,
        stroke: false,
        fill: true,
        fillOpacity: 0.001,
        interactive: true,
      }).addTo(group);

      L.marker([h.lat, h.lng], {
        icon: makeIncidentIcon(title, h.solved),
        interactive: true,
        zIndexOffset: 2200,
      })
        .bindPopup(`<b>${title}</b><br/>Status: ${h.solved ? "Løst" : "Aktiv"}`)
        .addTo(group);
    });
  }, [incidents, incidentAddressMap, resourceStates]);

  useEffect(() => {
    let cancelled = false;

    function finalizeAsDeployed(st) {
      supabase
        .from("resource_states")
        .update({
          status: "DEPLOYED",
          lat: st.dest_lat,
          lng: st.dest_lng,
          start_lat: null,
          start_lng: null,
          dest_lat: null,
          dest_lng: null,
          move_started_at: null,
          speed_mps: null,
        })
        .eq("session_id", st.session_id)
        .eq("resource_id", st.resource_id)
        .eq("status", "MOVING")
        .eq("move_started_at", st.move_started_at)
        .then(({ error }) => {
          if (error) console.warn("Finalize deployed failed:", error);
        });
    }

    function finalizeAsOnStation(st) {
      supabase
        .from("resource_states")
        .update({
          status: "ON_STATION",
          lat: null,
          lng: null,
          start_lat: null,
          start_lng: null,
          dest_lat: null,
          dest_lng: null,
          move_started_at: null,
          speed_mps: null,
        })
        .eq("session_id", st.session_id)
        .eq("resource_id", st.resource_id)
        .eq("status", "MOVING")
        .eq("move_started_at", st.move_started_at)
        .then(({ error }) => {
          if (error) console.warn("Finalize on-station failed:", error);
        });
    }

    async function tick() {
      if (cancelled) return;

      const nowMs = Date.now();
      const moving = resourceStatesRef.current.filter(
        (x) => x.status === "MOVING" && x.dest_lat != null && x.dest_lng != null && x.move_started_at
      );

      for (const st of moving) {
        let marker = resourceMarkersRef.current.get(st.resource_id);

        if (!marker) {
          let lat = st.start_lat ?? st.lat;
          let lng = st.start_lng ?? st.lng;

          if (lat == null || lng == null) {
            const master = resourcesMaster.find((x) => x.id === st.resource_id);
            const station = stations.find((s) => s.id === master?.stationId);
            lat = station?.lat ?? DEFAULT_CENTER[0];
            lng = station?.lng ?? DEFAULT_CENTER[1];
          }

          marker = L.marker([lat, lng], {
            icon: makeFireTruckIcon(st.call_sign),
            interactive: true,
            zIndexOffset: 2000,
          })
            .bindPopup(`<b>${st.call_sign}</b><br/>${st.type}`)
            .addTo(resourceLayerRef.current);

          resourceMarkersRef.current.set(st.resource_id, marker);
        }

        const t0 = parseTs(st.move_started_at);
        if (!t0) continue;

        const speed = (st.speed_mps && Number(st.speed_mps) > 0) ? Number(st.speed_mps) : 20.0;
        const elapsedSec = Math.max(0, (nowMs - t0) / 1000);
        const dist = elapsedSec * speed;

        const fromLat = st.start_lat ?? st.lat ?? DEFAULT_CENTER[0];
        const fromLng = st.start_lng ?? st.lng ?? DEFAULT_CENTER[1];
        const toLat = st.dest_lat ?? DEFAULT_CENTER[0];
        const toLng = st.dest_lng ?? DEFAULT_CENTER[1];

        ensureRouteCached(st.resource_id, st.move_started_at, fromLat, fromLng, toLat, toLng);

        const route = getRouteSnapshotForState(st);
        const total = route.total || 0;
        const pos = interpolateOnLine(route.line, route.cum, dist);
        marker.setLatLng(pos);

        if (dist >= Math.max(0, total - ARRIVE_THRESHOLD_METERS)) {
          marker.setLatLng([st.dest_lat, st.dest_lng]);
          if (isReturnToStationMove(st)) finalizeAsOnStation(st);
          else finalizeAsDeployed(st);
        }
      }

      animHandleRef.current = requestAnimationFrame(tick);
    }

    animHandleRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (animHandleRef.current) cancelAnimationFrame(animHandleRef.current);
      animHandleRef.current = null;
    };
  }, []);

  const returnToStation = async (resourceId) => {
    if (!sessionId) return;

    const current = resourceStatesRef.current.find((x) => x.resource_id === resourceId);
    const master = resourcesMaster.find((x) => x.id === resourceId);
    const station = stations.find((s) => s.id === master?.stationId);
    let marker = resourceMarkersRef.current.get(resourceId);

    if (!station || !current) return;

    let fromLat = null;
    let fromLng = null;

    if (current.status === "MOVING") {
      const pos = await getCurrentMovingPosition(current);
      if (pos) {
        fromLat = pos[0];
        fromLng = pos[1];
      }
    }

    if (fromLat == null || fromLng == null) {
      if (marker) {
        const ll = marker.getLatLng();
        fromLat = ll.lat;
        fromLng = ll.lng;
      }
    }

    if ((fromLat == null || fromLng == null) && current.lat != null && current.lng != null) {
      fromLat = current.lat;
      fromLng = current.lng;
    }

    if (fromLat == null || fromLng == null) {
      fromLat = station.lat;
      fromLng = station.lng;
    }

    if (!marker && resourceLayerRef.current) {
      marker = L.marker([fromLat, fromLng], {
        icon: makeFireTruckIcon(current.call_sign),
        interactive: true,
        zIndexOffset: 2000,
      })
        .bindPopup(`<b>${current.call_sign}</b><br/>${current.type}`)
        .addTo(resourceLayerRef.current);

      resourceMarkersRef.current.set(resourceId, marker);
    } else if (marker) {
      marker.setLatLng([fromLat, fromLng]);
    }

    const moveStartedAt = new Date().toISOString();
    const speedMps = 20.0;

    ensureRouteCached(resourceId, moveStartedAt, fromLat, fromLng, station.lat, station.lng);

    await supabase
      .from("resource_states")
      .update({
        status: "MOVING",
        start_lat: fromLat,
        start_lng: fromLng,
        dest_lat: station.lat,
        dest_lng: station.lng,
        move_started_at: moveStartedAt,
        speed_mps: speedMps,
        lat: fromLat,
        lng: fromLng,
      })
      .eq("session_id", sessionId)
      .eq("resource_id", resourceId);

    setSelectedResourceId(null);
  };

  const markIncidentSolved = async (incidentId) => {
    if (!sessionId) return;
    await supabase.from("incidents").update({ solved: true }).eq("id", incidentId).eq("session_id", sessionId);
  };

  const sendLog = async (incidentId) => {
    if (!sessionId || !incidentId) return;
    const msg = logText.trim();
    if (!msg) return;

    await supabase.from("incident_logs").insert({
      session_id: sessionId,
      incident_id: incidentId,
      author: author.trim() || null,
      message: msg,
    });

    setLogText("");
  };

  const requireInstructor = () => {
    if (isInstructor) return true;
    const pin = window.prompt("Instruktør-PIN:");
    if (!pin) return false;
    setIsInstructor(true);
    localStorage.setItem("isInstructor", "1");
    return true;
  };

  const generateABA = async () => {
    if (!sessionId) {
      alert("Venter på økt… prøv igjen.");
      return;
    }
    if (!requireInstructor()) return;

    const addr = abaAddress.trim();
    if (!addr) {
      alert("Fyll inn en konkret adresse (påkrevd).");
      return;
    }

    let hit = null;
    try {
      hit = await geocodeAddress(addr, 1);
    } catch {
      hit = null;
    }

    if (!hit) {
      alert("Fant ikke adressen. Prøv mer presist (gate + nummer + sted).");
      return;
    }

    const name = abaObjectName.trim();
    const source = name ? `${name} – ${hit.display}` : hit.display;

    const { error } = await supabase.from("incidents").insert({
      session_id: sessionId,
      title: "ABA",
      source,
      lat: hit.lat,
      lng: hit.lng,
      solved: false,
    });

    if (error) {
      console.error("ABA insert feilet:", error);
      alert(`ABA feilet: ${error.message}`);
      return;
    }

    zoomTo(hit.lat, hit.lng, 13);
  };

  const runSearch = async () => {
    const query = buildAddressQuery({
      street: addrStreet,
      number: addrNo,
      municipality: addrMunicipality,
    });
    if (!query) return;

    setSearching(true);
    setSearchError("");
    setResults([]);

    try {
      const cleaned = await geocodeAddress(query, 10);
      setResults(cleaned || []);
      if (!cleaned || cleaned.length === 0) {
        setSearchError("Fant ingen treff. Prøv mer presist (gate + nummer + kommune).");
      }
    } catch {
      setSearchError("Søk feilet (nett/proxy eller rate limit).");
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r) => {
    setResults([]);
    zoomTo(r.lat, r.lon, 15);
    if (searchLayerRef.current) {
      searchLayerRef.current.clearLayers();
      L.circleMarker([r.lat, r.lon], {
        radius: 8,
        weight: 2,
        color: C.accent,
        fillColor: C.accent,
        fillOpacity: 0.2,
      }).addTo(searchLayerRef.current);
    }
  };

  const getResourceUi = (state) => {
    const base = {
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 10,
      cursor: "pointer",
    };

    if (!state || state.status === "ON_STATION") {
      return {
        wrapBg: "rgba(34,197,94,0.85)",
        wrapColor: "rgba(255,255,255,0.95)",
        btnBg: "transparent",
        btnColor: "inherit",
        base,
        statusLabel: "Ledig",
      };
    }

    const returning = state.status === "MOVING" && isReturnToStationMove(state);
    if (returning) {
      return {
        wrapBg: "rgba(34,197,94,0.85)",
        wrapColor: "rgba(17,24,39,0.95)",
        btnBg: "transparent",
        btnColor: "inherit",
        base,
        statusLabel: "Ledig",
      };
    }

    if (state.status === "MOVING") {
      return {
        wrapBg: "rgba(220,38,38,0.85)",
        wrapColor: "rgba(255,255,255,0.95)",
        btnBg: "transparent",
        btnColor: "inherit",
        base,
        statusLabel: "Rykker ut",
      };
    }

    if (state.status === "DEPLOYED") {
      return {
        wrapBg: "rgba(220,38,38,0.85)",
        wrapColor: "rgba(17,24,39,0.95)",
        btnBg: "transparent",
        btnColor: "inherit",
        base,
        statusLabel: "Fremme",
      };
    }

    return {
      wrapBg: "rgba(255,255,255,0.03)",
      wrapColor: C.text,
      btnBg: "transparent",
      btnColor: "inherit",
      base,
      statusLabel: "Ukjent",
    };
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateColumns: "320px 1fr 520px",
        gap: 12,
        padding: 12,
        background: C.bg,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        position: "relative",
      }}
    >
      {dragState?.active && (
        <div
          style={{
            position: "fixed",
            left: dragState.x + 12,
            top: dragState.y + 12,
            zIndex: 5000,
            pointerEvents: "none",
            padding: "8px 10px",
            borderRadius: 12,
            background: "rgba(15,23,42,0.96)",
            border: `1px solid ${C.border}`,
            color: C.text,
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
            fontWeight: 900,
            fontSize: 13,
          }}
        >
          {resourcesMaster.find((r) => r.id === dragState.resourceId)?.callSign || "Ressurs"}
        </div>
      )}

      {/* LEFT */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Brannressurser</div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {statusMsg} • Del lenken med andre for samme økt.
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {stations.map((s) => {
            const isOpen = !!expandedStations[s.id];
            return (
              <div key={s.id} style={cardStyle}>
                <button
                  onClick={() => setExpandedStations((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "none",
                    background: "transparent",
                    color: C.text,
                    cursor: "pointer",
                    padding: 0,
                    fontWeight: 900,
                  }}
                >
                  <span>{s.name}</span>
                  <span style={{ color: C.muted, fontWeight: 900 }}>{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    {(resourcesByStation[s.id] || []).map((r) => {
                      const state = resourceStates.find((x) => x.resource_id === r.id);
                      const isPlaced = state?.status === "DEPLOYED" || state?.status === "MOVING";
                      const isSelected = selectedResourceId === r.id;
                      const ui = getResourceUi(state);

                      return (
                        <div
                          key={r.id}
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "stretch",
                            borderRadius: 12,
                            background: ui.wrapBg,
                            color: ui.wrapColor,
                            border: isSelected ? "3px solid rgba(255,255,255,0.95)" : `1px solid ${C.border}`,
                            boxShadow: isSelected ? "0 0 0 2px rgba(147,197,253,0.35)" : "none",
                            padding: 8,
                          }}
                        >
                          <button
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              setDragState({
                                resourceId: r.id,
                                startX: e.clientX,
                                startY: e.clientY,
                                x: e.clientX,
                                y: e.clientY,
                                active: false,
                              });
                            }}
                            onClick={() => {
                              setIncidentMode(false);
                              setSelectedResourceId(isSelected ? null : r.id);
                            }}
                            style={{
                              flex: 1,
                              textAlign: "left",
                              ...ui.base,
                              border: "none",
                              background: ui.btnBg,
                              color: ui.btnColor,
                              padding: 0,
                            }}
                          >
                            <div style={{ fontWeight: 900 }}>
                              {r.callSign}{" "}
                              <span style={{ fontWeight: 800, fontSize: 12, opacity: 0.9 }}>
                                ({r.type})
                              </span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9 }}>
                              Status: {ui.statusLabel}
                            </div>
                          </button>

                          {isPlaced && (
                            <button
                              onClick={() => returnToStation(r.id)}
                              title="Tilbake til stasjon (kjører tilbake)"
                              style={{
                                width: 52,
                                borderRadius: 12,
                                border: `1px solid ${C.border}`,
                                background: "rgba(0,0,0,0.12)",
                                color: ui.wrapColor,
                                cursor: "pointer",
                                fontWeight: 900,
                              }}
                            >
                              ↩
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CENTER */}
      <div
        style={{
          background: C.panel,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
          border: `1px solid ${C.border}`,
          position: "relative",
          height: "calc(100vh - 24px)",
        }}
      >
        <div
          style={{
            position: "absolute",
            zIndex: 800,
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(980px, calc(100% - 24px))",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: 10,
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: "rgba(15,23,42,0.92)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
              alignItems: "center",
            }}
          >
            <input
              value={addrStreet}
              onChange={(e) => setAddrStreet(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setResults([]);
              }}
              placeholder="Adresse (gate)"
              style={{
                flex: 1,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(255,255,255,0.03)",
                color: C.text,
                padding: "10px 12px",
                outline: "none",
                minWidth: 180,
              }}
            />
            <input
              value={addrNo}
              onChange={(e) => setAddrNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setResults([]);
              }}
              placeholder="Nr"
              style={{
                width: 90,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(255,255,255,0.03)",
                color: C.text,
                padding: "10px 12px",
                outline: "none",
              }}
            />
            <input
              value={addrMunicipality}
              onChange={(e) => setAddrMunicipality(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setResults([]);
              }}
              placeholder="Kommune"
              style={{
                width: 200,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(255,255,255,0.03)",
                color: C.text,
                padding: "10px 12px",
                outline: "none",
              }}
            />

            <button
              onClick={() => {
                setSelectedResourceId(null);
                setIncidentMode((v) => !v);
              }}
              style={buttonStyle(incidentMode)}
            >
              Ny hendelse
            </button>

            <button onClick={runSearch} style={buttonStyle(false)} disabled={searching}>
              {searching ? "Søker…" : "Søk"}
            </button>

            <button
              onClick={() => {
                setResults([]);
                setSearchError("");
                if (searchLayerRef.current) searchLayerRef.current.clearLayers();
              }}
              style={buttonStyle(false)}
            >
              Rydd
            </button>
          </div>

          {searchError && <div style={{ marginTop: 8, fontSize: 12, color: C.danger }}>{searchError}</div>}

          {results.length > 0 && (
            <div
              style={{
                marginTop: 8,
                borderRadius: 14,
                border: `1px solid ${C.border}`,
                background: "rgba(15,23,42,0.96)",
                overflow: "hidden",
              }}
            >
              {results.map((r, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    padding: "10px 12px",
                    borderTop: idx === 0 ? "none" : `1px solid ${C.border}`,
                    alignItems: "center",
                  }}
                >
                  <button
                    onClick={() => pickResult(r)}
                    style={{
                      textAlign: "left",
                      border: "none",
                      background: "transparent",
                      color: C.text,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 12, color: C.muted }}>Treff</div>
                    <div style={{ fontWeight: 800 }}>{r.display_name}</div>
                  </button>

                  <button onClick={() => createIncidentAt(r.lat, r.lon)} style={buttonStyle(false)}>
                    Opprett hendelse
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            position: "absolute",
            zIndex: 700,
            top: 10,
            left: 10,
            padding: "8px 10px",
            background: "rgba(15,23,42,0.92)",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            fontSize: 12,
            color: C.text,
          }}
        >
          {incidentMode
            ? "Hendelsemodus: klikk i kartet"
            : selectedResourceId
              ? `Klikk i kartet eller dra ${resourcesMaster.find((x) => x.id === selectedResourceId)?.callSign || ""} til en hendelse`
              : "Velg ressurs eller trykk “Ny hendelse”"}
        </div>

        <div ref={mapDivRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {/* RIGHT */}
      <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>Instruktør</div>
            <button
              style={buttonStyle(isInstructor)}
              onClick={() => {
                if (isInstructor) {
                  setIsInstructor(false);
                  localStorage.removeItem("isInstructor");
                } else {
                  const ok = requireInstructor();
                  if (!ok) return;
                }
              }}
            >
              {isInstructor ? "Aktiv" : "Aktiver"}
            </button>
          </div>

          {isInstructor && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={abaAddress}
                onChange={(e) => setAbaAddress(e.target.value)}
                placeholder="ABA adresse (påkrevd) – f.eks. 'Storgata 10, Ski'"
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "rgba(255,255,255,0.03)",
                  color: C.text,
                  padding: "10px 12px",
                  outline: "none",
                }}
              />

              <input
                value={abaObjectName}
                onChange={(e) => setAbaObjectName(e.target.value)}
                placeholder="Objektnavn (valgfritt) – f.eks. 'Rema 1000'"
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "rgba(255,255,255,0.03)",
                  color: C.text,
                  padding: "10px 12px",
                  outline: "none",
                }}
              />

              <button
                onClick={generateABA}
                style={{
                  ...buttonStyle(false),
                  opacity: sessionId ? 1 : 0.5,
                  cursor: sessionId ? "pointer" : "not-allowed",
                }}
                disabled={!sessionId}
              >
                Generer ABA-alarm
              </button>

              <div style={{ fontSize: 12, color: C.muted }}>
                Krever adresse (geokodes). Objektnavn er valgfritt.
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Hendelser</div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
            Klikk en hendelse for å åpne/lukke logg.
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {incidents.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>Ingen hendelser opprettet.</div>
            ) : (
              incidents.slice().reverse().map((h) => {
                const isOpen = expandedIncidentId === h.id;
                const hLogs = logsByIncident.get(h.id) || [];
                const headerTitle = getIncidentHeadingText(h);
                const linkedResources = getResourcesForIncident(h);

                return (
                  <div
                    key={h.id}
                    style={{
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      background: isOpen ? "rgba(147,197,253,0.10)" : "rgba(255,255,255,0.03)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      onClick={() => {
                        setExpandedIncidentId((prev) => (prev === h.id ? null : h.id));
                        zoomTo(h.lat, h.lng, 13);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: 10,
                        border: "none",
                        background: "transparent",
                        color: C.text,
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 900 }}>
                          {headerTitle}{" "}
                          <span style={{ fontWeight: 800, color: C.muted, fontSize: 12 }}>
                            ({String(h.id).slice(0, 8)})
                          </span>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
                          Status: {h.solved ? "Løst" : "Aktiv"}
                        </div>
                      </div>
                      <div style={{ color: C.muted, fontWeight: 900 }}>{isOpen ? "▾" : "▸"}</div>
                    </button>

                    {isOpen && (
                      <div style={{ padding: 10, borderTop: `1px solid ${C.border}` }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          {!h.solved && (
                            <button onClick={() => markIncidentSolved(h.id)} style={buttonStyle(false)}>
                              Løst
                            </button>
                          )}
                          <button onClick={() => zoomTo(h.lat, h.lng, 15)} style={buttonStyle(false)}>
                            Zoom
                          </button>
                        </div>

                        <div
                          style={{
                            marginBottom: 10,
                            border: `1px solid ${C.border}`,
                            borderRadius: 12,
                            padding: 10,
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div style={{ fontSize: 12, color: C.muted, fontWeight: 800 }}>
                            Ressurser til hendelsen
                          </div>

                          {linkedResources.length === 0 ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: C.muted }}>
                              Ingen ressurser på vei eller fremme.
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                              {linkedResources.map((r) => (
                                <div key={r.resourceId} style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
                                  {r.callSign} – {r.status}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            maxHeight: 200,
                            overflow: "auto",
                            border: `1px solid ${C.border}`,
                            borderRadius: 12,
                            padding: 10,
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          {hLogs.length === 0 ? (
                            <div style={{ fontSize: 12, color: C.muted }}>Ingen logginnslag.</div>
                          ) : (
                            hLogs.map((l) => (
                              <div key={l.id} style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 12, color: C.muted }}>
                                  {(l.author ? `<${l.author}> ` : "")}
                                  {new Date(l.created_at).toLocaleString("no-NO")}
                                </div>
                                <div style={{ color: C.text, fontWeight: 700 }}>{l.message}</div>
                              </div>
                            ))
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <input
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            placeholder="Navn (valgfritt)"
                            style={{
                              width: 160,
                              borderRadius: 12,
                              border: `1px solid ${C.border}`,
                              background: "rgba(255,255,255,0.03)",
                              color: C.text,
                              padding: "10px 12px",
                              outline: "none",
                            }}
                          />
                          <input
                            value={logText}
                            onChange={(e) => setLogText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") sendLog(h.id); }}
                            placeholder="Skriv logg…"
                            style={{
                              flex: 1,
                              borderRadius: 12,
                              border: `1px solid ${C.border}`,
                              background: "rgba(255,255,255,0.03)",
                              color: C.text,
                              padding: "10px 12px",
                              outline: "none",
                            }}
                          />
                          <button onClick={() => sendLog(h.id)} style={buttonStyle(false)}>
                            Send
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: `1px solid ${C.alarmBorder}`,
            background: C.alarmBg,
            padding: 10,
          }}
        >
          <div style={{ fontWeight: 900, color: "rgba(248,113,113,0.95)" }}>
            ABA-alarmer
          </div>
          <div style={{ marginTop: 6, maxHeight: 160, overflow: "auto" }}>
            {abaAlarms.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>Ingen aktive ABA-alarmer.</div>
            ) : (
              abaAlarms.map((a) => (
                <div
                  key={a.id}
                  style={{
                    borderRadius: 12,
                    border: `1px solid rgba(248,113,113,0.30)`,
                    background: "rgba(220,38,38,0.12)",
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 900, color: "rgba(255,255,255,0.95)" }}>
                    ABA – {a.source || "(ukjent kilde)"}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "rgba(229,231,235,0.85)" }}>
                    {new Date(a.created_at).toLocaleString("no-NO")}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => zoomTo(a.lat, a.lng, 14)}
                      style={{
                        border: `1px solid rgba(248,113,113,0.45)`,
                        background: "rgba(0,0,0,0.15)",
                        color: C.text,
                        borderRadius: 10,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      Zoom
                    </button>
                    <button
                      onClick={() => markIncidentSolved(a.id)}
                      style={{
                        border: `1px solid rgba(248,113,113,0.45)`,
                        background: "rgba(0,0,0,0.15)",
                        color: C.text,
                        borderRadius: 10,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      Kvitter / løst
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "rgba(229,231,235,0.80)" }}>
            (Lyd trigges ved ny ABA i økta.)
          </div>
        </div>
      </div>
    </div>
  );
}
