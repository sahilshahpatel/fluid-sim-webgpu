import { device, canvas, context } from "./global.js";
import { settings } from "./settings.js";

import * as advection from "./advect.js"
import * as forces    from "./forces.js";
import FluidRenderer  from "./renderer.js";


/* [[ Create required textures and samplers ]] */
let createDataTexture = (label, extraUsages) => {
    const texture = device.createTexture({
        label:  label,
        format: settings.dataTextureFormat,
        size:   settings.dataResolution,
        usage:  GPUTextureUsage.COPY_SRC | 
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.TEXTURE_BINDING |
                extraUsages,
    });

    return {
        texture: texture,
        view:    texture.createView()
    }
};
const dataTexture   = createDataTexture("dataTexture");
const outputTexture = createDataTexture(
    "outputTexture", 
    GPUTextureUsage.RENDER_ATTACHMENT |
    GPUTextureUsage.STORAGE_BINDING
);
const dataSampler   = device.createSampler({
    label:        "dataSampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter:    "linear",
    minFilter:    "linear",
});


/* [[ Set up pipelines ]] */
advection.init();
forces.init();


/* [[ Create renderer ]] */
const renderer = new FluidRenderer(device, canvas, settings);


//////////////////////////////////////////////////////////////////////////

async function update() {   
    advection.run(dataTexture, dataSampler, outputTexture);
    await device.queue.onSubmittedWorkDone();
    
    forces.run(dataTexture, outputTexture);
    await device.queue.onSubmittedWorkDone();
    
    await renderer.render(outputTexture.view);
    return device.queue.onSubmittedWorkDone();
}

export let deltaTime;
let lastTimestamp = performance.now();
let lastAnimationFrame;

function animate(timestamp, callback) {
    deltaTime = (timestamp - lastTimestamp) / 1e3;
    update().then(() => {
        if (callback) callback();
        lastAnimationFrame = requestAnimationFrame((timestamp) => {
            animate(timestamp, callback);
        });
    });
    lastTimestamp = timestamp;
}

export function start(callback) {
    animate(performance.now(), callback);
}

export function stop() {
    cancelAnimationFrame(lastAnimationFrame);
}
