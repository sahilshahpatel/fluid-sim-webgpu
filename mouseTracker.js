export default class MouseTracker {
    constructor(canvas, units, onChange) {
        this.canvas = canvas;
        this.onChange = onChange;
        
        this.mouse = {
            pos: [-10, -10],
            vel: [0, 0],
        };

        this.lastUsedPosition = [-10, -10];

        let getNextPos = e => [
            e.offsetX * units[0] / this.canvas.clientWidth,
            (this.canvas.offsetHeight - e.offsetY) * units[1] / this.canvas.clientHeight,
        ];

        this.mousedown = false;
        this.mousemoveTime = performance.now();
        this.canvas.addEventListener('mousedown', e => {
            this.mousemoveTime = performance.now();
            this.mouse.pos = getNextPos(e);
            this.lastUsedPosition = this.mouse.pos; // Don't record last mouse on first mousedown
            this.mouse.vel = [0, 0];

            this.mousedown = true;

            this.onChange();
        });
        
        // For mouseup we use document in case they dragged off canvas before mouseup
        document.addEventListener('mouseup',  () => { this.mousedown = false; });

        this.canvas.addEventListener('mousemove', e => {
            document.getElementById("debug").innerHTML = getNextPos(e);

            if (!this.mousedown) return; 

            let now = performance.now();
            let dt = (now - this.mousemoveTime) / 1e3;
            this.mousemoveTime = now;
            
            let nextPos = getNextPos(e);
            
            this.mouse.vel = [(nextPos[0] - this.mouse.pos[0]) / dt, (nextPos[1] - this.mouse.pos[1]) / dt];
            this.mouse.pos = nextPos;

            this.onChange();
        });
    }

    get position() { return this.mouse.pos }
    get velocity() { return this.mouse.vel }
    get lastPosition() {
        // When the simulator asks for this position, we give it the last position it used
        // so that we respect it's update rate rather than ours
        const lastPos = this.lastUsedPosition;
        this.lastUsedPosition = this.mouse.pos;
        return lastPos;
    }
}