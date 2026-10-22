// @summary Managed strict Luau constructors for heterogeneous input, action and expectation arrays.
export const HELPERS_MODULE_NAME = "DiligentPlaytestAPI";
export const HELPERS_SOURCE_HEADER = "--!strict\n-- Diligent managed playtest helpers";

export const HARNESS_HELPERS_SOURCE = `--!strict
-- Diligent managed playtest helpers v1. Keep game behavior in the adapter, not this module.
export type Scalar = string | number | boolean
export type Expectation = {key: string, op: "change" | "increase" | "decrease" | "equals", value: Scalar?}
export type WaitCondition =
    {instance: string, exists: boolean}
    | {instance: string, property: string, equals: (boolean | number)?, atLeast: number?, atMost: number?}
    | {ui: string, textEquals: string} | {ui: string, textContains: string}
    | {ui: string, onScreen: boolean} | {ui: string, visible: boolean}
    | {log: string}
export type Event =
    {type: "key", key: string, action: "down" | "up" | "press", durationMs: number?}
    | {type: "wait", durationMs: number, ["until"]: WaitCondition?}
    | {type: "look", yawDegrees: number?, pitchDegrees: number?, timeoutMs: number?}
    | {type: "pointerButton", button: "left" | "right", action: "down" | "up" | "press", target: string?, position: {x: number, y: number}?, durationMs: number?}
    | {type: "pointerMove", target: string?, position: {x: number, y: number}?}
    | {type: "mouseDelta", delta: {x: number, y: number}}
    | {type: "scroll", delta: number}
export type Intent = {id: string, description: string, validityKey: string, completeWhen: {Expectation}}
export type Action = {
    id: string, description: string, events: {Event}, expectations: {Expectation}?,
    coverageKey: string?, validityKey: string?, expiresAtGameTime: number?, intent: Intent?
}

local Playtest = {}

function Playtest.key(key: string, action: "down" | "up" | "press", durationMs: number?): Event
    return {type = "key", key = key, action = action, durationMs = durationMs}
end

function Playtest.wait(durationMs: number, untilCondition: WaitCondition?): Event
    return {type = "wait", durationMs = durationMs, ["until"] = untilCondition}
end

function Playtest.look(yawDegrees: number?, pitchDegrees: number?, timeoutMs: number?): Event
    return {type = "look", yawDegrees = yawDegrees, pitchDegrees = pitchDegrees, timeoutMs = timeoutMs}
end

function Playtest.click(target: string, button: ("left" | "right")?): Event
    return {type = "pointerButton", target = target, button = button or "left", action = "press"}
end

function Playtest.clickAt(x: number, y: number, button: ("left" | "right")?): Event
    return {type = "pointerButton", position = {x = x, y = y}, button = button or "left", action = "press"}
end

function Playtest.pointer(x: number, y: number): Event
    return {type = "pointerMove", position = {x = x, y = y}}
end

function Playtest.mouseDelta(x: number, y: number): Event
    return {type = "mouseDelta", delta = {x = x, y = y}}
end

function Playtest.scroll(delta: number): Event
    return {type = "scroll", delta = delta}
end

function Playtest.expect(key: string, op: "change" | "increase" | "decrease" | "equals", value: Scalar?): Expectation
    if op == "equals" and value == nil then error("equals expectations require an observed scalar value") end
    return {key = key, op = op, value = value}
end

function Playtest.action(id: string, description: string, events: {Event}, expectations: {Expectation}?): Action
    return {id = id, description = description, events = events, expectations = expectations}
end

return Playtest
`;
