const VISUAL_MAP_SRC = 'map.png';
const COLOR_MAP_SRC = 'color_map.png';
const META_JSON_SRC = 'provinces_meta.json';

let provincesMeta = {};
const viewport = document.getElementById('viewport');
const mapWrapper = document.getElementById('map-wrapper');
const highlightCanvas = document.getElementById('highlight-canvas');
const highlightCtx = highlightCanvas.getContext('2d');

const popup = document.getElementById('popup');
const popupContent = document.getElementById('popup-content');
const popupClose = document.getElementById('popup-close');

const hiddenCanvas = document.createElement('canvas');
const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const colorMapImage = new Image();

let scale = 1;
let tx = 0;
let ty = 0;

let isDragging = false;
let startX = 0;
let startY = 0;
let dragDistance = 0;

let selectedImgX = null;
let selectedImgY = null;

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

let minScale = 0.1;

Promise.all([
    fetch(META_JSON_SRC).then(res => res.json()),
    new Promise((resolve) => {
        colorMapImage.onload = resolve;
        colorMapImage.src = COLOR_MAP_SRC;
    })
]).then(([data]) => {
    provincesMeta = data;
    
    const width = colorMapImage.naturalWidth;
    const height = colorMapImage.naturalHeight;

    hiddenCanvas.width = width;
    hiddenCanvas.height = height;
    hiddenCtx.drawImage(colorMapImage, 0, 0);

    highlightCanvas.width = width;
    highlightCanvas.height = height;

    const scaleX = window.innerWidth / width;
    const scaleY = window.innerHeight / height;
    minScale = Math.min(scaleX, scaleY) * 0.95;
    scale = minScale;

    tx = (window.innerWidth - width * scale) / 2;
    ty = (window.innerHeight - height * scale) / 2;

    updateTransform();
});

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    
    const newScale = Math.min(Math.max(minScale, scale * zoomFactor), 2);

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

viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newScale = Math.min(Math.max(0.1, scale * zoomFactor), 15);

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
    if (e.target === popup || popup.contains(e.target)) return;
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
    if (e.target === popup || popup.contains(e.target)) return;

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
    popupContent.innerHTML = `
        <strong>Провинция #${info.id}</strong><br>
        Площадь: ${info.area} px<br>
        Центр: [${info.center[0]}, ${info.center[1]}]<br>
        HEX: ${hex}
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