import { device, context, fullscreenQuad } from "./global.js";
import { deltaTime } from "./simulator.js";
import { settings } from "./settings.js";
import mouseTracker from "./mouseTracker.js"


// 4 vec2's of 4 byte floats + 1 float
const uboByteLength = Math.ceil((4*2*4 + 4) / 16) * 16;

const shader = `
struct UBO {
    resolution:   vec2f,
    lastMousePos: vec2f,
    mousePos:     vec2f,
    mouseVel:     vec2f,
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
    output.uv = 0.5*position.xy + 0.5;
    return output;
}

@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f
{
    var out = vec4f(0);

    // Calculate texture coordinates
    var uv: vec2f = fragData.uv;
    var xy: vec2f = uv * ubo.resolution;

    // Paint with user interaction
    var mouseDist: f32 = sdSegment(xy, ubo.mousePos, ubo.lastMousePos);
    var effect:    f32 = 1 - smoothstep(0, 5, mouseDist);
    
    out.z  = effect;
    out.x = ubo.mouseVel.x * effect;
    out.y = ubo.mouseVel.y * effect;

    // Advect
    var previous: vec4f = textureLoad(data, vec2u(xy), 0);
    var sourceUV        = (xy - previous.xy) / ubo.resolution;
    var fluid           = textureSample(data, dataSampler, sourceUV);

    out.z += fluid.z;
    // out.z = max(out.z, previous.z);

    // // return out;
    return vec4f(uv, 0, 1);
}`;

let pipeline;
let ubo;
export function init() {  
    ubo = device.createBuffer({
        label: "Advect UBO",
        size:  uboByteLength,
        usage: GPUBufferUsage.UNIFORM  |
                GPUBufferUsage.COPY_DST,
    });

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

    if (mouseTracker.updated) {
        const uniforms = new Float32Array([
            ...settings.dataResolution,
            ...mouseTracker.lastPosition,
            ...mouseTracker.position,
            ...mouseTracker.velocity,
            deltaTime,
        ]);
        device.queue.writeBuffer(ubo, 0, uniforms, 0, uniforms.length);
    }

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
