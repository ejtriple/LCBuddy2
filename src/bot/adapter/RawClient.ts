import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';

/**
 * Structural type of every Client internal the bot touches, verified against
 * Client-TS@274. The adapter casts the live client instance to this shape —
 * `private` is compile-time-only, and the bot bundle never mangles property
 * names, so dot-access through this type is stable at runtime.
 *
 * This file and ClientAdapter.ts are the ONLY places allowed to name client
 * internals. When an upstream merge renames something, the self-test banner
 * lists it and the fix happens here.
 */
export interface RawClient {
    // state
    ingame: boolean;
    sceneState: number;

    // scene base (world tile = mapBuildBase + (entity.x >> 7), plane = minusedlevel)
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    minusedlevel: number;

    // entities
    localPlayer: ClientPlayer | null;
    players: (ClientPlayer | null)[];
    playerIds: Int32Array;
    playerCount: number;
    npc: (ClientNpc | null)[];
    npcIds: Int32Array;
    npcCount: number;

    // stats (Int32Array[Skill.count])
    statBaseLevel: Int32Array;
    statEffectiveLevel: Int32Array;
    statXP: Int32Array;
    runenergy: number; // 0-100
    runweight: number; // kg

    // varps
    var: number[];

    // chat ring, newest at 0, capacity 100
    chatType: Int32Array;
    chatUsername: (string | null)[];
    chatText: (string | null)[];

    // minimenu
    menuNumEntries: number;
    menuOption: string[];
    menuAction: Int32Array;
    menuParamA: Int32Array;
    menuParamB: Int32Array;
    menuParamC: Int32Array;

    // modals
    chatModalId: number;
    mainModalId: number;
    sideModalId: number;

    // packet pump (H4): tcpIn processes ONE packet per `true` return and
    // records its opcode in ptype0 just before dispatch (Client.ts ~5923)
    ptype0: number;
    tcpIn(): Promise<boolean>;
}

/**
 * Runtime manifest for the adapter self-test: every name above, checked with
 * `in` against the live instance at attach(). The satisfies clause plus the
 * exhaustiveness alias below make it a compile error for this list to drift
 * from the interface.
 */
export const SELF_TEST = [
    'ingame',
    'sceneState',
    'mapBuildBaseX',
    'mapBuildBaseZ',
    'minusedlevel',
    'localPlayer',
    'players',
    'playerIds',
    'playerCount',
    'npc',
    'npcIds',
    'npcCount',
    'statBaseLevel',
    'statEffectiveLevel',
    'statXP',
    'runenergy',
    'runweight',
    'var',
    'chatType',
    'chatUsername',
    'chatText',
    'menuNumEntries',
    'menuOption',
    'menuAction',
    'menuParamA',
    'menuParamB',
    'menuParamC',
    'chatModalId',
    'mainModalId',
    'sideModalId',
    'ptype0',
    'tcpIn'
] as const satisfies readonly (keyof RawClient)[];

type AssertNever<T extends never> = T;
// Errors here if a RawClient member is missing from SELF_TEST:
type _ManifestComplete = AssertNever<Exclude<keyof RawClient, (typeof SELF_TEST)[number]>>;
