import { state, elements, markerImages, MARKER_TYPES } from './config.js';
import { renderActiveLayer, renderMarkers, renderTradeRoutes, highlightProvince, renderIDs } from './render.js';
import { signUpUser, signInUser, signOutUser, updateProvinceData, createMarkerData, updateMarkerData, deleteMarkerData, fetchStateProfiles, fetchStateMechanics, saveStateMechanics, fetchEconomySnapshot, applyEconomyTurn, saveProductionDirective, saveMarkerTransportRoute, saveStateTradeContract, saveStateTradeContractRoute, saveStateTradeTransitPolicy, uploadStateSymbol, deleteStateSymbol, loadSupabaseData } from './api.js';
import { GOODS, RESOURCES, annualPopulationGrowthRate, processTurnSimulation } from './economyEngine.js';

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
    if (!name || name === '—' || !settings?.[`titular_${kind}`] || name === settings[`titular_${kind}`]) return null;
    const stored = Number(record?.[`${kind}_assimilation_turns`]);
    if (stored > 0) return stored;
    return statusDefaultTurns[getStatus(settings, kind, name)] || 30;
}

function assimilationLine(record, kind, name, settings) {
    const turns = assimilationTurns(record, kind, name, settings);
    if (turns === null) return '';
    const status = statusLabels[getStatus(settings, kind, name)] || statusLabels.noninterference;
    return `<br>Ассимиляция ${kind === 'culture' ? 'культуры' : 'религии'} (${status}): ${formatNumber(turns)} ходов`;
}

function provinceProductionSummary(province) {
    const lastReport = state.economySnapshot?.reports?.find(row => row.owner === province.owner)?.report;
    const production = lastReport?.provinceReports?.[province.id];
    const target = state.dbMarkers.find(marker => Number(marker.id) === Number(province.target_marker_id));
    const deliveryText = production?.deliveries?.map(item => {
        const marker = state.dbMarkers.find(row => Number(row.id) === Number(item.marker_id));
        return `${item.item_name ? `${escapeHtml(item.item_name)} → ` : ''}${escapeHtml(marker?.name || 'Поселение')}: ${formatNumber(item.quantity, 2)}`;
    }).join(', ');
    const foodText = production?.food_resource ? `<br>${production.food_resource === production.resource ? 'В том числе продовольствие крестьянства' : 'Базовое продовольствие крестьянства'}: ${escapeHtml(production.food_resource)} · ${formatNumber(production.food_production, 2)} за ход` : '';
    const amountText = production ? `Последнее производство ресурса (${escapeHtml(production.resource || province.resource || '—')}): ${formatNumber(production.production, 2)} за ход${foodText}` : 'Производство появится в отчёте после расчёта хода';
    const targetText = target ? `Основной склад: ${target.name || 'Поселение'}` : 'Основной склад не назначен';
    return `<div class="popup-economy-info"><strong>Производство и продовольствие</strong><br>${amountText}<br>${targetText}${deliveryText ? `<br>Поставки: ${deliveryText}` : ''}<br>Остаток в провинции: ${formatNumber(province.stored_resource_qty, 2)}</div>`;
}

function markerEconomySummary(marker) {
    const snapshot = state.economySnapshot;
    const items = snapshot?.inventories?.filter(item => Number(item.marker_id) === Number(marker.id) && Number(item.quantity) > 0) || [];
    const report = snapshot?.reports?.find(row => row.owner === marker.owner)?.report?.markerReports?.[marker.id];
    const goods = Object.entries(report?.goods_produced || {}).map(([name, quantity]) => `${escapeHtml(name)}: ${formatNumber(quantity, 2)}`).join('<br>') || 'Нет данных за последний ход';
    const stocks = items.map(item => `${escapeHtml(item.item_name)}: ${formatNumber(item.quantity, 2)} ${item.item_type === 'good' ? 'тов.' : 'рес.'}`).join('<br>') || 'Склад пуст';
    const coverage = (report?.coverage || []).filter(row => Number(row.demand) > 0).map(row => `${escapeHtml(row.need)} — ${formatNumber(Number(row.ratio) * 100, 0)}%`).join('<br>') || 'Нет данных о потреблении';
    return `<div class="popup-economy-info"><strong>Экономика поселения</strong><br>Товары за последний ход:<br>${goods}<details><summary>Склад (${items.length} поз.)</summary>${stocks}</details><details><summary>Покрытие потребностей</summary>${coverage}</details></div>`;
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
                ${provinceProductionSummary(dbRow)}
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
            ${provinceProductionSummary(dbRow)}
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
    const markerMechanics = state.stateMechanics[marker.owner] || {};
    const markerCultureTurns = assimilationTurns(marker, 'culture', marker.culture, markerMechanics);
    const markerReligionTurns = assimilationTurns(marker, 'religion', marker.religion, markerMechanics);
    const markerAssimilationInputs = marker.type === 'ruins' ? '' : `${markerCultureTurns === null ? '' : `<label>До смены культуры, ходов:<input type="number" min="1" id="admin-marker-culture-turns" value="${markerCultureTurns}"></label>`}${markerReligionTurns === null ? '' : `<label>До смены религии, ходов:<input type="number" min="1" id="admin-marker-religion-turns" value="${markerReligionTurns}"></label>`}`;
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
                ${markerAssimilationInputs}
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
            ${markerEconomySummary(marker)}
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
            const cultureTurnsInput = document.getElementById('admin-marker-culture-turns');
            const religionTurnsInput = document.getElementById('admin-marker-religion-turns');
            if (markerType === 'ruins' || (updatedFields.culture && updatedFields.culture === markerMechanics.titular_culture)) updatedFields.culture_assimilation_turns = null;
            else if (cultureTurnsInput) updatedFields.culture_assimilation_turns = Math.max(1, parseInt(cultureTurnsInput.value, 10) || markerCultureTurns);
            if (markerType === 'ruins' || (updatedFields.religion && updatedFields.religion === markerMechanics.titular_religion)) updatedFields.religion_assimilation_turns = null;
            else if (religionTurnsInput) updatedFields.religion_assimilation_turns = Math.max(1, parseInt(religionTurnsInput.value, 10) || markerReligionTurns);
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
            ${markerEconomySummary(marker)}
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
        const loyalty = Number(settings?.[`${kind}_loyalty`]?.[name] ?? 50);
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
        const gameYear = Number(state.gameCalendar?.year) || 1450;
        const estateTaxLocked = !isAdmin && Number(settings.tax_rates_last_changed_year) === gameYear;
        const estateRows = estateNames.map(([key, label]) => {
            const yards = stats.estateYards[key];
            const loyalty = Number(settings.estate_loyalty?.[key] ?? 50);
            const rate = Number(settings.tax_rates?.[key] ?? { aristocracy: 10, clergy: 1, burghers: 2, peasants: 1 }[key]);
            const loyaltyCell = isAdmin ? `<input class="stat-loyalty-input" type="number" min="0" max="100" step="1" data-loyalty-kind="estate" data-loyalty-name="${key}" value="${loyalty}"> %` : `${loyalty}%`;
            return `<tr><td>${label}</td><td><input class="stat-tax-input" name="tax_${key}" type="number" min="0" step="0.1" value="${rate}" ${estateTaxLocked ? 'readonly title="Ставки уже менялись в этом игровом году"' : ''}> z/двор</td><td>${formatNumber(yards)} дв.</td><td>${formatNumber(yards * 4)} чел.</td><td>${loyaltyCell}</td></tr>`;
        }).join('');
        const culturePie = new Map([...stats.cultureGroups].map(([name, group]) => [name, group.population]));
        const religionPie = new Map([...stats.religionGroups].map(([name, group]) => [name, group.population]));
        const titleOptions = (groups, selected) => `<option value="">— не выбрана —</option>${[...groups.keys()].sort((a,b) => a.localeCompare(b, 'ru')).map(name => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
        const adminTitles = isAdmin ? `<div class="stat-titular-settings"><label>Титульная культура<select name="titular_culture">${titleOptions(stats.cultureGroups, titularCulture)}</select></label><label>Титульная религия<select name="titular_religion">${titleOptions(stats.religionGroups, titularReligion)}</select></label></div>` : '';
        const governmentForm = settings.government_form || '';
        const governmentField = isAdmin ? `<label class="government-form-field"><span>Форма правления</span><select name="government_form"><option value="">— не выбрана —</option>${governmentForms.map(form => `<option value="${escapeHtml(form)}" ${form === governmentForm ? 'selected' : ''}>${escapeHtml(form)}</option>`).join('')}</select></label>` : `<span class="government-form-readonly"><span>Форма правления</span><strong>${escapeHtml(governmentForm || 'не указана')}</strong></span>`;
        const stateIdentity = `<section class="page-panel state-identity-panel"><div class="state-identity-symbol"><div class="symbol-frame">${settings.state_symbol_url ? `<img class="state-symbol-preview" src="${escapeHtml(settings.state_symbol_url)}" alt="Символика государства">` : '<div class="state-symbol-empty">Изображение не загружено</div>'}<button class="symbol-edit-btn" type="button" aria-label="Редактировать символику" title="Редактировать символику">✎</button></div><dialog id="state-symbol-dialog" class="state-symbol-dialog"><div class="symbol-dialog-heading"><h2>Символика государства</h2><button type="button" class="symbol-dialog-close" aria-label="Закрыть">×</button></div><p>Загрузите флаг или герб в формате PNG, JPEG или WebP. Максимальный размер — 2 МБ.</p><label class="symbol-upload-label">Выбрать изображение<input id="state-symbol-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${settings.state_symbol_path ? '<button id="state-symbol-remove" class="page-back-btn" type="button">Удалить изображение</button>' : ''}<span id="state-symbol-status" aria-live="polite"></span></dialog></div><div class="state-identity-details"><h2>${escapeHtml(owner)}</h2><div class="state-identity-titles"><span><span>Титульная культура</span><strong>${escapeHtml(titularCulture || 'не указана')}</strong></span><span><span>Титульная религия</span><strong>${escapeHtml(titularReligion || 'не указана')}</strong></span>${governmentField}</div></div></section>`;
        const ruler = settings.ruler || {};
        const rulerFields = `<section class="page-panel ruler-panel"><div class="page-panel-heading"><div><h2>Правитель</h2><p>Возраст увеличивается при переходе к новому игровому году.</p></div></div><div class="ruler-fields"><label>Имя<input name="ruler_name" maxlength="80" value="${escapeHtml(ruler.name || '')}" ${isAdmin ? 'readonly' : ''}></label><label>Титул<input name="ruler_title" maxlength="80" value="${escapeHtml(ruler.title || '')}" ${isAdmin ? 'readonly' : ''}></label><label>Возраст<input name="ruler_age" type="number" min="0" max="150" value="${Number(ruler.age) || 0}" ${isAdmin ? 'readonly' : ''}></label></div></section>`;
        const crime = Number(settings.crime_rate ?? 20);
        const corruption = Number(settings.corruption_rate ?? 20);
        const socialSection = (title, rows, key) => `<div class="statistic-pair"><section class="page-panel"><div class="page-panel-heading"><div><h2>${title}</h2>${key === 'estate' ? `<p>${estateTaxLocked ? 'Ставки уже менялись в этом игровом году.' : 'Игрок может менять ставки раз в игровой год; смена каждой ставки стоит 3 ОП.'}${isAdmin ? ' Администратор может менять их без ограничений и расходов.' : ''}</p>` : ''}</div></div><div class="page-table-wrap"><table class="page-table"><thead><tr><th>${key === 'estate' ? 'Сословие' : key === 'culture' ? 'Культура' : 'Религия'}</th>${key === 'estate' ? '<th>Налоговая ставка</th>' : '<th>Статус</th>'}<th>Дворы</th><th>Население</th><th>Лояльность</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Нет данных.</td></tr>`}</tbody></table></div></section>${renderPieChart(`Население по ${key === 'estate' ? 'сословиям' : key === 'culture' ? 'культурам' : 'религиям'}`, key === 'estate' ? Object.entries(stats.estateYards).map(([estate, yards]) => [estateNames.find(([id]) => id === estate)[1], yards * 4]) : key === 'culture' ? culturePie : religionPie)}</div>`;
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
            const changedTaxRates = estateNames.filter(([key]) => proposedTaxRates[key] !== Number(settings.tax_rates?.[key] ?? defaultTaxRates[key]));
            const taxChanged = changedTaxRates.length > 0;
            if (taxChanged && !isAdmin && Number(settings.tax_rates_last_changed_year) === gameYear) {
                status.textContent = 'Налоговые ставки можно менять один раз за игровой год.';
                return;
            }
            const estateTaxCost = isAdmin ? 0 : changedTaxRates.length * 3;
            const availablePrestige = Math.max(0, Number(settings.economy?.prestige) || 0);
            if (availablePrestige < estateTaxCost) {
                status.textContent = `Недостаточно престижа: нужно ${estateTaxCost} ОП, доступно ${availablePrestige} ОП.`;
                return;
            }
            Object.assign(next.tax_rates, proposedTaxRates);
            if (taxChanged && !isAdmin) next.tax_rates_last_changed_year = gameYear;
            if (estateTaxCost > 0) next.economy = { ...(settings.economy || {}), prestige: availablePrestige - estateTaxCost };
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
        const symbolDialog = elements.pageView.querySelector('#state-symbol-dialog');
        elements.pageView.querySelector('.symbol-edit-btn')?.addEventListener('click', () => symbolDialog?.showModal());
        elements.pageView.querySelector('.symbol-dialog-close')?.addEventListener('click', () => symbolDialog?.close());
        symbolDialog?.addEventListener('click', event => { if (event.target === symbolDialog) symbolDialog.close(); });
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

async function renderOwnerProvinces(owner) {
    let provinceReports = {};
    let growthRate = 0;
    try {
        const snapshot = state.economySnapshot || await fetchEconomySnapshot();
        state.economySnapshot = snapshot;
        provinceReports = simulateEconomySnapshot(snapshot).ownerReports[owner]?.provinceReports || {};
        const settings = state.stateMechanics[owner] || snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        growthRate = annualPopulationGrowthRate(snapshot.reports.filter(row => row.owner === owner), settings);
    } catch (error) {
        console.warn('Не удалось рассчитать производство провинций', error);
    }
    const provinces = Object.values(state.dbProvinces)
        .filter(province => province.owner === owner)
        .sort((a, b) => Number(a.id) - Number(b.id));
    const rows = provinces.map(province => `
        <tr><td><button class="table-link" data-province-id="${Number(province.id)}">#${formatNumber(Number(province.id))}</button></td>
        <td>${escapeHtml(province.province_name || '—')}</td><td>${escapeHtml(province.region || '—')}</td>
        <td>${formatNumber(Number(province.yards) || 0)}</td><td>+${formatNumber(Math.round((Number(province.yards) || 0) * growthRate))}</td><td>${formatNumber(Number(province.development ?? 20))}</td><td>${escapeHtml(province.main_culture || '—')}</td>
        <td>${escapeHtml(province.main_religion || '—')}</td><td>${formatTurns(assimilationTurns(province, 'culture', province.main_culture, state.stateMechanics[owner] || {}))}</td><td>${formatTurns(assimilationTurns(province, 'religion', province.main_religion, state.stateMechanics[owner] || {}))}</td><td>${escapeHtml(province.resource || '—')}</td><td>${(() => { const report = provinceReports[province.id] || {}; const main = `${formatNumber(Number(report.production) || 0, 2)} ${escapeHtml(report.resource || province.resource || '')}`; return report.food_resource && report.food_resource !== (report.resource || province.resource) ? `${main}<br>${formatNumber(Number(report.food_production) || 0, 2)} ${escapeHtml(report.food_resource)}` : main; })()}</td><td>${formatNumber(Number(provinceReports[province.id]?.tax_income) || 0, 2)} z</td></tr>
    `).join('');
    const content = provinces.length ? `<section class="page-panel dense-table"><div class="page-table-wrap"><table class="page-table"><thead><tr><th>ID</th><th>Провинция</th><th>Регион</th><th>Дворы</th><th>Ожидаемый прирост/год</th><th>Развитие</th><th>Культура</th><th>Религия</th><th>Смена культуры</th><th>Смена религии</th><th>Ресурс</th><th>Производство/ход</th><th>Налоги/ход</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '<div class="page-empty">За государством пока не закреплены провинции.</div>';
    activePageOwner = owner;
    showPageView('Провинции', content, { subtitle: owner, navId: 'nav-provinces' });
    elements.pageView.querySelectorAll('[data-province-id]').forEach(button => button.addEventListener('click', () => {
        closePageView();
        goToProvince(Number(button.dataset.provinceId));
    }));
}

async function renderOwnerSettlements(owner) {
    let markerReports = {};
    let growthRate = 0;
    try {
        const snapshot = state.economySnapshot || await fetchEconomySnapshot();
        state.economySnapshot = snapshot;
        markerReports = simulateEconomySnapshot(snapshot).ownerReports[owner]?.markerReports || {};
        const settings = state.stateMechanics[owner] || snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        growthRate = annualPopulationGrowthRate(snapshot.reports.filter(row => row.owner === owner), settings);
    } catch (error) {
        console.warn('Не удалось рассчитать прогноз поселений', error);
    }
    const provinces = Object.values(state.dbProvinces).filter(province => province.owner === owner);
    const provinceIds = new Set(provinces.map(province => Number(province.id)));
    const settlements = state.dbMarkers.filter(marker => provinceIds.has(Number(marker.province_id)));
    const rows = settlements.map(marker => `
        <tr><td><button class="table-link" data-marker-id="${Number(marker.id)}">${escapeHtml(marker.name || 'Поселение')}</button></td>
        <td>${escapeHtml(markerTypeLabels[marker.type] || marker.type || '—')}</td><td>#${formatNumber(Number(marker.province_id) || 0)}</td>
        <td>${formatNumber(Number(marker.yards) || 0)}</td><td>+${formatNumber(Math.round((Number(marker.yards) || 0) * growthRate))}</td><td>${formatNumber(Number(marker.development ?? markerTypeDevelopment[marker.type] ?? 0))}</td><td>${escapeHtml(marker.culture || '—')}</td>
        <td>${escapeHtml(marker.religion || '—')}</td><td>${formatTurns(assimilationTurns(marker, 'culture', marker.culture, state.stateMechanics[owner] || {}))}</td><td>${formatTurns(assimilationTurns(marker, 'religion', marker.religion, state.stateMechanics[owner] || {}))}</td><td>${formatNumber(Number(markerReports[marker.id]?.tax_income) || 0, 2)} z</td></tr>
    `).join('');
    const content = settlements.length ? `<section class="page-panel dense-table"><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Поселение</th><th>Тип</th><th>Провинция</th><th>Дворы</th><th>Ожидаемый прирост/год</th><th>Развитие</th><th>Культура</th><th>Религия</th><th>Смена культуры</th><th>Смена религии</th><th>Налоги/ход</th></tr></thead><tbody>${rows}</table></div></section>` : '<div class="page-empty">В провинциях государства пока нет поселений.</div>';
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

function simulateEconomySnapshot(snapshot) {
    const provinces = JSON.parse(JSON.stringify(snapshot.provinces));
    const markers = JSON.parse(JSON.stringify(snapshot.markers));
    const mechanics = Object.fromEntries(snapshot.mechanics.map(row => [row.owner, JSON.parse(JSON.stringify(row.settings || {}))]));
    const estateRatios = Object.fromEntries(snapshot.estateRatios.map(row => [row.settlement_type, row]));
    const result = processTurnSimulation({
        calendar: snapshot.calendar,
        provinces,
        markers,
        mechanics,
        inventories: snapshot.inventories,
        consumptionRates: snapshot.consumptionRates,
        estateRatios,
        adjacency: state.provinceAdjacency,
        provinceCentroids: state.provinceCentroids,
        riverComponents: state.riverComponents,
        lakeComponents: state.lakeComponents,
        seaComponents: state.seaComponents,
        transportRoutes: snapshot.transportRoutes,
        tradeContracts: snapshot.tradeContracts || [],
        tradeTransitRules: snapshot.tradeTransitRules || []
    });
    const ownerReports = Object.fromEntries(Object.entries(result.ownerReports).map(([owner, report]) => [owner, {
        processed_calendar: report.processed_calendar,
        next_calendar: report.next_calendar,
        production: report.production,
        consumption: report.consumption,
        shortages: report.shortages,
        transport: report.transport,
        external_trade: report.external_trade,
        free_surplus: report.free_surplus,
        needs_coverage: report.needs_coverage,
        state_effects: report.state_effects,
        markerReports: report.markerReports,
        provinceReports: report.provinceReports
    }]));
    return {
        ...result,
        territoryLoyaltyUpdates: [],
        stateLoyaltyUpdates: result.stateLoyaltyUpdates,
        treasuryAdjustments: result.treasuryAdjustments,
        ownerReports
    };
}

export function refreshTradeRouteOverlay() {
    const snapshot = state.economySnapshot;
    if (!snapshot || !state.provinceAdjacency.size) { state.tradeRouteOverlay = []; renderTradeRoutes([]); return; }
    try {
        state.tradeRouteOverlay = processTurnSimulation({
        calendar: snapshot.calendar,
        provinces: JSON.parse(JSON.stringify(snapshot.provinces)),
        markers: JSON.parse(JSON.stringify(snapshot.markers)),
        mechanics: Object.fromEntries(snapshot.mechanics.map(row => [row.owner, JSON.parse(JSON.stringify(row.settings || {}))])),
        inventories: snapshot.inventories,
        consumptionRates: snapshot.consumptionRates,
        estateRatios: Object.fromEntries(snapshot.estateRatios.map(row => [row.settlement_type, row])),
        adjacency: state.provinceAdjacency,
        provinceCentroids: state.provinceCentroids,
        riverComponents: state.riverComponents,
        lakeComponents: state.lakeComponents,
        seaComponents: state.seaComponents,
        transportRoutes: snapshot.transportRoutes,
        tradeContracts: snapshot.tradeContracts || [],
        tradeTransitRules: snapshot.tradeTransitRules || []
        }).externalTradeReports;
        renderTradeRoutes(state.tradeRouteOverlay);
    }
    catch (error) { console.warn('Не удалось построить торговые маршруты на карте', error); state.tradeRouteOverlay = []; renderTradeRoutes([]); }
}

function syncTradeRouteEditor() {
    const draft = state.tradeRouteDraft;
    if (!draft || !elements.tradeRouteEditor) return;
    const names = draft.path.map(id => state.dbProvinces[id]?.province_name || `Провинция #${id}`);
    const complete = draft.path.at(-1) === draft.destinationProvinceId;
    const destinationName = state.dbProvinces[draft.destinationProvinceId]?.province_name || `Провинция #${draft.destinationProvinceId}`;
    elements.tradeRouteEditorStatus.textContent = complete
        ? `Маршрут готов: ${names.join(' → ')}. Проверь его на карте и сохрани.`
        : `Выбери соседнюю провинцию. Путь: ${names.join(' → ')} → ${destinationName}.`;
    elements.tradeRouteUndoBtn.disabled = draft.path.length <= 1;
    elements.tradeRouteSaveBtn.disabled = !complete;
    renderTradeRoutes(state.tradeRouteOverlay || []);
}

function startTradeRouteSelection(contract, owner, playerName) {
    const source = state.dbMarkers.find(marker => Number(marker.id) === Number(contract.source_marker_id));
    const destination = state.dbMarkers.find(marker => Number(marker.id) === Number(contract.destination_marker_id));
    if (!source || !destination) { showToast('Не удалось определить поселения договора'); return; }
    const sourceProvinceId = Number(source.province_id), destinationProvinceId = Number(destination.province_id);
    state.tradeRouteDraft = {
        contractId: Number(contract.id), owner, playerName, sourceProvinceId, destinationProvinceId,
        path: [sourceProvinceId],
        source_name: source.name || `Поселение #${source.id}`,
        destination_name: destination.name || `Поселение #${destination.id}`,
        sourcePoint: { x: Number(source.coord_1), y: Number(source.coord_2) },
        destinationPoint: { x: Number(destination.coord_1), y: Number(destination.coord_2) }
    };
    state.showTradeRoutes = true;
    elements.tradeRoutesToggleBtn?.classList.add('active');
    if (elements.tradeRoutesToggleBtn) elements.tradeRoutesToggleBtn.textContent = 'Торговые маршруты: показаны';
    closePageView();
    elements.tradeRouteEditor.hidden = false;
    syncTradeRouteEditor();
    showToast('Прокладывай путь по соседним провинциям от города продавца до города покупателя', 5000);
}

function addTradeRouteProvince(provinceId) {
    const draft = state.tradeRouteDraft;
    if (!draft) return;
    const previous = draft.path.at(-1);
    if (provinceId === previous) return;
    if (draft.path.at(-1) === draft.destinationProvinceId) { showToast('Маршрут уже доведён до города-получателя'); return; }
    if (draft.path.includes(provinceId)) { showToast('Нельзя повторно включить провинцию в маршрут'); return; }
    if (!(state.provinceAdjacency.get(previous) || new Set()).has(provinceId)) {
        showToast('Следующая провинция должна граничить с предыдущей');
        return;
    }
    if (draft.path.length >= 200) { showToast('Маршрут достиг ограничения в 200 провинций'); return; }
    draft.path.push(provinceId);
    syncTradeRouteEditor();
}

function cancelTradeRouteSelection() {
    state.tradeRouteDraft = null;
    if (elements.tradeRouteEditor) elements.tradeRouteEditor.hidden = true;
    refreshTradeRouteOverlay();
}

function productionReportTable(title, columns, rows, emptyText, panelClass = '') {
    const body = rows.length
        ? rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="table-empty">${escapeHtml(emptyText)}</td></tr>`;
    return `<section class="page-panel dense-table ${panelClass}"><div class="page-panel-heading"><h2>${escapeHtml(title)}</h2></div><div class="page-table-wrap"><table class="page-table"><thead><tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

async function renderProductionConsumption(owner, tab = 'production', playerName = '') {
    activePageOwner = owner;
    const pageTitle = tab === 'trade' ? 'Торговля' : 'Производство и потребление';
    const pageNavId = tab === 'trade' ? 'nav-trade' : 'nav-production';
    showPageView(pageTitle, '<div class="page-loading">Загружаю торговые и производственные данные государства…</div>', { navId: pageNavId });
    try {
        const snapshot = await fetchEconomySnapshot();
        state.economySnapshot = snapshot;
        refreshTradeRouteOverlay();
        const preview = simulateEconomySnapshot(snapshot);
        const actualRow = snapshot.reports.find(row => row.owner === owner);
        const report = actualRow?.report || preview.ownerReports[owner] || { production: {}, consumption: {}, shortages: {}, markerReports: {}, provinceReports: {} };
        const isPreview = !actualRow;
        const markersById = new Map(snapshot.markers.map(row => [Number(row.id), row]));
        const ownerProvinces = snapshot.provinces.filter(row => row.owner === owner);
        const ownerMarkers = snapshot.markers.filter(row => row.owner === owner && row.type !== 'ruins');
        const inventoryByMarker = new Map();
        for (const item of snapshot.inventories) {
            const key = Number(item.marker_id);
            if (!inventoryByMarker.has(key)) inventoryByMarker.set(key, []);
            inventoryByMarker.get(key).push(item);
        }
        const number = value => formatNumber(Number(value) || 0, 2);
        const safe = escapeHtml;
        const stateSettings = state.stateMechanics[owner] || snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        state.stateMechanics[owner] = stateSettings;
        const reportSeason = actualRow ? `${actualRow.year} · ${actualRow.season} · ход ${actualRow.turn}` : `Прогноз на ${snapshot.calendar.year} · ${snapshot.calendar.season} · ход ${snapshot.calendar.turn}`;
        const top = `<p class="page-intro">${isPreview ? 'Показывается расчёт по текущим данным перед сменой хода.' : 'Показаны результаты последнего рассчитанного хода.'} <strong>${safe(reportSeason)}</strong></p>${tab === 'trade' ? '' : `<div class="production-tabs" role="tablist"><button type="button" data-economy-tab="production" class="${tab === 'production' ? 'active' : ''}">Производство</button><button type="button" data-economy-tab="consumption" class="${tab === 'consumption' ? 'active' : ''}">Потребление</button></div>`}`;
        let content = top;
        if (tab === 'production' || tab === 'trade') {
            const provinceReports = report.provinceReports || {};
            const provinceRows = ownerProvinces.map(province => {
                const result = provinceReports[province.id] || {};
                const deliveries = (result.deliveries || []).map(delivery => {
                    const marker = markersById.get(Number(delivery.marker_id));
                    return `${safe(delivery.item_name || result.resource || 'Продовольствие')}: ${safe(marker?.name || `Поселение #${delivery.marker_id}`)} — ${number(delivery.quantity)}`;
                }).join('<br>') || '—';
                const resourceName = result.resource || province.resource || '—';
                const hasSeparateFood = result.food_resource && result.food_resource !== resourceName;
                const outputs = [`${safe(resourceName)}`, `${number(result.production)}`];
                if (hasSeparateFood) { outputs[0] += `<br>${safe(result.food_resource)}`; outputs[1] += `<br>${number(result.food_production)}`; }
                return [safe(province.province_name || `Провинция #${province.id}`), outputs[0], outputs[1], deliveries];
            });
            const markerReports = report.markerReports || {};
            const freeSurplus = preview.ownerReports[owner]?.free_surplus || [];
            const canEdit = state.userProfile?.role === 'admin' || state.userProfile?.owner === owner;
            const directiveOptions = { civilian: 'Гражданское', military: 'Военное', market: 'Рынок' };
            const goodOptions = GOODS.map(good => `<option value="${safe(good)}">${safe(good)}</option>`).join('');
            const settlementRows = ownerMarkers.map(marker => {
                const detail = markerReports[marker.id] || {};
                const goods = Object.entries(detail.goods_produced || {}).map(([name, quantity]) => `${safe(name)} — ${number(quantity)}`).join('<br>') || '—';
                const directive = marker.production_directive || 'civilian';
                const config = canEdit && ['city', 'large_city'].includes(marker.type)
                    ? `<form class="production-directive-form" data-production-marker="${marker.id}"><select name="directive" aria-label="Направление производства">${Object.entries(directiveOptions).map(([value, label]) => `<option value="${value}" ${value === directive ? 'selected' : ''}>${label}</option>`).join('')}</select><select name="good" aria-label="Товар госзаказа"><option value="">Без госзаказа</option>${goodOptions}</select><input name="quantity" type="number" min="0" step="0.1" value="${Number(marker.state_order_qty) || 0}" aria-label="Количество госзаказа"><button type="submit" class="compact-add-btn" aria-label="Сохранить директиву">✓</button></form>`
                    : safe(directiveOptions[directive] || directive);
                const selectedGood = marker.state_order_good;
                return [safe(marker.name || `Поселение #${marker.id}`), safe(markerTypeLabels[marker.type] || marker.type), goods, config + (canEdit && ['city', 'large_city'].includes(marker.type) && selectedGood ? `<span class="production-order-current">Заказ: ${safe(selectedGood)}</span>` : '')];
            });
            if (tab === 'production') {
              // Select a saved state-order item without relying on user-facing names as attributes.
              content += productionReportTable('Производство ресурсов в провинциях', ['Провинция', 'Ресурс', 'Прогноз за ход', 'Поставка на склады'], provinceRows, 'Нет производственных данных.');
              content += productionReportTable('Производство товаров в поселениях', ['Поселение', 'Тип', 'Товары за ход', 'Директива и госзаказ'], settlementRows, 'В государстве пока нет поселений.');
            const surplusRows = freeSurplus.map(item => [safe(item.marker_name), `${safe(item.item_name)} (${item.item_type === 'good' ? 'товар' : 'ресурс'})`, number(item.quantity)]);
            content += '<p class="page-intro">Свободные остатки показаны по поселениям после местных потребностей и заданных перевозок. Это прогноз следующего расчётного хода.</p>';
            content += productionReportTable('Свободный избыток', ['Поселение', 'Груз', 'Свободно'], surplusRows, 'После покрытия местных потребностей свободных запасов не прогнозируется.');
            }
            if (tab === 'trade') {
            const routeMarkers = ownerMarkers.filter(marker => snapshot.provinces.some(province => Number(province.id) === Number(marker.province_id) && province.owner === owner));
            const routeMarkerOptions = routeMarkers.map(marker => `<option value="${Number(marker.id)}">${safe(marker.name || `Поселение #${marker.id}`)}</option>`).join('');
            const routeDestinationOptions = routeMarkers.map((marker, index) => `<option value="${Number(marker.id)}" ${index === 1 ? 'selected' : ''}>${safe(marker.name || `Поселение #${marker.id}`)}</option>`).join('');
            const routeItemOptions = (type, selected = '') => (type === 'good' ? GOODS : RESOURCES).map(item => `<option value="${safe(item)}" ${item === selected ? 'selected' : ''}>${safe(item)}</option>`).join('');
            const stateRoutes = (snapshot.transportRoutes || []).filter(route => {
                const source = markersById.get(Number(route.source_marker_id));
                return source?.owner === owner;
            });
            const previewRoutes = new Map((preview.transportReports || []).map(result => [Number(result.route_id), result]));
            const routeRows = stateRoutes.map(route => {
                const source = markersById.get(Number(route.source_marker_id));
                const destination = markersById.get(Number(route.destination_marker_id));
                const result = previewRoutes.get(Number(route.id));
                const amount = `<form class="transport-route-edit" data-route-id="${Number(route.id)}"><input name="quantity" type="number" min="0.1" max="10000" step="0.1" value="${Number(route.quantity_per_turn) || 0}" aria-label="Количество за ход"><button type="submit" class="compact-add-btn" aria-label="Сохранить маршрут">✓</button><button type="button" class="one-off-remove" data-route-delete aria-label="Удалить маршрут">×</button></form>`;
                const routeModeLabel = { river: 'река', lake: 'озеро', sea: 'море', land: 'суша' }[result?.mode] || 'суша';
                const delivery = result ? `${number(result.delivered)} / ${number(result.requested)} · ${routeModeLabel}${result.reason ? `<br><small>${safe(result.reason)}</small>` : ''}` : 'Будет рассчитан перед сменой хода';
                return [safe(source?.name || `#${route.source_marker_id}`), safe(destination?.name || `#${route.destination_marker_id}`), `${safe(route.item_name)} (${route.item_type === 'good' ? 'товар' : 'ресурс'})`, amount, delivery];
            });
            const routeForm = `<section class="page-panel transport-routes-panel"><div class="page-panel-heading"><h2>Перевозки между поселениями</h2><p>Задай объём груза за ход. Перевозка использует свободные запасы после местных потребностей. Реки и озёра повышают пропускную способность, а морские пути доступны между близкими поселениями у одной акватории.</p></div>
              ${canEdit ? `<form id="transport-route-form" class="transport-route-form"><label>Откуда<select name="source" required>${routeMarkerOptions}</select></label><label>Куда<select name="destination" required>${routeDestinationOptions}</select></label><label>Тип груза<select id="transport-route-type" name="item_type" data-route-type><option value="resource">Ресурс</option><option value="good">Товар</option></select></label><label>Груз<select id="transport-route-cargo" name="item_name">${routeItemOptions('resource')}</select></label><label>Количество за ход<input name="quantity" type="number" min="0.1" max="10000" step="0.1" value="10" required></label><button class="page-map-btn" type="submit" ${routeMarkers.length < 2 ? 'disabled' : ''}>Добавить маршрут</button></form>` : ''}
              ${productionReportTable('Заданные маршруты', ['Откуда', 'Куда', 'Груз', 'Количество за ход', 'Прогноз перевозки'], routeRows, 'Маршруты пока не заданы.')}</section>`;
            content += routeForm;
            const tradeContracts = snapshot.tradeContracts || [];
            const tradeMarkers = snapshot.markers.filter(marker => marker.owner && marker.type !== 'ruins');
            const tradeMarkerLabel = marker => `${safe(marker.name || `Поселение #${marker.id}`)} · ${safe(marker.owner)}`;
            const sellerOptions = tradeMarkers.filter(marker => marker.owner === owner).map(marker => `<option value="${Number(marker.id)}">${tradeMarkerLabel(marker)}</option>`).join('');
            const buyerOptions = tradeMarkers.filter(marker => marker.owner !== owner).map(marker => `<option value="${Number(marker.id)}">${tradeMarkerLabel(marker)}</option>`).join('');
            const tradeRows = tradeContracts.filter(contract => contract.seller_owner === owner || contract.buyer_owner === owner || preview.ownerReports[owner]?.external_trade?.some(row => Number(row.contract_id) === Number(contract.id) && row.side === 'transit')).map(contract => {
                const source = markersById.get(Number(contract.source_marker_id)), destination = markersById.get(Number(contract.destination_marker_id));
                const result = (preview.ownerReports[owner]?.external_trade || []).find(row => Number(row.contract_id) === Number(contract.id));
                const statusLabel = { pending: 'Ожидает ответа', active: 'Действует', rejected: 'Отклонён', cancelled: 'Отменён' }[contract.status] || contract.status;
                const isTransitObserver = preview.ownerReports[owner]?.external_trade?.some(row => Number(row.contract_id) === Number(contract.id) && row.side === 'transit');
                const canManageRoute = canEdit && (state.userProfile?.role === 'admin' || contract.seller_owner === owner || contract.buyer_owner === owner);
                const routeControls = canManageRoute && ['pending', 'active'].includes(contract.status)
                    ? `<div class="trade-contract-route-controls"><span>${Array.isArray(contract.route_province_ids) ? 'Ручной путь' : 'Автопуть'}</span><button type="button" class="page-map-btn" data-edit-trade-route="${Number(contract.id)}">${Array.isArray(contract.route_province_ids) ? 'Изменить на карте' : 'Выбрать на карте'}</button>${Array.isArray(contract.route_province_ids) ? `<button type="button" class="page-map-btn" data-clear-trade-route="${Number(contract.id)}">Автоматически</button>` : ''}</div>`
                    : '';
                const controls = contract.status === 'pending' && contract.buyer_owner === owner
                    ? `<div class="trade-contract-actions"><button type="button" class="trade-action-btn" data-trade-action="accept" data-trade-id="${Number(contract.id)}">Принять</button><button type="button" class="trade-action-btn" data-trade-action="reject" data-trade-id="${Number(contract.id)}">Отклонить</button></div>`
                    : contract.status === 'active' && contract.seller_owner === owner ? `<div class="trade-contract-actions"><button type="button" class="trade-action-btn" data-trade-action="cancel" data-trade-id="${Number(contract.id)}">Расторгнуть</button></div>` : '';
                const shipment = result ? `Отправлено ${number(result.shipped)} · доставлено ${number(result.delivered)}${result.route_loss > 0 ? ` · потеря ${number(result.route_loss)}` : ''}${result.neutral_province_count ? ` · нейтральных провинций ${result.neutral_province_count}` : ''}<br><small>Продавцу ${number(result.paid)} z · пошлины ${number(result.toll_paid)} z · всего покупатель платит ${number(result.buyer_total_paid)} z${result.transit_tolls?.length ? ` (${result.transit_tolls.map(toll => `${safe(toll.owner)} ${number(toll.rate)}%`).join(', ')})` : ''}${result.reason ? `<br>${safe(result.reason)}` : ''}</small>` : '—';
                return [tradeMarkerLabel(source || { id: contract.source_marker_id, name: `#${contract.source_marker_id}`, owner: contract.seller_owner }), tradeMarkerLabel(destination || { id: contract.destination_marker_id, name: `#${contract.destination_marker_id}`, owner: contract.buyer_owner }), `${safe(contract.item_name)} (${contract.item_type === 'good' ? 'товар' : 'ресурс'})`, `${number(contract.quantity_per_turn)} за ход`, `${number(contract.unit_price)} z/ед.`, `${isTransitObserver ? 'Транзит · ' : ''}${safe(statusLabel)} · ${Array.isArray(contract.route_province_ids) ? 'ручной путь' : 'автопуть'}${controls || routeControls ? `<br>${controls}${routeControls}` : ''}`, shipment];
            });
            const contractPanel = `<section class="page-panel transport-routes-panel"><div class="page-panel-heading"><h2>Межгосударственная торговля</h2><p>Договор повторяется каждый ход. Автопуть использует доступную водную связь (река, озеро или море), иначе ищет короткий сухопутный маршрут. Сухопутный путь можно вручную провести по провинциям, чтобы выбрать, где принять потери или пошлины. Нейтральная провинция удерживает 5% груза, транзитное государство взимает пошлину один раз за маршрут.</p></div>
              ${canEdit && sellerOptions && buyerOptions ? `<form id="state-trade-contract-form" class="transport-route-form state-trade-contract-form"><label>Откуда<select name="source" required>${sellerOptions}</select></label><label>Куда<select name="destination" required>${buyerOptions}</select></label><label>Тип груза<select name="item_type" data-trade-type><option value="resource">Ресурс</option><option value="good">Товар</option></select></label><label>Груз<select name="item_name" data-trade-cargo>${RESOURCES.map(item => `<option value="${safe(item)}">${safe(item)}</option>`).join('')}</select></label><label>Количество за ход<input name="quantity" type="number" min="0.1" max="10000" step="0.1" value="10" required></label><label>Цена за единицу, z<input name="price" type="number" min="0" max="1000000" step="0.1" value="1" required></label><button class="page-map-btn" type="submit">Предложить договор</button></form>` : '<p class="page-note">Для предложения договора нужны поселение вашего государства и поселение другого государства.</p>'}
              ${productionReportTable('Договоры и поставки', ['Откуда', 'Куда', 'Груз', 'Объём', 'Цена', 'Статус', 'Поставка за ход'], tradeRows, 'Договоров пока нет.', 'trade-contract-table')}</section>`;
            content += contractPanel;
            const marketEffects = preview.ownerReports[owner]?.state_effects || report.state_effects || {};
            const marketRows = (marketEffects.market_demand || []).map(row => [safe(row.item), `${number(row.base_price)} z`, `${number(row.price)} z`, number(row.demand), number(row.supply), number(row.consumed), number(row.imported), number(row.exported), `${number(row.turnover)} z`]);
            const settings = stateSettings;
            const storedTradeRate = Number(settings.internal_trade_tax_rate);
            const internalTradeRate = Math.max(0, Math.min(15, Number.isFinite(storedTradeRate) ? storedTradeRate : 5));
            const taxChangeLocked = state.userProfile?.role !== 'admin' && Number(settings.internal_trade_tax_last_changed_year) === Number(snapshot.calendar.year);
            const internalTradeTaxForm = `<section class="page-panel trade-tax-panel"><div class="page-panel-heading"><div><h2>Сбор с внутренней торговли</h2><p>Удерживается с внутреннего товарооборота и влияет на лояльность горожан.</p></div><strong>${number(marketEffects.trade_income)} z · прогноз</strong></div><form id="internal-trade-tax-form" class="trade-tax-form"><label>Ставка сбора, %<input name="internal_trade_tax_rate" type="number" min="0" max="15" step="0.5" value="${internalTradeRate}" ${canEdit && !taxChangeLocked ? '' : 'readonly'}></label><button class="page-map-btn" type="submit" ${canEdit && !taxChangeLocked ? '' : 'disabled'}>Сохранить ставку</button><span id="trade-tax-status" aria-live="polite"></span></form><small class="page-note">Игрок меняет ставку раз в игровой год за 5 ОП; администратор — без ограничений и расходов.${taxChangeLocked ? ' Ставка уже менялась в этом игровом году.' : ''}</small></section>`;
            content += internalTradeTaxForm;
            content += `<section class="page-panel state-shortage-summary"><div><span>Внутренний товарооборот · прогноз на ход</span><strong>${number(marketEffects.market_turnover)} z</strong></div><p>Спрос распределяется между заменяемыми товарами внутри потребностей населения. Импорт и экспорт учитывают межгосударственные договоры. Запасы сверх спроса сами по себе не продаются.</p></section>`;
            content += productionReportTable('Внутренний рынок и динамические цены', ['Ресурс или товар', 'Базовая цена', 'Цена государства', 'Спрос', 'Доступно', 'Покрыто', 'Импорт за ход', 'Экспорт за ход', 'Оборот'], marketRows, 'Рыночные данные пока не рассчитаны.');
            const currentYear = Number(snapshot.calendar.year) || 1450;
            const transitRules = (snapshot.tradeTransitRules || []).filter(rule => rule.transit_owner === owner && (tradeContracts.some(contract => Number(contract.id) === Number(rule.contract_id) && contract.status === 'active')));
            const contractById = new Map(tradeContracts.map(contract => [Number(contract.id), contract]));
            const policyRows = transitRules.map(rule => {
                const contract = contractById.get(Number(rule.contract_id));
                const source = markersById.get(Number(contract?.source_marker_id)), destination = markersById.get(Number(contract?.destination_marker_id));
                const routeNow = (preview.ownerReports[owner]?.external_trade || []).find(entry => Number(entry.contract_id) === Number(rule.contract_id) && entry.side === 'transit');
                const tollLocked = state.userProfile?.role !== 'admin' && Number(rule.toll_last_changed_year) === currentYear;
                const editable = canEdit && rule.transit_owner === owner;
                const endpointText = `${safe(source?.name || `#${contract?.source_marker_id}`)} → ${safe(destination?.name || `#${contract?.destination_marker_id}`)}`;
                const cargoText = contract ? `${safe(contract.item_name)} · ${number(contract.quantity_per_turn)}/ход` : 'Договор';
                const rateControl = editable ? `<form class="transit-policy-form" data-transit-policy data-contract-id="${Number(rule.contract_id)}" data-transit-owner="${safe(owner)}"><label><span>Пошлина, %</span><input name="toll_rate" type="number" min="0" max="50" step="0.5" value="${Number(rule.toll_rate) || 0}" ${tollLocked ? 'readonly' : ''}></label><button type="submit" class="compact-add-btn" ${tollLocked ? 'disabled' : ''}>Сохранить · 2 ОП</button><label class="transit-block-control"><input type="checkbox" name="blocked" ${rule.blocked ? 'checked' : ''}> Запретить проход</label><small>${tollLocked ? 'Пошлина уже менялась в этом игровом году.' : 'Менять пошлину можно раз в год.'}</small></form>` : `${number(rule.toll_rate)}%`;
                const routeState = routeNow ? 'Проходит сейчас' : rule.blocked ? 'Проход запрещён; поиск обхода' : 'Сейчас не проходит по территории';
                return [endpointText, cargoText, rateControl, `${safe(routeState)}${editable && rule.blocked ? ' · запрет включён' : ''}`];
            });
            content += productionReportTable('Чужие маршруты через государство', ['Маршрут', 'Груз', 'Условия транзита', 'Состояние'], policyRows, 'Пока нет действующих договоров, маршруты которых проходят через ваши земли.');
            }
            if (tab === 'production') {
            const stockRows = ownerMarkers.map(marker => {
                const items = inventoryByMarker.get(Number(marker.id)) || [];
                const stock = items.filter(item => Number(item.quantity) > 0).map(item => `${safe(item.item_name)} — ${number(item.quantity)} ${item.item_type === 'good' ? 'тов.' : 'рес.'}`).join('<br>') || 'Пусто';
                return [safe(marker.name || `Поселение #${marker.id}`), stock];
            });
            content += productionReportTable('Текущие запасы на складах', ['Поселение', 'Остатки ресурсов и товаров'], stockRows, 'Склады пока пусты.');
            }
        } else {
            const consumptionRows = Object.entries(report.consumption || {}).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([item, amount]) => [safe(item), number(amount)]);
            const shortageRows = Object.entries(report.shortages || {}).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([need, amount]) => [safe(need), number(amount)]);
            const coverageRows = ownerMarkers.flatMap(marker => (report.markerReports?.[marker.id]?.coverage || []).map(need => [safe(marker.name || `Поселение #${marker.id}`), safe(need.need), number(need.demand), number(need.covered), `${number((Number(need.ratio) || 0) * 100)}%`]));
            const foodEffect = report.state_effects || {};
            const foodCoverage = Number(foodEffect.food_coverage);
            if (Number.isFinite(foodCoverage)) content += `<section class="page-panel state-shortage-summary"><div><span>Обеспеченность государства продовольствием</span><strong>${number(foodCoverage * 100)}%</strong></div><p>Потеря дворов за этот ход: ${number(foodEffect.yards_lost)} из ${number(foodEffect.yards_before)} · изменение общей лояльности крестьянства: ${number(foodEffect.peasants_loyalty_change)} п.п.${foodEffect.winter_fuel_coverage === null || foodEffect.winter_fuel_coverage === undefined ? '' : ` · зимнее покрытие топливом: ${number(Number(foodEffect.winter_fuel_coverage) * 100)}%`}</p></section>`;
            content += productionReportTable('Потребление ресурсов и товаров за ход', ['Ресурс или товар', 'Количество'], consumptionRows, 'Потребление пока не рассчитано.');
            content += productionReportTable('Непокрытые потребности', ['Потребность', 'Дефицит'], shortageRows, 'По последнему расчёту дефицита нет.');
            content += productionReportTable('Покрытие потребностей по поселениям', ['Поселение', 'Потребность', 'Требуется', 'Покрыто', 'Покрытие'], coverageRows, 'Нет данных по покрытию потребностей.');
        }
        showPageView(pageTitle, content, { navId: pageNavId, subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}` });
        elements.pageView.querySelectorAll('[data-economy-tab]').forEach(button => button.addEventListener('click', () => renderProductionConsumption(owner, button.dataset.economyTab, playerName)));
        elements.pageView.querySelectorAll('[data-production-marker]').forEach(form => {
            const marker = markersById.get(Number(form.dataset.productionMarker));
            const goodSelect = form.elements.good;
            if (marker?.state_order_good) goodSelect.value = marker.state_order_good;
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const submit = form.querySelector('button[type="submit"]');
                submit.disabled = true;
                try {
                    const saved = await saveProductionDirective(Number(form.dataset.productionMarker), form.elements.directive.value, form.elements.good.value, Number(form.elements.quantity.value) || 0);
                    const local = state.dbMarkers.find(row => Number(row.id) === Number(form.dataset.productionMarker));
                    if (local) Object.assign(local, saved);
                    showToast('Производственная директива сохранена');
                    await renderProductionConsumption(owner, tab, playerName);
                } catch (error) {
                    showToast(`Не удалось сохранить директиву: ${error.message}`);
                    submit.disabled = false;
                }
            });
        });
        const routeForm = elements.pageView.querySelector('#transport-route-form');
        if (routeForm) {
            const typeSelect = routeForm.querySelector('#transport-route-type');
            const cargoSelect = routeForm.querySelector('#transport-route-cargo');
            const keepEndpointsDifferent = changed => {
                const source = routeForm.elements.source;
                const destination = routeForm.elements.destination;
                if (source.value !== destination.value) return;
                const other = [...(changed === 'source' ? destination.options : source.options)].find(option => option.value !== (changed === 'source' ? source.value : destination.value));
                if (other) (changed === 'source' ? destination : source).value = other.value;
            };
            routeForm.elements.source.addEventListener('change', () => keepEndpointsDifferent('source'));
            routeForm.elements.destination.addEventListener('change', () => keepEndpointsDifferent('destination'));
            const refreshRouteCargoOptions = () => {
                const items = typeSelect.value === 'good' ? GOODS : RESOURCES;
                cargoSelect.replaceChildren(...items.map(item => {
                    const option = document.createElement('option');
                    option.value = item;
                    option.textContent = item;
                    return option;
                }));
                cargoSelect.selectedIndex = 0;
            };
            typeSelect.addEventListener('change', refreshRouteCargoOptions);
            refreshRouteCargoOptions();
            routeForm.addEventListener('submit', async event => {
                event.preventDefault();
                const submit = routeForm.querySelector('button[type="submit"]');
                if (Number(routeForm.elements.source.value) === Number(routeForm.elements.destination.value)) {
                    showToast('Выбери два разных поселения');
                    return;
                }
                submit.disabled = true;
                try {
                    await saveMarkerTransportRoute(Number(routeForm.elements.source.value), Number(routeForm.elements.destination.value), typeSelect.value, routeForm.elements.item_name.value, Number(routeForm.elements.quantity.value));
                    showToast('Маршрут перевозки сохранён');
                    await renderProductionConsumption(owner, 'trade', playerName);
                } catch (error) {
                    showToast(`Не удалось сохранить маршрут: ${error.message}`);
                    submit.disabled = false;
                }
            });
        }
        const tradeForm = elements.pageView.querySelector('#state-trade-contract-form');
        if (tradeForm) {
            const typeSelect = tradeForm.querySelector('[data-trade-type]'), cargoSelect = tradeForm.querySelector('[data-trade-cargo]');
            const refreshTradeCargo = () => {
                const items = typeSelect.value === 'good' ? GOODS : RESOURCES;
                cargoSelect.replaceChildren(...items.map(item => { const option = document.createElement('option'); option.value = item; option.textContent = item; return option; }));
            };
            typeSelect.addEventListener('change', refreshTradeCargo);
            tradeForm.addEventListener('submit', async event => {
                event.preventDefault(); const submit = tradeForm.querySelector('button[type="submit"]'); submit.disabled = true;
                try {
                    await saveStateTradeContract('offer', { sourceMarkerId: Number(tradeForm.elements.source.value), destinationMarkerId: Number(tradeForm.elements.destination.value), itemType: typeSelect.value, itemName: cargoSelect.value, quantityPerTurn: Number(tradeForm.elements.quantity.value), unitPrice: Number(tradeForm.elements.price.value) });
                    showToast('Торговое предложение отправлено'); await renderProductionConsumption(owner, 'trade', playerName);
                } catch (error) { showToast(`Не удалось отправить предложение: ${error.message}`); submit.disabled = false; }
            });
        }
        elements.pageView.querySelectorAll('[data-trade-action]').forEach(button => button.addEventListener('click', async () => {
            button.disabled = true;
            try { await saveStateTradeContract(button.dataset.tradeAction, { contractId: Number(button.dataset.tradeId) }); showToast('Статус договора обновлён'); await renderProductionConsumption(owner, 'trade', playerName); }
            catch (error) { showToast(`Не удалось обновить договор: ${error.message}`); button.disabled = false; }
        }));
        elements.pageView.querySelectorAll('[data-edit-trade-route]').forEach(button => button.addEventListener('click', () => {
            const contract = (state.economySnapshot?.tradeContracts || []).find(row => Number(row.id) === Number(button.dataset.editTradeRoute));
            if (contract) startTradeRouteSelection(contract, owner, playerName);
        }));
        elements.pageView.querySelectorAll('[data-clear-trade-route]').forEach(button => button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await saveStateTradeContractRoute(Number(button.dataset.clearTradeRoute), null);
                state.economySnapshot = await fetchEconomySnapshot();
                refreshTradeRouteOverlay();
                showToast('Договор снова использует автоматический маршрут');
                await renderProductionConsumption(owner, 'trade', playerName);
            } catch (error) { showToast(`Не удалось включить автопуть: ${error.message}`); button.disabled = false; }
        }));
        elements.pageView.querySelectorAll('[data-route-id]').forEach(form => {
            const route = (snapshot.transportRoutes || []).find(row => Number(row.id) === Number(form.dataset.routeId));
            if (!route) return;
            const save = async quantity => {
                await saveMarkerTransportRoute(Number(route.source_marker_id), Number(route.destination_marker_id), route.item_type, route.item_name, quantity);
                showToast(quantity === 0 ? 'Маршрут удалён' : 'Маршрут обновлён');
                await renderProductionConsumption(owner, 'trade', playerName);
            };
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const submit = form.querySelector('button[type="submit"]');
                submit.disabled = true;
                try { await save(Number(form.elements.quantity.value)); }
                catch (error) { showToast(`Не удалось обновить маршрут: ${error.message}`); submit.disabled = false; }
            });
            form.querySelector('[data-route-delete]').addEventListener('click', async event => {
                const button = event.currentTarget;
                button.disabled = true;
                try { await save(0); }
                catch (error) { showToast(`Не удалось удалить маршрут: ${error.message}`); button.disabled = false; }
            });
        });
        const taxForm = elements.pageView.querySelector('#internal-trade-tax-form');
        taxForm?.addEventListener('submit', async event => {
            event.preventDefault();
            const status = taxForm.querySelector('#trade-tax-status');
            const nextRate = Number(taxForm.elements.internal_trade_tax_rate.value);
            const oldRate = Number(stateSettings.internal_trade_tax_rate ?? 5);
            if (!Number.isFinite(nextRate) || nextRate < 0 || nextRate > 15) { status.textContent = 'Ставка должна быть от 0 до 15%.'; return; }
            if (nextRate !== oldRate && state.userProfile?.role !== 'admin') {
                if (Number(stateSettings.internal_trade_tax_last_changed_year) === Number(snapshot.calendar.year)) { status.textContent = 'Сбор можно менять один раз за игровой год.'; return; }
                if (Number(stateSettings.economy?.prestige) < 5) { status.textContent = 'Для изменения ставки нужно 5 ОП.'; return; }
            }
            try { state.stateMechanics[owner] = await saveStateMechanics(owner, { ...stateSettings, internal_trade_tax_rate: nextRate }); await renderProductionConsumption(owner, 'trade', playerName); }
            catch (error) { status.textContent = `Не удалось сохранить сбор: ${error.message}`; }
        });
        elements.pageView.querySelectorAll('[data-transit-policy]').forEach(form => {
            const values = () => ({ contractId: Number(form.dataset.contractId), transitOwner: form.dataset.transitOwner });
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]'); button.disabled = true;
                try { await saveStateTradeTransitPolicy('set_toll', { ...values(), tollRate: Number(form.elements.toll_rate.value) }); state.economySnapshot = await fetchEconomySnapshot(); refreshTradeRouteOverlay(); showToast('Транзитная пошлина сохранена'); await renderProductionConsumption(owner, 'trade', playerName); }
                catch (error) { showToast(`Не удалось изменить пошлину: ${error.message}`); button.disabled = false; }
            });
            form.elements.blocked?.addEventListener('change', async event => {
                const checkbox = event.currentTarget; checkbox.disabled = true;
                try { await saveStateTradeTransitPolicy('set_blocked', { ...values(), blocked: checkbox.checked }); state.economySnapshot = await fetchEconomySnapshot(); refreshTradeRouteOverlay(); showToast(checkbox.checked ? 'Проход караванов запрещён' : 'Запрет прохода снят'); await renderProductionConsumption(owner, 'trade', playerName); }
                catch (error) { showToast(`Не удалось изменить запрет: ${error.message}`); checkbox.disabled = false; checkbox.checked = !checkbox.checked; }
            });
        });
    } catch (error) {
        showPageView(pageTitle, `<div class="page-error">Не удалось загрузить торговые или производственные данные: ${escapeHtml(error.message)}</div>`, { navId: pageNavId, subtitle: owner });
    }
}

async function advanceEconomyTurn() {
    const snapshot = await fetchEconomySnapshot();
    const simulation = simulateEconomySnapshot(snapshot);
    const payload = {
        processed_calendar: snapshot.calendar,
        inventoryUpdates: simulation.inventoryUpdates,
        provinceUpdates: simulation.provinceUpdates,
        markerUpdates: simulation.markerUpdates,
        territoryLoyaltyUpdates: [],
        stateLoyaltyUpdates: simulation.stateLoyaltyUpdates,
        treasuryAdjustments: simulation.treasuryAdjustments,
        ownerReports: simulation.ownerReports
    };
    const calendar = await applyEconomyTurn(payload);
    await loadSupabaseData();
    state.economySnapshot = await fetchEconomySnapshot();
    state.stateMechanics = Object.fromEntries(state.economySnapshot.mechanics.map(row => [row.owner, row.settings || {}]));
    refreshTradeRouteOverlay();
    return calendar;
}

async function renderEconomy(owner, playerName = '') {
    activePageOwner = owner;
    showPageView('Экономика', '<div class="page-loading">Загружаю экономику государства…</div>', { navId: 'nav-economy' });
    try {
        const settings = state.stateMechanics[owner] ?? await fetchStateMechanics(owner) ?? {};
        state.stateMechanics[owner] = settings;
        let financePreview = {};
        try {
            const sourceSnapshot = state.economySnapshot || await fetchEconomySnapshot();
            const mechanics = sourceSnapshot.mechanics.filter(row => row.owner !== owner).concat([{ owner, settings }]);
            financePreview = simulateEconomySnapshot({ ...sourceSnapshot, mechanics }).ownerReports[owner]?.state_effects || {};
        } catch (error) {
            console.warn('Не удалось рассчитать финансовый прогноз', error);
        }
        const economy = settings.economy || {};
        const income = { taxes: 0, trade: 0, other_recurring: 0, other_one_off: 0, ...(economy.income || {}) };
        const forecastTaxIncome = Number.isFinite(Number(financePreview.tax_income)) ? Number(financePreview.tax_income) : Number(income.taxes) || 0;
        const forecastTradeIncome = Number.isFinite(Number(financePreview.trade_income)) ? Number(financePreview.trade_income) : Number(income.trade) || 0;
        const expenses = { army: 0, trade: 0, other_recurring: 0, other_one_off: 0, ...(economy.expenses || {}) };
        const treasury = Number(economy.treasury) || 0;
        const prestige = Number(economy.prestige) || 0;
        const itemsFor = (stored, legacyAmount, legacyReason) => Array.isArray(stored) ? stored : (Number(legacyAmount) > 0 ? [{ reason: legacyReason, amount: Number(legacyAmount) }] : []);
        const treasuryIncomeItems = itemsFor(economy.one_off_income_treasury, income.other_one_off, 'Прочие разовые доходы');
        const treasuryItems = itemsFor(economy.one_off_expenses_treasury, expenses.other_one_off, 'Прочие разовые расходы');
        const prestigeIncomeItems = itemsFor(economy.one_off_income_prestige, 0, '');
        const prestigeItems = itemsFor(economy.one_off_expenses_prestige, economy.prestige_one_off_expenses, 'Ранее внесённые разовые расходы');
        const totalOf = items => items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        const treasuryIncome = forecastTaxIncome + forecastTradeIncome + Number(income.other_recurring || 0) + totalOf(treasuryIncomeItems);
        const treasuryFixedExpenses = Number(expenses.army || 0) + Number(expenses.trade || 0) + Number(expenses.other_recurring || 0);
        const oneOffTreasuryTotal = totalOf(treasuryItems);
        const oneOffPrestigeTotal = totalOf(prestigeItems);
        const treasuryNext = Number.isFinite(Number(financePreview.treasury_balance)) ? Number(financePreview.treasury_balance) : Math.max(0, treasury + treasuryIncome - treasuryFixedExpenses - oneOffTreasuryTotal);
        const prestigeFixed = Number(economy.prestige_recurring_expenses) || 0;
        const prestigeIncome = Number(economy.prestige_recurring_income) || 0;
        const totalPrestigeIncome = prestigeIncome + totalOf(prestigeIncomeItems);
        const prestigeNext = Number.isFinite(Number(financePreview.prestige_balance)) ? Number(financePreview.prestige_balance) : Math.max(0, prestige + totalPrestigeIncome - prestigeFixed - oneOffPrestigeTotal);
        const edit = state.userProfile?.role === 'admin' || state.userProfile?.owner === owner;
        const isAdmin = state.userProfile?.role === 'admin';
        const field = (label, value, unit = '') => `<div class="economy-value"><span>${label}</span><strong>${formatNumber(Number(value) || 0, 1)} ${unit}</strong></div>`;
        const balance = (label, current, next, unit) => `<section class="economy-balance"><span>${label}</span><strong>${formatNumber(current, 1)} ${unit}</strong><small>На след. ход: <b>${formatNumber(next, 1)} ${unit}</b></small></section>`;
        const transactionEntries = [
            ...treasuryIncomeItems.map(item => ({ ...item, type: 'treasury_income' })),
            ...treasuryItems.map(item => ({ ...item, type: 'treasury_expense' })),
            ...prestigeIncomeItems.map(item => ({ ...item, type: 'prestige_income' })),
            ...prestigeItems.map(item => ({ ...item, type: 'prestige_expense' }))
        ];
        const transactionTypeOptions = [['treasury_income','Доход казны','z'],['treasury_expense','Расход казны','z'],['prestige_income','Доход престижа','ОП'],['prestige_expense','Расход престижа','ОП']];
        const transactionRows = transactionEntries.map(item => `<tr data-one-off-row><td><select name="transaction_type" ${edit ? '' : 'disabled'}>${transactionTypeOptions.map(([value,label]) => `<option value="${value}" ${item.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td><input name="transaction_reason" type="text" maxlength="120" placeholder="Причина или источник" value="${escapeHtml(item.reason || '')}" ${edit ? '' : 'readonly'}></td><td><input name="transaction_amount" type="number" min="0" step="0.1" value="${Number(item.amount) || 0}" ${edit ? '' : 'readonly'}> <span data-transaction-unit>${item.type.startsWith('treasury') ? 'z' : 'ОП'}</span></td><td>${edit ? '<button type="button" class="one-off-remove" aria-label="Удалить операцию" data-remove-one-off>×</button>' : ''}</td></tr>`).join('');
        const content = `<form id="economy-form"><div class="economy-ledgers economy-ledgers-clean">
          <section class="economy-ledger"><div class="economy-ledger-heading">${balance('Казна', treasury, treasuryNext, 'z')}</div><section class="economy-list page-panel"><h2>Доходы казны</h2>${field('Налоги · прогноз', forecastTaxIncome, 'z')}${field('Прочие постоянные доходы', income.other_recurring, 'z')}</section><section class="economy-list page-panel"><h2>Расходы казны</h2>${field('Армия', expenses.army, 'z')}${field('Торговые расходы', expenses.trade, 'z')}${field('Прочие постоянные расходы', expenses.other_recurring, 'z')}</section></section>
          <section class="economy-ledger"><div class="economy-ledger-heading">${balance('Престиж', prestige, prestigeNext, 'ОП')}</div><section class="economy-list page-panel"><h2>Доходы престижа</h2>${field('Прочие постоянные доходы', prestigeIncome, 'ОП')}</section><section class="economy-list page-panel"><h2>Расходы престижа</h2>${field('Прочие постоянные расходы', prestigeFixed, 'ОП')}</section></section>
          </div><section class="economy-list page-panel economy-transactions"><header><h2>Разовые операции</h2>${edit ? '<button type="button" class="compact-add-btn" data-add-transaction aria-label="Добавить операцию">+</button>' : ''}</header><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Тип</th><th>Источник или причина</th><th>Сумма</th><th></th></tr></thead><tbody data-transaction-list>${transactionRows || `<tr class="transaction-empty"><td colspan="4">Разовых операций пока нет.</td></tr>`}</tbody></table></div></section><div class="mechanics-save-row"><button class="page-map-btn" type="submit" ${edit ? '' : 'disabled'}>Сохранить разовые операции</button><span id="economy-save-status" aria-live="polite"></span></div><p class="page-note">Налоги и торговые доходы рассчитываются автоматически. Постоянные расходы применяются при смене хода; разовые операции после расчёта списываются из списка.</p>${Number(financePreview.treasury_unpaid) > 0 || Number(financePreview.prestige_unpaid) > 0 ? `<p class="page-note">В прогнозе не хватает средств на расходы: ${Number(financePreview.treasury_unpaid) > 0 ? `${formatNumber(financePreview.treasury_unpaid, 1)} z казны` : ''}${Number(financePreview.treasury_unpaid) > 0 && Number(financePreview.prestige_unpaid) > 0 ? ', ' : ''}${Number(financePreview.prestige_unpaid) > 0 ? `${formatNumber(financePreview.prestige_unpaid, 1)} ОП` : ''}.</p>` : ''}</form>`;
        showPageView('Экономика', content, { navId: 'nav-economy', subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}` });
        const form = elements.pageView.querySelector('#economy-form');
        const transactionList = form.querySelector('[data-transaction-list]');
        const transactionUnit = type => type.startsWith('treasury') ? 'z' : 'ОП';
        const bindTransactionRow = row => {
            row.querySelector('[name="transaction_type"]')?.addEventListener('change', event => { row.querySelector('[data-transaction-unit]').textContent = transactionUnit(event.currentTarget.value); });
            row.querySelector('[data-remove-one-off]')?.addEventListener('click', () => { row.remove(); if (!transactionList.querySelector('[data-one-off-row]')) transactionList.innerHTML = '<tr class="transaction-empty"><td colspan="4">Разовых операций пока нет.</td></tr>'; });
        };
        form.querySelector('[data-add-transaction]')?.addEventListener('click', () => {
            transactionList.querySelector('.transaction-empty')?.remove();
            const row = document.createElement('tr'); row.dataset.oneOffRow = '';
            row.innerHTML = `<td><select name="transaction_type">${transactionTypeOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></td><td><input name="transaction_reason" type="text" maxlength="120" placeholder="Причина или источник"></td><td><input name="transaction_amount" type="number" min="0" step="0.1" value="0"> <span data-transaction-unit>z</span></td><td><button type="button" class="one-off-remove" aria-label="Удалить операцию" data-remove-one-off>×</button></td>`;
            transactionList.append(row); bindTransactionRow(row);
        });
        form.querySelectorAll('[data-one-off-row]').forEach(bindTransactionRow);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const status = form.querySelector('#economy-save-status');
            const invalidOneOff = [...form.querySelectorAll('[data-one-off-row]')].some(row => Number(row.querySelector('input[type="number"]').value) > 0 && !row.querySelector('input[type="text"]').value.trim());
            if (invalidOneOff) { status.textContent = 'Укажите источник или причину каждой разовой операции.'; return; }
            const collectOneOff = kind => [...form.querySelectorAll('[data-one-off-row]')].filter(row => row.querySelector('[name="transaction_type"]').value === kind).map(row => ({ reason: row.querySelector('[name="transaction_reason"]').value.trim(), amount: Math.max(0, Number(row.querySelector('[name="transaction_amount"]').value) || 0) })).filter(item => item.reason || item.amount > 0);
            const next = { ...settings, economy: { ...economy, income: { ...income, other_one_off: 0 }, expenses: { ...expenses, other_one_off: 0 }, one_off_income_treasury: collectOneOff('treasury_income'), one_off_expenses_treasury: collectOneOff('treasury_expense'), one_off_income_prestige: collectOneOff('prestige_income'), one_off_expenses_prestige: collectOneOff('prestige_expense') } };
            try { state.stateMechanics[owner] = await saveStateMechanics(owner, next); await renderEconomy(owner, playerName); }
            catch (error) { status.textContent = `Ошибка сохранения: ${error.message}`; }
        });
    } catch (error) { showPageView('Экономика', `<div class="page-error">Не удалось загрузить экономику: ${escapeHtml(error.message)}</div>`, { navId: 'nav-economy', subtitle: owner }); }
}

function renderUnavailableSection(title, description, navId) {
    showPageView(title, `<section class="page-empty-state"><div class="page-empty-icon">✦</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></section>`, { navId });
}

function getNavigationItems() {
    const isAdmin = state.userProfile?.role === 'admin';
    const isAuth = !!state.currentUser;
    const hasOwner = !!state.userProfile?.owner;
    if (isAdmin) return [{ id: 'nav-map', label: 'Карта' }, { id: 'nav-stats', label: 'Статистика' }, ...(activePageOwner ? [{ id: 'nav-economy', label: 'Экономика' }, { id: 'nav-trade', label: 'Торговля' }, { id: 'nav-production', label: 'Производство' }] : []), { id: 'nav-rules', label: 'Правила и механики' }];
    if (!isAuth || !hasOwner) return [{ id: 'nav-rules', label: 'Правила и механики' }, { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }];
    return [{ id: 'nav-map', label: 'Карта' }, { id: 'nav-stats', label: 'Статистика' }, { id: 'nav-economy', label: 'Экономика' }, { id: 'nav-trade', label: 'Торговля' }, { id: 'nav-production', label: 'Производство' }, { id: 'nav-cities', label: 'Города' }, { id: 'nav-provinces', label: 'Провинции' }, { id: 'nav-military', label: 'Военное дело' }, { id: 'nav-modifiers', label: 'Модификаторы' }, { id: 'nav-rules', label: 'Правила и механики' }, { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }];
}

function activateNavigationItem(id, url) {
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    const owner = activePageOwner || state.userProfile?.owner || '';
    if (id === 'nav-map') closePageView();
    else if (id === 'nav-stats') state.userProfile?.role === 'admin' ? renderAdminStateList() : state.userProfile?.owner && renderStateStatistics(state.userProfile.owner, state.userProfile.nickname || '');
    else if (id === 'nav-economy') owner && renderEconomy(owner, state.userProfile?.nickname || '');
    else if (id === 'nav-trade') owner && renderProductionConsumption(owner, 'trade', state.userProfile?.nickname || '');
    else if (id === 'nav-production') owner && renderProductionConsumption(owner, 'production', state.userProfile?.nickname || '');
    else if (id === 'nav-provinces') owner && renderOwnerProvinces(owner);
    else if (id === 'nav-cities') owner && renderOwnerSettlements(owner);
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
            state.gameCalendar = await advanceEconomyTurn();
            renderGameCalendar();
            showToast('Рассчитаны производство, потребление и запасы. Наступил новый ход');
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

    elements.tradeRoutesToggleBtn?.addEventListener('click', () => {
        state.showTradeRoutes = !state.showTradeRoutes;
        elements.tradeRoutesToggleBtn.classList.toggle('active', state.showTradeRoutes);
        elements.tradeRoutesToggleBtn.textContent = `Торговые маршруты: ${state.showTradeRoutes ? 'показаны' : 'скрыты'}`;
        refreshTradeRouteOverlay();
    });

    elements.tradeRouteUndoBtn?.addEventListener('click', () => {
        if (state.tradeRouteDraft?.path.length > 1) state.tradeRouteDraft.path.pop();
        syncTradeRouteEditor();
    });
    elements.tradeRouteClearBtn?.addEventListener('click', () => {
        if (state.tradeRouteDraft) state.tradeRouteDraft.path = [state.tradeRouteDraft.sourceProvinceId];
        syncTradeRouteEditor();
    });
    elements.tradeRouteCancelBtn?.addEventListener('click', cancelTradeRouteSelection);
    elements.tradeRouteSaveBtn?.addEventListener('click', async () => {
        const draft = state.tradeRouteDraft;
        if (!draft || draft.path.at(-1) !== draft.destinationProvinceId) return;
        elements.tradeRouteSaveBtn.disabled = true;
        try {
            await saveStateTradeContractRoute(draft.contractId, draft.path);
            state.tradeRouteDraft = null;
            elements.tradeRouteEditor.hidden = true;
            state.economySnapshot = await fetchEconomySnapshot();
            refreshTradeRouteOverlay();
            showToast('Ручной торговый маршрут сохранён');
            await renderProductionConsumption(draft.owner, 'trade', draft.playerName);
        } catch (error) {
            showToast(`Не удалось сохранить маршрут: ${error.message}`);
            syncTradeRouteEditor();
        }
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
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#left-sidebar') || e.target.closest('#login-modal') || e.target.closest('#register-modal') || e.target.closest('#trade-route-editor')) return;

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
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#left-sidebar') || e.target.closest('#login-modal') || e.target.closest('#register-modal') || e.target.closest('#trade-route-editor')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        if (state.tradeRouteDraft) {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const pixel = elements.hiddenCtx.getImageData(imgX, imgY, 1, 1).data;
            const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();
            const province = state.provincesMeta[hex];
            if (province) addTradeRouteProvince(Number(province.id));
            else showToast('Выбери провинцию, а не море или пустую область');
            return;
        }

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
