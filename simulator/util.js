// Pad length n to multiple of m
export function pad(n, m){
    return Math.ceil(n / m) * m;
}

export function padBuffer(n) {
    // Buffer sizes must be multiple of 16
    return pad(n, 16);
}