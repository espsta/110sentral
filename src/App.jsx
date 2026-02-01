import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [59.9139, 10.7522];
const DEFAULT_ZOOM = 10;

// ---------------------- DATA ----------------------
const stations = [
  { id: "T1", name: "T1 Lørenskog", lat: 59.9326, lng: 10.9650 },
  { id: "S1", name: "S1 Ski",      lat: 59.7195, lng: 10.8350 },
  { id: "M1", name: "M1 Moss",     lat: 59.4370, lng: 10.6570 },
];

const resources = [
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
    ">${text}</div>
  `;
}

// Ressurs-ikon: kallesignal + brannbil
function makeFireTruckIcon(callSign) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        display:flex; flex-direction:column; align-items:center;
        transform: translate(-50%, -100%);
        user-select:none; pointer-events:none;
      ">
        ${labelBoxHtml(callSign)}
        <div style="font-size:22px; line-height:1; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35));">🚒</div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

// Stasjons-ikon: stasjonskode + hus
function makeStationIcon(code) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        display:flex; flex-direction:column; align-items:center;
        transform: translate(-50%, -100%);
        user-select:none; pointer-events:none;
      ">
        ${labelBoxHtml(code)}
        <div style="font-size:20px; line-height:1; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35));">🏠</div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

// Hendelse-ikon: tittel + glyph
function makeIncidentIcon(title, solved) {
  const text = solved ? `${title} (LØST)` : title;
  const glyph = solved ? "✅" : "🚨";
  return L.divIcon({
    className: "",
    html: `
      <div style="
        display:flex; flex-direction:column; align-items:center;
        transform: translate(-50%, -100%);
        user-select:none; pointer-events:none;
      ">
        ${labelBoxHtml(text, solved ? "solved" : "normal")}
        <div style="font-size:20px; line-height:1; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35)); opacity:${solved ? 0.8 : 1};">
          ${glyph}
        </div>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  });
}

export default function App() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);

  const stationLayerRef = useRef(null);
  const resourceLayerRef = useRef(null);
  const incidentLayerRef = useRef(null);
  const searchLayerRef = useRef(null);

  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);

  const [placements, setPlacements] = useState({}); // resourceId -> {lat,lng}

  const [incidentMode, setIncidentMode] = useState(false);
  const incidentModeRef = useRef(false);

  const [incidents, setIncidents] = useState([]); // {id,title,lat,lng,solved}

  // Søk
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  const selected = useMemo(
    () => resources.find((r) => r.id === selectedId) || null,
    [selectedId]
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    incidentModeRef.current = incidentMode;
  }, [incidentMode]);

  const resourcesByStation = useMemo(() => {
    const grouped = {};
    for (const s of stations) grouped[s.id] = [];
    for (const r of resources) grouped[r.stationId].push(r);
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => a.callSign.localeCompare(b.callSign, "no"));
    }
    return grouped;
  }, []);

  // ---------------------- MAP INIT ----------------------
  useEffect(() => {
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapDivRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    mapRef.current = map;

    // LYST kart (ikke mørk)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap-bidragsytere &copy; CARTO",
    }).addTo(map);

    stationLayerRef.current = L.layerGroup().addTo(map);
    resourceLayerRef.current = L.layerGroup().addTo(map);
    incidentLayerRef.current = L.layerGroup().addTo(map);
    searchLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e) => {
      // 1) Opprette hendelse
      if (incidentModeRef.current) {
        const title = window.prompt("Overskrift/hendelsestype (f.eks. 'Brann i bolig'):");
        if (!title || !title.trim()) return;

        const id = `H${String(Date.now()).slice(-6)}`;
        setIncidents((prev) => [
          ...prev,
          { id, title: title.trim(), lat: e.latlng.lat, lng: e.latlng.lng, solved: false },
        ]);

        setIncidentMode(false);
        return;
      }

      // 2) Plassere ressurs
      const id = selectedIdRef.current;
      if (!id) return;

      setPlacements((prev) => ({
        ...prev,
        [id]: { lat: e.latlng.lat, lng: e.latlng.lng },
      }));
      setSelectedId(null);
    });

    setTimeout(() => map.invalidateSize(), 50);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

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

    Object.entries(placements).forEach(([rid, pos]) => {
      const r = resources.find((x) => x.id === rid);
      if (!r) return;

      L.marker([pos.lat, pos.lng], { icon: makeFireTruckIcon(r.callSign), interactive: true })
        .bindPopup(`<b>${r.callSign}</b><br/>${r.type}`)
        .addTo(resourceLayerRef.current);
    });
  }, [placements]);

  useEffect(() => {
    if (!incidentLayerRef.current) return;
    incidentLayerRef.current.clearLayers();

    incidents.forEach((h) => {
      L.marker([h.lat, h.lng], { icon: makeIncidentIcon(h.title, h.solved), interactive: true })
        .bindPopup(`<b>${h.title}</b><br/>ID: ${h.id}<br/>Status: ${h.solved ? "Løst" : "Aktiv"}`)
        .addTo(incidentLayerRef.current);
    });
  }, [incidents]);

  // ---------------------- ACTIONS ----------------------
  const zoomTo = (lat, lng, minZoom = 13) => {
    if (!mapRef.current) return;
    const z = Math.max(mapRef.current.getZoom(), minZoom);
    mapRef.current.setView([lat, lng], z);
  };

  const reset = () => {
    setPlacements({});
    setSelectedId(null);
    setIncidentMode(false);
    setIncidents([]);
    setResults([]);
    setQ("");
    setSearchError("");
    if (searchLayerRef.current) searchLayerRef.current.clearLayers();
  };

  const returnToStation = (resourceId) => {
    setPlacements((prev) => {
      const next = { ...prev };
      delete next[resourceId];
      return next;
    });
    setSelectedId(null);
  };

  const markIncidentSolved = (incidentId) => {
    setIncidents((prev) => prev.map((h) => (h.id === incidentId ? { ...h, solved: true } : h)));
  };

  // ---------------------- SEARCH (IMPROVED) ----------------------
  const runSearch = async () => {
    const raw = q.trim();
    if (!raw) return;

    // Hjelp: legg til Norge hvis ikke nevnt
    const query = /norge|norway/i.test(raw) ? raw : `${raw}, Norge`;

    setSearching(true);
    setSearchError("");
    setResults([]);

    try {
      // Grov avgrensning til Øst-området: (minLon, minLat, maxLon, maxLat)
      // Justér hvis dere ønsker større/mindre område.
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

      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "no",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const cleaned = (data || [])
        .filter((x) => x.lat && x.lon)
        .map((x) => ({
          display_name: x.display_name,
          lat: Number(x.lat),
          lon: Number(x.lon),
        }));

      setResults(cleaned);

      if (cleaned.length > 0) {
        const top = cleaned[0];
        zoomTo(top.lat, top.lon, 15);

        if (searchLayerRef.current) {
          searchLayerRef.current.clearLayers();
          L.circleMarker([top.lat, top.lon], {
            radius: 8,
            weight: 2,
            color: C.accent,
            fillColor: C.accent,
            fillOpacity: 0.2,
          }).addTo(searchLayerRef.current);
        }
      } else {
        setSearchError("Fant ingen treff. Prøv: 'Gatenavn nummer, sted' (f.eks. 'Storgata 10, Ski').");
      }
    } catch (e) {
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

  // ---------------------- STYLES ----------------------
  const panelStyle = {
    background: C.panel,
    borderRadius: 14,
    padding: 12,
    overflow: "auto",
    boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
    border: `1px solid ${C.border}`,
    color: C.text,
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

  const cardStyle = {
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 10,
    background: C.card,
  };

  // ---------------------- RENDER ----------------------
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateColumns: "380px 1fr 420px",
        gap: 12,
        padding: 12,
        background: C.bg,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      {/* VENSTRE: RESSURSER */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Brannressurser</div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setSelectedId(null);
                setIncidentMode((v) => !v);
              }}
              style={buttonStyle(incidentMode)}
              title="Opprett en ny hendelse"
            >
              Ny hendelse
            </button>

            <button onClick={reset} style={buttonStyle(false)} title="Nullstill alt">
              Nullstill
            </button>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {incidentMode
            ? "Hendelsemodus: klikk i kartet og skriv overskrift."
            : "Klikk ressurs → klikk i kartet for å plassere."}
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {stations.map((s) => (
            <div key={s.id} style={cardStyle}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>{s.name}</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(resourcesByStation[s.id] || []).map((r) => {
                  const isSelected = r.id === selectedId;
                  const isPlaced = !!placements[r.id];

                  return (
                    <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <button
                        onClick={() => {
                          setIncidentMode(false);
                          setSelectedId(isSelected ? null : r.id);
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
                          <span style={{ fontWeight: 700, color: C.muted, fontSize: 12 }}>
                            ({r.type})
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted }}>
                          {isPlaced ? "Status: Ute / plassert" : "Status: På stasjon"}
                        </div>
                      </button>

                      {isPlaced && (
                        <button
                          onClick={() => returnToStation(r.id)}
                          title="Fjern markør (tilbake til stasjon)"
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

        <div style={{ marginTop: 12, fontSize: 12, color: C.muted }}>
          Valgt ressurs: <b style={{ color: C.text }}>{selected ? selected.callSign : "Ingen"}</b>
        </div>
      </div>

      {/* MIDTEN: KART */}
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
        {/* Søkeboks (midt øverst) */}
        <div
          style={{
            position: "absolute",
            zIndex: 800,
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(560px, calc(100% - 24px))",
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
            }}
          >
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

          {searchError && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.danger }}>
              {searchError}
            </div>
          )}

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
                  title="Zoom til treff"
                >
                  <div style={{ fontWeight: 800, fontSize: 12, color: C.muted }}>Treff</div>
                  <div style={{ fontWeight: 800 }}>{r.display_name}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status-boks (venstre øverst på kart) */}
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
            ? "Hendelsemodus: klikk i kartet for å opprette hendelse"
            : selected
              ? `Klikk i kartet for å plassere ${selected.callSign}`
              : "Velg en ressurs eller trykk “Ny hendelse”"}
        </div>

        <div ref={mapDivRef} style={{ height: "100%", width: "100%" }} />
      </div>

      {/* HØYRE: HENDELSER */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Hendelser</div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          Opprett via “Ny hendelse”. Marker “Løst” når ferdig.
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {incidents.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted }}>Ingen hendelser opprettet.</div>
          ) : (
            incidents
              .slice()
              .reverse()
              .map((h) => (
                <div
                  key={h.id}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 10,
                    background: h.solved ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>
                    {h.title}{" "}
                    <span style={{ fontWeight: 800, color: C.muted, fontSize: 12 }}>
                      ({h.id})
                    </span>
                  </div>

                  <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
                    Status: {h.solved ? "Løst" : "Aktiv"}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => zoomTo(h.lat, h.lng, 13)} style={buttonStyle(false)}>
                      Zoom
                    </button>

                    {!h.solved && (
                      <button onClick={() => markIncidentSolved(h.id)} style={buttonStyle(false)}>
                        Løst
                      </button>
                    )}
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
