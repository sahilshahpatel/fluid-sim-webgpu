import { device, canvas, context } from "./global.js";
import { settings } from "./settings.js";
import * as advection from "./advect.js"
import FluidRenderer from "./renderer.js";


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


/* [[ Create renderer ]] */
const renderer = new FluidRenderer(device, canvas, settings);


/* [[ Setup animation ]] */
async function update() {     
    await advection.run(dataTexture, dataSampler, outputTexture);
    await device.queue.onSubmittedWorkDone();
    await renderer.render(outputTexture.view);
    return device.queue.onSubmittedWorkDone();
}

export let deltaTime;
let lastTimestamp = performance.now();
let lastAnimationFrame;

function animate(timestamp) {
    deltaTime = timestamp - lastTimestamp;
    update(deltaTime).then(() => {
        lastAnimationFrame = requestAnimationFrame(animate);
    });
    lastTimestamp = timestamp;
}

export function start() {
    animate(performance.now());
}

export function stop() {
    cancelAnimationFrame(lastAnimationFrame);
}


function initCompute() {
    const computeShader = `
    struct UBO {
        resolution: vec2f,
        lastMousePos: vec2f,
        mousePos: vec2f,
        mouseVel: vec2f,
        deltaTime: f32,
    }
    @group(0) @binding(0)
    var<uniform> ubo: UBO;

    @group(0) @binding(1)
    var data: texture_2d<f32>;

    @group(0) @binding(2)
    var dataSampler: sampler;

    @group(0) @binding(3)
    var output: texture_storage_2d<${this.settings.dataTextureFormat}, write>;

    // From https://iquilezles.org/articles/distfunctions2d/
    fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32
    {
        var pa: vec2f = p-a;
        var ba: vec2f = b-a;
        var h: f32 = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
        return length( pa - ba*h );
    }

    @compute @workgroup_size(${this.settings.workgroupSize})
    fn main(
        @builtin(global_invocation_id)
        global_id: vec3u,
    ) {
        // Calculate texture coordinates
        var id: u32    = global_id.x;
        var width: u32 = u32(ubo.resolution.x);
        var xy         = vec2u(id % width, id / width);
        var uv: vec2f  = vec2f(xy) / ubo.resolution;

        // Paint with user interaction
        var out = vec4f(0);
        var mouseDist = sdSegment(vec2f(xy), ubo.mousePos, ubo.lastMousePos);
        var affect: f32 = 1 - smoothstep(0, 5, mouseDist);
        out.z = affect;
        // out.xy = ubo.mouseVel * affect;

        // Recall previous data
        var previous: vec4<f32> = textureLoad(data, xy, 0);

        // Advect
        var sourceUV = (vec2f(xy) - previous.xy) / ubo.resolution;
        // var fluid = textureSample(data, dataSampler, sourceUV);

        out.z = max(out.z, previous.z);
        // out.xy

        textureStore(output, xy, out);
    }
    `;

    const shaderModule = this.device.createShaderModule({
        code: computeShader,
    });
    
    const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
            {
                binding:    0,
                visibility: GPUShaderStage.COMPUTE,
                buffer:     {},
            },
            {
                binding:    1,
                visibility: GPUShaderStage.COMPUTE,
                texture:    {
                    sampleType: "float"
                },
            },
            {
                binding:    2,
                visibility: GPUShaderStage.COMPUTE,
                sampler:    { type: "filtering" },
            },
            {
                binding:        3,
                visibility:     GPUShaderStage.COMPUTE,
                storageTexture: {
                    format: this.settings.dataTextureFormat,
                },
            },
        ],
    });
    
    this.pipelines.compute = this.device.createComputePipeline({
        label:  "Compute Pipline Descriptor",
        layout: this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });
}

async function compute(deltaTime) {
    const bindGroup = this.device.createBindGroup({
        layout: this.pipelines.compute.getBindGroupLayout(0),
        entries: [
            {
                binding:  0,
                resource: {
                    buffer: this.ubo,
                },
            },
            {
                binding:  1,
                resource: this.dataTexture.view,
            },
            {
                binding:  2,
                resource: this.dataSampler,
            },
            {
                binding:  3,
                resource: this.outputTexture.view,
            }
        ],
    });

    const cellCount      = this.settings.dataResolution[0] * this.settings.dataResolution[1];
    const commandEncoder = this.device.createCommandEncoder({ label: "Compute Command Encoder" });

    // Uniforms must be ready before we can submit
    const uniforms = [
        ...this.settings.dataResolution,
        ...this.mouseTracker.lastPosition,
        ...this.mouseTracker.position,
        ...this.mouseTracker.velocity,
        deltaTime,
    ]
    if (await this.setUniforms(uniforms)) {
        // Copy UBO data from staging buffer to uniform buffer
        commandEncoder.copyBufferToBuffer(
            this.stagingBuffer, 0,
            this.ubo,    0,
            this.uboByteLength,
        );
    }

    // Start general compute pass
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipelines.compute);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(cellCount / this.settings.workgroupSize));
    passEncoder.end();

    // Copy output data back to data texture
    commandEncoder.copyTextureToTexture(
        this.outputTexture,
        this.dataTexture,
        this.settings.dataResolution,
    );

    device.queue.submit([commandEncoder.finish()]);
}
