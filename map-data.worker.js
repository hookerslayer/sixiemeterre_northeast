import { buildProvinceAdjacency, buildProvinceCentroids, buildWaterMarkerComponents } from './economyEngine.js';

async function readImage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Не удалось загрузить слой карты: ${response.status}`);
    return createImageBitmap(await response.blob());
}

function readPixels(bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

function serializeComponents(components) {
    const network = components.network;
    return {
        entries: [...components.entries()],
        network: {
            kind: network.kind,
            width: network.width,
            height: network.height,
            cellSize: network.cellSize,
            gridWidth: network.gridWidth,
            gridHeight: network.gridHeight,
            labels: network.labels,
            provinceGrid: network.provinceGrid
        }
    };
}

self.onmessage = async ({ data }) => {
    try {
        const colorBitmap = await readImage(data.colorMapUrl);
        const width = colorBitmap.width, height = colorBitmap.height;
        const provincePixels = readPixels(colorBitmap);
        const adjacency = buildProvinceAdjacency(provincePixels, width, height, data.provincesMeta);
        const centroids = buildProvinceCentroids(provincePixels, width, height, data.provincesMeta);
        const components = {};
        const transfers = [];

        for (const kind of ['river', 'lake', 'sea']) {
            const bitmap = await readImage(data.waterUrls[kind]);
            const pixels = readPixels(bitmap);
            const result = buildWaterMarkerComponents(pixels, width, height, data.markers, {
                kind,
                cellSize: 4,
                attachRadius: 10,
                provinceMapImageData: provincePixels,
                provinceMeta: data.provincesMeta
            });
            components[kind] = serializeComponents(result);
            transfers.push(result.network.labels.buffer, result.network.provinceGrid.buffer);
        }

        self.postMessage({
            type: 'complete',
            adjacency: [...adjacency].map(([id, neighbors]) => [id, [...neighbors]]),
            centroids: [...centroids],
            components
        }, transfers);
    } catch (error) {
        self.postMessage({ type: 'error', message: error?.message || String(error) });
    }
};
