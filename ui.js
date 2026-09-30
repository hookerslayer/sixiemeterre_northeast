import { state, elements, markerImages, MARKER_TYPES } from './config.js';
import { renderActiveLayer, renderMarkers, highlightProvince, renderIDs } from './render.js';
import { signUpUser, signInUser, signOutUser, updateProvinceData, createMarkerData, updateMarkerData, deleteMarkerData } from './api.js';

let toastTimeout = null;

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

    const settlements = state.dbMarkers.filter(m => Number(m.province_id) === Number(info.id));
    const settlementsYards = settlements.reduce((acc, m) => acc + (Number(m.yards) || 0), 0);
    const totalYards = provYards + settlementsYards;
    const totalPop = totalYards * 4;

    const provRatio = state.dbEstateRatios['province'];
    const estates = calculateEstatesBreakdown(provYards, provRatio);

    const isAdmin = state.userProfile?.role === 'admin';

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
                yards: parseInt(document.getElementById('admin-prov-yards').value, 10) || 0
            };

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
            Ресурс: ${resource}<br>
            Площадь: ${info.area} px<br>
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
    const pop = yards * 4;
    const ratio = state.dbEstateRatios[marker.type];
    const estates = calculateEstatesBreakdown(yards, ratio);

    const isAdmin = state.userProfile?.role === 'admin';

    if (isAdmin) {
        const optionsHtml = MARKER_TYPES.map(t => `<option value="${t}" ${t === marker.type ? 'selected' : ''}>${t}</option>`).join('');
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
                <label>Количество дворов:
                    <input type="number" id="admin-marker-yards" value="${yards}">
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

        document.getElementById('admin-marker-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const provIdVal = document.getElementById('admin-marker-prov-id').value;
            const updatedFields = {
                name: document.getElementById('admin-marker-name').value.trim(),
                owner: document.getElementById('admin-marker-owner').value.trim(),
                type: document.getElementById('admin-marker-type').value,
                province_id: provIdVal ? parseInt(provIdVal, 10) : null,
                yards: parseInt(document.getElementById('admin-marker-yards').value, 10) || 0,
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
            Владелец: ${marker.owner || '—'}<br>
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

    const optionsHtml = MARKER_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
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
            <label>Количество дворов:
                <input type="number" id="new-marker-yards" value="0">
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

    document.getElementById('admin-new-marker-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const provIdVal = document.getElementById('new-marker-prov-id').value;
        const markerData = {
            name: document.getElementById('new-marker-name').value.trim(),
            type: document.getElementById('new-marker-type').value,
            province_id: provIdVal ? parseInt(provIdVal, 10) : null,
            yards: parseInt(document.getElementById('new-marker-yards').value, 10) || 0,
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

export function renderNavMenu() {
    if (!elements.navDropdownMenu) return;

    const isAdmin = state.userProfile?.role === 'admin';
    const isAuth = !!state.currentUser;
    const hasOwner = !!state.userProfile?.owner;

    let items = [];

    if (isAdmin) {
        items = [
            { id: 'nav-map', label: 'Карта' },
            { id: 'nav-stats', label: 'Статистика' },
            { id: 'nav-rules', label: 'Правила и механики' }
        ];
    } else if (!isAuth) {
        items = [
            { id: 'nav-rules', label: 'Правила и механики' },
            { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }
        ];
    } else if (isAuth && !hasOwner) {
        items = [
            { id: 'nav-register-state', label: 'Регистрация' },
            { id: 'nav-rules', label: 'Правила и механики' },
            { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }
        ];
    } else if (isAuth && hasOwner) {
        items = [
            { id: 'nav-map', label: 'Карта' },
            { id: 'nav-stats', label: 'Статистика' },
            { id: 'nav-cities', label: 'Города' },
            { id: 'nav-provinces', label: 'Провинции' },
            { id: 'nav-military', label: 'Военное дело' },
            { id: 'nav-modifiers', label: 'Модификаторы' },
            { id: 'nav-rules', label: 'Правила и механики' },
            { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }
        ];
    }

    elements.navDropdownMenu.innerHTML = items.map(item => `
        <button class="nav-menu-item" data-id="${item.id}" ${item.externalUrl ? `data-url="${item.externalUrl}"` : ''}>
            ${item.label}
        </button>
    `).join('');

    elements.navDropdownMenu.querySelectorAll('.nav-menu-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.url;
            const id = e.currentTarget.dataset.id;
            if (url) {
                window.open(url, '_blank');
            } else if (id === 'nav-register-state') {
                elements.registerModal?.classList.add('active');
            }
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
    } else {
        elements.adminControls.style.display = 'none';
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
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#legend-panel') || e.target.closest('#login-modal') || e.target.closest('#register-modal') || e.target.closest('#open-login-btn')) return;

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
        if (!elements.viewport) return;
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
        if (state.dragDistance > 5) return;
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#legend-panel') || e.target.closest('#login-modal') || e.target.closest('#register-modal') || e.target.closest('#open-login-btn')) return;

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
