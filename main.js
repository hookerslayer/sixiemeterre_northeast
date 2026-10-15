import { state, elements, COLOR_MAP_SRC, META_JSON_SRC, RIVERS_MAP_SRC, LAKES_MAP_SRC, SEAS_MAP_SRC, supabaseClient } from './config.js?v=admin-state-management-20261015';
import { loadSupabaseData, fetchUserProfile, fetchStateMechanics, fetchGameCalendar, fetchEconomySnapshot, fetchRegionalWeather, fetchMilitaryTerrainCells, fetchMilitaryGridCells, fetchMilitaryForces, fetchMilitaryFleets, fetchMilitaryStructures, fetchMilitarySieges, fetchMilitaryColonizationMap } from './api.js?v=admin-state-management-20261015';
import { renderActiveLayer, renderMarkers, renderMilitaryGrid } from './render.js?v=admin-state-management-20261015';
import { updateTransform, initEventListeners, updateAuthUI, renderGameCalendar, refreshTradeRouteOverlay, refreshSelectedMilitaryReach } from './ui.js?v=admin-state-management-20261015';

Promise.all([
    fetch(META_JSON_SRC).then(res => res.json()),
    new Promise(resolve => {
        elements.colorMapImage.onload = resolve;
        elements.colorMapImage.src = COLOR_MAP_SRC;
    }),
    loadSupabaseData()
]).then(([data]) => {
    state.provincesMeta = data;

    for (const [hex, info] of Object.entries(state.provincesMeta)) {
        state.idToHexMap[info.id] = hex;
        state.provinceRgbToId[Number.parseInt(hex.slice(1), 16)] = Number(info.id);
    }

    const width = elements.colorMapImage.naturalWidth;
    const height = elements.colorMapImage.naturalHeight;

    elements.hiddenCanvas.width = width;
    elements.hiddenCanvas.height = height;
    elements.hiddenCtx.drawImage(elements.colorMapImage, 0, 0);
    elements.layerCanvas.width = width;
    elements.layerCanvas.height = height;
    elements.militaryGridCanvas.width = width;
    elements.militaryGridCanvas.height = height;
    elements.highlightCanvas.width = width;
    elements.highlightCanvas.height = height;
    elements.tradeRoutesCanvas.width = width;
    elements.tradeRoutesCanvas.height = height;
    elements.markersCanvas.width = width;
    elements.markersCanvas.height = height;
    elements.labelsCanvas.width = width;
    elements.labelsCanvas.height = height;

    const scaleX = window.innerWidth / width;
    const scaleY = window.innerHeight / height;
    state.minScale = Math.min(scaleX, scaleY) * 0.95;
    state.scale = state.minScale;

    state.tx = (window.innerWidth - width * state.scale) / 2;
    state.ty = (window.innerHeight - height * state.scale) / 2;

    updateTransform();
    renderActiveLayer();
    renderMilitaryGrid();
    renderMarkers();
    initEventListeners();
    const topologyWorker = new Worker(new URL('./map-data.worker.js', import.meta.url), { type: 'module' });
    topologyWorker.onmessage = ({ data: result }) => {
        topologyWorker.terminate();
        if (result.type === 'error') {
            console.error('Не удалось подготовить данные маршрутов:', result.message);
            return;
        }
        state.provinceAdjacency = new Map(result.adjacency.map(([id, neighbors]) => [id, new Set(neighbors)]));
        state.provinceCentroids = new Map(result.centroids);
        for (const kind of ['river', 'lake', 'sea']) {
            const serialized = result.components[kind];
            const components = new Map(serialized.entries);
            components.network = serialized.network;
            state[`${kind}Components`] = components;
        }
        state.militaryWaterCoverage.clear();
        if (state.showTradeRoutes || state.tradeRouteDraft) refreshTradeRouteOverlay();
    };
    topologyWorker.onerror = error => {
        topologyWorker.terminate();
        console.error('Ошибка фоновой подготовки данных карты:', error.message || error);
    };
    topologyWorker.postMessage({
        colorMapUrl: new URL(COLOR_MAP_SRC, document.baseURI).href,
        waterUrls: {
            river: new URL(RIVERS_MAP_SRC, document.baseURI).href,
            lake: new URL(LAKES_MAP_SRC, document.baseURI).href,
            sea: new URL(SEAS_MAP_SRC, document.baseURI).href
        },
        provincesMeta: state.provincesMeta,
        markers: state.dbMarkers
    });
    fetchMilitaryTerrainCells().then(rows => {
        state.militaryTerrainCells = new Map(rows.map(row => [`${row.cell_x},${row.cell_y}`, row]));
        renderMilitaryGrid();
        refreshSelectedMilitaryReach();
    }).catch(err => console.info('Разметка военной местности пока не загружена:', err.message));
    fetchMilitaryGridCells().then(rows => {
        state.militaryGridCells = new Map(rows.map(row => [`${row.cell_x},${row.cell_y}`, row]));
        renderMilitaryGrid();
        refreshSelectedMilitaryReach();
    }).catch(err => console.info('Геометрия военной сетки пока не синхронизирована:', err.message));
    fetchGameCalendar().then(calendar => {
        state.gameCalendar = calendar;
        renderGameCalendar();
        return fetchRegionalWeather(calendar.turn).then(rows => { state.regionalWeather = rows; });
    }).catch(err => console.error('Ошибка загрузки игрового календаря:', err));
    fetchEconomySnapshot().then(snapshot => { state.economySnapshot = snapshot; renderActiveLayer(); if (state.showTradeRoutes) refreshTradeRouteOverlay(); })
        .catch(err => console.error('Ошибка загрузки данных производства:', err));
    fetchMilitaryColonizationMap().then(missions => {
        state.militaryColonizationMap = missions;
        renderActiveLayer();
    }).catch(err => console.info('Публичная карта колонизаций пока недоступна (примените миграцию military_admin_roads_and_public_colonization_map.sql):', err.message));
    window.setInterval(async () => {
        try {
            const calendar = await fetchGameCalendar();
            if (calendar.turn !== state.gameCalendar?.turn || calendar.season !== state.gameCalendar?.season || calendar.year !== state.gameCalendar?.year) {
                state.gameCalendar = calendar;
                renderGameCalendar();
                try { state.economySnapshot = await fetchEconomySnapshot(); renderActiveLayer(); }
                catch (err) { console.info('Не удалось обновить состояние бунтов на карте:', err.message); }
                try { state.regionalWeather = await fetchRegionalWeather(calendar.turn); }
                catch (err) { console.info('Не удалось обновить погодные условия:', err.message); }
                try { state.militaryColonizationMap = await fetchMilitaryColonizationMap(); renderActiveLayer(); }
                catch (err) { console.info('Не удалось обновить отображение активных колонизаций:', err.message); }
            }
        } catch (err) {
            console.error('Ошибка обновления игрового календаря:', err);
        }
    }, 60_000);

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            elements.loginModal?.classList.remove('active');
            elements.passwordRecoveryModal?.classList.add('active');
            elements.passwordRecoveryModal?.setAttribute('aria-hidden', 'false');
        }
        if (state.currentUser?.id !== session?.user?.id) {
            state.militarySelectedForceId = null;
            state.militaryMoveMode = false;
            state.militaryReachableCells = new Set();
            state.militaryMoveDraft = null;
            state.militarySieges = [];
            state.pendingMilitaryPlacement = null;
            state.pendingMilitaryStructure = null;
            state.pendingMilitaryMobilization = null;
            state.pendingMilitaryFleetLaunch = null;
            state.militarySelectedFleetId = null;
            state.militaryFleetMoveDraft = null;
            document.body.classList.remove('military-army-placement', 'military-terrain-editing');
            if (elements.cancelMilitaryPlacementBtn) elements.cancelMilitaryPlacementBtn.style.display = 'none';
            state.editingMilitaryTerrain = false;
            elements.militaryTerrainEditBtn?.classList.remove('active');
            elements.militaryTerrainEditBtn?.setAttribute('aria-pressed', 'false');
            if (elements.militaryTerrainEditBtn) elements.militaryTerrainEditBtn.textContent = 'Разметка военной карты: выкл.';
        }
        if (session?.user) {
            state.currentUser = session.user;
            state.userProfile = await fetchUserProfile(session.user.id);
            try {
                state.militaryForces = await fetchMilitaryForces();
                state.militaryFleets = await fetchMilitaryFleets();
                renderMilitaryGrid();
            } catch (err) { console.info('Постоянные военные силы пока не загружены:', err.message); }
            const [structuresResult, siegesResult] = await Promise.allSettled([fetchMilitaryStructures(), fetchMilitarySieges()]);
            if (structuresResult.status === 'fulfilled') state.militaryStructures = structuresResult.value;
            else console.info('Полевые сооружения пока не загружены:', structuresResult.reason?.message);
            if (siegesResult.status === 'fulfilled') state.militarySieges = siegesResult.value;
            else console.info('Состояние осад пока не загружено:', siegesResult.reason?.message);
            renderMilitaryGrid();
            if (state.userProfile?.owner) {
                try {
                    state.stateMechanics[state.userProfile.owner] = await fetchStateMechanics(state.userProfile.owner) || {};
                } catch (err) {
                    console.error('Ошибка загрузки механик государства:', err);
                }
            }
        } else {
            state.currentUser = null;
            state.userProfile = null;
            state.stateMechanics = {};
            state.militaryForces = [];
            state.militaryStructures = [];
            state.militarySieges = [];
            state.militaryVisibleCells = new Set();
            renderMilitaryGrid();
        }
        updateAuthUI();
    });
}).catch(err => {
    console.error('Ошибка инициализации данных:', err);
    elements.legendContent.innerHTML = 'Ошибка загрузки данных';
});
