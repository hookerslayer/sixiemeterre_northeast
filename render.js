import { state, elements, markerImages } from './config.js';

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

function drawTradeRouteLabel(ctx, route, points, routeIndex = 0) {
    if (points.length < 2 || !route.source_name || !route.destination_name) return;
    const scale = Math.max(.1, Number(state.scale) || 1);
    const fontSize = 12 / scale, paddingX = 8 / scale, paddingY = 5 / scale;
    const maxWidth = 260 / scale;
    let source = String(route.source_name), destination = String(route.destination_name);
    const labelText = () => `${source} → ${destination}`;
    ctx.save();
    ctx.font = `600 ${fontSize}px sans-serif`;
    while (ctx.measureText(labelText()).width > maxWidth && (source.length > 4 || destination.length > 4)) {
        if (source.length >= destination.length && source.length > 4) source = `${source.slice(0, -2)}…`;
        else if (destination.length > 4) destination = `${destination.slice(0, -2)}…`;
    }
    const lengths = [];
    let totalLength = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = Number(points[i].x) - Number(points[i - 1].x), dy = Number(points[i].y) - Number(points[i - 1].y);
        const length = Math.hypot(dx, dy);
        lengths.push({ dx, dy, length });
        totalLength += length;
    }
    if (!totalLength) { ctx.restore(); return; }
    let targetLength = totalLength / 2, pointIndex = 0;
    while (pointIndex < lengths.length - 1 && targetLength > lengths[pointIndex].length) targetLength -= lengths[pointIndex++].length;
    const segment = lengths[pointIndex], ratio = segment.length ? targetLength / segment.length : 0;
    const x = Number(points[pointIndex].x) + segment.dx * ratio;
    const y = Number(points[pointIndex].y) + segment.dy * ratio;
    let angle = Math.atan2(segment.dy, segment.dx);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    const offset = ((routeIndex % 2) ? 7 : -7) / scale;
    const labelWidth = ctx.measureText(labelText()).width, labelHeight = fontSize + paddingY * 2;
    ctx.translate(x - Math.sin(angle) * offset, y + Math.cos(angle) * offset);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(18, 22, 20, .88)';
    ctx.strokeStyle = 'rgba(236, 220, 180, .65)';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.rect(-labelWidth / 2 - paddingX, -labelHeight / 2, labelWidth + paddingX * 2, labelHeight);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f1e7d1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText(), 0, 0);
    ctx.restore();
}

export function renderTradeRoutes(routes = []) {
    const ctx = elements.tradeRoutesCtx;
    if (!ctx || !elements.tradeRoutesCanvas) return;
    ctx.clearRect(0, 0, elements.tradeRoutesCanvas.width, elements.tradeRoutesCanvas.height);
    if (!state.showTradeRoutes && !state.tradeRouteDraft) return;
    for (const [routeIndex, route] of (state.showTradeRoutes ? routes : []).entries()) {
        const points = route.map_points || [];
        if (points.length < 2 || points.some(point => !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y)))) continue;
        ctx.save();
        ctx.globalAlpha = .78;
        ctx.strokeStyle = route.mode === 'land' ? (state.dbOwnerColors[route.seller_owner] || '#cfac6d') : '#76b8c4';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(route.mode === 'land' ? [] : [9, 7]);
        ctx.beginPath();
        ctx.moveTo(Number(points[0].x), Number(points[0].y));
        for (const point of points.slice(1)) ctx.lineTo(Number(point.x), Number(point.y));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const point of [points[0], points.at(-1)]) {
            ctx.beginPath();
            ctx.arc(Number(point.x), Number(point.y), 4, 0, Math.PI * 2);
            ctx.fill();
        }
        drawTradeRouteLabel(ctx, route, points, routeIndex);
        ctx.restore();
    }
    const draft = state.tradeRouteDraft;
    if (draft) {
        const complete = draft.path.at(-1) === draft.destinationProvinceId;
        const points = [draft.sourcePoint, ...draft.path.slice(1, -1).map(id => state.provinceCentroids.get(Number(id))), ...(complete ? [draft.destinationPoint] : (draft.path.length > 1 ? [state.provinceCentroids.get(Number(draft.path.at(-1)))] : []))].filter(point => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
        if (points.length) {
            ctx.save();
            ctx.strokeStyle = '#f2d17e';
            ctx.fillStyle = '#f2d17e';
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([10, 7]);
            ctx.beginPath();
            ctx.moveTo(Number(points[0].x), Number(points[0].y));
            for (const point of points.slice(1)) ctx.lineTo(Number(point.x), Number(point.y));
            ctx.stroke();
            ctx.setLineDash([]);
            for (const point of points) { ctx.beginPath(); ctx.arc(Number(point.x), Number(point.y), 5, 0, Math.PI * 2); ctx.fill(); }
            drawTradeRouteLabel(ctx, draft, points);
            ctx.restore();
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
