import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";

const DEFAULT_CENTER = [59.9139, 10.7522];
const DEFAULT_ZOOM = 10;

// --- Masterdata
const stations = [
  { id: "T1", name: "T1 Lørenskog", lat: 59.9326, lng: 10.9650 },
  { id: "S1", name: "S1 Ski",      lat: 59.7195, lng: 10.8350 },
  { id: "M1", name: "M1 Moss",     lat: 59.4370, lng: 10.6570 },
];

const resourcesMaster = [
  { id: "T11", callSign: "T11", type: "Mannskapsbil", stationId: "T1" },
  { id: "T13", callSign: "T13", type: "Høyde",        stationId: "T1" },
  { id: "T14", callSign: "T14", type: "Tankbil",      stationId: "T1" },

  { id: "S11", callSign: "S11", type: "Mannskapsbil", stationId: "S1" },
  { id: "S13", callSign: "S13", type: "Høyde",        stationId: "S1" },
  { id: "S14", callSign: "S14", type: "Tankbil",      stationId: "S1" },

  { id: "M11", callSign: "M11", type: "Mannskapsbil", stationId: "M1" },
  { id: "M13", callSign: "M13", type: "Høyde",        stationId: "M1" },
  { id: "M14", callSign: "M14", type: "Tankbil",      stationId: "M1" },
];

// ---------------------- UI THEME ----------------------
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
      max-width: 240px;
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

// Enkel alarmlyd uten fil (WebAudio)
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
  } catch {
    // hvis audio ikke kan spilles (policy), ignorer
  }
}

export default function App() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);

  const stationLayerRef = useRef(null);
  const resourceLayerRef = useRef(null);
  const incidentLayerRef = useRef(null);
  const searchLayerRef = useRef(null);

  const [sessionId, setSessionId] = useState(null);
  const [statusMsg, setStatusMsg] = useState("Kobler til økt…");

  // Shared state
  const [resourceStates, setResourceStates] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [logs, setLogs] = useState([]);

  // UI state
  const [selectedResourceId, setSelectedResourceId] = useState(null);
  const selectedResourceIdRef = useRef(null);

  const [incidentMode, setIncidentMode] = useState(false);
  const incidentModeRef = useRef(false);

  // Kollaps
  const [expandedStations, setExpandedStations] = useState(() => {
    const obj = {};
    stations.forEach((s) => (obj[s.id] = true));
    return obj;
  });
  const [expandedIncidentId, setExpandedIncidentId] = useState(null);

  // Logg input (gjelder hendelsen som er åpnet)
  const [author, setAuthor] = useState("");
  const [logText, setLogText] = useState("");

  // Instruktør
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

  // ABA-alarmer (deres “alarmfelt”)
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

  // ---------------------- SESSION BOOTSTRAP ----------------------
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

  // Alarmlyd ved NY ABA
  const seenIncidentIdsRef = useRef(new Set());
  useEffect(() => {
    const seen = seenIncidentIdsRef.current;
    // finn nye incidents vi ikke har sett før
    for (const it of incidents) {
      if (!it?.id) continue;
      if (seen.has(it.id)) continue;

      seen.add(it.id);

      const isABA = (it.title || "").trim().toUpperCase() === "ABA";
      if (isABA && !it.solved) {
        playAlarmBeep();
      }
    }
  }, [incidents]);

  // ---------------------- MAP INIT (stations drawn once) ----------------------
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

    // Stasjoner: tegn én gang, aldri clear
    stations.forEach((s) => {
      L.marker([s.lat, s.lng], { icon: makeStationIcon(s.id), interactive: true, zIndexOffset: 2500 })
        .bindPopup(`<b>${s.name}</b>`)
        .addTo(stationLayerRef.current);
    });

    map.on("click", async (e) => {
      if (!sessionId) return;

      // Opprett hendelse (vanlig modus)
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

      // Plasser ressurs
      const rid = selectedResourceIdRef.current;
      if (!rid) return;

      const r = resourcesMaster.find((x) => x.id === rid);
      if (!r) return;

      await supabase.from("resource_states").upsert(
        {
          session_id: sessionId,
          resource_id: r.id,
          call_sign: r.callSign,
          type: r.type,
          station_id: r.stationId,
          status: "DEPLOYED",
          lat: e.latlng.lat,
          lng: e.latlng.lng,
        },
        { onConflict: "session_id,resource_id" }
      );

      setSelectedResourceId(null);
    });

    setTimeout(() => map.invalidateSize(), 100);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, [sessionId]);

  // ---------------------- LAYERS RENDER (resources/incidents only) ----------------------
  useEffect(() => {
    if (!resourceLayerRef.current) return;
    resourceLayerRef.current.clearLayers();

    resourceStates
      .filter((x) => x.status === "DEPLOYED" && x.lat != null && x.lng != null)
      .forEach((r) => {
        L.marker([r.lat, r.lng], { icon: makeFireTruckIcon(r.call_sign), interactive: true, zIndexOffset: 1800 })
          .bindPopup(`<b>${r.call_sign}</b><br/>${r.type}`)
          .addTo(resourceLayerRef.current);
      });
  }, [resourceStates]);

  useEffect(() => {
    if (!incidentLayerRef.current) return;
    incidentLayerRef.current.clearLayers();

    incidents.forEach((h) => {
      const title = (h.title || "").trim().toUpperCase() === "ABA"
        ? `ABA${h.source ? ` – ${h.source}` : ""}`
        : h.title;

      L.marker([h.lat, h.lng], { icon: makeIncidentIcon(title, h.solved), interactive: true, zIndexOffset: 2000 })
        .bindPopup(`<b>${title}</b><br/>Status: ${h.solved ? "Løst" : "Aktiv"}`)
        .addTo(incidentLayerRef.current);
    });
  }, [incidents]);

  // ---------------------- ACTIONS ----------------------
  const returnToStation = async (resourceId) => {
    if (!sessionId) return;
    await supabase
      .from("resource_states")
      .update({ status: "ON_STATION", lat: null, lng: null })
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
    if (!sessionId) return;
    if (!requireInstructor()) return;

    const src = abaSource.trim();
    if (!src) {
      alert("Instruktør: fyll inn hvor alarmen kommer fra (kilde).");
      return;
    }

    const { lat, lng } = randomPointInEastBox();

    await supabase.from("incidents").insert({
      session_id: sessionId,
      title: "ABA",
      source: src,
      lat,
      lng,
      solved: false,
    });

    zoomTo(lat, lng, 13);
    setExpandedIncidentId(null);
  };

  // ---------------------- SEARCH ----------------------
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
      L.circleMarker([r.lat, r.lon], { radius: 8, weight: 2, color: C.accent, fillColor: C.accent, fillOpacity: 0.2 })
        .addTo(searchLayerRef.current);
    }
  };

  // ---------------------- RENDER ----------------------
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
      {/* LEFT: RESOURCES */}
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
                  title="Kollaps/utvid"
                >
                  <span>{s.name}</span>
                  <span style={{ color: C.muted, fontWeight: 900 }}>{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div style={{ marginTop: 10, display:"flex", flexDirection:"column", gap:8 }}>
                    {(resourcesByStation[s.id] || []).map((r) => {
                      const state = resourceStates.find((x) => x.resource_id === r.id);
                      const isPlaced = state?.status === "DEPLOYED";
                      const isSelected = selectedResourceId === r.id;

                      return (
                        <div key={r.id} style={{ display:"flex", gap:8, alignItems:"stretch" }}>
                          <button
                            onClick={() => {
                              setIncidentMode(false);
                              setSelectedResourceId(isSelected ? null : r.id);
                            }}
                            style={{
                              flex: 1,
                              textAlign: "left",
                              borderRadius: 12,
                              padding: 10,
                              border: `1px solid ${C.border}`,
                              background: isSelected ? "rgba(147,197,253,0.12)" : "rgba(255,255,255,0.03)",
                              color: C.text,
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ fontWeight: 900 }}>
                              {r.callSign}{" "}
                              <span style={{ fontWeight: 700, color: C.muted, fontSize: 12 }}>({r.type})</span>
                            </div>
                            <div style={{ fontSize: 12, color: C.muted }}>
                              {isPlaced ? "Status: Ute / plassert" : "Status: På stasjon"}
                            </div>
                          </button>

                          {isPlaced && (
                            <button
                              onClick={() => returnToStation(r.id)}
                              title="Tilbake til stasjon"
                              style={{
                                width: 52,
                                borderRadius: 12,
                                border: `1px solid ${C.border}`,
                                background: "rgba(255,255,255,0.03)",
                                color: C.text,
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

      {/* CENTER: MAP */}
      <div style={{
        background: C.panel,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
        border: `1px solid ${C.border}`,
        position: "relative",
        height: "calc(100vh - 24px)",
      }}>
        {/* Search box */}
        <div style={{
          position: "absolute",
          zIndex: 800,
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(560px, calc(100% - 24px))",
        }}>
          <div style={{
            display: "flex",
            gap: 8,
            padding: 10,
            borderRadius: 14,
            border: `1px solid ${C.border}`,
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
                flex: 1,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(255,255,255,0.03)",
                color: C.text,
                padding: "10px 12px",
                outline: "none",
              }}
            />
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
              title="Fjern søkemarkør"
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
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    background: "transparent",
                    color: C.text,
                    cursor: "pointer",
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
        }}>
          {incidentMode
            ? "Hendelsemodus: klikk i kartet"
            : selectedResourceId
              ? `Klikk i kartet for å plassere ${resourcesMaster.find(x=>x.id===selectedResourceId)?.callSign || ""}`
              : "Velg ressurs eller trykk “Ny hendelse”"}
        </div>

        <div ref={mapDivRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {/* RIGHT: INCIDENTS + LOGG + ABA ALARMS */}
      <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Instruktørpanel */}
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
              <button onClick={generateABA} style={buttonStyle(false)}>
                Generer ABA-alarm
              </button>
              <div style={{ fontSize: 12, color: C.muted }}>
                Alarm går til alle i samme økt (og spiller lyd).
              </div>
            </div>
          )}
        </div>

        {/* Hendelser (accordion) */}
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
                      title="Kollaps/utvid"
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
                          maxHeight: 200,
                          overflow: "auto",
                          border: `1px solid ${C.border}`,
                          borderRadius: 12,
                          padding: 10,
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

        {/* ABA alarmfelt nederst til høyre */}
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
