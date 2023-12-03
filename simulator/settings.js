export const settings = {
    renderResolution:          [800, 500],
    dataResolution:            [320, 200],
    dyeDiffusionStrength:      0.05,
    velocityDiffusionStrength: 0.05,
    diffusionIterations:       25,
    projectionIterations:      40,
    vorticityConfinement:      5,
    // As of now, webgpu doesn't allow filtering samplers for 32bit float textures
    dataTextureFormat:         "rgba16float",
    workgroupSize:             64,
    drawArrows:                false,
    clearColor:                { r: 0.0, g: 0.5, b: 1.0, a: 1.0 },
}

// TODO: support settings changes, including pipeline recompilation and flags for uniform-update-needed
// This may end up moving to index.js since it will include many html element interactions