import { device } from "./global.js";
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
var output: texture_storage_2d<${settings.dataTextureFormat}, write>;

// From https://iquilezles.org/articles/distfunctions2d/
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32
{
    var pa: vec2f = p-a;
    var ba: vec2f = b-a;
    var h:  f32 = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
    return length(pa - ba*h);
}

fn decay(d: f32) -> f32
{
    return 1 - smoothstep(0, 5, d);
}

fn all(b: vec2<bool>) -> bool
{
    return b.x && b.y;
}

@compute @workgroup_size(${settings.workgroupSize})
fn main(
    @builtin(global_invocation_id)
    global_id: vec3u,
) {
    // Calculate texture coordinates
    var id: u32    = global_id.x;
    var width: u32 = u32(ubo.resolution.x);
    var xy         = vec2u(id % width, id / width);
    var uv: vec2f  = vec2f(xy) / ubo.resolution;
    
    // Recall previous data
    var previous: vec4<f32> = textureLoad(data, xy, 0);

    // Paint with user interaction
    var out       = previous;
    var mouseDist = sdSegment(vec2f(xy), ubo.mousePos, ubo.lastMousePos);

    out.x += decay(mouseDist) * ubo.deltaTime * 50;
    out.y += decay(mouseDist) * ubo.deltaTime * ubo.mouseVel.x;
    out.z += decay(mouseDist) * ubo.deltaTime * ubo.mouseVel.y;

    // By using sdSegment, each segment will double count lastMousePos,
    // so we need to remove that first. But if this is the first mouse
    // press, then lastMousePos == mousePos and we didn't double count yet
    if (all(ubo.lastMousePos != ubo.mousePos))
    {
        var lastMouseDist = length(vec2f(xy) - ubo.lastMousePos);
        out.x -= decay(lastMouseDist) * ubo.deltaTime * 50;
    }

    textureStore(output, xy, out);
}
`;

let pipeline;
const ubo = device.createBuffer({
    label: "Forces UBO",
    size:  uboByteLength,
    usage: GPUBufferUsage.UNIFORM  |
            GPUBufferUsage.COPY_DST,
});

export function init() {
    const shaderModule = device.createShaderModule({
        code: shader,
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
        label:  "Forces Pipline Descriptor",
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        }),
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });
}

export async function run(inTexture, outTexture) {
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

    const commandEncoder = device.createCommandEncoder({ label: "Forces Command Encoder" });

    const uniforms = new ArrayBuffer(uboByteLength);
    const f32s  = new Float32Array([
        ...settings.dataResolution,
        ...mouseTracker.lastPosition,
        ...mouseTracker.position,
        ...mouseTracker.velocity,
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
