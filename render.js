import { state, elements, markerImages, MILITARY_GRID_CELL_SIZE, RIVERS_MAP_SRC, LAKES_MAP_SRC, SEAS_MAP_SRC } from './config.js?v=military-ui-update-20261016';

function strokeTerrainPath(ctx) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(245, 235, 215, .96)';
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(35, 39, 37, .96)';
    ctx.stroke();
}

function drawTerrainMark(ctx, terrain, x, y, size, bridge = false) {
    if (terrain === 'plain' && !bridge) return;
    const cx = x + size / 2, cy = y + size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, Math.max(0, size - 2), Math.max(0, size - 2));
    ctx.clip();
    if (bridge) {
        ctx.beginPath();
        ctx.moveTo(cx - size * .3, cy + size * .3);
        ctx.lineTo(cx + size * .3, cy - size * .3);
        ctx.moveTo(cx - size * .2, cy + size * .4);
        ctx.lineTo(cx + size * .4, cy - size * .2);
        for (const t of [-.18, .02, .22]) {
            const px = cx + size * t, py = cy - size * t;
            ctx.moveTo(px - size * .07, py - size * .07);
            ctx.lineTo(px + size * .07, py + size * .07);
        }
        strokeTerrainPath(ctx);
    } else if (terrain === 'water') {
        for (const dy of [-.22, .08, .36]) {
            ctx.beginPath();
            ctx.moveTo(cx - size * .34, cy + size * dy);
            ctx.quadraticCurveTo(cx - size * .16, cy + size * (dy - .1), cx, cy + size * dy);
            ctx.quadraticCurveTo(cx + size * .17, cy + size * (dy + .1), cx + size * .34, cy + size * dy);
            strokeTerrainPath(ctx);
        }
    } else if (terrain === 'hill') {
        for (const scale of [1, .62]) {
            const half = size * .34 * scale, rise = size * .28 * scale;
            ctx.beginPath();
            ctx.moveTo(cx - half, cy + rise * .55);
            ctx.quadraticCurveTo(cx - half * .55, cy - rise, cx, cy - rise * .7);
            ctx.quadraticCurveTo(cx + half * .52, cy - rise, cx + half, cy + rise * .55);
            strokeTerrainPath(ctx);
        }
    } else if (terrain === 'forest') {
        for (const [dx, dy, scale] of [[-.2, .08, .72], [.18, .02, .9], [0, -.2, .75]]) {
            const tx = cx + size * dx, ty = cy + size * dy, h = size * .24 * scale, w = size * .16 * scale;
            ctx.beginPath();
            ctx.moveTo(tx, ty - h);
            ctx.lineTo(tx - w, ty + h * .45);
            ctx.lineTo(tx + w, ty + h * .45);
            ctx.closePath();
            strokeTerrainPath(ctx);
            ctx.beginPath();
            ctx.moveTo(tx, ty + h * .4);
            ctx.lineTo(tx, ty + h * .82);
            strokeTerrainPath(ctx);
        }
    } else if (terrain === 'marsh') {
        for (const [dx, lean] of [[-.23, -.12], [0, .11], [.22, -.1]]) {
            const rx = cx + size * dx, base = cy + size * .34;
            ctx.beginPath();
            ctx.moveTo(rx, base);
            ctx.lineTo(rx + size * lean, cy - size * .3);
            ctx.moveTo(rx + size * lean, cy - size * .18);
            ctx.lineTo(rx + size * (lean - .12), cy - size * .28);
            ctx.moveTo(rx + size * lean, cy - size * .08);
            ctx.lineTo(rx + size * (lean + .12), cy - size * .18);
            strokeTerrainPath(ctx);
        }
    }
    ctx.restore();
}

function sampleCellWaterCoverage(mapData, masks, width, height, x, y, cellWidth, cellHeight, cellKey) {
    if (state.militaryWaterCoverage.has(cellKey)) return state.militaryWaterCoverage.get(cellKey);
    const samples = 12;
    let water = 0;
    const hasWaterMasks = masks.some(mask => !!mask?.data);
    const waterAt = (mask, px, py, kind) => {
        if (!mask?.data) return false;
        const mx = Math.min(mask.width - 1, Math.floor(px * mask.width / width));
        const my = Math.min(mask.height - 1, Math.floor(py * mask.height / height));
        const index = (my * mask.width + mx) * 4;
        const r = mask.data[index], g = mask.data[index + 1], b = mask.data[index + 2], a = mask.data[index + 3];
        return a >= 16 && (kind === 'river' ? b > r + 15 && g > r + 5 && b > 60 : b > r + 12 && g > r + 8 && b > 70);
    };
    for (let row = 0; row < samples; row++) {
        for (let column = 0; column < samples; column++) {
            const px = Math.min(width - 1, x + Math.floor((column + .5) * cellWidth / samples));
            const py = Math.min(height - 1, y + Math.floor((row + .5) * cellHeight / samples));
            if (hasWaterMasks) {
                if (waterAt(masks[0], px, py, 'river') || waterAt(masks[1], px, py, 'lake') || waterAt(masks[2], px, py, 'sea')) water++;
            } else if (mapData) {
                const index = (py * width + px) * 4;
                const rgb = (mapData[index] << 16) | (mapData[index + 1] << 8) | mapData[index + 2];
                if (!state.provinceRgbToId[rgb]) water++;
            }
        }
    }
    const coverage = water / (samples * samples);
    state.militaryWaterCoverage.set(cellKey, coverage);
    return coverage;
}

function sampleCellWaterTypes(masks, width, height, x, y, cellWidth, cellHeight) {
    if (!masks.some(mask => !!mask?.data)) return 0;
    const samples = 12, hits = [0, 0, 0];
    for (let row = 0; row < samples; row++) for (let column = 0; column < samples; column++) {
        const px = Math.min(width - 1, x + Math.floor((column + .5) * cellWidth / samples));
        const py = Math.min(height - 1, y + Math.floor((row + .5) * cellHeight / samples));
        for (let index = 0; index < masks.length; index++) {
            const mask = masks[index];
            if (!mask?.data) continue;
            const mx = Math.min(mask.width - 1, Math.floor(px * mask.width / width));
            const my = Math.min(mask.height - 1, Math.floor(py * mask.height / height));
            const offset = (my * mask.width + mx) * 4;
            const r = mask.data[offset], g = mask.data[offset + 1], b = mask.data[offset + 2];
            if (mask.data[offset + 3] >= 16 && b > r + 12 && g > r + 8 && b > 60) hits[index]++;
        }
    }
    // A bit is set when the water mask covers at least 1% of the cell. A cell
    // may carry multiple bits, so coastlines and broad rivers preserve both media.
    return hits.reduce((mask, count, index) => count >= 2 ? mask | (1 << index) : mask, 0);
}

function isRiverPixel(mask, px, py, width, height) {
    if (!mask?.data) return false;
    const mx = Math.min(mask.width - 1, Math.floor(px * mask.width / width));
    const my = Math.min(mask.height - 1, Math.floor(py * mask.height / height));
    const index = (my * mask.width + mx) * 4;
    return mask.data[index + 3] >= 16 && mask.data[index + 2] > mask.data[index] + 15
        && mask.data[index + 1] > mask.data[index] + 5 && mask.data[index + 2] > 60;
}

function analyzeRiverCell(mask, x, y, cellWidth, cellHeight, width, height) {
    if (!mask?.data) return { contains: false, major: false };
    const left = Math.floor(x * mask.width / width), top = Math.floor(y * mask.height / height);
    const right = Math.min(mask.width, Math.ceil((x + cellWidth) * mask.width / width));
    const bottom = Math.min(mask.height, Math.ceil((y + cellHeight) * mask.height / height));
    const pixelWidth = Math.max(1, right - left), pixelHeight = Math.max(1, bottom - top);
    const edgeBand = Math.max(1, Math.ceil(Math.min(pixelWidth, pixelHeight) * .04));
    const riverPixels = new Uint8Array(pixelWidth * pixelHeight);
    let count = 0;
    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
        const index = (py * mask.width + px) * 4;
        if (mask.data[index + 3] < 16 || mask.data[index + 2] <= mask.data[index] + 15
            || mask.data[index + 1] <= mask.data[index] + 5 || mask.data[index + 2] <= 60) continue;
        riverPixels[(py - top) * pixelWidth + px - left] = 1;
        count++;
    }
    // Require one connected channel to pass through opposite sides; separate
    // river fragments in the same cell cannot combine to form a major crossing.
    const visited = new Uint8Array(riverPixels.length);
    const stack = [];
    let major = false;
    // Rasters share the map's resolution (24px per grid cell). The former
    // hard floor of 32 pixels exceeded the area of low-resolution cell masks,
    // classifying every channel as fordable. Scale the threshold to the cell.
    const minimumMajorRiverPixels = Math.max(10, Math.ceil(pixelWidth * pixelHeight * .035));
    for (let seed = 0; seed < riverPixels.length && !major; seed++) {
        if (!riverPixels[seed] || visited[seed]) continue;
        stack.length = 0;
        stack.push(seed);
        visited[seed] = 1;
        let componentSize = 0;
        const sides = { north: false, east: false, south: false, west: false };
        while (stack.length) {
            const index = stack.pop();
            const px = index % pixelWidth, py = Math.floor(index / pixelWidth);
            componentSize++;
            if (py < edgeBand) sides.north = true;
            if (pixelWidth - 1 - px < edgeBand) sides.east = true;
            if (pixelHeight - 1 - py < edgeBand) sides.south = true;
            if (px < edgeBand) sides.west = true;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = px + dx, ny = py + dy;
                if (nx < 0 || ny < 0 || nx >= pixelWidth || ny >= pixelHeight) continue;
                const next = ny * pixelWidth + nx;
                if (riverPixels[next] && !visited[next]) { visited[next] = 1; stack.push(next); }
            }
        }
        const crossesOppositeSides = (sides.north && sides.south) || (sides.east && sides.west);
        major = componentSize >= minimumMajorRiverPixels && crossesOppositeSides;
    }
    return { contains: count > 0, major };
}

function riverPixelsAlongCellEdge(mask, fromX, fromY, toX, toY, width, height) {
    if (!mask?.data) return 0;
    const x1 = fromX * MILITARY_GRID_CELL_SIZE + MILITARY_GRID_CELL_SIZE / 2;
    const y1 = fromY * MILITARY_GRID_CELL_SIZE + MILITARY_GRID_CELL_SIZE / 2;
    const x2 = toX * MILITARY_GRID_CELL_SIZE + MILITARY_GRID_CELL_SIZE / 2;
    const y2 = toY * MILITARY_GRID_CELL_SIZE + MILITARY_GRID_CELL_SIZE / 2;
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    let hits = 0;
    for (let step = 1; step < steps; step++) {
        const t = step / steps;
        if (isRiverPixel(mask, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), width, height)) hits++;
    }
    return hits;
}

async function readWaterMask(src) {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function buildMilitaryGridMetadata() {
    const width = elements.hiddenCanvas.width, height = elements.hiddenCanvas.height;
    if (!width || !height) throw new Error('Карта провинций ещё не загружена.');
    const mapData = elements.hiddenCtx.getImageData(0, 0, width, height).data;
    const masks = await Promise.all([RIVERS_MAP_SRC, LAKES_MAP_SRC, SEAS_MAP_SRC].map(readWaterMask));
    state.militaryWaterCoverage.clear();
    const cellSize = MILITARY_GRID_CELL_SIZE;
    const cells = [];
    const directions = [[1,0,1], [1,1,2], [0,1,4], [-1,1,8], [-1,0,16], [-1,-1,32], [0,-1,64], [1,-1,128]];
    const cellRows = Math.ceil(height / cellSize), cellColumns = Math.ceil(width / cellSize);
    const riverCells = new Map();
    for (let cellY = 0; cellY < cellRows; cellY++) for (let cellX = 0; cellX < cellColumns; cellX++) {
        const x = cellX * cellSize, y = cellY * cellSize;
        riverCells.set(`${cellX},${cellY}`, analyzeRiverCell(masks[0], x, y,
            Math.min(cellSize, width - x), Math.min(cellSize, height - y), width, height));
    }
    for (let cellY = 0; cellY < cellRows; cellY++) {
        for (let cellX = 0; cellX < cellColumns; cellX++) {
            const x = cellX * cellSize, y = cellY * cellSize;
            const actualWidth = Math.min(cellSize, width - x), actualHeight = Math.min(cellSize, height - y);
            const centerX = Math.min(width - 1, x + Math.floor(actualWidth / 2));
            const centerY = Math.min(height - 1, y + Math.floor(actualHeight / 2));
            const index = (centerY * width + centerX) * 4;
            const rgb = (mapData[index] << 16) | (mapData[index + 1] << 8) | mapData[index + 2];
            const provinceId = state.provinceRgbToId[rgb] || null;
            const key = `${cellX},${cellY}`;
            const coverage = sampleCellWaterCoverage(mapData, masks, width, height, x, y, actualWidth, actualHeight, key);
            const riverCell = riverCells.get(key);
            const containsRiver = !!riverCell?.contains;
            let waterTypes = sampleCellWaterTypes(masks, width, height, x, y, actualWidth, actualHeight);
            if (containsRiver) waterTypes |= 1;
            let riverEdges = 0;
            let fordEdges = 0;
            for (const [dx, dy, edgeFlag] of directions) {
                const nextX = cellX + dx, nextY = cellY + dy;
                if (nextX < 0 || nextY < 0 || nextX >= cellColumns || nextY >= cellRows) continue;
                const oppositeEdge = {1:16, 2:32, 4:64, 8:128, 16:1, 32:2, 64:4, 128:8}[edgeFlag];
                if (edgeFlag > oppositeEdge) continue;
                if (!riverPixelsAlongCellEdge(masks[0], cellX, cellY, nextX, nextY, width, height)) continue;
                const isMajor = riverCells.get(`${cellX},${cellY}`)?.major || riverCells.get(`${nextX},${nextY}`)?.major;
                if (isMajor) {
                    riverEdges |= edgeFlag;
                } else {
                    fordEdges |= edgeFlag;
                }
            }
            cells.push({ cell_x: cellX, cell_y: cellY, province_id: provinceId, base_terrain: coverage > .5 ? 'water' : 'plain', river_edges: riverEdges, ford_edges: fordEdges, water_coverage: Number(coverage.toFixed(4)), water_types: waterTypes });
        }
    }
    const cellsByKey = new Map(cells.map(cell => [`${cell.cell_x},${cell.cell_y}`, cell]));
    const oppositeBits = {1:16, 2:32, 4:64, 8:128, 16:1, 32:2, 64:4, 128:8};
    for (const cell of cells) for (const [dx, dy, bit] of directions) {
        if (cell.river_edges & bit) {
            const neighbor = cellsByKey.get(`${cell.cell_x + dx},${cell.cell_y + dy}`);
            if (neighbor) neighbor.river_edges |= oppositeBits[bit];
        }
        if (cell.ford_edges & bit) {
            const neighbor = cellsByKey.get(`${cell.cell_x + dx},${cell.cell_y + dy}`);
            if (neighbor) neighbor.ford_edges |= oppositeBits[bit];
        }
    }
    return cells;
}

function drawMixedWaterMark(ctx, x, y, size) {
    const cx = x + size * .78, cy = y + size * .78;
    ctx.save();
    // Keep the hydrology cue in a corner so the terrain symbol stays legible.
    ctx.beginPath();
    ctx.arc(cx, cy, size * .18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(22, 31, 35, .88)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * .035);
    ctx.strokeStyle = 'rgba(235, 244, 244, .95)';
    ctx.beginPath();
    ctx.moveTo(cx - size * .12, cy);
    ctx.quadraticCurveTo(cx - size * .06, cy - size * .05, cx, cy);
    ctx.quadraticCurveTo(cx + size * .06, cy + size * .05, cx + size * .12, cy);
    ctx.stroke();
    ctx.restore();
}

function drawCurrentMark(ctx, x, y, size, dx, dy) {
    const magnitude = Math.hypot(dx, dy) || 1;
    const ux = dx / magnitude, uy = dy / magnitude;
    const cx = x + size * .5, cy = y + size * .5;
    const fromX = cx - ux * size * .18, fromY = cy - uy * size * .18;
    const toX = cx + ux * size * .18, toY = cy + uy * size * .18;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(15, 42, 57, .92)'; ctx.lineWidth = Math.max(4, size * .13);
    ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke();
    ctx.strokeStyle = 'rgba(225, 246, 255, .98)'; ctx.lineWidth = Math.max(2, size * .065);
    ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY);
    ctx.moveTo(toX - ux * size * .09 + uy * size * .07, toY - uy * size * .09 - ux * size * .07);
    ctx.lineTo(toX, toY);
    ctx.lineTo(toX - ux * size * .09 - uy * size * .07, toY - uy * size * .09 + ux * size * .07);
    ctx.stroke(); ctx.restore();
}

export function renderMilitaryGrid() {
    const canvas = elements.militaryGridCanvas;
    const ctx = elements.militaryGridCtx;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.showMilitaryGrid && !state.editingMilitaryTerrain) return;

    const size = MILITARY_GRID_CELL_SIZE;
    ctx.save();
    const mapData = null;
    const waterMasks = [];
    if (state.showMilitaryGrid || state.editingMilitaryTerrain) {
        for (let y = 0; y < canvas.height; y += size) {
            for (let x = 0; x < canvas.width; x += size) {
                const cellX = Math.floor(x / size), cellY = Math.floor(y / size);
                const override = state.militaryTerrainCells.get(`${cellX},${cellY}`);
                const key = `${cellX},${cellY}`;
                const synchronizedCell = state.militaryGridCells.get(key);
                const waterCoverage = synchronizedCell ? Number(synchronizedCell.water_coverage) || 0 : sampleCellWaterCoverage(mapData, waterMasks, canvas.width, canvas.height, x, y, Math.min(size, canvas.width - x), key);
                let terrain = override?.terrain;
                // A cell belongs to water only when water occupies more than half of it.
                // Mixed shoreline and narrow-river cells remain land; the small badge
                // below preserves the separate hydrology feature.
                if (!terrain) terrain = synchronizedCell?.base_terrain || (waterCoverage > .5 ? 'water' : 'plain');
                drawTerrainMark(ctx, terrain, x, y, Math.min(size, canvas.width - x), !!override?.bridge);
                const shouldShowMixedWater = terrain !== 'water' && !override?.bridge && waterCoverage >= .025 && waterCoverage <= .5;
                if (shouldShowMixedWater) drawMixedWaterMark(ctx, x, y, Math.min(size, canvas.width - x));
                if (synchronizedCell?.flow_dx != null && (Number(synchronizedCell.water_types) & 1)) {
                    drawCurrentMark(ctx, x, y, Math.min(size, canvas.width - x), Number(synchronizedCell.flow_dx), Number(synchronizedCell.flow_dy));
                }
            }
        }
    }
    if (!state.showMilitaryGrid) { ctx.restore(); return; }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(29, 34, 33, .52)';
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += size) {
        const crispX = Math.floor(x) + 0.5;
        ctx.moveTo(crispX, 0);
        ctx.lineTo(crispX, canvas.height);
    }
    for (let y = 0; y <= canvas.height; y += size) {
        const crispY = Math.floor(y) + 0.5;
        ctx.moveTo(0, crispY);
        ctx.lineTo(canvas.width, crispY);
    }
    ctx.stroke();

    const majorSize = size * 5;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(238, 222, 190, .72)';
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += majorSize) {
        const crispX = Math.floor(x) + 0.5;
        ctx.moveTo(crispX, 0);
        ctx.lineTo(crispX, canvas.height);
    }
    for (let y = 0; y <= canvas.height; y += majorSize) {
        const crispY = Math.floor(y) + 0.5;
        ctx.moveTo(0, crispY);
        ctx.lineTo(canvas.width, crispY);
    }
    ctx.stroke();
    const visibleProvinceIds = state.userProfile?.role === 'player'
        ? new Set([...state.militaryVisibleCells].map(key => Number(state.militaryGridCells.get(key)?.province_id)).filter(Number.isFinite))
        : null;
    const structureGlyphs = { bridge:'╫', camp:'⌂', watchtower:'▲', palisade:'▥', ferry:'↔' };
    for (const structure of state.militaryStructures || []) {
        if (structure.status === 'destroyed') continue;
        const key = `${structure.cell_x},${structure.cell_y}`;
        if (state.userProfile?.role === 'player' && structure.owner !== state.userProfile.owner
            && structure.structure_type !== 'bridge' && !state.militaryVisibleCells.has(key)) continue;
        const x = Number(structure.cell_x) * size + size / 2, y = Number(structure.cell_y) * size + size / 2;
        const active = structure.status === 'active' && Number(structure.available_from_turn) <= Number(state.gameCalendar?.turn);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, size * .31, 0, Math.PI * 2);
        ctx.fillStyle = structure.status === 'broken' ? 'rgba(115,74,63,.94)' : active ? 'rgba(34,43,40,.94)' : 'rgba(54,58,52,.72)';
        ctx.fill();
        ctx.strokeStyle = structure.status === 'broken' ? '#dd9b7f' : '#e6d7b5';
        ctx.lineWidth = 1.5;
        if (!active) ctx.setLineDash([2,2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fff4d6';
        ctx.font = `bold ${Math.max(11,size*.48)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(structure.status === 'broken' ? '×' : structureGlyphs[structure.structure_type] || '•',x,y);
        ctx.restore();
    }
    if (state.userProfile?.role === 'player' && state.militaryGridCells.size) {
        ctx.save();
        ctx.fillStyle = 'rgba(6, 8, 7, .78)';
        for (const key of state.militaryGridCells.keys()) {
            if (state.militaryVisibleCells.has(key)) continue;
            const [cellX, cellY] = key.split(',').map(Number);
            ctx.fillRect(cellX * size, cellY * size, size, size);
        }
        ctx.restore();
    }
    if (state.militarySelectedForceId && state.militaryReachableCells?.size) {
        ctx.save();
        // Movement reach is intentionally drawn after fog: the player always sees
        // the range of their selected force, including cells not yet scouted.
        ctx.fillStyle = 'rgba(255, 224, 125, .48)';
        ctx.strokeStyle = 'rgba(43, 38, 24, 1)';
        ctx.lineWidth = Math.max(3, size * .12);
        for (const key of state.militaryReachableCells) {
            const [cellX, cellY] = key.split(',').map(Number);
            const x = cellX * size + 2, y = cellY * size + 2, w = size - 4, h = size - 4;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
            ctx.save();
            ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
            ctx.strokeStyle = 'rgba(255, 248, 218, 1)'; ctx.lineWidth = Math.max(2, size * .075);
            for (let offset = -size; offset < size * 2; offset += Math.max(6, size * .24)) {
                ctx.beginPath(); ctx.moveTo(x + offset, y); ctx.lineTo(x + offset + h, y + h); ctx.stroke();
            }
            ctx.restore();
            ctx.strokeStyle = 'rgba(255, 249, 218, 1)'; ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        }
        ctx.restore();
    }
    if (state.militaryConditionalTriggerCells?.size) {
        ctx.save();
        ctx.fillStyle = 'rgba(132, 190, 214, .34)';
        ctx.strokeStyle = 'rgba(224, 245, 255, .95)';
        ctx.lineWidth = Math.max(2, size * .08);
        ctx.setLineDash([Math.max(3, size * .14), Math.max(2, size * .1)]);
        for (const key of state.militaryConditionalTriggerCells) {
            const [cellX, cellY] = key.split(',').map(Number);
            ctx.fillRect(cellX * size + 2, cellY * size + 2, size - 4, size - 4);
            ctx.strokeRect(cellX * size + 2, cellY * size + 2, size - 4, size - 4);
        }
        ctx.restore();
    }
    const moveDraft = state.militaryMoveDraft || state.militaryFleetMoveDraft;
    if (moveDraft?.path?.length > 1) {
        ctx.save();
        ctx.beginPath();
        moveDraft.path.forEach((cell, index) => {
            const x = Number(cell.x) * size + size / 2, y = Number(cell.y) * size + size / 2;
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.lineWidth = Math.max(3, size * .13);
        ctx.strokeStyle = 'rgba(255, 226, 128, .95)';
        ctx.setLineDash([size * .3, size * .18]);
        ctx.stroke();
        ctx.setLineDash([]);
        const end = moveDraft.path.at(-1);
        ctx.beginPath();
        ctx.fillStyle = '#ffe280';
        ctx.arc(Number(end.x) * size + size / 2, Number(end.y) * size + size / 2, size * .22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    for (const force of state.militaryForces || []) {
        if (force.force_kind !== 'land_army' || force.status !== 'active') continue;
        const x = Number(force.cell_x) * size + size / 2;
        const y = Number(force.cell_y) * size + size / 2;
        const ownerColor = state.dbOwnerColors[force.owner] || '#242724';
        const radius = Math.max(8, size * .34);
        ctx.save();
        // A compact heraldic shield replaces the letter marker while preserving
        // the owner's color and the light border used throughout the map.
        ctx.beginPath();
        ctx.moveTo(x - radius * .78, y - radius * .72);
        ctx.lineTo(x + radius * .78, y - radius * .72);
        ctx.lineTo(x + radius * .68, y + radius * .28);
        ctx.lineTo(x, y + radius);
        ctx.lineTo(x - radius * .68, y + radius * .28);
        ctx.closePath();
        ctx.fillStyle = ownerColor;
        ctx.strokeStyle = '#f1e7d4';
        ctx.lineWidth = Math.max(1.5, size * .07);
        ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - radius * .45, y + radius * .32); ctx.lineTo(x + radius * .45, y - radius * .38);
        ctx.moveTo(x + radius * .45, y + radius * .32); ctx.lineTo(x - radius * .45, y - radius * .38);
        ctx.strokeStyle = 'rgba(255, 247, 224, .94)'; ctx.lineWidth = Math.max(1.25, size * .055); ctx.stroke();
        ctx.restore();
        if (force.id === state.militarySelectedForceId) {
            ctx.beginPath();
            ctx.arc(x, y, Math.max(11, size * .48), 0, Math.PI * 2);
            ctx.strokeStyle = '#ffe280';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
        if (state.militaryHoveredForceId === force.id) {
            ctx.font = `600 ${Math.max(10, size * .48)}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.strokeStyle = 'rgba(18, 20, 19, .9)';
            ctx.lineWidth = 3;
            ctx.strokeText(force.name, x + size * .42, y - size * .25);
            ctx.fillStyle = '#fffaf0';
            ctx.fillText(force.name, x + size * .42, y - size * .25);
        }
    }
    for (const fleet of state.militaryFleets || []) {
        if (fleet.status !== 'active' || fleet.location_kind !== 'water' || fleet.cell_x == null || fleet.cell_y == null) continue;
        const x = Number(fleet.cell_x) * size + size / 2, y = Number(fleet.cell_y) * size + size / 2;
        const ownerColor = state.dbOwnerColors[fleet.owner] || '#27313a';
        ctx.beginPath();
        ctx.fillStyle = ownerColor;
        ctx.strokeStyle = '#e6f1f1';
        ctx.lineWidth = 2;
        ctx.arc(x, y, Math.max(8, size * .34), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        if (fleet.id === state.militarySelectedFleetId) {
            ctx.beginPath(); ctx.arc(x, y, Math.max(12, size * .5), 0, Math.PI * 2);
            ctx.strokeStyle = '#ffe280'; ctx.lineWidth = 2.5; ctx.stroke();
        }
        const shipScale = Math.max(7, size * .3);
        ctx.save();
        ctx.strokeStyle = '#fffaf0'; ctx.fillStyle = '#fffaf0'; ctx.lineWidth = Math.max(1.2, size * .045);
        ctx.beginPath(); ctx.moveTo(x, y - shipScale * .72); ctx.lineTo(x, y + shipScale * .32); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - shipScale * .12, y - shipScale * .58); ctx.lineTo(x - shipScale * .68, y + shipScale * .05); ctx.lineTo(x - shipScale * .12, y + shipScale * .05); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + shipScale * .12, y - shipScale * .42); ctx.lineTo(x + shipScale * .62, y + shipScale * .05); ctx.lineTo(x + shipScale * .12, y + shipScale * .05); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - shipScale * .64, y + shipScale * .24); ctx.lineTo(x + shipScale * .64, y + shipScale * .24); ctx.lineTo(x + shipScale * .42, y + shipScale * .48); ctx.lineTo(x - shipScale * .4, y + shipScale * .48); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.font = `600 ${Math.max(10,size*.45)}px sans-serif`; ctx.textAlign = 'left';
        ctx.strokeStyle = 'rgba(18,20,19,.85)'; ctx.lineWidth = 3; ctx.strokeText(fleet.name,x+size*.42,y-size*.25);
        ctx.fillStyle = '#fffaf0'; ctx.fillText(fleet.name,x+size*.42,y-size*.25);
    }
    ctx.restore();
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
    const colonyByProvince = new Map((state.militaryColonizationMap || []).map(mission => [Number(mission.target_province_id), mission]));
    const colonyColors = new Map();
    const activeTurn = Number(state.gameCalendar?.turn ?? state.economySnapshot?.calendar?.turn);
    const activeRebellions = new Set((state.economySnapshot?.rebellions || [])
        .filter(row => row.territory_type === 'province'
            && Number(row.rebellion_turn) === activeTurn)
        .map(row => Number(row.territory_id)));

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

    // Public colony markers are shown as state-colored diagonal hatching on top
    // of whichever information layer is selected.
    if (colonyByProvince.size) {
        for (let i = 0; i < srcData.length; i += 4) {
            const provinceId = state.provinceRgbToId[(srcData[i] << 16) | (srcData[i + 1] << 8) | srcData[i + 2]];
            const mission = colonyByProvince.get(Number(provinceId));
            if (!mission) continue;
            let color = colonyColors.get(mission.owner);
            if (!color) {
                const hex = state.dbOwnerColors[mission.owner];
                if (!hex) continue;
                color = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
                colonyColors.set(mission.owner, color);
            }
            const pixel = i >> 2, x = pixel % width, y = Math.floor(pixel / width);
            if ((x + y) % 13 >= 4) continue;
            for (let channel = 0; channel < 3; channel++) dstData[i + channel] = Math.round(dstData[i + channel] * .32 + color[channel] * .68);
            dstData[i + 3] = 220;
        }
    }

    // Rebellious provinces get a red diagonal hatch on the political layer,
    // keeping state ownership colors legible underneath.
    if (state.activeLayer === 'political' && activeRebellions.size) {
        for (let i = 0; i < srcData.length; i += 4) {
            const provinceId = state.provinceRgbToId[(srcData[i] << 16) | (srcData[i + 1] << 8) | srcData[i + 2]];
            if (!activeRebellions.has(Number(provinceId))) continue;
            const pixel = i >> 2, x = pixel % width, y = Math.floor(pixel / width);
            if ((x + y) % 12 >= 4) continue;
            dstData[i] = Math.round(dstData[i] * .32 + 190 * .68);
            dstData[i + 1] = Math.round(dstData[i + 1] * .32 + 48 * .68);
            dstData[i + 2] = Math.round(dstData[i + 2] * .32 + 42 * .68);
            dstData[i + 3] = 230;
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
    const fontSize = 12 / scale;
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
    ctx.translate(x - Math.sin(angle) * offset, y + Math.cos(angle) * offset);
    ctx.rotate(angle);
    const hovered = state.hoveredTradeRouteIndex === routeIndex;
    ctx.globalAlpha = hovered ? 1 : 0.62;
    ctx.fillStyle = '#f1e7d1';
    ctx.strokeStyle = 'rgba(18, 22, 20, .95)';
    ctx.lineWidth = 3 / scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeText(labelText(), 0, 0);
    ctx.fillText(labelText(), 0, 0);
    ctx.restore();
}

function drawTradeRouteArrow(ctx, points, scale) {
    if (points.length < 2) return;
    const segments = [];
    let total = 0;
    for (let index = 1; index < points.length; index++) {
        const from = points[index - 1], to = points[index];
        const length = Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y));
        if (length) { segments.push({ from, to, length }); total += length; }
    }
    if (!total) return;
    let remaining = total * 0.82;
    const segment = segments.find(item => (remaining -= item.length) <= 0) || segments.at(-1);
    const before = Math.max(0, remaining + segment.length);
    const ratio = Math.max(0, Math.min(1, 1 - before / segment.length));
    const x = Number(segment.from.x) + (Number(segment.to.x) - Number(segment.from.x)) * ratio;
    const y = Number(segment.from.y) + (Number(segment.to.y) - Number(segment.from.y)) * ratio;
    const angle = Math.atan2(Number(segment.to.y) - Number(segment.from.y), Number(segment.to.x) - Number(segment.from.x));
    const size = 9 / Math.max(0.1, scale);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.8, size * 0.72);
    ctx.lineTo(-size * 0.8, -size * 0.72);
    ctx.closePath();
    ctx.fill();
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
        const hovered = state.hoveredTradeRouteIndex === routeIndex;
        ctx.globalAlpha = hovered ? 1 : .82;
        ctx.strokeStyle = route.mode === 'land' ? (state.dbOwnerColors[route.seller_owner] || '#cfac6d') : '#76b8c4';
        ctx.fillStyle = ctx.strokeStyle;
        const inverseScale = 1 / Math.max(.1, Number(state.scale) || 1);
        ctx.lineWidth = 4 * inverseScale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(route.mode === 'land' ? [] : [9 * inverseScale, 7 * inverseScale]);
        ctx.beginPath();
        ctx.moveTo(Number(points[0].x), Number(points[0].y));
        for (const point of points.slice(1)) ctx.lineTo(Number(point.x), Number(point.y));
        ctx.stroke();
        ctx.setLineDash([]);
        drawTradeRouteArrow(ctx, points, state.scale);
        for (const point of [points[0], points.at(-1)]) {
            ctx.beginPath();
            ctx.arc(Number(point.x), Number(point.y), 2.5 * inverseScale, 0, Math.PI * 2);
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
            const inverseScale = 1 / Math.max(.1, Number(state.scale) || 1);
            ctx.lineWidth = 3 * inverseScale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([10 * inverseScale, 7 * inverseScale]);
            ctx.beginPath();
            ctx.moveTo(Number(points[0].x), Number(points[0].y));
            for (const point of points.slice(1)) ctx.lineTo(Number(point.x), Number(point.y));
            ctx.stroke();
            ctx.setLineDash([]);
            for (const point of points) { ctx.beginPath(); ctx.arc(Number(point.x), Number(point.y), 3 * inverseScale, 0, Math.PI * 2); ctx.fill(); }
            drawTradeRouteLabel(ctx, draft, points);
            ctx.restore();
        }
    }
}

export function setTradeRouteHoverAt(x, y) {
    const routes = state.showTradeRoutes ? state.tradeRouteOverlay || [] : [];
    const tolerance = 12 / Math.max(.1, Number(state.scale) || 1);
    let hoveredIndex = null;
    let nearest = Infinity;
    for (const [index, route] of routes.entries()) {
        const points = route.map_points || [];
        for (let point = 1; point < points.length; point++) {
            const a = points[point - 1], b = points[point];
            const dx = Number(b.x) - Number(a.x), dy = Number(b.y) - Number(a.y);
            const lengthSquared = dx * dx + dy * dy;
            const ratio = lengthSquared ? Math.max(0, Math.min(1, ((x - Number(a.x)) * dx + (y - Number(a.y)) * dy) / lengthSquared)) : 0;
            const distance = Math.hypot(x - (Number(a.x) + dx * ratio), y - (Number(a.y) + dy * ratio));
            if (distance <= tolerance && distance < nearest) { nearest = distance; hoveredIndex = index; }
        }
    }
    if (state.hoveredTradeRouteIndex === hoveredIndex) return;
    state.hoveredTradeRouteIndex = hoveredIndex;
    renderTradeRoutes(routes);
}

export function setMilitaryGridHoverAt(x, y) {
    let hoveredForceId = null;
    if (state.showMilitaryGrid && Number.isFinite(x) && Number.isFinite(y)) {
        const size = MILITARY_GRID_CELL_SIZE;
        const radius = Math.max(8, size * .34);
        hoveredForceId = (state.militaryForces || []).find(force => {
            if (force.force_kind !== 'land_army' || force.status !== 'active') return false;
            const centerX = Number(force.cell_x) * size + size / 2;
            const centerY = Number(force.cell_y) * size + size / 2;
            return Math.hypot(x - centerX, y - centerY) <= radius;
        })?.id ?? null;
    }
    if (state.militaryHoveredForceId === hoveredForceId) return;
    state.militaryHoveredForceId = hoveredForceId;
    renderMilitaryGrid();
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

    const showRebellionLegend = state.activeLayer === 'political' && (state.economySnapshot?.rebellions || []).some(row =>
        row.territory_type === 'province' && Number(row.rebellion_turn) === Number(state.gameCalendar?.turn ?? state.economySnapshot?.calendar?.turn));
    if (Object.keys(items).length === 0 && !showRebellionLegend) {
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
    if (showRebellionLegend) {
        const row = document.createElement('div');
        row.className = 'legend-item';
        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color';
        colorBox.style.background = 'repeating-linear-gradient(135deg, #c62f2a 0 3px, rgba(198,47,42,.2) 3px 6px)';
        const label = document.createElement('span');
        label.textContent = 'Взбунтовавшаяся провинция';
        row.appendChild(colorBox);
        row.appendChild(label);
        elements.legendContent.appendChild(row);
    }
}
