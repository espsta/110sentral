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
  { id: "M1", name: "M1 Moss",        lat: 59.4370,    lng: 10.6570 },
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
      max-width: 260px;
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

// WebAudio alarm-beep
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

// ===== Routing (OSRM) + shared movement =====
async function fetchRouteOSRM(fromLat, fromLng, toLat, toLng) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("OSRM route failed");
  const data = await res.json();

  const coords = data?.routes?.[0]?.geometry?.coordinates; // [lng,lat]
  if (!coords || coords.length < 2) throw new Error("No route geometry");
  return coords.map(([lng, lat]) => [lat, lng]); // [lat,lng]
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
  const d0 = cumDist[i - 1], d1 = cumDist[i];
  const t = (dist - d0) / (d1 - d0);
  const p0 = points[i - 1], p1 = points[i];
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

  // Marker refs for resources (so we can animate)
  const resourceMarkersRef = useRef(new Map()); // resource_id -> Leaflet Marker

  // Route cache for movements (keyed by resource_id + move_started_at + dest)
  const routeCacheRef = useRef(new Map()); // key -> { line, cum, total }

  // active animation handles
  const animHandleRef = useRef(null);

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

  // Instruktør / ABA
  const [isInstructor, setIsInstructor] = useState(() => localStorage.getItem("isInstructor") === "1");
  const [abaSource, setAbaSource] = useState("");

  // Search
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  useEffect(() => { selectedResourceIdRef.current = selectedResourceId; }, [selectedResourceId]);
  useEffect(() => { incidentModeRef.current = incidentMode; }, [incidentMode]);

  const resourcesByStation = useMemo(() => {
    const grouped = {};
    for (const s of stations) grouped[s.id] = [];
    for (const r of resourcesMaster) grouped[r.stationId].push(r);
    for (const k of Object.keys(grouped)) grouped[k].sort((a,b)=>a.callSign.localeCompare(b.callSign, "no"));
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
  const buttonStyle = (active=false) => ({
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

  // NYTT: beregn nå-posisjon for MOVING ressurs (for omdirigering)
  const getCurrentMovingPosition = async (st) => {
    const t0 = parseTs(st.move_started_at);
    if (!t0) return null;

    const nowMs = Date.now();
    const speed = (st.speed_mps && Number(st.speed_mps) > 0) ? Number(st.speed_mps) : 20.0; // ~72 km/t (litt fortere)
    const elapsedSec = Math.max(0, (nowMs - t0) / 1000);
    const dist = elapsedSec * speed;

    const fromLat = st.start_lat ?? st.lat;
    const fromLng = st.start_lng ?? st.lng;
    const toLat = st.dest_lat;
    const toLng = st.dest_lng;

    if (fromLat == null || fromLng == null || toLat == null || toLng == null) return null;

    const key = `${st.resource_id}::${st.move_started_at}::${toLat},${toLng}`;
    let cached = routeCacheRef.current.get(key);

    if (!cached) {
      try {
        const line = await fetchRouteOSRM(fromLat, fromLng, toLat, toLng);
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        cached = { line, cum, total, fallback: false };
        routeCacheRef.current.set(key, cached);
      } catch {
        const line = [[fromLat, fromLng], [toLat, toLng]];
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        cached = { line, cum, total, fallback: true };
        routeCacheRef.current.set(key, cached);
      }
    }

    return interpolateOnLine(cached.line, cached.cum, dist);
  };

  // ===== Session bootstrap + realtime =====
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

      if (e1) { setStatusMsg("Feil ved oppslag av økt."); return; }

      let sid = existing?.id;
      if (!sid) {
        const { data: created, error: e2 } = await supabase
          .from("sessions")
          .insert({ code })
          .select("id, code")
          .single();
        if (e2) { setStatusMsg("Feil ved opprettelse av økt."); return; }
        sid = created.id;
      }

      setSessionId(sid);
      setStatusMsg(`Økt: ${code}`);

      // Seed resource states
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

  // Alarmlyd ved ny ABA
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

  // ===== Map init (stations always visible) =====
  // ENDRET: denne skal kun kjøre på sessionId, ikke på resourceStates (hindrer “midstilling”)
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
      L.marker([s.lat, s.lng], { icon: makeStationIcon(s.id), interactive: true, zIndexOffset: 2600 })
        .bindPopup(`<b>${s.name}</b>`)
        .addTo(stationLayerRef.current);
    });

    // Click: create incident OR move resource (shared movement)
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

      // ENDRET: Startposisjon skal være “der den er nå” hvis MOVING
      const current = resourceStates.find(x => x.resource_id === rid);
      const master = resourcesMaster.find(x => x.id === rid);
      const station = stations.find(s => s.id === master?.stationId);
      const marker = resourceMarkersRef.current.get(rid);

      let fromLat = null;
      let fromLng = null;

      // 1) Hvis MOVING: start der den faktisk er nå
      if (current?.status === "MOVING") {
        const pos = await getCurrentMovingPosition(current);
        if (pos) {
          fromLat = pos[0];
          fromLng = pos[1];
        }
      }

      // 2) Ellers: hvis marker finnes, bruk den
      if (fromLat == null || fromLng == null) {
        if (marker) {
          const ll = marker.getLatLng();
          fromLat = ll.lat;
          fromLng = ll.lng;
        }
      }

      // 3) Ellers: DB posisjon
      if ((fromLat == null || fromLng == null) && current?.lat != null && current?.lng != null) {
        fromLat = current.lat;
        fromLng = current.lng;
      }

      // 4) Ellers: stasjon
      if (fromLat == null || fromLng == null) {
        fromLat = station?.lat ?? DEFAULT_CENTER[0];
        fromLng = station?.lng ?? DEFAULT_CENTER[1];
      }

      const toLat = e.latlng.lat;
      const toLng = e.latlng.lng;
      const speedMps = 20.0; // ~72 km/t (litt fortere)

      const { error } = await supabase.from("resource_states").update({
        status: "MOVING",
        start_lat: fromLat,
        start_lng: fromLng,
        dest_lat: toLat,
        dest_lng: toLng,
        move_started_at: new Date().toISOString(),
        speed_mps: speedMps,
        lat: fromLat,
        lng: fromLng,
      }).eq("session_id", sessionId).eq("resource_id", rid);

      if (error) {
        console.error("Start movement failed:", error);
        alert(`Kunne ikke starte bevegelse: ${error.message}`);
        return;
      }

      setSelectedResourceId(null);
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

  // ===== Create / update resource markers (do NOT animate here) =====
  useEffect(() => {
    if (!resourceLayerRef.current) return;

    const layer = resourceLayerRef.current;
    const mapMarkers = resourceMarkersRef.current;

    for (const [rid, m] of mapMarkers.entries()) {
      const st = resourceStates.find(x => x.resource_id === rid);
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
        lat = st.start_lat; lng = st.start_lng;
      }

      if (lat == null || lng == null) {
        const master = resourcesMaster.find(x => x.id === st.resource_id);
        const station = stations.find(s => s.id === master?.stationId);
        lat = station?.lat ?? DEFAULT_CENTER[0];
        lng = station?.lng ?? DEFAULT_CENTER[1];
      }

      const existing = mapMarkers.get(st.resource_id);
      if (!existing) {
        const m = L.marker([lat, lng], { icon: makeFireTruckIcon(st.call_sign), interactive: true, zIndexOffset: 2000 })
          .bindPopup(`<b>${st.call_sign}</b><br/>${st.type}`)
          .addTo(layer);
        mapMarkers.set(st.resource_id, m);
      } else {
        if (st.status === "DEPLOYED" && st.lat != null && st.lng != null) {
          existing.setLatLng([st.lat, st.lng]);
        }
      }
    }
  }, [resourceStates]);

  // ===== Incidents layer =====
  useEffect(() => {
    if (!incidentLayerRef.current) return;
    incidentLayerRef.current.clearLayers();

    incidents.forEach((h) => {
      const isABA = (h.title || "").trim().toUpperCase() === "ABA";
      const title = isABA ? `ABA${h.source ? ` – ${h.source}` : ""}` : h.title;

      L.marker([h.lat, h.lng], { icon: makeIncidentIcon(title, h.solved), interactive: true, zIndexOffset: 2200 })
        .bindPopup(`<b>${title}</b><br/>Status: ${h.solved ? "Løst" : "Aktiv"}`)
        .addTo(incidentLayerRef.current);
    });
  }, [incidents]);

  // ===== Shared movement animator loop (ALL clients) =====
  useEffect(() => {
    let cancelled = false;

    async function ensureRouteForState(st) {
      const key = `${st.resource_id}::${st.move_started_at}::${st.dest_lat},${st.dest_lng}`;
      if (routeCacheRef.current.has(key)) return { key, ...routeCacheRef.current.get(key) };

      const fromLat = st.start_lat ?? st.lat;
      const fromLng = st.start_lng ?? st.lng;
      const toLat = st.dest_lat;
      const toLng = st.dest_lng;

      if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
        const line = [[fromLat ?? DEFAULT_CENTER[0], fromLng ?? DEFAULT_CENTER[1]], [toLat ?? DEFAULT_CENTER[0], toLng ?? DEFAULT_CENTER[1]]];
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        routeCacheRef.current.set(key, { line, cum, total, fallback: true });
        return { key, line, cum, total, fallback: true };
      }

      try {
        const line = await fetchRouteOSRM(fromLat, fromLng, toLat, toLng);
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        routeCacheRef.current.set(key, { line, cum, total, fallback: false });
        return { key, line, cum, total, fallback: false };
      } catch {
        const line = [[fromLat, fromLng], [toLat, toLng]];
        const cum = buildDistances(line);
        const total = cum[cum.length - 1];
        routeCacheRef.current.set(key, { line, cum, total, fallback: true });
        return { key, line, cum, total, fallback: true };
      }
    }

    async function maybeFinalize(st) {
      const { data, error } = await supabase
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
        .select();

      if (error) {
        console.warn("Finalize movement failed:", error);
        return;
      }
      return data;
    }

    async function tick() {
      if (cancelled) return;

      const nowMs = Date.now();
      const moving = resourceStates.filter(
        x => x.status === "MOVING" && x.dest_lat != null && x.dest_lng != null && x.move_started_at
      );

      for (const st of moving) {
        const marker = resourceMarkersRef.current.get(st.resource_id);
        if (!marker) continue;

        const t0 = parseTs(st.move_started_at);
        if (!t0) continue;

        const speed = (st.speed_mps && Number(st.speed_mps) > 0) ? Number(st.speed_mps) : 20.0; // litt fortere
        const elapsedSec = Math.max(0, (nowMs - t0) / 1000);
        const dist = elapsedSec * speed;

        const route = await ensureRouteForState(st);
        if (cancelled) return;

        const total = route.total || 0;
        const pos = interpolateOnLine(route.line, route.cum, dist);
        marker.setLatLng(pos);

        if (dist >= total - 3) {
          marker.setLatLng([st.dest_lat, st.dest_lng]);
          await maybeFinalize(st);
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
  }, [resourceStates]);

  // ===== Actions =====
  const returnToStation = async (resourceId) => {
    if (!sessionId) return;

    await supabase
      .from("resource_states")
      .update({
        status: "ON_STATION",
        lat: null, lng: null,
        start_lat: null, start_lng: null,
        dest_lat: null, dest_lng: null,
        move_started_at: null, speed_mps: null,
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

  const randomPointInEastBox = () => {
    const minLat = 59.20, maxLat = 60.20;
    const minLng = 10.10, maxLng = 11.50;
    return {
      lat: minLat + Math.random() * (maxLat - minLat),
      lng: minLng + Math.random() * (maxLng - minLng),
    };
  };

  const generateABA = async () => {
    if (!sessionId) {
      alert("Venter på økt… prøv igjen.");
      return;
    }
    if (!requireInstructor()) return;

    const src = abaSource.trim();
    if (!src) {
      alert("Fyll inn hvor alarmen kommer fra (kilde).");
      return;
    }

    const { lat, lng } = randomPointInEastBox();

    const { error } = await supabase.from("incidents").insert({
      session_id: sessionId,
      title: "ABA",
      source: src,
      lat,
      lng,
      solved: false,
    });

    if (error) {
      console.error("ABA insert feilet:", error);
      alert(`ABA feilet: ${error.message}`);
      return;
    }

    zoomTo(lat, lng, 13);
  };

  // ===== Search (Nominatim) =====
  const runSearch = async () => {
    const raw = q.trim();
    if (!raw) return;

    const query = /norge|norway/i.test(raw) ? raw : `${raw}, Norge`;
    setSearching(true);
    setSearchError("");
    setResults([]);

    try {
      const viewbox = "10.0,59.0,11.8,60.3";
      const url =
        "https://nominatim.openstreetmap.org/search" +
        "?format=jsonv2&limit=10&addressdetails=1&countrycodes=no" +
        "&viewbox=" + encodeURIComponent(viewbox) +
        "&bounded=1&q=" + encodeURIComponent(query);

      const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "no" } });
      if (!res.ok) throw new Error();

      const data = await res.json();
      const cleaned = (data || []).filter((x) => x.lat && x.lon).map((x) => ({
        display_name: x.display_name,
        lat: Number(x.lat),
        lon: Number(x.lon),
      }));

      setResults(cleaned);
      if (cleaned.length === 0) setSearchError("Fant ingen treff. Prøv: 'Gatenavn nummer, sted' (f.eks. 'Storgata 10, Ski').");
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
        radius: 8, weight: 2,
        color: C.accent, fillColor: C.accent, fillOpacity: 0.2,
      }).addTo(searchLayerRef.current);
    }
  };

  // ===== Render =====
  return (
    <div style={{
      height: "100vh",
      display: "grid",
      gridTemplateColumns: "380px 1fr 520px",
      gap: 12,
      padding: 12,
      background: C.bg,
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    }}>
      {/* LEFT */}
      <div style={panelStyle}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
          <div style={{ fontWeight:900, fontSize:16 }}>Brannressurser</div>
          <button
            onClick={() => { setSelectedResourceId(null); setIncidentMode(v => !v); }}
            style={buttonStyle(incidentMode)}
          >
            Ny hendelse
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {statusMsg} • Del lenken med andre for samme økt.
        </div>

        <div style={{ marginTop: 12, display:"flex", flexDirection:"column", gap:12 }}>
          {stations.map((s) => {
            const isOpen = !!expandedStations[s.id];
            return (
              <div key={s.id} style={cardStyle}>
                <button
                  onClick={() => setExpandedStations(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                  style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    border: "none", background: "transparent", color: C.text, cursor: "pointer", padding: 0,
                    fontWeight: 900,
                  }}
                >
                  <span>{s.name}</span>
                  <span style={{ color: C.muted, fontWeight: 900 }}>{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 10, display:"flex", flexDirection:"column", gap:8 }}>
                    {(resourcesByStation[s.id] || []).map((r) => {
                      const state = resourceStates.find((x) => x.resource_id === r.id);
                      const isPlaced = state?.status === "DEPLOYED" || state?.status === "MOVING";
                      const isMoving = state?.status === "MOVING";
                      const isSelected = selectedResourceId === r.id;

                      return (
                        <div key={r.id} style={{ display:"flex", gap:8, alignItems:"stretch" }}>
                          <button
                            onClick={() => {
                              setIncidentMode(false);
                              setSelectedResourceId(isSelected ? null : r.id);
                            }}
                            style={{
                              flex: 1, textAlign: "left",
                              borderRadius: 12, padding: 10,
                              border: `1px solid ${C.border}`,
                              background: isSelected ? "rgba(147,197,253,0.12)" : "rgba(255,255,255,0.03)",
                              color: C.text, cursor: "pointer",
                            }}
                          >
                            <div style={{ fontWeight: 900 }}>
                              {r.callSign}{" "}
                              <span style={{ fontWeight: 700, color: C.muted, fontSize: 12 }}>({r.type})</span>
                            </div>
                            <div style={{ fontSize: 12, color: C.muted }}>
                              {isMoving ? "Status: På vei" : isPlaced ? "Status: Ute" : "Status: På stasjon"}
                            </div>
                          </button>

                          {isPlaced && (
                            <button
                              onClick={() => returnToStation(r.id)}
                              title="Tilbake til stasjon"
                              style={{
                                width: 52, borderRadius: 12,
                                border: `1px solid ${C.border}`,
                                background: "rgba(255,255,255,0.03)",
                                color: C.text, cursor: "pointer", fontWeight: 900,
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

      {/* CENTER MAP */}
      <div style={{
        background: C.panel,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
        border: `1px solid ${C.border}`,
        position: "relative",
        height: "calc(100vh - 24px)",
      }}>
        {/* Search */}
        <div style={{
          position: "absolute", zIndex: 800, top: 10, left: "50%",
          transform: "translateX(-50%)",
          width: "min(560px, calc(100% - 24px))",
        }}>
          <div style={{
            display: "flex", gap: 8, padding: 10,
            borderRadius: 14, border: `1px solid ${C.border}`,
            background: "rgba(15,23,42,0.92)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
          }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setResults([]);
              }}
              placeholder="Søk adresse (f.eks. 'Storgata 10, Ski')"
              style={{
                flex: 1, borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(255,255,255,0.03)",
                color: C.text, padding: "10px 12px", outline: "none",
              }}
            />
            <button onClick={runSearch} style={buttonStyle(false)} disabled={searching}>
              {searching ? "Søker…" : "Søk"}
            </button>
            <button
              onClick={() => {
                setResults([]); setSearchError("");
                if (searchLayerRef.current) searchLayerRef.current.clearLayers();
              }}
              style={buttonStyle(false)}
            >
              Rydd
            </button>
          </div>

          {searchError && <div style={{ marginTop: 8, fontSize: 12, color: C.danger }}>{searchError}</div>}

          {results.length > 0 && (
            <div style={{ marginTop: 8, borderRadius: 14, border: `1px solid ${C.border}`, background: "rgba(15,23,42,0.96)", overflow: "hidden" }}>
              {results.map((r, idx) => (
                <button
                  key={idx}
                  onClick={() => pickResult(r)}
                  style={{
                    width: "100%", textAlign: "left",
                    padding: "10px 12px",
                    border: "none", background: "transparent",
                    color: C.text, cursor: "pointer",
                    borderTop: idx === 0 ? "none" : `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 12, color: C.muted }}>Treff</div>
                  <div style={{ fontWeight: 800 }}>{r.display_name}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status */}
        <div style={{
          position: "absolute", zIndex: 700, top: 10, left: 10,
          padding: "8px 10px",
          background: "rgba(15,23,42,0.92)",
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          fontSize: 12, color: C.text,
        }}>
          {incidentMode
            ? "Hendelsemodus: klikk i kartet"
            : selectedResourceId
              ? `Klikk i kartet for å sende ${resourcesMaster.find(x=>x.id===selectedResourceId)?.callSign || ""} (viser kjøring for alle)`
              : "Velg ressurs eller trykk “Ny hendelse”"}
        </div>

        <div ref={mapDivRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {/* RIGHT */}
      <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Instructor */}
        <div style={cardStyle}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
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
            <div style={{ marginTop: 10, display:"flex", flexDirection:"column", gap: 8 }}>
              <input
                value={abaSource}
                onChange={(e) => setAbaSource(e.target.value)}
                placeholder="ABA fra (f.eks. 'Rema 1000 Ski', 'Skole - sone 3')"
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
                style={{ ...buttonStyle(false), opacity: sessionId ? 1 : 0.5, cursor: sessionId ? "pointer" : "not-allowed" }}
                disabled={!sessionId}
              >
                Generer ABA-alarm
              </button>
              <div style={{ fontSize: 12, color: C.muted }}>
                ABA vises i rødt felt nederst + lyd.
              </div>
            </div>
          )}
        </div>

        {/* Incidents */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Hendelser</div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
            Klikk en hendelse for å åpne/lukke logg.
          </div>

          <div style={{ marginTop: 12, display:"flex", flexDirection:"column", gap:10 }}>
            {incidents.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>Ingen hendelser opprettet.</div>
            ) : (
              incidents.slice().reverse().map((h) => {
                const isOpen = expandedIncidentId === h.id;
                const hLogs = logsByIncident.get(h.id) || [];
                const isABA = (h.title || "").trim().toUpperCase() === "ABA";
                const headerTitle = isABA ? `ABA${h.source ? ` – ${h.source}` : ""}` : h.title;

                return (
                  <div key={h.id} style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    background: isOpen ? "rgba(147,197,253,0.10)" : "rgba(255,255,255,0.03)",
                    overflow: "hidden",
                  }}>
                    <button
                      onClick={() => { setExpandedIncidentId(prev => (prev === h.id ? null : h.id)); zoomTo(h.lat, h.lng, 13); }}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: 10, border: "none", background: "transparent",
                        color: C.text, cursor: "pointer",
                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
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
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom: 10 }}>
                          {!h.solved && (
                            <button onClick={() => markIncidentSolved(h.id)} style={buttonStyle(false)}>
                              Løst
                            </button>
                          )}
                          <button onClick={() => zoomTo(h.lat, h.lng, 15)} style={buttonStyle(false)}>
                            Zoom
                          </button>
                        </div>

                        <div style={{
                          maxHeight: 200, overflow: "auto",
                          border: `1px solid ${C.border}`,
                          borderRadius: 12, padding: 10,
                          background: "rgba(255,255,255,0.02)",
                        }}>
                          {hLogs.length === 0 ? (
                            <div style={{ fontSize: 12, color: C.muted }}>Ingen logginnslag.</div>
                          ) : (
                            hLogs.map((l) => (
                              <div key={l.id} style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 12, color: C.muted }}>
                                  {(l.author ? `<${l.author}> ` : "")}{new Date(l.created_at).toLocaleString("no-NO")}
                                </div>
                                <div style={{ color: C.text, fontWeight: 700 }}>{l.message}</div>
                              </div>
                            ))
                          )}
                        </div>

                        <div style={{ display:"flex", gap:8, marginTop: 10 }}>
                          <input
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            placeholder="Navn (valgfritt)"
                            style={{
                              width: 160, borderRadius: 12,
                              border: `1px solid ${C.border}`,
                              background: "rgba(255,255,255,0.03)",
                              color: C.text, padding: "10px 12px", outline: "none",
                            }}
                          />
                          <input
                            value={logText}
                            onChange={(e) => setLogText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") sendLog(h.id); }}
                            placeholder="Skriv logg…"
                            style={{
                              flex: 1, borderRadius: 12,
                              border: `1px solid ${C.border}`,
                              background: "rgba(255,255,255,0.03)",
                              color: C.text, padding: "10px 12px", outline: "none",
                            }}
                          />
                          <button onClick={() => sendLog(h.id)} style={buttonStyle(false)}>Send</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ABA field */}
        <div style={{
          borderRadius: 14,
          border: `1px solid ${C.alarmBorder}`,
          background: C.alarmBg,
          padding: 10,
        }}>
          <div style={{ fontWeight: 900, color: "rgba(248,113,113,0.95)" }}>
            ABA-alarmer
          </div>
          <div style={{ marginTop: 6, maxHeight: 160, overflow: "auto" }}>
            {abaAlarms.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>Ingen aktive ABA-alarmer.</div>
            ) : (
              abaAlarms.map((a) => (
                <div key={a.id} style={{
                  borderRadius: 12,
                  border: `1px solid rgba(248,113,113,0.30)`,
                  background: "rgba(220,38,38,0.12)",
                  padding: 10,
                  marginBottom: 8,
                }}>
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
