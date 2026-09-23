const SUPABASE_URL = 'https://kezhdhpkzkvgfmihpfko.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L1bAVecjB7Ur1H-86F19WQ_cac_xq3H';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const VISUAL_MAP_SRC = 'map.png';
const COLOR_MAP_SRC = 'color_map.png';
const META_JSON_SRC = 'provinces_meta.json';

let provincesMeta = {};
let idToHexMap = {};

let dbProvinces = {};
let dbRegionColors = {};
let dbOwnerColors = {};

let activeLayer = 'political';

const viewport = document.getElementById('viewport');
const mapWrapper = document.getElementById('map-wrapper');
const layerCanvas = document.getElementById('layer-canvas');
const layerCtx = layerCanvas.getContext('2d');
const highlightCanvas = document.getElementById('highlight-canvas');
const highlightCtx = highlightCanvas.getContext('2d');
const labelsCanvas = document.getElementById('labels-canvas');
const labelsCtx = labelsCanvas.getContext('2d');

const popup = document.getElementById('popup');
const popupContent = document.getElementById('popup-content');
const popupClose = document.getElementById('popup-close');

const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const toggleIdsBtn = document.getElementById('toggle-ids-btn');
const legendContent = document.getElementById('legend-content');
const layerButtons = document.querySelectorAll('.layer-btn');

const hiddenCanvas = document.createElement('canvas');
const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const colorMapImage = new Image();

let scale = 1;
let tx = 0;
let ty = 0;
let minScale = 0.1;

let isDragging = false;
let startX = 0;
let startY = 0;
let dragDistance = 0;

let selectedImgX = null;
let selectedImgY = null;
let showIDs = false;

function updateTransform() {
    mapWrapper.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    updatePopupPosition();
}

function updatePopupPosition() {
    if (selectedImgX === null || selectedImgY === null || popup.style.display === 'none') return;
    const screenX = selectedImgX * scale + tx;
    const screenY = selectedImgY * scale + ty;
    popup.style.left = `${screenX}px`;
    popup.style.top = `${screenY}px`;
}

async function loadSupabaseData() {
    const [resProvinces, resRegions, resOwners] = await Promise.all([
        supabaseClient.from('Provinces').select('*'),
        supabaseClient.from('region_color').select('*'),
        supabaseClient.from('owner_color').select('*')
    ]);

    if (resProvinces.data) {
        resProvinces.data.forEach(row => {
            dbProvinces[row.id] = row;
        });
    }

    if (resRegions.data) {
        resRegions.data.forEach(row => {
            if (row.region && row.region_color) {
                dbRegionColors[row.region] = row.region_color;
            }
        });
    }

    if (resOwners.data) {
        resOwners.data.forEach(row => {
            if (row.owner && row.owner_color) {
                dbOwnerColors[row.owner] = row.owner_color;
            }
        });
    }
}

Promise.all([
    fetch(META_JSON_SRC).then(res => res.json()),
    new Promise((resolve) => {
        colorMapImage.onload = resolve;
        colorMapImage.src = COLOR_MAP_SRC;
    }),
    loadSupabaseData()
]).then(([data]) => {
    provincesMeta = data;
    
    for (const [hex, info] of Object.entries(provincesMeta)) {
        idToHexMap[info.id] = hex;
    }

    const width = colorMapImage.naturalWidth;
    const height = colorMapImage.naturalHeight;

    hiddenCanvas.width = width;
    hiddenCanvas.height = height;
    hiddenCtx.drawImage(colorMapImage, 0, 0);

    layerCanvas.width = width;
    layerCanvas.height = height;
    highlightCanvas.width = width;
    highlightCanvas.height = height;
    labelsCanvas.width = width;
    labelsCanvas.height = height;

    const scaleX = window.innerWidth / width;
    const scaleY = window.innerHeight / height;
    minScale = Math.min(scaleX, scaleY) * 0.95;
    scale = minScale;

    tx = (window.innerWidth - width * scale) / 2;
    ty = (window.innerHeight - height * scale) / 2;

    updateTransform();
    renderActiveLayer();
}).catch(err => {
    console.error('Ошибка инициализации данных:', err);
    legendContent.innerHTML = 'Ошибка загрузки данных';
});

function renderActiveLayer() {
    const width = hiddenCanvas.width;
    const height = hiddenCanvas.height;
    layerCtx.clearRect(0, 0, width, height);

    const rgbLookup = {};

    for (const [srcHex, info] of Object.entries(provincesMeta)) {
        const dbRow = dbProvinces[info.id];
        let targetHex = null;

        if (dbRow) {
            if (activeLayer === 'political' && dbRow.owner) {
                targetHex = dbOwnerColors[dbRow.owner];
            } else if (activeLayer === 'region' && dbRow.region) {
                targetHex = dbRegionColors[dbRow.region];
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

            rgbLookup[key] = [trgR, trgG, trgB, 200];
        }
    }

    const srcData = hiddenCtx.getImageData(0, 0, width, height).data;
    const layerImgData = layerCtx.createImageData(width, height);
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

    layerCtx.putImageData(layerImgData, 0, 0);
    updateLegend();
}

function updateLegend() {
    legendContent.innerHTML = '';
    const items = activeLayer === 'political' ? dbOwnerColors : dbRegionColors;

    if (Object.keys(items).length === 0) {
        legendContent.innerHTML = '<em>Нет данных</em>';
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
        legendContent.appendChild(row);
    }
}

layerButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        layerButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeLayer = e.target.dataset.layer;
        renderActiveLayer();
    });
});

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newScale = Math.min(Math.max(minScale, scale * zoomFactor), 2.5);

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const imgX = (mouseX - tx) / scale;
    const imgY = (mouseY - ty) / scale;

    tx = mouseX - imgX * newScale;
    ty = mouseY - imgY * newScale;
    scale = newScale;

    updateTransform();
}, { passive: false });

viewport.addEventListener('mousedown', (e) => {
    if (e.target === popup || popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#legend-panel')) return;
    isDragging = true;
    startX = e.clientX - tx;
    startY = e.clientY - ty;
    dragDistance = 0;
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newTx = e.clientX - startX;
    const newTy = e.clientY - startY;
    dragDistance += Math.hypot(newTx - tx, newTy - ty);
    tx = newTx;
    ty = newTy;
    updateTransform();
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

viewport.addEventListener('click', (e) => {
    if (dragDistance > 5) return;
    if (e.target === popup || popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#legend-panel')) return;

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const imgX = Math.floor((mouseX - tx) / scale);
    const imgY = Math.floor((mouseY - ty) / scale);

    if (imgX < 0 || imgX >= hiddenCanvas.width || imgY < 0 || imgY >= hiddenCanvas.height) {
        clearSelection();
        return;
    }

    const pixel = hiddenCtx.getImageData(imgX, imgY, 1, 1).data;
    const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();

    const info = provincesMeta[hex];

    if (info) {
        highlightProvince(hex);
        showPopup(imgX, imgY, info, hex);
    } else {
        clearSelection();
    }
});

function highlightProvince(targetHex) {
    const width = hiddenCanvas.width;
    const height = hiddenCanvas.height;
    highlightCtx.clearRect(0, 0, width, height);

    const targetR = parseInt(targetHex.slice(1, 3), 16);
    const targetG = parseInt(targetHex.slice(3, 5), 16);
    const targetB = parseInt(targetHex.slice(5, 7), 16);

    const colorData = hiddenCtx.getImageData(0, 0, width, height).data;
    const highlightImgData = highlightCtx.createImageData(width, height);
    const hData = highlightImgData.data;

    for (let i = 0; i < colorData.length; i += 4) {
        if (colorData[i] === targetR && colorData[i + 1] === targetG && colorData[i + 2] === targetB) {
            hData[i] = 255;
            hData[i + 1] = 240;
            hData[i + 2] = 130;
            hData[i + 3] = 180;
        }
    }

    highlightCtx.putImageData(highlightImgData, 0, 0);
}

function showPopup(imgX, imgY, info, hex) {
    selectedImgX = imgX;
    selectedImgY = imgY;

    const dbRow = dbProvinces[info.id] || {};
    const name = dbRow.province_name || '—';
    const region = dbRow.region || '—';
    const owner = dbRow.owner || '—';

    popupContent.innerHTML = `
        <strong>Провинция #${info.id} (${name})</strong><br>
        Область: ${region}<br>
        Владелец: ${owner}<br>
        Площадь: ${info.area} px
    `;
    popup.style.display = 'block';
    updatePopupPosition();
}

function clearSelection() {
    selectedImgX = null;
    selectedImgY = null;
    highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);
    popup.style.display = 'none';
}

popupClose.addEventListener('click', clearSelection);

function goToProvince(provinceId) {
    const hex = idToHexMap[provinceId];
    if (!hex) {
        alert('Провинция с таким ID не найдена');
        return;
    }

    const info = provincesMeta[hex];
    const [centerX, centerY] = info.center;

    tx = window.innerWidth / 2 - centerX * scale;
    ty = window.innerHeight / 2 - centerY * scale;

    updateTransform();
    highlightProvince(hex);
    showPopup(Math.floor(centerX), Math.floor(centerY), info, hex);
}

searchBtn.addEventListener('click', () => {
    const id = parseInt(searchInput.value, 10);
    if (!isNaN(id)) {
        goToProvince(id);
    }
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const id = parseInt(searchInput.value, 10);
        if (!isNaN(id)) {
            goToProvince(id);
        }
    }
});

toggleIdsBtn.addEventListener('click', () => {
    showIDs = !showIDs;
    toggleIdsBtn.classList.toggle('active', showIDs);
    renderIDs();
});

function renderIDs() {
    labelsCtx.clearRect(0, 0, labelsCanvas.width, labelsCanvas.height);
    if (!showIDs) return;

    labelsCtx.font = 'bold 16px sans-serif';
    labelsCtx.textAlign = 'center';
    labelsCtx.textBaseline = 'middle';

    for (const info of Object.values(provincesMeta)) {
        const [cx, cy] = info.center;
        labelsCtx.strokeStyle = '#000000';
        labelsCtx.lineWidth = 3;
        labelsCtx.strokeText(info.id, cx, cy);
        labelsCtx.fillStyle = '#ffffff';
        labelsCtx.fillText(info.id, cx, cy);
    }
}