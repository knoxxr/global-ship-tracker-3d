/**
 * Shared 100% Live AIS Telemetry UI Renderers & CSV Exporter for MarineGlobe 3D.
 * Displays ONLY real received AIS fields (zero simulated or fabricated data).
 */

import { VESSEL_TYPES } from './world-data.js';

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Compact human-readable AIS source label (long station keys like
 * "station:ed25519:rTY-..." become "station"), full value kept in inspector & CSV.
 */
export function shortSource(src) {
  const s = String(src || 'live');
  if (s.length <= 14 && !s.includes(':')) return s;
  const head = s.split(':')[0];
  return head.length > 14 ? `${head.slice(0, 13)}…` : head;
}

export function formatCoordShort(val, isLat) {
  const hemi = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
  return `${Math.abs(Number(val) || 0).toFixed(2)}°${hemi}`;
}

export function formatDms(val, isLat) {
  const num = Number(val) || 0;
  const hemi = isLat ? (num >= 0 ? 'N' : 'S') : (num >= 0 ? 'E' : 'W');
  const abs = Math.abs(num);
  const deg = Math.floor(abs);
  const minF = (abs - deg) * 60;
  const min = Math.floor(minF);
  const sec = Math.floor((minF - min) * 60);
  return `${deg}°${String(min).padStart(2, '0')}'${String(sec).padStart(2, '0')}"${hemi}`;
}

export function compass16(deg) {
  const n = ((Number(deg) || 0) % 360 + 360) % 360;
  return COMPASS_16[Math.round(n / 22.5) % 16];
}

export function formatNum(n, suffix = '') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
  return `${Number(n).toLocaleString()}${suffix}`;
}

export function formatAge(updatedAt) {
  if (!updatedAt) return '-';
  const sec = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

export function sortVessels(vessels, sortBy = 'recent-desc') {
  const copy = [...vessels];
  switch (sortBy) {
    case 'recent-desc':
      return copy.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    case 'speed-desc':
      return copy.sort((a, b) => (b.sog || 0) - (a.sog || 0));
    case 'name-asc':
      return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'length-desc':
      return copy.sort((a, b) => (b.length || 0) - (a.length || 0));
    case 'type-asc':
      return copy.sort((a, b) => (a.type || '').localeCompare(b.type || '') || (b.sog || 0) - (a.sog || 0));
    case 'dest-asc':
      return copy.sort((a, b) => (a.destination || 'ZZZ').localeCompare(b.destination || 'ZZZ'));
    default:
      return copy;
  }
}

export function sortVesselsByColumn(vessels, col = 'updatedAt', dir = 'desc') {
  const copy = [...vessels];
  const mul = dir === 'asc' ? 1 : -1;
  const cmpStr = (a, b) => String(a || '').localeCompare(String(b || '')) * mul;
  const cmpNum = (a, b) => ((Number(a) || 0) - (Number(b) || 0)) * mul;

  switch (col) {
    case 'name': return copy.sort((a, b) => cmpStr(a.name, b.name));
    case 'type': return copy.sort((a, b) => cmpStr(a.type, b.type));
    case 'aisClass': return copy.sort((a, b) => cmpStr(a.aisClass, b.aisClass));
    case 'flag': return copy.sort((a, b) => cmpStr(a.flagName || a.flagCode, b.flagName || b.flagCode));
    case 'mmsi': return copy.sort((a, b) => cmpStr(a.mmsi, b.mmsi));
    case 'imo': return copy.sort((a, b) => cmpStr(a.imo, b.imo));
    case 'callsign': return copy.sort((a, b) => cmpStr(a.callsign, b.callsign));
    case 'lat': return copy.sort((a, b) => cmpNum(a.lat, b.lat));
    case 'lon': return copy.sort((a, b) => cmpNum(a.lon, b.lon));
    case 'sog': return copy.sort((a, b) => cmpNum(a.sog, b.sog));
    case 'cog': return copy.sort((a, b) => cmpNum(a.cog, b.cog));
    case 'destination': return copy.sort((a, b) => cmpStr(a.destination, b.destination));
    case 'length': return copy.sort((a, b) => cmpNum(a.length, b.length));
    case 'source': return copy.sort((a, b) => cmpStr(shortSource(a.source), shortSource(b.source)));
    case 'updatedAt':
    default:
      return copy.sort((a, b) => cmpNum(a.updatedAt, b.updatedAt));
  }
}

export function renderHoverTooltipHtml(v) {
  const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
  const kmh = ((Number(v.sog) || 0) * 1.852).toFixed(1);
  return `
    <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;">
      <span class="type-dot" style="background:${meta.color}"></span>
      <span>${escapeHtml(v.name)}</span>
    </div>
    <div style="color:var(--text-muted);margin-top:2px;font-size:11px;">
      ${escapeHtml(v.aisTypeDesc || meta.label)} · ${escapeHtml(v.flagName || v.flagCode)}
    </div>
    <div class="mono" style="margin-top:4px;font-size:11px;line-height:1.5;">
      <div>MMSI ${escapeHtml(v.mmsi)}${v.imo ? ` · IMO ${escapeHtml(v.imo)}` : ''}</div>
      <div>${formatDms(v.lat, true)} / ${formatDms(v.lon, false)}</div>
      <div>${v.sog} kn (${kmh} km/h) · ${v.cog}° ${compass16(v.cog)}</div>
      <div>목적지: ${escapeHtml(v.destination || '미보고')} · 수신: ${formatAge(v.updatedAt)}</div>
      <div>출처: ${escapeHtml(shortSource(v.source))}${v.length ? ` · ${v.length}×${v.beam || '?'}m` : ''}${v.trail && v.trail.length > 1 ? ` · 항적 ${v.trail.length}점` : ''}</div>
    </div>
  `;
}

export function renderClusterTooltipHtml(cluster) {
  const breakdown = Object.entries(cluster.types || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t, c]) => {
      const m = VESSEL_TYPES[t] || VESSEL_TYPES.bulk;
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;"><span class="type-dot" style="background:${m.color}"></span>${m.short} ${c.toLocaleString()}</span>`;
    })
    .join('');

  return `
    <div style="font-weight:700;font-size:12px;">
      선박 밀집 구역 · <span class="mono" style="color:var(--accent);">${cluster.count.toLocaleString()}척</span>
    </div>
    <div class="mono" style="color:var(--text-muted);font-size:11px;margin-top:2px;">
      항해 중 ${cluster.movingCount.toLocaleString()}척 · 정박/계류 ${(cluster.count - cluster.movingCount).toLocaleString()}척
    </div>
    <div style="margin-top:5px;font-size:11px;line-height:1.5;">${breakdown}</div>
    <div style="margin-top:4px;font-size:10.5px;color:var(--accent);">클릭하면 이 해역으로 확대됩니다</div>
  `;
}

export function renderFleetSummaryHtml(vessels) {
  const count = vessels.length;
  const moving = vessels.filter((v) => (v.sog || 0) >= 0.5).length;
  const avgSpeed = moving
    ? (
        vessels
          .filter((v) => (v.sog || 0) >= 0.5)
          .reduce((acc, v) => acc + (Number(v.sog) || 0), 0) / moving
      ).toFixed(1)
    : '0.0';
  const sources = new Set(vessels.map((v) => String(v.source || 'live').split(':')[0])).size;
  return `
    <div class="fleet-stat">
      <span>항해 / 수신</span>
      <strong class="mono">${moving}/${count}척</strong>
    </div>
    <div class="fleet-stat">
      <span>운항 평균속력</span>
      <strong class="mono">${avgSpeed} kn</strong>
    </div>
    <div class="fleet-stat">
      <span>실시간 소스</span>
      <strong class="mono">${sources}개 피드</strong>
    </div>
  `;
}

/**
 * Virtualized sidebar list renderer: supports 20,000+ real live vessels at 60 FPS
 * with zero artificial cap by rendering only the visible viewport window + spacers.
 */
export function renderVirtualVesselList(
  containerEl,
  vessels,
  selectedMmsi,
  emptyMessage = '실시간 AIS 데이터를 수신 대기 중입니다...',
  favoritesSet = null
) {
  if (!vessels || vessels.length === 0) {
    containerEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);line-height:1.6;">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const ROW_H = isMobile ? 78 : 68;
  const BUFFER = 8;
  const total = vessels.length;
  const viewH = containerEl.clientHeight || 560;
  const scrollTop = containerEl.scrollTop || 0;

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);
  const topPad = start * ROW_H;
  const botPad = Math.max(0, (total - end) * ROW_H);

  let html = topPad > 0 ? `<div style="height:${topPad}px;flex-shrink:0;"></div>` : '';
  for (let i = start; i < end; i++) {
    const v = vessels[i];
    const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
    const sel = v.mmsi === selectedMmsi ? 'selected' : '';
    const favMark = favoritesSet && favoritesSet.has(v.mmsi)
      ? '<span class="fav-star" title="관심 선박">★</span>'
      : '';
    html += `
      <button class="vessel-item ${sel}" data-mmsi="${escapeHtml(v.mmsi)}" role="listitem" style="min-height:${ROW_H - 4}px;">
        <div class="vessel-item-top">
          <span class="vessel-name">
            <span class="type-dot" style="background:${meta.color}"></span>
            ${favMark}${escapeHtml(v.name)}
          </span>
          <span class="vessel-speed mono">${v.sog} kn · ${v.cog}°</span>
        </div>
        <div class="vessel-item-sub">
          <span>${meta.short} · ${escapeHtml(v.flagName || v.flagCode)} · <span class="mono">${escapeHtml(v.mmsi)}</span></span>
          <span class="mono">${formatAge(v.updatedAt)}</span>
        </div>
        <div class="vessel-item-sub" style="font-size:10px;">
          <span>목적지: ${escapeHtml(v.destination || '미보고')}</span>
          <span class="mono">${escapeHtml(shortSource(v.source))}${v.length ? ` · ${v.length}m` : ''}</span>
        </div>
      </button>
    `;
  }
  if (botPad > 0) html += `<div style="height:${botPad}px;flex-shrink:0;"></div>`;
  containerEl.innerHTML = html;
}

/**
 * Renders 100% real AIS telemetry inside the right-hand inspector panel.
 */
export function renderInspectorBodyHtml(
  v,
  followSelected,
  isLoadingDetails = false,
  isFavorite = false,
  marineWeather = null
) {
  const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
  const kmh = ((Number(v.sog) || 0) * 1.852).toFixed(1);
  const updatedStr = v.updatedAt ? new Date(v.updatedAt).toISOString().slice(11, 19) + ' UTC' : '-';
  const rotText =
    v.rot !== null && v.rot !== undefined
      ? `${v.rot > 0 ? '+' : ''}${v.rot}°/min`
      : '미보고';
  const hdgText =
    v.heading !== null && v.heading !== undefined ? `${v.heading}°` : '미보고';
  const dimRef =
    v.dimA !== null || v.dimB !== null
      ? `선수:${v.dimA ?? 0} 선미:${v.dimB ?? 0} 좌현:${v.dimC ?? 0} 우현:${v.dimD ?? 0}m`
      : '';

  const trailRows = (v.trail || [])
    .slice(-12)
    .reverse()
    .map(
      (pt, i) =>
        `<div class="mono" style="display:flex;justify-content:space-between;"><span>#${(v.trail.length - i)}</span><span>${Number(pt[0]).toFixed(5)}°, ${Number(pt[1]).toFixed(5)}°</span></div>`
    )
    .join('');

  return `
    <div class="sheet-handle" id="inspector-handle" role="button" tabindex="0" aria-label="상세 패널 크기 전환"><span></span></div>
    <div class="inspector-head">
      <div style="min-width:0;">
        <h2 class="inspector-title">${escapeHtml(v.name)}</h2>
        <div class="inspector-sub">
          <span class="type-dot" style="background:${meta.color};display:inline-block;margin-right:5px;"></span>
          ${escapeHtml(v.aisTypeDesc || meta.label)}${v.near ? ` · ${escapeHtml(v.near)}` : ''}
        </div>
        <div class="badge-row">
          <span class="mini-badge mono">${escapeHtml(v.aisClass || 'Class A')}</span>
          <span class="mini-badge">${escapeHtml(v.flagName || v.flagCode)} (${escapeHtml(v.flagCode || '-')})</span>
          <span class="mini-badge mono">SRC: ${escapeHtml(shortSource(v.source))}</span>
          ${isLoadingDetails ? `<span class="mini-badge" style="color:var(--accent);">상세·24시간 항적 조회 중...</span>` : ''}
        </div>
      </div>
      <div class="inspector-head-btns">
        <button id="btn-favorite-vessel" class="btn btn-icon ${isFavorite ? 'fav-active' : ''}" title="${isFavorite ? '관심 선박 해제' : '관심 선박 등록'}" aria-label="관심 선박 토글">${isFavorite ? '★' : '☆'}</button>
        <button id="btn-close-inspector" class="btn btn-icon" title="닫기" aria-label="닫기">✕</button>
      </div>
    </div>

    <div class="section-label">실시간 항해 텔레메트리 (Live AIS)</div>
    <div class="kv-grid">
      <div class="kv-cell full">
        <div class="kv-label">실시간 GPS 좌표 (Decimal / DMS)</div>
        <div class="kv-value mono">${Number(v.lat).toFixed(5)}°, ${Number(v.lon).toFixed(5)}°</div>
        <div class="kv-sub mono">${formatDms(v.lat, true)} · ${formatDms(v.lon, false)} · ${updatedStr} (${formatAge(v.updatedAt)})</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">대지속력 (SOG)</div>
        <div class="kv-value mono">${v.sog} kn</div>
        <div class="kv-sub mono">${kmh} km/h</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">침로 (COG) / 선수 (HDG)</div>
        <div class="kv-value mono">${v.cog}° ${compass16(v.cog)}</div>
        <div class="kv-sub mono">HDG ${hdgText} · ROT ${rotText}</div>
      </div>
      <div class="kv-cell full">
        <div class="kv-label">AIS 항해 상태 (Navigational Status)</div>
        <div class="kv-value">${escapeHtml(v.navStatus || '미지정')} <span class="mono" style="color:var(--text-muted);">(Code ${v.navStatusCode ?? 15})</span></div>
      </div>
    </div>

    <div class="section-label">항차 및 선박 제원 (Static AIS / Particulars)</div>
    <div class="kv-grid">
      <div class="kv-cell">
        <div class="kv-label">AIS 보고 목적지</div>
        <div class="kv-value mono">${escapeHtml(v.destination || '미보고')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">AIS 보고 ETA</div>
        <div class="kv-value mono">${escapeHtml(v.eta || '미보고')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">MMSI / IMO</div>
        <div class="kv-value mono">${escapeHtml(v.mmsi)}</div>
        <div class="kv-sub mono">IMO ${escapeHtml(v.imo || '미보고')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">호출부호 (Call Sign)</div>
        <div class="kv-value mono">${escapeHtml(v.callsign || '미보고')}</div>
        <div class="kv-sub">${v.builtYear ? `${v.builtYear}년 건조` : (v.firstSeen ? `최초 포착 ${v.firstSeen.slice(0, 10)}` : '건조연도 미보고')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">전장(LOA) × 선폭(Beam)</div>
        <div class="kv-value mono">${v.length ? `${v.length}m × ${v.beam ?? '?'}m` : '미보고'}</div>
        ${dimRef ? `<div class="kv-sub mono">${dimRef}</div>` : `<div class="kv-sub mono">흘수 ${v.draught ? `${v.draught}m` : '미보고'}</div>`}
      </div>
      <div class="kv-cell">
        <div class="kv-label">흘수 / 등록 톤수</div>
        <div class="kv-value mono">${v.draught ? `${v.draught}m` : '흘수 미보고'}</div>
        <div class="kv-sub mono">DWT ${formatNum(v.dwt, 't')} · GT ${formatNum(v.grossTonnage)}</div>
      </div>
    </div>

    ${
      marineWeather
        ? `
    <div class="section-label">실시간 해상 기상 (Open-Meteo Marine)</div>
    <div class="kv-grid">
      <div class="kv-cell">
        <div class="kv-label">유의파고 / 파주기</div>
        <div class="kv-value mono">${marineWeather.waveHeight != null ? `${marineWeather.waveHeight.toFixed(1)} m` : '-'}</div>
        <div class="kv-sub mono">${marineWeather.wavePeriod != null ? `주기 ${marineWeather.wavePeriod.toFixed(1)}s` : '해역 데이터'} ${marineWeather.waveDir != null ? `· ${Math.round(marineWeather.waveDir)}° ${compass16(marineWeather.waveDir)}` : ''}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">해상 풍속 / 수온</div>
        <div class="kv-value mono">${marineWeather.windKn != null ? `${marineWeather.windKn.toFixed(1)} kn` : '-'} ${marineWeather.windDir != null ? compass16(marineWeather.windDir) : ''}</div>
        <div class="kv-sub mono">${marineWeather.seaTemp != null ? `해수온 ${marineWeather.seaTemp.toFixed(1)}°C` : '실시간 기상'}</div>
      </div>
    </div>`
        : ''
    }

    <div class="section-label">수신 기지국 및 출처 (Feed Provenance)</div>
    <div class="kv-grid">
      <div class="kv-cell full">
        <div class="kv-label">수신 네트워크 / 스테이션 / 채널</div>
        <div class="kv-value mono">${escapeHtml(v.source || 'live')}${v.station ? ` · ${escapeHtml(v.station)}` : ''}${v.channel ? ` (CH ${escapeHtml(v.channel)})` : ''}</div>
        ${v.attribution ? `<div class="kv-sub">${escapeHtml(v.attribution)}</div>` : ''}
      </div>
    </div>

    <div class="section-label">실제 수신 항적 좌표 (${(v.trail || []).length}개 지점)</div>
    <div class="trail-log">${trailRows || '<div>수신된 항적 기록이 없습니다.</div>'}</div>

    <div class="inspector-actions">
      <button id="btn-follow-vessel" class="btn btn-primary ${followSelected ? 'active' : ''}">
        ${followSelected ? '추적 잠금 해제' : '카메라 추적 잠금'}
      </button>
      <button id="btn-center-vessel" class="btn">위치로 이동</button>
      <button id="btn-measure-from-vessel" class="btn btn-icon" title="이 선박에서 거리·ETA 측정" aria-label="이 선박에서 거리 측정">📏</button>
      <button id="btn-share-vessel" class="btn btn-icon" title="이 선박 링크 복사" aria-label="선박 링크 복사">🔗</button>
    </div>
  `;
}

/**
 * Virtualized full-fleet table renderer: smoothly scrolls 20,000+ live vessels.
 */
export function renderVirtualFleetTable(wrapEl, tbodyEl, vessels, selectedMmsi, favoritesSet = null) {
  if (!vessels || !vessels.length) {
    tbodyEl.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:24px;color:var(--text-muted);">현재 수신된 실시간 선박이 없습니다.</td></tr>`;
    return;
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const ROW_H = isMobile ? 40 : 31;
  const BUFFER = 12;
  const total = vessels.length;
  const viewH = wrapEl.clientHeight || 600;
  const scrollTop = wrapEl.scrollTop || 0;

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);
  const topPad = start * ROW_H;
  const botPad = Math.max(0, (total - end) * ROW_H);

  let html = topPad > 0 ? `<tr style="height:${topPad}px;"><td colspan="16" style="padding:0;border:0;"></td></tr>` : '';
  for (let i = start; i < end; i++) {
    const v = vessels[i];
    const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
    const sel = v.mmsi === selectedMmsi ? 'selected' : '';
    const favMark = favoritesSet && favoritesSet.has(v.mmsi)
      ? '<span class="fav-star" title="관심 선박">★</span> '
      : '';
    html += `
      <tr class="${sel}" data-mmsi="${escapeHtml(v.mmsi)}" style="height:${ROW_H}px;">
        <td class="mono" style="color:var(--text-muted);">${i + 1}</td>
        <td style="font-weight:600;">
          <span class="type-dot" style="background:${meta.color};display:inline-block;margin-right:6px;"></span>
          ${favMark}${escapeHtml(v.name)}
        </td>
        <td>${meta.short}</td>
        <td class="mono">${escapeHtml(v.aisClass || 'A')}</td>
        <td>${escapeHtml(v.flagName || v.flagCode)}</td>
        <td class="mono">${escapeHtml(v.mmsi)}</td>
        <td class="mono">${escapeHtml(v.imo || '-')}</td>
        <td class="mono">${escapeHtml(v.callsign || '-')}</td>
        <td class="mono">${Number(v.lat).toFixed(4)}°</td>
        <td class="mono">${Number(v.lon).toFixed(4)}°</td>
        <td class="mono" style="color:var(--accent);font-weight:600;">${v.sog} kn</td>
        <td class="mono">${v.cog}° ${compass16(v.cog)}</td>
        <td class="mono">${escapeHtml(v.destination || '-')}</td>
        <td class="mono">${v.length ? `${v.length}×${v.beam ?? '?'}m / ${v.draught ?? '-'}m` : '-'}</td>
        <td class="mono">${escapeHtml(shortSource(v.source))}</td>
        <td class="mono">${formatAge(v.updatedAt)}</td>
      </tr>
    `;
  }
  if (botPad > 0) html += `<tr style="height:${botPad}px;"><td colspan="16" style="padding:0;border:0;"></td></tr>`;
  tbodyEl.innerHTML = html;
}

/**
 * Neutralize spreadsheet formula injection (=, +, -, @, tab, CR) on text cells while keeping negative numbers intact.
 */
export function escapeCsvCell(val) {
  let str = String(val ?? '');
  if (
    /^[=+\-@\t\r]/.test(str) &&
    !(typeof val === 'number' || /^-\d+(\.\d+)?$/.test(str))
  ) {
    str = `'${str}`;
  }
  return `"${str.replaceAll('"', '""')}"`;
}

/**
 * Download all live vessels' complete real AIS telemetry as a UTF-8 CSV file.
 */
export function exportVesselsCsv(vessels) {
  const headers = [
    'Name', 'Type', 'AIS_Class', 'AIS_Code', 'Flag', 'MMSI', 'IMO', 'CallSign',
    'Latitude', 'Longitude', 'SOG_kn', 'COG_deg', 'Heading_deg', 'ROT', 'NavStatus',
    'Destination', 'ETA', 'Length_m', 'Beam_m', 'Draught_m', 'DWT_t', 'GT',
    'BuiltYear', 'Source', 'Station', 'UpdatedAt_UTC',
  ];
  const lines = [headers.join(',')];
  for (const v of vessels) {
    lines.push(
      [
        v.name, v.type, v.aisClass, v.aisTypeCode, v.flagName, v.mmsi, v.imo, v.callsign,
        v.lat, v.lon, v.sog, v.cog, v.heading, v.rot, v.navStatus,
        v.destination, v.eta, v.length, v.beam, v.draught, v.dwt, v.grossTonnage,
        v.builtYear, v.source, v.station,
        v.updatedAt ? new Date(v.updatedAt).toISOString() : '',
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marineglobe-live-ais-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
