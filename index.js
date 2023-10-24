import * as simulator from './simulator.js';

// TODO: add button controls here
const fps = document.getElementById("fps");

simulator.start(() => {
    fps.innerText = `FPS: ${(1 / simulator.deltaTime).toFixed(2)}`;
});