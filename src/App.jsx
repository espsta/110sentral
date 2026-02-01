import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";

const DEFAULT_CENTER = [59.9139, 10.7522];
const DEFAULT_ZOOM = 10;

// --- Felles “masterdata” som vi også speiler i DB ved session-start
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

// ---------------------- UI ----------------------
const C = {
  bg: "#0b1220",
  panel: "#0f172a",
  card: "#111c33",
  border: "rgba(255,255,255,0.10)",
  text: "#e5e7eb",
  muted: "rgba(229,231,235,0.70)",
  accent: "#93c5fd",
  danger: "rgba(248,113,113,0.95)",
};

function labelBoxHtml(text, tone = "normal") {
  const solved = tone === "solved";
  return `
    <div style="
      font-weight:900;
      font-size:12px;
      line-height:1.1;
      color:${solved ? "rgba(229,231,235,0.75)" : "rgba(17,24,39,0.92)"};
      background:${solved ? "rgba(245,245,245,0.95)" : "rgba(255,255,255,0.95)"};
      border:1px solid rgba(0,0,0,0.12);
      border-radius:8px;
      padding:2px 6px;
      box-shadow:0 1px 6px rgba(0,0,0,0.25);
      margin-bottom:4px;
      white-space:nowrap;
      max-width: 220px;
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

export default function App() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);

  const stationLayerRef = useRef(null);
  const resourceLayerRef = useRef(null);
  const incidentLayerRef = useRef(null);
  const searchLayerRef = useRef(null);

  const [sessionId, setSessionId] = useState(null);
  const [sessionCode, setSessionCode] = useState(getSessionCodeFromUrl() || "");
  const [statusMsg, setStatusMsg] = useState("Kobler til økt…");

  // Delte data (fra DB)
  const [resourceStates, setResourceStates] = useState([]); // rows from resource_states
  const [incidents, setIncidents] = useState([]);          // rows from incidents
  const [logs, setLogs] = useState([]);                    // rows from incident_logs

  // UI state
  const [selectedResourceId, setSelectedResourceId] = useState(null);
  const selectedResourceIdRef = useRef(null);
  const [incidentMode, setIncidentMode] = useState(false);
  const incidentModeRef = useRef(false);

  // loggpanel
  const [activeIncidentId, setActiveIncidentId] = useState(null);
  const [author, setAuthor] = useState("");
  const [logText, setLogText] = useState("");

  // søk
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
      setSessionCode(code);

      // finn eller lag session
      setStatusMsg("Finner/oppter økt…");
      let { data: existing, error: e1 } = await supabase
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

      // Seed resource_states (upsert) slik at alle alltid har samme liste i DB
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

      // initial fetch
      const [rs, inc, lg] = await Promise.all([
        supabase.from("resource_states").select("*").eq("session_id", sid),
        supabase.from("incidents").select("*").eq("session_id", sid).order("created_at", { ascending: true }),
        supabase.from("incident_logs").select("*").eq("session_id", sid).order("created_at", { ascending: true }),
      ]);

      if (!rs.error) setResourceStates(rs.data || []);
      if (!inc.error) setIncidents(inc.data || []);
      if (!lg.error) setLogs(lg.data || []);

      // realtime subscriptions (filtered per session_id)
      const ch = supabase.channel(`session:${sid}`);

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "resource_states", filter: `session_id=eq.${sid}` },
        (payload) => {
          setResourceStates((prev) => upsertByKey(prev, payload, ["session_id", "resource_id"]));
        }
      );

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents", filter: `session_id=eq.${sid}` },
        (payload) => {
          setIncidents((prev) => upsertById(prev, payload));
        }
      );

      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incident_logs", filter: `session_id=eq.${sid}` },
        (payload) => {
          setLogs((prev) => upsertById(prev, payload));
        }
      );

      ch.subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    })();
  }, []);

  // helpers for realtime merging
  function upsertById(prev, payload) {
    const row = payload.new || payload.old;
    if (!row) return prev;

    if (payload.eventType === "DELETE") {
      return prev.filter((x) => x.id !== row.id);
    }

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

  // ---------------------- MAP INIT ----------------------
  useEffect(() => {
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapDivRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    mapRef.current = map;

    // LYST kart
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap-bidragsytere &copy; CARTO",
    }).addTo(map);

    stationLayerRef.current = L.layerGroup().addTo(map);
    resourceLayerRef.current = L.layerGroup().addTo(map);
    incidentLayerRef.current = L.layerGroup().addTo(map);
    searchLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", async (e) => {
      if (!sessionId) return;

      // 1) Opprett hendelse i DB
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

      // 2) Plasser ressurs (DB upsert/update)
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

    setTimeout(() => map.invalidateSize(), 50);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, [sessionId]);

  // ---------------------- LAYERS RENDER ----------------------
  useEffect(() => {
    if (!stationLayerRef.current) return;
    stationLayerRef.current.clearLayers();

    stations.forEach((s) => {
      L.marker([s.lat, s.lng], { icon: makeStationIcon(s.id), interactive: true })
        .bindPopup(`<b>${s.name}</b>`)
        .addTo(stationLayerRef.current);
    });
  }, []);

  useEffect(() => {
    if (!resourceLayerRef.current) return;
    resourceLayerRef.current.clearLayers();

    resourceStates
      .filter((x) => x.status === "DEPLOYED" && x.lat != null && x.lng != null)
      .forEach((r) => {
        L.marker([r.lat, r.lng], { icon: makeFireTruckIcon(r.call_sign), interactive: true })
          .bindPopup(`<b>${r.call_sign}</b><br/>${r.type}`)
          .addTo(resourceLayerRef.current);
      });
  }, [resourceStates]);

  useEffect(() => {
    if (!incidentLayerRef.current) return;
    incidentLayerRef.current.clearLayers();

    incidents.forEach((h) => {
      L.marker([h.lat, h.lng], { icon: makeIncidentIcon(h.title, h.solved), interactive: true })
        .on("click", () => setActiveIncidentId(h.id))
        .bindPopup(`<b>${h.title}</b><br/>Status: ${h.solved ? "Løst" : "Aktiv"}`)
        .addTo(incidentLayerRef.current);
    });
  }, [incidents]);

  // ---------------------- ACTIONS ----------------------
  const returnToStation = async (resourceId) => {
    if (!sessionId) return;
    await supabase.from("resource_states").update({
      status: "ON_STATION",
      lat: null,
      lng: null,
    }).eq("session_id", sessionId).eq("resource_id", resourceId);

    setSelectedResourceId(null);
  };

  const markIncidentSolved = async (incidentId) => {
    if (!sessionId) return;
    await supabase.from("incidents").update({ solved: true }).eq("id", incidentId).eq("session_id", sessionId);
  };

  const sendLog = async () => {
    if (!sessionId || !activeIncidentId) return;
    const msg = logText.trim();
    if (!msg) return;

    await supabase.from("incident_logs").insert({
      session_id: sessionId,
      incident_id: activeIncidentId,
      author: author.trim() || null,
      message: msg,
    });

    setLogText("");
  };

  const activeIncident = incidents.find((x) => x.id === activeIncidentId) || null;
  const activeLogs = logs.filter((l) => l.incident_id === activeIncidentId);

  // ---------------------- SEARCH (Nominatim) ----------------------
  const runSearch = async () => {
    const raw = q.trim();
    if (!raw) return;

    const query = /norge|norway/i.test(raw) ? raw : `${raw}, Norge`;

    setSearching(true);
    setSearchError("");
    setResults([]);

    try {
      // Grov avgrensning til “Øst-ish”
      const viewbox = "10.0,59.0,11.8,60.3";

      const url =
        "https://nominatim.openstreetmap.org/search" +
        "?format=jsonv2" +
        "&limit=10" +
        "&addressdetails=1" +
        "&countrycodes=no" +
        "&viewbox=" + encodeURIComponent(viewbox) +
        "&bounded=1" +
        "&q=" + encodeURIComponent(query);

      const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "no" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const cleaned = (data || []).filter((x) => x.lat && x.lon).map((x) => ({
        display_name: x.display_name,
        lat: Number(x.lat),
        lon: Number(x.lon),
      }));

      setResults(cleaned);

      if (cleaned.length > 0) {
        pickResult(cleaned[0]);
      } else {
        setSearchError("Fant ingen treff. Prøv: 'Gatenavn nummer, sted' (f.eks. 'Storgata 10, Ski').");
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

  // ---------------------- RENDER ----------------------
  return (
    <div style={{
      height: "100vh",
      display: "grid",
      gridTemplateColumns: "380px 1fr 460px",
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
            onClick={() => {
              setSelectedResourceId(null);
              setIncidentMode(v => !v);
            }}
            style={buttonStyle(incidentMode)}
          >
            Ny hendelse
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {statusMsg} • Del lenken: <b style={{ color: C.text }}>{window.location.href}</b>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {incidentMode ? "Hendelsemodus: klikk i kartet for å opprette." : "Klikk ressurs → klikk i kartet for å plassere."}
        </div>

        <div style={{ marginTop: 12, display:"flex", flexDirection:"column", gap:12 }}>
          {stations.map((s) => (
            <div key={s.id} style={cardStyle}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>{s.name}</div>

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
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
            </div>
          ))}
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

      {/* RIGHT: INCIDENTS + LOG */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Hendelser</div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          Klikk en hendelse for å se logg. Alt synkes i sanntid.
        </div>

        <div style={{ marginTop: 12, display:"flex", flexDirection:"column", gap:10 }}>
          {incidents.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted }}>Ingen hendelser opprettet.</div>
          ) : (
            incidents.slice().reverse().map((h) => (
              <div key={h.id} style={{
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 10,
                background: activeIncidentId === h.id ? "rgba(147,197,253,0.10)" : "rgba(255,255,255,0.03)",
                cursor: "pointer",
              }}
              onClick={() => { setActiveIncidentId(h.id); zoomTo(h.lat, h.lng, 13); }}
              >
                <div style={{ fontWeight: 900 }}>
                  {h.title}{" "}
                  <span style={{ fontWeight: 800, color: C.muted, fontSize: 12 }}>
                    ({String(h.id).slice(0, 8)})
                  </span>
                </div>

                <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
                  Status: {h.solved ? "Løst" : "Aktiv"}
                </div>

                <div style={{ marginTop: 10, display:"flex", gap:8, flexWrap:"wrap" }}>
                  {!h.solved && (
                    <button onClick={(e) => { e.stopPropagation(); markIncidentSolved(h.id); }} style={buttonStyle(false)}>
                      Løst
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Logg */}
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Logg</div>

          {!activeIncident ? (
            <div style={{ fontSize: 12, color: C.muted }}>Velg en hendelse for å loggføre.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{ fontSize: 12, color: C.muted }}>
                Hendelse: <b style={{ color: C.text }}>{activeIncident.title}</b>
              </div>

              <div style={{
                maxHeight: 220,
                overflow: "auto",
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 10,
                background: "rgba(255,255,255,0.02)",
              }}>
                {activeLogs.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.muted }}>Ingen logginnslag.</div>
                ) : (
                  activeLogs.map((l) => (
                    <div key={l.id} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: C.muted }}>
                        {l.author ? `<${l.author}>` : ""} {new Date(l.created_at).toLocaleString("no-NO")}
                      </div>
                      <div style={{ color: C.text, fontWeight: 700 }}>{l.message}</div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display:"flex", gap:8 }}>
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
                  onKeyDown={(e) => { if (e.key === "Enter") sendLog(); }}
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
                <button onClick={sendLog} style={buttonStyle(false)}>Send</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
