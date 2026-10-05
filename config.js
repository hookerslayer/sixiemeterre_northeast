export const SUPABASE_URL = 'https://kezhdhpkzkvgfmihpfko.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_L1bAVecjB7Ur1H-86F19WQ_cac_xq3H';
export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export const COLOR_MAP_SRC = 'color_map.png';
export const META_JSON_SRC = 'provinces_meta.json';
export const RIVERS_MAP_SRC = 'rivers.png';
export const LAKES_MAP_SRC = 'lake.png';
export const SEAS_MAP_SRC = 'sea.png';

export const MARKER_TYPES = ['large_city', 'city', 'monastery', 'fortress', 'ruins'];
export const markerImages = {};
MARKER_TYPES.forEach(type => {
    markerImages[type] = new Image();
    markerImages[type].src = `${type}.png`;
});

export const state = {
    provincesMeta: {},
    idToHexMap: {},
    dbProvinces: {},
    dbRegionColors: {},
    dbOwnerColors: {},
    dbCultureColors: {},
    dbReligionColors: {},
    dbResourceColors: {},
    dbEstateRatios: {},
    dbMarkers: [],
    activeLayer: 'political',
    showMarkerNames: true,
    visibleMarkerTypes: {
        large_city: true,
        city: true,
        monastery: true,
        fortress: true,
        ruins: true
    },
    trackerActive: false,
    trackerPos: { x: 0, y: 0 },
    isDraggingTracker: false,
    activePopupType: null,
    scale: 1,
    tx: 0,
    ty: 0,
    minScale: 0.1,
    isDragging: false,
    startX: 0,
    startY: 0,
    dragDistance: 0,
    selectedImgX: null,
    selectedImgY: null,
    showIDs: false,
    currentUser: null,
    userProfile: null,
    gameCalendar: null,
    stateMechanics: {},
    provinceAdjacency: new Map(),
    provinceCentroids: new Map(),
    provinceMapImageData: null,
    riverComponents: new Map(),
    lakeComponents: new Map(),
    seaComponents: new Map(),
    economySnapshot: null,
    showTradeRoutes: false,
    tradeRouteOverlay: [],
    tradeRouteDraft: null,
    isAddingMarkerMode: false,
    movingMarkerId: null,
    isDraggingMarker: false
};

export const elements = {
    viewport: document.getElementById('viewport'),
    mapWrapper: document.getElementById('map-wrapper'),
    burgerMenuBtn: document.getElementById('burger-menu-btn'),
    navDropdownMenu: document.getElementById('nav-dropdown-menu'),
    layerCanvas: document.getElementById('layer-canvas'),
    layerCtx: document.getElementById('layer-canvas').getContext('2d'),
    tradeRoutesCanvas: document.getElementById('trade-routes-canvas'),
    tradeRoutesCtx: document.getElementById('trade-routes-canvas').getContext('2d'),
    highlightCanvas: document.getElementById('highlight-canvas'),
    highlightCtx: document.getElementById('highlight-canvas').getContext('2d'),
    markersCanvas: document.getElementById('markers-canvas'),
    markersCtx: document.getElementById('markers-canvas').getContext('2d'),
    labelsCanvas: document.getElementById('labels-canvas'),
    labelsCtx: document.getElementById('labels-canvas').getContext('2d'),
    popup: document.getElementById('popup'),
    popupContent: document.getElementById('popup-content'),
    popupClose: document.getElementById('popup-close'),
    pageView: document.getElementById('page-view'),
    gameTurnLabel: document.getElementById('game-turn-label'),
    advanceTurnBtn: document.getElementById('advance-turn-btn'),
    toastNotification: document.getElementById('toast-notification'),
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    toggleIdsBtn: document.getElementById('toggle-ids-btn'),
    trackerBtn: document.getElementById('tracker-btn'),
    toggleMarkerNamesBtn: document.getElementById('toggle-marker-names-btn'),
    legendPanel: document.getElementById('legend-panel'),
    controlsPanel: document.getElementById('controls-panel'),
    legendToggleBtn: document.getElementById('legend-toggle-btn'),
    controlsToggleBtn: document.getElementById('controls-toggle-btn'),
    tradeRoutesToggleBtn: document.getElementById('toggle-trade-routes-btn'),
    tradeRouteEditor: document.getElementById('trade-route-editor'),
    tradeRouteEditorStatus: document.getElementById('trade-route-editor-status'),
    tradeRouteUndoBtn: document.getElementById('trade-route-undo-btn'),
    tradeRouteClearBtn: document.getElementById('trade-route-clear-btn'),
    tradeRouteSaveBtn: document.getElementById('trade-route-save-btn'),
    tradeRouteCancelBtn: document.getElementById('trade-route-cancel-btn'),
    legendContent: document.getElementById('legend-content'),
    layerButtons: document.querySelectorAll('.layer-btn'),
    markerTypeCheckboxes: document.querySelectorAll('.marker-type-checkbox'),
    openLoginBtn: document.getElementById('open-login-btn'),
    loginModal: document.getElementById('login-modal'),
    loginModalClose: document.getElementById('login-modal-close'),
    authEmailInput: document.getElementById('auth-email'),
    authPasswordInput: document.getElementById('auth-password'),
    authLoginBtn: document.getElementById('auth-login-btn'),
    openRegisterBtn: document.getElementById('open-register-btn'),
    registerModal: document.getElementById('register-modal'),
    registerModalClose: document.getElementById('register-modal-close'),
    regNicknameInput: document.getElementById('reg-nickname'),
    regEmailInput: document.getElementById('reg-email'),
    regPasswordInput: document.getElementById('reg-password'),
    regPasswordConfirmInput: document.getElementById('reg-password-confirm'),
    regSubmitBtn: document.getElementById('reg-submit-btn'),
    adminControls: document.getElementById('admin-controls'),
    addMarkerModeBtn: document.getElementById('add-marker-mode-btn'),
    hiddenCanvas: document.createElement('canvas'),
    colorMapImage: new Image()
};
elements.hiddenCtx = elements.hiddenCanvas.getContext('2d', { willReadFrequently: true });
