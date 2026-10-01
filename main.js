import { state, elements, COLOR_MAP_SRC, META_JSON_SRC, supabaseClient } from './config.js';
import { loadSupabaseData, fetchUserProfile, fetchStateMechanics, fetchGameCalendar } from './api.js';
import { renderActiveLayer, renderMarkers } from './render.js';
import { updateTransform, initEventListeners, updateAuthUI, renderGameCalendar } from './ui.js';

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
    }

    const width = elements.colorMapImage.naturalWidth;
    const height = elements.colorMapImage.naturalHeight;

    elements.hiddenCanvas.width = width;
    elements.hiddenCanvas.height = height;
    elements.hiddenCtx.drawImage(elements.colorMapImage, 0, 0);

    elements.layerCanvas.width = width;
    elements.layerCanvas.height = height;
    elements.highlightCanvas.width = width;
    elements.highlightCanvas.height = height;
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
