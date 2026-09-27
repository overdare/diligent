# Action Sequence JSON Application

## Current Studio compatibility (verified 2026-09-25)

`studiorpc_action_sequencer_service_apply_json` takes an existing Action Sequence instance's `instanceGuid` and an absolute `jsonFilePath`. The file contains the sequence object itself, not a level wrapper or a JSON-encoded `Data` string.

Studio's `FActionSequenceSerializer::ValidateJsonObjectProperties` checks serialized root and track properties, including inherited track properties. A missing property fails validation even when the log labels it optional and reports only a warning. Legacy level data may need the same fields as legacy templates.

| Location | Property | Value when missing |
|---|---|---|
| Root | `PreviewTarget` | `{}` (editor preview metadata) |
| Every entry in `Tracks` | `CustomDisplayName` | `""` |
| Every entry in `Tracks` | `StartOffsetTime` | `0` |
| `/Script/LuaAPI.ActionSequenceControlTrack` | `bScaleInheritance` | `true` (current Studio default) |

Preserve existing values, including nonempty names, nonzero offsets, explicit `false` scale inheritance, and custom preview targets. `Header.version` is `2` for current authored templates; do not downgrade version 2 data or treat changing the version as a substitute for missing-property repair. The bundled tool preserves an input file's version.

The bundled tool validates common root/track fields and fills these missing compatibility properties in a temporary copy. It leaves the source file unchanged and deletes the copy after the call. Studio still owns validation of class-specific fields. If using another direct RPC client, supply these properties yourself. No whitespace, line-ending, or encoding conversion repairs missing properties; UTF-8 without BOM is suitable.

For readable output matching Studio examples, put `bScaleInheritance` after `AttachmentOffset` and `StartOffsetTime` after `CustomDisplayName`. JSON property order is not a validation requirement.

## Sound tracks

This example assumes sequence `Length >= 0.767`. Sound assets and attenuation distances are authoring choices, not universal defaults.

```json
{
  "Class": "/Script/LuaAPI.ActionSequenceSoundTrack",
  "OvdrAssetId": { "ovdrAssetId": "ovdrassetid://1110127" },
  "Is2DSound": false,
  "AttachmentOffset": {
    "socketName": "None",
    "isAttach": true,
    "relativeLocation": { "x": 0, "y": 0, "z": 0 },
    "relativeRotation": { "pitch": 0, "yaw": 0, "roll": 0 }
  },
  "RollOffMaxDistance": 10000,
  "RollOffMinDistance": 2600,
  "RollOffMode": "InverseTapered",
  "FadeInTime": 0,
  "FadeOutTime": 0,
  "TrackID": { "a": 123, "b": 456, "c": 789, "d": 1011 },
  "IsEnable": true,
  "StartTime": 0.204,
  "EndTime": 0.767,
  "CustomDisplayName": "Sfx_1110127",
  "StartOffsetTime": 0,
  "ParentTrackID": { "a": 0, "b": 0, "c": 0, "d": 0 },
  "ChildTrackIDs": [],
  "IsLock": false
}
```

- Generate a unique `TrackID` tuple of four 32-bit integers within each sequence. Do not reuse this example ID when adding multiple tracks. Preserve IDs and parent/child references for existing tracks.
- Keep sound `EndTime <= Length`. If clipping cuts an audible tail, consider `FadeOutTime` of 0.1-0.2 seconds, adjusted to the clip duration.
- For repeated generated-SFX updates, replace only the SoundTracks owned by that generator (for example, those it named with `Sfx_`); preserve other sounds and tracks. Confirm that prefix is reserved for generated tracks before using it as an ownership marker.

## Verify application and persistence

Require `success: true`. In the active Studio's log, a matching `[IsValidActionSequenceJson]` validation-pass entry includes `Class=/Script/LuaAPI.ActionSequence` and the track count. The usual log path is `%LOCALAPPDATA%\Sandbox\Saved\Logs\Sandbox.log`; multiple Studio instances may use different log files. Check entries from the current call.

Call `studiorpc_level_save_file` after application. Inspect the target sequence's `Data` in the saved level `.ovdrjm`, parsing that string as JSON, to verify the fields and tracks persisted.

## Diagnose failures

For RPC error `-32005 Invalid ActionSequence JSON structure`:

1. Read current `[IsValidActionSequenceJson]` log entries. Missing required and optional properties both fail validation; a warning alone can explain failure.
2. Check root `PreviewTarget`, every track's `CustomDisplayName` and `StartOffsetTime`, and control-track `bScaleInheritance`. Other root and class-specific properties must also be present. Compare with an equivalent asset saved by the same Studio version.
3. Correct the named property before retrying. Avoid repeated unchanged calls or encoding changes when the log reports property omissions.

The bundled tool reports common field errors with paths such as `Tracks[0].TrackID` before calling Studio. For remaining Studio structure failures it retains the RPC code/data and points to the serializer log. It cannot infer every reflected class property from the generic RPC error.

## Audible delay during remote testing

Check `LogAudioMixer: Display: Using Audio Hardware Device` before changing authored sound timing. Remote Desktop audio caused over one second of audible output delay in the reported session while engine playback-start measurements were about 0.04-0.10 seconds. Those are observations from that session, not guaranteed engine latency. Verify timing in the engine and output-device path separately.
