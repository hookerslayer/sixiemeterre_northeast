import { state, elements, COLOR_MAP_SRC, META_JSON_SRC, RIVERS_MAP_SRC, LAKES_MAP_SRC, SEAS_MAP_SRC, supabaseClient } from './config.js';
import { loadSupabaseData, fetchUserProfile, fetchStateMechanics, fetchGameCalendar, fetchEconomySnapshot, fetchRegionalWeather, fetchMilitaryTerrainCells, fetchMilitaryGridCells, fetchMilitaryForces, fetchMilitaryFleets, fetchMilitaryStructures, fetchMilitaryColonizationMap } from './api.js?v=automatic-weather-20261015';
import { renderActiveLayer, renderMarkers, renderMilitaryGrid } from './render.js';
import { updateTransform, initEventListeners, updateAuthUI, renderGameCalendar, refreshTradeRouteOverlay } from './ui.js?v=military-ui-layout-20261015-modifier-nav';
import { buildProvinceAdjacency, buildProvinceCentroids, buildWaterMarkerComponents } from './economyEngine.js';

const loadMapImage = src => new Promise(resolve => { const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src; });
const mapMaskToComponents = (image,kind) => {
    if(!image)return new Map();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
    state[`${kind}MaskImageData`]=imageData;
    return buildWaterMarkerComponents(imageData,canvas.width,canvas.height,state.dbMarkers,{kind,provinceMapImageData:state.provinceMapImageData,provinceMeta:state.provincesMeta});
};

Promise.all([
    fetch(META_JSON_SRC).then(res => res.json()),
    new Promise(resolve => {
        elements.colorMapImage.onload = resolve;
        elements.colorMapImage.src = COLOR_MAP_SRC;
    }),
    loadSupabaseData(),
    loadMapImage(RIVERS_MAP_SRC),
    loadMapImage(LAKES_MAP_SRC),
    loadMapImage(SEAS_MAP_SRC)
]).then(([data, , , riversImage, lakesImage, seasImage]) => {
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
    const mapImageData = elements.hiddenCtx.getImageData(0, 0, width, height);
    state.provinceMapImageData = mapImageData;
    state.provinceAdjacency = buildProvinceAdjacency(mapImageData, width, height, state.provincesMeta);
    state.provinceCentroids = buildProvinceCentroids(mapImageData, width, height, state.provincesMeta);
    state.riverComponents = mapMaskToComponents(riversImage,'river');
    state.lakeComponents = mapMaskToComponents(lakesImage,'lake');
    state.seaComponents = mapMaskToComponents(seasImage,'sea');
    state.militaryWaterCoverage.clear();

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
    fetchMilitaryTerrainCells().then(rows => {
        state.militaryTerrainCells = new Map(rows.map(row => [`${row.cell_x},${row.cell_y}`, row]));
        renderMilitaryGrid();
    }).catch(err => console.info('Разметка военной местности пока не загружена:', err.message));
    fetchMilitaryGridCells().then(rows => {
        state.militaryGridCells = new Map(rows.map(row => [`${row.cell_x},${row.cell_y}`, row]));
        renderMilitaryGrid();
    }).catch(err => console.info('Геометрия военной сетки пока не синхронизирована:', err.message));
    fetchGameCalendar().then(calendar => {
        state.gameCalendar = calendar;
        renderGameCalendar();
        renderActiveLayer();
        return fetchRegionalWeather(calendar.turn).then(rows => { state.regionalWeather = rows; });
    }).catch(err => console.error('Ошибка загрузки игрового календаря:', err));
    fetchEconomySnapshot().then(snapshot => { state.economySnapshot = snapshot; renderActiveLayer(); refreshTradeRouteOverlay(); })
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
        if (state.currentUser?.id !== session?.user?.id) {
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
try {
                state.militaryStructures = await fetchMilitaryStructures();
                renderMilitaryGrid();
            } catch (err) { console.info('Полевые сооружения пока не загружены:', err.message); }
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
            state.militaryVisibleCells = new Set();
            renderMilitaryGrid();
        }
        updateAuthUI();
    });
}).catch(err => {
    console.error('Ошибка инициализации данных:', err);
    elements.legendContent.innerHTML = 'Ошибка загрузки данных';
});
