export const canvas = document.querySelector("canvas");
export const context = canvas.getContext("webgpu");

/* [[ WebGPU Setup ]] */
if (!navigator.gpu) {
    throw Error("WebGPU not supported.");
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
    throw Error("Couldn't request WebGPU adapter.");
}

export const device = await adapter.requestDevice();

context.configure({
    device:    device,
    format:    navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
});


/* [[ Fullscreen quad VAO ]] */
export const fullscreenQuad = {};
fullscreenQuad.vertices = new Float32Array([
    -1, -1, 0, 1,
    -1, +1, 0, 1,
    +1, -1, 0, 1,
    +1, +1, 0, 1,
]);
fullscreenQuad.count    = 4;
fullscreenQuad.topology = "triangle-strip";

fullscreenQuad.buffer = device.createBuffer({
    size:  fullscreenQuad.vertices.byteLength, // make it big enough to store vertices in
    usage: GPUBufferUsage.VERTEX |
            GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(fullscreenQuad.buffer, 0, fullscreenQuad.vertices, 0, fullscreenQuad.vertices.length);

fullscreenQuad.descriptor = {
    attributes: [{
        shaderLocation: 0, // position
        offset:         0,
        format:         "float32x4",
    }],
    arrayStride: fullscreenQuad.vertices.length / fullscreenQuad.count * 4,
    stepMode:    "vertex",
};