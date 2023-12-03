import { device } from "./global.js";
import { deltaTime } from "./simulator.js";
import { settings } from "./settings.js";
import { padBuffer } from "./util.js";
import shaders from "./shaders.js";


/* [[ Create UBO ]] */
// 1 vec2f + 1 vec4f + 1 f32
const uboByteLength = padBuffer(2*4 + 4*4 + 4);
const ubo = device.createBuffer({
    label: "Jacobi UBO",
    size:  uboByteLength,
    usage: GPUBufferUsage.UNIFORM  |
    GPUBufferUsage.COPY_DST,
});


/* [[ Prep for pipeline setup ]] */
let pipeline;

export function init() {
    const shaderModule = device.createShaderModule({
        code: shaders.jacobi,
    });
    
    const bindGroupLayout = device.createBindGroupLayout({
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
                binding:        2,
                visibility:     GPUShaderStage.COMPUTE,
                storageTexture: {
                    format: settings.dataTextureFormat,
                },
            },
        ],
    });
    
    pipeline = device.createComputePipeline({
        label:  "Jacobi Pipline Descriptor",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });
}

export async function run(inTexture, outTexture, diffusionStrength) {
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding:  0,
                resource: {
                    buffer: ubo,
                },
            },
            {
                binding:  1,
                resource: inTexture.view,
            },
            {
                binding:  2,
                resource: outTexture.view,
            },
        ],
    });

    const commandEncoder = device.createCommandEncoder({ label: "Jacobi Command Encoder" });

    const uniforms = new ArrayBuffer(uboByteLength);
    const f32s  = new Float32Array([
        ...diffusionStrength,
        ...settings.dataResolution,
        deltaTime,
    ]);
    new Float32Array(uniforms).set(f32s, 0);
    device.queue.writeBuffer(ubo, 0, uniforms, 0, uniforms.byteLength);

    // Start general compute pass
    const cellCount = settings.dataResolution[0] * settings.dataResolution[1];
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(cellCount / settings.workgroupSize));
    passEncoder.end();

    // Copy output data back to data texture
    commandEncoder.copyTextureToTexture(
        outTexture,
        inTexture,
        settings.dataResolution,
    );

    device.queue.submit([commandEncoder.finish()]);
}