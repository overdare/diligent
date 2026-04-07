// @bun
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// apps/overdare-agent/plugins/plugin-studiorpc/src/rpc.ts
import net from "net";
import readline from "readline";

// apps/overdare-agent/plugins/plugin-studiorpc/src/config.ts
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
function stripJsonComments(text) {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
var cached;
function loadOverdareConfig() {
  if (cached)
    return cached;
  const configPath = join(homedir(), ".diligent", "overdare.jsonc");
  try {
    const raw = readFileSync(configPath, "utf-8");
    cached = JSON.parse(stripJsonComments(raw));
    return cached;
  } catch {
    cached = {};
    return cached;
  }
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/rpc.ts
var DEFAULT_HOST = "localhost";
var DEFAULT_PORT = 13377;
var TIMEOUT_MS = 1e4;
var nextId = 1;
function resolveHost() {
  if (process.env.STUDIO_HOST)
    return process.env.STUDIO_HOST;
  const cfg = loadOverdareConfig();
  return cfg.host ?? DEFAULT_HOST;
}
function resolvePort() {
  const envPort = process.env.STUDIO_PORT;
  if (envPort) {
    const parsed = Number(envPort);
    if (!Number.isNaN(parsed) && parsed > 0)
      return parsed;
  }
  const cfg = loadOverdareConfig();
  return cfg.port ?? DEFAULT_PORT;
}
async function applyAndSave() {
  const result = await call("level.apply", {});
  await call("level.save.file", {});
  return result;
}
async function call(method, params) {
  const host = resolveHost();
  const port = resolvePort();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...params !== undefined && Object.keys(params).length > 0 && { params }
    };
    let settled = false;
    function settle(fn) {
      if (settled)
        return;
      settled = true;
      fn();
    }
    const connectHost = host === "localhost" ? "127.0.0.1" : host;
    const rawRequest = JSON.stringify(request);
    console.log(`[RPC \u2192] ${rawRequest}`);
    const socket = net.createConnection({ host: connectHost, port }, () => {
      socket.write(`${rawRequest}
`);
    });
    const rl = readline.createInterface({ input: socket });
    const timer = setTimeout(() => {
      settle(() => {
        cleanup();
        reject(new Error(`Studio RPC timed out (${method}).
` + `Make sure OVERDARE Studio is running. If the problem persists, restart the agent.`));
      });
    }, TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      rl.close();
      socket.destroy();
    }
    rl.once("line", (line) => {
      settle(() => {
        cleanup();
        try {
          const response = JSON.parse(line);
          console.log(`[RPC \u2190] ${line}`);
          if (response.error) {
            let errorMsg = `Studio RPC error [${response.error.code}]: ${response.error.message}`;
            errorMsg += `

Request was:
${rawRequest}`;
            if (response.error.message?.toLowerCase().includes("guid")) {
              errorMsg += `

Tip: Use studiorpc_level_browse first to get valid GUIDs.`;
            }
            reject(new Error(errorMsg));
          } else {
            resolve(response.result);
          }
        } catch {
          reject(new Error(`Failed to parse Studio RPC response.
Received: ${line.substring(0, 200)}`));
        }
      });
    });
    socket.on("error", () => {
      settle(() => {
        cleanup();
        reject(new Error(`Could not connect to Studio RPC server.
` + `Make sure OVERDARE Studio is running. If the problem persists, restart the agent.`));
      });
    });
  });
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/action-sequencer-service.apply-json.ts
var exports_action_sequencer_service_apply_json = {};
__export(exports_action_sequencer_service_apply_json, {
  params: () => params,
  method: () => method,
  description: () => description
});

// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/.bun/zod@3.25.76/node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;

class ZodNativeEnum extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/action-sequencer-service.apply-json.ts
var method = "action_sequencer_service.apply_json";
var description = "Apply a sequencer JSON file to an existing Action Sequencer instance in the level.";
var params = exports_external.object({
  instanceGuid: exports_external.string().describe("GUID of the target Action Sequencer instance"),
  jsonFilePath: exports_external.string().describe("Absolute file path to the sequencer JSON file")
});

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/asset-manager.image.import.ts
var exports_asset_manager_image_import = {};
__export(exports_asset_manager_image_import, {
  params: () => params2,
  method: () => method2,
  description: () => description2
});
var method2 = "asset_manager.image.import";
var description2 = "Import an external image file into the asset manager and return the created asset id.";
var params2 = exports_external.object({
  file: exports_external.string().describe("Absolute file path to the image to import")
});

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/game.play.ts
var exports_game_play = {};
__export(exports_game_play, {
  params: () => params3,
  method: () => method3,
  description: () => description3
});
var method3 = "game.play";
var description3 = "Play the game in OVERDARE Studio. It clears the existing log file.";
var params3 = exports_external.object({
  numberOfPlayer: exports_external.number().int().positive().optional()
});

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/game.stop.ts
var exports_game_stop = {};
__export(exports_game_stop, {
  params: () => params4,
  method: () => method4,
  description: () => description4
});
var method4 = "game.stop";
var description4 = "Stop the currently playing game in OVERDARE Studio.";
var params4 = exports_external.object({});

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/level.browse.ts
var exports_level_browse = {};
__export(exports_level_browse, {
  postProcess: () => postProcess,
  params: () => params5,
  normalizeArgs: () => normalizeArgs,
  method: () => method5,
  description: () => description5
});
var method5 = "level.browse";
var description5 = 'Browse the level instance tree. Returns instances with guid, name, class, children, and optional filename (e.g. "WorldManagerScript_1.lua" for Script instances). Optionally filter by classType to return only instances of a specific class. Use maxDepth to limit tree depth (recommended: start with 1).';
var params5 = exports_external.object({
  startGuid: exports_external.string().optional().describe("If provided, start browsing from this instance instead of the root."),
  classType: exports_external.string().optional().describe('If provided, only return instances whose class matches this value (e.g. "Script", "Part").'),
  maxDepth: exports_external.number().int().min(1).optional().describe("Maximum depth of the tree to return. 1 = top-level nodes only, 2 = nodes + direct children, etc. 0 or omit for unlimited depth. Recommended to start with 1.")
});
function normalizeArgs(args) {
  const { startGuid: _s, classType: _c, maxDepth: _d, ...rest } = args;
  return rest;
}
function findNode(nodes, guid) {
  for (const node of nodes) {
    if (node.guid === guid)
      return node;
    if (node.children) {
      const found = findNode(node.children, guid);
      if (found)
        return found;
    }
  }
  return;
}
function filterByClass(nodes, classType) {
  const result = [];
  for (const node of nodes) {
    const children = node.children ? filterByClass(node.children, classType) : [];
    if (node.class === classType || children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}
function truncateDepth(nodes, maxDepth, depth = 1) {
  return nodes.map((node) => {
    if (depth >= maxDepth || !node.children) {
      const { children: _, ...rest } = node;
      return rest;
    }
    return { ...node, children: truncateDepth(node.children, maxDepth, depth + 1) };
  });
}
function postProcess(result, args) {
  let nodes;
  if (Array.isArray(result)) {
    nodes = result;
  } else if (result && typeof result === "object" && "level" in result && Array.isArray(result.level)) {
    nodes = result.level;
  } else {
    return result;
  }
  const startGuid = typeof args.startGuid === "string" ? args.startGuid : undefined;
  if (startGuid) {
    const start = findNode(nodes, startGuid);
    if (!start)
      return [];
    nodes = [start];
  }
  const classType = typeof args.classType === "string" ? args.classType : undefined;
  if (classType) {
    nodes = filterByClass(nodes, classType);
  }
  const maxDepth = typeof args.maxDepth === "number" && args.maxDepth > 0 ? args.maxDepth : undefined;
  if (maxDepth !== undefined) {
    nodes = truncateDepth(nodes, maxDepth);
  }
  return nodes;
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/level.save.file.ts
var exports_level_save_file = {};
__export(exports_level_save_file, {
  params: () => params6,
  method: () => method6,
  description: () => description6
});
var method6 = "level.save.file";
var description6 = "Save the world currently being edited in the editor to file. Saving updates both .umap and .ovdrjm files.";
var params6 = exports_external.object({});

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/script.add.ts
var exports_script_add = {};
__export(exports_script_add, {
  params: () => params7,
  method: () => method7,
  description: () => description7
});
var method7 = "script.add";
var description7 = "Add a script under a parent instance.";
var params7 = exports_external.object({
  class: exports_external.enum(["LocalScript", "Script", "ModuleScript"]),
  parentGuid: exports_external.string().describe("GUID of the parent instance (use studiorpc_level_browse to find)"),
  name: exports_external.string(),
  source: exports_external.string().describe("Luau source code")
});

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/script.delete.ts
var exports_script_delete = {};
__export(exports_script_delete, {
  params: () => params8,
  method: () => method8,
  description: () => description8
});
var method8 = "script.delete";
var description8 = "Delete a script instance.";
var params8 = exports_external.object({
  targetGuid: exports_external.string().describe("GUID of the script to delete")
});

// apps/overdare-agent/plugins/plugin-studiorpc/src/render.ts
function isStructuralSummaryLine(value) {
  const trimmed = value.trim();
  if (!trimmed)
    return true;
  if (trimmed === "{" || trimmed === "[" || trimmed === "}" || trimmed === "]")
    return true;
  if (/^<[^>]+>$/.test(trimmed))
    return true;
  if (trimmed.startsWith("{") || trimmed.startsWith("["))
    return true;
  return false;
}
function isStructuredOutput(text) {
  const trimmed = text?.trim();
  if (!trimmed)
    return false;
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<");
}
function firstLine(text, fallback) {
  if (isStructuredOutput(text))
    return fallback;
  const line = text.split(`
`).map((value) => value.trim()).find((value) => value.length > 0 && !isStructuralSummaryLine(value));
  return line || fallback;
}
function summarizeText(text, fallback) {
  if (isStructuredOutput(text))
    return fallback;
  const line = text?.split(`
`).map((value) => value.trim()).find((value) => value.length > 0 && !isStructuralSummaryLine(value));
  if (line)
    return line;
  return fallback;
}
function summarizeCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
function clip(value, max = 80) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}\u2026` : value;
}
function summarizeTargets(values, actionWord) {
  if (values.length === 0)
    return actionWord;
  if (values.length === 1)
    return `${actionWord} ${values[0]}`;
  if (values.length === 2)
    return `${actionWord} ${values[0]}, ${values[1]}`;
  return `${actionWord} ${values[0]}, ${values[1]} +${values.length - 2}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function readString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function toTreeNode(value) {
  const name = readString(value.name) ?? "Instance";
  const className = readString(value.class);
  const filename = readString(value.filename);
  const childrenValue = Array.isArray(value.children) ? value.children : [];
  const children = childrenValue.flatMap((child) => {
    if (!isRecord(child))
      return [];
    const node = toTreeNode(child);
    return node ? [node] : [];
  });
  const label = [name, className ? `(${className})` : "", filename ? `\u2014 ${filename}` : ""].filter(Boolean).join(" ");
  return { label, ...children.length > 0 ? { children } : {} };
}
function buildLevelBrowseRender(result, args) {
  const entries = Array.isArray(result) ? result : isRecord(result) && Array.isArray(result.level) ? result.level : null;
  if (!entries)
    return;
  const nodes = entries.flatMap((entry) => {
    if (!isRecord(entry))
      return [];
    const node = toTreeNode(entry);
    return node ? [node] : [];
  });
  if (nodes.length === 0)
    return;
  const startGuid = readString(args.startGuid);
  const classType = readString(args.classType);
  const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : undefined;
  const inputParts = ["browse"];
  if (startGuid)
    inputParts.push(`from:${startGuid}`);
  if (classType)
    inputParts.push(`class:${classType}`);
  if (maxDepth !== undefined)
    inputParts.push(`depth:${maxDepth}`);
  const inputSummary = clip(inputParts.join(" "));
  const kvItems = [];
  if (startGuid)
    kvItems.push({ key: "startGuid", value: startGuid });
  if (classType)
    kvItems.push({ key: "classType", value: classType });
  if (maxDepth !== undefined)
    kvItems.push({ key: "maxDepth", value: String(maxDepth) });
  return {
    inputSummary,
    outputSummary: summarizeCount(nodes.length, "root node"),
    blocks: [
      ...kvItems.length > 0 ? [{ type: "key_value", title: "Level browse", items: kvItems }] : [],
      { type: "tree", title: "Level tree", nodes }
    ]
  };
}
function buildScriptAddRender(args, output) {
  const className = readString(args.class) ?? "Script";
  const scriptName = readString(args.name) ?? "unnamed";
  return {
    inputSummary: clip(`${className} ${scriptName}`),
    outputSummary: summarizeText(output, "Script added."),
    blocks: [
      {
        type: "key_value",
        title: "Studio script add",
        items: [
          { key: "class", value: className },
          { key: "name", value: scriptName },
          { key: "parent", value: readString(args.parentGuid) ?? "" }
        ].filter((item) => item.value.length > 0)
      },
      { type: "summary", text: firstLine(output, "Script added."), tone: "success" }
    ]
  };
}
function buildDeleteRender(title, targetGuid, output) {
  return {
    inputSummary: clip(targetGuid || title),
    outputSummary: summarizeText(output, "Deleted."),
    blocks: [
      { type: "key_value", title, items: [{ key: "targetGuid", value: targetGuid }] },
      { type: "summary", text: firstLine(output, "Deleted."), tone: "warning" }
    ]
  };
}
function buildInstanceDeleteRender(args, output) {
  const items = Array.isArray(args.items) ? args.items : [];
  const targetGuids = items.flatMap((item) => {
    if (!isRecord(item))
      return [];
    const guid = readString(item.targetGuid);
    return guid ? [guid] : [];
  });
  const deleteCount = targetGuids.length;
  const inputSummary = summarizeTargets(targetGuids, "delete");
  return {
    inputSummary: clip(inputSummary),
    outputSummary: summarizeText(output, "Deleted."),
    blocks: [
      {
        type: "key_value",
        title: "Studio instance delete",
        items: [
          { key: "deletes", value: String(deleteCount) },
          ...targetGuids.map((guid, index) => ({ key: `target${index + 1}`, value: guid }))
        ]
      },
      { type: "summary", text: firstLine(output, "Deleted."), tone: "warning" }
    ]
  };
}
function buildGamePlayRender(args, output) {
  const count = typeof args.numberOfPlayer === "number" ? String(args.numberOfPlayer) : "1";
  return {
    inputSummary: `players: ${count}`,
    outputSummary: summarizeText(output, "Game started."),
    blocks: [
      { type: "key_value", title: "Studio play", items: [{ key: "players", value: count }] },
      { type: "summary", text: firstLine(output, "Game started."), tone: "success" }
    ]
  };
}
function buildGameStopRender(output) {
  return {
    inputSummary: "stop game",
    outputSummary: summarizeText(output, "Game stopped."),
    blocks: [{ type: "summary", text: firstLine(output, "Game stopped."), tone: "warning" }]
  };
}
function buildAssetManagerImageImportRender(result, args, output) {
  const file = readString(args.file) ?? "";
  const asset = isRecord(result) && isRecord(result.asset) ? result.asset : undefined;
  const returnedAssetId = asset ? readString(asset.assetid) : undefined;
  const returnedFile = asset ? readString(asset.file) : undefined;
  return {
    inputSummary: clip(file || "image file"),
    outputSummary: summarizeText(output, returnedAssetId ? `Imported as ${returnedAssetId}` : "Image imported."),
    blocks: [
      {
        type: "key_value",
        title: "Asset manager image import",
        items: [
          { key: "file", value: returnedFile ?? file },
          { key: "assetid", value: returnedAssetId ?? "" }
        ].filter((item) => item.value.length > 0)
      },
      {
        type: "summary",
        text: firstLine(output, returnedAssetId ? `Imported as ${returnedAssetId}` : "Image imported."),
        tone: "success"
      }
    ]
  };
}
function buildLevelSaveFileRender(output) {
  return {
    inputSummary: "save current world",
    outputSummary: summarizeText(output, "World file saved."),
    blocks: [{ type: "summary", text: firstLine(output, "World file saved."), tone: "success" }]
  };
}
function buildInstanceReadRender(args, output) {
  const guid = readString(args.guid) ?? "";
  const recursive = args.recursive === true;
  return {
    inputSummary: clip(guid || "instance read"),
    outputSummary: summarizeText(output, "Instance read."),
    blocks: [
      {
        type: "key_value",
        title: "Studio instance read",
        items: [
          { key: "guid", value: guid },
          { key: "recursive", value: String(recursive) }
        ].filter((item) => item.value.length > 0)
      },
      { type: "summary", text: firstLine(output, "Instance read."), tone: "info" }
    ]
  };
}
function buildInstanceUpsertRender(args, output) {
  const items = Array.isArray(args.items) ? args.items : [];
  const addCount = items.filter((i) => isRecord(i) && ("parentGuid" in i)).length;
  const updateCount = items.filter((i) => isRecord(i) && ("guid" in i) && !("parentGuid" in i)).length;
  const parts = [];
  if (addCount > 0)
    parts.push(summarizeCount(addCount, "add"));
  if (updateCount > 0)
    parts.push(summarizeCount(updateCount, "update"));
  const summary = parts.join(", ") || "upsert";
  return {
    inputSummary: clip(summary),
    outputSummary: summarizeText(output, "Instances upserted."),
    blocks: [
      {
        type: "key_value",
        title: "Studio instance upsert",
        items: [
          { key: "adds", value: String(addCount) },
          { key: "updates", value: String(updateCount) }
        ]
      },
      { type: "summary", text: firstLine(output, "Instances upserted."), tone: "success" }
    ]
  };
}
function buildInstanceMoveRender(args, output) {
  const items = Array.isArray(args.items) ? args.items : [];
  const moveCount = items.filter((item) => isRecord(item) && readString(item.guid) && readString(item.parentGuid)).length;
  return {
    inputSummary: clip(moveCount > 0 ? summarizeCount(moveCount, "move") : "move"),
    outputSummary: summarizeText(output, "Instances moved."),
    blocks: [
      {
        type: "key_value",
        title: "Studio instance move",
        items: [{ key: "moves", value: String(moveCount) }]
      },
      { type: "summary", text: firstLine(output, "Instances moved."), tone: "success" }
    ]
  };
}
function buildActionSequencerApplyJsonRender(args, output) {
  const instanceGuid = readString(args.instanceGuid) ?? "";
  const jsonFilePath = readString(args.jsonFilePath) ?? "";
  return {
    inputSummary: clip(jsonFilePath || instanceGuid || "apply sequencer json"),
    outputSummary: summarizeText(output, "Sequencer JSON applied."),
    blocks: [
      {
        type: "key_value",
        title: "Action sequencer apply JSON",
        items: [
          { key: "instanceGuid", value: instanceGuid },
          { key: "jsonFilePath", value: jsonFilePath }
        ].filter((item) => item.value.length > 0)
      },
      { type: "summary", text: firstLine(output, "Sequencer JSON applied."), tone: "success" }
    ]
  };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/tool-registry.ts
var methodModules = [
  exports_asset_manager_image_import,
  exports_action_sequencer_service_apply_json,
  exports_level_browse,
  exports_level_save_file,
  exports_script_add,
  exports_script_delete,
  exports_game_play,
  exports_game_stop
];
var mutatingMethods = new Set([
  method2,
  method,
  method7,
  method8
]);
var renderBuilders = {
  studiorpc_asset_manager_image_import: ({ normalizedArgs, output, result }) => buildAssetManagerImageImportRender(result, normalizedArgs, output),
  studiorpc_action_sequencer_service_apply_json: ({ normalizedArgs, output }) => buildActionSequencerApplyJsonRender(normalizedArgs, output),
  studiorpc_level_browse: ({ args, result }) => buildLevelBrowseRender(result, args),
  studiorpc_level_save_file: ({ output }) => buildLevelSaveFileRender(output),
  studiorpc_script_add: ({ normalizedArgs, output }) => buildScriptAddRender(normalizedArgs, output),
  studiorpc_script_delete: ({ normalizedArgs, output }) => buildDeleteRender("Studio script delete", String(normalizedArgs.targetGuid ?? ""), output),
  studiorpc_instance_read: ({ normalizedArgs, output }) => buildInstanceReadRender(normalizedArgs, output),
  studiorpc_instance_upsert: ({ normalizedArgs, output }) => buildInstanceUpsertRender(normalizedArgs, output),
  studiorpc_instance_delete: ({ normalizedArgs, output }) => buildInstanceDeleteRender(normalizedArgs, output),
  studiorpc_instance_move: ({ normalizedArgs, output }) => buildInstanceMoveRender(normalizedArgs, output),
  studiorpc_game_play: ({ normalizedArgs, output }) => buildGamePlayRender(normalizedArgs, output),
  studiorpc_game_stop: ({ output }) => buildGameStopRender(output)
};

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/instance.delete.ts
var description9 = "Delete instances in batch by GUID. Each item specifies a targetGuid to remove from the level.";
var params9 = exports_external.object({
  items: exports_external.array(exports_external.object({ targetGuid: exports_external.string().describe("GUID of the instance to delete") })).min(1).describe("Batch items to delete.")
}).strict();
function parseArgs(value) {
  return params9.parse(value);
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/instance.params.ts
var vec3 = exports_external.object({ X: exports_external.number(), Y: exports_external.number(), Z: exports_external.number() });
var udim = exports_external.object({ Scale: exports_external.number(), Offset: exports_external.number() });
var colorChannel = exports_external.number().int().min(0).max(255);
var rgb = exports_external.object({ R: colorChannel, G: colorChannel, B: colorChannel });
var udim2 = exports_external.object({
  X: exports_external.object({ Scale: exports_external.number(), Offset: exports_external.number() }),
  Y: exports_external.object({ Scale: exports_external.number(), Offset: exports_external.number() })
});
var normalIdEnum = exports_external.enum(["Right", "Top", "Back", "Left", "Bottom", "Front"]);
var colorSequence = exports_external.array(exports_external.object({ Time: exports_external.number(), Color: rgb })).describe("ColorSequence keypoints [{Time,Color}]");
var numberSequence = exports_external.array(exports_external.object({ Time: exports_external.number(), Value: exports_external.number(), Envelope: exports_external.number().optional() })).describe("NumberSequence keypoints [{Time,Value,Envelope?}]");
var numberRange = exports_external.object({ Min: exports_external.number(), Max: exports_external.number() });
var surfaceGuiBaseProperties = {
  Active: exports_external.boolean().default(true),
  AlwaysOnTop: exports_external.boolean().optional(),
  Brightness: exports_external.number().default(10),
  ClipsDescendants: exports_external.boolean().default(true),
  Enabled: exports_external.boolean().default(true),
  LightInfluence: exports_external.number().describe("(0~1)").default(1),
  MaxDistance: exports_external.number().default(3000),
  Size: udim2.describe("UI size (UDim2)").optional(),
  ZIndexBehavior: exports_external.string().describe('e.g. "Sibling"').optional()
};
var guiObjectProperties = {
  Active: exports_external.boolean().default(true),
  AnchorPoint: exports_external.object({ X: exports_external.number(), Y: exports_external.number() }).optional(),
  BackgroundColor3: rgb.optional(),
  BackgroundTransparency: exports_external.number().describe("(0~1)").optional(),
  ClipsDescendants: exports_external.boolean().optional(),
  LayoutOrder: exports_external.number().optional(),
  Position: udim2.describe("UI position (UDim2)").optional(),
  Rotation: exports_external.number().optional(),
  Size: udim2.describe("UI size (UDim2)").optional(),
  Visible: exports_external.boolean().default(true),
  ZIndex: exports_external.number().optional()
};
var textProperties = {
  Bold: exports_external.boolean().optional(),
  Text: exports_external.string().optional(),
  TextColor3: rgb.optional(),
  TextScaled: exports_external.boolean().optional(),
  TextSize: exports_external.number().default(14),
  TextTransparency: exports_external.number().describe("(0~1)").optional(),
  TextWrapped: exports_external.boolean().optional(),
  TextXAlignment: exports_external.string().describe('e.g. "Left"').optional(),
  TextYAlignment: exports_external.string().describe('e.g. "Top"').optional()
};
var instanceClassEnum = exports_external.enum([
  "Part",
  "Outline",
  "Fill",
  "Frame",
  "ImageButton",
  "ImageLabel",
  "TextButton",
  "TextLabel",
  "Sound",
  "RemoteEvent",
  "Tool",
  "VFXPreset",
  "AngularVelocity",
  "LinearVelocity",
  "VectorForce",
  "Model",
  "Folder",
  "ScrollingFrame",
  "UIListLayout",
  "UIGridLayout",
  "BillboardGui",
  "SurfaceGui",
  "BindableEvent",
  "Attachment",
  "Beam",
  "Trail",
  "ParticleEmitter",
  "PointLight",
  "SpotLight",
  "StringValue",
  "NumberValue",
  "BoolValue",
  "IntValue",
  "MeshPart",
  "Animation",
  "HumanoidDescription",
  "Camera",
  "MaterialVariant",
  "ScreenGui",
  "SimulationBall",
  "SoundGroup",
  "SpawnLocation",
  "UIAspectRatioConstraint",
  "ProximityPrompt"
]);
var serviceClassEnum = exports_external.enum([
  "Workspace",
  "Lighting",
  "Atmosphere",
  "Players",
  "StarterPlayer",
  "MaterialService",
  "HttpService",
  "CollectionService",
  "DataModel",
  "DataStoreService",
  "PhysicsService",
  "RunService",
  "ServerScriptService",
  "ServerStorage",
  "StarterCharacterScripts",
  "StarterGui",
  "StarterPlayerScripts",
  "ReplicatedStorage"
]);
var materialEnum = exports_external.enum([
  "Basic",
  "Plastic",
  "Brick",
  "Rock",
  "Metal",
  "Unlit",
  "Bark",
  "SmallBrick",
  "LeafyGround",
  "MossyGround",
  "Ground",
  "Glass",
  "Paving",
  "MossyRock",
  "Wood",
  "Neon"
]);
var workspaceServiceSchema = exports_external.object({
  Gravity: exports_external.number().optional(),
  HitboxType: exports_external.string().describe('e.g. "Single"').optional()
}).strict().describe("Use when updating Workspace service. Controls world gravity and hitbox type.");
var lightingServiceSchema = exports_external.object({
  AmbientSkyBrightness: exports_external.number().optional(),
  AmbientSkyColor: rgb.optional(),
  AutoTimeCycle: exports_external.number().optional(),
  ClockTime: exports_external.number().optional(),
  Contrast: exports_external.number().optional(),
  GroundReflectionColor: rgb.optional(),
  MoonBrightness: exports_external.number().optional(),
  MoonCastShadow: exports_external.boolean().optional(),
  MoonLightColor: rgb.optional(),
  MoonMaterialColor: rgb.optional(),
  MoonMaxHeight: exports_external.number().optional(),
  MoonPathAngle: exports_external.number().optional(),
  MoonPhase: exports_external.number().optional(),
  NightBrightness: exports_external.number().optional(),
  RealTimeDayDuration: exports_external.number().optional(),
  Saturation: exports_external.number().optional(),
  SkyColorInfluence: exports_external.number().optional(),
  StarsBrightness: exports_external.number().optional(),
  StarsColor: rgb.optional(),
  SunBrightness: exports_external.number().optional(),
  SunCastShadow: exports_external.number().optional(),
  SunLightColor: rgb.optional(),
  SunMaxHeight: exports_external.number().optional(),
  SunPathAngle: exports_external.number().optional(),
  TimeFlowSpeed: exports_external.number().optional()
}).strict().describe("Use when updating Lighting service. Controls time of day, sun/moon, sky colors, and ambient lighting.");
var atmosphereServiceSchema = exports_external.object({
  AirColor: rgb.optional(),
  CloudAmount: exports_external.number().optional(),
  CloudSpeed: exports_external.number().optional(),
  CloudTexture: exports_external.string().optional(),
  FogColor: rgb.optional(),
  FogDensity: exports_external.number().optional(),
  FogFalloff: exports_external.number().optional(),
  FogHorizon: exports_external.boolean().optional(),
  FogStart: exports_external.number().optional(),
  GlareColor: rgb.optional(),
  GlareFalloff: exports_external.number().optional(),
  HazeColor: rgb.optional(),
  HazeSpread: exports_external.number().optional()
}).strict().describe("Use when updating Atmosphere service. Controls fog, haze, glare, and cloud settings.");
var playersServiceSchema = exports_external.object({
  CharacterAutoLoads: exports_external.boolean().optional(),
  RespawnTime: exports_external.number().optional(),
  UseStrafingAnimations: exports_external.boolean().optional()
}).strict().describe("Use when updating Players service. Controls character auto-loading and respawn settings.");
var starterPlayerServiceSchema = exports_external.object({
  AirControl: exports_external.number().optional(),
  AllowCustomAnimations: exports_external.number().optional(),
  CameraMaxZoomDistance: exports_external.number().optional(),
  CameraMinZoomDistance: exports_external.number().optional(),
  CapsuleHeight: exports_external.number().optional(),
  CapsuleRadius: exports_external.number().optional(),
  CharacterMeshPos: vec3.optional(),
  FallingDeceleration: exports_external.number().optional(),
  FallingLateralFriction: exports_external.number().optional(),
  GravityScale: exports_external.number().optional(),
  GroundFriction: exports_external.number().optional(),
  IgnoreBaseRotation: exports_external.boolean().optional(),
  JumpHeight: exports_external.number().optional(),
  JumpPower: exports_external.number().optional(),
  LoadCharacterAppearance: exports_external.boolean().optional(),
  MaxAcceleration: exports_external.number().optional(),
  MaxJumpCount: exports_external.number().optional(),
  MaxSlopeAngle: exports_external.number().optional(),
  RotationSpeed: exports_external.number().optional(),
  StompJumpMultiplier: exports_external.number().optional(),
  UseJumpPower: exports_external.boolean().optional(),
  WalkSpeed: exports_external.number().optional(),
  WalkingDeceleration: exports_external.number().optional()
}).strict().describe("Use when updating StarterPlayer service. Controls character movement, physics, and camera settings.");
var materialServiceSchema = exports_external.object(Object.fromEntries([
  "AsphaltName",
  "BarkName",
  "BasicName",
  "BeigeTerrazzoFloor",
  "BrickCeramicTile",
  "BrickName",
  "BrokenConcreteName",
  "BrokenRoof",
  "BrushMetal",
  "CementWallName",
  "CheckerTileFloorName",
  "ConcreteName",
  "ConcretePlateName",
  "CopperName",
  "CorrugatedSteelName",
  "CrackedMiddleCeramicTileName",
  "CrackedSmallCeramicTileName",
  "DamagedRoofName",
  "DistroyedBronzeName",
  "EmeraldGridTile",
  "GalvanizedMetal",
  "GlassName",
  "GrassName",
  "GreyWovenFabric",
  "GridBorder",
  "GridBoxName",
  "GridMarbleName",
  "GridPentagonName",
  "GridQuadName",
  "GridTileName",
  "GroundName",
  "HalfLeafyGroundName",
  "HouseBricksName",
  "IndustrialRibbedSteel",
  "LeafyGroundName",
  "MarbleName",
  "MetalName",
  "MetalPlateName",
  "MixRoadName",
  "MosaicCarpetName",
  "MossyGroundName",
  "MossyRockName",
  "OceanPanelTile",
  "OfficeCeilingWhiteName",
  "PaintedMetal",
  "PaintedWood",
  "PavingBlockName",
  "PavingBrickName",
  "PavingFloorName",
  "PavingName",
  "PavingStonesName",
  "PavingWallName",
  "PeelingPaintSteel",
  "PlankName",
  "PlasticName",
  "RoadName",
  "RockName",
  "RoofName",
  "RustBrassName",
  "RustName",
  "RustySteel",
  "SandName",
  "SandstoneBrick",
  "SilverMetalName",
  "SmallBrickName",
  "SnowName",
  "SoilRockGroundName",
  "SquareCeramicTile",
  "StoneBrickName",
  "StoneFloorName",
  "TakenOffCeramicTileName",
  "TerrazzoFloorName",
  "ThickCarpet",
  "UnlitName",
  "UrbanSlateFloor",
  "WeatheredPlasterBrick",
  "WhiteCementBrick",
  "WhiteGrayBrickName",
  "WoodName"
].map((n) => [n, exports_external.string().optional()]))).strict().describe("Use when updating MaterialService. Each property maps a base material to its custom variant name.");
var httpServiceSchema = exports_external.object({
  HttpEnabled: exports_external.boolean().optional()
}).strict().describe("Use when updating HttpService. Controls whether HTTP requests are enabled.");
var emptyServiceSchema = exports_external.object({}).strict();
var instancePropertiesSchema = exports_external.union([
  exports_external.object({
    Shape: exports_external.enum(["Block", "Ball", "Cylinder"]).optional(),
    CFrame: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    Size: vec3.describe("units in cm").optional(),
    Anchored: exports_external.boolean().default(true),
    CanCollide: exports_external.boolean().default(true),
    CanQuery: exports_external.boolean().default(true),
    CanTouch: exports_external.boolean().default(true),
    CastShadow: exports_external.boolean().optional(),
    CollisionGroup: exports_external.string().optional(),
    Color: rgb.optional(),
    Locked: exports_external.boolean().optional(),
    Mass: exports_external.number().optional(),
    Massless: exports_external.boolean().optional(),
    Material: materialEnum.optional(),
    MaterialVariant: exports_external.string().optional(),
    Reflectance: exports_external.number().describe("(0~1)").optional(),
    RootPriority: exports_external.number().optional(),
    Transparency: exports_external.number().describe("(0~1)").optional()
  }).strict().describe("Use when class=Part. Defines the 3D mesh shape, transform, size (in cm), color, material, physics, and collision properties."),
  exports_external.object({
    Color: rgb.optional(),
    Thickness: exports_external.number().optional(),
    Adornee: exports_external.string().describe("InstanceGuid of the target instance to outline").optional(),
    Enabled: exports_external.boolean().optional()
  }).strict().describe("Use when class=Outline. Overlay effect with edge color/thickness around an adornee instance."),
  exports_external.object({
    Color: rgb.optional(),
    DepthMode: exports_external.enum(["AlwaysOnTop", "VisibleWhenNotOccluded", "VisibleWhenOccluded"]).optional(),
    Transparency: exports_external.number().describe("(0~1)").optional(),
    Adornee: exports_external.string().describe("InstanceGuid of the target instance to fill").optional(),
    Enabled: exports_external.boolean().optional()
  }).strict().describe("Use when class=Fill. Overlay effect with color fill over an adornee instance."),
  exports_external.object({
    ...guiObjectProperties,
    BorderColor3: rgb.optional(),
    BorderMode: exports_external.enum(["Insert", "Middle", "Outline"]).optional(),
    BorderPixelSize: exports_external.number().optional()
  }).strict().describe("Use when class=Frame. Layout and visual properties with optional border styling."),
  exports_external.object({
    Image: exports_external.string().describe("Image asset ID").optional(),
    ImageColor3: rgb.default({ R: 255, G: 255, B: 255 }),
    ImageTransparency: exports_external.number().describe("(0~1)").optional(),
    PressImage: exports_external.string().describe("Image asset ID").optional(),
    HoverImage: exports_external.string().describe("Image asset ID").optional(),
    ...guiObjectProperties
  }).strict().describe("Use when class=ImageButton. Extends GUI base with image source, tint, transparency, and press/hover state images."),
  exports_external.object({
    Image: exports_external.string().describe("Image asset ID").optional(),
    ImageColor3: rgb.optional(),
    ImageTransparency: exports_external.number().describe("(0~1)").optional(),
    ...guiObjectProperties
  }).strict().describe("Use when class=ImageLabel. Extends GUI base with image source, tint, and transparency (no interaction)."),
  exports_external.object({ ...textProperties, ...guiObjectProperties }).strict().describe("Use when class=TextButton. Extends GUI base with text content, size, color, transparency, and alignment."),
  exports_external.object({ ...textProperties, ...guiObjectProperties }).strict().describe("Use when class=TextLabel. Same as TextButton properties but non-interactive."),
  exports_external.object({
    SoundId: exports_external.string().optional(),
    Volume: exports_external.number().describe("multiplier (0~10)").default(1),
    Looped: exports_external.boolean().optional(),
    PlaybackSpeed: exports_external.number().default(1),
    PlayOnRemove: exports_external.boolean().optional(),
    RollOffMaxDistance: exports_external.number().default(5000),
    RollOffMinDistance: exports_external.number().default(10),
    RollOffMode: exports_external.string().describe('e.g. "InverseTapered"').optional(),
    StartTimePosition: exports_external.number().optional()
  }).strict().describe("Use when class=Sound. Configures the audio asset, volume, looping, playback speed, and 3D spatial roll-off."),
  exports_external.object({}).strict().describe("Use when class=RemoteEvent. No configurable properties \u2014 just set parentGuid and name."),
  exports_external.object({
    CanBeDropped: exports_external.boolean().default(true),
    Enabled: exports_external.boolean().optional(),
    ManualActivationOnly: exports_external.boolean().optional(),
    RequiresHandle: exports_external.boolean().optional(),
    ToolTip: exports_external.string().optional()
  }).strict().describe("Use when class=Tool. An equippable item; configure drop, activation, handle, and tooltip."),
  exports_external.object({
    PresetName: exports_external.string(),
    Color: exports_external.array(exports_external.object({ Time: exports_external.number(), R: exports_external.number(), G: exports_external.number(), B: exports_external.number() })),
    Enabled: exports_external.boolean().default(true),
    InfiniteLoop: exports_external.boolean().default(true),
    LoopCount: exports_external.number().default(1),
    Size: exports_external.number().default(1),
    Transparency: exports_external.number().describe("(0~1)").optional()
  }).strict().describe("Use when class=VFXPreset. Configures particle emission: color gradient, loop behavior, size multiplier, and transparency. PresetName is required."),
  exports_external.object({
    AngularVelocity: vec3.optional(),
    Enabled: exports_external.boolean().default(true),
    MaxTorque: exports_external.number().default(1000),
    ReactionTorqueEnabled: exports_external.boolean().optional(),
    RelativeTo: exports_external.string().describe('e.g. "World"').optional(),
    Visible: exports_external.boolean().optional()
  }).strict().describe("Use when class=AngularVelocity. Applies a target rotational velocity to a physics body, with torque limit and reference frame."),
  exports_external.object({
    VelocityConstraintMode: exports_external.string().describe('e.g. "Vector"').optional(),
    VectorVelocity: vec3.optional(),
    LineDirection: vec3.optional(),
    LineVelocity: exports_external.number().optional(),
    PlaneVelocity: exports_external.object({ X: exports_external.number(), Y: exports_external.number() }).optional(),
    PrimaryTangentAxis: vec3.optional(),
    SecondaryTangentAxis: vec3.optional(),
    Enabled: exports_external.boolean().default(true),
    ForceLimitsEnabled: exports_external.boolean().default(true),
    ForceLimitMode: exports_external.string().describe('e.g. "Magnitude"').optional(),
    MaxForce: exports_external.number().default(10),
    MaxAxesForce: vec3.optional(),
    RelativeTo: exports_external.string().describe('e.g. "World"').optional(),
    Visible: exports_external.boolean().optional()
  }).strict().describe("Use when class=LinearVelocity. Applies a target linear velocity to a physics body; supports Vector/Line/Plane constraint modes with optional force limits."),
  exports_external.object({
    Force: vec3.optional(),
    ApplyAtCenterOfMass: exports_external.boolean().optional(),
    Enabled: exports_external.boolean().default(true),
    RelativeTo: exports_external.string().describe('e.g. "World"').optional(),
    Visible: exports_external.boolean().optional()
  }).strict().describe("Use when class=VectorForce. Applies a constant force vector to a physics body, optionally at its center of mass."),
  exports_external.object({
    PrimaryPart: exports_external.string().describe("InstanceGuid of the primary part").optional(),
    WorldPivot: exports_external.object({ Position: vec3, Orientation: vec3 }).optional()
  }).strict().describe("Use when class=Model. Groups BaseParts into a single unit; supports physics, movement, and rotation as one entity."),
  exports_external.object({}).strict().describe("Use when class=Folder. Logical organizer with no properties \u2014 use for grouping scripts or non-physical instances."),
  exports_external.object({
    AutomaticCanvasSize: exports_external.string().describe('e.g. "Y"').optional(),
    CanvasPosition: exports_external.object({ X: exports_external.number(), Y: exports_external.number() }).describe("Scroll offset (Vector2)").optional(),
    CanvasSize: udim2.describe("Total scrollable area (UDim2)").optional(),
    ScrollBarImageColor3: rgb.optional(),
    ScrollBarImageTransparency: exports_external.number().describe("(0~1)").optional(),
    ScrollBarThickness: exports_external.number().default(12),
    ScrollingDirection: exports_external.string().describe('e.g. "Y"').optional(),
    ScrollingEnabled: exports_external.boolean().default(true),
    ...guiObjectProperties,
    ClipsDescendants: exports_external.boolean().default(true)
  }).strict().describe("Use when class=ScrollingFrame. Scrollable UI container; use for inventory lists, quest logs, or any overflowing content."),
  exports_external.object({
    Padding: udim.describe("Space between list items (UDim)").optional(),
    Wraps: exports_external.boolean().optional(),
    FillDirection: exports_external.string().describe('e.g. "Vertical"').optional(),
    HorizontalAlignment: exports_external.string().describe('e.g. "Center"').optional(),
    VerticalAlignment: exports_external.string().describe('e.g. "Top"').optional(),
    SortOrder: exports_external.string().describe('e.g. "LayoutOrder"').optional()
  }).strict().describe("Use when class=UIListLayout. Auto-arranges sibling UI elements in a horizontal or vertical list."),
  exports_external.object({
    CellPadding: udim2.describe("Space between grid cells (UDim2)").optional(),
    CellSize: udim2.describe("Uniform size of each grid cell (UDim2)").optional(),
    FillDirectionMaxCells: exports_external.number().int().optional(),
    FillDirection: exports_external.string().describe('e.g. "Horizontal"').optional(),
    HorizontalAlignment: exports_external.string().describe('e.g. "Left"').optional(),
    VerticalAlignment: exports_external.string().describe('e.g. "Top"').optional(),
    SortOrder: exports_external.string().describe('e.g. "LayoutOrder"').optional()
  }).strict().describe("Use when class=UIGridLayout. Auto-arranges sibling UI elements in a uniform grid with configurable cell size and padding."),
  exports_external.object({
    ...surfaceGuiBaseProperties,
    DistanceLowerLimit: exports_external.number().optional(),
    DistanceUpperLimit: exports_external.number().optional(),
    ExtentsOffsetWorldSpace: vec3.optional(),
    PositionOffset: vec3.optional(),
    SizeOffset: exports_external.object({ X: exports_external.number(), Y: exports_external.number() }).describe("Screen-space size offset (Vector2)").optional()
  }).strict().describe("Use when class=BillboardGui. World-space GUI anchored to an Adornee; configure visibility distance, offsets, and base surface properties."),
  exports_external.object({
    ...surfaceGuiBaseProperties,
    Face: normalIdEnum.optional(),
    ZOffset: exports_external.number().default(1)
  }).strict().describe("Use when class=SurfaceGui. GUI rendered on a Part surface; configure the target face and base surface properties."),
  exports_external.object({}).strict().describe("Use when class=BindableEvent. No configurable properties \u2014 just set parentGuid and name."),
  exports_external.object({
    Axis: vec3.optional(),
    CFrame: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    SecondaryAxis: vec3.optional()
  }).strict().describe("Use when class=Attachment. Defines a local coordinate frame on a BasePart for constraints and effects."),
  exports_external.object({
    Color: colorSequence.optional(),
    CurveSize0: exports_external.number().optional(),
    CurveSize1: exports_external.number().optional(),
    Enabled: exports_external.boolean().default(true),
    FaceCamera: exports_external.boolean().optional(),
    Texture: exports_external.string().describe("Texture asset ID").optional(),
    TextureLength: exports_external.number().default(1),
    TextureSpeed: exports_external.number().default(1),
    Transparency: numberSequence.optional(),
    Width0: exports_external.number().default(1),
    Width1: exports_external.number().default(1)
  }).strict().describe("Use when class=Beam. Visual beam between two Attachments; configure color, curve, texture, width, and transparency."),
  exports_external.object({
    Color: colorSequence.optional(),
    Enabled: exports_external.boolean().default(true),
    Lifetime: exports_external.number().default(2),
    Offset: vec3.optional(),
    Texture: exports_external.string().describe("Texture asset ID").optional(),
    TextureLength: exports_external.number().default(1),
    TextureSpeed: exports_external.number().default(1),
    Transparency: numberSequence.optional(),
    Width: exports_external.number().default(200),
    WidthScale: numberSequence.optional()
  }).strict().describe("Use when class=Trail. Motion trail between two Attachments; configure color, lifetime, texture, width, and transparency."),
  exports_external.object({
    Acceleration: vec3.optional(),
    Brightness: exports_external.number().optional(),
    Color: colorSequence.optional(),
    Drag: exports_external.number().optional(),
    EmissionDirection: normalIdEnum.optional(),
    Enabled: exports_external.boolean().default(true),
    FlipbookFramerate: numberRange.optional(),
    FlipbookLayout: exports_external.enum(["None", "Grid2x2", "Grid4x4", "Grid8x8"]).optional(),
    FlipbookMode: exports_external.enum(["Loop", "OneShot", "PingPong", "Random"]).optional(),
    FlipbookStartRandom: exports_external.boolean().optional(),
    LifeTime: numberRange.optional(),
    LightEmission: exports_external.number().describe("(0~1)").optional(),
    LockedToPart: exports_external.boolean().optional(),
    Orientation: exports_external.enum(["FacingCamera", "FacingCameraWorldUp", "VelocityParallel", "VelocityPerpendicular"]).optional(),
    Rate: exports_external.number().default(5),
    RotSpeed: exports_external.number().optional(),
    Rotation: numberRange.optional(),
    Shape: exports_external.enum(["Box", "Sphere", "Cylinder", "Disc"]).optional(),
    ShapeInOut: exports_external.enum(["OutWard", "InWard"]).optional(),
    ShapeStyle: exports_external.enum(["Volume", "Surface"]).optional(),
    Size: numberSequence.optional(),
    Speed: numberRange.optional(),
    SpreadAngle: exports_external.number().optional(),
    Squash: numberSequence.optional(),
    Texture: exports_external.string().describe("Texture asset ID").optional(),
    Transparency: numberSequence.optional()
  }).strict().describe("Use when class=ParticleEmitter. Full particle system configuration: emission shape, color/size/transparency curves, flipbook animation, and physics."),
  exports_external.object({
    Brightness: exports_external.number().default(50),
    Color: rgb.optional(),
    Enabled: exports_external.boolean().optional(),
    Range: exports_external.number().describe("Radius of illumination in studs").default(300),
    Shadows: exports_external.boolean().optional()
  }).strict().describe("Use when class=PointLight. Omnidirectional light source; configure color, brightness, range, and shadows."),
  exports_external.object({
    Angle: exports_external.number().describe("Cone half-angle in degrees").default(45),
    Brightness: exports_external.number().default(50),
    Color: rgb.optional(),
    Enabled: exports_external.boolean().optional(),
    Face: normalIdEnum.optional(),
    Range: exports_external.number().describe("Radius of illumination in studs").default(300),
    Shadows: exports_external.boolean().optional()
  }).strict().describe("Use when class=SpotLight. Cone-shaped directional light; configure angle, face, color, brightness, range, and shadows."),
  exports_external.object({ Value: exports_external.string().optional() }).strict().describe("Use when class=StringValue. Stores a single string value."),
  exports_external.object({ Value: exports_external.number().optional() }).strict().describe("Use when class=NumberValue. Stores a single floating-point value."),
  exports_external.object({ Value: exports_external.boolean().optional() }).strict().describe("Use when class=BoolValue. Stores a single boolean value."),
  exports_external.object({ Value: exports_external.number().int().optional() }).strict().describe("Use when class=IntValue. Stores a single integer value."),
  exports_external.object({
    Shape: exports_external.enum(["Block", "Ball", "Cylinder"]).optional(),
    CFrame: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    Size: vec3.describe("units in cm").optional(),
    Anchored: exports_external.boolean().default(true),
    CanCollide: exports_external.boolean().default(true),
    CanQuery: exports_external.boolean().default(true),
    CanTouch: exports_external.boolean().default(true),
    CastShadow: exports_external.boolean().optional(),
    CollisionGroup: exports_external.string().optional(),
    Color: rgb.optional(),
    DoubleSided: exports_external.boolean().optional(),
    EnableMeshShadowDetails: exports_external.boolean().optional(),
    Locked: exports_external.boolean().optional(),
    Massless: exports_external.boolean().optional(),
    Material: materialEnum.optional(),
    MaterialVariant: exports_external.string().optional(),
    MeshId: exports_external.string().describe("Mesh asset ID").optional(),
    Reflectance: exports_external.number().describe("(0~1)").optional(),
    RootPriority: exports_external.number().optional(),
    TextureId: exports_external.string().describe("Surface texture asset ID").optional(),
    Transparency: exports_external.number().describe("(0~1)").optional()
  }).strict().describe("Use when class=MeshPart. BasePart with a custom mesh; all Part physics/collision properties apply plus MeshId and TextureId."),
  exports_external.object({ AnimationId: exports_external.string().describe("Animation asset ID").optional() }).strict().describe("Use when class=Animation. References an animation asset to be loaded by an Animator."),
  exports_external.object({
    Head: exports_external.string().describe("Head mesh asset ID").optional(),
    Torso: exports_external.string().describe("Torso mesh asset ID").optional(),
    LeftArm: exports_external.string().describe("Left arm mesh asset ID").optional(),
    RightArm: exports_external.string().describe("Right arm mesh asset ID").optional(),
    LeftLeg: exports_external.string().describe("Left leg mesh asset ID").optional(),
    RightLeg: exports_external.string().describe("Right leg mesh asset ID").optional(),
    HeadColor: rgb.optional(),
    TorsoColor: rgb.optional(),
    LeftArmColor: rgb.optional(),
    RightArmColor: rgb.optional(),
    LeftLegColor: rgb.optional(),
    RightLegColor: rgb.optional(),
    HeadTextureId: exports_external.string().describe("Head texture asset ID").optional(),
    TorsoTextureId: exports_external.string().describe("Torso texture asset ID").optional(),
    LeftArmTextureId: exports_external.string().describe("Left arm texture asset ID").optional(),
    RightArmTextureId: exports_external.string().describe("Right arm texture asset ID").optional(),
    LeftLegTextureId: exports_external.string().describe("Left leg texture asset ID").optional(),
    RightLegTextureId: exports_external.string().describe("Right leg texture asset ID").optional(),
    IdleAnimation: exports_external.string().describe("Animation asset ID").optional(),
    WalkAnimation: exports_external.string().describe("Animation asset ID").optional(),
    RunAnimation: exports_external.string().describe("Animation asset ID").optional(),
    JumpAnimation: exports_external.string().describe("Animation asset ID").optional(),
    FallAnimation: exports_external.string().describe("Animation asset ID").optional(),
    LandedAnimation: exports_external.string().describe("Animation asset ID").optional(),
    ClimbAnimation: exports_external.string().describe("Animation asset ID").optional(),
    SwimmingIdleAnimation: exports_external.string().describe("Animation asset ID").optional(),
    SwimmingBreaststrokeAnimation: exports_external.string().describe("Animation asset ID").optional(),
    SprintAnimation: exports_external.string().describe("Animation asset ID").optional(),
    MoodAnimation: exports_external.string().describe("Animation asset ID").optional(),
    DieAnimation: exports_external.string().describe("Animation asset ID").optional(),
    HeightScale: exports_external.number().describe("Character y-axis scale").default(1),
    DepthScale: exports_external.number().describe("Character z-axis scale").default(1),
    WidthScale: exports_external.number().describe("Character x-axis scale").default(1),
    HeadScale: exports_external.number().default(1),
    BodyTypeScale: exports_external.number().default(1),
    ProportionScale: exports_external.number().default(1),
    Face: exports_external.string().describe("Face asset ID").optional(),
    Shirt: exports_external.string().describe("Shirt asset ID").optional(),
    Pants: exports_external.string().describe("Pants asset ID").optional(),
    GraphicTShirt: exports_external.string().describe("Graphic T-Shirt asset ID").optional(),
    HatAccessory: exports_external.string().describe("Hat asset ID").optional(),
    HairAccessory: exports_external.string().describe("Hair asset ID").optional(),
    FaceAccessory: exports_external.string().describe("Face accessory asset ID").optional(),
    NeckAccessory: exports_external.string().describe("Neck accessory asset ID").optional(),
    ShoulderAccessory: exports_external.string().describe("Shoulder accessory asset ID").optional(),
    FrontAccessory: exports_external.string().describe("Front accessory asset ID").optional(),
    BackAccessory: exports_external.string().describe("Back accessory asset ID").optional(),
    WaistAccessory: exports_external.string().describe("Waist accessory asset ID").optional(),
    AccessoryBlob: exports_external.string().describe("JSON accessory blob").optional()
  }).strict().describe("Use when class=HumanoidDescription. Configures character appearance: body part meshes, textures, colors, animations, scale, and accessories."),
  exports_external.object({
    CFrame: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    CameraOffset: vec3.optional(),
    CameraSubject: exports_external.string().describe("InstanceGuid of the subject to follow").optional(),
    CameraType: exports_external.enum(["Fixed", "Attach", "Watch", "Track", "Follow", "Custom", "Scriptable", "Orbital"]).optional(),
    EnableSmoothFollow: exports_external.boolean().optional(),
    EnableSmoothRotation: exports_external.boolean().optional(),
    FieldOfView: exports_external.number().optional(),
    Focus: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    FollowMaxDistance: exports_external.number().optional(),
    SmoothFollowSpeed: exports_external.number().optional(),
    SmoothRotationSpeed: exports_external.number().optional()
  }).strict().describe("Use when class=Camera. Controls the world camera: type, FOV, follow/smooth settings, and CFrame."),
  exports_external.object({
    BaseMaterial: materialEnum.optional(),
    Color: rgb.optional(),
    ColorMap: exports_external.string().describe("Texture asset ID").optional(),
    Emissive: rgb.optional(),
    EmissiveIntensity: exports_external.number().optional(),
    EmissiveMap: exports_external.string().describe("Texture asset ID").optional(),
    Metalness: exports_external.number().describe("(0~1)").optional(),
    MetalnessMap: exports_external.string().describe("Texture asset ID").optional(),
    MetersPerTile: exports_external.number().optional(),
    NormalMap: exports_external.string().describe("Texture asset ID").optional(),
    Roughness: exports_external.number().describe("(0~1)").optional(),
    RoughnessMap: exports_external.string().describe("Texture asset ID").optional()
  }).strict().describe("Use when class=MaterialVariant. Custom material override with PBR texture maps and surface color."),
  exports_external.object({
    DisplayOrder: exports_external.number().optional(),
    Enabled: exports_external.boolean().default(true)
  }).strict().describe("Use when class=ScreenGui. Full-screen GUI container; controls display layer order and visibility."),
  exports_external.object({
    BallRadius: exports_external.number().optional(),
    BallState: exports_external.string().describe('e.g. "Idle"').optional(),
    CFrame: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    Color: rgb.optional(),
    EnablePathMarker: exports_external.boolean().optional(),
    IsPathMarkerWorldSpace: exports_external.boolean().optional(),
    Material: materialEnum.optional(),
    MaterialVariant: exports_external.string().optional(),
    PathMarkerScale: exports_external.number().optional(),
    SlomoFactor: exports_external.number().optional(),
    TextureId: exports_external.string().describe("Texture asset ID").optional()
  }).strict().describe("Use when class=SimulationBall. Physics-simulated ball with trajectory, material, and path marker settings."),
  exports_external.object({
    Volume: exports_external.number().describe("multiplier (0~10)").default(1)
  }).strict().describe("Use when class=SoundGroup. Groups Sounds under a shared volume multiplier."),
  exports_external.object({
    Shape: exports_external.enum(["Block", "Ball", "Cylinder"]).optional(),
    CFrame: exports_external.object({ Position: vec3, Orientation: vec3 }).optional(),
    Size: vec3.describe("units in cm").optional(),
    Anchored: exports_external.boolean().default(true),
    CanCollide: exports_external.boolean().default(true),
    CanQuery: exports_external.boolean().default(true),
    CanTouch: exports_external.boolean().default(true),
    CastShadow: exports_external.boolean().optional(),
    CollisionGroup: exports_external.string().optional(),
    Color: rgb.optional(),
    Locked: exports_external.boolean().optional(),
    Mass: exports_external.number().optional(),
    Massless: exports_external.boolean().optional(),
    Material: materialEnum.optional(),
    MaterialVariant: exports_external.string().optional(),
    Reflectance: exports_external.number().describe("(0~1)").optional(),
    RootPriority: exports_external.number().optional(),
    Transparency: exports_external.number().describe("(0~1)").optional(),
    Enabled: exports_external.boolean().optional(),
    Neutral: exports_external.boolean().optional(),
    TeamColor: rgb.optional()
  }).strict().describe("Use when class=SpawnLocation. Player spawn point with team color, neutral flag, and all Part physics properties."),
  exports_external.object({
    AspectRatio: exports_external.number().optional(),
    AspectType: exports_external.string().describe('e.g. "FitWithinMaxSize"').optional(),
    DominantAxis: exports_external.string().describe('e.g. "Width"').optional()
  }).strict().describe("Use when class=UIAspectRatioConstraint. Locks the aspect ratio of a sibling UI element."),
  exports_external.object({
    KeyboardKeyCode: exports_external.string().describe('e.g. "E"'),
    UIOffset: exports_external.object({ X: exports_external.number(), Y: exports_external.number() }).optional(),
    Exclusivity: exports_external.enum(["OnePerButton", "OneGlobally", "AlwaysShow"]).optional(),
    HoldDuration: exports_external.number().default(0),
    MaxActivationDistance: exports_external.number().default(200),
    ObjectText: exports_external.string(),
    ActionText: exports_external.string(),
    ClickablePrompt: exports_external.boolean().default(true),
    Enabled: exports_external.boolean().default(true),
    RequiresLineOfSight: exports_external.boolean().default(true)
  }).strict().describe("Use when class=ProximityPrompt. Configures nearby interaction prompt behavior including key binding, UI offset, exclusivity mode, distance, and line-of-sight requirements."),
  workspaceServiceSchema,
  lightingServiceSchema,
  atmosphereServiceSchema,
  playersServiceSchema,
  starterPlayerServiceSchema,
  materialServiceSchema,
  httpServiceSchema
]).optional();
var serviceSchemaEntries = [
  ["Workspace", workspaceServiceSchema],
  ["Lighting", lightingServiceSchema],
  ["Atmosphere", atmosphereServiceSchema],
  ["Players", playersServiceSchema],
  ["StarterPlayer", starterPlayerServiceSchema],
  ["MaterialService", materialServiceSchema],
  ["HttpService", httpServiceSchema],
  ["CollectionService", emptyServiceSchema],
  ["DataModel", emptyServiceSchema],
  ["DataStoreService", emptyServiceSchema],
  ["PhysicsService", emptyServiceSchema],
  ["RunService", emptyServiceSchema],
  ["ServerScriptService", emptyServiceSchema],
  ["ServerStorage", emptyServiceSchema],
  ["StarterCharacterScripts", emptyServiceSchema],
  ["StarterGui", emptyServiceSchema],
  ["StarterPlayerScripts", emptyServiceSchema],
  ["ReplicatedStorage", emptyServiceSchema]
];
var classPropertiesSchemas = new Map([
  ...instanceClassEnum.options.map((name, i) => {
    const inner = instancePropertiesSchema;
    return [name, inner.unwrap().options[i]];
  }),
  ...serviceSchemaEntries
]);
function zodToShape(schema) {
  if (schema instanceof exports_external.ZodObject) {
    const result = {};
    for (const [key, val] of Object.entries(schema.shape)) {
      result[key] = zodToShape(val);
    }
    return result;
  }
  if (schema instanceof exports_external.ZodOptional)
    return zodToShape(schema.unwrap());
  if (schema instanceof exports_external.ZodDefault)
    return zodToShape(schema.removeDefault());
  if (schema instanceof exports_external.ZodArray)
    return zodToShape(schema.element);
  return true;
}
var classPropertyShapes = Object.fromEntries([...classPropertiesSchemas.entries()].map(([name, schema]) => [
  name,
  zodToShape(schema)
]));

// apps/overdare-agent/plugins/plugin-studiorpc/src/tools/ovdrjm-utils.ts
import { readdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { join as join2 } from "path";
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function findNodeByActorGuid(node, targetGuid) {
  if (typeof node.ActorGuid === "string" && node.ActorGuid === targetGuid) {
    return node;
  }
  if (!Array.isArray(node.LuaChildren)) {
    return;
  }
  for (const child of node.LuaChildren) {
    if (!isRecord2(child))
      continue;
    const found = findNodeByActorGuid(child, targetGuid);
    if (found)
      return found;
  }
  return;
}
function removeNodeByActorGuid(node, targetGuid) {
  if (!Array.isArray(node.LuaChildren))
    return false;
  const children = node.LuaChildren;
  const index = children.findIndex((child) => isRecord2(child) && child.ActorGuid === targetGuid);
  if (index !== -1) {
    children.splice(index, 1);
    return true;
  }
  for (const child of children) {
    if (isRecord2(child) && removeNodeByActorGuid(child, targetGuid)) {
      return true;
    }
  }
  return false;
}
function findFilesByExtension(cwd, extension) {
  const entries = readdirSync(cwd, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension)).map((entry) => join2(cwd, entry.name));
}
function resolveOvdrjmPathFromUmap(cwd) {
  const umapFiles = findFilesByExtension(cwd, ".umap");
  if (umapFiles.length === 0) {
    throw new Error("No .umap file found in current working directory.");
  }
  if (umapFiles.length > 1) {
    throw new Error(`Multiple .umap files found (${umapFiles.map((file) => file.split("/").pop()).join(", ")}). Keep one world file in cwd.`);
  }
  const umapPath = umapFiles[0];
  const ovdrjmPath = umapPath.replace(/\.umap$/i, ".ovdrjm");
  const ovdrjmFiles = findFilesByExtension(cwd, ".ovdrjm");
  if (!ovdrjmFiles.includes(ovdrjmPath)) {
    throw new Error(`Matching .ovdrjm file not found for ${umapPath.split("/").pop()}. Expected ${ovdrjmPath.split("/").pop()}.`);
  }
  return { umapPath, ovdrjmPath };
}
function readOvdrjmRoot(cwd) {
  const { umapPath, ovdrjmPath } = resolveOvdrjmPathFromUmap(cwd);
  const buf = readFileSync2(ovdrjmPath);
  const raw = buf[0] === 255 && buf[1] === 254 ? new TextDecoder("utf-16le").decode(buf) : buf.toString("utf-8");
  const parsedJson = JSON.parse(raw);
  const root = parsedJson.Root;
  if (!isRecord2(root)) {
    throw new Error("Invalid .ovdrjm format: Root object is missing.");
  }
  return { umapPath, ovdrjmPath, root };
}
function isUtf16Le(buf) {
  return buf.length >= 2 && buf[0] === 255 && buf[1] === 254;
}
function decodeOvdrjm(buf) {
  return isUtf16Le(buf) ? new TextDecoder("utf-16le").decode(buf) : buf.toString("utf-8");
}
function encodeOvdrjm(text, originalBuf) {
  if (isUtf16Le(originalBuf)) {
    const bom = Buffer.from([255, 254]);
    const body = Buffer.from(text, "utf16le");
    return Buffer.concat([bom, body]);
  }
  return Buffer.from(text, "utf-8");
}
function readAndWriteOvdrjm(cwd, update) {
  const { umapPath, ovdrjmPath } = resolveOvdrjmPathFromUmap(cwd);
  const buf = readFileSync2(ovdrjmPath);
  const raw = decodeOvdrjm(buf);
  const parsedJson = JSON.parse(raw);
  const outcome = update(parsedJson);
  const output = `${JSON.stringify(parsedJson, null, 2)}
`;
  writeFileSync(ovdrjmPath, encodeOvdrjm(output, buf));
  return { umapPath, ovdrjmPath, ...outcome };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/tools/instance-delete-tool.ts
var serviceClasses = new Set(serviceClassEnum.options);
async function executeInstanceDelete(args, ctx, cwd, writeLock) {
  const toolName = "studiorpc_instance_delete";
  const parsedArgs = parseArgs(args);
  const writeApproval = await ctx.approve({
    permission: "write",
    toolName,
    description: "Update .ovdrjm world file",
    details: parsedArgs
  });
  if (writeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "instance.delete" }
    };
  }
  const release = await writeLock.acquire();
  try {
    return await executeInstanceDeleteInner(parsedArgs, cwd);
  } finally {
    release();
  }
}
async function executeInstanceDeleteInner(parsedArgs, cwd) {
  const fileResult = readAndWriteOvdrjm(cwd, (rootDoc) => {
    const root = rootDoc.Root;
    if (!isRecord2(root)) {
      throw new Error("Invalid .ovdrjm format: Root object is missing.");
    }
    const deletedGuids = [];
    for (const item of parsedArgs.items) {
      const target = findNodeByActorGuid(root, item.targetGuid);
      if (!target) {
        throw new Error(`ActorGuid not found in .ovdrjm: ${item.targetGuid}`);
      }
      const instanceType = typeof target.InstanceType === "string" ? target.InstanceType : undefined;
      if (instanceType && serviceClasses.has(instanceType)) {
        throw new Error(`"${instanceType}" is a Service \u2014 it cannot be deleted.`);
      }
      const removed = removeNodeByActorGuid(root, item.targetGuid);
      if (!removed) {
        throw new Error(`Failed to remove ActorGuid from .ovdrjm: ${item.targetGuid}`);
      }
      deletedGuids.push(item.targetGuid);
    }
    return { deletedGuids };
  });
  const result = await applyAndSave();
  const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return {
    output,
    render: buildInstanceDeleteRender(parsedArgs, output),
    metadata: {
      method: "instance.delete",
      umapPath: fileResult.umapPath,
      ovdrjmPath: fileResult.ovdrjmPath,
      targetGuids: fileResult.deletedGuids,
      deleteCount: parsedArgs.items.length,
      levelApplyResult: result
    }
  };
}
function createInstanceDeleteTool(cwd, writeLock) {
  return {
    name: "studiorpc_instance_delete",
    description: description9,
    parameters: params9,
    async execute(args, ctx) {
      return executeInstanceDelete(args, ctx, cwd, writeLock);
    }
  };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/instance.move.ts
var description10 = "Move instances to a new parent in batch. Each item specifies a guid to move and the parentGuid of the new parent.";
var params10 = exports_external.object({
  items: exports_external.array(exports_external.object({
    guid: exports_external.string().describe("GUID of the instance to move"),
    parentGuid: exports_external.string().describe("GUID of the new parent instance")
  })).min(1).max(10).describe("Batch items to move.")
}).strict();
function parseArgs2(value) {
  return params10.parse(value);
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/tools/instance-move-tool.ts
var serviceClasses2 = new Set(serviceClassEnum.options);
async function executeInstanceMove(args, ctx, cwd, writeLock) {
  const toolName = "studiorpc_instance_move";
  const parsedArgs = parseArgs2(args);
  const writeApproval = await ctx.approve({
    permission: "write",
    toolName,
    description: "Update .ovdrjm world file",
    details: parsedArgs
  });
  if (writeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "instance.move" }
    };
  }
  const release = await writeLock.acquire();
  try {
    return await executeInstanceMoveInner(parsedArgs, cwd);
  } finally {
    release();
  }
}
async function executeInstanceMoveInner(parsedArgs, cwd) {
  const fileResult = readAndWriteOvdrjm(cwd, (rootDoc) => {
    const root = rootDoc.Root;
    if (!isRecord2(root)) {
      throw new Error("Invalid .ovdrjm format: Root object is missing.");
    }
    const movedGuids = [];
    for (const item of parsedArgs.items) {
      const target = findNodeByActorGuid(root, item.guid);
      if (!target) {
        throw new Error(`ActorGuid not found in .ovdrjm: ${item.guid}`);
      }
      const instanceType = typeof target.InstanceType === "string" ? target.InstanceType : undefined;
      if (instanceType && serviceClasses2.has(instanceType)) {
        throw new Error(`"${instanceType}" is a Service \u2014 it cannot be moved.`);
      }
      const newParent = findNodeByActorGuid(root, item.parentGuid);
      if (!newParent) {
        throw new Error(`New parent ActorGuid not found in .ovdrjm: ${item.parentGuid}`);
      }
      const removed = removeNodeByActorGuid(root, item.guid);
      if (!removed) {
        throw new Error(`Failed to detach ActorGuid from .ovdrjm: ${item.guid}`);
      }
      const childList = Array.isArray(newParent.LuaChildren) ? newParent.LuaChildren : [];
      newParent.LuaChildren = childList;
      childList.push(target);
      movedGuids.push(item.guid);
    }
    return { added: movedGuids.map((g) => ({ guid: g, name: "", class: "" })) };
  });
  const result = await applyAndSave();
  const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return {
    output,
    render: buildInstanceMoveRender(parsedArgs, output),
    metadata: {
      method: "instance.move",
      umapPath: fileResult.umapPath,
      ovdrjmPath: fileResult.ovdrjmPath,
      targetGuids: fileResult.added.map((a) => a.guid),
      moveCount: parsedArgs.items.length,
      levelApplyResult: result
    }
  };
}
function createInstanceMoveTool(cwd, writeLock) {
  return {
    name: "studiorpc_instance_move",
    description: description10,
    parameters: params10,
    async execute(args, ctx) {
      return executeInstanceMove(args, ctx, cwd, writeLock);
    }
  };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/instance.read.ts
var method9 = "instance.read";
var description11 = "Read instance properties from the level file by GUID. Returns only known class properties. Use recursive to include descendants.";
var params11 = exports_external.object({
  guid: exports_external.string().describe("GUID of the instance to read"),
  recursive: exports_external.boolean().describe("If true, include all descendants recursively").default(false)
});

// apps/overdare-agent/plugins/plugin-studiorpc/src/tools/instance-read-tool.ts
var knownClasses = new Set([...instanceClassEnum.options, ...serviceClassEnum.options]);
function stripByShape(value, shape) {
  if (shape === true)
    return value;
  if (value === null || value === undefined)
    return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripByShape(item, shape));
  }
  if (typeof value !== "object")
    return value;
  const record = value;
  const result = {};
  for (const [key, childShape] of Object.entries(shape)) {
    if (key in record) {
      result[key] = stripByShape(record[key], childShape);
    }
  }
  return result;
}
function pickKnownProperties(node) {
  const instanceType = typeof node.InstanceType === "string" ? node.InstanceType : undefined;
  const shapes = instanceType ? classPropertyShapes[instanceType] : undefined;
  if (!shapes)
    return {};
  const result = {};
  for (const [key, shape] of Object.entries(shapes)) {
    if (key in node) {
      result[key] = stripByShape(node[key], shape);
    }
  }
  return result;
}
function toReadableNode(node, recursive) {
  const instanceType = typeof node.InstanceType === "string" ? node.InstanceType : undefined;
  if (!instanceType)
    return;
  const isKnown = knownClasses.has(instanceType);
  const result = {
    guid: typeof node.ActorGuid === "string" ? node.ActorGuid : "",
    name: typeof node.Name === "string" ? node.Name : "",
    class: instanceType,
    properties: isKnown ? pickKnownProperties(node) : {}
  };
  if (recursive && Array.isArray(node.LuaChildren)) {
    const children = [];
    for (const child of node.LuaChildren) {
      if (!isRecord2(child))
        continue;
      const readable = toReadableNode(child, true);
      if (readable)
        children.push(readable);
    }
    if (children.length > 0)
      result.children = children;
  }
  return result;
}
function toToolName(method10) {
  return `studiorpc_${method10.replace(/\./g, "_")}`;
}
async function executeInstanceRead(args, _ctx, cwd) {
  const parsed = params11.parse(args);
  const { root } = readOvdrjmRoot(cwd);
  const target = findNodeByActorGuid(root, parsed.guid);
  if (!target) {
    return {
      output: `Instance not found: ${parsed.guid}`,
      metadata: { error: true, method: "instance.read" }
    };
  }
  const readable = toReadableNode(target, parsed.recursive);
  if (!readable) {
    return {
      output: `Instance ${parsed.guid} has no InstanceType.`,
      metadata: { error: true, method: "instance.read" }
    };
  }
  const output = JSON.stringify(readable, null, 2);
  return {
    output,
    render: buildInstanceReadRender(parsed, output),
    metadata: { method: "instance.read", guid: parsed.guid, recursive: parsed.recursive }
  };
}
function createInstanceReadTool(cwd) {
  return {
    name: toToolName(method9),
    description: description11,
    parameters: params11,
    async execute(args, ctx) {
      return executeInstanceRead(args, ctx, cwd);
    }
  };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/methods/instance.upsert.ts
var addParams = exports_external.object({
  class: instanceClassEnum,
  parentGuid: exports_external.string(),
  name: exports_external.string(),
  properties: instancePropertiesSchema
}).strict();
var updateParams = exports_external.object({
  guid: exports_external.string().describe("Target instance GUID. Only for updating existing instances; do not include when creating new ones."),
  name: exports_external.string().optional(),
  properties: instancePropertiesSchema
}).strict();
var itemParams = exports_external.union([addParams, updateParams]).describe("Each item is inferred by its fields: add uses parentGuid/class/name/properties, update uses guid/(optional name)/properties.");
var params12 = exports_external.object({
  items: exports_external.array(itemParams).min(1).max(20).describe("Batch items inferred as add or update by their fields. Do not mix adds and updates in a single call \u2014 use one call for all adds, another for all updates. Start with a small number first, then increase up to 10 if needed.")
}).strict();
var method10 = "instance.upsert";
var description12 = "Upsert instances in batch. Do not mix adds and updates in a single call \u2014 use one call for all adds, another for all updates. Start with a small number of items first, then increase up to 10 if needed. Each item is inferred by its fields: add uses parentGuid/class/name/properties, update uses guid with optional name and properties. To create nested hierarchies, add the parent first so its GUID is returned, then add children using that GUID as parentGuid in subsequent items. Services (Workspace, Lighting, Atmosphere, Players, StarterPlayer, MaterialService, etc.) are singletons \u2014 they cannot be added, only updated by guid. To reparent an existing instance (change its hierarchy), use instance.move instead of delete + re-add.";
function isUpdateItem(value) {
  return "guid" in value && typeof value.guid === "string";
}
function parseArgs3(value) {
  const result = params12.safeParse(value);
  if (result.success)
    return result.data;
  const items = Array.isArray(value.items) ? value.items : [];
  const details = [];
  const serviceClasses3 = new Set(serviceClassEnum.options);
  for (let i = 0;i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object")
      continue;
    const cls = typeof item.class === "string" ? item.class : undefined;
    if (cls && serviceClasses3.has(cls)) {
      details.push(`  [items[${i}]] "${cls}" is a Service \u2014 it cannot be added, only updated by guid.`);
      continue;
    }
    validateItemProperties(item, `items[${i}]`, details);
  }
  if (details.length > 0) {
    throw new Error(details.join(`
`));
  }
  throw result.error;
}
function inferClassFromProperties(props) {
  const propKeys = Object.keys(props);
  if (propKeys.length === 0)
    return;
  let bestClass;
  let bestOverlap = 0;
  for (const [name, shapes] of Object.entries(classPropertyShapes)) {
    const shapeKeys = Object.keys(shapes);
    let overlap = 0;
    for (const key of propKeys) {
      if (shapeKeys.includes(key))
        overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestClass = name;
    }
  }
  return bestClass;
}
var SCREEN_W = 1386;
var SCREEN_H = 640;
var JUMP_BUTTON = {
  anchorX: 1,
  anchorY: 1,
  posScaleX: 1,
  posOffsetX: -140,
  posScaleY: 1,
  posOffsetY: -70,
  sizeScaleX: 0,
  sizeOffsetX: 180,
  sizeScaleY: 0,
  sizeOffsetY: 180
};
var GUI_OBJECT_CLASSES = new Set(["Frame", "ImageButton", "ImageLabel", "TextButton", "TextLabel", "ScrollingFrame"]);
function isFullyTransparent(node) {
  const t = node.BackgroundTransparency;
  return typeof t === "number" && t >= 1;
}
var MIN_TAP_SIZE = 60;
var RECOMMENDED_TAP_SIZE = 80;
var TAP_TARGET_CLASSES = new Set(["ImageButton", "TextButton"]);
function resolveRect(props, parentRect) {
  const pos = props.Position;
  const size = props.Size;
  if (!pos && !size)
    return;
  const parentW = parentRect.right - parentRect.left;
  const parentH = parentRect.bottom - parentRect.top;
  const anchor = props.AnchorPoint;
  const ax = anchor?.X ?? 0;
  const ay = anchor?.Y ?? 0;
  const px = parentRect.left + (pos?.X?.Scale ?? 0) * parentW + (pos?.X?.Offset ?? 0);
  const py = parentRect.top + (pos?.Y?.Scale ?? 0) * parentH + (pos?.Y?.Offset ?? 0);
  const sw = (size?.X?.Scale ?? 0) * parentW + (size?.X?.Offset ?? 0);
  const sh = (size?.Y?.Scale ?? 0) * parentH + (size?.Y?.Offset ?? 0);
  if (sw <= 0 || sh <= 0)
    return;
  const left = px - ax * sw;
  const top = py - ay * sh;
  return { left, top, right: left + sw, bottom: top + sh };
}
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
var SCREEN_RECT = { left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H };
var NATIVE_HUD = { left: 0, top: 0, right: 210, bottom: 70 };
var JOYSTICK = { left: 0, top: SCREEN_H - 300, right: 300, bottom: SCREEN_H };
var SAFE_INSET = 40;
var LEFT_INSET = { left: 0, top: 0, right: SAFE_INSET, bottom: SCREEN_H };
var RIGHT_INSET = { left: SCREEN_W - SAFE_INSET, top: 0, right: SCREEN_W, bottom: SCREEN_H };
function buildReservedZones() {
  const j = JUMP_BUTTON;
  const px = j.posScaleX * SCREEN_W + j.posOffsetX;
  const py = j.posScaleY * SCREEN_H + j.posOffsetY;
  const sw = j.sizeScaleX * SCREEN_W + j.sizeOffsetX;
  const sh = j.sizeScaleY * SCREEN_H + j.sizeOffsetY;
  const left = px - j.anchorX * sw;
  const top = py - j.anchorY * sh;
  return [
    { label: "mobile jump button", rect: { left, top, right: left + sw, bottom: top + sh } },
    { label: "mobile HUD", rect: NATIVE_HUD },
    { label: "mobile joystick", rect: JOYSTICK },
    { label: "left safe area (notch/OS menu)", rect: LEFT_INSET },
    { label: "right safe area (notch/OS menu)", rect: RIGHT_INSET }
  ];
}
var SCREEN_GUI_CLASSES = new Set(["ScreenGui", "StarterGui"]);
function getZIndex(node) {
  const raw = node.ZIndex;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}
function getZBand(zIndex) {
  if (zIndex <= 0)
    return 0;
  return Math.floor(zIndex / 100);
}
function rectWidth(rect) {
  return rect.right - rect.left;
}
function rectHeight(rect) {
  return rect.bottom - rect.top;
}
function rectArea(rect) {
  return Math.max(0, rectWidth(rect)) * Math.max(0, rectHeight(rect));
}
function isFullscreenOverlay(rect) {
  const widthCoverage = rectWidth(rect) / SCREEN_W;
  const heightCoverage = rectHeight(rect) / SCREEN_H;
  const areaCoverage = rectArea(rect) / rectArea(SCREEN_RECT);
  return widthCoverage >= 0.9 && heightCoverage >= 0.9 && areaCoverage >= 0.85;
}
function describeBand(band) {
  const min = band * 100;
  const max = min + 99;
  return `ZIndex band ${band} (${min}-${max})`;
}
function collectUiDiagnostics(root) {
  const warnings = [];
  const info = [];
  const zones = buildReservedZones();
  const buttons = [];
  const allGui = [];
  walkNodes(root, SCREEN_RECT, zones, warnings, info, buttons, allGui, new Set);
  for (let i = 0;i < buttons.length; i++) {
    for (let j = i + 1;j < buttons.length; j++) {
      const a = buttons[i];
      const b = buttons[j];
      if (a.band !== b.band)
        continue;
      if (a.isFullscreenOverlay || b.isFullscreenOverlay)
        continue;
      if (rectsOverlap(a.rect, b.rect)) {
        warnings.push(`"${a.name}" (${a.cls} ${a.guid}\u2026) overlaps "${b.name}" (${b.cls} ${b.guid}\u2026) \u2014 ` + `${describeBand(a.band)}, ` + `(${Math.round(a.rect.left)},${Math.round(a.rect.top)})-(${Math.round(a.rect.right)},${Math.round(a.rect.bottom)}) ` + `vs (${Math.round(b.rect.left)},${Math.round(b.rect.top)})-(${Math.round(b.rect.right)},${Math.round(b.rect.bottom)}).`);
      }
    }
  }
  const buttonGuids = new Set(buttons.map((b) => b.fullGuid));
  for (let i = 0;i < allGui.length; i++) {
    for (let j = i + 1;j < allGui.length; j++) {
      const a = allGui[i];
      const b = allGui[j];
      if (buttonGuids.has(a.fullGuid) && buttonGuids.has(b.fullGuid))
        continue;
      if (a.ancestors.has(b.fullGuid) || b.ancestors.has(a.fullGuid))
        continue;
      if (a.band !== b.band)
        continue;
      if (a.isFullscreenOverlay || b.isFullscreenOverlay)
        continue;
      if (rectsOverlap(a.rect, b.rect)) {
        info.push(`"${a.name}" (${a.cls} ${a.guid}\u2026) overlaps "${b.name}" (${b.cls} ${b.guid}\u2026) \u2014 ` + `both are in ${describeBand(a.band)}; if unintentional, consider adjusting their positions.`);
      }
    }
  }
  return { warnings, info };
}
function walkNodes(node, parentRect, zones, warnings, info, buttons, allGui, ancestors, insideScreenGui = false) {
  const cls = typeof node.InstanceType === "string" ? node.InstanceType : undefined;
  const fullGuid = typeof node.ActorGuid === "string" ? node.ActorGuid : "";
  let childRect = parentRect;
  let childInsideScreenGui = insideScreenGui;
  if (cls && SCREEN_GUI_CLASSES.has(cls)) {
    childRect = SCREEN_RECT;
    childInsideScreenGui = true;
  } else if (cls && GUI_OBJECT_CLASSES.has(cls)) {
    const rect = resolveRect(node, parentRect);
    if (rect) {
      childRect = rect;
      const name = typeof node.Name === "string" ? node.Name : cls;
      const guid = fullGuid.slice(0, 8) || "?";
      const w = Math.round(rect.right - rect.left);
      const h = Math.round(rect.bottom - rect.top);
      const zIndex = getZIndex(node);
      const band = getZBand(zIndex);
      const entry = {
        name,
        cls,
        guid,
        rect,
        zIndex,
        band,
        isFullscreenOverlay: band > 0 && isFullscreenOverlay(rect),
        fullGuid,
        ancestors: new Set(ancestors)
      };
      if (!isFullyTransparent(node) && childInsideScreenGui) {
        allGui.push(entry);
        if (band === 0) {
          for (const zone of zones) {
            if (rectsOverlap(rect, zone.rect)) {
              const r = zone.rect;
              warnings.push(`"${name}" (${cls} ${guid}\u2026) overlaps the ${zone.label} area ` + `(${Math.round(rect.left)},${Math.round(rect.top)})-(${Math.round(rect.right)},${Math.round(rect.bottom)}) ` + `vs ${zone.label} (${r.left},${r.top})-(${r.right},${r.bottom}) at ${SCREEN_W}\xD7${SCREEN_H} in ${describeBand(band)}. ` + `If this is a layout container, set BackgroundTransparency to 1. Use ZIndex 100+ only for intentional overlays such as loading screens or modal blockers.`);
            }
          }
        }
        if (cls && TAP_TARGET_CLASSES.has(cls)) {
          buttons.push(entry);
          if (w < MIN_TAP_SIZE || h < MIN_TAP_SIZE) {
            warnings.push(`"${name}" (${cls} ${guid}\u2026) is too small for a tap target (${w}\xD7${h}px, minimum ${MIN_TAP_SIZE}\xD7${MIN_TAP_SIZE}px, recommended ${RECOMMENDED_TAP_SIZE}\xD7${RECOMMENDED_TAP_SIZE}px).`);
          } else if (w < RECOMMENDED_TAP_SIZE || h < RECOMMENDED_TAP_SIZE) {
            info.push(`"${name}" (${cls} ${guid}\u2026) is below recommended tap target size (${w}\xD7${h}px, recommended ${RECOMMENDED_TAP_SIZE}\xD7${RECOMMENDED_TAP_SIZE}px).`);
          }
        }
      }
    }
  }
  const childAncestors = fullGuid ? new Set([...ancestors, fullGuid]) : ancestors;
  if (Array.isArray(node.LuaChildren)) {
    for (const child of node.LuaChildren) {
      if (child != null && typeof child === "object") {
        walkNodes(child, childRect, zones, warnings, info, buttons, allGui, childAncestors, childInsideScreenGui);
      }
    }
  }
}
function validateItemProperties(item, path, details) {
  const className = typeof item.class === "string" ? item.class : undefined;
  const props = item.properties;
  if (props == null || typeof props !== "object")
    return;
  const resolvedClass = className ?? inferClassFromProperties(props);
  if (!resolvedClass)
    return;
  const schema = classPropertiesSchemas.get(resolvedClass);
  if (!schema)
    return;
  const r = schema.safeParse(props);
  if (!r.success) {
    const label = className ? `class=${resolvedClass}` : `closest match: ${resolvedClass}`;
    for (const issue of r.error.issues) {
      const loc = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
      details.push(`  [${path}.properties${loc}] (${label}) ${issue.message}`);
    }
  }
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/tools/instance-upsert-tool.ts
function toToolName2(method11) {
  return `studiorpc_${method11.replace(/\./g, "_")}`;
}
function makeActorGuid() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join("");
}
function nextObjectKey(rootDoc) {
  const current = rootDoc.MapObjectKeyIndex;
  const numeric = typeof current === "number" && Number.isFinite(current) ? Math.floor(current) : 0;
  const next = numeric + 1;
  rootDoc.MapObjectKeyIndex = next;
  return next;
}
function buildAddedNode(item, rootDoc) {
  const newNode = {
    InstanceType: item.class,
    ActorGuid: makeActorGuid(),
    ObjectKey: nextObjectKey(rootDoc),
    Name: item.name,
    ...item.properties
  };
  return newNode;
}
async function executeInstanceUpsert(args, ctx, cwd, writeLock) {
  const toolName = "studiorpc_instance_upsert";
  const parsedArgs = parseArgs3(args);
  const writeApproval = await ctx.approve({
    permission: "write",
    toolName,
    description: "Update .ovdrjm world file",
    details: parsedArgs
  });
  if (writeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "instance.upsert" }
    };
  }
  const release = await writeLock.acquire();
  try {
    return await executeInstanceUpsertInner(parsedArgs, cwd);
  } finally {
    release();
  }
}
async function executeInstanceUpsertInner(parsedArgs, cwd) {
  let ovdrjmRoot;
  const fileResult = readAndWriteOvdrjm(cwd, (rootDoc) => {
    const root = rootDoc.Root;
    if (!isRecord2(root)) {
      throw new Error("Invalid .ovdrjm format: Root object is missing.");
    }
    const added = [];
    for (const item of parsedArgs.items) {
      if (isUpdateItem(item)) {
        const target = findNodeByActorGuid(root, item.guid);
        if (!target) {
          throw new Error(`ActorGuid not found in .ovdrjm: ${item.guid}`);
        }
        Object.assign(target, item.properties);
        if (typeof item.name === "string") {
          target.Name = item.name;
        }
        continue;
      }
      const parent = findNodeByActorGuid(root, item.parentGuid);
      if (!parent) {
        throw new Error(`Parent ActorGuid not found in .ovdrjm: ${item.parentGuid}`);
      }
      if (item.class === "MaterialVariant" && parent.InstanceType !== "MaterialService") {
        throw new Error(`MaterialVariant can only be created under MaterialService, but parent is ${String(parent.InstanceType ?? "unknown")}`);
      }
      const childList = Array.isArray(parent.LuaChildren) ? parent.LuaChildren : [];
      parent.LuaChildren = childList;
      const newNode = buildAddedNode({ ...item, properties: item.properties ?? {} }, rootDoc);
      childList.push(newNode);
      added.push({ guid: String(newNode.ActorGuid), name: item.name, class: item.class });
    }
    ovdrjmRoot = root;
    return { added };
  });
  await applyAndSave();
  const diag = ovdrjmRoot ? collectUiDiagnostics(ovdrjmRoot) : { warnings: [], info: [] };
  const addedGuids = fileResult.added.map((item) => item.guid);
  const updatedGuids = parsedArgs.items.flatMap((item) => isUpdateItem(item) ? [item.guid] : []);
  const targetGuids = [...updatedGuids, ...addedGuids];
  const addCount = fileResult.added.length;
  const updateCount = updatedGuids.length;
  const lines = [];
  if (fileResult.added.length > 0) {
    lines.push("<added-instances>");
    for (const a of fileResult.added) {
      lines.push(`<instance name="${a.name}" class="${a.class}" guid="${a.guid}" />`);
    }
    lines.push("</added-instances>");
  }
  if (diag.warnings.length > 0) {
    lines.push("<warnings>", ...diag.warnings, "</warnings>");
  }
  if (diag.info.length > 0) {
    lines.push("<suggestions>", ...diag.info, "</suggestions>");
  }
  return {
    output: lines.join(`
`) || "OK",
    render: buildInstanceUpsertRender(parsedArgs, lines.join(`
`) || "OK"),
    metadata: {
      method: "instance.upsert",
      targetGuids,
      addCount,
      updateCount,
      added: fileResult.added,
      ...diag.warnings.length > 0 && { warnings: diag.warnings },
      ...diag.info.length > 0 && { info: diag.info }
    }
  };
}
function createInstanceUpsertTool(cwd, writeLock) {
  return {
    name: toToolName2(method10),
    description: description12,
    parameters: params12,
    parseArgs: (raw) => parseArgs3(raw),
    async execute(args, ctx) {
      return executeInstanceUpsert(args, ctx, cwd, writeLock);
    }
  };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/write-lock.ts
function createWriteLock() {
  let tail = Promise.resolve();
  function acquire() {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = tail;
    tail = tail.then(() => gate);
    return ready.then(() => release);
  }
  return { acquire };
}

// apps/overdare-agent/plugins/plugin-studiorpc/src/index.ts
var manifest = {
  name: "@overdare/plugin-studiorpc",
  apiVersion: "1.0",
  version: "0.1.0"
};
function toToolName3(method11) {
  return `studiorpc_${method11.replace(/\./g, "_")}`;
}
async function createTools(ctx) {
  const writeLock = createWriteLock();
  const tools = [
    createInstanceReadTool(ctx.cwd),
    createInstanceUpsertTool(ctx.cwd, writeLock),
    createInstanceDeleteTool(ctx.cwd, writeLock),
    createInstanceMoveTool(ctx.cwd, writeLock)
  ];
  for (const mod of methodModules) {
    const { method: method11, description: description13, params: params13 } = mod;
    const toolName = toToolName3(method11);
    tools.push({
      name: toolName,
      description: description13,
      parameters: params13,
      async execute(args, toolCtx) {
        const rpcMethod = mod.resolveMethod ? mod.resolveMethod(args) : method11;
        const approval = await toolCtx.approve({
          permission: "execute",
          toolName,
          description: `Studio RPC: ${rpcMethod}`,
          details: { method: rpcMethod, params: args }
        });
        if (approval === "reject") {
          return {
            output: "[Rejected by user]",
            metadata: { error: true, method: rpcMethod }
          };
        }
        const isMutating = mutatingMethods.has(method11);
        const release = isMutating ? await writeLock.acquire() : undefined;
        try {
          const normalizedArgs = mod.normalizeArgs ? mod.normalizeArgs(args) : args;
          let result = await call(rpcMethod, normalizedArgs);
          if (mod.postProcess) {
            result = mod.postProcess(result, args);
          }
          if (isMutating) {
            await call("level.save.file", {});
          }
          const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          const renderBuilder = renderBuilders[toolName];
          const render = renderBuilder?.({ args, normalizedArgs, output, result });
          return {
            output,
            render,
            metadata: { method: rpcMethod, result }
          };
        } finally {
          release?.();
        }
      }
    });
  }
  return tools;
}
export {
  manifest,
  createTools
};
