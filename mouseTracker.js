import { canvas } from "./global.js";
import { settings } from "./settings.js";

// TODO: I currently don't use mouseUpdated because I only have one UBO
// per shader and it holds deltaTime which changes every frame.
// In the future, using multiple UBOs would be a good way to show that
// design pattern, though I don't expect much performance uplift.

let mouseUpdated = true;
let mouse = {
    pos: [-100, -100],
    vel: [0, 0],
};
let lastUsedPosition = mouse.pos;

let getNextPos = e => [
    e.offsetX * settings.dataResolution[0] / canvas.clientWidth,
    (canvas.offsetHeight - e.offsetY) * settings.dataResolution[1] / canvas.clientHeight,
];

let mousedown = false;
let mousemoveTime = performance.now();
canvas.addEventListener('mousedown', e => {
    mousemoveTime = performance.now();
    mouse.pos = getNextPos(e);
    lastUsedPosition = mouse.pos; // Don't record last mouse on first mousedown
    mouse.vel = [0, 0];

    mousedown = true;
    mouseUpdated = true;
});

// For mouseup we use document in case they dragged off canvas before mouseup
document.addEventListener('mouseup',  () => { mousedown = false; });

// TODO: If mouse stays down but exits the canvas and re-enters somewhere else,
// it would be nice to reset lastUsedPosition in that case

canvas.addEventListener('mousemove', e => {
    document.getElementById("debug").innerHTML = getNextPos(e);

    if (!mousedown) return; 

    let now = performance.now();
    let dt = (now - mousemoveTime) / 1e3;
    mousemoveTime = now;
    
    let nextPos = getNextPos(e);
    
    mouse.vel = [(nextPos[0] - mouse.pos[0]) / dt, (nextPos[1] - mouse.pos[1]) / dt];
    mouse.pos = nextPos;

    mouseUpdated = true;
});

export default {
    get position() { return mouse.pos },
    get velocity() { return mouse.vel },
    get lastPosition() {
        // When the simulator asks for this position, we give it the last position it used
        // so that we respect it's update rate rather than ours
        const lastPos = lastUsedPosition;
        lastUsedPosition = mouse.pos;
        return lastPos;
    },
    get updated()  {
        // When requested, the message is consumed and we can flip updated
        const updated = mouseUpdated;
        mouseUpdated = false;
        return updated;
    },
}