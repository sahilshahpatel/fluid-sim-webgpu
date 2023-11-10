import * as simulator from './simulator/simulator.js';

// TODO: add button controls here
const fps = document.getElementById("fps");
const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");

const simCallback = () => {
    fps.innerText = `FPS: ${(1 / simulator.deltaTime).toFixed(2)}`;
};

startButton.addEventListener('click', () => {
    simulator.start(simCallback);
});
startButton.click(); // Start by default

stopButton.addEventListener('click', () => {
    simulator.stop();
});

