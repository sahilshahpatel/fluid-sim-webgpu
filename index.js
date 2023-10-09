import FluidSimulator from "./simulator.js"

let simulator;

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
    let context = canvas.getContext("webgpu");
    context.configure({
        device:    device,
        format:    navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: "premultiplied",
    });

    simulator = new FluidSimulator(device, canvas);
}

async function start () {
    await init();
    let animate = () => {
        simulator.update().then(() => {
            requestAnimationFrame(animate);
        });
    }
    animate();
}

start();