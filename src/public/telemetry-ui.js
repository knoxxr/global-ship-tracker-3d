/**
 * Shared detailed telemetry renderers & CSV exporter for MarineGlobe 3D.
 * Used by both the Node.js SSE app (src/public/app.js) and GitHub Pages (docs/pages-app.js).
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

export function sortVessels(vessels, sortBy = 'speed-desc') {
  const copy = [...vessels];
  switch (sortBy) {
    case 'speed-desc':
      return copy.sort((a, b) => (b.sog || 0) - (a.sog || 0));
    case 'name-asc':
      return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    case 'length-desc':
      return copy.sort((a, b) => (b.length || 0) - (a.length || 0));
    case 'dwt-desc':
      return copy.sort((a, b) => (b.dwt || 0) - (a.dwt || 0));
    case 'progress-desc':
      return copy.sort((a, b) => (b.progressPct || 0) - (a.progressPct || 0));
    case 'type-asc':
      return copy.sort((a, b) => (a.type || '').localeCompare(b.type || '') || (b.sog || 0) - (a.sog || 0));
    case 'dest-asc':
      return copy.sort((a, b) => (a.destination || '').localeCompare(b.destination || ''));
    default:
      return copy;
  }
}

export function renderHoverTooltipHtml(v) {
  const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
  const kmh = ((Number(v.sog) || 0) * 1.852).toFixed(1);
  const prog = v.progressPct !== null && v.progressPct !== undefined ? `${v.progressPct}%` : '-';
  const rem = v.remainingNm ? `${v.remainingNm.toLocaleString()} NM` : '-';
  return `
    <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;">
      <span class="type-dot" style="background:${meta.color}"></span>
      <span>${escapeHtml(v.name)}</span>
    </div>
    <div style="color:var(--text-muted);margin-top:2px;font-size:11px;">
      ${escapeHtml(v.operator || meta.label)} · ${escapeHtml(v.flagName || v.flagCode)}
    </div>
    <div class="mono" style="margin-top:4px;font-size:11px;line-height:1.5;">
      <div>MMSI ${escapeHtml(v.mmsi)} · IMO ${escapeHtml(v.imo || '-')}</div>
      <div>${formatDms(v.lat, true)} / ${formatDms(v.lon, false)}</div>
      <div>${v.sog} kn (${kmh} km/h) · ${v.cog}° ${compass16(v.cog)}</div>
      <div>${escapeHtml(v.origin || 'LIVE')} → ${escapeHtml(v.destination || '-')} (${prog}, 잔여 ${rem})</div>
      <div>${v.length ? `${v.length}×${v.beam}m` : '-'} · ${escapeHtml(v.capacityLabel || meta.label)}</div>
    </div>
  `;
}

export function renderFleetSummaryHtml(vessels) {
  const count = vessels.length;
  const avgSpeed = count
    ? (vessels.reduce((acc, v) => acc + (Number(v.sog) || 0), 0) / count).toFixed(1)
    : '0.0';
  const totalDwt = vessels.reduce((acc, v) => acc + (Number(v.dwt) || 0), 0);
  const dwtMillion = totalDwt > 0 ? `${(totalDwt / 1_000_000).toFixed(1)}M t` : '-';
  const moving = vessels.filter((v) => (v.sog || 0) > 0.5).length;
  return `
    <div class="fleet-stat">
      <span>운항 / 전체</span>
      <strong class="mono">${moving}/${count}척</strong>
    </div>
    <div class="fleet-stat">
      <span>평균 속력</span>
      <strong class="mono">${avgSpeed} kn</strong>
    </div>
    <div class="fleet-stat">
      <span>총 적재톤수</span>
      <strong class="mono">${dwtMillion}</strong>
    </div>
  `;
}

/**
 * Renders ALL matching vessels (zero cap) with rich inline metadata & voyage progress bar.
 */
export function renderAllVesselListHtml(vessels, selectedMmsi) {
  if (vessels.length === 0) {
    return `<div style="padding:20px;text-align:center;color:var(--text-muted);">조건에 일치하는 선박이 없습니다.</div>`;
  }

  return vessels
    .map((v) => {
      const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
      const sel = v.mmsi === selectedMmsi ? 'selected' : '';
      const pct = Number.isFinite(Number(v.progressPct)) ? Math.min(100, Math.max(0, v.progressPct)) : null;
      return `
        <button class="vessel-item ${sel}" data-mmsi="${escapeHtml(v.mmsi)}" role="listitem">
          <div class="vessel-item-top">
            <span class="vessel-name">
              <span class="type-dot" style="background:${meta.color}"></span>
              ${escapeHtml(v.name)}
            </span>
            <span class="vessel-speed mono">${v.sog} kn · ${v.cog}°</span>
          </div>
          <div class="vessel-item-sub">
            <span>${meta.short} · ${escapeHtml(v.flagName || v.flagCode)} · <span class="mono">${escapeHtml(v.mmsi)}</span></span>
            <span class="mono">${escapeHtml(v.origin || 'AIS')} → ${escapeHtml(v.destination || '-')}</span>
          </div>
          <div class="vessel-item-sub" style="font-size:10px;">
            <span>${escapeHtml(v.capacityLabel || (v.length ? `${v.length}m` : '-'))}</span>
            <span class="mono">${pct !== null ? `${pct}% · 잔여 ${formatNum(v.remainingNm, ' NM')}` : `${formatCoordShort(v.lat, true)}, ${formatCoordShort(v.lon, false)}`}</span>
          </div>
          ${pct !== null ? `<div class="mini-progress"><span style="width:${pct}%;background:${meta.color};"></span></div>` : ''}
        </button>
      `;
    })
    .join('');
}

/**
 * Renders complete 5-section telemetry detail inside the right-hand inspector panel.
 */
export function renderInspectorBodyHtml(v, followSelected) {
  const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
  const kmh = ((Number(v.sog) || 0) * 1.852).toFixed(1);
  const pct = Number.isFinite(Number(v.progressPct)) ? Math.min(100, Math.max(0, v.progressPct)) : null;
  const updatedStr = v.updatedAt ? new Date(v.updatedAt).toISOString().slice(11, 19) + ' UTC' : '-';
  const rotSign = (v.rot || 0) > 0 ? '+' : '';
  const trailRows = (v.trail || [])
    .slice(-8)
    .reverse()
    .map(
      (pt, i) =>
        `<div class="mono" style="display:flex;justify-content:space-between;"><span>T-${i}</span><span>${Number(pt[0]).toFixed(4)}°, ${Number(pt[1]).toFixed(4)}°</span></div>`
    )
    .join('');

  return `
    <div class="inspector-head">
      <div style="min-width:0;">
        <h2 class="inspector-title">${escapeHtml(v.name)}</h2>
        <div class="inspector-sub">
          <span class="type-dot" style="background:${meta.color};display:inline-block;margin-right:5px;"></span>
          ${escapeHtml(v.operator || meta.label)}
        </div>
        <div class="badge-row">
          <span class="mini-badge mono">${escapeHtml(v.aisClass || 'Class A')}</span>
          <span class="mini-badge">${escapeHtml(v.aisTypeDesc || meta.label)}</span>
          <span class="mini-badge">${escapeHtml(v.flagName || v.flagCode)} (${escapeHtml(v.flagCode || '-')})</span>
          <span class="mini-badge">${escapeHtml(v.cargoStatus || '운항 중')}</span>
        </div>
      </div>
      <button id="btn-close-inspector" class="btn btn-icon" title="닫기">✕</button>
    </div>

    <div class="section-label">항차 및 경로 진행 (Voyage)</div>
    <div class="route-banner">
      <div class="route-top">
        <div>
          <div class="kv-label">출발항</div>
          <div class="route-port mono">${escapeHtml(v.origin || 'LIVE')}</div>
          <div class="route-port-name">${escapeHtml(v.originName || '-')}</div>
        </div>
        <div class="route-arrow">━━▶</div>
        <div style="text-align:right;">
          <div class="kv-label">목적지</div>
          <div class="route-port mono">${escapeHtml(v.destination || '미지정')}</div>
          <div class="route-port-name">${escapeHtml(v.destinationName || '-')}</div>
        </div>
      </div>
      ${
        pct !== null
          ? `
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;background:${meta.color};"></div>
        </div>
        <div class="route-metrics mono">
          <span>진행 ${pct}% (${formatNum(v.traveledNm, ' NM')})</span>
          <span>잔여 ${formatNum(v.remainingNm, ' NM')} / 총 ${formatNum(v.totalDistanceNm, ' NM')}</span>
        </div>`
          : ''
      }
      <div class="route-metrics">
        <span>항로: ${escapeHtml(v.corridorName || (v.source === 'aisstream' ? 'AISStream 실시간' : '글로벌 항로'))}</span>
        <span class="mono">ETA ${escapeHtml(v.eta || '-')}</span>
      </div>
    </div>

    <div class="section-label">실시간 항해 텔레메트리 (Navigation)</div>
    <div class="kv-grid">
      <div class="kv-cell full">
        <div class="kv-label">실시간 GPS 좌표 (Decimal / DMS)</div>
        <div class="kv-value mono">${Number(v.lat).toFixed(5)}°, ${Number(v.lon).toFixed(5)}°</div>
        <div class="kv-sub mono">${formatDms(v.lat, true)} · ${formatDms(v.lon, false)} · 수신 ${updatedStr}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">대지속력 (SOG)</div>
        <div class="kv-value mono">${v.sog} kn</div>
        <div class="kv-sub mono">${kmh} km/h</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">침로 (COG) / 선수 (HDG)</div>
        <div class="kv-value mono">${v.cog}° ${compass16(v.cog)}</div>
        <div class="kv-sub mono">HDG ${v.heading}° · ROT ${rotSign}${v.rot ?? 0}°/m</div>
      </div>
      <div class="kv-cell full">
        <div class="kv-label">AIS 항해 상태 (Navigational Status)</div>
        <div class="kv-value">${escapeHtml(v.navStatus || '항해 중 (엔진)')} <span class="mono" style="color:var(--text-muted);">(Code ${v.navStatusCode ?? 0})</span></div>
      </div>
    </div>

    <div class="section-label">선박 제원 및 화물 (Specifications)</div>
    <div class="kv-grid">
      <div class="kv-cell">
        <div class="kv-label">MMSI / IMO</div>
        <div class="kv-value mono">${escapeHtml(v.mmsi)}</div>
        <div class="kv-sub mono">IMO ${escapeHtml(v.imo || '-')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">호출부호 / 건조연도</div>
        <div class="kv-value mono">${escapeHtml(v.callsign || '-')}</div>
        <div class="kv-sub">${v.builtYear ? `${v.builtYear}년 건조` : '-'}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">전장(LOA) × 선폭(Beam)</div>
        <div class="kv-value mono">${v.length && v.beam ? `${v.length}m × ${v.beam}m` : '-'}</div>
        <div class="kv-sub mono">흘수 ${v.draught ?? '-'}m${v.maxDraught ? ` / 만재 ${v.maxDraught}m` : ''}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">재화중량(DWT) / 총톤수(GT)</div>
        <div class="kv-value mono">${formatNum(v.dwt, ' t')}</div>
        <div class="kv-sub mono">GT ${formatNum(v.grossTonnage)}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">선박 적재 용량</div>
        <div class="kv-value">${escapeHtml(v.capacityLabel || '-')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">건조 조선소</div>
        <div class="kv-value" style="font-size:11px;">${escapeHtml(v.shipyard || '-')}</div>
      </div>
    </div>

    <div class="section-label">해역 기상 및 운항 추정 (Sea & Fuel)</div>
    <div class="kv-grid">
      <div class="kv-cell">
        <div class="kv-label">해상 풍속 / 풍향</div>
        <div class="kv-value mono">${v.windKn !== null && v.windKn !== undefined ? `${v.windKn} kn` : '-'}</div>
        <div class="kv-sub mono">${escapeHtml(v.windDir || '-')}</div>
      </div>
      <div class="kv-cell">
        <div class="kv-label">유의파고 / 해수온</div>
        <div class="kv-value mono">${v.waveM !== null && v.waveM !== undefined ? `${v.waveM} m` : '-'}</div>
        <div class="kv-sub mono">수온 ${v.seaTempC !== null && v.seaTempC !== undefined ? `${v.seaTempC}°C` : '-'}</div>
      </div>
      <div class="kv-cell full">
        <div class="kv-label">추정 일일 연료 소모량 (Bunker Est.)</div>
        <div class="kv-value mono">${v.fuelEstTpd ? `${v.fuelEstTpd} t/day (VLSFO/LNG 환산)` : '-'}</div>
      </div>
    </div>

    <div class="section-label">최근 AIS 항적 좌표 (Track History)</div>
    <div class="trail-log">${trailRows || '<div>수신된 항적 기록이 없습니다.</div>'}</div>

    <div class="inspector-actions">
      <button id="btn-follow-vessel" class="btn btn-primary ${followSelected ? 'active' : ''}">
        ${followSelected ? '추적 잠금 해제' : '카메라 추적 잠금'}
      </button>
      <button id="btn-center-vessel" class="btn">위치로 이동</button>
    </div>
  `;
}

/**
 * Renders ALL vessels in the full-screen All-Vessels Table modal.
 */
export function renderFleetTableRowsHtml(vessels, selectedMmsi) {
  if (!vessels.length) {
    return `<tr><td colspan="17" style="text-align:center;padding:24px;color:var(--text-muted);">표시할 선박이 없습니다.</td></tr>`;
  }
  return vessels
    .map((v, idx) => {
      const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
      const sel = v.mmsi === selectedMmsi ? 'selected' : '';
      return `
        <tr class="${sel}" data-mmsi="${escapeHtml(v.mmsi)}">
          <td class="mono" style="color:var(--text-muted);">${idx + 1}</td>
          <td style="font-weight:600;">
            <span class="type-dot" style="background:${meta.color};display:inline-block;margin-right:6px;"></span>
            ${escapeHtml(v.name)}
          </td>
          <td>${meta.short}</td>
          <td>${escapeHtml(v.operator || '-')}</td>
          <td>${escapeHtml(v.flagName || v.flagCode)}</td>
          <td class="mono">${escapeHtml(v.mmsi)}</td>
          <td class="mono">${escapeHtml(v.imo || '-')}</td>
          <td class="mono">${escapeHtml(v.callsign || '-')}</td>
          <td class="mono">${Number(v.lat).toFixed(4)}°</td>
          <td class="mono">${Number(v.lon).toFixed(4)}°</td>
          <td class="mono" style="color:var(--accent);font-weight:600;">${v.sog} kn</td>
          <td class="mono">${v.cog}° ${compass16(v.cog)}</td>
          <td class="mono">${escapeHtml(v.origin || 'LIVE')} → ${escapeHtml(v.destination || '-')}</td>
          <td class="mono">${v.progressPct !== null && v.progressPct !== undefined ? `${v.progressPct}%` : '-'}</td>
          <td class="mono">${formatNum(v.remainingNm, ' NM')}</td>
          <td class="mono">${v.length && v.beam ? `${v.length}×${v.beam}m / ${v.draught ?? '-'}m` : '-'}</td>
          <td>${escapeHtml(v.capacityLabel || '-')}</td>
          <td class="mono">${escapeHtml(v.eta || '-')}</td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Download all visible vessels' complete telemetry as a UTF-8 CSV file.
 */
export function exportVesselsCsv(vessels) {
  const headers = [
    'Name', 'Type', 'AIS_Class', 'AIS_Code', 'Operator', 'Flag', 'MMSI', 'IMO', 'CallSign',
    'Latitude', 'Longitude', 'SOG_kn', 'COG_deg', 'Heading_deg', 'ROT', 'NavStatus',
    'Origin', 'Destination', 'Progress_Pct', 'Remaining_NM', 'Total_NM', 'ETA',
    'Length_m', 'Beam_m', 'Draught_m', 'DWT_t', 'GT', 'Capacity', 'CargoStatus',
    'BuiltYear', 'Shipyard', 'Wind_kn', 'Wave_m', 'SeaTemp_C', 'Fuel_tpd',
  ];
  const esc = (val) => `"${String(val ?? '').replaceAll('"', '""')}"`;
  const lines = [headers.join(',')];
  for (const v of vessels) {
    lines.push(
      [
        v.name, v.type, v.aisClass, v.aisTypeCode, v.operator, v.flagName, v.mmsi, v.imo, v.callsign,
        v.lat, v.lon, v.sog, v.cog, v.heading, v.rot, v.navStatus,
        v.origin, v.destination, v.progressPct, v.remainingNm, v.totalDistanceNm, v.eta,
        v.length, v.beam, v.draught, v.dwt, v.grossTonnage, v.capacityLabel, v.cargoStatus,
        v.builtYear, v.shipyard, v.windKn, v.waveM, v.seaTempC, v.fuelEstTpd,
      ]
        .map(esc)
        .join(',')
    );
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marineglobe-vessels-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
