import { state, elements, markerImages } from './config.js';
import { renderActiveLayer, renderMarkers, highlightProvince, renderIDs } from './render.js';

export function updateTransform() {
    elements.mapWrapper.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    updatePopupPosition();
}

export function updatePopupPosition() {
    if (state.selectedImgX === null || state.selectedImgY === null || elements.popup.style.display === 'none') return;
    const screenX = state.selectedImgX * state.scale + state.tx;
    const screenY = state.selectedImgY * state.scale + state.ty;
    elements.popup.style.left = `${screenX}px`;
    elements.popup.style.top = `${screenY}px`;
}

export function showTrackerPopup() {
    state.activePopupType = 'tracker';
    state.selectedImgX = state.trackerPos.x;
    state.selectedImgY = state.trackerPos.y;
    elements.popupContent.innerHTML = `
        <strong>Отслеживание координат</strong><br>
        coord_1 (X): ${state.trackerPos.x}<br>
        coord_2 (Y): ${state.trackerPos.y}
    `;
    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function showProvincePopup(imgX, imgY, info) {
    state.activePopupType = 'province';
    state.selectedImgX = imgX;
    state.selectedImgY = imgY;

    const dbRow = state.dbProvinces[info.id] || {};
    const name = dbRow.province_name || '—';
    const region = dbRow.region || '—';
    const owner = dbRow.owner || '—';
    const culture = dbRow.main_culture || '—';
    const religion = dbRow.main_religion || '—';

    elements.popupContent.innerHTML = `
        <strong>Провинция #${info.id} (${name})</strong><br>
        Область: ${region}<br>
        Владелец: ${owner}<br>
        Культура: ${culture}<br>
        Религия: ${religion}<br>
        Площадь: ${info.area} px
    `;
    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function showMarkerPopup(marker) {
    state.activePopupType = 'marker';
    elements.highlightCtx.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    state.selectedImgX = marker.coord_1;
    state.selectedImgY = marker.coord_2;

    elements.popupContent.innerHTML = `
        <strong>${marker.name || 'Маркер'}</strong><br>
        ${marker.description || 'Описание отсутствует'}
    `;
    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function clearSelection() {
    state.activePopupType = null;
    state.selectedImgX = null;
    state.selectedImgY = null;
    elements.highlightCtx.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    elements.popup.style.display = 'none';
}

export function goToProvince(provinceId) {
    const hex = state.idToHexMap[provinceId];
    if (!hex) {
        alert('Провинция с таким ID не найдена');
        return;
    }

    const info = state.provincesMeta[hex];
    const [centerX, centerY] = info.center;

    state.tx = window.innerWidth / 2 - centerX * state.scale;
    state.ty = window.innerHeight / 2 - centerY * state.scale;

    updateTransform();
    highlightProvince(hex);
    showProvincePopup(Math.floor(centerX), Math.floor(centerY), info);
}

export function initEventListeners() {
    elements.layerButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            elements.layerButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.activeLayer = e.target.dataset.layer;
            renderActiveLayer();
        });
    });

    elements.markerTypeCheckboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            state.visibleMarkerTypes[e.target.value] = e.target.checked;
            renderMarkers();
        });
    });

    elements.toggleMarkerNamesBtn.addEventListener('click', () => {
        state.showMarkerNames = !state.showMarkerNames;
        elements.toggleMarkerNamesBtn.classList.toggle('active', state.showMarkerNames);
        renderMarkers();
    });

    elements.trackerBtn.addEventListener('click', () => {
        state.trackerActive = !state.trackerActive;
        elements.trackerBtn.classList.toggle('active', state.trackerActive);

        if (state.trackerActive) {
            state.trackerPos.x = Math.round((window.innerWidth / 2 - state.tx) / state.scale);
            state.trackerPos.y = Math.round((window.innerHeight / 2 - state.ty) / state.scale);
            showTrackerPopup();
        } else {
            if (state.activePopupType === 'tracker') clearSelection();
        }
        renderMarkers();
    });

    elements.viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newScale = Math.min(Math.max(state.minScale, state.scale * zoomFactor), 2.5);

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imgX = (mouseX - state.tx) / state.scale;
        const imgY = (mouseY - state.ty) / state.scale;

        state.tx = mouseX - imgX * newScale;
        state.ty = mouseY - imgY * newScale;
        state.scale = newScale;

        updateTransform();
    }, { passive: false });

    elements.viewport.addEventListener('mousedown', (e) => {
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#legend-panel')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        if (state.trackerActive) {
            const dx = imgX - state.trackerPos.x;
            const dy = imgY - state.trackerPos.y;
            if (Math.hypot(dx, dy) <= 20) {
                state.isDraggingTracker = true;
                return;
            }
        }

        state.isDragging = true;
        state.startX = e.clientX - state.tx;
        state.startY = e.clientY - state.ty;
        state.dragDistance = 0;
    });

    window.addEventListener('mousemove', (e) => {
        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const imgX = Math.round((mouseX - state.tx) / state.scale);
        const imgY = Math.round((mouseY - state.ty) / state.scale);

        if (state.isDraggingTracker) {
            state.trackerPos.x = imgX;
            state.trackerPos.y = imgY;
            renderMarkers();
            showTrackerPopup();
            return;
        }

        if (!state.isDragging) return;
        const newTx = e.clientX - state.startX;
        const newTy = e.clientY - state.startY;
        state.dragDistance += Math.hypot(newTx - state.tx, newTy - state.ty);
        state.tx = newTx;
        state.ty = newTy;
        updateTransform();
    });

    window.addEventListener('mouseup', () => {
        state.isDragging = false;
        state.isDraggingTracker = false;
    });

    elements.viewport.addEventListener('click', (e) => {
        if (state.dragDistance > 5) return;
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#legend-panel')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        for (const marker of state.dbMarkers) {
            if (!state.visibleMarkerTypes[marker.type]) continue;
            const mx = marker.coord_1;
            const my = marker.coord_2;
            const img = markerImages[marker.type];
            const w = img?.naturalWidth || 24;
            const h = img?.naturalHeight || 24;

            if (imgX >= mx - w / 2 && imgX <= mx + w / 2 && imgY >= my - h / 2 && imgY <= my + h / 2) {
                showMarkerPopup(marker);
                return;
            }
        }

        if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) {
            clearSelection();
            return;
        }

        const pixel = elements.hiddenCtx.getImageData(imgX, imgY, 1, 1).data;
        const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();

        const info = state.provincesMeta[hex];

        if (info) {
            highlightProvince(hex);
            showProvincePopup(imgX, imgY, info);
        } else {
            clearSelection();
        }
    });

    elements.popupClose.addEventListener('click', clearSelection);

    elements.searchBtn.addEventListener('click', () => {
        const id = parseInt(elements.searchInput.value, 10);
        if (!isNaN(id)) {
            goToProvince(id);
        }
    });

    elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const id = parseInt(elements.searchInput.value, 10);
            if (!isNaN(id)) {
                goToProvince(id);
            }
        }
    });

    elements.toggleIdsBtn.addEventListener('click', () => {
        state.showIDs = !state.showIDs;
        elements.toggleIdsBtn.classList.toggle('active', state.showIDs);
        renderIDs();
    });
}