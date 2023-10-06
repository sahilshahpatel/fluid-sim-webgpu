class FluidSimulator {
    constructor(device, canvas) {
        this.device = device;
        this.canvas = canvas;

        /* [[ WebGPU initialization ]] */
        this.context = canvas.getContext("webgpu");
        this.context.configure({
            device:    device,
            format:    navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: "premultiplied",
        });


        /* [[ Configuration parameters ]] */
        this.settings = {
            dataResolution:            [320, 200],
            renderResolution:          [800, 500],
            dyeDiffusionStrength:      0,
            velocityDiffusionStrength: 1,
            diffusionIterations:       25,
            projectionIterations:      40,
            vorticityConfinement:      5,
            drawArrows:                0,
            // As of now, webgpu doesn't allow filtering samplers for 32bit float textures
            dataTextureFormat:         "rgba16float",
            workgroupSize:             64,
            clearColor:                { r: 0.0, g: 0.5, b: 1.0, a: 1.0 },
        }
    

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
        this.uboByteLength = 2*3*4, // 3 vec2's of 4 byte floats

        // In WebGPU, buffers which have the MAP_WRITE usage cannot also be uniforms.
        // Instead, we have to create a staging buffer which is MAP_WRITE and COPY_SRC
        // and write to there. We can then copy over to our uniform buffer on the GPU
        this.stagingBuffer = device.createBuffer({
            label: "UBO Staging Buffer",
            size:  this.uboByteLength,
            usage: GPUBufferUsage.MAP_WRITE |
                   GPUBufferUsage.COPY_SRC,
        });

        this.ubo.buffer = device.createBuffer({
            label: "UBO",
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
        })


        /* [[ Set up pipelines ]] */
        this.pipelines = {};
        this.initCompute();
        this.initRender();

        
        /* [[ Mouse tracking ]] */
        this.mouse = {
            pos: [0, 0],
            vel: [0, 0],
        };

        let getNextPos = e => [
            e.offsetX * this.settings.dataResolution[0] / this.canvas.clientWidth,
            (this.canvas.offsetHeight - e.offsetY) * this.settings.dataResolution[1] / this.canvas.clientHeight
        ];

        this.mousedown = false;
        this.mousemoveTime = performance.now();
        this.canvas.addEventListener('mousedown', e => {
            this.mousemoveTime = performance.now();
            this.mouse.pos = getNextPos(e);
            this.mouse.vel = [0, 0];

            this.mousedown = true;

            this.uniformsUpdated = false;
        });
        
        // For mouseup we use document in case they dragged off canvas before mouseup
        document.addEventListener('mouseup',  () => { this.mousedown = false; });

        this.canvas.addEventListener('mousemove', e => {
            if (!this.mousedown) return; 

            let now = performance.now();
            let dt = (now - this.mousemoveTime) / 1e3;
            this.mousemoveTime = now;
            
            let nextPos = getNextPos(e);
            
            this.mouse.vel = [(nextPos[0] - this.mouse.pos[0]) / dt, (nextPos[1] - this.mouse.pos[1]) / dt];
            this.mouse.pos = nextPos;

            this.uniformsUpdated = false;
        });
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

            // var cell: vec4<f32> = textureLoad(data, );
            textureStore(output, xy, vec4f(uv, 0.0, 1.0));
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

    initRender() {
        const renderShader = `
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
            // return vec4f(fragData.uv, 0.0, 1.0);
            var pos   = fragData.uv * ubo.resolution;
            var color = textureSample(data, dataSampler, fragData.uv);

            var mouseDist = distance(pos, ubo.mousePos);
            color.b = 1.0 - step(5, mouseDist);

            return color;
        }
        `;
        
        const shaderModule = this.device.createShaderModule({
            code: renderShader,
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
                targets: [
                    {
                        format: navigator.gpu.getPreferredCanvasFormat(),
                    },
                ],
            },
            primitive: {
                topology: this.fullscreenQuad.topology,
            },
        };
        
        this.pipelines.render = this.device.createRenderPipeline(pipelineDescriptor);
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

    async render() {
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
                    resource: this.outputTexture.view,
                },
                {
                    binding:  2,
                    resource: this.dataSampler,
                },
            ],
        });

        const commandEncoder = this.device.createCommandEncoder({ label: "Render Command Encoder" });
        
        // Uniforms must be ready before we can submit
        await this.setUniforms();

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

    async setUniforms() {
        if (this.uniformsUpdated) return;

        await this.stagingBuffer.mapAsync(GPUMapMode.WRITE);

        let uboData = new Float32Array(this.stagingBuffer.getMappedRange());
        uboData.set(new Float32Array([
            ...this.settings.dataResolution,
            ...this.mouse.pos,
            ...this.mouse.vel,
        ]));
        this.stagingBuffer.unmap();
        
        this.uniformsUpdated = true;
    }

    async update() {     
        await this.compute();
        await this.device.queue.onSubmittedWorkDone();
        this.render();
    }
}
