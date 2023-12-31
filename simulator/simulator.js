import { device } from "./global.js";
import { settings } from "./settings.js";

import * as boundary from "./boundary.js"
import * as advection from "./advect.js";
import * as diffusion from "./diffusion.js";
import * as forces    from "./forces.js";
import * as renderer  from "./renderer.js";


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
// TODO: If we are going to have individual functions copy back
// from output to input, then we should export outputTexture from
// global.js and have the functions not have separate in vs. out
// parameters because the current method is confusing
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
diffusion.init();
forces.init();
boundary.init();
renderer.init();

//////////////////////////////////////////////////////////////////////////

async function update() {
    advection.run(dataTexture, dataSampler, outputTexture);
    await device.queue.onSubmittedWorkDone();

    diffusion.run(dataTexture, outputTexture);
    await device.queue.onSubmittedWorkDone();

    forces.run(dataTexture, outputTexture);
    await device.queue.onSubmittedWorkDone();

    boundary.run(dataTexture, outputTexture);
    await device.queue.onSubmittedWorkDone();

    await renderer.run(outputTexture.view);
    return device.queue.onSubmittedWorkDone();
}

export let deltaTime;
let lastTimestamp = performance.now();
let lastAnimationFrame = null;
let stopped = false;

function animate(timestamp, callback) {
    deltaTime = (timestamp - lastTimestamp) / 1e3;
    lastTimestamp = timestamp;

    // If it's been too long, start with a 0 second update
    // to avoid inaccuracies in the simulation
    // (this can be caused by switching tabs, not just pausing)
    if (deltaTime > 2) {
        deltaTime = 0;
    }

    update().then(() => {
        if (callback) callback();
        if (stopped == false){
            lastAnimationFrame = requestAnimationFrame((timestamp) => {
                animate(timestamp, callback);
            });
        }
    });
}

export function start(callback) {
    if (lastAnimationFrame != null) return;

    stopped = false;

    // Start with a 0 deltaTime frame to avoid jumps after pausing
    lastTimestamp = performance.now();
    animate(lastTimestamp, callback);
}

export function stop() {
    // Having a stopped variable catches async cases
    // where update is still running and changes lastAnimationFrame
    // during the cancel process

    stopped = true;
    cancelAnimationFrame(lastAnimationFrame);
    lastAnimationFrame = null;
}
