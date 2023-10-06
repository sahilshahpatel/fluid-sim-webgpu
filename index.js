let simulator;
let renderer;

async function init() {
    if (!navigator.gpu) {
        throw Error("WebGPU not supported.");
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw Error("Couldn't request WebGPU adapter.");
    }
    
    let device = await adapter.requestDevice();
    let canvas = document.querySelector("canvas");
    this.context = canvas.getContext("webgpu");
    this.context.configure({
        device:    device,
        format:    navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: "premultiplied",
    });

    simulator = new FluidSimulator(device, canvas, context);
    renderer  = new FluidRenderer(device, canvas, context);
}

async function start (renderFunc) {
    await init();
    let animate = () => {
        simulator.update().then(() => {
            requestAnimationFrame(animate);
        });
    }
    animate();
}

start();