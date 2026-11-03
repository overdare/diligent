// @summary Vendored frktest Luau sources (MIT) adapted to sibling Studio ModuleScripts for Luau tests.
// Upstream: https://github.com/itsfrank/frktest @ aa72048 (src/ without reporters/entrypoint).
// Adaptations: require paths -> script.Parent siblings, file-level helpers -> local, warn -> print
// (OVERDARE has no warn), typeof -> type in table checks. Regenerate from upstream; do not hand-edit.
const BT = "`";

export const FRKTEST_UPSTREAM = "itsfrank/frktest@aa7204871bdb9dda7a92359ba53fd4324ae78b7d";

/** ModuleScript name -> Luau source. Every module lives beside the others in the managed framework folder. */
export const FRKTEST_MODULES: Readonly<Record<string, string>> = {
  frktest: `-- frktest (https://github.com/itsfrank/frktest), vendored by Diligent. Managed module: do not edit.
--[[
MIT License

Copyright (c) 2024 Francis O'Brien

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
]]
local frktest = {}

local test = require(script.Parent.test)
local assert = require(script.Parent.assert)

-- make sure to initalize a reporter before running, otherwise you will get no output
-- see ${BT}src/reporters${BT} for builtin reporters available
-- returns false if any test failed, true otherwise
frktest.run = function(): boolean
    test.load_suites()
    return test.run_tests()
end

frktest.test = test
frktest.assert = assert

return frktest
`,
  test: String.raw`-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
local types = require(script.Parent.types)
local utils = require(script.Parent.utils)

local test = {}

type Test = types.Test
type Suite = types.Suite
type ExecCounts = types.ExecCounts
type ExecResult = types.ExecResult
type TestError = types.TestError

local _state = {}
_state.suites = {} :: { Suite }
_state.global_suite = {} :: { Test }
_state.current_load_suite = nil :: Suite?

_state.current_exec_suite = nil :: Suite?
_state.current_exec_test = nil :: Test?

_state.focus_suite = nil :: Suite?
_state.focus_test = nil :: Test?

_state.listeners = {}
_state.listeners.suite_enter = {} :: { (Suite) -> nil }
_state.listeners.suite_leave = {} :: { (Suite) -> nil }
_state.listeners.test_enter = {} :: { (Test) -> nil }
_state.listeners.test_leave = {} :: { (Test) -> nil }
_state.listeners.test_skipped = {} :: { (Test) -> nil }
_state.listeners.exec_begin = {} :: { (ExecCounts) -> nil }
_state.listeners.exec_end = {} :: { (ExecResult) -> nil }
_state.listeners.test_error = {} :: { (TestError) -> nil }

local function get_current_load_suite_tests(): { Test }
    local suite_test = _state.global_suite
    if _state.current_load_suite ~= nil then
        suite_test = _state.current_load_suite.tests
    end
    return suite_test
end

function test.suite(name: string, fn: () -> nil)
    table.insert(_state.suites, {
        name = name,
        fn = fn,
        tests = {},
        skip = false,
    })
end

function test.case(name: string, fn: () -> nil)
    local suite_tests = get_current_load_suite_tests()
    table.insert(suite_tests, {
        name = name,
        fn = fn,
        skip = false,
        failed = false,
    })
end

-- to focus on one suite/case
test.focus = {}
function test.focus.case(name: string, fn: () -> nil)
    if _state.focus_test ~= nil then
        error(${BT}focus.test called more than once, current focus test: '{_state.focus_test.name}'${BT})
    end

    test.case(name, fn)

    local suite_tests = get_current_load_suite_tests()
    _state.focus_test = suite_tests[#suite_tests]
end

function test.focus.suite(name: string, fn: () -> nil)
    if _state.focus_suite ~= nil then
        error(${BT}focus.suite called more than once, current focus suite: '{_state.focus_suite.name}'${BT})
    end

    test.suite(name, fn)
    _state.focus_suite = _state.suites[#_state.suites]
end

-- to skip suites/cases
test.skip = {}
function test.skip.case(name: string, fn: () -> nil)
    test.case(name, fn)

    local suite_tests = get_current_load_suite_tests()
    suite_tests[#suite_tests].skip = true
end

function test.skip.suite(name: string, fn: () -> nil)
    test.suite(name, fn)
    _state.suites[#_state.suites].skip = true
end

function test.load_suites()
    for _, suite_i in ipairs(_state.suites) do
        _state.current_load_suite = suite_i
        assert(_state.current_load_suite ~= nil)
        _state.current_load_suite.tests = {} -- empty list so we dont have duplicate tests
        suite_i.fn()
        _state.current_load_suite = nil
    end
end

local function exec_listeners<T>(i: T, listeners: { (T) -> nil })
    for _, l in ipairs(listeners) do
        l(i)
    end
end

local function count_tests(): number
    local count = #_state.global_suite
    for _, s in ipairs(_state.suites) do
        count += #s.tests
    end
    return count
end

-- set true to remove xpcall
-- used to debug the framework itself
test._hard_errors = false

-- returns true if all tests succeeded, false otherwise
function test.run_tests(): boolean
    local tests_ran = 0
    local tests_passed = 0
    local tests_failed = 0
    local tests_skipped = 0

    if _state.focus_suite ~= nil and _state.focus_test ~= nil then
        print(
            ${BT}both focus.case, and focus.suite have been set, the case will be run exclusively, other tests in suite '{_state.focus_suite.name}' will be skipped\n${BT}
        )
    end

    local run_test = function(t: Test, suite_skip: boolean?)
        if t.skip or suite_skip == true then
            tests_skipped += 1
            exec_listeners(t, _state.listeners.test_skipped)
            return
        end

        t.failed = false
        _state.current_exec_test = t
        exec_listeners(t, _state.listeners.test_enter)

        if test._hard_errors then
            t.fn()
        else
            local _, _ = xpcall(function()
                t.fn()
            end, function(err)
                if type(err) == "table" and err["_is_frktest_require"] == true then
                    return nil -- no extra work to do listeners will handle the failure
                end
                local strace = debug.traceback("", 2)
                local file, line = debug.info(3, "sl")
                exec_listeners({
                    location = {
                        file = file,
                        line = line,
                    },
                    strace = strace,
                    error = err,
                }, _state.listeners.test_error)

                t.failed = true
                return nil
            end)
        end

        exec_listeners(t, _state.listeners.test_leave)
        _state.current_exec_test = nil

        tests_ran += 1
        if t.failed == false then
            tests_passed += 1
        else
            tests_failed += 1
        end
    end

    local run_suite = function(s: Suite)
        _state.current_exec_suite = s
        exec_listeners(s, _state.listeners.suite_enter)
        for _, t in ipairs(s.tests) do
            run_test(t, s.skip)
        end
        exec_listeners(s, _state.listeners.suite_leave)
        _state.current_exec_suite = nil
    end

    exec_listeners({
        tests = count_tests(),
        suites = #_state.suites,
    }, _state.listeners.exec_begin)

    if _state.focus_test ~= nil then
        run_test(_state.focus_test)
    elseif _state.focus_suite ~= nil then
        run_suite(_state.focus_suite)
    else
        for _, t in ipairs(_state.global_suite) do
            run_test(t)
        end

        for _, s in ipairs(_state.suites) do
            run_suite(s)
        end
    end

    exec_listeners({
        ran = tests_ran,
        passed = tests_passed,
        failed = tests_failed,
        skipped = tests_skipped,
    }, _state.listeners.exec_end)

    return tests_failed == 0
end

function test.on_suite_enter(f: (Suite) -> nil)
    table.insert(_state.listeners.suite_enter, f)
end

function test.on_suite_leave(f: (Suite) -> nil)
    table.insert(_state.listeners.suite_leave, f)
end

function test.on_test_enter(f: (Test) -> nil)
    table.insert(_state.listeners.test_enter, f)
end

function test.on_test_leave(f: (Test) -> nil)
    table.insert(_state.listeners.test_leave, f)
end

function test.on_test_skipped(f: (Test) -> nil)
    table.insert(_state.listeners.test_skipped, f)
end

function test.on_exec_begin(f: (ExecCounts) -> nil)
    table.insert(_state.listeners.exec_begin, f)
end

function test.on_exec_end(f: (ExecResult) -> nil)
    table.insert(_state.listeners.exec_end, f)
end

function test.on_test_error(f: (TestError) -> nil)
    table.insert(_state.listeners.test_error, f)
end

function test.reset()
    _state.tests = {}
    _state.global_suite = {}
    _state.current_load_suite = nil

    _state.current_exec_suite = nil
    _state.current_exec_test = nil
end

-- returns suite object if currently executing a suite, nil otherwise
function test.current_suite(): Suite?
    return _state.current_exec_suite
end

-- returns test object if currently executing a test, nil otherwise
function test.current_test(): Test?
    return _state.current_exec_test
end

return test
`,
  assert: `-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
local types = require(script.Parent.types)

type Failure = types.Failure

local _state = {}
_state.listeners = {}
_state.listeners.check_failed = {} :: { (Failure) -> nil }
_state.listeners.require_failed = {} :: { (Failure) -> nil }
_state.current_user_msg = nil :: string?

local test = require(script.Parent.test)

local function exec_listeners<T>(i: T, listeners: { (T) -> nil })
    for _, l in ipairs(listeners) do
        l(i)
    end
end

local function make_assert<T...>(impl: (T...) -> Failure?): (T...) -> Failure?
    return function(...)
        local current_test = test.current_test()
        if current_test == nil then
            error("current test is nil, is the assertion called outside of a test function?")
        end

        local f = impl(...)
        if f == nil then
            _state.current_user_msg = nil
            return nil
        end

        -- check for user message
        if _state.current_user_msg ~= nil then
            f.user_msg = _state.current_user_msg
        end

        current_test.failed = true
        _state.current_user_msg = nil
        return f
    end
end

local function make_check<T...>(impl: (T...) -> Failure?): (T...) -> nil
    local assertion = make_assert(impl)
    return function(...)
        local f = assertion(...)
        if f == nil then
            return
        end
        exec_listeners(f, _state.listeners.check_failed)
    end
end

local function make_require<T...>(impl: (T...) -> Failure?): (T...) -> nil
    local assertion = make_assert(impl)
    return function(...)
        local f = assertion(...)
        if f == nil then
            return
        end
        exec_listeners(f, _state.listeners.require_failed)
        error({ -- halt test execution on require
            _is_frktest_require = true,
            failure = f,
        })
    end
end

local assert = {}

function assert.on_check_failed(f: (Failure) -> nil)
    table.insert(_state.listeners.check_failed, f)
end

function assert.on_require_failed(f: (Failure) -> nil)
    table.insert(_state.listeners.require_failed, f)
end

-- used to add custom messages on assertion failures
function assert.msg(s: string)
    _state.current_user_msg = s
end

-- assertion implementaitons
assert.check = {}
assert.require = {}

assert.check.array = {}
assert.require.array = {}
assert.check.table = {}
assert.require.table = {}

local assert_impl = require(script.Parent.assert_impl)

-- value assertions
assert.check.equal = make_check(assert_impl.equal)
assert.require.equal = make_require(assert_impl.equal)

assert.check.not_equal = make_check(assert_impl.not_equal)
assert.require.not_equal = make_require(assert_impl.not_equal)

assert.check.greater = make_check(assert_impl.greater)
assert.require.greater = make_require(assert_impl.greater)

assert.check.greater_eq = make_check(assert_impl.greater_eq)
assert.require.greater_eq = make_require(assert_impl.greater_eq)

assert.check.lesser = make_check(assert_impl.lesser)
assert.require.lesser = make_require(assert_impl.lesser)

assert.check.lesser_eq = make_check(assert_impl.lesser_eq)
assert.require.lesser_eq = make_require(assert_impl.lesser_eq)

assert.check.is_true = make_check(assert_impl.is_true)
assert.require.is_true = make_require(assert_impl.is_true)

assert.check.is_false = make_check(assert_impl.is_false)
assert.require.is_false = make_require(assert_impl.is_false)

assert.check.truthy = make_check(assert_impl.truthy)
assert.require.truthy = make_require(assert_impl.truthy)

assert.check.falsy = make_check(assert_impl.falsy)
assert.require.falsy = make_require(assert_impl.falsy)

assert.check.not_nil = make_check(assert_impl.not_nil)
assert.require.not_nil = make_require(assert_impl.not_nil)

-- error/exception assertions
assert.check.should_error = make_check(assert_impl.should_error)
assert.require.should_errors = make_require(assert_impl.should_error)

assert.check.should_not_error = make_check(assert_impl.should_not_error)
assert.require.should_not_errors = make_require(assert_impl.should_not_error)

-- array assertions
assert.check.array.contains = make_check(assert_impl.array_contains)
assert.require.array.contains = make_require(assert_impl.array_contains)

assert.check.array.equal = make_check(assert_impl.array_equal)
assert.require.array.equal = make_require(assert_impl.array_equal)

-- table assertions
assert.check.table.contains = make_check(assert_impl.table_contains)
assert.require.table.contains = make_require(assert_impl.table_contains)

assert.check.table.equal = make_check(assert_impl.table_equal)
assert.require.table.equal = make_require(assert_impl.table_equal)

return assert
`,
  assert_impl: `-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
local types = require(script.Parent.types)
local utils = require(script.Parent.utils)

type Failure = types.Failure
type DiffEntry<T> = types.DiffEntry<T>
type TableDiff = types.TableDiff

local assert_impl = {}

local function make_failure(message: string): Failure
    local file, line = debug.info(5, "sl")
    return {
        location = {
            file = file,
            line = line,
        },
        message = message,
    }
end

-- value assertions

function assert_impl.equal<T>(a: T, b: T): Failure?
    if a == b then
        return nil
    end
    return make_failure(${BT}{a} == {b}${BT})
end

function assert_impl.not_equal<T>(a: T, b: T): Failure?
    if a ~= b then
        return nil
    end
    return make_failure(${BT}{a} ~= {b}${BT})
end

function assert_impl.greater(a: number, b: number): Failure?
    if a > b then
        return nil
    end
    return make_failure(${BT}{a} > {b}${BT})
end

function assert_impl.greater_eq(a: number, b: number): Failure?
    if a >= b then
        return nil
    end
    return make_failure(${BT}{a} >= {b}${BT})
end

function assert_impl.lesser(a: number, b: number): Failure?
    if a < b then
        return nil
    end
    return make_failure(${BT}{a} < {b}${BT})
end

function assert_impl.lesser_eq(a: number, b: number): Failure?
    if a <= b then
        return nil
    end
    return make_failure(${BT}{a} <= {b}${BT})
end

function assert_impl.is_true<T>(a: boolean): Failure?
    if a == true then
        return nil
    end
    return make_failure(${BT}{a} == true${BT})
end

function assert_impl.is_false<T>(a: boolean): Failure?
    if a == false then
        return nil
    end
    return make_failure(${BT}{a} == false${BT})
end

function assert_impl.truthy<T>(a: any): Failure?
    if a then
        return nil
    end
    return make_failure(${BT}if {a} - condition failed${BT})
end

function assert_impl.falsy<T>(a: any): Failure?
    if not a then
        return nil
    end
    return make_failure(${BT}if not {a} - condition failed${BT})
end

function assert_impl.not_nil(a: any): Failure?
    if a ~= nil then
        return nil
    end
    return make_failure("value was nil")
end

-- error/exception assertions

function assert_impl.should_error<T...>(f: (T...) -> any?): Failure?
    local ok, _ = pcall(f)
    if not ok then
        return nil
    end
    return make_failure(${BT}did not error${BT})
end

function assert_impl.should_not_error<T...>(f: (T...) -> any?): Failure?
    local ok, err = pcall(f)
    if ok then
        return nil
    end
    return make_failure(${BT}errored: {err}${BT})
end

-- array assertions

function assert_impl.array_contains<T>(a: { T }, keys: T | { T }): Failure?
    if type(keys) ~= "table" then
        keys = { keys }
    end
    local keys_table = {}
    for _, k in ipairs(keys :: { T }) do
        keys_table[k] = false
    end

    for _, e in ipairs(a) do
        keys_table[e] = true
    end

    local missing = {}
    for k, found in pairs(keys_table) do
        if not found then
            if type(k) == "string" then
                k = '"' .. k .. '"'
            end
            table.insert(missing, k)
        end
    end

    if #missing == 0 then
        return nil
    end

    return make_failure(${BT}missing values: {table.concat(missing, ", ")}${BT})
end

function assert_impl.array_equal<T>(a: { [number]: T }, b: { [number]: T }): Failure?
    local min_len = math.min(#a, #b)
    local diff = {} :: { [number]: DiffEntry<T> }

    for i = 1, min_len do
        if a[i] ~= b[i] then
            table.insert(diff, { k = i, v = { a = a[i], b = b[i] }, t = "~" })
        end
    end

    if #a ~= #b then
        local max_len = math.max(#a, #b)
        local longer: { [number]: T } = if #a > #b then a else b
        local type: "+" | "-" = if #a > #b then "+" else "-"
        for i = min_len + 1, max_len do
            table.insert(diff, { k = i, t = type, v = longer[i] })
        end
    end

    if #diff == 0 then
        return nil
    end

    local f = make_failure("Arrays were not equal")
    f.complex_info = {
        type = "ArrayDiff",
        data = diff,
    }

    return f
end

-- table assertions

function assert_impl.table_contains(t: any, keys: any | { [number]: any }): Failure?
    -- ensure input is a tables
    if type(t) ~= "table" then
        return make_failure(${BT}type of arg 1 is {type(t)}, expected a table${BT})
    end

    if type(keys) ~= "table" then
        keys = { keys }
    end

    local missing = {}
    for _, k in ipairs(keys) do
        if t[k] == nil then
            table.insert(missing, k)
        end
    end

    if #missing == 0 then
        return nil
    end

    return make_failure(${BT}missing keys: {table.concat(missing, ", ")}${BT})
end

local ltdiff = require(script.Parent.ltdiff)
function assert_impl.table_equal(a: any, b: any): Failure?
    -- ensure inputs are tables
    if type(a) ~= "table" then
        return make_failure(${BT}type of arg 1 is {type(a)}, expected a table${BT})
    end
    if type(b) ~= "table" then
        return make_failure(${BT}type of arg 2 is {type(b)}, expected a table${BT})
    end

    -- convert ltdiff into our diff format
    local function ltdiff_to_frkdiff(lt_diff: ltdiff.Diff): (boolean, TableDiff)
        local has_diff = false
        local frk_diff: TableDiff = { diff = {} }

        if lt_diff.add ~= nil then
            has_diff = true
            for _, v in ipairs(lt_diff.add) do
                table.insert(frk_diff.diff, { k = v.k, t = "-", v = v.v })
            end
        end

        if lt_diff.del ~= nil then
            has_diff = true
            for _, v in ipairs(lt_diff.del) do
                table.insert(frk_diff.diff, { k = v.k, t = "+", v = v.v })
            end
        end

        if lt_diff.mod ~= nil then
            has_diff = true
            for k, v in pairs(lt_diff.mod) do
                table.insert(frk_diff.diff, { k = k, t = "~", v = { a = v.a, b = v.b } })
            end
        end

        if lt_diff.sub ~= nil then
            has_diff = true
            frk_diff.sub = {}
            for k, v in pairs(lt_diff.sub) do
                assert(frk_diff.sub)
                local sub_has_diff
                sub_has_diff, frk_diff.sub[k] = ltdiff_to_frkdiff(v)
                has_diff = has_diff or sub_has_diff
            end
        end

        return has_diff, frk_diff
    end
    local lt_diff, _warning = ltdiff.diff(a, b)

    local has_diff, diff = ltdiff_to_frkdiff(lt_diff)
    if not has_diff then
        return nil
    end

    local f = make_failure("Tables were not equal")
    f.complex_info = {
        type = "TableDiff",
        data = diff,
    }

    return f
end

return assert_impl
`,
  types: `-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
type Location = {
    file: string,
    line: string,
}

export type Failure = {
    location: Location,
    message: string,
    user_msg: string?,
    complex_info: {
        type: string,
        data: any,
    }?,
}

export type DiffEntry<T> = {
    k: any,
    t: "+" | "-" | "~",
    v: T | { a: T, b: T }, -- latter for t=="~"
}

export type TableDiff = {
    diff: { [number]: DiffEntry<any> },
    sub: { [any]: TableDiff }?,
}

export type TestError = {
    location: Location,
    strace: string,
    error: any,
}

export type Test = {
    -- config state
    name: string,
    fn: () -> nil,
    skip: boolean,
    -- result state
    failed: boolean,
}

export type Suite = {
    name: string,
    fn: () -> nil,
    tests: { Test },
    skip: boolean,
}

export type ExecCounts = {
    suites: number,
    tests: number,
}

export type ExecResult = {
    ran: number,
    passed: number,
    failed: number,
    skipped: number,
}

return {}
`,
  utils: String.raw`-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
local utils = {}

function utils.trim(s: string): string
    return (s:gsub("^%s*(.-)%s*$", "%1"))
end

function utils.make_indent(i: number): string
    local spaces = "    "
    local s = ""
    for j = 0, i - 1 do
        s = s .. spaces
    end
    return s
end

function utils.multiline_to_array(s: string): { string }
    local res = {}
    for line in string.gmatch(s .. "\n", "(.-)\n") do
        table.insert(res, line)
    end
    return res
end

function utils.indent_multiline(s: string, i: number): string
    local lines = utils.multiline_to_array(s)
    for k, s in ipairs(utils.multiline_to_array(s)) do
        lines[k] = utils.make_indent(i) .. s
    end
    return table.concat(lines, "\n")
end

return utils
`,
  inspect: String.raw`-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
-- adapted from: https://github.com/kikito/inspect.lua
--[[
Changes by @itsfrank:
    - Cast module return to luau type matching inspect function signature
]]
--

local _tl_compat
if (tonumber((_VERSION or ""):match("[%d.]*$")) or 0) < 5.3 then
    local p, m = pcall(require, "compat53.module")
    if p then
        _tl_compat = m
    end
end
local math = _tl_compat and _tl_compat.math or math
local string = _tl_compat and _tl_compat.string or string
local table = _tl_compat and _tl_compat.table or table
local inspect = { Options = {} }

inspect._VERSION = "inspect.lua 3.1.0"
inspect._URL = "http://github.com/kikito/inspect.lua"
inspect._DESCRIPTION = "human-readable representations of tables"
inspect._LICENSE = [[
  MIT LICENSE

  Copyright (c) 2022 Enrique García Cota

  Permission is hereby granted, free of charge, to any person obtaining a
  copy of this software and associated documentation files (the
  "Software"), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be included
  in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
]]
inspect.KEY = setmetatable({}, {
    __tostring = function()
        return "inspect.KEY"
    end,
})
inspect.METATABLE = setmetatable({}, {
    __tostring = function()
        return "inspect.METATABLE"
    end,
})

local tostring = tostring
local rep = string.rep
local match = string.match
local char = string.char
local gsub = string.gsub
local fmt = string.format

local _rawget
if rawget then
    _rawget = rawget
else
    _rawget = function(t, k)
        return t[k]
    end
end

local function rawpairs(t)
    return next, t, nil
end

local function smartQuote(str)
    if match(str, '"') and not match(str, "'") then
        return "'" .. str .. "'"
    end
    return '"' .. gsub(str, '"', '\\"') .. '"'
end

local shortControlCharEscapes = {
    ["\a"] = "\\a",
    ["\b"] = "\\b",
    ["\f"] = "\\f",
    ["\n"] = "\\n",
    ["\r"] = "\\r",
    ["\t"] = "\\t",
    ["\v"] = "\\v",
    ["\127"] = "\\127",
}
local longControlCharEscapes = { ["\127"] = "\127" }
for i = 0, 31 do
    local ch = char(i)
    if not shortControlCharEscapes[ch] then
        shortControlCharEscapes[ch] = "\\" .. i
        longControlCharEscapes[ch] = fmt("\\%03d", i)
    end
end

local function escape(str)
    return (gsub(gsub(gsub(str, "\\", "\\\\"), "(%c)%f[0-9]", longControlCharEscapes), "%c", shortControlCharEscapes))
end

local luaKeywords = {
    ["and"] = true,
    ["break"] = true,
    ["do"] = true,
    ["else"] = true,
    ["elseif"] = true,
    ["end"] = true,
    ["false"] = true,
    ["for"] = true,
    ["function"] = true,
    ["goto"] = true,
    ["if"] = true,
    ["in"] = true,
    ["local"] = true,
    ["nil"] = true,
    ["not"] = true,
    ["or"] = true,
    ["repeat"] = true,
    ["return"] = true,
    ["then"] = true,
    ["true"] = true,
    ["until"] = true,
    ["while"] = true,
}

local function isIdentifier(str)
    return type(str) == "string" and not not str:match("^[_%a][_%a%d]*$") and not luaKeywords[str]
end

local flr = math.floor
local function isSequenceKey(k, sequenceLength)
    return type(k) == "number" and flr(k) == k and 1 <= k and k <= sequenceLength
end

local defaultTypeOrders = {
    ["number"] = 1,
    ["boolean"] = 2,
    ["string"] = 3,
    ["table"] = 4,
    ["function"] = 5,
    ["userdata"] = 6,
    ["thread"] = 7,
}

local function sortKeys(a, b)
    local ta, tb = type(a), type(b)

    if ta == tb and (ta == "string" or ta == "number") then
        return a < b
    end

    local dta = defaultTypeOrders[ta] or 100
    local dtb = defaultTypeOrders[tb] or 100

    return dta == dtb and ta < tb or dta < dtb
end

local function getKeys(t)
    local seqLen = 1
    while _rawget(t, seqLen) ~= nil do
        seqLen = seqLen + 1
    end
    seqLen = seqLen - 1

    local keys, keysLen = {}, 0
    for k in rawpairs(t) do
        if not isSequenceKey(k, seqLen) then
            keysLen = keysLen + 1
            keys[keysLen] = k
        end
    end
    table.sort(keys, sortKeys)
    return keys, keysLen, seqLen
end

local function countCycles(x, cycles)
    if type(x) == "table" then
        if cycles[x] then
            cycles[x] = cycles[x] + 1
        else
            cycles[x] = 1
            for k, v in rawpairs(x) do
                countCycles(k, cycles)
                countCycles(v, cycles)
            end
            countCycles(getmetatable(x), cycles)
        end
    end
end

local function makePath(path, a, b)
    local newPath = {}
    local len = #path
    for i = 1, len do
        newPath[i] = path[i]
    end

    newPath[len + 1] = a
    newPath[len + 2] = b

    return newPath
end

local function processRecursive(process, item, path, visited)
    if item == nil then
        return nil
    end
    if visited[item] then
        return visited[item]
    end

    local processed = process(item, path)
    if type(processed) == "table" then
        local processedCopy = {}
        visited[item] = processedCopy
        local processedKey

        for k, v in rawpairs(processed) do
            processedKey = processRecursive(process, k, makePath(path, k, inspect.KEY), visited)
            if processedKey ~= nil then
                processedCopy[processedKey] = processRecursive(process, v, makePath(path, processedKey), visited)
            end
        end

        local mt = processRecursive(process, getmetatable(processed), makePath(path, inspect.METATABLE), visited)
        if type(mt) ~= "table" then
            mt = nil
        end
        setmetatable(processedCopy, mt)
        processed = processedCopy
    end
    return processed
end

local function puts(buf, str)
    buf.n = buf.n + 1
    buf[buf.n] = str
end

local Inspector = {}

local Inspector_mt = { __index = Inspector }

local function tabify(inspector)
    puts(inspector.buf, inspector.newline .. rep(inspector.indent, inspector.level))
end

function Inspector:getId(v)
    local id = self.ids[v]
    local ids = self.ids
    if not id then
        local tv = type(v)
        id = (ids[tv] or 0) + 1
        ids[v], ids[tv] = id, id
    end
    return tostring(id)
end

function Inspector:putValue(v)
    local buf = self.buf
    local tv = type(v)
    if tv == "string" then
        puts(buf, smartQuote(escape(v)))
    elseif tv == "number" or tv == "boolean" or tv == "nil" or tv == "cdata" or tv == "ctype" then
        puts(buf, tostring(v))
    elseif tv == "table" and not self.ids[v] then
        local t = v

        if t == inspect.KEY or t == inspect.METATABLE then
            puts(buf, tostring(t))
        elseif self.level >= self.depth then
            puts(buf, "{...}")
        else
            if self.cycles[t] > 1 then
                puts(buf, fmt("<%d>", self:getId(t)))
            end

            local keys, keysLen, seqLen = getKeys(t)

            puts(buf, "{")
            self.level = self.level + 1

            for i = 1, seqLen + keysLen do
                if i > 1 then
                    puts(buf, ",")
                end
                if i <= seqLen then
                    puts(buf, " ")
                    self:putValue(t[i])
                else
                    local k = keys[i - seqLen]
                    tabify(self)
                    if isIdentifier(k) then
                        puts(buf, k)
                    else
                        puts(buf, "[")
                        self:putValue(k)
                        puts(buf, "]")
                    end
                    puts(buf, " = ")
                    self:putValue(t[k])
                end
            end

            local mt = getmetatable(t)
            if type(mt) == "table" then
                if seqLen + keysLen > 0 then
                    puts(buf, ",")
                end
                tabify(self)
                puts(buf, "<metatable> = ")
                self:putValue(mt)
            end

            self.level = self.level - 1

            if keysLen > 0 or type(mt) == "table" then
                tabify(self)
            elseif seqLen > 0 then
                puts(buf, " ")
            end

            puts(buf, "}")
        end
    else
        puts(buf, fmt("<%s %d>", tv, self:getId(v)))
    end
end

function inspect.inspect(root, options)
    options = options or {}

    local depth = options.depth or math.huge
    local newline = options.newline or "\n"
    local indent = options.indent or "  "
    local process = options.process

    if process then
        root = processRecursive(process, root, {}, {})
    end

    local cycles = {}
    countCycles(root, cycles)

    local inspector = setmetatable({
        buf = { n = 0 },
        ids = {},
        cycles = cycles,
        depth = depth,
        level = 0,
        newline = newline,
        indent = indent,
    }, Inspector_mt)

    inspector:putValue(root)

    return table.concat(inspector.buf)
end

setmetatable(inspect, {
    __call = function(_, root, options)
        return inspect.inspect(root, options)
    end,
})

-- cast so luau typechecker is nice to us
local inspect_cast = (inspect :: any) :: (root: any, options: any?) -> string
return inspect_cast
`,
  ltdiff: `-- frktest (MIT, see the frktest module header), vendored by Diligent. Managed module: do not edit.
-- adapted from: https://github.com/martinfelis/luatablediff
--[[
Changes by @itsfrank:
    - Make type and cast return value
    - Change error when function/userdata is found to a warning string and return
    - Add diff.add to differentate items that exist in A but are nil in B, from modified items
    - diff.add and diff.del store both keys and values
]]
--

--[[
Copyright © 2012-14 Martin Felis <martin@fysx.org>

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
]]
--

-- require 'strict'

export type Diff = {
    del: { [number]: { k: any, v: any } }?,
    add: { [number]: { k: any, v: any } }?,
    mod: { [any]: { a: any, b: any } }?,
    sub: Diff?,
}
local ltdiff = {}

local function table_diff(A: any, B: any): (Diff, string?)
    local warning = nil
    local diff: any = { del = {}, add = {}, mod = {}, sub = {} }

    for k, v in pairs(A) do
        if type(A[k]) == "function" or type(A[k]) == "userdata" then
            warning = "${BT}function${BT} and ${BT}userdata${BT} types are skipped"
            continue
        elseif B[k] ~= nil and type(A[k]) == "table" and type(B[k]) == "table" then
            diff.sub[k] = table_diff(A[k], B[k])

            if next(diff.sub[k]) == nil then
                diff.sub[k] = nil
            end
        elseif B[k] == nil then
            diff.del[#diff.del + 1] = { k = k, v = A[k] }
        elseif B[k] ~= v then
            diff.mod[k] = { a = A[k], b = B[k] }
        end
    end

    for k, v in pairs(B) do
        if type(B[k]) == "function" or type(B[k]) == "userdata" then
            warning = "${BT}function${BT} and ${BT}userdata${BT} types are skipped"
            continue
        elseif diff.sub[k] ~= nil then
            -- skip
        elseif A[k] ~= nil and type(A[k]) == "table" and type(B[k]) == "table" then
            diff.sub[k] = table_diff(B[k], A[k])

            if next(diff.sub[k]) == nil then
                diff.sub[k] = nil
            end
        elseif B[k] ~= nil and A[k] == nil then
            diff.add[#diff.add + 1] = { k = k, v = B[k] }
        elseif B[k] ~= A[k] then
            diff.mod[k] = { a = A[k], b = B[k] }
        end
    end

    if next(diff.sub) == nil then
        diff.sub = nil
    end

    if next(diff.add) == nil then
        diff.add = nil
    end

    if next(diff.mod) == nil then
        diff.mod = nil
    end

    if next(diff.del) == nil then
        diff.del = nil
    end

    return diff, warning
end

ltdiff.diff = table_diff

return ltdiff
`,
};
