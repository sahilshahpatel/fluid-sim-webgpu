import { device, context, fullscreenQuad } from "./global.js";
import { deltaTime } from "./simulator.js";
import { settings } from "./settings.js";
import mouseTracker from "../mouseTracker.js"


// 1 vec2 of 4 byte floats + 1 float
const uboByteLength = Math.ceil((2*4 + 4) / 16) * 16;

const shader = `
struct UBO {
    resolution:   vec2f,
    deltaTime:    f32,
}
@group(0) @binding(0)
var<uniform> ubo: UBO;

@group(0) @binding(1)
var data: texture_2d<f32>;

@group(0) @binding(2)
var dataSampler: sampler;

// From https://iquilezles.org/articles/distfunctions2d/
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32
{
    var pa: vec2f = p-a;
    var ba: vec2f = b-a;
    var h: f32 = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
    return length( pa - ba*h );
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0)       uv:       vec2f
}

@vertex
fn vertex_main(@location(0) position: vec4f) -> VertexOut
{
    var output: VertexOut;
    output.position = position;
    // We flip the Y axis because graphics and compute pipelines have different origins
    // TODO: is this comment correct?
    output.uv = 0.5*position.xy*vec2f(1, -1) + 0.5;
    return output;
}

@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f
{
    // Calculate texture coordinates
    var uv: vec2f = fragData.uv;
    var xy: vec2f = uv * ubo.resolution;
    
    // Load previous frame's data
    var previous: vec4f = textureLoad(data, vec2u(xy), 0);

    // Advect
    var sourceUV = (xy - previous.yz * ubo.deltaTime) / ubo.resolution;
    var advected = textureSample(data, dataSampler, sourceUV);

    return advected;
}`;

let pipeline;
const ubo = device.createBuffer({
    label: "Advect UBO",
    size:  uboByteLength,
    usage: GPUBufferUsage.UNIFORM  |
            GPUBufferUsage.COPY_DST,
});;
export function init() {  
    const shaderModule = device.createShaderModule({
        label: "Advect Shader Module",
        code: shader,
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
