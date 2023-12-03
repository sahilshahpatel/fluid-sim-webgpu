import { device, canvas, context, fullscreenQuad } from "./global.js"
import { settings } from "./settings.js";
import { padBuffer } from "./util.js";
import shaders from "./shaders.js";


/* [[ Create required uniform buffer objects ]] */
const uboByteLength = padBuffer(2*2*4); // 2 vec2 of 4 byte floats

const ubo = device.createBuffer({
    label: "Render UBO",
    size:  uboByteLength,
    usage: GPUBufferUsage.UNIFORM |
           GPUBufferUsage.COPY_DST,
});


/* [[ Create required textures and samplers ]] */
// Data texture will be render function input
const dataSampler   = device.createSampler({
    label:        "dataSampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter:    "linear",
    minFilter:    "linear",
});


/* [[ Prepare for pipeline setup ]] */
let pipeline;

export function init() {
    [canvas.width, canvas.height] = settings.renderResolution;

    const shaderModule = device.createShaderModule({
        code: shaders.render,
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

    const pipelineDescriptor = {
        label:  "Render Pipeline Descriptor",
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
                format: navigator.gpu.getPreferredCanvasFormat(),
            }],
        },
        primitive: {
            topology: fullscreenQuad.topology,
        },
    };

    pipeline = device.createRenderPipeline(pipelineDescriptor);
}

export async function run(textureView) {
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
                resource: textureView,
            },
            {
                binding:  2,
                resource: dataSampler,
            },
        ],
    });

    const commandEncoder = device.createCommandEncoder({ label: "Render Command Encoder" });

    const uniforms = new ArrayBuffer(uboByteLength);
    const f32s  = new Float32Array([
        ...settings.renderResolution,
        ...settings.dataResolution,
    ]);
    new Float32Array(uniforms).set(f32s, 0);
    device.queue.writeBuffer(ubo, 0, uniforms, 0, uniforms.byteLength);

    const renderPassDescriptor = {
        colorAttachments: [{
            clearValue: settings.clearColor,
            loadOp: "clear",
            storeOp: "store",
            view: context.getCurrentTexture().createView(),
        }],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setVertexBuffer(0, fullscreenQuad.buffer);
    passEncoder.draw(fullscreenQuad.count);
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
}