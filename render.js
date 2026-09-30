import { state, elements, markerImages } from './config.js';

export const DENSITY_TIERS = [
    { min: 0, max: 3, label: '< 3 чел. / тыс. px', color: '#fef0d9' },
    { min: 3, max: 6, label: '3 - 6 чел. / тыс. px', color: '#fdcc8a' },
    { min: 6, max: 10, label: '6 - 10 чел. / тыс. px', color: '#fc8d59' },
    { min: 10, max: 15, label: '10 - 15 чел. / тыс. px', color: '#e34a33' },
    { min: 15, max: Infinity, label: '> 15 чел. / тыс. px', color: '#b30000' }
];

export function getDensityColor(density) {
    for (const tier of DENSITY_TIERS) {
        if (density >= tier.min && density < tier.max) {
            return tier.color;
        }
    }
    return DENSITY_TIERS[DENSITY_TIERS.length - 1].color;
}

export function renderActiveLayer() {
    const width = elements.hiddenCanvas.width;
    const height = elements.hiddenCanvas.height;
    elements.layerCtx.clearRect(0, 0, width, height);

    const rgbLookup = {};

    for (const [srcHex, info] of Object.entries(state.provincesMeta)) {
        const dbRow = state.dbProvinces[info.id];
        let targetHex = null;

        if (dbRow) {
            if (state.activeLayer === 'political' && dbRow.owner) {
                targetHex = state.dbOwnerColors[dbRow.owner];
            } else if (state.activeLayer === 'region' && dbRow.region) {
                targetHex = state.dbRegionColors[dbRow.region];
            } else if (state.activeLayer === 'culture' && dbRow.main_culture) {
                targetHex = state.dbCultureColors[dbRow.main_culture];
            } else if (state.activeLayer === 'religion' && dbRow.main_religion) {
                targetHex = state.dbReligionColors[dbRow.main_religion];
            } else if (state.activeLayer === 'resource' && dbRow.resource) {
                targetHex = state.dbResourceColors[dbRow.resource];
            } else if (state.activeLayer === 'density') {
                const provYards = dbRow.yards || 0;
                const settlementYards = state.dbMarkers
                    .filter(m => Number(m.province_id) === Number(info.id))
                    .reduce((acc, m) => acc + (m.yards || 0), 0);
                const totalPop = (provYards + settlementYards) * 4;
                const area = info.area || 1;
                const density = (totalPop / area) * 1000;
                targetHex = getDensityColor(density);
            }
        }

        if (targetHex) {
            const srcR = parseInt(srcHex.slice(1, 3), 16);
            const srcG = parseInt(srcHex.slice(3, 5), 16);
            const srcB = parseInt(srcHex.slice(5, 7), 16);
            const key = (srcR << 16) | (srcG << 8) | srcB;

            const trgR = parseInt(targetHex.slice(1, 3), 16);
            const trgG = parseInt(targetHex.slice(3, 5), 16);
            const trgB = parseInt(targetHex.slice(5, 7), 16);

            rgbLookup[key] = [trgR, trgG, trgB, 153];
        }
    }

    const srcData = elements.hiddenCtx.getImageData(0, 0, width, height).data;
    const layerImgData = elements.layerCtx.createImageData(width, height);
    const dstData = layerImgData.data;

    for (let i = 0; i < srcData.length; i += 4) {
        const key = (srcData[i] << 16) | (srcData[i + 1] << 8) | srcData[i + 2];
        const targetRgba = rgbLookup[key];

        if (targetRgba) {
            dstData[i] = targetRgba[0];
            dstData[i + 1] = targetRgba[1];
            dstData[i + 2] = targetRgba[2];
            dstData[i + 3] = targetRgba[3];
        }
    }

    elements.layerCtx.putImageData(layerImgData, 0, 0);
    updateLegend();
}

export function renderMarkers() {
    elements.markersCtx.clearRect(0, 0, elements.markersCanvas.width, elements.markersCanvas.height);

    state.dbMarkers.forEach(marker => {
        if (!state.visibleMarkerTypes[marker.type]) return;

        const img = markerImages[marker.type];
        if (!img) return;

        const x = marker.coord_1;
        const y = marker.coord_2;
        const w = img.naturalWidth || 24;
        const h = img.naturalHeight || 24;

        elements.markersCtx.drawImage(img, x - w / 2, y - h / 2, w, h);

        if (state.showMarkerNames && marker.name) {
            drawMarkerLabel(elements.markersCtx, marker.name, x + w / 2 + 2, y - h / 2);
        }
    });

    if (state.trackerActive) {
        const img = markerImages.ruins;
        if (img) {
            const w = img.naturalWidth || 24;
            const h = img.naturalHeight || 24;
            elements.markersCtx.drawImage(img, state.trackerPos.x - w / 2, state.trackerPos.y - h / 2, w, h);
        }
    }
}

export function drawMarkerLabel(ctx, text, x, y) {
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
}

export function highlightProvince(targetHex) {
    const width = elements.hiddenCanvas.width;
    const height = elements.hiddenCanvas.height;
    elements.highlightCtx.clearRect(0, 0, width, height);

    const targetR = parseInt(targetHex.slice(1, 3), 16);
    const targetG = parseInt(targetHex.slice(3, 5), 16);
    const targetB = parseInt(targetHex.slice(5, 7), 16);

    const colorData = elements.hiddenCtx.getImageData(0, 0, width, height).data;
    const highlightImgData = elements.highlightCtx.createImageData(width, height);
    const hData = highlightImgData.data;

    for (let i = 0; i < colorData.length; i += 4) {
        if (colorData[i] === targetR && colorData[i + 1] === targetG && colorData[i + 2] === targetB) {
            hData[i] = 255;
            hData[i + 1] = 240;
            hData[i + 2] = 130;
            hData[i + 3] = 180;
        }
    }

    elements.highlightCtx.putImageData(highlightImgData, 0, 0);
}

export function renderIDs() {
    elements.labelsCtx.clearRect(0, 0, elements.labelsCanvas.width, elements.labelsCanvas.height);
    if (!state.showIDs) return;

    elements.labelsCtx.font = 'bold 16px sans-serif';
    elements.labelsCtx.textAlign = 'center';
    elements.labelsCtx.textBaseline = 'middle';

    for (const info of Object.values(state.provincesMeta)) {
        const [cx, cy] = info.center;
        elements.labelsCtx.strokeStyle = '#000000';
        elements.labelsCtx.lineWidth = 3;
        elements.labelsCtx.strokeText(info.id, cx, cy);
        elements.labelsCtx.fillStyle = '#ffffff';
        elements.labelsCtx.fillText(info.id, cx, cy);
    }
}

export function updateLegend() {
    elements.legendContent.innerHTML = '';

    if (state.activeLayer === 'density') {
        DENSITY_TIERS.forEach(tier => {
            const row = document.createElement('div');
            row.className = 'legend-item';

            const colorBox = document.createElement('div');
            colorBox.className = 'legend-color';
            colorBox.style.backgroundColor = tier.color;

            const label = document.createElement('span');
            label.textContent = tier.label;

            row.appendChild(colorBox);
            row.appendChild(label);
            elements.legendContent.appendChild(row);
        });
        return;
    }

    let items = {};
    if (state.activeLayer === 'political') items = state.dbOwnerColors;
    else if (state.activeLayer === 'region') items = state.dbRegionColors;
    else if (state.activeLayer === 'culture') items = state.dbCultureColors;
    else if (state.activeLayer === 'religion') items = state.dbReligionColors;
    else if (state.activeLayer === 'resource') items = state.dbResourceColors;

    if (Object.keys(items).length === 0) {
        elements.legendContent.innerHTML = '<em>Нет данных</em>';
        return;
    }

    for (const [name, color] of Object.entries(items)) {
        const row = document.createElement('div');
        row.className = 'legend-item';

        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color';
        colorBox.style.backgroundColor = color;

        const label = document.createElement('span');
        label.textContent = name;

        row.appendChild(colorBox);
        row.appendChild(label);
        elements.legendContent.appendChild(row);
    }
}
