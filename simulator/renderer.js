import { settings } from "./settings.js";
import shaders from "./shaders.js";

export default class FluidRenderer {
    constructor(device, canvas) {
        this.device = device;
        this.canvas = canvas;
        this.context = canvas.getContext("webgpu");
        this.settings = settings;

        /* [[ Initialize internal fields]] */
        this.requestAnimationFrameID = undefined;
        this.previousTime            = 0;
        this.deltaTime               = 0;
        [this.canvas.width, this.canvas.height] = this.settings.renderResolution;
        

        /* [[ Fullscreen quad vertex atribute object (VAO) ]] */
        this.fullscreenQuad = {};
        this.fullscreenQuad.vertices = new Float32Array([
            -1, -1, 0, 1,
            -1, +1, 0, 1,
            +1, -1, 0, 1,
            +1, +1, 0, 1,
        ]);
        this.fullscreenQuad.count    = 4;
        this.fullscreenQuad.topology = "triangle-strip";
    
        this.fullscreenQuad.buffer = device.createBuffer({
            size:  this.fullscreenQuad.vertices.byteLength, // make it big enough to store vertices in
            usage: GPUBufferUsage.VERTEX |
                   GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.fullscreenQuad.buffer, 0, this.fullscreenQuad.vertices, 0, this.fullscreenQuad.vertices.length);
    
        this.fullscreenQuad.descriptor = {
            attributes: [{
                shaderLocation: 0, // position
                offset:         0,
                format:         "float32x4",
            }],
            arrayStride: this.fullscreenQuad.vertices.length / this.fullscreenQuad.count * 4,
            stepMode:    "vertex",
        };


        /* [[ Create required uniform buffer objects ]] */
        this.ubo = {};
        this.stagingBuffer = {};
        this.uboByteLength = 2*2*4, // 2 vec2 of 4 byte floats

        // In WebGPU, buffers which have the MAP_WRITE usage cannot also be uniforms.
        // Instead, we have to create a staging buffer which is MAP_WRITE and COPY_SRC
        // and write to there. We can then copy over to our uniform buffer on the GPU
        this.stagingBuffer = device.createBuffer({
            label: "Render UBO Staging Buffer",
            size:  this.uboByteLength,
            usage: GPUBufferUsage.MAP_WRITE |
                   GPUBufferUsage.COPY_SRC,
        });

        this.ubo.buffer = device.createBuffer({
            label: "Render UBO",
            size:  this.uboByteLength,
            usage: GPUBufferUsage.UNIFORM  |
                   GPUBufferUsage.COPY_DST,
        });

        this.uniformsUpdated = false;

        /* [[ Create required textures and samplers ]] */
        // Data texture will be render function input
        this.dataSampler   = device.createSampler({
            label:        "dataSampler",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter:    "linear",
            minFilter:    "linear",
        });


        /* [[ Set up pipelines ]] */
        this.pipelines = {};
        this.initRender();
    }

    initRender() {     
        const shaderModule = this.device.createShaderModule({
            code: shaders.render,
        });
        
        const bindGroupLayout = this.device.createBindGroupLayout({
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
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout],
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vertex_main",
                buffers: [this.fullscreenQuad.descriptor],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fragment_main",
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                }],
            },
            primitive: {
                topology: this.fullscreenQuad.topology,
            },
        };
        
        this.pipelines.render = this.device.createRenderPipeline(pipelineDescriptor);
    }

    async render(textureView, uniformData) {
        const bindGroup = this.device.createBindGroup({
            layout: this.pipelines.render.getBindGroupLayout(0),
            entries: [
                {
                    binding:  0,
                    resource: {
                        buffer: this.ubo.buffer,
                    },
                },
                {
                    binding:  1,
                    resource: textureView,
                },
                {
                    binding:  2,
                    resource: this.dataSampler,
                },
            ],
        });

        const commandEncoder = this.device.createCommandEncoder({ label: "Render Command Encoder" });
        
        // Uniforms must be ready before we can submit
        if (uniformData !== undefined) {
            await this.setUniforms(uniformData);
        }

        // Copy UBO data from staging buffer to uniform buffer
        commandEncoder.copyBufferToBuffer(
            this.stagingBuffer, 0,
            this.ubo.buffer,    0,
            this.uboByteLength,
        );

        const renderPassDescriptor = {
            colorAttachments: [{
                clearValue: this.settings.clearColor,
                loadOp: "clear",
                storeOp: "store",
                view: this.context.getCurrentTexture().createView(),
            }],
        };
        
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipelines.render);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.fullscreenQuad.buffer);
        passEncoder.draw(this.fullscreenQuad.count);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    async setUniforms(uniformData) {
        await this.stagingBuffer.mapAsync(GPUMapMode.WRITE);

        let uboData = new Float32Array(this.stagingBuffer.getMappedRange());
        uboData.set(new Float32Array([
            ...this.settings.renderResolution,
            ...this.settings.dataResolution,
            ...uniformData.flat(),
        ].slice(0, this.uboByteLength / 4)));
        this.stagingBuffer.unmap();
    }
}