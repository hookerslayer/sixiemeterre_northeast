export const SUPABASE_URL = 'https://kezhdhpkzkvgfmihpfko.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_L1bAVecjB7Ur1H-86F19WQ_cac_xq3H';
export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export const COLOR_MAP_SRC = 'color_map.png';
export const META_JSON_SRC = 'provinces_meta.json';

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
    isAddingMarkerMode: false,
    movingMarkerId: null,
    isDraggingMarker: false
};

export const elements = {
    viewport: document.getElementById('viewport'),
    mapWrapper: document.getElementById('map-wrapper'),
    layerCanvas: document.getElementById('layer-canvas'),
    layerCtx: document.getElementById('layer-canvas').getContext('2d'),
    highlightCanvas: document.getElementById('highlight-canvas'),
    highlightCtx: document.getElementById('highlight-canvas').getContext('2d'),
    markersCanvas: document.getElementById('markers-canvas'),
    markersCtx: document.getElementById('markers-canvas').getContext('2d'),
    labelsCanvas: document.getElementById('labels-canvas'),
    labelsCtx: document.getElementById('labels-canvas').getContext('2d'),
    popup: document.getElementById('popup'),
    popupContent: document.getElementById('popup-content'),
    popupClose: document.getElementById('popup-close'),
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
