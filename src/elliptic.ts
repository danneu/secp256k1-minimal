import { mod, powmod, modInverse, secp256k1 as curve } from './util'
import * as assert from 'assert'

const P = curve.p

export interface Point {
    readonly x: bigint
    readonly y: bigint
}

export const INFINITE_POINT: Point = new class {
    get x(): bigint {
        throw new Error("infinite point doesn't have an x")
    }

    get y(): bigint {
        throw new Error("infinite point doesn't have a y")
    }
}()

// export function add(a: Point, b: Point): Point {
//     return fastAdd(a, b)
// }

export function add(...points: Point[]): Point {
    assert(points.length > 1)
    let point = points[0]
    for (let i = 1; i < points.length; i++) {
        point = fastAdd(point, points[i])
    }
    return point
}

export function subtract(a: Point, b: Point): Point {
    b = { x: b.x, y: (curve.p - b.y) % curve.p }
    return add(a, b)
}

export function multiply(point: Point, scalar: bigint): Point {
    scalar = scalar % curve.n
    return fastMultiply(point, scalar)
}

// NAIVE IMPL

function naiveAdd(a: Point, b: Point): Point {
    if (a === INFINITE_POINT) {
        return b
    }
    if (b === INFINITE_POINT) {
        return a
    }
    if (a.x === b.x && a.y !== b.y) {
        return INFINITE_POINT
    }
    const lam =
        a.x === b.x && a.y === b.y
            ? ((3n * a.x * a.x + curve.a) * powmod(2n * a.y, curve.p - 2n, curve.p)) % curve.p
            : ((b.y - a.y) * powmod(b.x - a.x, curve.p - 2n, curve.p)) % curve.p
    const x3 = (lam * lam - a.x - b.x) % curve.p
    const y = mod(lam * (a.x - x3) - a.y, curve.p)
    return { x: x3, y }
}

export function naiveMultiply(point: Point, scalar: bigint): Point {
    scalar = scalar % curve.n
    let r = INFINITE_POINT
    for (let i = 0n; i < 256n; i++) {
        if ((scalar >> i) & 1n) {
            r = naiveAdd(r, point)
        }
        point = naiveAdd(point, point)
    }
    return r
}

// JACOBIAN OPTIMIZATION

type Jacobian = [bigint, bigint, bigint]

// Rewritten util.modInverse
function inv(a: bigint, n: bigint): bigint {
    if (a === 0n) {
        return 0n
    }
    let [lm, hm, low, high] = [1n, 0n, mod(a, n), n]
    while (low > 1) {
        const r = high / low
        const [nm, _new] = [hm - lm * r, high - low * r]
        ;[lm, low, hm, high] = [nm, _new, lm, low]
    }
    return lm % n
}

function fromJacobian(j: Jacobian): Point {
    if (j[0] === 0n && j[1] === 0n) {
        return INFINITE_POINT
    }
    const z = inv(j[2], curve.p)
    const x = (j[0] * z ** 2n) % curve.p
    const y = mod(j[1] * z ** 3n, curve.p)
    return { x, y }
}

function toJacobian(point: Point): Jacobian {
    return [point.x, point.y, 1n]
}

function jacobianDouble(p: Jacobian): Jacobian {
    if (p[1] === 0n) {
        return [0n, 0n, 0n]
    }
    const ysq = p[1] ** 2n % curve.p
    const S = (4n * p[0] * ysq) % curve.p
    const M = (3n * p[0] ** 2n + curve.a * p[2] ** 4n) % curve.p
    const nx = (M ** 2n - 2n * S) % curve.p
    const ny = (M * (S - nx) - 8n * ysq ** 2n) % curve.p
    const nz = (2n * p[1] * p[2]) % curve.p
    return [nx, ny, nz]
}

function jacobianAdd(p: Jacobian, q: Jacobian): Jacobian {
    if (p[1] === 0n) {
        return q
    }
    if (q[1] === 0n) {
        return p
    }
    const U1 = (p[0] * q[2] ** 2n) % P
    const U2 = (q[0] * p[2] ** 2n) % P
    const S1 = (p[1] * q[2] ** 3n) % P
    const S2 = (q[1] * p[2] ** 3n) % P
    if (U1 === U2) {
        return S1 === S2 ? jacobianDouble(p) : [0n, 0n, 1n]
    }
    const H = U2 - U1
    const R = S2 - S1
    const H2 = (H * H) % P
    const H3 = (H * H2) % P
    const U1H2 = (U1 * H2) % P
    const nx = (R ** 2n - H3 - 2n * U1H2) % P
    const ny = (R * (U1H2 - nx) - S1 * H3) % P
    const nz = (H * p[2] * q[2]) % P
    return [nx, ny, nz]
}

function jacobianMultiply(a: Jacobian, n: bigint): Jacobian {
    if (a[1] === 0n || n === 0n) {
        return [0n, 0n, 1n]
    }
    if (n === 1n) {
        return a
    }
    if (n < 0n || n >= curve.n) {
        return jacobianMultiply(a, n % curve.n)
    }
    if (n % 2n === 0n) {
        return jacobianDouble(jacobianMultiply(a, n / 2n))
    } else {
        // n % 2n === 1n
        return jacobianAdd(jacobianDouble(jacobianMultiply(a, n / 2n)), a)
    }
}

function fastMultiply(point: Point, scalar: bigint): Point {
    return fromJacobian(jacobianMultiply(toJacobian(point), scalar))
}

function fastAdd(a: Point, b: Point): Point {
    return fromJacobian(jacobianAdd(toJacobian(a), toJacobian(b)))
}
