import { device } from "./global.js";
import { settings } from "./settings.js";

import * as jacobi from "./jacobi.js";

export function init() {
    jacobi.init();
}

export async function run(inTexture, outTexture) {
    for (let i = 0; i < settings.diffusionIterations; i++) {
        jacobi.run(
            inTexture,
            outTexture,
            [
                settings.dyeDiffusionStrength,
                settings.velocityDiffusionStrength,
                settings.velocityDiffusionStrength,
                0,
            ]
        );
        await device.queue.onSubmittedWorkDone();
    }
}