import FluidRenderer from "./renderer.js";
import MouseTracker from "./mouseTracker.js";
import { defaultSettings } from "./settings.js";

export default class FluidSimulator {
    constructor(device, canvas, settings = {}) {
        this.device = device;
        this.canvas = canvas;

        /* [[ Configuration parameters ]] */
        this.settings = {
            ...defaultSettings,
            ...settings
        }
        

        /* [[ Create required uniform buffer objects ]] */
        this.ubo = {};
        this.stagingBuffer = {};
        this.uboByteLength = 3*2*4, // 3 vec2's of 4 byte floats

        // In WebGPU, buffers which have the MAP_WRITE usage cannot also be uniforms.
        // Instead, we have to create a staging buffer which is MAP_WRITE and COPY_SRC
        // and write to there. We can then copy over to our uniform buffer on the GPU
        this.stagingBuffer = device.createBuffer({
            label: "Compute UBO Staging Buffer",
            size:  this.uboByteLength,
            usage: GPUBufferUsage.MAP_WRITE |
                   GPUBufferUsage.COPY_SRC,
        });

        this.ubo.buffer = device.createBuffer({
            label: "Compute UBO",
            size:  this.uboByteLength,
            usage: GPUBufferUsage.UNIFORM  |
                   GPUBufferUsage.COPY_DST,
        });

        this.uniformsUpdated = false;


        /* [[ Create required textures and samplers ]] */
        let createDataTexture = (label, extraUsages) => {
            const texture = device.createTexture({
                label:  label,
                format: this.settings.dataTextureFormat,
                size:   this.settings.dataResolution,
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
        this.dataTexture   = createDataTexture("dataTexture");
        this.outputTexture = createDataTexture("outputTexture", GPUTextureUsage.STORAGE_BINDING);
        this.dataSampler   = device.createSampler({
            label:        "dataSampler",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter:    "linear",
            minFilter:    "linear",
        });


        /* [[ Set up pipelines ]] */
        this.pipelines = {};
        this.initCompute();

        
        /* [[ Mouse tracking ]] */
        this.mouseTracker = new MouseTracker(
            canvas,
            this.settings.dataResolution,
            () => { this.uniformsUpdated = false },
        );


        /* [[ Create renderer ]] */
        this.renderer = new FluidRenderer(device, canvas, this.settings);
    }

    initCompute() {
        const computeShader = `
        struct UBO {
            resolution: vec2<f32>,
            mousePos: vec2<f32>,
            mouseVel: vec2<f32>,
        }
        @group(0) @binding(0)
        var<uniform> ubo: UBO;

        @group(0) @binding(1)
        var data: texture_2d<f32>;

        @group(0) @binding(2)
        var dataSampler: sampler;

        @group(0) @binding(3)
        var output: texture_storage_2d<${this.settings.dataTextureFormat}, write>;

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
            var color = vec4f(uv, 0.0, 1.0);
            var mouseDist = distance(vec2f(xy), ubo.mousePos);
            color.b = 1.0 - smoothstep(0, 15, mouseDist);

            // var cell: vec4<f32> = textureLoad(data, );
            textureStore(output, xy, color);
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
    
    async compute() {
        const bindGroup = this.device.createBindGroup({
            layout: this.pipelines.compute.getBindGroupLayout(0),
            entries: [
                {
                    binding:  0,
                    resource: {
                        buffer: this.ubo.buffer,
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
        await this.setUniforms();

        // Copy UBO data from staging buffer to uniform buffer
        commandEncoder.copyBufferToBuffer(
            this.stagingBuffer, 0,
            this.ubo.buffer,    0,
            this.uboByteLength,
        );

        // Start general compute pass
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipelines.compute);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(cellCount / this.settings.workgroupSize));
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    async setUniforms() {
        if (this.uniformsUpdated) return;

        await this.stagingBuffer.mapAsync(GPUMapMode.WRITE);

        let uboData = new Float32Array(this.stagingBuffer.getMappedRange());
        uboData.set(new Float32Array([
            ...this.settings.dataResolution,
            ...this.mouseTracker.position,
            ...this.mouseTracker.velocity,
        ]));
        this.stagingBuffer.unmap();
        
        this.uniformsUpdated = true;
    }

    async update() {     
        await this.compute();
        await this.device.queue.onSubmittedWorkDone();
        await this.renderer.render(this.outputTexture.view);
        return this.device.queue.onSubmittedWorkDone();
    }
}
