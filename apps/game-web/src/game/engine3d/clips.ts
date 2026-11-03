/**
 * Keyframed pose clips for the procedural rig. Each key is a partial pose; joints that appear in a clip
 * are masked in (others keep the locomotion/sit layer), so upper-body actions blend over walking.
 * Conventions (radians): limbs +x swing back / -x swing forward; spine/head +x lean forward;
 * left arm +z = outward, right arm -z = outward; elbows -x bend; yaw +y turns to the character's left.
 * Strike clips use an 'out' ease into the wind-up (anticipation) and an 'in' ease into the hit (snap).
 */
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'shR', 'elR', 'thL', 'knL', 'thR', 'knR'] as const;
export type JointName = typeof JOINTS[number];
export const POSE_SIZE = JOINTS.length * 3 + 3;
const JOINT_INDEX = Object.fromEntries(JOINTS.map((name, index) => [name, index * 3])) as Record<JointName, number>;
export const poseIndex = { joint: (name: JointName) => JOINT_INDEX[name], hy: JOINTS.length * 3, hz: JOINTS.length * 3 + 1, yaw: JOINTS.length * 3 + 2 };

type V3 = [number, number, number];
export type PartialPose = Partial<Record<JointName, V3>> & { hy?: number; hz?: number; yaw?: number };
type Ease = 'smooth' | 'in' | 'out' | 'linear';
export interface Clip { duration: number; loop?: boolean; blendIn?: number; keys: [number, PartialPose, Ease?][]; events?: [number, string][] }

const restArms: PartialPose = { shL: [0, 0, 0.09], elL: [-0.12, 0, 0], shR: [0, 0, -0.09], elR: [-0.12, 0, 0] };
const restLegs: PartialPose = { thL: [0, 0, 0], knL: [0, 0, 0], thR: [0, 0, 0], knR: [0, 0, 0] };
const lying: PartialPose = { hips: [-1.5, 0, 0], spine: [0, 0, 0], head: [-0.1, 0, 0.35], shL: [-2.7, 0, 1.0], elL: [-0.3, 0, 0], shR: [-2.7, 0, -1.0], elR: [-0.3, 0, 0], thL: [-0.25, 0, 0.1], knL: [0.15, 0, 0], thR: [-0.1, 0, -0.1], knR: [0.1, 0, 0], hy: -19.5, hz: -11 };
const with_ = (base: PartialPose, change: PartialPose): PartialPose => ({ ...base, ...change });

export const CLIPS = {
  sit: { duration: 1, keys: [[0, { thL: [-1.5, 0, 0.06], thR: [-1.5, 0, -0.06], knL: [1.5, 0, 0], knR: [1.5, 0, 0], spine: [0.04, 0, 0], shL: [-0.45, 0, 0.12], elL: [-0.85, 0, 0], shR: [-0.45, 0, -0.12], elR: [-0.85, 0, 0], hz: -3 }]] },
  typing: {
    duration: 0.56, loop: true, keys: [
      [0, { shL: [-0.72, 0, 0.14], elL: [-0.95, 0, -0.1], shR: [-0.72, 0, -0.14], elR: [-1.05, 0, 0.1], head: [0.16, 0, 0], chest: [0.08, 0, 0] }],
      [0.14, { shL: [-0.72, 0, 0.14], elL: [-1.07, 0, -0.1], shR: [-0.72, 0, -0.14], elR: [-0.93, 0, 0.1], head: [0.18, 0.04, 0], chest: [0.08, 0, 0] }, 'linear'],
      [0.28, { shL: [-0.74, 0, 0.16], elL: [-0.94, 0, -0.1], shR: [-0.7, 0, -0.12], elR: [-1.06, 0, 0.1], head: [0.16, 0, 0], chest: [0.09, 0, 0] }, 'linear'],
      [0.42, { shL: [-0.72, 0, 0.14], elL: [-1.06, 0, -0.1], shR: [-0.72, 0, -0.14], elR: [-0.95, 0, 0.1], head: [0.17, -0.04, 0], chest: [0.08, 0, 0] }, 'linear'],
      [0.56, { shL: [-0.72, 0, 0.14], elL: [-0.95, 0, -0.1], shR: [-0.72, 0, -0.14], elR: [-1.05, 0, 0.1], head: [0.16, 0, 0], chest: [0.08, 0, 0] }, 'linear'],
    ], events: [[0.05, 'key']],
  },
  drink: {
    duration: 2.3, keys: [
      [0, { shR: [-0.3, 0, -0.15], elR: [-1.2, 0, 0], head: [0, 0, 0], neck: [0, 0, 0] }],
      [0.55, { shR: [-1.15, 0, -0.35], elR: [-2.0, 0, 0.2], head: [-0.05, 0, 0], neck: [0, 0, 0] }, 'out'],
      [0.85, { shR: [-1.35, 0, -0.3], elR: [-2.15, 0, 0.25], head: [-0.32, 0, 0], neck: [-0.1, 0, 0] }],
      [1.6, { shR: [-1.35, 0, -0.3], elR: [-2.15, 0, 0.25], head: [-0.3, 0, 0], neck: [-0.1, 0, 0] }],
      [2.3, { shR: [-0.3, 0, -0.15], elR: [-1.2, 0, 0], head: [0, 0, 0], neck: [0, 0, 0] }],
    ], events: [[0.85, 'sip'], [1.7, 'ahh']],
  },
  pressButton: {
    duration: 0.95, keys: [
      [0, { shR: [0, 0, -0.09], elR: [-0.12, 0, 0], spine: [0, 0, 0] }],
      [0.35, { shR: [-1.25, 0, -0.05], elR: [-0.5, 0, 0], spine: [0.1, 0, 0] }, 'out'],
      [0.48, { shR: [-1.35, 0, -0.05], elR: [-0.1, 0, 0], spine: [0.16, 0, 0] }, 'in'],
      [0.95, { shR: [0, 0, -0.09], elR: [-0.12, 0, 0], spine: [0, 0, 0] }],
    ], events: [[0.48, 'press']],
  },
  reach: {
    duration: 1, keys: [
      [0, { shR: [0, 0, -0.09], elR: [-0.12, 0, 0], spine: [0, 0, 0], head: [0, 0, 0] }],
      [0.45, { shR: [-1.05, 0, -0.1], elR: [-0.35, 0, 0], spine: [0.42, 0, 0], head: [0.25, 0, 0] }, 'out'],
      [0.6, { shR: [-1.0, 0, -0.1], elR: [-0.45, 0, 0], spine: [0.4, 0, 0], head: [0.25, 0, 0] }],
      [1, { shR: [-0.3, 0, -0.1], elR: [-1.2, 0, 0], spine: [0, 0, 0], head: [0, 0, 0] }],
    ], events: [[0.5, 'grab']],
  },
  punch: {
    duration: 1.15, blendIn: 0.1, keys: [
      [0, { ...restArms, ...restLegs, spine: [0, 0, 0], chest: [0, 0, 0], hy: 0, hz: 0 }],
      [0.32, { spine: [0, -0.55, 0], chest: [-0.12, -0.1, 0], shR: [0.55, 0, -0.55], elR: [-2.1, 0, 0], shL: [-0.85, 0, 0.3], elL: [-1.7, 0, 0], thL: [-0.4, 0, 0], knL: [0.35, 0, 0], thR: [0.1, 0, 0], knR: [0, 0, 0], hy: -2.5, hz: -2 }, 'out'],
      [0.42, { spine: [0.1, 0.6, 0], chest: [0.2, 0.1, 0], shR: [-1.62, 0, -0.04], elR: [-0.04, 0, 0], shL: [0.35, 0, 0.45], elL: [-1.7, 0, 0], thL: [-0.65, 0, 0], knL: [0.45, 0, 0], thR: [0.35, 0, 0], knR: [0, 0, 0], hy: -3.5, hz: 4 }, 'in'],
      [0.66, { spine: [0.1, 0.55, 0], chest: [0.18, 0.1, 0], shR: [-1.55, 0, -0.05], elR: [-0.1, 0, 0], shL: [0.3, 0, 0.45], elL: [-1.6, 0, 0], thL: [-0.6, 0, 0], knL: [0.45, 0, 0], thR: [0.3, 0, 0], knR: [0, 0, 0], hy: -3, hz: 3.5 }],
      [1.15, { ...restArms, ...restLegs, spine: [0, 0, 0], chest: [0, 0, 0], hy: 0, hz: 0 }],
    ], events: [[0.12, 'whoosh'], [0.42, 'impact']],
  },
  slap: {
    duration: 0.95, blendIn: 0.1, keys: [
      [0, { ...restArms, spine: [0, 0, 0], head: [0, 0, 0] }],
      [0.3, { shR: [-1.0, 0, -1.45], elR: [-0.75, 0, 0], spine: [0, -0.45, 0], head: [0, -0.2, 0], shL: [0, 0, 0.3], elL: [-0.3, 0, 0] }, 'out'],
      [0.4, { shR: [-1.35, 0, 0.45], elR: [-0.2, 0, 0], spine: [0.08, 0.5, 0], head: [0, 0.15, 0], shL: [0, 0, 0.3], elL: [-0.3, 0, 0] }, 'in'],
      [0.6, { shR: [-1.3, 0, 0.5], elR: [-0.25, 0, 0], spine: [0.06, 0.45, 0], head: [0, 0.1, 0], shL: [0, 0, 0.3], elL: [-0.3, 0, 0] }],
      [0.95, { ...restArms, spine: [0, 0, 0], head: [0, 0, 0] }],
    ], events: [[0.38, 'impact']],
  },
  hitReact: {
    duration: 0.9, blendIn: 0.04, keys: [
      [0, { head: [0, 0, 0], neck: [0, 0, 0], spine: [0, 0, 0], shL: [0, 0, 0.09], shR: [0, 0, -0.09], hz: 0 }],
      [0.08, { head: [-0.1, 0.95, 0.35], neck: [0, 0.3, 0], spine: [-0.25, 0.2, 0], shL: [-0.3, 0, 0.7], shR: [-0.3, 0, -0.7], hz: -5 }, 'out'],
      [0.45, { head: [0, 0.6, 0.2], neck: [0, 0.2, 0], spine: [-0.15, 0.1, 0], shL: [-0.2, 0, 0.4], shR: [-0.2, 0, -0.4], hz: -6 }],
      [0.9, { head: [0, 0, 0], neck: [0, 0, 0], spine: [0, 0, 0], shL: [0, 0, 0.09], shR: [0, 0, -0.09], hz: 0 }],
    ],
  },
  stagger: {
    duration: 1.5, blendIn: 0.04, keys: [
      [0, { hips: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0], ...restArms, ...restLegs, hy: 0, hz: 0 }],
      [0.1, { hips: [-0.28, 0, 0.05], spine: [-0.35, 0, 0], head: [-0.45, 0, 0.2], shL: [-0.6, 0, 1.1], elL: [-0.4, 0, 0], shR: [-0.6, 0, -1.1], elR: [-0.4, 0, 0], thL: [-0.5, 0, 0], knL: [0.6, 0, 0], thR: [0.2, 0, 0], knR: [0.2, 0, 0], hy: -2, hz: -9 }, 'out'],
      [0.5, { hips: [0.12, 0, -0.12], spine: [0.22, 0, 0.1], head: [0.1, 0, -0.2], shL: [-0.4, 0, 0.8], elL: [-0.4, 0, 0], shR: [-0.4, 0, -0.8], elR: [-0.4, 0, 0], thL: [0.2, 0, 0], knL: [0.3, 0, 0], thR: [-0.3, 0, 0], knR: [0.4, 0, 0], hy: -1.5, hz: -12 }],
      [0.9, { hips: [0, 0, 0.12], spine: [0.05, 0, -0.1], head: [0, 0, 0.15], shL: [-0.2, 0, 0.4], elL: [-0.3, 0, 0], shR: [-0.2, 0, -0.4], elR: [-0.3, 0, 0], thL: [0, 0, 0], knL: [0.1, 0, 0], thR: [0, 0, 0], knR: [0.1, 0, 0], hy: -0.5, hz: -12 }],
      [1.5, { hips: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0], ...restArms, ...restLegs, hy: 0, hz: 0 }],
    ], events: [[0.05, 'ouch']],
  },
  knockdown: {
    duration: 3.2, blendIn: 0.05, keys: [
      [0, { hips: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0], ...restArms, ...restLegs, hy: 0, hz: 0 }],
      [0.38, with_(lying, { head: [-0.15, 0, 0.3], hz: -10 }), 'in'],
      [0.52, with_(lying, { hips: [-1.42, 0, 0], spine: [0.05, 0, 0], thL: [-0.35, 0, 0], knL: [0.25, 0, 0], hy: -17.5 }), 'out'],
      [0.7, lying],
      [2.2, with_(lying, { head: [-0.1, 0, -0.35] })],
      [2.7, { hips: [-0.5, 0, 0], spine: [0.4, 0, 0], head: [0.1, 0, 0], shL: [-0.3, 0, 0.6], elL: [-0.3, 0, 0], shR: [-0.3, 0, -0.6], elR: [-0.3, 0, 0], thL: [-1.3, 0, 0], knL: [1.9, 0, 0], thR: [-1.0, 0, 0], knR: [1.7, 0, 0], hy: -13, hz: -8 }],
      [3.2, { hips: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0], ...restArms, ...restLegs, hy: 0, hz: 0 }],
    ], events: [[0.38, 'thud']],
  },
  lieDown: { duration: 2, loop: true, keys: [[0, lying], [1, with_(lying, { head: [-0.1, 0, -0.35] })], [2, lying]] },
  slamDesk: {
    duration: 1.35, blendIn: 0.12, keys: [
      [0, { ...restArms, spine: [0, 0, 0], head: [0, 0, 0], hy: 0 }],
      [0.46, { shL: [-2.9, 0, 0.28], elL: [-0.65, 0, 0], shR: [-2.9, 0, -0.28], elR: [-0.65, 0, 0], spine: [-0.28, 0, 0], head: [-0.22, 0, 0], hy: 1.5 }, 'out'],
      [0.6, { shL: [-1.2, 0, 0.22], elL: [-0.15, 0, 0], shR: [-1.2, 0, -0.22], elR: [-0.15, 0, 0], spine: [0.55, 0, 0], head: [0.28, 0, 0], hy: -4 }, 'in'],
      [0.95, { shL: [-1.15, 0, 0.22], elL: [-0.2, 0, 0], shR: [-1.15, 0, -0.22], elR: [-0.2, 0, 0], spine: [0.5, 0, 0], head: [0.1, 0, 0], hy: -3.5 }],
      [1.35, { ...restArms, spine: [0, 0, 0], head: [0, 0, 0], hy: 0 }],
    ], events: [[0.6, 'impact']],
  },
  throwOver: {
    duration: 1.05, blendIn: 0.1, keys: [
      [0, { ...restArms, ...restLegs, spine: [0, 0, 0], hy: 0 }],
      [0.38, { shR: [-2.7, 0, -0.25], elR: [-1.7, 0, 0], shL: [-1.0, 0, 0.3], elL: [-0.4, 0, 0], spine: [-0.28, -0.4, 0], thL: [-0.45, 0, 0], knL: [0.3, 0, 0], thR: [0.1, 0, 0], knR: [0, 0, 0], hy: -1.5 }, 'out'],
      [0.52, { shR: [-1.1, 0, -0.1], elR: [-0.1, 0, 0], shL: [0.2, 0, 0.4], elL: [-0.6, 0, 0], spine: [0.38, 0.35, 0], thL: [-0.65, 0, 0], knL: [0.45, 0, 0], thR: [0.35, 0, 0], knR: [0, 0, 0], hy: -3 }, 'in'],
      [1.05, { ...restArms, ...restLegs, spine: [0, 0, 0], hy: 0 }],
    ], events: [[0.5, 'release']],
  },
  argue: {
    duration: 1.6, loop: true, keys: [
      [0, { shR: [-1.5, 0, -0.1], elR: [-0.15, 0, 0], shL: [0.25, 0, 0.75], elL: [-1.7, 0, 0], chest: [0.08, 0, 0], head: [0, 0, 0] }],
      [0.2, { shR: [-1.62, 0, -0.1], elR: [-0.05, 0, 0], shL: [0.25, 0, 0.75], elL: [-1.7, 0, 0], chest: [0.2, 0, 0], head: [0.1, 0, 0] }, 'out'],
      [0.45, { shR: [-1.45, 0, -0.1], elR: [-0.25, 0, 0], shL: [0.25, 0, 0.75], elL: [-1.7, 0, 0], chest: [0.02, 0, 0], head: [-0.05, 0, 0] }],
      [0.7, { shR: [-1.2, 0, -0.5], elR: [-0.8, 0, 0], shL: [-0.6, 0, 0.6], elL: [-0.9, 0, 0], chest: [0.05, 0, 0], head: [0, 0.35, 0] }],
      [0.95, { shR: [-1.2, 0, -0.55], elR: [-0.8, 0, 0], shL: [-0.6, 0, 0.65], elL: [-0.9, 0, 0], chest: [0.05, 0, 0], head: [0, -0.35, 0] }],
      [1.2, { shR: [-1.2, 0, -0.5], elR: [-0.8, 0, 0], shL: [-0.6, 0, 0.6], elL: [-0.9, 0, 0], chest: [0.05, 0, 0], head: [0, 0.3, 0] }],
      [1.6, { shR: [-1.5, 0, -0.1], elR: [-0.15, 0, 0], shL: [0.25, 0, 0.75], elL: [-1.7, 0, 0], chest: [0.08, 0, 0], head: [0, 0, 0] }],
    ], events: [[0.2, 'shout']],
  },
  crossArms: { duration: 1.2, loop: true, keys: [
    [0, { shL: [-0.6, 0, 0.18], elL: [-1.5, 0, -1.2], shR: [-0.6, 0, -0.18], elR: [-1.5, 0, 1.2], head: [-0.12, 0, 0.08], chest: [-0.05, 0, 0] }],
    [0.6, { shL: [-0.62, 0, 0.18], elL: [-1.5, 0, -1.2], shR: [-0.62, 0, -0.18], elR: [-1.5, 0, 1.2], head: [-0.16, 0, 0.1], chest: [-0.07, 0, 0] }],
    [1.2, { shL: [-0.6, 0, 0.18], elL: [-1.5, 0, -1.2], shR: [-0.6, 0, -0.18], elR: [-1.5, 0, 1.2], head: [-0.12, 0, 0.08], chest: [-0.05, 0, 0] }],
  ] },
  shakeHead: { duration: 1, keys: [[0, { head: [0, 0, 0] }], [0.15, { head: [0.05, 0.45, 0] }], [0.35, { head: [0.05, -0.45, 0] }], [0.55, { head: [0.05, 0.4, 0] }], [0.75, { head: [0.05, -0.35, 0] }], [1, { head: [0, 0, 0] }]] },
  nod: { duration: 0.8, keys: [[0, { head: [0, 0, 0] }], [0.2, { head: [0.32, 0, 0] }], [0.4, { head: [0, 0, 0] }], [0.6, { head: [0.3, 0, 0] }], [0.8, { head: [0, 0, 0] }]] },
  facepalm: { duration: 1.7, keys: [
    [0, { shR: [0, 0, -0.09], elR: [-0.12, 0, 0], head: [0, 0, 0] }],
    [0.4, { shR: [-1.75, 0, 0.3], elR: [-2.25, 0, 0], head: [0.38, 0, 0] }, 'out'],
    [1.3, { shR: [-1.75, 0, 0.3], elR: [-2.25, 0, 0], head: [0.4, 0.1, 0] }],
    [1.7, { shR: [0, 0, -0.09], elR: [-0.12, 0, 0], head: [0, 0, 0] }],
  ] },
  yawn: { duration: 2.1, keys: [
    [0, { ...restArms, head: [0, 0, 0], spine: [0, 0, 0] }],
    [0.7, { shL: [-2.9, 0, 0.45], elL: [-0.3, 0, 0], shR: [-2.9, 0, -0.45], elR: [-0.3, 0, 0], head: [-0.32, 0, 0], spine: [-0.18, 0, 0] }, 'out'],
    [1.4, { shL: [-2.95, 0, 0.5], elL: [-0.25, 0, 0], shR: [-2.95, 0, -0.5], elR: [-0.25, 0, 0], head: [-0.35, 0, 0.1], spine: [-0.2, 0, 0.05] }],
    [2.1, { ...restArms, head: [0, 0, 0], spine: [0, 0, 0] }],
  ], events: [[0.3, 'yawn']] },
  sleepDesk: { duration: 3, loop: true, blendIn: 0.9, keys: [
    [0, { head: [0.85, 0, 0.25], neck: [0.4, 0, 0], chest: [0.5, 0, 0], spine: [0.38, 0, 0], shL: [-1.15, 0, 0.32], elL: [-1.6, 0, -0.85], shR: [-1.15, 0, -0.32], elR: [-1.6, 0, 0.85] }],
    [1.5, { head: [0.85, 0, 0.25], neck: [0.4, 0, 0], chest: [0.58, 0, 0], spine: [0.4, 0, 0], shL: [-1.15, 0, 0.32], elL: [-1.6, 0, -0.85], shR: [-1.15, 0, -0.32], elR: [-1.6, 0, 0.85] }],
    [3, { head: [0.85, 0, 0.25], neck: [0.4, 0, 0], chest: [0.5, 0, 0], spine: [0.38, 0, 0], shL: [-1.15, 0, 0.32], elL: [-1.6, 0, -0.85], shR: [-1.15, 0, -0.32], elR: [-1.6, 0, 0.85] }],
  ], events: [[0.2, 'snore']] },
  startled: { duration: 0.75, blendIn: 0.03, keys: [
    [0, { ...restArms, head: [0, 0, 0], spine: [0, 0, 0], hy: 0 }],
    [0.14, { shL: [-0.5, 0, 1.3], elL: [-0.5, 0, 0], shR: [-0.5, 0, -1.3], elR: [-0.5, 0, 0], head: [-0.35, 0, 0], spine: [-0.2, 0, 0], hy: 6 }, 'out'],
    [0.42, { shL: [-0.3, 0, 0.8], elL: [-0.4, 0, 0], shR: [-0.3, 0, -0.8], elR: [-0.4, 0, 0], head: [-0.1, 0, 0], spine: [-0.1, 0, 0], hy: 0 }, 'in'],
    [0.75, { ...restArms, head: [0, 0, 0], spine: [0, 0, 0], hy: 0 }],
  ], events: [[0.03, 'gasp']] },
  clap: { duration: 0.5, loop: true, keys: [
    [0, { shL: [-1.15, 0, 0.15], elL: [-1.1, 0, -0.35], shR: [-1.15, 0, -0.15], elR: [-1.1, 0, 0.35], head: [-0.05, 0, 0] }],
    [0.12, { shL: [-1.15, 0, 0.05], elL: [-1.1, 0, -0.85], shR: [-1.15, 0, -0.05], elR: [-1.1, 0, 0.85], head: [-0.08, 0, 0] }, 'in'],
    [0.25, { shL: [-1.15, 0, 0.15], elL: [-1.1, 0, -0.35], shR: [-1.15, 0, -0.15], elR: [-1.1, 0, 0.35], head: [-0.05, 0, 0] }, 'out'],
    [0.37, { shL: [-1.15, 0, 0.05], elL: [-1.1, 0, -0.85], shR: [-1.15, 0, -0.05], elR: [-1.1, 0, 0.85], head: [-0.08, 0, 0] }, 'in'],
    [0.5, { shL: [-1.15, 0, 0.15], elL: [-1.1, 0, -0.35], shR: [-1.15, 0, -0.15], elR: [-1.1, 0, 0.35], head: [-0.05, 0, 0] }, 'out'],
  ], events: [[0.12, 'clap'], [0.37, 'clap']] },
  cheer: { duration: 0.8, loop: true, keys: [
    [0, { shL: [-2.75, 0, 0.55], elL: [-0.2, 0, 0], shR: [-2.75, 0, -0.55], elR: [-0.2, 0, 0], head: [-0.2, 0, 0], hy: 0 }],
    [0.2, { shL: [-2.9, 0, 0.45], elL: [-0.1, 0, 0], shR: [-2.9, 0, -0.45], elR: [-0.1, 0, 0], head: [-0.25, 0, 0], hy: 4 }, 'out'],
    [0.4, { shL: [-2.75, 0, 0.55], elL: [-0.2, 0, 0], shR: [-2.75, 0, -0.55], elR: [-0.2, 0, 0], head: [-0.2, 0, 0], hy: 0 }, 'in'],
    [0.6, { shL: [-2.9, 0, 0.45], elL: [-0.1, 0, 0], shR: [-2.9, 0, -0.45], elR: [-0.1, 0, 0], head: [-0.25, 0, 0], hy: 4 }, 'out'],
    [0.8, { shL: [-2.75, 0, 0.55], elL: [-0.2, 0, 0], shR: [-2.75, 0, -0.55], elR: [-0.2, 0, 0], head: [-0.2, 0, 0], hy: 0 }, 'in'],
  ] },
  dance: { duration: 1.6, loop: true, keys: [
    [0, { shL: [-0.5, 0, 1.4], elL: [-1.5, 0, 0], shR: [-2.6, 0, -0.4], elR: [-0.4, 0, 0], hips: [0, 0, 0.14], spine: [0, 0.3, -0.1], head: [0, 0.2, 0.15], thL: [-0.35, 0, 0.1], knL: [0.6, 0, 0], thR: [0.05, 0, 0], knR: [0.1, 0, 0], hy: -2, yaw: -0.4 }],
    [0.4, { shL: [-1.3, 0, 0.9], elL: [-1.0, 0, 0], shR: [-1.3, 0, -0.9], elR: [-1.0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0], head: [-0.15, 0, 0], thL: [0, 0, 0], knL: [0.15, 0, 0], thR: [0, 0, 0], knR: [0.15, 0, 0], hy: 1, yaw: 0 }],
    [0.8, { shL: [-2.6, 0, 0.4], elL: [-0.4, 0, 0], shR: [-0.5, 0, -1.4], elR: [-1.5, 0, 0], hips: [0, 0, -0.14], spine: [0, -0.3, 0.1], head: [0, -0.2, -0.15], thL: [0.05, 0, 0], knL: [0.1, 0, 0], thR: [-0.35, 0, -0.1], knR: [0.6, 0, 0], hy: -2, yaw: 0.4 }],
    [1.2, { shL: [-1.3, 0, 0.9], elL: [-1.0, 0, 0], shR: [-1.3, 0, -0.9], elR: [-1.0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0], head: [-0.15, 0, 0], thL: [0, 0, 0], knL: [0.15, 0, 0], thR: [0, 0, 0], knR: [0.15, 0, 0], hy: 1, yaw: 0 }],
    [1.6, { shL: [-0.5, 0, 1.4], elL: [-1.5, 0, 0], shR: [-2.6, 0, -0.4], elR: [-0.4, 0, 0], hips: [0, 0, 0.14], spine: [0, 0.3, -0.1], head: [0, 0.2, 0.15], thL: [-0.35, 0, 0.1], knL: [0.6, 0, 0], thR: [0.05, 0, 0], knR: [0.1, 0, 0], hy: -2, yaw: -0.4 }],
  ] },
  wave: { duration: 0.8, loop: true, keys: [
    [0, { shR: [-0.2, 0, -2.6], elR: [0, 0, 0.45], head: [0, 0, -0.1] }],
    [0.4, { shR: [-0.2, 0, -2.6], elR: [0, 0, -0.45], head: [0, 0, -0.05] }],
    [0.8, { shR: [-0.2, 0, -2.6], elR: [0, 0, 0.45], head: [0, 0, -0.1] }],
  ] },
  beg: { duration: 1, loop: true, keys: [
    [0, { spine: [0.45, 0, 0], head: [0.15, 0, 0], shL: [-0.95, 0, -0.05], elL: [-1.3, 0, -0.7], shR: [-0.95, 0, 0.05], elR: [-1.3, 0, 0.7] }],
    [0.5, { spine: [0.5, 0, 0], head: [0.2, 0, 0], shL: [-1.0, 0, -0.05], elL: [-1.2, 0, -0.75], shR: [-1.0, 0, 0.05], elR: [-1.4, 0, 0.75] }],
    [1, { spine: [0.45, 0, 0], head: [0.15, 0, 0], shL: [-0.95, 0, -0.05], elL: [-1.3, 0, -0.7], shR: [-0.95, 0, 0.05], elR: [-1.3, 0, 0.7] }],
  ] },
  cower: { duration: 0.6, loop: true, blendIn: 0.1, keys: [
    [0, { spine: [0.5, 0, 0.04], head: [0.3, 0, 0], shL: [-2.6, 0, 0.6], elL: [-2.2, 0, -0.6], shR: [-2.6, 0, -0.6], elR: [-2.2, 0, 0.6], thL: [-0.65, 0, 0], knL: [1.15, 0, 0], thR: [-0.65, 0, 0], knR: [1.15, 0, 0], hy: -6 }],
    [0.3, { spine: [0.5, 0, -0.04], head: [0.32, 0, 0], shL: [-2.6, 0, 0.62], elL: [-2.2, 0, -0.6], shR: [-2.6, 0, -0.62], elR: [-2.2, 0, 0.6], thL: [-0.65, 0, 0], knL: [1.15, 0, 0], thR: [-0.65, 0, 0], knR: [1.15, 0, 0], hy: -6.3 }],
    [0.6, { spine: [0.5, 0, 0.04], head: [0.3, 0, 0], shL: [-2.6, 0, 0.6], elL: [-2.2, 0, -0.6], shR: [-2.6, 0, -0.6], elR: [-2.2, 0, 0.6], thL: [-0.65, 0, 0], knL: [1.15, 0, 0], thR: [-0.65, 0, 0], knR: [1.15, 0, 0], hy: -6 }],
  ] },
  scold: { duration: 1.2, loop: true, keys: [
    [0, { shR: [-1.95, 0, -0.2], elR: [-0.6, 0, 0.3], shL: [0.25, 0, 0.7], elL: [-1.6, 0, 0], chest: [0.18, 0, 0], head: [0.05, 0, 0] }],
    [0.3, { shR: [-1.95, 0, -0.2], elR: [-0.6, 0, -0.3], shL: [0.25, 0, 0.7], elL: [-1.6, 0, 0], chest: [0.22, 0, 0], head: [0.1, 0, 0] }],
    [0.6, { shR: [-1.95, 0, -0.2], elR: [-0.6, 0, 0.3], shL: [0.25, 0, 0.7], elL: [-1.6, 0, 0], chest: [0.18, 0, 0], head: [0.05, 0, 0] }],
    [0.9, { shR: [-1.95, 0, -0.2], elR: [-0.6, 0, -0.3], shL: [0.25, 0, 0.7], elL: [-1.6, 0, 0], chest: [0.22, 0, 0], head: [0.1, 0, 0] }],
    [1.2, { shR: [-1.95, 0, -0.2], elR: [-0.6, 0, 0.3], shL: [0.25, 0, 0.7], elL: [-1.6, 0, 0], chest: [0.18, 0, 0], head: [0.05, 0, 0] }],
  ], events: [[0.05, 'shout']] },
  present: { duration: 2.4, loop: true, keys: [
    [0, { shL: [-1.0, 0, 1.0], elL: [-0.3, 0, 0], shR: [-0.6, 0, -0.3], elR: [-1.2, 0, 0], head: [0, 0.5, 0] }],
    [0.8, { shL: [-1.2, 0, 0.9], elL: [-0.2, 0, 0], shR: [-0.6, 0, -0.3], elR: [-1.2, 0, 0], head: [0, 0.4, 0] }],
    [1.4, { shL: [-0.3, 0, 0.3], elL: [-0.8, 0, 0], shR: [-1.0, 0, -0.6], elR: [-1.0, 0, 0], head: [0, -0.2, 0] }],
    [2.4, { shL: [-1.0, 0, 1.0], elL: [-0.3, 0, 0], shR: [-0.6, 0, -0.3], elR: [-1.2, 0, 0], head: [0, 0.5, 0] }],
  ] },
  phone: { duration: 2, loop: true, keys: [
    [0, { shR: [-1.05, 0, -0.15], elR: [-1.65, 0, 0.45], head: [0.38, 0, 0] }],
    [1, { shR: [-1.05, 0, -0.15], elR: [-1.7, 0, 0.42], head: [0.4, 0.08, 0] }],
    [2, { shR: [-1.05, 0, -0.15], elR: [-1.65, 0, 0.45], head: [0.38, 0, 0] }],
  ] },
  give: { duration: 1.3, keys: [
    [0, { shR: [-0.3, 0, -0.1], elR: [-1.2, 0, 0], spine: [0, 0, 0] }],
    [0.6, { shR: [-1.4, 0, -0.05], elR: [-0.3, 0, 0], spine: [0.22, 0, 0] }, 'out'],
    [0.9, { shR: [-1.4, 0, -0.05], elR: [-0.3, 0, 0], spine: [0.22, 0, 0] }],
    [1.3, { shR: [0, 0, -0.09], elR: [-0.12, 0, 0], spine: [0, 0, 0] }],
  ], events: [[0.6, 'give']] },
  panic: { duration: 0.5, loop: true, keys: [
    [0, { shL: [-2.9, 0, 0.9], elL: [-0.4, 0, 0], shR: [-2.3, 0, -0.5], elR: [-0.8, 0, 0], head: [-0.2, 0.3, 0] }],
    [0.25, { shL: [-2.3, 0, 0.5], elL: [-0.8, 0, 0], shR: [-2.9, 0, -0.9], elR: [-0.4, 0, 0], head: [-0.2, -0.3, 0] }],
    [0.5, { shL: [-2.9, 0, 0.9], elL: [-0.4, 0, 0], shR: [-2.3, 0, -0.5], elR: [-0.8, 0, 0], head: [-0.2, 0.3, 0] }],
  ] },
  carry: { duration: 1, loop: true, keys: [[0, { shL: [-1.05, 0, 0.12], elL: [-0.65, 0, 0], shR: [-1.05, 0, -0.12], elR: [-0.65, 0, 0] }], [1, { shL: [-1.05, 0, 0.12], elL: [-0.65, 0, 0], shR: [-1.05, 0, -0.12], elR: [-0.65, 0, 0] }]] },
  holdUp: { duration: 0.9, loop: true, keys: [
    [0, { shR: [-2.65, 0, -0.1], elR: [-0.35, 0, 0], shL: [0, 0, 0.5], elL: [-1.2, 0, 0] }],
    [0.45, { shR: [-2.9, 0, -0.1], elR: [-0.15, 0, 0], shL: [0, 0, 0.5], elL: [-1.2, 0, 0] }],
    [0.9, { shR: [-2.65, 0, -0.1], elR: [-0.35, 0, 0], shL: [0, 0, 0.5], elL: [-1.2, 0, 0] }],
  ] },
  lookAround: { duration: 2.4, keys: [[0, { head: [0, 0, 0] }], [0.6, { head: [0, 0.75, 0] }], [1.4, { head: [0, -0.75, 0] }], [2.4, { head: [0, 0, 0] }]] },
  celebrate: { duration: 1.1, keys: [
    [0, { ...restArms, ...restLegs, hy: 0 }],
    [0.18, { shL: [-0.6, 0, 0.4], elL: [-1.2, 0, 0], shR: [-0.6, 0, -0.4], elR: [-1.2, 0, 0], thL: [-0.5, 0, 0], knL: [0.9, 0, 0], thR: [-0.5, 0, 0], knR: [0.9, 0, 0], hy: -6 }, 'out'],
    [0.42, { shL: [-2.9, 0, 0.5], elL: [-0.1, 0, 0], shR: [-2.9, 0, -0.5], elR: [-0.1, 0, 0], thL: [-0.8, 0, 0], knL: [1.4, 0, 0], thR: [-0.3, 0, 0], knR: [0.6, 0, 0], hy: 12 }, 'out'],
    [0.66, { shL: [-2.7, 0, 0.6], elL: [-0.2, 0, 0], shR: [-2.7, 0, -0.6], elR: [-0.2, 0, 0], thL: [-0.3, 0, 0], knL: [0.5, 0, 0], thR: [-0.3, 0, 0], knR: [0.5, 0, 0], hy: -3 }, 'in'],
    [1.1, { ...restArms, ...restLegs, hy: 0 }],
  ], events: [[0.66, 'land']] },
  talk: { duration: 1.8, loop: true, keys: [
    [0, { shL: [-0.5, 0, 0.3], elL: [-1.2, 0, 0], shR: [-0.2, 0, -0.15], elR: [-0.5, 0, 0], head: [0, 0, 0.05] }],
    [0.45, { shL: [-0.7, 0, 0.5], elL: [-1.0, 0, 0], shR: [-0.25, 0, -0.15], elR: [-0.5, 0, 0], head: [0.1, 0, 0] }],
    [0.9, { shL: [-0.2, 0, 0.15], elL: [-0.5, 0, 0], shR: [-0.6, 0, -0.45], elR: [-1.1, 0, 0], head: [0, 0, -0.05] }],
    [1.35, { shL: [-0.2, 0, 0.15], elL: [-0.5, 0, 0], shR: [-0.75, 0, -0.5], elR: [-0.9, 0, 0], head: [0.1, 0.1, 0] }],
    [1.8, { shL: [-0.5, 0, 0.3], elL: [-1.2, 0, 0], shR: [-0.2, 0, -0.15], elR: [-0.5, 0, 0], head: [0, 0, 0.05] }],
  ] },
  gossip: { duration: 1.4, loop: true, keys: [
    [0, { shR: [-1.45, 0, 0.3], elR: [-2.15, 0, 0], spine: [0.22, 0.2, 0], head: [0.05, 0.3, 0.1] }],
    [0.7, { shR: [-1.5, 0, 0.32], elR: [-2.2, 0, 0], spine: [0.26, 0.25, 0], head: [0.08, 0.35, 0.12] }],
    [1.4, { shR: [-1.45, 0, 0.3], elR: [-2.15, 0, 0], spine: [0.22, 0.2, 0], head: [0.05, 0.3, 0.1] }],
  ] },
  stomp: { duration: 0.8, loop: true, keys: [
    [0, { shL: [0.1, 0, 0.35], elL: [-0.3, 0, 0], shR: [0.1, 0, -0.35], elR: [-0.3, 0, 0], spine: [0.2, 0, 0], thL: [0, 0, 0], knL: [0, 0, 0], hy: 0 }],
    [0.2, { shL: [0.1, 0, 0.4], elL: [-0.3, 0, 0], shR: [0.1, 0, -0.4], elR: [-0.3, 0, 0], spine: [0.25, 0, 0], thL: [-0.8, 0, 0], knL: [1.0, 0, 0], hy: 0 }, 'out'],
    [0.35, { shL: [0.1, 0, 0.35], elL: [-0.3, 0, 0], shR: [0.1, 0, -0.35], elR: [-0.3, 0, 0], spine: [0.2, 0, 0], thL: [0, 0, 0], knL: [0, 0, 0], hy: -1.5 }, 'in'],
    [0.8, { shL: [0.1, 0, 0.35], elL: [-0.3, 0, 0], shR: [0.1, 0, -0.35], elR: [-0.3, 0, 0], spine: [0.2, 0, 0], thL: [0, 0, 0], knL: [0, 0, 0], hy: 0 }],
  ], events: [[0.35, 'stomp']] },
  stretch: { duration: 1.8, keys: [
    [0, { ...restArms, spine: [0, 0, 0] }],
    [0.6, { shL: [-2.9, 0, 0.2], elL: [-0.2, 0, 0], shR: [-2.9, 0, -0.2], elR: [-0.2, 0, 0], spine: [-0.1, 0, 0.25] }, 'out'],
    [1.1, { shL: [-2.9, 0, 0.2], elL: [-0.2, 0, 0], shR: [-2.9, 0, -0.2], elR: [-0.2, 0, 0], spine: [-0.1, 0, -0.25] }],
    [1.8, { ...restArms, spine: [0, 0, 0] }],
  ] },
  sitPhone: { duration: 2, loop: true, keys: [
    [0, { shR: [-1.0, 0, -0.1], elR: [-1.5, 0, 0.5], shL: [-0.9, 0, 0.1], elL: [-1.4, 0, -0.5], head: [0.42, 0, 0] }],
    [1, { shR: [-1.0, 0, -0.1], elR: [-1.55, 0, 0.45], shL: [-0.9, 0, 0.1], elL: [-1.45, 0, -0.45], head: [0.45, 0.05, 0] }],
    [2, { shR: [-1.0, 0, -0.1], elR: [-1.5, 0, 0.5], shL: [-0.9, 0, 0.1], elL: [-1.4, 0, -0.5], head: [0.42, 0, 0] }],
  ] },
  gaming: { duration: 0.36, loop: true, keys: [
    [0, { shL: [-0.75, 0, 0.14], elL: [-1.0, 0, -0.1], shR: [-0.75, 0, -0.14], elR: [-1.0, 0, 0.1], chest: [0.15, 0.08, 0], head: [0.1, 0.05, 0] }],
    [0.18, { shL: [-0.78, 0, 0.16], elL: [-1.1, 0, -0.12], shR: [-0.72, 0, -0.12], elR: [-0.92, 0, 0.12], chest: [0.15, -0.08, 0], head: [0.1, -0.05, 0] }],
    [0.36, { shL: [-0.75, 0, 0.14], elL: [-1.0, 0, -0.1], shR: [-0.75, 0, -0.14], elR: [-1.0, 0, 0.1], chest: [0.15, 0.08, 0], head: [0.1, 0.05, 0] }],
  ], events: [[0.02, 'key']] },
} satisfies Record<string, Clip>;

export type ClipName = keyof typeof CLIPS;

const masks = new Map<ClipName, { joints: number[]; extras: number[] }>();
function maskFor(name: ClipName) {
  let mask = masks.get(name);
  if (!mask) {
    const joints = new Set<number>(), extras = new Set<number>();
    for (const [, pose] of (CLIPS[name] as Clip).keys) {
      for (const key of Object.keys(pose)) {
        if (key === 'hy') extras.add(poseIndex.hy); else if (key === 'hz') extras.add(poseIndex.hz); else if (key === 'yaw') extras.add(poseIndex.yaw);
        else joints.add(poseIndex.joint(key as JointName));
      }
    }
    mask = { joints: [...joints], extras: [...extras] }; masks.set(name, mask);
  }
  return mask;
}
function ease(kind: Ease | undefined, t: number) {
  switch (kind) {
    case 'linear': return t;
    case 'in': return t * t * t;
    case 'out': return 1 - (1 - t) ** 3;
    default: return t * t * (3 - 2 * t);
  }
}
function write(pose: PartialPose, out: Float32Array, weight: number) {
  for (const key of Object.keys(pose) as (keyof PartialPose)[]) {
    const value = pose[key]!;
    if (typeof value === 'number') { const index = key === 'hy' ? poseIndex.hy : key === 'hz' ? poseIndex.hz : poseIndex.yaw; out[index] = out[index]! + value * weight; }
    else { const index = poseIndex.joint(key as JointName); out[index] = out[index]! + value[0] * weight; out[index + 1] = out[index + 1]! + value[1] * weight; out[index + 2] = out[index + 2]! + value[2] * weight; }
  }
}
/** Writes the clip pose at time `t` into `out` (which must be zeroed) and sets mask=1 for every channel the clip owns. */
export function evaluateClip(name: ClipName, t: number, out: Float32Array, mask: Float32Array) {
  const keys = (CLIPS[name] as Clip).keys;
  let index = 0;
  while (index < keys.length - 1 && keys[index + 1]![0] <= t) index++;
  const current = keys[index]!, next = keys[Math.min(index + 1, keys.length - 1)]!;
  const span = next[0] - current[0];
  const alpha = span > 0 ? ease(next[2], Math.min(1, Math.max(0, (t - current[0]) / span))) : 0;
  write(current[1], out, 1 - alpha);
  if (alpha > 0) write(next[1], out, alpha);
  const { joints, extras } = maskFor(name);
  for (const joint of joints) { mask[joint] = 1; mask[joint + 1] = 1; mask[joint + 2] = 1; }
  for (const extra of extras) mask[extra] = 1;
}
