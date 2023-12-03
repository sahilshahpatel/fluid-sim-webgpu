import { settings } from "./settings.js";


// We write shaders in a file like this so that they can have access
// to settings via template literals, but also so that the WGSL code
// can be separated from the JS code for easier reading with syntax
// highlighting. See syntax highlighter for VSCode here:
// https://marketplace.visualstudio.com/items?itemName=ggsimm.wgsl-literal

export default {

// Advection //////////////////////////////////////////////
get advect() { return /* wgsl */`
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
}
`},


// Forces /////////////////////////////////////////////////
get forces() { return /* wgsl */`
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
    // TODO: smoothstep would be faster, but cuts off too strongly
    // I could probably tune it to be better though

    // return 1 - smoothstep(0, 5, d);
    return exp(-d / 1.5);
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

    if (f32(id) > ubo.resolution.x * ubo.resolution.y) {
        // This is an extra run outside of our bounds
        // This can happen if the workgroup size isn't
        // an exact factor of the resolution
        return;
    }

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
`},


// Jacobi /////////////////////////////////////////////////
get jacobi() { return /* wgsl */`
struct UBO {
    strength:   vec4f,
    resolution: vec2f,
    deltaTime:  f32,
}
@group(0) @binding(0)
var<uniform> ubo: UBO;

@group(0) @binding(1)
var data: texture_2d<f32>;

@group(0) @binding(2)
var output: texture_storage_2d<${settings.dataTextureFormat}, write>;

@compute @workgroup_size(${settings.workgroupSize})
fn main(
    @builtin(global_invocation_id)
    global_id: vec3u,
) {
    // Calculate texture coordinates
    var id: u32    = global_id.x;

    if (f32(id) > ubo.resolution.x * ubo.resolution.y) {
        // This is an extra run outside of our bounds
        // This can happen if the workgroup size isn't
        // an exact factor of the resolution
        return;
    }

    var width = u32(ubo.resolution.x);
    var xy    = vec2u(id % width, id / width);
    var uv    = vec2f(xy) / ubo.resolution;

    // Recall previous data
    var previous: vec4f = textureLoad(data, xy, 0);

    // Perform one step of jacobi iteration on each channel
    var k:     vec4f = ubo.strength * ubo.deltaTime;
    var north: vec4f = textureLoad(data, xy + vec2u(0, 1), 0);
    var east:  vec4f = textureLoad(data, xy + vec2u(1, 0), 0);
    var south: vec4f = textureLoad(data, xy - vec2u(0, 1), 0);
    var west:  vec4f = textureLoad(data, xy - vec2u(1, 0), 0);
    var out:   vec4f = (previous + k * (north + east + south + west)) / (1 + 4*k);

    textureStore(output, xy, out);
}
`},


// Render /////////////////////////////////////////////////
get render() { return /* wgsl */`
struct UBO {
    renderResolution: vec2f,
    dataResolution:   vec2f,
}
@group(0) @binding(0)
var<uniform> ubo: UBO;

@group(0) @binding(1)
var data: texture_2d<f32>;

@group(0) @binding(2)
var dataSampler: sampler;

struct VertexOut {
    @builtin(position) position : vec4f,
    @location(0) uv: vec2f
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
    var color = textureSample(data, dataSampler, fragData.uv);
    color.a = 1.0;
    return color;
}
`},
}