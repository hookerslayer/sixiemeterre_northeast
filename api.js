import { supabaseClient, state } from './config.js';

export async function loadSupabaseData() {
    const [resProvinces, resRegions, resOwners, resMarkers, resCultures, resReligions] = await Promise.all([
        supabaseClient.from('Provinces').select('*'),
        supabaseClient.from('region_color').select('*'),
        supabaseClient.from('owner_color').select('*'),
        supabaseClient.from('markers').select('*'),
        supabaseClient.from('culture_color').select('*'),
        supabaseClient.from('religion_color').select('*')
    ]);

    if (resProvinces.data) {
        resProvinces.data.forEach(row => state.dbProvinces[row.id] = row);
    }
    if (resRegions.data) {
        resRegions.data.forEach(row => {
            if (row.region && row.region_color) state.dbRegionColors[row.region] = row.region_color;
        });
    }
    if (resOwners.data) {
        resOwners.data.forEach(row => {
            if (row.owner && row.owner_color) state.dbOwnerColors[row.owner] = row.owner_color;
        });
    }
    if (resMarkers.data) {
        state.dbMarkers = resMarkers.data;
    }
    if (resCultures.data) {
        resCultures.data.forEach(row => {
            if (row.culture && row.culture_color) state.dbCultureColors[row.culture] = row.culture_color;
        });
    }
    if (resReligions.data) {
        resReligions.data.forEach(row => {
            if (row.religion && row.religion_color) state.dbReligionColors[row.religion] = row.religion_color;
        });
    }
}