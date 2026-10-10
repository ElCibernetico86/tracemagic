declare module 'fit-curve' {
  /**
   * Fit one or more cubic Bezier curves to a polyline using Schneider's algorithm.
   * Returns an array of curves, each as [start, ctrl1, ctrl2, end] points ([x, y]).
   */
  export default function fitCurve(points: number[][], maxError: number): number[][][];
  /**
   * Fit with explicit unit tangents at both ends. leftTangent points into the
   * curve from the start; rightTangent points into the curve from the end.
   * `error` is the squared maximum distance.
   */
  export function fitCubic(
    points: number[][],
    leftTangent: number[],
    rightTangent: number[],
    error: number,
  ): number[][][];
}
