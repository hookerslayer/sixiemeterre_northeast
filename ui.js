import { state, elements, markerImages, MARKER_TYPES } from './config.js';
import { renderActiveLayer, renderMarkers, highlightProvince, renderIDs } from './render.js';
import { signUpUser, signInUser, signOutUser, updateProvinceData, createMarkerData, updateMarkerData, deleteMarkerData, fetchStateProfiles, fetchStateMechanics, saveStateMechanics, advanceGameTurn, uploadStateSymbol, deleteStateSymbol } from './api.js';

let toastTimeout = null;
let activePageOwner = '';
const markerTypeLabels = { large_city: 'Крупный город', city: 'Город', monastery: 'Монастырь', fortress: 'Острог', ruins: 'Руины' };
const markerTypeDevelopment = { large_city: 200, city: 50, monastery: 20, fortress: 10, ruins: 0 };
const governmentForms = ['Феодальная монархия', 'Вечевая республика', 'Теократия', 'Вождество'];

export function showToast(message, duration = 3000) {
    if (!elements.toastNotification) return;
    elements.toastNotification.textContent = message;
    elements.toastNotification.classList.add('active');
    if (toastTimeout) clearTimeout(toastTimeout);
    if (duration > 0) {
        toastTimeout = setTimeout(() => {
            elements.toastNotification.classList.remove('active');
        }, duration);
    }
}

export function hideToast() {
    if (!elements.toastNotification) return;
    elements.toastNotification.classList.remove('active');
    if (toastTimeout) clearTimeout(toastTimeout);
}

export function updateTransform() {
    elements.mapWrapper.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    elements.mapWrapper.classList.toggle('pixelated', state.scale >= 1.0);
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

function calculateEstatesBreakdown(yards, ratio) {
    if (!ratio || !yards) return { aristocracy: 0, clergy: 0, burghers: 0, peasants: 0 };
    return {
        aristocracy: Math.round(yards * (ratio.aristocracy || 0)),
        clergy: Math.round(yards * (ratio.clergy || 0)),
        burghers: Math.round(yards * (ratio.burghers || 0)),
        peasants: Math.round(yards * (ratio.peasants || 0))
    };
}

export function renderGameCalendar() {
    if (!elements.gameTurnLabel || !state.gameCalendar) return;
    const { turn, season, year } = state.gameCalendar;
    elements.gameTurnLabel.textContent = `Ход ${formatNumber(turn)} · ${season} · ${year}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function assimilationTurns(record, kind, name, settings) {
    if (!name || name === '—' || name === settings?.[`titular_${kind}`]) return null;
    const stored = Number(record?.[`${kind}_assimilation_turns`]);
    if (state.userProfile?.role === 'admin' && stored > 0) return stored;
    return statusDefaultTurns[getStatus(settings, kind, name)] || 30;
}

function assimilationLine(record, kind, name, settings) {
    const turns = assimilationTurns(record, kind, name, settings);
    if (turns === null) return '';
    const status = statusLabels[getStatus(settings, kind, name)] || statusLabels.noninterference;
    return `<br>Ассимиляция ${kind === 'culture' ? 'культуры' : 'религии'} (${status}): ${formatNumber(turns)} ходов`;
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
    const resource = dbRow.resource || '—';
    const provYards = Number(dbRow.yards) || 0;
    const development = Number(dbRow.development ?? 20);

    const settlements = state.dbMarkers.filter(m => Number(m.province_id) === Number(info.id));
    const settlementsYards = settlements.reduce((acc, m) => acc + (Number(m.yards) || 0), 0);
    const totalYards = provYards + settlementsYards;
    const totalPop = totalYards * 4;

    const provRatio = state.dbEstateRatios['province'];
    const estates = calculateEstatesBreakdown(provYards, provRatio);

    const isAdmin = state.userProfile?.role === 'admin';
    const mechanics = state.stateMechanics[dbRow.owner] || {};
    const cultureTurns = assimilationTurns(dbRow, 'culture', culture, mechanics);
    const religionTurns = assimilationTurns(dbRow, 'religion', religion, mechanics);
    const assimilationInputs = `${cultureTurns === null ? '' : `<label>Ассимиляция культуры, ходов:<input type="number" min="1" id="admin-prov-culture-turns" value="${cultureTurns}"></label>`}${religionTurns === null ? '' : `<label>Ассимиляция религии, ходов:<input type="number" min="1" id="admin-prov-religion-turns" value="${religionTurns}"></label>`}`;

    if (isAdmin) {
        elements.popupContent.innerHTML = `
            <strong>Редактирование провинции #${info.id}</strong>
            <form id="admin-province-form" class="admin-form">
                <label>Название:
                    <input type="text" id="admin-prov-name" value="${name === '—' ? '' : name}">
                </label>
                <label>Владелец:
                    <input type="text" id="admin-prov-owner" value="${owner === '—' ? '' : owner}">
                </label>
                <label>Культура:
                    <input type="text" id="admin-prov-culture" value="${culture === '—' ? '' : culture}">
                </label>
                <label>Религия:
                    <input type="text" id="admin-prov-religion" value="${religion === '—' ? '' : religion}">
                </label>
                <label>Ресурс:
                    <input type="text" id="admin-prov-resource" value="${resource === '—' ? '' : resource}">
                </label>
                <label>Дворы провинции:
                    <input type="number" id="admin-prov-yards" value="${provYards}">
                </label>
                <label>Развитие:
                    <input type="number" min="0" id="admin-prov-development" value="${development}">
                </label>
                ${assimilationInputs}
                <div class="admin-actions">
                    <button type="submit" class="admin-btn">Сохранить</button>
                </div>
            </form>
        `;

        document.getElementById('admin-province-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const updatedFields = {
                province_name: document.getElementById('admin-prov-name').value.trim(),
                owner: document.getElementById('admin-prov-owner').value.trim(),
                main_culture: document.getElementById('admin-prov-culture').value.trim(),
                main_religion: document.getElementById('admin-prov-religion').value.trim(),
                resource: document.getElementById('admin-prov-resource').value.trim(),
                yards: parseInt(document.getElementById('admin-prov-yards').value, 10) || 0,
                development: Math.max(0, parseInt(document.getElementById('admin-prov-development').value, 10) || 0)
            };
            const cultureTurnsInput = document.getElementById('admin-prov-culture-turns');
            const religionTurnsInput = document.getElementById('admin-prov-religion-turns');
            if (cultureTurnsInput) updatedFields.culture_assimilation_turns = Math.max(1, parseInt(cultureTurnsInput.value, 10) || cultureTurns);
            if (religionTurnsInput) updatedFields.religion_assimilation_turns = Math.max(1, parseInt(religionTurnsInput.value, 10) || religionTurns);

            try {
                await updateProvinceData(info.id, updatedFields);
                state.dbProvinces[info.id] = { ...state.dbProvinces[info.id], ...updatedFields };
                renderActiveLayer();
                showProvincePopup(imgX, imgY, info);
                showToast('Данные провинции сохранены');
            } catch (err) {
                showToast('Ошибка при сохранении провинции: ' + err.message);
            }
        });
    } else {
        elements.popupContent.innerHTML = `
            <strong>Провинция #${info.id} (${name})</strong><br>
            Область: ${region}<br>
            Владелец: ${owner}<br>
            Культура: ${culture}<br>
            Религия: ${religion}<br>
            Развитие: ${development}<br>
            Ресурс: ${resource}<br>
            <hr>
            <strong>Демография:</strong><br>
            Дворов (села): ${provYards}<br>
            Дворов (в поселениях): ${settlementsYards}<br>
            Всего дворов: ${totalYards}<br>
            Население: ${totalPop} чел.<br>
            <br>
            <strong>Сословия (сельские дворы):</strong><br>
            • Аристократия: ${estates.aristocracy}<br>
            • Духовенство: ${estates.clergy}<br>
            • Горожане: ${estates.burghers}<br>
            • Крестьянство: ${estates.peasants}
        `;
    }

    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function showMarkerPopup(marker) {
    state.activePopupType = 'marker';
    elements.highlightCtx.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    state.selectedImgX = marker.coord_1;
    state.selectedImgY = marker.coord_2;

    const yards = Number(marker.yards) || 0;
    const development = Number(marker.development ?? markerTypeDevelopment[marker.type] ?? 0);
    const pop = yards * 4;
    const ratio = state.dbEstateRatios[marker.type];
    const estates = calculateEstatesBreakdown(yards, ratio);

    const isAdmin = state.userProfile?.role === 'admin';
    const owningProvince = state.dbProvinces[Number(marker.province_id)] || {};
    if (isAdmin) {
        const optionsHtml = MARKER_TYPES.map(t => `<option value="${t}" ${t === marker.type ? 'selected' : ''}>${markerTypeLabels[t]}</option>`).join('');
        elements.popupContent.innerHTML = `
            <strong>Редактирование поселения</strong>
            <form id="admin-marker-form" class="admin-form">
                <label>Название:
                    <input type="text" id="admin-marker-name" value="${marker.name || ''}">
                </label>
                <label>Владелец:
                    <input type="text" id="admin-marker-owner" value="${marker.owner || ''}">
                </label>
                <label>Тип:
                    <select id="admin-marker-type">${optionsHtml}</select>
                </label>
                <label>ID Провинции:
                    <input type="number" id="admin-marker-prov-id" value="${marker.province_id || ''}">
                </label>
                <label>Культура поселения:
                    <input type="text" id="admin-marker-culture" value="${marker.culture || ''}" ${marker.type === 'ruins' ? 'disabled' : ''}>
                </label>
                <label>Религия поселения:
                    <input type="text" id="admin-marker-religion" value="${marker.religion || ''}" ${marker.type === 'ruins' ? 'disabled' : ''}>
                </label>
                <label>Количество дворов:
                    <input type="number" id="admin-marker-yards" value="${yards}">
                </label>
                <label>Развитие:
                    <input type="number" min="0" id="admin-marker-development" value="${development}">
                </label>
                <label>Описание:
                    <textarea id="admin-marker-desc">${marker.description || ''}</textarea>
                </label>
                <div class="coords-row">
                    <label>Coord 1 (X):
                        <input type="number" id="admin-marker-x" value="${marker.coord_1}">
                    </label>
                    <label>Coord 2 (Y):
                        <input type="number" id="admin-marker-y" value="${marker.coord_2}">
                    </label>
                </div>
                <div class="admin-actions">
                    <button type="submit" class="admin-btn">Сохранить</button>
                    <button type="button" id="admin-marker-move-btn" class="admin-btn">Переместить</button>
                    <button type="button" id="admin-marker-delete-btn" class="admin-btn danger">Удалить</button>
                </div>
            </form>
        `;

        const markerTypeInput = document.getElementById('admin-marker-type');
        const markerProvinceInput = document.getElementById('admin-marker-prov-id');
        const markerDevelopmentInput = document.getElementById('admin-marker-development');
        const markerCultureInput = document.getElementById('admin-marker-culture');
        const markerReligionInput = document.getElementById('admin-marker-religion');
        markerTypeInput.addEventListener('change', () => {
            markerDevelopmentInput.value = markerTypeDevelopment[markerTypeInput.value] ?? 0;
            const isRuins = markerTypeInput.value === 'ruins';
            markerCultureInput.disabled = isRuins;
            markerReligionInput.disabled = isRuins;
            if (isRuins) {
                markerCultureInput.value = '';
                markerReligionInput.value = '';
            } else {
                const province = state.dbProvinces[Number(markerProvinceInput.value)];
                if (!markerCultureInput.value.trim()) markerCultureInput.value = province?.main_culture || '';
                if (!markerReligionInput.value.trim()) markerReligionInput.value = province?.main_religion || '';
            }
        });

        document.getElementById('admin-marker-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const provIdVal = document.getElementById('admin-marker-prov-id').value;
            const markerType = markerTypeInput.value;
            const updatedFields = {
                name: document.getElementById('admin-marker-name').value.trim(),
                owner: document.getElementById('admin-marker-owner').value.trim(),
                type: markerType,
                province_id: provIdVal ? parseInt(provIdVal, 10) : null,
                culture: markerType === 'ruins' ? null : markerCultureInput.value.trim() || null,
                religion: markerType === 'ruins' ? null : markerReligionInput.value.trim() || null,
                yards: parseInt(document.getElementById('admin-marker-yards').value, 10) || 0,
                development: Math.max(0, parseInt(markerDevelopmentInput.value, 10) || 0),
                description: document.getElementById('admin-marker-desc').value.trim(),
                coord_1: parseInt(document.getElementById('admin-marker-x').value, 10),
                coord_2: parseInt(document.getElementById('admin-marker-y').value, 10)
            };
            try {
                await updateMarkerData(marker.id, updatedFields);
                const idx = state.dbMarkers.findIndex(m => m.id === marker.id);
                if (idx !== -1) state.dbMarkers[idx] = { ...state.dbMarkers[idx], ...updatedFields };
                renderMarkers();
                renderActiveLayer();
                showMarkerPopup(state.dbMarkers[idx]);
                showToast('Поселение сохранено');
            } catch (err) {
                showToast('Ошибка изменения поселения: ' + err.message);
            }
        });

        document.getElementById('admin-marker-move-btn').addEventListener('click', () => {
            state.movingMarkerId = marker.id;
            clearSelection();
            showToast('Зажмите маркер мышью и перетащите в нужное место', 0);
        });

        document.getElementById('admin-marker-delete-btn').addEventListener('click', async () => {
            try {
                await deleteMarkerData(marker.id);
                state.dbMarkers = state.dbMarkers.filter(m => m.id !== marker.id);
                clearSelection();
                renderMarkers();
                renderActiveLayer();
                showToast('Поселение удалено');
            } catch (err) {
                showToast('Ошибка удаления поселения: ' + err.message);
            }
        });
    } else {
        elements.popupContent.innerHTML = `
            <strong>${marker.name || 'Поселение'}</strong><br>
            Тип: ${markerTypeLabels[marker.type] || marker.type}<br>
            Владелец: ${marker.owner || '—'}<br>
            Развитие: ${development}<br>
            Культура: ${marker.culture || '—'}<br>
            Религия: ${marker.religion || '—'}<br>
            ${marker.description || 'Описание отсутствует'}<br>
            <hr>
            <strong>Демография поселения:</strong><br>
            Дворов: ${yards}<br>
            Население: ${pop} чел.<br>
            <br>
            <strong>Сословия:</strong><br>
            • Аристократия: ${estates.aristocracy}<br>
            • Духовенство: ${estates.clergy}<br>
            • Горожане: ${estates.burghers}<br>
            • Крестьянство: ${estates.peasants}
        `;
    }

    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function showNewMarkerPopup(imgX, imgY) {
    state.activePopupType = 'new_marker';
    state.selectedImgX = imgX;
    state.selectedImgY = imgY;

    const optionsHtml = MARKER_TYPES.map(t => `<option value="${t}">${markerTypeLabels[t]}</option>`).join('');
    elements.popupContent.innerHTML = `
        <strong>Создание поселения</strong>
        <form id="admin-new-marker-form" class="admin-form">
            <label>Название:
                <input type="text" id="new-marker-name" required>
            </label>
            <label>Тип:
                <select id="new-marker-type">${optionsHtml}</select>
            </label>
            <label>ID Провинции:
                <input type="number" id="new-marker-prov-id">
            </label>
            <label>Культура поселения:
                <input type="text" id="new-marker-culture">
            </label>
            <label>Религия поселения:
                <input type="text" id="new-marker-religion">
            </label>
            <label>Количество дворов:
                <input type="number" id="new-marker-yards" value="0">
            </label>
            <label>Развитие:
                <input type="number" min="0" id="new-marker-development" value="200">
            </label>
            <label>Описание:
                <textarea id="new-marker-desc"></textarea>
            </label>
            <div class="coords-row">
                <label>Coord 1 (X):
                    <input type="number" id="new-marker-x" value="${imgX}" readonly>
                </label>
                <label>Coord 2 (Y):
                    <input type="number" id="new-marker-y" value="${imgY}" readonly>
                </label>
            </div>
            <div class="admin-actions">
                <button type="submit" class="admin-btn">Создать</button>
            </div>
        </form>
    `;

    const newMarkerTypeInput = document.getElementById('new-marker-type');
    const newMarkerProvinceInput = document.getElementById('new-marker-prov-id');
    const newMarkerCultureInput = document.getElementById('new-marker-culture');
    const newMarkerReligionInput = document.getElementById('new-marker-religion');
    const newMarkerDevelopmentInput = document.getElementById('new-marker-development');
    const syncNewMarkerCultureReligion = () => {
        const isRuins = newMarkerTypeInput.value === 'ruins';
        newMarkerCultureInput.disabled = isRuins;
        newMarkerReligionInput.disabled = isRuins;
        if (isRuins) {
            newMarkerCultureInput.value = '';
            newMarkerReligionInput.value = '';
            return;
        }

        const province = state.dbProvinces[Number(newMarkerProvinceInput.value)];
        newMarkerCultureInput.value = province?.main_culture || '';
        newMarkerReligionInput.value = province?.main_religion || '';
    };
    newMarkerTypeInput.addEventListener('change', syncNewMarkerCultureReligion);
    newMarkerTypeInput.addEventListener('change', () => { newMarkerDevelopmentInput.value = markerTypeDevelopment[newMarkerTypeInput.value] ?? 0; });
    newMarkerProvinceInput.addEventListener('input', syncNewMarkerCultureReligion);
    syncNewMarkerCultureReligion();

    document.getElementById('admin-new-marker-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const provIdVal = document.getElementById('new-marker-prov-id').value;
        const markerType = newMarkerTypeInput.value;
        const markerData = {
            name: document.getElementById('new-marker-name').value.trim(),
            type: markerType,
            province_id: provIdVal ? parseInt(provIdVal, 10) : null,
            culture: markerType === 'ruins' ? null : newMarkerCultureInput.value.trim() || null,
            religion: markerType === 'ruins' ? null : newMarkerReligionInput.value.trim() || null,
            yards: parseInt(document.getElementById('new-marker-yards').value, 10) || 0,
            development: Math.max(0, parseInt(newMarkerDevelopmentInput.value, 10) || 0),
            description: document.getElementById('new-marker-desc').value.trim(),
            coord_1: imgX,
            coord_2: imgY
        };

        try {
            const created = await createMarkerData(markerData);
            if (created && created[0]) state.dbMarkers.push(created[0]);
            state.isAddingMarkerMode = false;
            elements.addMarkerModeBtn.classList.remove('active');
            renderMarkers();
            renderActiveLayer();
            clearSelection();
            showToast('Поселение успешно создано');
        } catch (err) {
            showToast('Ошибка создания поселения: ' + err.message);
        }
    });

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
        showToast('Провинция с таким ID не найдена');
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

function showPageView(title, content, options = {}) {
    if (!elements.pageView) return;

    state.isDragging = false;
    state.isDraggingMarker = false;
    state.isDraggingTracker = false;
    elements.popup.style.display = 'none';
    const navItems = getNavigationItems();
    elements.pageView.innerHTML = `
        <nav class="page-nav" aria-label="Разделы государства">
            <div class="page-nav-brand">SIXIÈME TERRE</div>
            ${navItems.map(item => `<button class="page-nav-item ${item.id === options.navId ? 'active' : ''}" data-page-nav="${item.id}" ${item.externalUrl ? `data-url="${item.externalUrl}"` : ''}>${escapeHtml(item.label)}</button>`).join('')}
        </nav>
        <div class="page-shell">
            <header class="page-header">
                <div>
                    <div class="page-eyebrow">SIXIÈME TERRE <span>/</span> ${escapeHtml(options.section || title)}</div>
                    <h1>${escapeHtml(title)}</h1>
                    ${options.subtitle ? `<p class="page-subtitle">${escapeHtml(options.subtitle)}</p>` : ''}
                </div>
                <div class="page-header-actions">
                    ${options.onBack ? `<button id="page-back-btn" class="page-back-btn">${escapeHtml(options.backLabel || 'Назад')}</button>` : ''}
                    <button id="page-map-btn" class="page-map-btn">← На карту</button>
                </div>
            </header>
            <main class="page-content">${content}</main>
        </div>
    `;
    elements.pageView.classList.add('active');
    elements.pageView.scrollTop = 0;
    document.getElementById('page-map-btn')?.addEventListener('click', closePageView);
    document.getElementById('page-back-btn')?.addEventListener('click', options.onBack);
    elements.pageView.querySelectorAll('[data-page-nav]').forEach(button => button.addEventListener('click', () => activateNavigationItem(button.dataset.pageNav, button.dataset.url)));
}

function closePageView() {
    elements.pageView?.classList.remove('active');
    if (elements.pageView) elements.pageView.innerHTML = '';
}

function getOwnerStatistics(owner) {
    const provinces = Object.values(state.dbProvinces).filter(province => province.owner === owner);
    const provinceIds = new Set(provinces.map(province => Number(province.id)));
    const settlements = state.dbMarkers.filter(marker => provinceIds.has(Number(marker.province_id)));
    const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const provinceYards = sum(provinces, 'yards');
    const settlementYards = sum(settlements, 'yards');
    const estateYards = { aristocracy: 0, clergy: 0, burghers: 0, peasants: 0 };

    const addEstates = (yards, type) => {
        const result = calculateEstatesBreakdown(yards, state.dbEstateRatios[type]);
        for (const estate of Object.keys(estateYards)) estateYards[estate] += result[estate];
    };
    provinces.forEach(province => addEstates(Number(province.yards) || 0, 'province'));
    settlements.forEach(marker => addEstates(Number(marker.yards) || 0, marker.type));

    const cultureGroups = new Map();
    const religionGroups = new Map();
    const addPopulation = (map, label, yards) => {
        const key = String(label || '').trim();
        if (key) {
            const group = map.get(key) || { yards: 0, population: 0 };
            group.yards += yards;
            group.population += yards * 4;
            map.set(key, group);
        }
    };
    provinces.forEach(province => {
        const yards = Number(province.yards) || 0;
        addPopulation(cultureGroups, province.main_culture, yards);
        addPopulation(religionGroups, province.main_religion, yards);
    });
    settlements.forEach(marker => {
        const yards = Number(marker.yards) || 0;
        addPopulation(cultureGroups, marker.culture, yards);
        addPopulation(religionGroups, marker.religion, yards);
    });
    const totalYards = provinceYards + settlementYards;
    return {
        provinces,
        settlements,
        provinceYards,
        settlementYards,
        totalYards,
        population: totalYards * 4,
        estateYards,
        cultureGroups,
        religionGroups
    };
}

function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

function renderPieChart(title, entries) {
    const values = [...entries].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const total = values.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return `<section class="page-panel distribution-panel"><h2>${escapeHtml(title)}</h2><p class="page-empty">Нет данных для распределения.</p></section>`;
    const palette = ['#c9a96e','#7e9a78','#8799b8','#b77d65','#9c83ad','#d4c18a','#5eaaa0','#c87891','#8c9870','#a78561'];
    let cursor = 0;
    const slices = values.map(([, value], index) => {
        const start = cursor;
        cursor += value / total * 100;
        return `${palette[index % palette.length]} ${start}% ${cursor}%`;
    });
    const legend = values.map(([label, value], index) => `<li><i style="--slice-color:${palette[index % palette.length]}"></i><span>${escapeHtml(label)}</span><strong>${formatNumber(value)} чел.</strong><small>${formatNumber(value / total * 100, 1)}%</small></li>`).join('');
    return `<section class="page-panel distribution-panel"><div class="page-panel-heading"><div><h2>${escapeHtml(title)}</h2><p>Расчёт по численности населения в доступных данных.</p></div></div><div class="pie-layout"><div class="pie-chart" role="img" aria-label="${escapeHtml(title)}" style="--pie:${slices.join(',')}"><span>${formatNumber(total)}<small>чел.</small></span></div><ul class="pie-legend">${legend}</ul></div></section>`;
}

const statusLabels = { recognition: 'Признание', noninterference: 'Невмешательство', expulsion: 'Изгнание' };
const statusOptions = Object.entries(statusLabels);
const statusDefaultTurns = { recognition: 60, noninterference: 30, expulsion: 10 };
const estateNames = [['aristocracy','Аристократия'],['clergy','Духовенство'],['burghers','Горожане'],['peasants','Крестьянство']];

function defaultCultureReligionStatus(kind, name, settings = {}) {
    return kind === 'religion' && name.toLocaleLowerCase('ru') === 'язычество' && settings.titular_religion === 'Ислам' ? 'expulsion' : 'noninterference';
}

function getStatus(settings, kind, name) {
    return settings?.[`${kind}_status`]?.[name]?.status || defaultCultureReligionStatus(kind, name, settings);
}

function demographicRows(groups, kind, settings, titularName) {
    return [...groups.entries()].sort((a, b) => b[1].population - a[1].population).map(([name, values]) => {
        const isTitular = name === titularName;
        const forcedExpulsion = kind === 'religion' && name.toLocaleLowerCase('ru') === 'язычество' && settings.titular_religion === 'Ислам';
        const status = isTitular ? 'Титульная' : (statusLabels[getStatus(settings, kind, name)] || statusLabels.noninterference);
        const loyalty = Number(settings?.[`${kind}_loyalty`]?.[name] ?? 100);
        const isAdmin = state.userProfile?.role === 'admin';
        const control = isTitular || forcedExpulsion || !isAdmin ? status : `<select data-status-kind="${kind}" data-status-name="${escapeHtml(name)}">${statusOptions.map(([value, label]) => `<option value="${value}" ${value === getStatus(settings, kind, name) ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
        const loyaltyInput = isAdmin ? `<input class="stat-loyalty-input" type="number" min="0" max="100" step="1" data-loyalty-kind="${kind}" data-loyalty-name="${escapeHtml(name)}" value="${loyalty}"> %` : `${loyalty}%`;
        return `<tr><td>${escapeHtml(name)}</td><td>${control}</td><td>${formatNumber(values.yards)} дв.</td><td>${formatNumber(values.population)} чел.</td><td>${loyaltyInput}</td></tr>`;
    }).join('');
}

async function renderStateStatistics(owner, playerName = '', options = {}) {
    activePageOwner = owner;
    const stats = getOwnerStatistics(owner);
    showPageView('Статистика', '<div class="page-loading">Загружаю статистику государства…</div>', {
        section: 'Статистика государства', navId: 'nav-stats', subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}`
    });
    try {
        const settings = state.stateMechanics[owner] ?? await fetchStateMechanics(owner) ?? {};
        state.stateMechanics[owner] = settings;
        const titularCulture = settings.titular_culture || '';
        const titularReligion = settings.titular_religion || '';
        const isAdmin = state.userProfile?.role === 'admin';
        const estateRows = estateNames.map(([key, label]) => {
            const yards = stats.estateYards[key];
            const loyalty = Number(settings.estate_loyalty?.[key] ?? 100);
            const rate = Number(settings.tax_rates?.[key] ?? { aristocracy: 10, clergy: 1, burghers: 2, peasants: 1 }[key]);
            const loyaltyCell = isAdmin ? `<input class="stat-loyalty-input" type="number" min="0" max="100" step="1" data-loyalty-kind="estate" data-loyalty-name="${key}" value="${loyalty}"> %` : `${loyalty}%`;
            return `<tr><td>${label}</td><td><input class="stat-tax-input" name="tax_${key}" type="number" min="0" step="0.1" value="${rate}"> z/двор</td><td>${formatNumber(yards)} дв.</td><td>${formatNumber(yards * 4)} чел.</td><td>${loyaltyCell}</td></tr>`;
        }).join('');
        const culturePie = new Map([...stats.cultureGroups].map(([name, group]) => [name, group.population]));
        const religionPie = new Map([...stats.religionGroups].map(([name, group]) => [name, group.population]));
        const titleOptions = (groups, selected) => `<option value="">— не выбрана —</option>${[...groups.keys()].sort((a,b) => a.localeCompare(b, 'ru')).map(name => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
        const adminTitles = isAdmin ? `<div class="stat-titular-settings"><label>Титульная культура<select name="titular_culture">${titleOptions(stats.cultureGroups, titularCulture)}</select></label><label>Титульная религия<select name="titular_religion">${titleOptions(stats.religionGroups, titularReligion)}</select></label></div>` : '';
        const governmentForm = settings.government_form || '';
        const governmentField = isAdmin ? `<label class="government-form-field">Форма правления<select name="government_form"><option value="">— не выбрана —</option>${governmentForms.map(form => `<option value="${escapeHtml(form)}" ${form === governmentForm ? 'selected' : ''}>${escapeHtml(form)}</option>`).join('')}</select></label>` : `<div class="government-form-readonly"><span>Форма правления</span><strong>${escapeHtml(governmentForm || 'не указана')}</strong></div>`;
        const stateIdentity = `<section class="page-panel state-identity-panel"><div class="state-identity-symbol"><div class="page-panel-heading"><div><h2>Символика</h2><p>Флаг или герб · PNG, JPEG или WebP · до 2 МБ</p></div></div><div class="symbol-content">${settings.state_symbol_url ? `<img class="state-symbol-preview" src="${escapeHtml(settings.state_symbol_url)}" alt="Символика государства">` : '<div class="state-symbol-empty">Изображение не загружено</div>'}<div><label class="symbol-upload-label">Загрузить изображение<input id="state-symbol-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${settings.state_symbol_path ? '<button id="state-symbol-remove" class="page-back-btn" type="button">Удалить символику</button>' : ''}<span id="state-symbol-status" aria-live="polite"></span></div></div></div><div class="state-identity-details"><h2>${escapeHtml(owner)}</h2><div class="state-identity-titles"><span>Титульная культура<strong>${escapeHtml(titularCulture || 'не указана')}</strong></span><span>Титульная религия<strong>${escapeHtml(titularReligion || 'не указана')}</strong></span></div>${governmentField}</div></section>`;
        const ruler = settings.ruler || {};
        const rulerFields = `<section class="page-panel ruler-panel"><div class="page-panel-heading"><div><h2>Правитель</h2><p>Возраст увеличивается при переходе к новому игровому году.</p></div></div><div class="ruler-fields"><label>Имя<input name="ruler_name" maxlength="80" value="${escapeHtml(ruler.name || '')}" ${isAdmin ? 'readonly' : ''}></label><label>Титул<input name="ruler_title" maxlength="80" value="${escapeHtml(ruler.title || '')}" ${isAdmin ? 'readonly' : ''}></label><label>Возраст<input name="ruler_age" type="number" min="0" max="150" value="${Number(ruler.age) || 0}" ${isAdmin ? 'readonly' : ''}></label></div></section>`;
        const crime = Number(settings.crime_rate ?? 20);
        const corruption = Number(settings.corruption_rate ?? 20);
        const socialSection = (title, rows, key) => `<div class="statistic-pair"><section class="page-panel"><div class="page-panel-heading"><div><h2>${title}</h2></div></div><div class="page-table-wrap"><table class="page-table"><thead><tr><th>${key === 'estate' ? 'Сословие' : key === 'culture' ? 'Культура' : 'Религия'}</th>${key === 'estate' ? '<th>Налоговая ставка</th>' : '<th>Статус</th>'}<th>Дворы</th><th>Население</th><th>Лояльность</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Нет данных.</td></tr>`}</tbody></table></div></section>${renderPieChart(`Население по ${key === 'estate' ? 'сословиям' : key === 'culture' ? 'культурам' : 'религиям'}`, key === 'estate' ? Object.entries(stats.estateYards).map(([estate, yards]) => [estateNames.find(([id]) => id === estate)[1], yards * 4]) : key === 'culture' ? culturePie : religionPie)}</div>`;
        const content = `${stats.provinces.length === 0 ? '<div class="page-empty">В базе пока нет провинций, закреплённых за этим государством.</div>' : ''}
            <form id="state-statistics-form">
            ${stateIdentity}
            <section class="stat-overview" aria-label="Краткая статистика">
                <div><span>Население</span><strong>${formatNumber(stats.population)}</strong><small>${formatNumber(stats.totalYards)} дворов</small></div>
                <div><span>Провинции</span><strong>${formatNumber(stats.provinces.length)}</strong><small>под контролем</small></div>
                <div><span>Поселения</span><strong>${formatNumber(stats.settlements.length)}</strong><small>${formatNumber(stats.settlementYards)} дворов</small></div>
                <div><span>Преступность</span><strong>${formatNumber(crime)}%</strong><small>текущий показатель</small></div>
                <div><span>Коррупция</span><strong>${formatNumber(corruption)}%</strong><small>текущий показатель</small></div>
            </section>
                ${adminTitles}
                ${rulerFields}
                ${socialSection('Сословия', estateRows, 'estate')}
                ${socialSection('Культуры', demographicRows(stats.cultureGroups, 'culture', settings, titularCulture), 'culture')}
                ${socialSection('Религии', demographicRows(stats.religionGroups, 'religion', settings, titularReligion), 'religion')}
                <div class="mechanics-save-row"><button class="page-map-btn" type="submit">Сохранить данные статистики</button><span id="statistics-save-status" aria-live="polite"></span></div>
            </form>
            `;
        showPageView('Статистика', content, {
            section: 'Статистика государства', navId: 'nav-stats',
            subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}`,
            onBack: options.onBack, backLabel: options.backLabel
        });
        elements.pageView.querySelector('#state-statistics-form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const status = form.querySelector('#statistics-save-status');
            const next = { ...settings, tax_rates: { ...(settings.tax_rates || {}) }, estate_loyalty: { ...(settings.estate_loyalty || {}) }, culture_status: { ...(settings.culture_status || {}) }, religion_status: { ...(settings.religion_status || {}) }, culture_loyalty: { ...(settings.culture_loyalty || {}) }, religion_loyalty: { ...(settings.religion_loyalty || {}) } };
            const defaultTaxRates = { aristocracy: 10, clergy: 1, burghers: 2, peasants: 1 };
            const proposedTaxRates = Object.fromEntries(estateNames.map(([key]) => [key, Math.max(0, Number(form.elements[`tax_${key}`]?.value ?? settings.tax_rates?.[key] ?? defaultTaxRates[key]) || 0)]));
            const taxChanged = estateNames.some(([key]) => proposedTaxRates[key] !== Number(settings.tax_rates?.[key] ?? defaultTaxRates[key]));
            if (taxChanged && !isAdmin && Number(settings.tax_rates_last_changed_year) === Number(state.gameCalendar?.year)) {
                status.textContent = 'Налоговые ставки можно менять один раз за игровой год.';
                return;
            }
            Object.assign(next.tax_rates, proposedTaxRates);
            if (taxChanged && !isAdmin) next.tax_rates_last_changed_year = Number(state.gameCalendar?.year);
            form.querySelectorAll('[data-status-kind]').forEach(select => {
                const key = select.dataset.statusName;
                next[`${select.dataset.statusKind}_status`][key] = { ...(next[`${select.dataset.statusKind}_status`][key] || {}), status: select.value };
            });
            if (isAdmin) form.querySelectorAll('[data-loyalty-kind]').forEach(input => {
                const kind = input.dataset.loyaltyKind;
                const name = input.dataset.loyaltyName;
                next[`${kind}_loyalty`][name] = Math.max(0, Math.min(100, Number(input.value) || 0));
            });
            if (isAdmin) {
                next.titular_culture = form.elements.titular_culture.value;
                next.titular_religion = form.elements.titular_religion.value;
                next.government_form = form.elements.government_form.value;
            } else {
                next.ruler = { ...(settings.ruler || {}), name: form.elements.ruler_name.value.trim(), title: form.elements.ruler_title.value.trim(), age: Math.max(0, Math.min(150, Number(form.elements.ruler_age.value) || 0)), last_age_year: Number(state.gameCalendar?.year) || 1450 };
            }
            try {
                state.stateMechanics[owner] = await saveStateMechanics(owner, next);
                await renderStateStatistics(owner, playerName, options);
            } catch (error) {
                status.textContent = `Ошибка сохранения: ${error.message}`;
            }
        });
        const symbolInput = elements.pageView.querySelector('#state-symbol-file');
        symbolInput?.addEventListener('change', async () => {
            const file = symbolInput.files?.[0];
            if (!file) return;
            const symbolStatus = elements.pageView.querySelector('#state-symbol-status');
            if (file.size > 2 * 1024 * 1024) { symbolStatus.textContent = 'Изображение больше 2 МБ.'; symbolInput.value = ''; return; }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { symbolStatus.textContent = 'Выберите PNG, JPEG или WebP.'; symbolInput.value = ''; return; }
            symbolInput.disabled = true;
            symbolStatus.textContent = 'Загрузка…';
            try {
                const uploaded = await uploadStateSymbol(owner, file);
                const next = { ...settings, state_symbol_path: uploaded.path, state_symbol_url: uploaded.url };
                state.stateMechanics[owner] = await saveStateMechanics(owner, next);
                await renderStateStatistics(owner, playerName, options);
                showToast('Символика государства сохранена');
            } catch (error) {
                symbolStatus.textContent = `Не удалось загрузить: ${error.message}`;
                symbolInput.disabled = false;
            }
        });
        elements.pageView.querySelector('#state-symbol-remove')?.addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            const symbolStatus = elements.pageView.querySelector('#state-symbol-status');
            try {
                const next = { ...settings, state_symbol_path: null, state_symbol_url: null };
                state.stateMechanics[owner] = await saveStateMechanics(owner, next);
                if (settings.state_symbol_path) await deleteStateSymbol(settings.state_symbol_path);
                await renderStateStatistics(owner, playerName, options);
            } catch (error) {
                symbolStatus.textContent = `Не удалось удалить символику: ${error.message}`;
                button.disabled = false;
            }
        });
    } catch (error) {
        showPageView('Статистика', `<div class="page-error">Не удалось загрузить настройки государства: ${escapeHtml(error.message)}</div>`, { navId: 'nav-stats', subtitle: owner });
    }
}

async function renderAdminStateList() {
    activePageOwner = '';
    showPageView('Статистика игроков', '<div class="page-loading">Загружаю список игроков…</div>', { navId: 'nav-stats' });
    try {
        const profiles = (await fetchStateProfiles()).filter(profile => String(profile.owner || '').trim());
        if (!profiles.length) {
            showPageView('Статистика игроков', '<div class="page-empty">Пока нет игроков с назначенными государствами.</div>', { navId: 'nav-stats' });
            return;
        }

        const cards = profiles.map((profile, index) => {
            const stats = getOwnerStatistics(profile.owner);
            return `<button class="player-state-card" data-player-index="${index}">
                <span class="player-state-name">${escapeHtml(profile.nickname || 'Игрок')}</span>
                <strong>${escapeHtml(profile.owner)}</strong>
                <span class="player-state-summary">${formatNumber(stats.provinces.length)} пров. · ${formatNumber(stats.population)} чел.</span>
                <span class="player-state-open">Открыть статистику →</span>
            </button>`;
        }).join('');
        showPageView('Статистика игроков', `<p class="page-intro">Выберите государство, чтобы открыть его показатели отдельно.</p><div class="player-state-grid">${cards}</div>`, { navId: 'nav-stats' });
        elements.pageView.querySelectorAll('[data-player-index]').forEach(button => {
            button.addEventListener('click', () => {
                const profile = profiles[Number(button.dataset.playerIndex)];
                renderStateStatistics(profile.owner, profile.nickname || 'Игрок', {
                    onBack: renderAdminStateList,
                    backLabel: '← К игрокам'
                });
            });
        });
    } catch (error) {
        showPageView('Статистика игроков', `<div class="page-error">Не удалось загрузить список игроков: ${escapeHtml(error.message)}</div>`, { navId: 'nav-stats' });
    }
}

function renderOwnerProvinces(owner) {
    const provinces = Object.values(state.dbProvinces)
        .filter(province => province.owner === owner)
        .sort((a, b) => Number(a.id) - Number(b.id));
    const rows = provinces.map(province => `
        <tr><td><button class="table-link" data-province-id="${Number(province.id)}">#${formatNumber(Number(province.id))}</button></td>
        <td>${escapeHtml(province.province_name || '—')}</td><td>${escapeHtml(province.region || '—')}</td>
        <td>${formatNumber(Number(province.yards) || 0)}</td><td>${formatNumber(Number(province.development ?? 20))}</td><td>${escapeHtml(province.main_culture || '—')}</td>
        <td>${escapeHtml(province.main_religion || '—')}</td><td>${formatTurns(assimilationTurns(province, 'culture', province.main_culture, state.stateMechanics[owner] || {}))}</td><td>${formatTurns(assimilationTurns(province, 'religion', province.main_religion, state.stateMechanics[owner] || {}))}</td><td>${escapeHtml(province.resource || '—')}</td></tr>
    `).join('');
    const content = provinces.length ? `<section class="page-panel dense-table"><div class="page-table-wrap"><table class="page-table"><thead><tr><th>ID</th><th>Провинция</th><th>Регион</th><th>Дворы</th><th>Развитие</th><th>Культура</th><th>Религия</th><th>Смена культуры</th><th>Смена религии</th><th>Ресурс</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '<div class="page-empty">За государством пока не закреплены провинции.</div>';
    activePageOwner = owner;
    showPageView('Провинции', content, { subtitle: owner, navId: 'nav-provinces' });
    elements.pageView.querySelectorAll('[data-province-id]').forEach(button => button.addEventListener('click', () => {
        closePageView();
        goToProvince(Number(button.dataset.provinceId));
    }));
}

function renderOwnerSettlements(owner) {
    const provinces = Object.values(state.dbProvinces).filter(province => province.owner === owner);
    const provinceIds = new Set(provinces.map(province => Number(province.id)));
    const settlements = state.dbMarkers.filter(marker => provinceIds.has(Number(marker.province_id)));
    const rows = settlements.map(marker => `
        <tr><td><button class="table-link" data-marker-id="${Number(marker.id)}">${escapeHtml(marker.name || 'Поселение')}</button></td>
        <td>${escapeHtml(markerTypeLabels[marker.type] || marker.type || '—')}</td><td>#${formatNumber(Number(marker.province_id) || 0)}</td>
        <td>${formatNumber(Number(marker.yards) || 0)}</td><td>${formatNumber(Number(marker.development ?? markerTypeDevelopment[marker.type] ?? 0))}</td><td>${escapeHtml(marker.culture || '—')}</td>
        <td>${escapeHtml(marker.religion || '—')}</td><td>${formatTurns(assimilationTurns(marker, 'culture', marker.culture, state.stateMechanics[owner] || {}))}</td><td>${formatTurns(assimilationTurns(marker, 'religion', marker.religion, state.stateMechanics[owner] || {}))}</td></tr>
    `).join('');
    const content = settlements.length ? `<section class="page-panel dense-table"><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Поселение</th><th>Тип</th><th>Провинция</th><th>Дворы</th><th>Развитие</th><th>Культура</th><th>Религия</th><th>Смена культуры</th><th>Смена религии</th></tr></thead><tbody>${rows}</table></div></section>` : '<div class="page-empty">В провинциях государства пока нет поселений.</div>';
    activePageOwner = owner;
    showPageView('Города и поселения', content, { subtitle: owner, navId: 'nav-cities' });
    elements.pageView.querySelectorAll('[data-marker-id]').forEach(button => button.addEventListener('click', () => {
        const marker = settlements.find(item => Number(item.id) === Number(button.dataset.markerId));
        if (!marker) return;
        closePageView();
        state.tx = window.innerWidth / 2 - Number(marker.coord_1) * state.scale;
        state.ty = window.innerHeight / 2 - Number(marker.coord_2) * state.scale;
        updateTransform();
        showMarkerPopup(marker);
    }));
}

function formatTurns(turns) { return turns === null ? '—' : `${formatNumber(turns)} ходов`; }

async function renderEconomy(owner, playerName = '') {
    activePageOwner = owner;
    showPageView('Экономика', '<div class="page-loading">Загружаю экономику государства…</div>', { navId: 'nav-economy' });
    try {
        const settings = state.stateMechanics[owner] ?? await fetchStateMechanics(owner) ?? {};
        state.stateMechanics[owner] = settings;
        const economy = settings.economy || {};
        const income = { taxes: 0, trade: 0, other_recurring: 0, other_one_off: 0, ...(economy.income || {}) };
        const expenses = { army: 0, trade: 0, other_recurring: 0, other_one_off: 0, ...(economy.expenses || {}) };
        const treasury = Number(economy.treasury) || 0;
        const prestige = Number(economy.prestige) || 0;
        const itemsFor = (stored, legacyAmount, legacyReason) => Array.isArray(stored) ? stored : (Number(legacyAmount) > 0 ? [{ reason: legacyReason, amount: Number(legacyAmount) }] : []);
        const treasuryIncomeItems = itemsFor(economy.one_off_income_treasury, income.other_one_off, 'Прочие разовые доходы');
        const treasuryItems = itemsFor(economy.one_off_expenses_treasury, expenses.other_one_off, 'Прочие разовые расходы');
        const prestigeIncomeItems = itemsFor(economy.one_off_income_prestige, 0, '');
        const prestigeItems = itemsFor(economy.one_off_expenses_prestige, economy.prestige_one_off_expenses, 'Ранее внесённые разовые расходы');
        const totalOf = items => items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        const treasuryIncome = Number(income.taxes || 0) + Number(income.trade || 0) + Number(income.other_recurring || 0) + totalOf(treasuryIncomeItems);
        const treasuryFixedExpenses = Number(expenses.army || 0) + Number(expenses.trade || 0) + Number(expenses.other_recurring || 0);
        const oneOffTreasuryTotal = totalOf(treasuryItems);
        const oneOffPrestigeTotal = totalOf(prestigeItems);
        const treasuryNext = treasury + treasuryIncome - treasuryFixedExpenses - oneOffTreasuryTotal;
        const prestigeFixed = Number(economy.prestige_recurring_expenses) || 0;
        const prestigeIncome = Number(economy.prestige_recurring_income) || 0;
        const totalPrestigeIncome = prestigeIncome + totalOf(prestigeIncomeItems);
        const prestigeNext = prestige + totalPrestigeIncome - prestigeFixed - oneOffPrestigeTotal;
        const edit = state.userProfile?.role === 'admin' || state.userProfile?.owner === owner;
        const field = (label, value, unit = '') => `<div class="economy-value"><span>${label}</span><strong>${formatNumber(Number(value) || 0, 1)} ${unit}</strong></div>`;
        const balance = (label, current, next, unit) => `<section class="economy-balance"><span>${label}</span><strong>${formatNumber(current, 1)} ${unit}</strong><small>На след. ход: <b>${formatNumber(next, 1)} ${unit}</b></small></section>`;
        const oneOffRows = (kind, items, unit) => items.map(item => `<div class="one-off-row" data-one-off-row data-kind="${kind}"><input aria-label="Источник или причина" type="text" maxlength="120" name="${kind}_reason" placeholder="Источник или причина" value="${escapeHtml(item.reason || '')}" ${edit ? '' : 'readonly'}><label><input aria-label="Сумма" type="number" min="0" step="0.1" name="${kind}_amount" value="${Number(item.amount) || 0}" ${edit ? '' : 'readonly'}>${unit}</label>${edit ? '<button type="button" class="one-off-remove" aria-label="Удалить запись" data-remove-one-off>×</button>' : ''}</div>`).join('');
        const addButton = (kind, label) => edit ? `<button type="button" class="compact-add-btn" data-add-one-off="${kind}" aria-label="Добавить ${label}">+</button>` : '';
        const oneOffPanel = (kind, title, items, unit, label) => `<section class="economy-list one-off-panel page-panel"><header><h2>${title}</h2>${addButton(kind, label)}</header><div data-one-off-list="${kind}">${oneOffRows(kind, items, unit)}</div></section>`;
        const content = `<form id="economy-form"><div class="economy-layout"><div class="economy-ledgers">
          <section class="economy-ledger"><div class="economy-ledger-heading">${balance('Казна', treasury, treasuryNext, 'z')}</div>
            <section class="economy-list page-panel"><h2>Доходы казны</h2>${field('Налоги', income.taxes, 'z')}${field('Торговля', income.trade, 'z')}${field('Прочие постоянные', income.other_recurring, 'z')}</section>
            <section class="economy-list page-panel"><h2>Постоянные расходы казны</h2>${field('Армия', expenses.army, 'z')}${field('Торговля', expenses.trade, 'z')}${field('Прочие расходы', expenses.other_recurring, 'z')}</section>
            ${oneOffPanel('treasury_income', 'Разовые доходы казны', treasuryIncomeItems, 'z', 'доход')}
            ${oneOffPanel('treasury_expense', 'Разовые расходы казны', treasuryItems, 'z', 'расход')}
          </section>
          <section class="economy-ledger"><div class="economy-ledger-heading">${balance('Престиж', prestige, prestigeNext, 'ОП')}</div>
            <section class="economy-list page-panel"><h2>Постоянные доходы престижа</h2>${field('Прочие доходы', prestigeIncome, 'ОП')}</section>
            <section class="economy-list page-panel"><h2>Постоянные расходы престижа</h2>${field('Прочие расходы', prestigeFixed, 'ОП')}</section>
            ${oneOffPanel('prestige_income', 'Разовые доходы престижа', prestigeIncomeItems, 'ОП', 'доход престижа')}
            ${oneOffPanel('prestige_expense', 'Разовые расходы престижа', prestigeItems, 'ОП', 'расход престижа')}
          </section>
        </div><aside class="economy-charts">
          ${renderPieChart('Доходы казны', new Map([['Налоги', Number(income.taxes)], ['Торговля', Number(income.trade)], ['Прочие постоянные', Number(income.other_recurring)], ...treasuryIncomeItems.map(item => [item.reason || 'Разовый доход', Number(item.amount) || 0])]))}
          ${renderPieChart('Расходы казны', new Map([['Армия', Number(expenses.army)], ['Торговля', Number(expenses.trade)], ['Прочие постоянные', Number(expenses.other_recurring)], ...treasuryItems.map(item => [item.reason || 'Разовый расход', Number(item.amount) || 0])]))}
          ${renderPieChart('Доходы престижа', new Map([['Постоянные', prestigeIncome], ...prestigeIncomeItems.map(item => [item.reason || 'Разовый доход', Number(item.amount) || 0])]))}
          ${renderPieChart('Расходы престижа', new Map([['Постоянные', prestigeFixed], ...prestigeItems.map(item => [item.reason || 'Разовый расход', Number(item.amount) || 0])]))}
        </aside></div><div class="mechanics-save-row"><button class="page-map-btn" type="submit" ${edit ? '' : 'disabled'}>Сохранить разовые операции</button><span id="economy-save-status" aria-live="polite"></span></div><p class="page-note">Постоянные показатели и балансы отображаются только для чтения. Суммы следующего хода учитывают доходы и расходы, введённые вручную.</p></form>`;
        showPageView('Экономика', content, { navId: 'nav-economy', subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}` });
        const form = elements.pageView.querySelector('#economy-form');
        form.querySelectorAll('[data-add-one-off]').forEach(button => button.addEventListener('click', () => {
            const kind = button.dataset.addOneOff;
            const unit = kind.startsWith('treasury') ? 'z' : 'ОП';
            const row = document.createElement('div');
            row.className = 'one-off-row';
            row.dataset.oneOffRow = '';
            row.dataset.kind = kind;
            row.innerHTML = `<input aria-label="Источник или причина" type="text" maxlength="120" name="${kind}_reason" placeholder="Источник или причина"><label><input aria-label="Сумма" type="number" min="0" step="0.1" name="${kind}_amount" value="0">${unit}</label><button type="button" class="one-off-remove" aria-label="Удалить запись" data-remove-one-off>×</button>`;
            form.querySelector(`[data-one-off-list="${kind}"]`).append(row);
            row.querySelector('[data-remove-one-off]').addEventListener('click', () => row.remove());
        }));
        form.querySelectorAll('[data-remove-one-off]').forEach(button => button.addEventListener('click', () => button.closest('[data-one-off-row]').remove()));
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const status = form.querySelector('#economy-save-status');
            const invalidOneOff = [...form.querySelectorAll('[data-one-off-row]')].some(row => Number(row.querySelector('input[type="number"]').value) > 0 && !row.querySelector('input[type="text"]').value.trim());
            if (invalidOneOff) { status.textContent = 'Укажите источник или причину каждого расхода.'; return; }
            const collectOneOff = kind => [...form.querySelectorAll(`[data-one-off-row][data-kind="${kind}"]`)].map(row => ({ reason: row.querySelector(`[name="${kind}_reason"]`).value.trim(), amount: Math.max(0, Number(row.querySelector(`[name="${kind}_amount"]`).value) || 0) })).filter(item => item.reason || item.amount > 0);
            const next = { ...settings, economy: { ...economy, income: { ...income, other_one_off: 0 }, expenses: { ...expenses, other_one_off: 0 }, one_off_income_treasury: collectOneOff('treasury_income'), one_off_expenses_treasury: collectOneOff('treasury_expense'), one_off_income_prestige: collectOneOff('prestige_income'), one_off_expenses_prestige: collectOneOff('prestige_expense') } };
            try { state.stateMechanics[owner] = await saveStateMechanics(owner, next); await renderEconomy(owner, playerName); }
            catch (error) { status.textContent = `Ошибка сохранения: ${error.message}`; }
        });
    } catch (error) { showPageView('Экономика', `<div class="page-error">Не удалось загрузить экономику: ${escapeHtml(error.message)}</div>`, { navId: 'nav-economy', subtitle: owner }); }
}

async function ageRulersForNewYear(previousYear, newYear) {
    if (!Number.isFinite(previousYear) || !Number.isFinite(newYear) || newYear <= previousYear) return;
    const profiles = await fetchStateProfiles();
    const owners = [...new Set(profiles.map(profile => String(profile.owner || '').trim()).filter(Boolean))];
    for (const owner of owners) {
        const settings = state.stateMechanics[owner] ?? await fetchStateMechanics(owner) ?? {};
        if (!settings.ruler || !Number.isFinite(Number(settings.ruler.age))) continue;
        const lastAgeYear = Number(settings.ruler.last_age_year ?? previousYear);
        const yearsElapsed = Math.max(0, newYear - Math.max(previousYear, lastAgeYear));
        if (!yearsElapsed) continue;
        const updated = { ...settings, ruler: { ...settings.ruler, age: Math.min(150, Number(settings.ruler.age) + yearsElapsed), last_age_year: newYear } };
        state.stateMechanics[owner] = await saveStateMechanics(owner, updated);
    }
}

function renderUnavailableSection(title, description, navId) {
    showPageView(title, `<section class="page-empty-state"><div class="page-empty-icon">✦</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></section>`, { navId });
}

function getNavigationItems() {
    const isAdmin = state.userProfile?.role === 'admin';
    const isAuth = !!state.currentUser;
    const hasOwner = !!state.userProfile?.owner;
    if (isAdmin) return [{ id: 'nav-map', label: 'Карта' }, { id: 'nav-stats', label: 'Статистика' }, ...(activePageOwner ? [{ id: 'nav-economy', label: 'Экономика' }] : []), { id: 'nav-rules', label: 'Правила и механики' }];
    if (!isAuth || !hasOwner) return [{ id: 'nav-rules', label: 'Правила и механики' }, { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }];
    return [{ id: 'nav-map', label: 'Карта' }, { id: 'nav-stats', label: 'Статистика' }, { id: 'nav-economy', label: 'Экономика' }, { id: 'nav-cities', label: 'Города' }, { id: 'nav-provinces', label: 'Провинции' }, { id: 'nav-military', label: 'Военное дело' }, { id: 'nav-modifiers', label: 'Модификаторы' }, { id: 'nav-rules', label: 'Правила и механики' }, { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }];
}

function activateNavigationItem(id, url) {
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    if (id === 'nav-map') closePageView();
    else if (id === 'nav-stats') state.userProfile?.role === 'admin' ? renderAdminStateList() : state.userProfile?.owner && renderStateStatistics(state.userProfile.owner, state.userProfile.nickname || '');
    else if (id === 'nav-economy') activePageOwner && renderEconomy(activePageOwner, state.userProfile?.nickname || '');
    else if (id === 'nav-provinces') state.userProfile?.owner && renderOwnerProvinces(state.userProfile.owner);
    else if (id === 'nav-cities') state.userProfile?.owner && renderOwnerSettlements(state.userProfile.owner);
    else if (id === 'nav-military') renderUnavailableSection('Военное дело', 'Здесь появятся состав и численность армии, воеводы, приказы и состояние военных кампаний.', id);
    else if (id === 'nav-modifiers') renderUnavailableSection('Модификаторы', 'Здесь появятся активные эффекты, срок их действия и влияние на показатели государства.', id);
    else if (id === 'nav-rules') renderUnavailableSection('Правила и механики', 'Раздел откроется здесь после публикации отдельной вики-страницы проекта.', id);
}

export function renderNavMenu() {
    if (!elements.navDropdownMenu) return;

    const items = getNavigationItems();

    elements.navDropdownMenu.innerHTML = items.map(item => `
        <button class="nav-menu-item" data-id="${item.id}" ${item.externalUrl ? `data-url="${item.externalUrl}"` : ''}>
            ${item.label}
        </button>
    `).join('');

    elements.navDropdownMenu.querySelectorAll('.nav-menu-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            activateNavigationItem(e.currentTarget.dataset.id, e.currentTarget.dataset.url);
            elements.navDropdownMenu.classList.remove('active');
        });
    });
}

export function updateAuthUI() {
    if (state.currentUser) {
        const nickname = state.userProfile?.nickname || state.currentUser.email;
        elements.openLoginBtn.textContent = `${nickname} (Выход)`;
    } else {
        elements.openLoginBtn.textContent = 'Вход';
    }

    if (state.userProfile?.role === 'admin') {
        elements.adminControls.style.display = 'flex';
        if (elements.advanceTurnBtn) elements.advanceTurnBtn.style.display = 'inline-flex';
    } else {
        elements.adminControls.style.display = 'none';
        if (elements.advanceTurnBtn) elements.advanceTurnBtn.style.display = 'none';
    }

    renderNavMenu();
}

export function initEventListeners() {
    if (window.innerWidth <= 768) {
        elements.legendPanel?.classList.add('collapsed');
        elements.controlsPanel?.classList.add('collapsed');
        if (elements.legendToggleBtn) elements.legendToggleBtn.textContent = '+';
        if (elements.controlsToggleBtn) elements.controlsToggleBtn.textContent = '+';
    }

    elements.legendToggleBtn?.addEventListener('click', () => {
        const isCollapsed = elements.legendPanel.classList.toggle('collapsed');
        elements.legendToggleBtn.textContent = isCollapsed ? '+' : '−';
    });

    elements.advanceTurnBtn?.addEventListener('click', async () => {
        if (state.userProfile?.role !== 'admin') return;
        const button = elements.advanceTurnBtn;
        button.disabled = true;
        try {
            const previousYear = Number(state.gameCalendar?.year);
            state.gameCalendar = await advanceGameTurn();
            if (Number(state.gameCalendar?.year) > previousYear) await ageRulersForNewYear(previousYear, Number(state.gameCalendar.year));
            renderGameCalendar();
            showToast('Наступил новый ход');
        } catch (error) {
            showToast(`Не удалось сменить ход: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });

    elements.controlsToggleBtn?.addEventListener('click', () => {
        const isCollapsed = elements.controlsPanel.classList.toggle('collapsed');
        elements.controlsToggleBtn.textContent = isCollapsed ? '+' : '−';
    });

    elements.openLoginBtn?.addEventListener('click', async () => {
        if (state.currentUser) {
            await signOutUser();
            showToast('Вы вышли из системы');
        } else {
            elements.loginModal?.classList.add('active');
        }
    });

    elements.loginModalClose?.addEventListener('click', () => {
        elements.loginModal?.classList.remove('active');
    });

    elements.loginModal?.addEventListener('click', (e) => {
        if (e.target === elements.loginModal) {
            elements.loginModal.classList.remove('active');
        }
    });

    elements.authLoginBtn?.addEventListener('click', async () => {
        const email = elements.authEmailInput.value.trim();
        const password = elements.authPasswordInput.value;

        if (!email || !password) {
            showToast('Заполните все поля');
            return;
        }

        try {
            elements.authLoginBtn.textContent = 'Вход...';
            await signInUser(email, password);
            elements.loginModal?.classList.remove('active');
            elements.authEmailInput.value = '';
            elements.authPasswordInput.value = '';
            showToast('Вы успешно вошли');
        } catch (err) {
            showToast('Ошибка входа: ' + err.message);
        } finally {
            elements.authLoginBtn.textContent = 'Вход';
        }
    });

    elements.openRegisterBtn?.addEventListener('click', () => {
        elements.loginModal?.classList.remove('active');
        elements.registerModal?.classList.add('active');
    });

    elements.registerModalClose?.addEventListener('click', () => {
        elements.registerModal?.classList.remove('active');
    });

    elements.registerModal?.addEventListener('click', (e) => {
        if (e.target === elements.registerModal) {
            elements.registerModal.classList.remove('active');
        }
    });

    elements.regSubmitBtn?.addEventListener('click', async () => {
        const nickname = elements.regNicknameInput.value.trim();
        const email = elements.regEmailInput.value.trim();
        const password = elements.regPasswordInput.value;
        const confirmPass = elements.regPasswordConfirmInput.value;

        if (!nickname || !email || !password) {
            showToast('Заполните все обязательные поля');
            return;
        }

        if (password !== confirmPass) {
            showToast('Пароли не совпадают');
            return;
        }

        try {
            elements.regSubmitBtn.textContent = 'Регистрация...';
            await signUpUser(email, password, nickname);
            showToast('Регистрация успешна!');
            elements.registerModal?.classList.remove('active');
            elements.regNicknameInput.value = '';
            elements.regEmailInput.value = '';
            elements.regPasswordInput.value = '';
            elements.regPasswordConfirmInput.value = '';
        } catch (err) {
            showToast('Ошибка регистрации: ' + err.message);
        } finally {
            elements.regSubmitBtn.textContent = 'Зарегистрироваться';
        }
    });

    elements.addMarkerModeBtn?.addEventListener('click', () => {
        state.isAddingMarkerMode = !state.isAddingMarkerMode;
        elements.addMarkerModeBtn.classList.toggle('active', state.isAddingMarkerMode);
        if (state.isAddingMarkerMode) {
            showToast('Кликните по карте в месте создания нового маркера', 0);
        } else {
            hideToast();
        }
    });

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

    elements.toggleMarkerNamesBtn?.addEventListener('click', () => {
        state.showMarkerNames = !state.showMarkerNames;
        elements.toggleMarkerNamesBtn.classList.toggle('active', state.showMarkerNames);
        renderMarkers();
    });

    elements.trackerBtn?.addEventListener('click', () => {
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

    elements.viewport?.addEventListener('wheel', (e) => {
        if (elements.pageView?.classList.contains('active')) return;
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

    elements.viewport?.addEventListener('mousedown', (e) => {
        if (elements.pageView?.classList.contains('active')) return;
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#left-sidebar') || e.target.closest('#login-modal') || e.target.closest('#register-modal')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        if (state.movingMarkerId !== null) {
            const movingMarker = state.dbMarkers.find(m => m.id === state.movingMarkerId);
            if (movingMarker) {
                const img = markerImages[movingMarker.type];
                const w = img?.naturalWidth || 24;
                const h = img?.naturalHeight || 24;
                if (imgX >= movingMarker.coord_1 - w / 2 && imgX <= movingMarker.coord_1 + w / 2 &&
                    imgY >= movingMarker.coord_2 - h / 2 && imgY <= movingMarker.coord_2 + h / 2) {
                    state.isDraggingMarker = true;
                    return;
                }
            }
        }

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
        if (!elements.viewport || elements.pageView?.classList.contains('active')) return;
        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const imgX = Math.round((mouseX - state.tx) / state.scale);
        const imgY = Math.round((mouseY - state.ty) / state.scale);

        if (state.isDraggingMarker && state.movingMarkerId !== null) {
            const idx = state.dbMarkers.findIndex(m => m.id === state.movingMarkerId);
            if (idx !== -1) {
                state.dbMarkers[idx].coord_1 = imgX;
                state.dbMarkers[idx].coord_2 = imgY;
                renderMarkers();
            }
            return;
        }

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

    window.addEventListener('mouseup', async () => {
        if (state.isDraggingMarker && state.movingMarkerId !== null) {
            state.isDraggingMarker = false;
            const movingMarker = state.dbMarkers.find(m => m.id === state.movingMarkerId);
            if (movingMarker) {
                try {
                    await updateMarkerData(movingMarker.id, {
                        coord_1: movingMarker.coord_1,
                        coord_2: movingMarker.coord_2
                    });
                    showToast('Новое положение поселения сохранено');
                } catch (err) {
                    showToast('Ошибка сохранения позиции: ' + err.message);
                }
            }
            state.movingMarkerId = null;
        }

        state.isDragging = false;
        state.isDraggingTracker = false;
    });

    elements.viewport?.addEventListener('click', async (e) => {
        if (elements.pageView?.classList.contains('active')) return;
        if (state.dragDistance > 5) return;
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#left-sidebar') || e.target.closest('#login-modal') || e.target.closest('#register-modal')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        if (state.isAddingMarkerMode) {
            hideToast();
            showNewMarkerPopup(imgX, imgY);
            return;
        }

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

    elements.popupClose?.addEventListener('click', clearSelection);

    elements.searchBtn?.addEventListener('click', () => {
        const id = parseInt(elements.searchInput.value, 10);
        if (!isNaN(id)) {
            goToProvince(id);
        }
    });

    elements.searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const id = parseInt(elements.searchInput.value, 10);
            if (!isNaN(id)) {
                goToProvince(id);
            }
        }
    });

    elements.toggleIdsBtn?.addEventListener('click', () => {
        state.showIDs = !state.showIDs;
        elements.toggleIdsBtn.classList.toggle('active', state.showIDs);
        renderIDs();
    });

    elements.burgerMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        renderNavMenu();
        elements.navDropdownMenu?.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (elements.navDropdownMenu && !elements.navDropdownMenu.contains(e.target) && e.target !== elements.burgerMenuBtn && !elements.burgerMenuBtn.contains(e.target)) {
            elements.navDropdownMenu.classList.remove('active');
        }
    });
}
