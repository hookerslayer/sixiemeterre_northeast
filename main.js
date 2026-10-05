import { state, elements, COLOR_MAP_SRC, META_JSON_SRC, RIVERS_MAP_SRC, LAKES_MAP_SRC, SEAS_MAP_SRC, supabaseClient } from './config.js';
import { loadSupabaseData, fetchUserProfile, fetchStateMechanics, fetchGameCalendar, fetchEconomySnapshot } from './api.js';
import { renderActiveLayer, renderMarkers } from './render.js';
import { updateTransform, initEventListeners, updateAuthUI, renderGameCalendar, refreshTradeRouteOverlay } from './ui.js';
import { buildProvinceAdjacency, buildProvinceCentroids, buildWaterMarkerComponents } from './economyEngine.js';

const loadMapImage = src => new Promise(resolve => { const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src; });
const mapMaskToComponents = (image,kind) => {
    if(!image)return new Map();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    return buildWaterMarkerComponents(ctx.getImageData(0,0,canvas.width,canvas.height),canvas.width,canvas.height,state.dbMarkers,{kind,provinceMapImageData:state.provinceMapImageData,provinceMeta:state.provincesMeta});
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

    elements.layerCanvas.width = width;
    elements.layerCanvas.height = height;
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
    renderMarkers();
    initEventListeners();
    fetchGameCalendar().then(calendar => {
        state.gameCalendar = calendar;
        renderGameCalendar();
    }).catch(err => console.error('Ошибка загрузки игрового календаря:', err));
    fetchEconomySnapshot().then(snapshot => { state.economySnapshot = snapshot; refreshTradeRouteOverlay(); })
        .catch(err => console.error('Ошибка загрузки данных производства:', err));
    window.setInterval(async () => {
        try {
            const calendar = await fetchGameCalendar();
            if (calendar.turn !== state.gameCalendar?.turn || calendar.season !== state.gameCalendar?.season || calendar.year !== state.gameCalendar?.year) {
                state.gameCalendar = calendar;
                renderGameCalendar();
            }
        } catch (err) {
            console.error('Ошибка обновления игрового календаря:', err);
        }
    }, 60_000);

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
            state.currentUser = session.user;
            state.userProfile = await fetchUserProfile(session.user.id);
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
        }
        updateAuthUI();
    });
}).catch(err => {
    console.error('Ошибка инициализации данных:', err);
    elements.legendContent.innerHTML = 'Ошибка загрузки данных';
});
