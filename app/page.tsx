"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CommuteSearchResponse,
  NearbyStation,
  PlaceSuggestion,
  ReachableStation,
} from "@/lib/commute-types";
import {
  getLineColor,
  getLineShortName,
  getLineStationOrder,
} from "@/lib/tokyo-line-order";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

const initialResult: CommuteSearchResponse = {
  destination: { name: "东京大学", subtitle: "本乡校区 · 文京区", lat: 35.7126, lng: 139.7619 },
  requestedMinutes: 35,
  candidateStationCount: 0,
  commuteBufferMinutes: 3,
  nearbyStations: [
    { id: "todaimae", name: "东大前", nameJa: "東大前", lines: ["东京Metro南北线"], walkingMinutes: 4, accent: "#48a999" },
    { id: "hongosanchome", name: "本乡三丁目", nameJa: "本郷三丁目", lines: ["东京Metro丸之内线", "都营大江户线"], walkingMinutes: 11, accent: "#e95d55" },
    { id: "nezu", name: "根津", nameJa: "根津", lines: ["东京Metro千代田线"], walkingMinutes: 14, accent: "#34a56f" },
  ],
  reachableStations: [],
  properties: [],
  propertySource: "unavailable",
  generatedAt: "",
  source: "demo",
};

type RailGroup = {
  line: string;
  shortName: string;
  color: string;
  nodes: Array<{
    nameJa: string;
    station?: ReachableStation;
  }>;
};

function buildRailGroups(
  stations: ReachableStation[],
  allowedLines?: string[],
): RailGroup[] {
  const stationsByLine = new Map<string, ReachableStation[]>();
  for (const station of stations) {
    for (const line of station.lines) {
      if (allowedLines && !allowedLines.includes(line)) continue;
      const lineStations = stationsByLine.get(line) ?? [];
      if (!lineStations.some((candidate) => candidate.id === station.id)) {
        lineStations.push(station);
      }
      stationsByLine.set(line, lineStations);
    }
  }

  return [...stationsByLine.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja"))
    .slice(0, 6)
    .map(([line, lineStations]) => {
      const fullOrder = getLineStationOrder(line);
      const stationByName = new Map(lineStations.map((station) => [station.nameJa, station]));
      const knownIndexes = lineStations
        .map((station) => fullOrder.indexOf(station.nameJa))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);

      let contextNames: string[];
      if (knownIndexes.length >= 2) {
        const first = Math.max(0, knownIndexes[0] - 1);
        const last = Math.min(fullOrder.length, knownIndexes[knownIndexes.length - 1] + 2);
        const span = last - first;
        contextNames = span <= 8
          ? fullOrder.slice(first, last)
          : knownIndexes.map((index) => fullOrder[index]);
      } else if (knownIndexes.length === 1) {
        const stationIndex = knownIndexes[0];
        contextNames = fullOrder.slice(
          Math.max(0, stationIndex - 1),
          Math.min(fullOrder.length, stationIndex + 2),
        );
      } else {
        contextNames = [...lineStations]
          .sort((a, b) => a.bestDoorToDoorMinutes - b.bestDoorToDoorMinutes)
          .map((station) => station.nameJa);
      }

      return {
        line,
        shortName: getLineShortName(line),
        color: getLineColor(line),
        nodes: contextNames.map((nameJa) => ({
          nameJa,
          station: stationByName.get(nameJa),
        })),
      };
    });
}

function formatDistance(distanceMeters?: number) {
  if (distanceMeters == null) return "";
  if (distanceMeters < 1000) return `${Math.max(10, Math.round(distanceMeters / 10) * 10)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function getOsmEmbedUrl(place: PlaceSuggestion) {
  const lngDelta = 0.008;
  const latDelta = 0.006;
  const bbox = [
    place.lng - lngDelta,
    place.lat - latDelta,
    place.lng + lngDelta,
    place.lat + latDelta,
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${place.lat}%2C${place.lng}`;
}

function Icon({ name, size = 20 }: { name: "pin" | "clock" | "train" | "walk" | "arrow" | "search" | "spark"; size?: number }) {
  const paths = {
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    train: <><rect x="5" y="3" width="14" height="15" rx="3"/><path d="M8 21l2-3m6 0 2 3M8 8h8M8 13h.01M16 13h.01"/></>,
    walk: <><circle cx="13" cy="4" r="2"/><path d="m10 22 1-7-3-2 2-6 5 3 3 1M11 15l5 7"/></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    spark: <><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3Z"/><path d="m5 14 .7 2.3L8 17.5l-2.3 1.2L5 21l-.7-2.3L2 17.5l2.3-1.2L5 14Z"/></>,
  };

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [destination, setDestination] = useState("东京大学");
  const [maxMinutes, setMaxMinutes] = useState(35);
  const [result, setResult] = useState<CommuteSearchResponse>(initialResult);
  const [selected, setSelected] = useState<ReachableStation | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPlaceMap, setShowPlaceMap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accessStationLoadingId, setAccessStationLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const selectedDestinationStation = useMemo(
    () => result.nearbyStations.find(
      (station) => station.id === result.selectedNearbyStationId,
    ) ?? null,
    [result.nearbyStations, result.selectedNearbyStationId],
  );
  const lineCount = useMemo(
    () => selectedDestinationStation
      ? selectedDestinationStation.lines.length
      : new Set(result.reachableStations.flatMap((station) => station.lines)).size,
    [result.reachableStations, selectedDestinationStation],
  );
  const railGroups = useMemo(
    () => buildRailGroups(
      result.reachableStations,
      selectedDestinationStation?.lines,
    ),
    [result.reachableStations, selectedDestinationStation],
  );
  const visibleProperties = useMemo(
    () => selected
      ? result.properties.filter((property) => property.station.key === selected.id)
      : result.properties,
    [result.properties, selected],
  );

  useEffect(() => {
    const query = destination.trim();
    if (query.length < 2 || selectedPlace?.name === query) {
      setPlaceSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const response = await fetch(apiUrl(`/api/places?q=${encodeURIComponent(query)}`), {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "地点搜索失败");
        setPlaceSuggestions(data.suggestions ?? []);
        setShowSuggestions(true);
      } catch (suggestionError) {
        if (!(suggestionError instanceof DOMException && suggestionError.name === "AbortError")) {
          setPlaceSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false);
      }
    }, 550);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destination, selectedPlace]);

  function choosePlace(place: PlaceSuggestion) {
    setDestination(place.name);
    setSelectedPlace(place);
    setPlaceSuggestions([]);
    setShowSuggestions(false);
    setShowPlaceMap(false);
  }

  function chooseStation(station: ReachableStation) {
    setSelected(station);
    window.setTimeout(() => {
      document.getElementById("property-results")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }

  async function requestCommute(destinationStationId?: string) {
    const response = await fetch(apiUrl("/api/commute"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination,
        maxMinutes,
        destinationStationId,
        destinationPlace: selectedPlace
          ? {
              lat: selectedPlace.lat,
              lng: selectedPlace.lng,
              address: selectedPlace.address,
            }
          : undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "搜索失败");
    return data as CommuteSearchResponse;
  }

  async function chooseDestinationStation(station: NearbyStation) {
    if (accessStationLoadingId) return;
    setAccessStationLoadingId(station.id);
    setError("");
    setSelected(null);

    try {
      const data = await requestCommute(station.id);
      setResult(data);
      window.setTimeout(() => {
        document.getElementById("commute-lines")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 80);
    } catch (stationError) {
      setError(stationError instanceof Error ? stationError.message : "入口站计算失败，请重试。");
    } finally {
      setAccessStationLoadingId(null);
    }
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSelected(null);
    setShowSuggestions(false);
    setShowPlaceMap(false);

    try {
      const data = await requestCommute();
      setResult(data);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "搜索失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="Tokyo Commute Finder 首页">
          <span className="brand-mark"><Icon name="train" size={22} /></span>
          <span>よりみち</span>
          <small>COMMUTE FINDER</small>
        </a>
        <div className="nav-meta">
          <span className={`source-badge ${result.source}`}><i />{result.source === "api" ? "实时 API" : "演示数据"}</span>
          <span className="city-pill">TOKYO · 東京</span>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><Icon name="spark" size={16} /> 从通勤时间，找到适合生活的站</div>
          <h1>住在哪里，<br/><em>不只看距离。</em></h1>
          <p>输入每天要去的地点和理想通勤时间，一次看懂目的地附近车站与可选择的居住区域。</p>
        </div>

        <form className="search-panel" onSubmit={handleSearch}>
          <label className="destination-label">
            <span>目的地</span>
            <div
              className="destination-search"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setShowSuggestions(false);
                }
              }}
            >
              <div className="field">
                <Icon name="pin" />
                <input
                  value={destination}
                  onChange={(event) => {
                    setDestination(event.target.value);
                    setSelectedPlace(null);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="例如：池袋、东京大学、池袋麦当劳"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={showSuggestions}
                  required
                />
                {suggestionsLoading && <span className="suggestion-spinner" aria-label="正在搜索地点" />}
              </div>
              {showSuggestions && (placeSuggestions.length > 0 || suggestionsLoading) && (
                <div className="place-suggestions" role="listbox">
                  <div className="suggestion-heading">
                    <span>选择准确地点</span>
                    <small>地址 / 车站 / 附近 POI</small>
                  </div>
                  {placeSuggestions.map((place) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedPlace?.id === place.id}
                      key={place.id}
                      onClick={() => choosePlace(place)}
                    >
                      <span className="suggestion-marker">
                        <span className="suggestion-icon"><Icon name="pin" size={16} /></span>
                        <small>{formatDistance(place.distanceMeters)}</small>
                      </span>
                      <span className="suggestion-copy">
                        <strong>{place.name}</strong>
                        <small>{place.address}</small>
                      </span>
                      <span className="suggestion-meta">
                        <span className="suggestion-category">{place.category}</span>
                        <b>↖</b>
                      </span>
                    </button>
                  ))}
                  <div className="suggestion-source">地点：TravelTime · POI：OpenStreetMap / Photon</div>
                </div>
              )}
              {selectedPlace && (
                <>
                  <div className="selected-place">
                    <Icon name="pin" size={14} />
                    <span><strong>已选择准确定位</strong>{selectedPlace.address}</span>
                    <span className="selected-place-actions">
                      <button type="button" onClick={() => setShowPlaceMap((visible) => !visible)}>{showPlaceMap ? "收起地图" : "地图确认"}</button>
                      <button type="button" onClick={() => {
                        setSelectedPlace(null);
                        setShowPlaceMap(false);
                        setShowSuggestions(true);
                      }}>更换</button>
                    </span>
                  </div>
                  {showPlaceMap && (
                    <div className="selected-map-preview">
                      <iframe
                        title={`${selectedPlace.name} 地图位置`}
                        src={getOsmEmbedUrl(selectedPlace)}
                        loading="lazy"
                      />
                      <span>{selectedPlace.lat.toFixed(5)}, {selectedPlace.lng.toFixed(5)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </label>
          <label>
            <span>最长通勤时间</span>
            <div className="field time-field">
              <Icon name="clock" />
              <input type="number" min="10" max="90" value={maxMinutes} onChange={(event) => setMaxMinutes(Number(event.target.value))} />
              <b>分钟以内</b>
            </div>
          </label>
          <button type="submit" disabled={loading}>
            <Icon name="search" />{loading ? "正在计算…" : "寻找通勤圈"}
          </button>
          <p className="form-hint">门到门时间 = 房源步行 + 铁路 / 换乘 + 到达后步行，并预留 3 分钟缓冲</p>
        </form>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {result.reachableStations.length > 0 && (
        <section className="results-shell">
          <header className="result-heading">
            <div>
              <span className="section-kicker">SEARCH RESULT</span>
              <h2>{result.destination.name} · {result.requestedMinutes} 分钟通勤圈</h2>
              <p>{result.destination.subtitle}　<span>数据更新时间：刚刚</span></p>
            </div>
            <div className="summary-stats">
              <div><strong>{result.reachableStations.length}</strong><span>推荐车站</span></div>
              <div><strong>{result.properties.length}</strong><span>符合房源</span></div>
              <div><strong>{lineCount}</strong><span>覆盖线路</span></div>
              <div><strong>{result.reachableStations[0]?.bestDoorToDoorMinutes}</strong><span>最快门到门</span></div>
            </div>
          </header>

          {result.note && <div className="demo-note"><Icon name="spark" size={16}/>{result.note}</div>}

          <div className="content-grid">
            <section className="nearby-card">
              <div className="card-heading">
                <div><span className="section-kicker">DESTINATION ACCESS</span><h3>目的地附近车站</h3></div>
                <span className="mini-pin"><Icon name="pin" size={18}/></span>
              </div>
              <div className="destination-node">
                <div className="destination-icon">大</div>
                <div><strong>{result.destination.name}</strong><span>{result.destination.subtitle}</span></div>
              </div>
              <div className="nearby-list">
                {result.nearbyStations.map((station) => (
                  <button
                    type="button"
                    key={station.id}
                    className={`nearby-station ${result.selectedNearbyStationId === station.id ? "active" : ""}`}
                    onClick={() => chooseDestinationStation(station)}
                    disabled={accessStationLoadingId !== null}
                    aria-pressed={result.selectedNearbyStationId === station.id}
                  >
                    <i style={{ background: station.accent }} />
                    <div className="station-copy"><strong>{station.name}</strong><small>{station.nameJa}</small><span>{station.lines.join(" · ")}</span></div>
                    <div className="walk-time"><Icon name="walk" size={18}/><strong>{station.walkingMinutes}</strong><span>min</span></div>
                    <b className="access-action">{accessStationLoadingId === station.id ? "计算中…" : result.selectedNearbyStationId === station.id ? "已选" : "选择 →"}</b>
                  </button>
                ))}
              </div>
              <p className="walking-note"><Icon name="walk" size={15}/> 点击一个入口站，右侧会按该站线路重新计算；这里的步行时间会完整计入通勤预算。</p>
            </section>

            <section className="commute-map-card" id="commute-lines">
              <div className="card-heading">
                <div><span className="section-kicker">COMMUTE LINES</span><h3>{selectedDestinationStation ? `${selectedDestinationStation.name}站沿线可选车站` : "先选择目的地入口站"}</h3></div>
                <span className="map-legend"><i/> 亮色站点可选择</span>
              </div>
              <p className="line-map-intro">{selectedDestinationStation
                ? `当前按 ${selectedDestinationStation.lines.join(" · ")} 筛选：候选站到${selectedDestinationStation.name}的铁路时间 + ${selectedDestinationStation.name}到目的地步行 ${selectedDestinationStation.walkingMinutes} 分钟 + 房源步行，必须在预算内。`
                : "请先在左侧点击一个目的地附近车站；之后这里只展示该入口站沿线且满足门到门预算的车站。"}</p>
              {selectedDestinationStation ? <div className="rail-map">
                {railGroups.map((group) => (
                  <article
                    className="rail-line"
                    key={group.line}
                    style={{ "--rail-color": group.color } as CSSProperties}
                  >
                    <header>
                      <i />
                      <div><strong>{group.shortName}</strong><small>{group.line}</small></div>
                    </header>
                    <div className="rail-stations">
                      <span className="rail-more">•••</span>
                      {group.nodes.map((node, index) => node.station ? (
                        <button
                          type="button"
                          key={`${group.line}:${node.nameJa}`}
                          className={`rail-station selectable ${selected?.id === node.station.id ? "active" : ""}`}
                          onClick={() => chooseStation(node.station!)}
                        >
                          <i />
                          <strong>{node.station.name}</strong>
                          <small>{node.station.bestDoorToDoorMinutes} min · {node.station.propertyCount} 套</small>
                        </button>
                      ) : (
                        <span className="rail-station context" key={`${group.line}:${node.nameJa}:${index}`}>
                          <i />
                          <strong>{node.nameJa}</strong>
                          <small>沿线站</small>
                        </span>
                      ))}
                      <span className="rail-more">•••</span>
                    </div>
                  </article>
                ))}
              </div> : (
                <div className="access-station-empty">
                  <Icon name="train" size={22}/>
                  <span>请先点击左侧的东大前、根津或本乡三丁目等入口站</span>
                </div>
              )}
              <div className={`route-detail ${selected ? "visible" : ""}`}>
                {selected ? <>
                  <div><span>选择车站</span><strong>{selected.name} <small>{selected.nameJa}</small></strong></div>
                  <Icon name="arrow" />
                  <div className="route-copy"><span>{selected.route}</span><strong>房源步行 {selected.bestPropertyWalkMinutes} 分 + {selectedDestinationStation ? `${selected.name}到${selectedDestinationStation.name}再步行到目的地` : "车站到目的地"} {selected.totalMinutes} 分 = 门到门 {selected.bestDoorToDoorMinutes} 分</strong></div>
                </> : <span>选择一个亮色车站，即可查看并跳转到附近房源</span>}
              </div>
            </section>
          </div>

          <section className="station-results">
            <div className="list-heading">
              <div><span className="section-kicker">STATION OPTIONS</span><h3>优先推荐车站</h3></div>
              <span>按最短门到门时间排序 · 最多 16 站</span>
            </div>
            <div className="station-table">
              {result.reachableStations.map((station, index) => (
                <button type="button" key={station.id} className="station-row" onClick={() => chooseStation(station)}>
                  <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="row-station"><strong>{station.name}</strong><small>{station.nameJa}</small></span>
                  <span className="line-tags">{station.lines.slice(0, 2).map((line) => <i key={line}>{line}</i>)}</span>
                  <span className="route-summary"><small>房源步行 {station.bestPropertyWalkMinutes} 分 · 车站至目的地 {station.totalMinutes} 分</small><strong>{station.transfers === 0 ? "直达 / 步行" : `${station.transfers} 次换乘`} · 含终点步行</strong></span>
                  <span className="rent-hint">{station.rentHint}</span>
                  <span className="total-time"><strong>{station.bestDoorToDoorMinutes}</strong><small>min</small><Icon name="arrow" size={17}/></span>
                </button>
              ))}
            </div>
          </section>

          <section className="property-results" id="property-results">
            <div className="list-heading property-heading">
              <div><span className="section-kicker">SUPABASE LISTINGS</span><h3>符合最终通勤时间的房源</h3></div>
              {selected ? (
                <span className="property-station-filter">
                  <i /> 正在查看 {selected.name}站 · {visibleProperties.length} 套
                  <button type="button" onClick={() => setSelected(null)}>查看全部</button>
                </span>
              ) : (
                <span className="database-badge"><i /> Supabase 已连接</span>
              )}
            </div>
            <p className="property-explainer">最终时间 = 房源步行到站 + 铁路 / 换乘 + 到达后步行。仅保留不超过 {result.requestedMinutes - result.commuteBufferMinutes} 分钟的结果，并额外预留 {result.commuteBufferMinutes} 分钟缓冲。</p>
            {visibleProperties.length > 0 ? (
              <div className="property-grid">
                {visibleProperties.map((property) => (
                  <article className="property-card" key={property.id}>
                    <div className="property-image">
                      {property.imageUrl ? <img src={`${property.imageUrl}?auto=format&fit=crop&w=800&q=75`} alt="" loading="lazy" /> : <span>物件</span>}
                      <b>{property.layout}</b>
                    </div>
                    <div className="property-body">
                      <div className="property-title"><div><strong>{property.title}</strong><span>{property.address}</span></div><em>¥{property.monthlyRentYen.toLocaleString()}<small>/月</small></em></div>
                      <div className="property-specs"><span>{property.areaSqm} m²</span><span>築 {property.buildingAgeYears} 年</span><span>{property.floor}F</span></div>
                      <div className="commute-breakdown">
                        <div><Icon name="walk" size={17}/><span>{property.station.name}站步行</span><strong>{property.commute.propertyWalkMinutes} min</strong></div>
                        <Icon name="arrow" size={16}/>
                        <div><Icon name="train" size={17}/><span>车站至目的地</span><strong>{property.commute.stationToDestinationMinutes} min</strong></div>
                        <div className="final-commute"><span>最终通勤</span><strong>{property.commute.finalMinutes}<small> min</small></strong></div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="no-properties">这个车站当前没有符合门到门时间的房源。请选择其他推荐站。</div>
            )}
          </section>
        </section>
      )}

      {result.reachableStations.length === 0 && !loading && (
        <section className="empty-state">
          <div className="empty-illustration"><span>35</span><small>min</small></div>
          <h2>输入地点，开始寻找通勤圈</h2>
          <p>试试“东京大学”和“35分钟”，立即查看演示结果。</p>
        </section>
      )}

      <footer><span>よりみち · 通勤圈探索 Demo</span><span>Made for Tokyo life, 2026</span></footer>
      <p className="data-credit">TravelTime API · Station data: HeartRails Express · Places: OpenStreetMap / Photon · Housing: MOCK / DEMO</p>
    </main>
  );
}
