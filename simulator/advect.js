import { device, fullscreenQuad } from "./global.js";
import { deltaTime } from "./simulator.js";
import { settings } from "./settings.js";
import { padBuffer } from "./util.js";
import shaders from "./shaders.js";


// 1 vec2 of 4 byte floats + 1 float
const uboByteLength = padBuffer(2*4 + 4);

let pipeline;
const ubo = device.createBuffer({
    label: "Advect UBO",
    size:  uboByteLength,
    usage: GPUBufferUsage.UNIFORM |
           GPUBufferUsage.COPY_DST,
});;
export function init() {
    const shaderModule = device.createShaderModule({
        label: "Advect Shader Module",
        code: shaders.advect,
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding:    0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer:     {},
            },
            {
                binding:    1,
                visibility: GPUShaderStage.FRAGMENT,
                texture:    {
                    sampleType: "float"
                },
            },
            {
                binding:    2,
                visibility: GPUShaderStage.FRAGMENT,
                sampler:    { type: "filtering" },
            },
        ],
    });

    pipeline = device.createRenderPipeline({
        label:  "Advect Pipeline Descriptor",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: {
            module: shaderModule,
            entryPoint: "vertex_main",
            buffers: [fullscreenQuad.descriptor],
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragment_main",
            targets: [{
                format: settings.dataTextureFormat,
            }],
        },
        primitive: {
            topology: fullscreenQuad.topology,
        },
    });
}

export async function run(inTexture, inTextureSampler, outTexture) {
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
                resource: inTextureSampler,
            },
        ],
    });

    const commandEncoder = device.createCommandEncoder({ label: "Advect Command Encoder" });

    const uniforms = new ArrayBuffer(uboByteLength);
    const f32s  = new Float32Array([
        ...settings.dataResolution,
        deltaTime,
    ]);
    new Float32Array(uniforms).set(f32s, 0);
    device.queue.writeBuffer(ubo, 0, uniforms, 0, uniforms.byteLength);


    const renderPassDescriptor = {
        colorAttachments: [{
            clearValue: settings.clearColor,
            loadOp: "clear",
            storeOp: "store",
            view: outTexture.view,
        }],
    };

    // Start general render pass
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setVertexBuffer(0, fullscreenQuad.buffer);
    passEncoder.draw(fullscreenQuad.count);
    passEncoder.end();

    // Copy output data back to data texture
    commandEncoder.copyTextureToTexture(
        outTexture,
        inTexture,
        settings.dataResolution,
    );

    device.queue.submit([commandEncoder.finish()]);
}
