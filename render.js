import { state, elements } from './config.js';

export function drawProvinceColor(hex, color) {
    const info = state.provincesMeta[hex];
    if (!info || !info.pixels) return;
    elements.layerCtx.fillStyle = color;
    for (let i = 0; i < info.pixels.length; i += 2) {
        elements.layerCtx.fillRect(info.pixels[i], info.pixels[i + 1], 1, 1);
    }
}

export function renderActiveLayer() {
    elements.layerCtx.clearRect(0, 0, elements.layerCanvas.width, elements.layerCanvas.height);

    for (const [hex, info] of Object.entries(state.provincesMeta)) {
        const dbRow = state.dbProvinces[info.id];
        if (!dbRow) continue;

        let color = null;
        if (state.activeLayer === 'political') color = state.dbOwnerColors[dbRow.owner];
        else if (state.activeLayer === 'region') color = state.dbRegionColors[dbRow.region];
        else if (state.activeLayer === 'culture') color = state.dbCultureColors[dbRow.main_culture];
        else if (state.activeLayer === 'religion') color = state.dbReligionColors[dbRow.main_religion];
        else if (state.activeLayer === 'resource') color = state.dbResourceColors[dbRow.resource];

        if (color) {
            drawProvinceColor(hex, color);
        }
    }
    renderLegend();
}

export function renderLegend() {
    if (!elements.legendContent) return;
    let map = {};
    if (state.activeLayer === 'political') map = state.dbOwnerColors;
    else if (state.activeLayer === 'region') map = state.dbRegionColors;
    else if (state.activeLayer === 'culture') map = state.dbCultureColors;
    else if (state.activeLayer === 'religion') map = state.dbReligionColors;
    else if (state.activeLayer === 'resource') map = state.dbResourceColors;

    const entries = Object.entries(map);
    if (entries.length === 0) {
        elements.legendContent.innerHTML = 'Нет данных';
        return;
    }

    elements.legendContent.innerHTML = entries.map(([name, color]) => `
        <div class="legend-item">
            <div class="legend-color" style="background-color: ${color}"></div>
            <span>${name}</span>
        </div>
    `).join('');
}

export function highlightProvince(hex) {
    elements.highlightCtx.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    const info = state.provincesMeta[hex];
    if (!info || !info.pixels) return;

    elements.highlightCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let i = 0; i < info.pixels.length; i += 2) {
        elements.highlightCtx.fillRect(info.pixels[i], info.pixels[i + 1], 1, 1);
    }
}

export function renderMarkers() {
    elements.markersCtx.clearRect(0, 0, elements.markersCanvas.width, elements.markersCanvas.height);

    state.dbMarkers.forEach(marker => {
        if (!state.visibleMarkerTypes[marker.type]) return;

        const x = marker.coord_1;
        const y = marker.coord_2;

        const img = markerImages[marker.type];
        if (img && img.complete) {
            elements.markersCtx.drawImage(img, x - img.width / 2, y - img.height / 2);
        } else {
            elements.markersCtx.fillStyle = '#ff0000';
            elements.markersCtx.beginPath();
            elements.markersCtx.arc(x, y, 6, 0, Math.PI * 2);
            elements.markersCtx.fill();
        }

        if (state.showMarkerNames && marker.name) {
            elements.markersCtx.font = '12px sans-serif';
            elements.markersCtx.fillStyle = '#ffffff';
            elements.markersCtx.strokeStyle = '#000000';
            elements.markersCtx.lineWidth = 3;
            elements.markersCtx.textAlign = 'center';
            elements.markersCtx.strokeText(marker.name, x, y - 12);
            elements.markersCtx.fillText(marker.name, x, y - 12);
        }
    });

    if (state.trackerActive) {
        const x = state.trackerPos.x;
        const y = state.trackerPos.y;

        elements.markersCtx.strokeStyle = '#00ffff';
        elements.markersCtx.lineWidth = 2;
        elements.markersCtx.beginPath();
        elements.markersCtx.arc(x, y, 10, 0, Math.PI * 2);
        elements.markersCtx.stroke();

        elements.markersCtx.fillStyle = '#00ffff';
        elements.markersCtx.beginPath();
        elements.markersCtx.arc(x, y, 3, 0, Math.PI * 2);
        elements.markersCtx.fill();
    }
}

export function renderIDs() {
    elements.labelsCtx.clearRect(0, 0, elements.labelsCanvas.width, elements.labelsCanvas.height);
    if (!state.showIDs) return;

    elements.labelsCtx.font = 'bold 11px sans-serif';
    elements.labelsCtx.fillStyle = '#ffffff';
    elements.labelsCtx.strokeStyle = '#000000';
    elements.labelsCtx.lineWidth = 2;
    elements.labelsCtx.textAlign = 'center';
    elements.labelsCtx.textBaseline = 'middle';

    for (const info of Object.values(state.provincesMeta)) {
        if (info.center) {
            const [cx, cy] = info.center;
            elements.labelsCtx.strokeText(info.id, cx, cy);
            elements.labelsCtx.fillText(info.id, cx, cy);
        }
    }
}
